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
	xz,
	unxz,
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
	zipStream,
	type ZipEntryInput,
	type ZipEntry,
	type ZipEntryInfo,
	type ZipMethod,
	type UnzipOptions,
	type ZipStreamOptions
} from './zip/index.js';

// ---- 7z archive helpers ----
export {
	sevenZip,
	unSevenZip,
	type SevenZipEntryInput,
	type SevenZipEntry
} from './sevenzip/index.js';

// ---- Tar archive helpers ----
export {
	tar,
	untar,
	tarGz,
	untarGz,
	tarZstd,
	untarZstd,
	type TarEntryInput,
	type TarEntry,
	type TarEntryType
} from './tar/index.js';

// ---- High-level, synchronous class with native dispatch ----
export { ZipKit, init } from './zipkit.js';

// ---- Raw Wasm engine (escape hatch) ----
export { ZipKitEngine, getEngine } from './engine.js';

// ---- String <-> bytes helpers ----
export { strToU8, strFromU8, DecodeUTF8, EncodeUTF8 } from './string.js';

// ---- Explicit integrity helpers ----
export { crc32, verifyChecksum } from './checksum.js';

// ---- Zstd dictionary compression ----
export {
	trainDictionary,
	compressWithDictionary,
	decompressWithDictionary,
	type TrainOptions
} from './dictionary.js';

// ---- Delta (incremental) compression for text/JSON ----
export { compressDelta, applyDelta } from './delta.js';

// ---- File System Access API helpers (browser) ----
export {
	entriesFromFileHandles,
	zipToFileHandle,
	type FileLike,
	type ReadableFileHandle,
	type WritableFileHandle,
	type FileHandleEntryOptions
} from './fsa.js';

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
