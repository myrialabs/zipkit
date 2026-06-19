/**
 * ZIP container — create and read multi-file archives.
 *
 * Interoperates with standard tools (`unzip`, Explorer, fflate): `store` and
 * `deflate` entries round-trip everywhere. ZipKit additionally supports `zstd`
 * (method 93) inside the container for much denser archives between ZipKit-aware
 * peers. Entry metadata (modification time, Unix permissions, comment) is
 * preserved both ways, and archives over 4 GB / 65 535 entries transparently
 * use ZIP64.
 *
 * Everything is in-memory and async (the codecs are Wasm). Reading supports a
 * `filter` so you only pay to decompress the entries you want.
 *
 * @example
 * ```ts
 * import { zip, unzip } from 'zipkit/zip';
 * const archive = await zip([
 *   { name: 'hello.txt', data: strToU8('hi') },
 *   { name: 'data.json', data: bytes, method: 'zstd' }
 * ]);
 * const files = await unzip(archive, { filter: (e) => e.name.endsWith('.json') });
 * ```
 */

import { getEngine } from '../engine.js';
import { ZipKitError } from '../types.js';
import { sharedPool } from '../workers/index.js';
import { toDosDateTime, fromDosDateTime } from './datetime.js';

/** Compress entries concurrently once an archive is at least this large. */
const PARALLEL_MIN_BYTES = 256 * 1024;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOC = 0x07064b50;
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

/** Built-in ZIP compression methods, by friendly name. */
export type ZipMethod = 'store' | 'deflate' | 'zstd';

const METHOD_CODE: Record<ZipMethod, number> = { store: 0, deflate: 8, zstd: 93 };

/** An entry to add to an archive. */
export interface ZipEntryInput {
	/** Path within the archive, using `/` separators. */
	name: string;
	/** Uncompressed contents. */
	data: Uint8Array;
	/** Compression method (default `'deflate'`). */
	method?: ZipMethod;
	/** DEFLATE/zstd level. */
	level?: number;
	/** Last-modified time (default: now). */
	mtime?: Date | number;
	/** Unix permission bits, e.g. `0o644`. Stored in the external attributes. */
	unixPermissions?: number;
	/** Optional per-entry comment. */
	comment?: string;
}

/** A decoded archive entry. */
export interface ZipEntry {
	/** Path within the archive. */
	name: string;
	/** Decompressed contents (omitted when a `filter` rejected the entry). */
	data: Uint8Array;
	/** Numeric compression method as stored (0 = store, 8 = deflate, 93 = zstd). */
	method: number;
	/** Last-modified time. */
	mtime: Date;
	/** Uncompressed size in bytes. */
	size: number;
	/** Compressed size in bytes. */
	compressedSize: number;
	/** Stored CRC-32 of the uncompressed data. */
	crc32: number;
	/** Unix permission bits, if the archive recorded any. */
	unixPermissions?: number;
	/** Per-entry comment, if present. */
	comment?: string;
}

/** Metadata for an entry, passed to a read `filter` before decompression. */
export interface ZipEntryInfo {
	name: string;
	method: number;
	size: number;
	compressedSize: number;
	mtime: Date;
	unixPermissions?: number;
}

/** Options for {@link unzip}. */
export interface UnzipOptions {
	/** Decompress only the entries for which this returns `true`. */
	filter?: (entry: ZipEntryInfo) => boolean;
}

/** Options for {@link zip}. */
export interface ZipOptions {
	/**
	 * Compress entries concurrently across the worker pool. Independent entries
	 * fan out over every core while the container is assembled in order, so the
	 * output is byte-identical to the single-threaded path.
	 *
	 * Defaults to automatic: on when there are at least two entries and the
	 * archive totals at least 256 KB, off otherwise (the worker hand-off would
	 * cost more than it saves on tiny archives). Set explicitly to override.
	 */
	parallel?: boolean;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** A growable little-endian byte writer. */
class Writer {
	private buf = new Uint8Array(1024);
	private view = new DataView(this.buf.buffer);
	len = 0;

