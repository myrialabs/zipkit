/** gzip codec (RFC 1952) — libdeflate, standard-format compatible. */
import { getEngine } from '../engine.js';
import { bunRuntime, compressionMode, levelForMode, likelyTextOrRepetitive, runAsync } from '../internal.js';
import type { CompressOptions, DecompressOptions } from '../types.js';

function useNativeGzip(data: Uint8Array, opts?: CompressOptions): boolean {
	const mode = compressionMode(opts);
	const bun = bunRuntime();
	return mode !== 'ratio' && !!bun?.gzipSync && data.length <= 1024 * 1024 && likelyTextOrRepetitive(data);
}

/** Compress to the gzip format. Level `0`–`9`; mode chooses the default. */
export async function gzip(data: Uint8Array, opts?: CompressOptions): Promise<Uint8Array> {
	const level = levelForMode(opts, 0, 9, { speed: 1, balanced: 6, ratio: 9 });
	const bun = bunRuntime();
	if (useNativeGzip(data, opts)) {
		return runAsync(() => new Uint8Array(bun.gzipSync(data, { level })), opts, data.length);
	}
	const e = await getEngine();
	return runAsync(() => e.gzipCompress(data, level), opts, data.length);
}

/** Decompress a gzip buffer. */
export async function gunzip(data: Uint8Array, opts?: DecompressOptions): Promise<Uint8Array> {
	const bun = bunRuntime();
	if (bun?.gunzipSync) return runAsync(() => new Uint8Array(bun.gunzipSync(data)), opts, data.length);
	const e = await getEngine();
	return runAsync(() => e.gzipDecompress(data), opts, data.length);
}
