/**
 * Explicit integrity helpers.
 *
 * The codecs already validate their own framed checksums on decode (gzip's
 * CRC-32, zstd's optional content checksum), and {@link import('./zip/index.js').unzip}
 * takes a `verify` option to re-check every entry. This module exposes the raw
 * CRC-32 so callers can verify or fingerprint arbitrary bytes themselves — the
 * same libdeflate SIMD routine the ZIP container uses, not a byte-at-a-time
 * table.
 */

import { getEngine } from './engine.js';

/**
 * CRC-32 (IEEE 802.3) of `data`. Pass a prior result as `seed` to continue a
 * running checksum across chunks. Returned as an unsigned 32-bit integer.
 *
 * @example
 * ```ts
 * import { crc32 } from '@myrialabs/zipkit';
 * const sum = await crc32(bytes);
 * const running = await crc32(part2, await crc32(part1));
 * ```
 */
export async function crc32(data: Uint8Array, seed = 0): Promise<number> {
	const e = await getEngine();
	return e.crc32(data, seed) >>> 0;
}

/**
 * Verify `data` against an expected CRC-32, returning `true` on a match. A thin
 * convenience over {@link crc32} for the common "does this match what I stored"
 * check.
 */
export async function verifyChecksum(data: Uint8Array, expected: number): Promise<boolean> {
	return (await crc32(data)) === (expected >>> 0);
}