	private grow(extra: number): void {
		if (this.len + extra <= this.buf.length) return;
		let cap = this.buf.length * 2;
		while (cap < this.len + extra) cap *= 2;
		const next = new Uint8Array(cap);
		next.set(this.buf.subarray(0, this.len));
		this.buf = next;
		this.view = new DataView(this.buf.buffer);
	}

	u16(v: number): void {
		this.grow(2);
		this.view.setUint16(this.len, v, true);
		this.len += 2;
	}
	u32(v: number): void {
		this.grow(4);
		this.view.setUint32(this.len, v >>> 0, true);
		this.len += 4;
	}
	u64(v: number): void {
		this.grow(8);
		this.view.setBigUint64(this.len, BigInt(v), true);
		this.len += 8;
	}
	bytes(b: Uint8Array): void {
		this.grow(b.length);
		this.buf.set(b, this.len);
		this.len += b.length;
	}
	done(): Uint8Array {
		return this.buf.slice(0, this.len);
	}
}

async function compressEntry(data: Uint8Array, method: ZipMethod, level?: number): Promise<Uint8Array> {
	if (method === 'store') return data;
	const e = await getEngine();
	if (method === 'deflate') return e.deflateCompress(data, level ?? 6);
	if (method === 'zstd') return e.zstdCompress(data, level ?? 19);
	throw new ZipKitError(`Unsupported ZIP method: ${method}`);
}

const utf8 = new TextEncoder();

/**
 * Build a ZIP archive from a list of entries. Returns the complete archive
 * bytes. Uses ZIP64 automatically when any size/offset exceeds 4 GB or there
 * are more than 65 535 entries.
 */
export async function zip(entries: ZipEntryInput[], opts: ZipOptions = {}): Promise<Uint8Array> {
	const e = await getEngine();

	// Prepare every entry up front: CRC-32 (libdeflate's SIMD path, on the main
	// thread) plus the compressed payload. For larger archives the per-entry
	// compression fans out across the worker pool — independent blocks, one per
	// core — while the container below is still assembled strictly in order, so
	// the bytes are identical to the single-threaded path.
	const totalBytes = entries.reduce((n, x) => n + x.data.length, 0);
	const useParallel = opts.parallel ?? (entries.length >= 2 && totalBytes >= PARALLEL_MIN_BYTES);
	const pool = useParallel ? sharedPool() : undefined;

	const crcs = entries.map((entry) => e.crc32(entry.data));
	const compressedList = await Promise.all(
		entries.map((entry) => {
			const method = entry.method ?? 'deflate';
			if (method === 'store') return Promise.resolve(entry.data);
			if (pool) {
				const level = entry.level ?? (method === 'zstd' ? 19 : 6);
				return pool.zipCompress(entry.data, method, level);
			}
			return compressEntry(entry.data, method, entry.level);
		})
	);

	const out = new Writer();
	const central: Array<{
		nameBytes: Uint8Array;
		commentBytes: Uint8Array;
		method: number;
		crc: number;
		compSize: number;
		size: number;
		dosDate: number;
		dosTime: number;
		offset: number;
		externalAttrs: number;
		zip64: boolean;
	}> = [];

	let needZip64 = entries.length > U16_MAX;

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i]!;
		const method = entry.method ?? 'deflate';
		const methodCode = METHOD_CODE[method];
		const nameBytes = utf8.encode(entry.name);
		const commentBytes = entry.comment ? utf8.encode(entry.comment) : new Uint8Array(0);
		const crc = crcs[i]!;
		const compressed = compressedList[i]!;
		const size = entry.data.length;
		const compSize = compressed.length;
		const mtime = entry.mtime === undefined ? new Date() : new Date(entry.mtime);
		const { date: dosDate, time: dosTime } = toDosDateTime(mtime);
		// Unix mode goes in the high 16 bits of the external attributes.
		const externalAttrs = entry.unixPermissions !== undefined ? (entry.unixPermissions & 0xffff) << 16 : 0;
		const offset = out.len;
		const entryZip64 = needZip64 || size > U32_MAX || compSize > U32_MAX || offset > U32_MAX;
		if (entryZip64) needZip64 = true;

