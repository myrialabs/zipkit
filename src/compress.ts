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
import { detectFormat, isDirectlyDecompressible, type DetectedFormat } from './detect.js';
import { gzip, gunzip } from './codecs/gzip.js';
import { deflate, inflate } from './codecs/deflate.js';
import { zlib, unzlib } from './codecs/zlib.js';
import { zstd, unzstd } from './codecs/zstd.js';
import { lz4, unlz4 } from './codecs/lz4.js';
import { snappy, unsnappy } from './codecs/snappy.js';
import { brotli, unbrotli } from './codecs/brotli.js';
import { lzma, unlzma } from './codecs/lzma.js';
import { bzip2, unbzip2 } from './codecs/bzip2.js';
import { unxz } from './codecs/xz.js';

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
	if (!fmt) {
		throw new ZipKitError(
			'Could not auto-detect the compression format. Pass the codec explicitly via decompressWith().'
		);
	}
	// xz is a container, but ZipKit decodes it directly via the engine.
	if (fmt === 'xz') return unxz(data, opts);
	if (!isDirectlyDecompressible(fmt)) {
		throw new ZipKitError(CONTAINER_HINT[fmt as ContainerFormat]);
	}
	return decompressWith(data, fmt as Codec, opts);
}

/** Recognized formats that {@link decompress} cannot decode on its own. */
type ContainerFormat = Exclude<DetectedFormat, 'gzip' | 'zlib' | 'zstd' | 'xz'>;

/** Guidance for formats {@link decompress} recognizes but can't decode itself. */
const CONTAINER_HINT: Record<ContainerFormat, string> = {
	zip: 'Input is a ZIP archive — use unzip() from @myrialabs/zipkit (or the `zipkit unzip` CLI command).',
	tar: 'Input is a tar archive — use untar() from @myrialabs/zipkit (or untarGz/untarZstd for compressed tarballs).',
	'7z': 'Input is a 7z archive — use unSevenZip() from @myrialabs/zipkit.',
	bzip2:
		'Input is a standard bzip2 (.bz2) stream. ZipKit\'s bzip2 codec uses its own length-prefixed frame, so this external stream needs a standard .bz2 reader.',
	'lz4-frame':
		'Input is an LZ4 frame — ZipKit emits and reads the raw LZ4 block; decode frames with a frame-aware LZ4 reader.'
};
