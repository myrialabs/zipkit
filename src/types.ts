/**
 * Shared types for ZipKit.
 *
 * Every public codec accepts and returns {@link Uint8Array}. String helpers
 * live in `string.ts` (`strToU8` / `strFromU8`); they convert to/from bytes so
 * the codec layer stays byte-only and predictable across runtimes.
 */

/** Bytes in, bytes out — the universal data shape for every codec. */
export type Bytes = Uint8Array;

/**
 * Compression algorithms ZipKit can produce and consume. Each maps to a codec
 * façade in `codecs/` and a method on {@link import('./zipkit.js').ZipKit}.
 */
export type Codec =
	| 'gzip'
	| 'deflate'
	| 'zlib'
	| 'zstd'
	| 'lz4'
	| 'snappy'
	| 'brotli'
	| 'lzma'
	| 'bzip2';

/** A DEFLATE-family compression level, `0` (store) – `9` (max). */
export type DeflateLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * High-level compression policy. `balanced` is the default: good speed, good
 * ratio, standard output. `speed` favors latency/throughput; `ratio` favors
 * smaller output.
 */
export type CompressionMode = 'speed' | 'balanced' | 'ratio';

/** Common options accepted by the high-level compress helpers. */
export interface CompressOptions {
	/** Compression policy. Defaults to `'balanced'`. */
	mode?: CompressionMode;
	/**
	 * Compression level. Range depends on the codec — DEFLATE/gzip/zlib/lzma/
	 * bzip2 use 0–9, zstd uses 1–22, brotli uses 0–11. Out-of-range values are
	 * clamped to the codec's nearest supported level. When omitted, `mode`
	 * chooses a sensible codec-specific default.
	 */
	level?: number;
	/** Abort an in-flight async operation. Honored by the async/worker APIs. */
	signal?: AbortSignal;
	/** Progress reporter, invoked as work proceeds (async/streaming paths). */
	onProgress?: ProgressCallback;
}

/** Options accepted by the high-level decompress helpers. */
export interface DecompressOptions {
	/** Abort an in-flight async operation. Honored by the async/worker APIs. */
	signal?: AbortSignal;
	/** Progress reporter, invoked as work proceeds (async/streaming paths). */
	onProgress?: ProgressCallback;
}

/**
 * Progress callback. `percent` is `0`–`1` where known (otherwise `-1`),
 * `bytes` is the number of bytes processed so far.
 */
export type ProgressCallback = (percent: number, bytes: number) => void;

/** Thrown when an operation is aborted via an {@link AbortSignal}. */
export class AbortError extends Error {
	constructor(message = 'The operation was aborted') {
		super(message);
		this.name = 'AbortError';
	}
}

/** Thrown when input bytes cannot be decoded by the requested/detected codec. */
export class ZipKitError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ZipKitError';
	}
}