		// --- Local file header ---
		out.u32(SIG_LOCAL);
		out.u16(entryZip64 ? 45 : 20); // version needed
		out.u16(0x0800); // general purpose flag: UTF-8 names
		out.u16(methodCode);
		out.u16(dosTime);
		out.u16(dosDate);
		out.u32(crc);
		out.u32(entryZip64 ? U32_MAX : compSize);
		out.u32(entryZip64 ? U32_MAX : size);
		out.u16(nameBytes.length);
		out.u16(entryZip64 ? 20 : 0); // extra length (ZIP64 = 4 header + 16 data)
		out.bytes(nameBytes);
		if (entryZip64) {
			out.u16(0x0001);
			out.u16(16);
			out.u64(size);
			out.u64(compSize);
		}
		out.bytes(compressed);

		central.push({
			nameBytes,
			commentBytes,
			method: methodCode,
			crc,
			compSize,
			size,
			dosDate,
			dosTime,
			offset,
			externalAttrs,
			zip64: entryZip64
		});
	}

	// --- Central directory ---
	const cdStart = out.len;
	for (const c of central) {
		out.u32(SIG_CENTRAL);
		out.u16(c.zip64 ? 45 : 20); // version made by
		out.u16(c.zip64 ? 45 : 20); // version needed
		out.u16(0x0800); // UTF-8 names
		out.u16(c.method);
		out.u16(c.dosTime);
		out.u16(c.dosDate);
		out.u32(c.crc);
		const useZip64 = c.zip64;
		out.u32(useZip64 ? U32_MAX : c.compSize);
		out.u32(useZip64 ? U32_MAX : c.size);
		out.u16(c.nameBytes.length);
		// ZIP64 extra holds whichever 64-bit fields we masked out above.
		const zip64Extra: number[] = [];
		if (useZip64) {
			zip64Extra.push(c.size, c.compSize, c.offset);
		}
		out.u16(useZip64 ? 4 + zip64Extra.length * 8 : 0); // extra length
		out.u16(c.commentBytes.length);
		out.u16(0); // disk number start
		out.u16(0); // internal attributes
		out.u32(c.externalAttrs);
		out.u32(useZip64 ? U32_MAX : c.offset);
		out.bytes(c.nameBytes);
		if (useZip64) {
			out.u16(0x0001);
			out.u16(zip64Extra.length * 8);
			for (const v of zip64Extra) out.u64(v);
		}
		out.bytes(c.commentBytes);
	}
	const cdSize = out.len - cdStart;
	const count = central.length;

	// --- ZIP64 end-of-central-directory (when needed) ---
	if (needZip64 || count > U16_MAX || cdSize > U32_MAX || cdStart > U32_MAX) {
		const eocd64Offset = out.len;
		out.u32(SIG_EOCD64);
		out.u64(44); // size of remaining EOCD64 record
		out.u16(45); // version made by
		out.u16(45); // version needed
		out.u32(0); // this disk
		out.u32(0); // disk with CD start
		out.u64(count);
		out.u64(count);
		out.u64(cdSize);
		out.u64(cdStart);
		// ZIP64 EOCD locator
		out.u32(SIG_EOCD64_LOC);
		out.u32(0); // disk with EOCD64
		out.u64(eocd64Offset);
		out.u32(1); // total disks
	}

	// --- End of central directory ---
	out.u32(SIG_EOCD);
	out.u16(0); // this disk
	out.u16(0); // disk with CD start
	out.u16(count > U16_MAX ? U16_MAX : count);
	out.u16(count > U16_MAX ? U16_MAX : count);
	out.u32(cdSize > U32_MAX ? U32_MAX : cdSize);
	out.u32(cdStart > U32_MAX ? U32_MAX : cdStart);
	out.u16(0); // comment length

	return out.done();
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

