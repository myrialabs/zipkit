/**
 * "Smallest possible" packing.
 *
 * `pack()` tries the densest codecs (brotli, lzma, bzip2, zstd-ultra) and keeps
 * the smallest result, tagged with a one-byte codec id so `unpack()` can
 * reverse it without being told which codec won. Use it when output size
 * matters more than compression time and both ends are ZipKit.
 *
 * The async {@link pack}/{@link unpack} helpers lazily load the shared engine;
 * the synchronous {@link packSync}/{@link unpackSync} take an already-loaded
 * engine and back {@link import('./zipkit.js').ZipKit.pack}.
 */

import { getEngine, type ZipKitEngine } from './engine.js';
import { ZipKitError } from './types.js';

const PACK_BROTLI = 0;
const PACK_LZMA = 1;
const PACK_BZIP2 = 2;
const PACK_ZSTD = 3;

/** Codec name for each pack tag, indexed by the leading tag byte. */
export const PACK_CODECS = ['brotli', 'lzma', 'bzip2', 'zstd'] as const;

/** Pack with an already-loaded engine. */
export function packSync(engine: ZipKitEngine, data: Uint8Array): Uint8Array {
	const candidates: [number, Uint8Array][] = [
		[PACK_BROTLI, engine.brotliCompress(data, 11)],
		[PACK_LZMA, engine.lzmaCompress(data, 9)],
		[PACK_BZIP2, engine.bzip2Compress(data, 9)],
		[PACK_ZSTD, engine.zstdMaxCompress(data, 22)]
	];
	let best = candidates[0]!;
	for (const c of candidates) if (c[1].length < best[1].length) best = c;
	const out = new Uint8Array(best[1].length + 1);
	out[0] = best[0];
	out.set(best[1], 1);
	return out;
}

/** Reverse {@link packSync} with an already-loaded engine. */
export function unpackSync(engine: ZipKitEngine, data: Uint8Array): Uint8Array {
	const tag = data[0];
	const body = data.subarray(1);
	switch (tag) {
		case PACK_BROTLI:
			return engine.brotliDecompress(body);
		case PACK_LZMA:
			return engine.lzmaDecompress(body);
		case PACK_BZIP2:
			return engine.bzip2Decompress(body);
		case PACK_ZSTD:
			return engine.zstdDecompress(body);
		default:
			throw new ZipKitError(`unpack: unknown codec tag ${tag}`);
	}
}

/**
 * Compress to the smallest output across brotli/lzma/bzip2/zstd-ultra, tagged so
 * {@link unpack} can reverse it. Async; lazily loads the shared engine. For the
 * synchronous form load an engine once via `ZipKit.load()` and call
 * {@link import('./zipkit.js').ZipKit.pack}.
 *
 * @example
 * ```ts
 * import { pack, unpack } from 'zipkit';
 * const small = await pack(bytes);
 * const orig = await unpack(small);
 * ```
 */
export async function pack(data: Uint8Array): Promise<Uint8Array> {
	return packSync(await getEngine(), data);
}

/** Reverse {@link pack}. Async; lazily loads the shared engine. */
export async function unpack(data: Uint8Array): Promise<Uint8Array> {
	return unpackSync(await getEngine(), data);
}
