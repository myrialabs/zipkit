/**
 * zipkit — overkill compression for Node, Bun & the browser.
 *
 * One typed API over a single Wasm engine: gzip, deflate, zlib, zstd, lz4,
 * snappy, brotli, lzma, bzip2, plus a ZIP container and lossless image/video
 * codecs. ZipKit picks native speed where it wins and libdeflate density where
 * ratio matters.
 *
 * @example
 * ```ts
 * import { gzip, gunzip, zstd, compress, decompress } from 'zipkit';
 *
 * const gz = await gzip(bytes);            // named codec, async, lazy-loads the engine
 * const back = await gunzip(gz);
 * const small = await compress(bytes, 'zstd', { level: 19 });
 * const orig = await decompress(small);    // auto-detects the format
 * ```
 */

// ---- Named codec helpers (async, tree-shakeable) ----
export {
	gzip,
	gunzip,
	deflate,
	inflate,
	zlib,
	unzlib,
	zstd,
	unzstd,
	lz4,
	unlz4,
	snappy,
	unsnappy,
	brotli,
	unbrotli,
	lzma,
	unlzma,
	bzip2,
	unbzip2,
	encodeImage,
	decodeImage,
	encodeFrames,
	decodeFrames,
	type FrameCodec
} from './codecs/index.js';

// ---- Generic dispatch + auto-detect ----
export { compress, decompress, decompressWith } from './compress.js';
export { detectFormat, type DetectedFormat } from './detect.js';

// ---- "Smallest possible" pack/unpack (async, lazy-loads the engine) ----
export { pack, unpack } from './pack.js';

// ---- ZIP archive helpers ----
export {
	zip,
	unzip,
	listEntries,
	type ZipEntryInput,
	type ZipEntry,
	type ZipEntryInfo,
	type ZipMethod,
	type UnzipOptions
} from './zip/index.js';

// ---- High-level, synchronous class with native dispatch ----
export { ZipKit, init } from './zipkit.js';

// ---- Raw Wasm engine (escape hatch) ----
export { ZipKitEngine, getEngine } from './engine.js';

// ---- String <-> bytes helpers ----
export { strToU8, strFromU8, DecodeUTF8, EncodeUTF8 } from './string.js';

// ---- Shared types and errors ----
export type {
	Bytes,
	Codec,
	CompressionMode,
	DeflateLevel,
	CompressOptions,
	DecompressOptions,
	ProgressCallback
} from './types.js';
export { AbortError, ZipKitError } from './types.js';
