/** Raw DEFLATE codec (RFC 1951) — libdeflate, standard-format compatible. */
import { getEngine } from '../engine.js';
import { bunRuntime, compressionMode, levelForMode, runAsync } from '../internal.js';
import type { CompressOptions, DecompressOptions } from '../types.js';

function useNativeDeflate(opts?: CompressOptions): boolean {
	return compressionMode(opts) !== 'ratio' && !!bunRuntime()?.deflateSync;
}

/** Compress to a raw DEFLATE stream. Level `0`–`9`; mode chooses the default. */
export async function deflate(data: Uint8Array, opts?: CompressOptions): Promise<Uint8Array> {
	const level = levelForMode(opts, 0, 9, { speed: 1, balanced: 6, ratio: 9 });
	const bun = bunRuntime();
	if (useNativeDeflate(opts)) {
		return runAsync(() => bun.deflateSync(data, { level }), opts, data.length);
	}
	const e = await getEngine();
	return runAsync(() => e.deflateCompress(data, level), opts, data.length);
}

/** Decompress a raw DEFLATE stream. */
export async function inflate(data: Uint8Array, opts?: DecompressOptions): Promise<Uint8Array> {
	const bun = bunRuntime();
	if (bun?.inflateSync) return runAsync(() => bun.inflateSync(data), opts, data.length);
	const e = await getEngine();
	return runAsync(() => e.deflateDecompress(data), opts, data.length);
}