async function decompressEntry(data: Uint8Array, method: number, size: number): Promise<Uint8Array> {
	if (method === 0) return data;
	const e = await getEngine();
	if (method === 8) return e.deflateDecompress(data);
	if (method === 93) return e.zstdDecompress(data);
	throw new ZipKitError(`Unsupported ZIP method ${method} for entry of ${size} bytes`);
}

/** Locate the End-Of-Central-Directory record, scanning back from the tail. */
function findEocd(view: DataView, data: Uint8Array): number {
	// EOCD is 22 bytes + up to 65 535 bytes of comment.
	const min = Math.max(0, data.length - (22 + U16_MAX));
	for (let i = data.length - 22; i >= min; i--) {
		if (view.getUint32(i, true) === SIG_EOCD) return i;
	}
	throw new ZipKitError('Not a ZIP archive: end-of-central-directory record not found');
}

/** Read a ZIP64 extra field, returning any 64-bit overrides it carries. */
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
			if (need.offset) {
				result.offset = Number(view.getBigUint64(q, true));
				q += 8;
			}
			return result;
		}
		p += 4 + len;
	}
	return result;
}

const utf8Decode = new TextDecoder('utf-8');

/**
 * Read a ZIP archive. Returns one {@link ZipEntry} per file. Pass
 * `opts.filter` to skip decompressing entries you don't need — rejected
 * entries are omitted from the result.
 */
export async function unzip(data: Uint8Array, opts: UnzipOptions = {}): Promise<ZipEntry[]> {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const eocd = findEocd(view, data);

	let count = view.getUint16(eocd + 10, true);
	let cdOffset = view.getUint32(eocd + 16, true);

	// Follow the ZIP64 locator if the classic EOCD fields are saturated.
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

	const entries: ZipEntry[] = [];
	let p = cdOffset;
	for (let i = 0; i < count; i++) {
		if (view.getUint32(p, true) !== SIG_CENTRAL) {
			throw new ZipKitError('Corrupt ZIP: bad central directory signature');
		}
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

		const commentStart = extraStart + extraLen;
		const comment =
			commentLen > 0 ? utf8Decode.decode(data.subarray(commentStart, commentStart + commentLen)) : undefined;
		const unixPermissions = externalAttrs >>> 16 ? (externalAttrs >>> 16) & 0xffff : undefined;
		const mtime = fromDosDateTime(dosDate, dosTime);

		p = commentStart + commentLen;

		const info: ZipEntryInfo = { name, method, size, compressedSize: compSize, mtime, unixPermissions };
		if (opts.filter && !opts.filter(info)) continue;

		// Jump to the local header to find the actual data start (its extra
		// field length may differ from the central directory's).
		if (view.getUint32(localOffset, true) !== SIG_LOCAL) {
			throw new ZipKitError(`Corrupt ZIP: bad local header for "${name}"`);
		}
		const localNameLen = view.getUint16(localOffset + 26, true);
		const localExtraLen = view.getUint16(localOffset + 28, true);
		const dataStart = localOffset + 30 + localNameLen + localExtraLen;
		const compressed = data.subarray(dataStart, dataStart + compSize);
		const decompressed = await decompressEntry(compressed, method, size);

		entries.push({
			name,
			data: decompressed,
			method,
			mtime,
			size,
			compressedSize: compSize,
			crc32: crc,
			unixPermissions,
			comment
		});
	}

	return entries;
}

/**
 * List the entries in an archive without decompressing them. Cheaper than
 * {@link unzip} when you only need names, sizes, and metadata.
 */
export async function listEntries(data: Uint8Array): Promise<ZipEntryInfo[]> {
	const infos: ZipEntryInfo[] = [];
	await unzip(data, {
		filter: (info) => {
			infos.push(info);
			return false;
		}
	});
	return infos;
}
