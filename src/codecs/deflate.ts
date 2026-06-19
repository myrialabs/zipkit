/** Raw DEFLATE codec (RFC 1951) — libdeflate, standard-format compatible. */
import { getEngine } from '../engine.js';
import { bunRuntime, compressionMode, levelForMode, likelyTextOrRepetitive, runAsync } from '../internal.js';
import type { CompressOptions, DecompressOptions } from '../types.js';

function useNativeDeflate(data: Uint8Array, opts?: CompressOptions): boolean {
	const mode = compressionMode(opts);
	const bun = bunRuntime();
	return mode !== 'ratio' && !!bun?.deflateSync && data.length <= 1024 * 1024 && likelyTextOrRepetitive(data);
}

/** Compress to a raw DEFLATE stream. Level `0`–`9`; mode chooses the default. */
export async function deflate(data: Uint8Array, opts?: CompressOptions): Promise<Uint8Array> {
	const level = levelForMode(opts, 0, 9, { speed: 1, balanced: 6, ratio: 9 });
	const bun = bunRuntime();
	if (useNativeDeflate(data, opts)) {
		return runAsync(() => new Uint8Array(bun.deflateSync(data, { level })), opts, data.length);
	}
	const e = await getEngine();
	return runAsync(() => e.deflateCompress(data, level), opts, data.length);
}

/** Decompress a raw DEFLATE stream. */
export async function inflate(data: Uint8Array, opts?: DecompressOptions): Promise<Uint8Array> {
	const bun = bunRuntime();
	if (bun?.inflateSync) return runAsync(() => new Uint8Array(bun.inflateSync(data)), opts, data.length);
	const e = await getEngine();
	return runAsync(() => e.deflateDecompress(data), opts, data.length);
}
