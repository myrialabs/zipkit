/**
 * Streaming ZIP writer — build an archive incrementally without ever holding
 * the whole thing in memory.
 *
 * {@link zipStream} consumes entries one at a time (from a sync or async
 * iterable) and emits archive bytes through a web-standard
 * `ReadableStream<Uint8Array>` you can pipe straight to a file, an HTTP
 * response, or `FileSystemWritableFileStream`. Peak memory is bounded by the
 * single largest entry, not the archive total — so hundreds-of-MB / multi-GB
 * archives never OOM in Node, Bun, or the browser.
 *
 * Each entry is compressed as one buffer (the engine is one-shot), so its
 * CRC-32 and sizes are known before its local header is written — the output is
 * byte-compatible with {@link import('./index.js').zip}, ZIP64 and all, and
 * reads back with {@link import('./index.js').unzip} or any standard tool.
 *
 * @example
 * ```ts
 * import { zipStream } from '@myrialabs/zipkit';
 * const stream = zipStream(async function* () {
 *   for await (const file of files) yield { name: file.name, data: await file.bytes() };
 * }());
 * await stream.pipeTo(destinationWritable);
 * ```
 */

import { getEngine } from '../engine.js';
import { ZipKitError } from '../types.js';
import { toDosDateTime } from './datetime.js';
import type { ZipEntryInput, ZipMethod } from './index.js';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOC = 0x07064b50;
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;
const METHOD_CODE: Record<ZipMethod, number> = { store: 0, deflate: 8, zstd: 93 };

const utf8 = new TextEncoder();

/** Options for {@link zipStream}. */
export interface ZipStreamOptions {
	/** Invoked after each entry is written, with the running entry/byte counts. */
	onProgress?: (entriesWritten: number, bytesWritten: number) => void;
}

/** A growable little-endian byte writer that yields a standalone buffer. */
class Chunk {
	private buf = new Uint8Array(64);
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
	u16(v: number): this {
		this.grow(2);
		this.view.setUint16(this.len, v, true);
		this.len += 2;
		return this;
	}
	u32(v: number): this {
		this.grow(4);
		this.view.setUint32(this.len, v >>> 0, true);
		this.len += 4;
		return this;
	}
	u64(v: number): this {
		this.grow(8);
		this.view.setBigUint64(this.len, BigInt(v), true);
		this.len += 8;
		return this;
	}
	bytes(b: Uint8Array): this {
		this.grow(b.length);
		this.buf.set(b, this.len);
		this.len += b.length;
		return this;
	}
	take(): Uint8Array {
		return this.buf.subarray(0, this.len);
	}
}

interface CentralRecord {
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
}

async function compressFor(data: Uint8Array, method: ZipMethod, level: number | undefined): Promise<Uint8Array> {
	if (method === 'store') return data;
	const e = await getEngine();
	if (method === 'deflate') return e.deflateCompress(data, level ?? 6);
	if (method === 'zstd') return e.zstdCompress(data, level ?? 19);
	throw new ZipKitError(`Unsupported ZIP method: ${method}`);
}

/**
 * Stream a ZIP archive built from `entries` (a sync or async iterable). Returns
 * a `ReadableStream<Uint8Array>` of the archive bytes. Uses ZIP64 automatically
 * for entries/offsets past 4 GB or more than 65 535 entries.
 */
