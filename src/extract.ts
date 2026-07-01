/**
 * Streaming, memory-bounded archive extraction across every container ZipKit
 * reads — ZIP, tar (+ `.tar.gz`/`.tar.zst`/`.tar.xz`), 7z, and lone compressed
 * streams (gzip/zstd/xz/bzip2/lz4).
 *
 * {@link extractStream} yields one {@link ArchiveEntryChunk} at a time so a
 * consumer can write each entry straight to disk (or a socket) without ever
 * holding the whole archive decompressed in memory. Two properties make it safe
 * to point at untrusted input:
 *
 * - **`maxTotalBytes`** caps the running total of *actually decompressed* bytes.
 *   For the streamable path (ZIP `store`/`deflate`, gzip, plain tar) the cap is
 *   enforced *during* decompression via the platform's incremental
 *   `DecompressionStream`, so a zip bomb is rejected before it can allocate past
 *   the cap. The engine's one-shot codecs (zstd, xz, bzip2, lzma, 7z) can't be
 *   interrupted mid-frame, so there the cap is best-effort: a declared-size
 *   pre-check plus a post-decode check, bounding blow-up to roughly
 *   `compressedSize × ratio`.
 * - **`signal`** aborts between chunks.
 *
 * Path safety (rejecting `../` and absolute entry names) is the caller's job —
 * `extractStream` never touches the filesystem, it only decodes bytes.
 *
 * @example
 * ```ts
 * import { extractStream } from '@myrialabs/zipkit';
 * for await (const { info, chunk, done } of extractStream(bytes, { maxTotalBytes: 512 * 1024 * 1024 })) {
 *   if (info.type === 'directory') { await mkdir(info.name); continue; }
 *   await append(info.name, chunk);
 * }
 * ```
 */

import { getEngine } from './engine.js';
import { detectFormat, type DetectedFormat } from './detect.js';
import { gunzip } from './codecs/gzip.js';
import { unzstd } from './codecs/zstd.js';
import { unxz } from './codecs/xz.js';
import { unbzip2 } from './codecs/bzip2.js';
import { unlz4 } from './codecs/lz4.js';
import { unzlib } from './codecs/zlib.js';
import { untar } from './tar/index.js';
import { unSevenZip } from './sevenzip/index.js';
import { fromDosDateTime } from './zip/datetime.js';
import { aesDecrypt, type AesStrength } from './zip/crypto/winzip.js';
import { zipCryptoDecrypt } from './zip/crypto/zipcrypto.js';
import { AbortError, ZipKitError } from './types.js';

/** How the outer container of an archive is framed. */
export type ArchiveFormat =
	| 'zip'
	| 'tar'
	| '7z'
	| 'gzip'
	| 'zstd'
	| 'xz'
	| 'bzip2'
	| 'lz4-frame'
	| 'zlib'
	| 'tar.gz'
	| 'tar.zst'
	| 'tar.xz'
	| 'tar.bz2';

/** Metadata for one archive member, known before its bytes are streamed. */
export interface ArchiveEntryInfo {
	/** Path within the archive, using `/` separators. */
	name: string;
	/** Entry kind. */
	type: 'file' | 'directory' | 'symlink';
	/** Uncompressed size in bytes, or `-1` when the container doesn't record it. */
	size: number;
	/** Unix permission bits, if the archive recorded any. */
	mode?: number;
	/** Last-modified time, if recorded. */
	mtime?: Date;
	/** Symlink target, when `type` is `'symlink'`. */
	linkname?: string;
}

/** One decompressed slice of an entry, emitted by {@link extractStream}. */
export interface ArchiveEntryChunk {
	/** The entry this chunk belongs to. */
	info: ArchiveEntryInfo;
	/** Decompressed bytes (empty for directories, symlinks, and zero-length files). */
	chunk: Uint8Array;
	/** `true` on the final chunk of this entry — the next chunk starts a new entry. */
	done: boolean;
}

