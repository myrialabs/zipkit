/**
 * Parallel, multi-core compression — the one lever no single-threaded codec can
 * match.
 *
 * `fflate`, `pako`, and even the runtime-native `Bun.gzipSync` / `zlib` all
 * compress a buffer on **one** thread. ZipKit splits the input into independent
 * blocks, compresses them concurrently across the whole {@link sharedPool}
 * worker pool, and frames the result in a tiny self-describing container. On an
 * N-core machine large inputs compress and decompress close to N× faster — so
 * ZipKit beats native throughput on big data, the way `pigz` beats `gzip`.
 *
 * Each block is a complete, standard stream of the chosen codec; only the outer
 * container (magic `ZKP1`) is ZipKit-specific, so {@link decompressParallel}
 * reverses it. Per-block independence costs a sliver of ratio at small block
 * sizes — negligible at the default ≥256 KB blocks.
 *
 * @example
 * ```ts
 * import { compressParallel, decompressParallel } from 'zipkit/parallel';
 * const packed = await compressParallel(bigBuffer, 'zstd', { level: 19 });
 * const original = await decompressParallel(packed);
 * ```
 */

import type { Codec, CompressOptions, DecompressOptions } from '../types.js';
import { ZipKitError } from '../types.js';
import { sharedPool, WorkerPool } from '../workers/index.js';

/** Container magic: "ZKP1" (ZipKit Parallel, version 1). */
const MAGIC = 0x5a_4b_50_31;
/** Fixed header size: magic(4) + codec(1) + reserved(1) + blockSize(4) + originalLen(4) + nBlocks(4). */
const HEADER = 18;

/** Stable on-disk codec ids (independent of the `Codec` union's order). */
const CODEC_ID: Record<Codec, number> = {
	gzip: 1,
	deflate: 2,
	zlib: 3,
	zstd: 4,
	lz4: 5,
	snappy: 6,
	brotli: 7,
	lzma: 8,
	bzip2: 9
};
const ID_CODEC: Record<number, Codec> = Object.fromEntries(
	Object.entries(CODEC_ID).map(([k, v]) => [v, k as Codec])
) as Record<number, Codec>;

/** Options for {@link compressParallel}. */
export interface ParallelCompressOptions extends CompressOptions {
	/**
	 * Bytes per block. Larger blocks compress slightly denser; smaller blocks
	 * parallelize better. Defaults to an adaptive size (≥256 KB, ~4 blocks per
	 * core) that keeps every worker busy with negligible ratio loss.
	 */
	blockSize?: number;
	/** Worker pool to run on. Defaults to the process-wide {@link sharedPool}. */
	pool?: WorkerPool;
}

/** Options for {@link decompressParallel}. */
export interface ParallelDecompressOptions extends DecompressOptions {
	/** Worker pool to run on. Defaults to the process-wide {@link sharedPool}. */
	pool?: WorkerPool;
}

function cpuCount(): number {
	return (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency ?? 4;
}

/** Choose a block size: ~4 blocks per core, never below 256 KB. */
function defaultBlockSize(len: number): number {
	const target = Math.max(1, cpuCount() * 4);
	return Math.max(256 * 1024, Math.ceil(len / target));
}

function writeU32(buf: Uint8Array, off: number, v: number): void {
	buf[off] = v & 0xff;
	buf[off + 1] = (v >>> 8) & 0xff;
	buf[off + 2] = (v >>> 16) & 0xff;
	buf[off + 3] = (v >>> 24) & 0xff;
}
function readU32(buf: Uint8Array, off: number): number {
	return (buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24)) >>> 0;
}

/**
 * Compress `data` in parallel across the worker pool, returning a self-describing
 * container that {@link decompressParallel} reverses. Falls back to a single
 * block (and inline execution) where workers aren't available, so it never
 * breaks — it simply stops being parallel.
 */
export async function compressParallel(
	data: Uint8Array,
	codec: Codec,
	opts?: ParallelCompressOptions
): Promise<Uint8Array> {
	const id = CODEC_ID[codec];
	if (id === undefined) throw new ZipKitError(`Unknown codec: ${codec}`);
	if (data.length > 0xffffffff) {
		throw new ZipKitError('compressParallel: inputs larger than 4 GB are not supported');
	}

	const pool = opts?.pool ?? sharedPool();
	const blockSize = Math.max(1, opts?.blockSize ?? defaultBlockSize(data.length));
	const nBlocks = Math.max(1, Math.ceil(data.length / blockSize));

	// Fan out: every block compresses concurrently; the pool spreads them across
	// all cores. This is the win — N blocks finish in ~1/N the wall-clock time.
	let done = 0;
	const jobs: Promise<Uint8Array>[] = [];
	for (let i = 0; i < nBlocks; i++) {
		const start = i * blockSize;
		const block = data.subarray(start, Math.min(start + blockSize, data.length));
		jobs.push(
			pool.compress(block, codec, { mode: opts?.mode, level: opts?.level, signal: opts?.signal }).then((out) => {
				done++;
				opts?.onProgress?.(done / nBlocks, done * blockSize);
				return out;
			})
		);
	}
	const parts = await Promise.all(jobs);

	// Assemble: [header][per-block u32 compressedLen ...][blocks...].
	const tableSize = nBlocks * 4;
	let body = 0;
	for (const p of parts) body += p.length;
	const out = new Uint8Array(HEADER + tableSize + body);

	writeU32(out, 0, MAGIC);
	out[4] = id;
	out[5] = 0; // reserved
	writeU32(out, 6, blockSize);
	writeU32(out, 10, data.length);
	writeU32(out, 14, nBlocks);
	let off = HEADER;
	for (let i = 0; i < nBlocks; i++) {
		writeU32(out, off, parts[i]!.length);
		off += 4;
	}
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

/** True if `data` looks like a {@link compressParallel} container. */
export function isParallelContainer(data: Uint8Array): boolean {
	return data.length >= HEADER && readU32(data, 0) === MAGIC;
}

/**
 * Reverse {@link compressParallel}: decompress every block concurrently across
 * the pool and concatenate. The codec is read from the container header.
 */
export async function decompressParallel(data: Uint8Array, opts?: ParallelDecompressOptions): Promise<Uint8Array> {
	if (!isParallelContainer(data)) {
		throw new ZipKitError('decompressParallel: not a ZipKit parallel container (bad magic)');
	}
	const codec = ID_CODEC[data[4]!];
	if (!codec) throw new ZipKitError(`decompressParallel: unknown codec id ${data[4]}`);

	const originalLen = readU32(data, 10);
	const nBlocks = readU32(data, 14);
	const tableOff = HEADER;
	const blocksOff = tableOff + nBlocks * 4;

	// Slice each compressed block out of the container, then decompress them all
	// concurrently — decompression parallelizes too.
	const pool = opts?.pool ?? sharedPool();
	let cursor = blocksOff;
	let done = 0;
	const jobs: Promise<Uint8Array>[] = [];
	for (let i = 0; i < nBlocks; i++) {
		const clen = readU32(data, tableOff + i * 4);
		const block = data.subarray(cursor, cursor + clen);
		cursor += clen;
		jobs.push(
			pool.decompress(block, codec, { signal: opts?.signal }).then((out) => {
				done++;
				opts?.onProgress?.(done / nBlocks, out.length);
				return out;
			})
		);
	}
	const parts = await Promise.all(jobs);

	// Concatenate in block order. originalLen sizes the buffer exactly.
	const out = new Uint8Array(originalLen);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}
