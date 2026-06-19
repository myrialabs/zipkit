/**
 * LZ4 codec — lz4 1.10.0, raw block format (no frame header). The fastest
 * codec in ZipKit; pair with a slower codec only when ratio matters.
 */
import { getEngine } from '../engine.js';
import { runAsync } from '../internal.js';
import type { CompressOptions, DecompressOptions } from '../types.js';

/** Compress with LZ4 (raw block). */
export async function lz4(data: Uint8Array, opts?: CompressOptions): Promise<Uint8Array> {
	const e = await getEngine();
	return runAsync(() => e.lz4Compress(data), opts, data.length);
}

/** Decompress an LZ4 raw block produced by {@link lz4}. */
export async function unlz4(data: Uint8Array, opts?: DecompressOptions): Promise<Uint8Array> {
	const e = await getEngine();
	return runAsync(() => e.lz4Decompress(data), opts, data.length);
}