/** Options for {@link extractStream}. */
export interface ExtractStreamOptions {
	/** Container framing. Auto-detected from magic bytes when omitted. */
	format?: ArchiveFormat;
	/** Password for encrypted ZIP entries (WinZip AES or legacy ZipCrypto). */
	password?: string;
	/** Extract only entries for which this returns `true`. */
	filter?: (info: ArchiveEntryInfo) => boolean;
	/** Cap on total decompressed bytes; throws {@link ZipKitError} once exceeded. */
	maxTotalBytes?: number;
	/** Abort between chunks; throws {@link AbortError} when signalled. */
	signal?: AbortSignal;
	/** Name for the single entry of a lone compressed stream (default `'data'`). */
	entryName?: string;
}

const CHUNK = 64 * 1024;
const EMPTY = new Uint8Array(0);
const hasNative = typeof DecompressionStream !== 'undefined';

/** Tracks decompressed output against the cap and the abort signal. */
class Budget {
	total = 0;
	constructor(
		private readonly cap: number,
		private readonly signal?: AbortSignal
	) {}
	/** Account for `n` freshly decompressed bytes; throws past the cap. */
	add(n: number): void {
		if (this.signal?.aborted) throw new AbortError();
		this.total += n;
		if (this.total > this.cap) {
			throw new ZipKitError(`Extracted content exceeds maxTotalBytes (${this.cap} bytes)`);
		}
	}
	/** Bytes still permitted before the cap is hit. */
	get remaining(): number {
		return this.cap - this.total;
	}
	check(): void {
		if (this.signal?.aborted) throw new AbortError();
	}
}

/**
 * Extract an archive as a stream of entry chunks. Auto-detects the container
 * from `data`'s magic bytes unless `opts.format` is given. See the module
 * overview for the memory-bounding and cap semantics.
 */
export function extractStream(data: Uint8Array, opts: ExtractStreamOptions = {}): AsyncIterable<ArchiveEntryChunk> {
	return {
		[Symbol.asyncIterator](): AsyncIterator<ArchiveEntryChunk> {
			const budget = new Budget(opts.maxTotalBytes ?? Number.POSITIVE_INFINITY, opts.signal);
			return dispatch(data, opts, budget)[Symbol.asyncIterator]();
		}
	};
}

/** Route to the right container reader based on the resolved format. */
function dispatch(data: Uint8Array, opts: ExtractStreamOptions, budget: Budget): AsyncIterable<ArchiveEntryChunk> {
	const fmt = opts.format ?? detectArchiveFormat(data);
	switch (fmt) {
		case 'zip':
			return zipEntries(data, opts, budget);
		case 'tar':
			return tarEntries(data, opts, budget, false);
		case '7z':
			return sevenZipEntries(data, opts, budget);
		case 'tar.gz':
			return codecEntries(data, 'gzip', opts, budget, true);
		case 'tar.zst':
			return codecEntries(data, 'zstd', opts, budget, true);
		case 'tar.xz':
			return codecEntries(data, 'xz', opts, budget, true);
		case 'tar.bz2':
			return codecEntries(data, 'bzip2', opts, budget, true);
		case 'gzip':
		case 'zstd':
		case 'xz':
		case 'bzip2':
		case 'lz4-frame':
		case 'zlib':
			return codecEntries(data, fmt, opts, budget, undefined);
		default:
			throw new ZipKitError('Unrecognized archive format; pass { format } explicitly');
	}
}

/** Detect the outer container, erroring on bytes with no known signature. */
function detectArchiveFormat(data: Uint8Array): ArchiveFormat {
	const fmt: DetectedFormat | undefined = detectFormat(data);
	if (!fmt) throw new ZipKitError('Unrecognized archive format; pass { format } explicitly');
	return fmt;
}

// ---------------------------------------------------------------------------
// Emission helper
// ---------------------------------------------------------------------------

