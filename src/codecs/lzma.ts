/** LZMA codec — 7-Zip SDK. Highest general-purpose ratio, slowest. */
import { getEngine } from '../engine.js';
import { levelForMode, runAsync } from '../internal.js';
import type { CompressOptions, DecompressOptions } from '../types.js';

/** Compress with LZMA. Level `0`–`9`; mode chooses the default. */
export async function lzma(data: Uint8Array, opts?: CompressOptions): Promise<Uint8Array> {
	const e = await getEngine();
	const level = levelForMode(opts, 0, 9, { speed: 3, balanced: 6, ratio: 9 });
	return runAsync(() => e.lzmaCompress(data, level), opts, data.length);
}

/** Decompress an LZMA buffer produced by {@link lzma}. */
export async function unlzma(data: Uint8Array, opts?: DecompressOptions): Promise<Uint8Array> {
	const e = await getEngine();
	return runAsync(() => e.lzmaDecompress(data), opts, data.length);
}
