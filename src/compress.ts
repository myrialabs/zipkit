/**
 * Generic codec dispatch by name, plus auto-detecting decompression.
 *
 * `compress(data, 'zstd')` picks the codec explicitly; `decompress(data)`
 * sniffs the header (see {@link detectFormat}) and routes accordingly. For
 * headerless formats (brotli, raw lzma, raw lz4 block, snappy) pass the codec
 * explicitly via `decompressWith`.
 */

import type { Codec, CompressOptions, DecompressOptions } from './types.js';
import { ZipKitError } from './types.js';
import { detectFormat } from './detect.js';
import { gzip, gunzip } from './codecs/gzip.js';
import { deflate, inflate } from './codecs/deflate.js';
import { zlib, unzlib } from './codecs/zlib.js';
import { zstd, unzstd } from './codecs/zstd.js';
import { lz4, unlz4 } from './codecs/lz4.js';
import { snappy, unsnappy } from './codecs/snappy.js';
import { brotli, unbrotli } from './codecs/brotli.js';
import { lzma, unlzma } from './codecs/lzma.js';
import { bzip2, unbzip2 } from './codecs/bzip2.js';

const COMPRESSORS: Record<Codec, (d: Uint8Array, o?: CompressOptions) => Promise<Uint8Array>> = {
	gzip,
	deflate,
	zlib,
	zstd,
	lz4,
	snappy,
	brotli,
	lzma,
	bzip2
};

const DECOMPRESSORS: Record<Codec, (d: Uint8Array, o?: DecompressOptions) => Promise<Uint8Array>> = {
	gzip: gunzip,
	deflate: inflate,
	zlib: unzlib,
	zstd: unzstd,
	lz4: unlz4,
	snappy: unsnappy,
	brotli: unbrotli,
	lzma: unlzma,
	bzip2: unbzip2
};

/** Compress with the named codec. */
export function compress(data: Uint8Array, codec: Codec, opts?: CompressOptions): Promise<Uint8Array> {
	const fn = COMPRESSORS[codec];
	if (!fn) throw new ZipKitError(`Unknown codec: ${codec}`);
	return fn(data, opts);
}

/** Decompress with the named codec. */
export function decompressWith(data: Uint8Array, codec: Codec, opts?: DecompressOptions): Promise<Uint8Array> {
	const fn = DECOMPRESSORS[codec];
	if (!fn) throw new ZipKitError(`Unknown codec: ${codec}`);
	return fn(data, opts);
}

/**
 * Decompress by auto-detecting the format from magic bytes. Throws
 * {@link ZipKitError} if the format has no recognizable signature — use
 * {@link decompressWith} and name the codec in that case.
 */
export async function decompress(data: Uint8Array, opts?: DecompressOptions): Promise<Uint8Array> {
	const fmt = detectFormat(data);
	if (!fmt || fmt === 'zip') {
		throw new ZipKitError(
			fmt === 'zip'
				? 'Input is a ZIP archive — use unzip() from zipkit/zip (or the `zipkit unzip` CLI command).'
				: 'Could not auto-detect the compression format. Pass the codec explicitly via decompressWith().'
		);
	}
	return decompressWith(data, fmt, opts);
}