/**
 * Emit `chunks` as {@link ArchiveEntryChunk}s for one entry, marking the final
 * one `done`. Buffers a single chunk ahead so the last is known; a directory or
 * empty file yields exactly one empty `done` chunk. Byte accounting happens at
 * the decompression site, not here, so counted bytes aren't double-charged.
 */
async function* emitEntry(
	info: ArchiveEntryInfo,
	chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>
): AsyncGenerator<ArchiveEntryChunk> {
	let pending: Uint8Array | undefined;
	const iterable = Symbol.asyncIterator in chunks ? chunks : toAsync(chunks as Iterable<Uint8Array>);
	for await (const c of iterable as AsyncIterable<Uint8Array>) {
		if (pending !== undefined) yield { info, chunk: pending, done: false };
		pending = c;
	}
	yield { info, chunk: pending ?? EMPTY, done: true };
}

async function* toAsync(src: Iterable<Uint8Array>): AsyncGenerator<Uint8Array> {
	for (const c of src) yield c;
}

/** Slice a whole buffer into `CHUNK`-sized pieces (views, not copies). */
function* sliceChunks(buf: Uint8Array): Generator<Uint8Array> {
	for (let off = 0; off < buf.length; off += CHUNK) yield buf.subarray(off, Math.min(off + CHUNK, buf.length));
}

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOC = 0x07064b50;
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const utf8Decode = new TextDecoder('utf-8');

/** Locate the End-Of-Central-Directory record, scanning back from the tail. */
function findEocd(view: DataView, data: Uint8Array): number {
	const min = Math.max(0, data.length - (22 + U16_MAX));
	for (let i = data.length - 22; i >= min; i--) {
		if (view.getUint32(i, true) === SIG_EOCD) return i;
	}
	throw new ZipKitError('Not a ZIP archive: end-of-central-directory record not found');
}

/** Read whichever 64-bit fields a ZIP64 extra field carries. */
function readZip64Extra(
	view: DataView,
	start: number,
	extraLen: number,
	need: { size: boolean; compSize: boolean; offset: boolean }
): { size?: number; compSize?: number; offset?: number } {
	let p = start;
	const end = start + extraLen;
	const result: { size?: number; compSize?: number; offset?: number } = {};
	while (p + 4 <= end) {
		const id = view.getUint16(p, true);
		const len = view.getUint16(p + 2, true);
		let q = p + 4;
		if (id === 0x0001) {
			if (need.size) {
				result.size = Number(view.getBigUint64(q, true));
				q += 8;
			}
			if (need.compSize) {
				result.compSize = Number(view.getBigUint64(q, true));
				q += 8;
			}
			if (need.offset) result.offset = Number(view.getBigUint64(q, true));
			return result;
		}
		p += 4 + len;
	}
	return result;
}

/** Scan an extra field for the WinZip AES (0x9901) record. */
function readAesExtra(view: DataView, start: number, len: number): { strength: AesStrength; actualMethod: number } | undefined {
	let off = start;
	const end = start + len;
	while (off + 4 <= end) {
		const id = view.getUint16(off, true);
		const size = view.getUint16(off + 2, true);
		if (id === 0x9901 && size >= 7) {
			return { strength: view.getUint8(off + 8) as AesStrength, actualMethod: view.getUint16(off + 9, true) };
		}
		off += 4 + size;
	}
	return undefined;
}

/** Decompress raw-deflate bytes incrementally, yielding output as it arrives. */
async function* inflateRawChunks(comp: Uint8Array): AsyncGenerator<Uint8Array> {
	if (!hasNative) {
		yield (await getEngine()).deflateDecompress(comp);
		return;
	}
	const ds = new DecompressionStream('deflate-raw');
	const writer = ds.writable.getWriter();
	const reader = ds.readable.getReader();
	// Feed the whole compressed slice as a detached pump; reads below drain it,
	// so backpressure never deadlocks and we can stop early by cancelling.
	const pump = writer
		.write(comp as unknown as BufferSource)
		.then(() => writer.close())
		.catch(() => undefined);
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value && value.length) yield value;
		}
	} finally {
		await reader.cancel().catch(() => undefined);
		await pump;
	}
}

