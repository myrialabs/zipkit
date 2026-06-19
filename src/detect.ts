/**
 * Format auto-detection from magic bytes.
 *
 * Detects the container/codec of a compressed buffer by inspecting its header.
 * Only standard-framed formats with a reliable signature are detectable — gzip,
 * zlib, zstd, and ZIP. ZipKit's brotli, snappy, raw LZ4 block, and the
 * length-prefixed lzma/bzip2 streams have no leading magic, so they return
 * `undefined`; decode them with an explicit codec via `decompressWith`.
 */

/**
 * A format ZipKit can recognize from its header bytes. Only formats with a
 * reliable leading signature are detectable; everything else needs an explicit
 * codec via `decompressWith`.
 */
export type DetectedFormat = 'gzip' | 'zlib' | 'zstd' | 'zip';

/**
 * Identify the format of a compressed buffer, or `undefined` if it has no
 * recognizable signature.
 *
 * Detectable: **gzip, zlib, zstd, and ZIP**. Headerless or ZipKit-framed codecs
 * — brotli, snappy, the raw LZ4 block written by {@link lz4}, and the
 * length-prefixed lzma/bzip2 streams — have no leading magic and return
 * `undefined`; decode them with an explicit codec via `decompressWith`. (A
 * standard LZ4 *frame* has a magic, but ZipKit emits and reads the raw block
 * format, so frames are intentionally not reported here.)
 *
 * @example
 * ```ts
 * detectFormat(gzipBytes); // 'gzip'
 * detectFormat(zipBytes);  // 'zip'
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

	// zlib — CMF/FLG: low nibble of CMF is 8 (deflate) and the 16-bit header is
	// a multiple of 31. Checked last because the test is structural, not a fixed
	// magic, so it must not shadow the signatures above.
	if ((b0 & 0x0f) === 0x08 && (b0 >> 4) <= 7 && ((b0 << 8) | b1) % 31 === 0) {
		return 'zlib';
	}

	return undefined;
}