export function zipStream(
	entries: Iterable<ZipEntryInput> | AsyncIterable<ZipEntryInput>,
	opts: ZipStreamOptions = {}
): ReadableStream<Uint8Array> {
	const iterator =
		Symbol.asyncIterator in entries
			? (entries as AsyncIterable<ZipEntryInput>)[Symbol.asyncIterator]()
			: (entries as Iterable<ZipEntryInput>)[Symbol.iterator]();

	const central: CentralRecord[] = [];
	let offset = 0;
	let needZip64 = false;
	let bytesWritten = 0;
	let finished = false;

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const next = await iterator.next();
				if (!next.done) {
					const chunk = await writeEntry(next.value);
					controller.enqueue(chunk);
					opts.onProgress?.(central.length, bytesWritten);
					return;
				}
				if (!finished) {
					finished = true;
					controller.enqueue(writeTrailer());
					controller.close();
				}
			} catch (err) {
				controller.error(err);
			}
		}
	});

	async function writeEntry(entry: ZipEntryInput): Promise<Uint8Array> {
		const e = await getEngine();
		const method = entry.method ?? 'deflate';
		const methodCode = METHOD_CODE[method];
		if (methodCode === undefined) throw new ZipKitError(`Unsupported ZIP method: ${method}`);
		const nameBytes = utf8.encode(entry.name);
		const commentBytes = entry.comment ? utf8.encode(entry.comment) : new Uint8Array(0);
		const data = entry.data;
		const crc = e.crc32(data);
		const compressed = await compressFor(data, method, entry.level);
		const size = data.length;
		const compSize = compressed.length;
		const mtime = entry.mtime === undefined ? new Date(0) : new Date(entry.mtime);
		const { date: dosDate, time: dosTime } = toDosDateTime(mtime);
		const externalAttrs = entry.unixPermissions !== undefined ? (entry.unixPermissions & 0xffff) << 16 : 0;
		const entryZip64 = needZip64 || size > U32_MAX || compSize > U32_MAX || offset > U32_MAX;
		if (entryZip64) needZip64 = true;

		const c = new Chunk();
		c.u32(SIG_LOCAL)
			.u16(entryZip64 ? 45 : 20)
			.u16(0x0800)
			.u16(methodCode)
			.u16(dosTime)
			.u16(dosDate)
			.u32(crc)
			.u32(entryZip64 ? U32_MAX : compSize)
			.u32(entryZip64 ? U32_MAX : size)
			.u16(nameBytes.length)
			.u16(entryZip64 ? 20 : 0)
			.bytes(nameBytes);
		if (entryZip64) c.u16(0x0001).u16(16).u64(size).u64(compSize);
		c.bytes(compressed);

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
		offset += c.len;
		bytesWritten += c.len;
		// Copy out of the growable buffer so the queued chunk is independent.
		return c.take().slice();
	}

	function writeTrailer(): Uint8Array {
		const out = new Chunk();
		const cdStart = offset;
		for (const c of central) {
			out.u32(SIG_CENTRAL)
				.u16(c.zip64 ? 45 : 20)
				.u16(c.zip64 ? 45 : 20)
				.u16(0x0800)
				.u16(c.method)
				.u16(c.dosTime)
				.u16(c.dosDate)
				.u32(c.crc)
				.u32(c.zip64 ? U32_MAX : c.compSize)
				.u32(c.zip64 ? U32_MAX : c.size)
				.u16(c.nameBytes.length);
			const zip64Extra: number[] = c.zip64 ? [c.size, c.compSize, c.offset] : [];
			out.u16(c.zip64 ? 4 + zip64Extra.length * 8 : 0)
				.u16(c.commentBytes.length)
				.u16(0)
				.u16(0)
				.u32(c.externalAttrs)
				.u32(c.zip64 ? U32_MAX : c.offset)
				.bytes(c.nameBytes);
			if (c.zip64) {
				out.u16(0x0001).u16(zip64Extra.length * 8);
				for (const v of zip64Extra) out.u64(v);
			}
			out.bytes(c.commentBytes);
		}
		const cdSize = out.len;
		const count = central.length;

		if (needZip64 || count > U16_MAX || cdSize > U32_MAX || cdStart > U32_MAX) {
			const eocd64Offset = cdStart + cdSize;
			out.u32(SIG_EOCD64)
				.u64(44)
				.u16(45)
				.u16(45)
				.u32(0)
				.u32(0)
				.u64(count)
				.u64(count)
				.u64(cdSize)
				.u64(cdStart)
				.u32(SIG_EOCD64_LOC)
				.u32(0)
				.u64(eocd64Offset)
				.u32(1);
		}

		out.u32(SIG_EOCD)
			.u16(0)
			.u16(0)
			.u16(count > U16_MAX ? U16_MAX : count)
			.u16(count > U16_MAX ? U16_MAX : count)
			.u32(cdSize > U32_MAX ? U32_MAX : cdSize)
			.u32(cdStart > U32_MAX ? U32_MAX : cdStart)
			.u16(0);
		return out.take().slice();
	}
}