/** Charge each chunk of `src` to the budget before re-yielding it. */
async function* counted(src: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, budget: Budget): AsyncGenerator<Uint8Array> {
	const iterable = Symbol.asyncIterator in src ? (src as AsyncIterable<Uint8Array>) : toAsync(src as Iterable<Uint8Array>);
	for await (const c of iterable) {
		budget.add(c.length);
		yield c;
	}
}

/** Walk a ZIP central directory, streaming each entry's decompressed bytes. */
async function* zipEntries(data: Uint8Array, opts: ExtractStreamOptions, budget: Budget): AsyncGenerator<ArchiveEntryChunk> {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const eocd = findEocd(view, data);

	let count = view.getUint16(eocd + 10, true);
	let cdOffset = view.getUint32(eocd + 16, true);
	if (count === U16_MAX || cdOffset === U32_MAX) {
		const locOff = eocd - 20;
		if (locOff >= 0 && view.getUint32(locOff, true) === SIG_EOCD64_LOC) {
			const eocd64 = Number(view.getBigUint64(locOff + 8, true));
			if (view.getUint32(eocd64, true) === SIG_EOCD64) {
				count = Number(view.getBigUint64(eocd64 + 32, true));
				cdOffset = Number(view.getBigUint64(eocd64 + 48, true));
			}
		}
	}

	let p = cdOffset;
	for (let i = 0; i < count; i++) {
		budget.check();
		if (view.getUint32(p, true) !== SIG_CENTRAL) throw new ZipKitError('Corrupt ZIP: bad central directory signature');
		const flag = view.getUint16(p + 8, true);
		const method = view.getUint16(p + 10, true);
		const dosTime = view.getUint16(p + 12, true);
		const dosDate = view.getUint16(p + 14, true);
		const crc = view.getUint32(p + 16, true);
		let compSize = view.getUint32(p + 20, true);
		let size = view.getUint32(p + 24, true);
		const nameLen = view.getUint16(p + 28, true);
		const extraLen = view.getUint16(p + 30, true);
		const commentLen = view.getUint16(p + 32, true);
		const externalAttrs = view.getUint32(p + 38, true);
		let localOffset = view.getUint32(p + 42, true);
		const nameStart = p + 46;
		const name = utf8Decode.decode(data.subarray(nameStart, nameStart + nameLen));
		const extraStart = nameStart + nameLen;

		if (size === U32_MAX || compSize === U32_MAX || localOffset === U32_MAX) {
			const z = readZip64Extra(view, extraStart, extraLen, {
				size: size === U32_MAX,
				compSize: compSize === U32_MAX,
				offset: localOffset === U32_MAX
			});
			if (z.size !== undefined) size = z.size;
			if (z.compSize !== undefined) compSize = z.compSize;
			if (z.offset !== undefined) localOffset = z.offset;
		}
		p = extraStart + extraLen + commentLen;

		const unixMode = externalAttrs >>> 16 ? (externalAttrs >>> 16) & 0xffff : undefined;
		const isDir = name.endsWith('/');
		const isSymlink = unixMode !== undefined && (unixMode & S_IFMT) === S_IFLNK;
		const type = isDir ? 'directory' : isSymlink ? 'symlink' : 'file';
		const info: ArchiveEntryInfo = {
			name,
			type,
			size: isDir ? 0 : size,
			mode: unixMode,
			mtime: fromDosDateTime(dosDate, dosTime)
		};
		if (opts.filter && !opts.filter(info)) continue;
		if (isDir) {
			yield* emitEntry(info, [] as Uint8Array[]);
			continue;
		}

		// Resolve the payload start from the local header (its extra length may
		// differ from the central directory's).
		if (view.getUint32(localOffset, true) !== SIG_LOCAL) throw new ZipKitError(`Corrupt ZIP: bad local header for "${name}"`);
		const localNameLen = view.getUint16(localOffset + 26, true);
		const localExtraLen = view.getUint16(localOffset + 28, true);
		const dataStart = localOffset + 30 + localNameLen + localExtraLen;
		const stored = data.subarray(dataStart, dataStart + compSize);

		const isEnc = (flag & 0x0001) !== 0;
		if (isSymlink) {
			// Symlinks are tiny; decode fully and surface the target as linkname.
			const bytes = await zipPayload(stored, method, flag, crc, dosTime, view, extraStart, extraLen, opts, name);
			budget.add(bytes.length);
			yield { info: { ...info, linkname: utf8Decode.decode(bytes) }, chunk: EMPTY, done: true };
			continue;
		}
		if (isEnc || method === 93 || (method !== 0 && method !== 8)) {
			// One-shot fallback (encrypted / zstd / anything the engine can't stream).
			// Reject up front when the declared size already can't fit the budget —
			// best-effort, since the declared size is attacker-controlled.
			if (size > budget.remaining) throw new ZipKitError(`Entry "${name}" declares ${size} bytes, over the remaining cap`);
			const bytes = await zipPayload(stored, method, flag, crc, dosTime, view, extraStart, extraLen, opts, name);
			budget.add(bytes.length);
			yield* emitEntry(info, sliceChunks(bytes));
			continue;
		}
		// Streamable: store (0) or deflate (8), enforced against the cap live.
		const src = method === 0 ? sliceChunks(stored) : inflateRawChunks(stored);
		yield* emitEntry(info, counted(src, budget));
	}
}

