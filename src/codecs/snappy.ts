/** Snappy codec — snappy 1.2.1. Extremely fast, modest ratio. */
import { getEngine } from '../engine.js';
import { runAsync } from '../internal.js';
import type { CompressOptions, DecompressOptions } from '../types.js';

/** Compress with Snappy. */
export async function snappy(data: Uint8Array, opts?: CompressOptions): Promise<Uint8Array> {
	const e = await getEngine();
	return runAsync(() => e.snappyCompress(data), opts, data.length);
}

/** Decompress a Snappy buffer. */
export async function unsnappy(data: Uint8Array, opts?: DecompressOptions): Promise<Uint8Array> {
	const e = await getEngine();
	return runAsync(() => e.snappyDecompress(data), opts, data.length);
}
