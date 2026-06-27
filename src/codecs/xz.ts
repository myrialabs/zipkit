/**
 * xz codec — the standard `.xz` container (LZMA2 + CRC integrity) from the
 * 7-Zip SDK. Unlike a hand-rolled LZMA2 chunker, this is the SDK's full
 * streaming encoder/decoder, so it interoperates with the `xz` CLI and the
 * `.tar.xz` tarballs found in the wild.
 */
import { getEngine } from '../engine.js';
import { levelForMode, runAsync } from '../internal.js';
import { ZipKitError } from '../types.js';
import type { CompressOptions, DecompressOptions } from '../types.js';

/** Compress to a standard `.xz` stream. Level `0`–`9`; mode chooses the default. */
export async function xz(data: Uint8Array, opts?: CompressOptions): Promise<Uint8Array> {
	const e = await getEngine();
	const level = levelForMode(opts, 0, 9, { speed: 1, balanced: 6, ratio: 9 });
	return runAsync(() => wrap(() => e.xzCompress(data, level)), opts, data.length);
}

/** Decompress a standard `.xz` stream produced by ZipKit, the `xz` CLI, or 7-Zip. */
export async function unxz(data: Uint8Array, opts?: DecompressOptions): Promise<Uint8Array> {
	const e = await getEngine();
	return runAsync(() => wrap(() => e.xzDecompress(data)), opts, data.length);
}

/** Surface engine failures as the library's {@link ZipKitError}. */
function wrap(fn: () => Uint8Array): Uint8Array {
	try {
		return fn();
	} catch (err) {
		throw new ZipKitError(err instanceof Error ? err.message : 'xz operation failed');
	}
}