/** Decrypt (if needed) and one-shot decompress a single ZIP payload. */
async function zipPayload(
	stored: Uint8Array,
	method: number,
	flag: number,
	crc: number,
	dosTime: number,
	view: DataView,
	extraStart: number,
	extraLen: number,
	opts: ExtractStreamOptions,
	name: string
): Promise<Uint8Array> {
	let effectiveMethod = method;
	let payload = stored;
	if ((flag & 0x0001) !== 0) {
		if (opts.password === undefined) throw new ZipKitError(`Entry "${name}" is encrypted — pass { password } to extractStream()`);
		if (method === 99) {
			const aes = readAesExtra(view, extraStart, extraLen);
			if (!aes) throw new ZipKitError(`Entry "${name}" is AES-encrypted but has no AES extra field`);
			payload = await aesDecrypt(stored, opts.password, aes.strength);
			effectiveMethod = aes.actualMethod;
		} else {
			const checkByte = flag & 0x0008 ? (dosTime >>> 8) & 0xff : (crc >>> 24) & 0xff;
			payload = zipCryptoDecrypt(stored, opts.password, checkByte);
		}
	}
	if (effectiveMethod === 0) return payload;
	const e = await getEngine();
	if (effectiveMethod === 8) return e.deflateDecompress(payload);
	if (effectiveMethod === 93) return e.zstdDecompress(payload);
	throw new ZipKitError(`Unsupported ZIP method ${effectiveMethod} for entry "${name}"`);
}

// ---------------------------------------------------------------------------
// tar (raw and codec-wrapped)
// ---------------------------------------------------------------------------

/** Emit the members of an already-decompressed tar buffer. */
async function* tarEntries(
	data: Uint8Array,
	opts: ExtractStreamOptions,
	budget: Budget,
	preCounted: boolean
): AsyncGenerator<ArchiveEntryChunk> {
	for (const entry of untar(data)) {
		budget.check();
		const info: ArchiveEntryInfo = {
			name: entry.name,
			type: entry.type,
			size: entry.type === 'file' ? entry.size : 0,
			mode: entry.mode,
			mtime: entry.mtime,
			linkname: entry.linkname
		};
		if (opts.filter && !opts.filter(info)) continue;
		if (entry.type !== 'file') {
			yield { info, chunk: EMPTY, done: true };
			continue;
		}
		if (!preCounted) budget.add(entry.data.length);
		yield* emitEntry(info, sliceChunks(entry.data));
	}
}

