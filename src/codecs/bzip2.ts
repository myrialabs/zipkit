/** bzip2 codec — bzip2 1.0.8. Burrows–Wheeler; great on text. */
import { getEngine } from '../engine.js';
import { levelForMode, runAsync } from '../internal.js';
import type { CompressOptions, DecompressOptions } from '../types.js';

/** Compress with bzip2. Level `1`–`9`; mode chooses the default. */
export async function bzip2(data: Uint8Array, opts?: CompressOptions): Promise<Uint8Array> {
	const e = await getEngine();
	const level = levelForMode(opts, 1, 9, { speed: 1, balanced: 6, ratio: 9 });
	return runAsync(() => e.bzip2Compress(data, level), opts, data.length);
}

/** Decompress a bzip2 buffer. */
export async function unbzip2(data: Uint8Array, opts?: DecompressOptions): Promise<Uint8Array> {
	const e = await getEngine();
	return runAsync(() => e.bzip2Decompress(data), opts, data.length);
}
