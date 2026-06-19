/** Brotli codec — brotli 1.1.0. Excellent ratio, web-standard. */
import { getEngine } from '../engine.js';
import { levelForMode, runAsync } from '../internal.js';
import type { CompressOptions, DecompressOptions } from '../types.js';

/** Compress with Brotli. Quality `0`–`11` via `level`; mode chooses the default. */
export async function brotli(data: Uint8Array, opts?: CompressOptions): Promise<Uint8Array> {
	const e = await getEngine();
	const quality = levelForMode(opts, 0, 11, { speed: 4, balanced: 6, ratio: 11 });
	return runAsync(() => e.brotliCompress(data, quality), opts, data.length);
}

/** Decompress a Brotli buffer. */
export async function unbrotli(data: Uint8Array, opts?: DecompressOptions): Promise<Uint8Array> {
	const e = await getEngine();
	return runAsync(() => e.brotliDecompress(data), opts, data.length);
}