/** The engine/codec decoders keyed by outer format. */
const CODEC_DECODE: Record<'gzip' | 'zstd' | 'xz' | 'bzip2' | 'lz4-frame' | 'zlib', (d: Uint8Array) => Promise<Uint8Array>> = {
	gzip: gunzip,
	zstd: unzstd,
	xz: unxz,
	bzip2: unbzip2,
	'lz4-frame': unlz4,
	zlib: unzlib
};

/**
 * Decompress a lone codec stream, then either walk it as a tar (when `asTar`,
 * or when auto-detection finds a tar inside) or surface it as one file entry.
 * gzip decompresses incrementally against the cap; the one-shot codecs decode
 * whole then check the cap (best-effort, per the module overview).
 */
async function* codecEntries(
	data: Uint8Array,
	fmt: 'gzip' | 'zstd' | 'xz' | 'bzip2' | 'lz4-frame' | 'zlib',
	opts: ExtractStreamOptions,
	budget: Budget,
	asTar: boolean | undefined
): AsyncGenerator<ArchiveEntryChunk> {
	let decoded: Uint8Array;
	if (fmt === 'gzip' && hasNative) {
		decoded = await inflateNativeCapped('gzip', data, budget);
	} else {
		decoded = await CODEC_DECODE[fmt](data);
		budget.add(decoded.length);
	}

	const isTar = asTar ?? looksLikeTar(decoded);
	if (isTar) {
		yield* tarEntries(decoded, opts, budget, true);
		return;
	}
	const info: ArchiveEntryInfo = { name: opts.entryName ?? 'data', type: 'file', size: decoded.length };
	if (opts.filter && !opts.filter(info)) return;
	yield* emitEntry(info, sliceChunks(decoded));
}

/** True when `buf` begins with a tar `ustar` header. */
function looksLikeTar(buf: Uint8Array): boolean {
	return buf.length >= 263 && buf[257] === 0x75 && buf[258] === 0x73 && buf[259] === 0x74 && buf[260] === 0x61 && buf[261] === 0x72;
}

/** Native incremental decompress (gzip/deflate), charging the cap per chunk. */
async function inflateNativeCapped(format: 'gzip' | 'deflate-raw', data: Uint8Array, budget: Budget): Promise<Uint8Array> {
	const ds = new DecompressionStream(format);
	const writer = ds.writable.getWriter();
	const reader = ds.readable.getReader();
	const pump = writer
		.write(data as unknown as BufferSource)
		.then(() => writer.close())
		.catch(() => undefined);
	const parts: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value && value.length) {
				budget.add(value.length);
				parts.push(value);
				total += value.length;
			}
		}
	} finally {
		await reader.cancel().catch(() => undefined);
		await pump;
	}
	const out = new Uint8Array(total);
	let off = 0;
	for (const part of parts) {
		out.set(part, off);
		off += part.length;
	}
	return out;
}

// ---------------------------------------------------------------------------
// 7z
// ---------------------------------------------------------------------------

/** Emit the members of a 7z archive (one-shot decode, cap checked per entry). */
async function* sevenZipEntries(data: Uint8Array, opts: ExtractStreamOptions, budget: Budget): AsyncGenerator<ArchiveEntryChunk> {
	for (const entry of await unSevenZip(data)) {
		budget.check();
		const info: ArchiveEntryInfo = { name: entry.name, type: entry.name.endsWith('/') ? 'directory' : 'file', size: entry.size };
		if (opts.filter && !opts.filter(info)) continue;
		if (info.type === 'directory') {
			yield { info, chunk: EMPTY, done: true };
			continue;
		}
		budget.add(entry.data.length);
		yield* emitEntry(info, sliceChunks(entry.data));
	}
}
