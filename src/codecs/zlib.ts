/** zlib codec (RFC 1950) — libdeflate, standard-format compatible. */
import { getEngine } from '../engine.js';
import { levelForMode, runAsync } from '../internal.js';
import type { CompressOptions, DecompressOptions } from '../types.js';

/** Compress to the zlib format. Level `0`–`9`; mode chooses the default. */
export async function zlib(data: Uint8Array, opts?: CompressOptions): Promise<Uint8Array> {
	const e = await getEngine();
	const level = levelForMode(opts, 0, 9, { speed: 1, balanced: 6, ratio: 9 });
	return runAsync(() => e.zlibCompress(data, level), opts, data.length);
}

/** Decompress a zlib buffer. */
export async function unzlib(data: Uint8Array, opts?: DecompressOptions): Promise<Uint8Array> {
	const e = await getEngine();
	return runAsync(() => e.zlibDecompress(data), opts, data.length);
}
