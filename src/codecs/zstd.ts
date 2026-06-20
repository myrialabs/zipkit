/** Zstandard codec — libzstd 1.5.6, standard-format compatible. */
import { getEngine } from '../engine.js';
import { bunRuntime, levelForMode, runAsync } from '../internal.js';
import type { CompressOptions, DecompressOptions } from '../types.js';

/** Compress with Zstandard. Level `1`–`22`; mode chooses the default. */
export async function zstd(data: Uint8Array, opts?: CompressOptions): Promise<Uint8Array> {
	const level = levelForMode(opts, 1, 22, { speed: 1, balanced: 3, ratio: 19 });
	const bun = bunRuntime();
	if (bun?.zstdCompressSync) {
		return runAsync(() => bun.zstdCompressSync(data, { level }), opts, data.length);
	}
	const e = await getEngine();
	// Levels above 19 enable zstd's "ultra" mode plus long-distance matching.
	const work = level > 19 ? () => e.zstdMaxCompress(data, level) : () => e.zstdCompress(data, level);
	return runAsync(work, opts, data.length);
}

/** Decompress a Zstandard frame. */
export async function unzstd(data: Uint8Array, opts?: DecompressOptions): Promise<Uint8Array> {
	const bun = bunRuntime();
	if (bun?.zstdDecompressSync) return runAsync(() => bun.zstdDecompressSync(data), opts, data.length);
	const e = await getEngine();
	return runAsync(() => e.zstdDecompress(data), opts, data.length);
}
