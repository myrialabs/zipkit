/**
 * Format auto-detection from magic bytes.
 *
 * Recognizes the container/codec of a buffer by inspecting its header. Two
 * groups are reported:
 *
 * - **Directly decompressible** by {@link import('./compress.js').decompress}:
 *   gzip, zlib, zstd.
 * - **Recognized but not auto-decoded here** — ZIP and the standard external
 *   framings (tar, xz, 7z, standard bzip2, the LZ4 *frame*). These need a
 *   dedicated reader (`zipkit/zip`, `zipkit/tar`, …) or an explicit codec, so
 *   {@link import('./compress.js').decompress} points you at the right API
 *   rather than guessing.
 *
 * ZipKit's own brotli, snappy, raw LZ4 *block*, and length-prefixed lzma/bzip2
 * streams have no leading magic and return `undefined`; decode them with an
 * explicit codec via `decompressWith`.
 */

/**
 * A format ZipKit can recognize from its header bytes. Only formats with a
 * reliable leading signature are detectable; everything else needs an explicit
 * codec via `decompressWith`.
 */
export type DetectedFormat = 'gzip' | 'zlib' | 'zstd' | 'zip' | 'tar' | 'xz' | '7z' | 'bzip2' | 'lz4-frame';

/** Formats {@link import('./compress.js').decompress} can decode directly. */
const DIRECT: ReadonlySet<DetectedFormat> = new Set<DetectedFormat>(['gzip', 'zlib', 'zstd']);

/** Whether {@link decompress} can reverse a detected format without extra API. */
export function isDirectlyDecompressible(fmt: DetectedFormat): boolean {
	return DIRECT.has(fmt);
}

/**
 * Identify the format of a buffer, or `undefined` if it has no recognizable
 * signature.
 *
 * Detectable: **gzip, zlib, zstd, ZIP, tar, xz, 7z, standard bzip2, and the LZ4
 * frame**. Headerless or ZipKit-framed codecs — brotli, snappy, the raw LZ4
 * *block* written by {@link import('./codecs/lz4.js').lz4}, and the
 * length-prefixed lzma/bzip2 streams ZipKit emits — have no leading magic and
 * return `undefined`; decode them with an explicit codec via `decompressWith`.
 *
 * @example
 * ```ts
 * detectFormat(gzipBytes);   // 'gzip'
 * detectFormat(zipBytes);    // 'zip'
 * detectFormat(tarBytes);    // 'tar'
 * detectFormat(brotliBytes); // undefined
 * ```
 */
export function detectFormat(data: Uint8Array): DetectedFormat | undefined {
	if (data.length < 2) return undefined;
	const b0 = data[0]!;
	const b1 = data[1]!;

	// gzip — 1f 8b
	if (b0 === 0x1f && b1 === 0x8b) return 'gzip';

	// ZIP — "PK\x03\x04" (local file header) or "PK\x05\x06" (empty archive EOCD)
	if (b0 === 0x50 && b1 === 0x4b && (data[2] === 0x03 || data[2] === 0x05)) {
		return 'zip';
	}

	// zstd — little-endian magic 0xFD2FB528
	if (b0 === 0x28 && b1 === 0xb5 && data[2] === 0x2f && data[3] === 0xfd) return 'zstd';

	// xz — FD "7zXZ" 00
	if (b0 === 0xfd && b1 === 0x37 && data[2] === 0x7a && data[3] === 0x58 && data[4] === 0x5a && data[5] === 0x00) {
		return 'xz';
	}

	// 7z — "7z" BC AF 27 1C
	if (b0 === 0x37 && b1 === 0x7a && data[2] === 0xbc && data[3] === 0xaf && data[4] === 0x27 && data[5] === 0x1c) {
		return '7z';
	}

	// LZ4 frame — 04 22 4D 18 (the standard frame, not ZipKit's raw block)
	if (b0 === 0x04 && b1 === 0x22 && data[2] === 0x4d && data[3] === 0x18) return 'lz4-frame';

	// Standard bzip2 — "BZh" then a 1–9 block-size digit. ZipKit's own bzip2()
	// emits a length-prefixed frame, not this, so its output won't match here.
	if (b0 === 0x42 && b1 === 0x5a && data[2] === 0x68 && data[3]! >= 0x31 && data[3]! <= 0x39) {
		return 'bzip2';
	}

	// tar (ustar) — "ustar" magic at offset 257 of the first 512-byte header.
	if (data.length >= 263 && data[257] === 0x75 && data[258] === 0x73 && data[259] === 0x74 && data[260] === 0x61 && data[261] === 0x72) {
		return 'tar';
	}

	// zlib — CMF/FLG: low nibble of CMF is 8 (deflate) and the 16-bit header is
	// a multiple of 31. Checked last because the test is structural, not a fixed
	// magic, so it must not shadow the signatures above.
	if ((b0 & 0x0f) === 0x08 && (b0 >> 4) <= 7 && ((b0 << 8) | b1) % 31 === 0) {
		return 'zlib';
	}

	return undefined;
}
