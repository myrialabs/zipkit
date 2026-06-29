/**
 * Loader for the unified ZipKit Wasm engine (Emscripten ES module).
 *
 * One module, all codecs: gzip/deflate/zlib (libdeflate), lz4, zstd (+ ultra),
 * brotli, snappy, lzma, bzip2, qoi (image), frame-delta (video). The ABI is
 * deliberately tiny — persistent buffers, one copy in and one copy out per
 * call, no allocation crossing the JS/Wasm boundary.
 *
 * The engine is the low-level escape hatch. Most users want the high-level
 * {@link import('./zipkit.js').ZipKit} class or the named codec helpers from
 * the package root; reach for `ZipKitEngine` only when you need raw codec
 * access without runtime dispatch.
 *
 * @example
 * ```ts
 * import { ZipKitEngine } from '@myrialabs/zipkit/engine';
 * const engine = await ZipKitEngine.load();
 * const packed = engine.zstdCompress(bytes, 19);
 * ```
 */

import ZipKitModule from '../engine/dist/zipkit-engine.mjs';

/** The subset of the Emscripten module ZipKit relies on. */
interface Mod {
	HEAPU8: Uint8Array;
	_zk_input_ptr(size: number): number;
	_zk_result_ptr(): number;
	_zk_result_len(): number;
	_zk_gzip_compress(len: number, level: number): void;
	_zk_gzip_decompress(len: number): void;
	_zk_deflate_compress(len: number, level: number): void;
	_zk_deflate_decompress(len: number, hint: number): void;
	_zk_zlib_compress(len: number, level: number): void;
	_zk_zlib_decompress(len: number, hint: number): void;
	_zk_crc32(len: number, seed: number): number;
	_zk_lz4_compress(len: number): void;
	_zk_lz4_decompress(len: number): void;
	_zk_zstd_compress(len: number, level: number): void;
	_zk_zstd_decompress(len: number): void;
	_zk_brotli_compress(len: number, quality: number): void;
	_zk_brotli_decompress(len: number): void;
	_zk_snappy_compress(len: number): void;
	_zk_snappy_decompress(len: number): void;
	_zk_zstd_max_compress(len: number, level: number): void;
	_zk_lzma_compress(len: number, level: number): void;
	_zk_lzma_decompress(len: number): void;
	_zk_xz_compress(len: number, level: number): void;
	_zk_xz_decompress(len: number): void;
	_zk_xz_ok(): number;
	_zk_lzma2_decompress(len: number, prop: number, outSize: number): void;
	_zk_set_aux(len: number): void;
	_zk_zstd_train_dict(samplesLen: number, nSamples: number, dictCap: number): void;
	_zk_zstd_compress_dict(len: number, level: number): void;
	_zk_zstd_decompress_dict(len: number): void;
	_zk_bzip2_compress(len: number, level: number): void;
	_zk_bzip2_decompress(len: number): void;
	_zk_qoi_encode(len: number, w: number, h: number, ch: number): void;
	_zk_qoi_decode(len: number): void;
	_zk_frame_delta_encode(len: number, frameSize: number): void;
	_zk_frame_delta_decode(len: number, frameSize: number): void;
}

/**
 * The raw Wasm engine: every codec exposed as a synchronous
 * `Uint8Array -> Uint8Array` method. Construct it with the async
 * {@link ZipKitEngine.load} factory (Wasm instantiation is async), or call
 * {@link getEngine} for a process-wide lazily-instantiated singleton.
 */
export class ZipKitEngine {
	private m: Mod;
	private constructor(m: Mod) {
		this.m = m;
	}

	/** Instantiate a fresh engine. Prefer {@link getEngine} to avoid reloading. */
	static async load(): Promise<ZipKitEngine> {
		const m = (await ZipKitModule()) as Mod;
		return new ZipKitEngine(m);
	}

	private call(fn: (len: number) => void, data: Uint8Array): Uint8Array {
		const m = this.m;
		const p = m._zk_input_ptr(data.length);
		m.HEAPU8.set(data, p);
		fn(data.length);
		const op = m._zk_result_ptr();
		const ol = m._zk_result_len() >>> 0;
		// slice() copies out of the (possibly growable) Wasm heap into a
		// standalone buffer the caller owns.
		return m.HEAPU8.slice(op, op + ol);
	}

	gzipCompress(d: Uint8Array, level = 9): Uint8Array {
		return this.call((l) => this.m._zk_gzip_compress(l, level), d);
	}
	gzipDecompress(d: Uint8Array): Uint8Array {
		return this.call((l) => this.m._zk_gzip_decompress(l), d);
	}
	deflateCompress(d: Uint8Array, level = 9): Uint8Array {
		return this.call((l) => this.m._zk_deflate_compress(l, level), d);
	}
	deflateDecompress(d: Uint8Array): Uint8Array {
		return this.call((l) => this.m._zk_deflate_decompress(l, 0), d);
	}
	zlibCompress(d: Uint8Array, level = 9): Uint8Array {
		return this.call((l) => this.m._zk_zlib_compress(l, level), d);
	}
	zlibDecompress(d: Uint8Array): Uint8Array {
		return this.call((l) => this.m._zk_zlib_decompress(l, 0), d);
	}

	/**
	 * CRC-32 (IEEE 802.3) of `d`, optionally continuing from a prior `seed`.
	 * Returns the checksum directly — libdeflate's SIMD path, far faster than a
	 * byte-at-a-time table. Used by the ZIP container.
	 */
	crc32(d: Uint8Array, seed = 0): number {
		const m = this.m;
		const p = m._zk_input_ptr(d.length);
		m.HEAPU8.set(d, p);
		return m._zk_crc32(d.length, seed >>> 0) >>> 0;
	}
	lz4Compress(d: Uint8Array): Uint8Array {
		return this.call((l) => this.m._zk_lz4_compress(l), d);
	}
	lz4Decompress(d: Uint8Array): Uint8Array {
		return this.call((l) => this.m._zk_lz4_decompress(l), d);
	}
	zstdCompress(d: Uint8Array, level = 19): Uint8Array {
		return this.call((l) => this.m._zk_zstd_compress(l, level), d);
	}
	zstdDecompress(d: Uint8Array): Uint8Array {
		return this.call((l) => this.m._zk_zstd_decompress(l), d);
	}
	brotliCompress(d: Uint8Array, quality = 11): Uint8Array {
		return this.call((l) => this.m._zk_brotli_compress(l, quality), d);
	}
	brotliDecompress(d: Uint8Array): Uint8Array {
		return this.call((l) => this.m._zk_brotli_decompress(l), d);
	}
	snappyCompress(d: Uint8Array): Uint8Array {
		return this.call((l) => this.m._zk_snappy_compress(l), d);
	}
	snappyDecompress(d: Uint8Array): Uint8Array {
		return this.call((l) => this.m._zk_snappy_decompress(l), d);
	}

	/** Max-ratio zstd (ultra + long-distance matching), up to level 22. */
	zstdMaxCompress(d: Uint8Array, level = 22): Uint8Array {
		return this.call((l) => this.m._zk_zstd_max_compress(l, level), d);
	}
	// (decompress with zstdDecompress — same frame format)

	/** LZMA — highest general-purpose ratio. */
	lzmaCompress(d: Uint8Array, level = 9): Uint8Array {
		return this.call((l) => this.m._zk_lzma_compress(l, level), d);
	}
	lzmaDecompress(d: Uint8Array): Uint8Array {
		return this.call((l) => this.m._zk_lzma_decompress(l), d);
	}

	/**
	 * Decode a raw LZMA2 stream (used by the 7z reader). `prop` is the single
	 * LZMA2 dictionary-size property byte; `outSize` is the known unpacked size.
	 */
	lzma2Decompress(d: Uint8Array, prop: number, outSize: number): Uint8Array {
		return this.call((l) => this.m._zk_lzma2_decompress(l, prop, outSize), d);
	}

	/** xz — the standard `.xz` container around LZMA2 (full streaming codec). */
	xzCompress(d: Uint8Array, level = 6): Uint8Array {
		const out = this.call((l) => this.m._zk_xz_compress(l, level), d);
		if (!this.m._zk_xz_ok()) throw new Error('xz compression failed');
		return out;
	}
	xzDecompress(d: Uint8Array): Uint8Array {
		// An empty result is valid (a stream can decode to zero bytes), so success
		// is read from the engine's explicit flag, not the output length.
		const out = this.call((l) => this.m._zk_xz_decompress(l), d);
		if (!this.m._zk_xz_ok()) throw new Error('xz decompression failed (corrupt stream or unsupported filter)');
		return out;
	}

	/**
	 * Stage `dict` into the engine's auxiliary buffer for the next dictionary
	 * call. Held until the next {@link setAux}, so set it immediately before
	 * {@link zstdCompressDict}/{@link zstdDecompressDict} or {@link zstdTrainDict}.
	 */
	setAux(dict: Uint8Array): void {
		const m = this.m;
		const p = m._zk_input_ptr(dict.length);
		m.HEAPU8.set(dict, p);
		m._zk_set_aux(dict.length);
	}

	/**
	 * Train a zstd dictionary of up to `dictCapacity` bytes from `samples`. Stage
	 * the per-sample sizes (u32 LE) via {@link setAux} first; `samples` is the
	 * concatenation of every sample. Returns the dictionary bytes (empty on
	 * failure, e.g. too few samples).
	 */
	zstdTrainDict(samples: Uint8Array, nSamples: number, dictCapacity: number): Uint8Array {
		const m = this.m;
		const p = m._zk_input_ptr(samples.length);
		m.HEAPU8.set(samples, p);
		m._zk_zstd_train_dict(samples.length, nSamples, dictCapacity);
		const op = m._zk_result_ptr();
		const ol = m._zk_result_len() >>> 0;
		return m.HEAPU8.slice(op, op + ol);
	}

	/** Compress `d` with the dictionary previously staged via {@link setAux}. */
	zstdCompressDict(d: Uint8Array, level = 19): Uint8Array {
		return this.call((l) => this.m._zk_zstd_compress_dict(l, level), d);
	}
	/** Decompress `d` with the dictionary previously staged via {@link setAux}. */
	zstdDecompressDict(d: Uint8Array): Uint8Array {
		return this.call((l) => this.m._zk_zstd_decompress_dict(l), d);
	}

	/** bzip2 — Burrows–Wheeler transform. */
	bzip2Compress(d: Uint8Array, level = 9): Uint8Array {
		return this.call((l) => this.m._zk_bzip2_compress(l, level), d);
	}
	bzip2Decompress(d: Uint8Array): Uint8Array {
		return this.call((l) => this.m._zk_bzip2_decompress(l), d);
	}

	/** QOI — lossless image (raw RGB/RGBA pixels in, QOI bytes out). */
	qoiEncode(pixels: Uint8Array, width: number, height: number, channels: number): Uint8Array {
		return this.call((l) => this.m._zk_qoi_encode(l, width, height, channels), pixels);
	}
	qoiDecode(d: Uint8Array): Uint8Array {
		return this.call((l) => this.m._zk_qoi_decode(l), d);
	}

	/**
	 * Frame-delta — lossless temporal predictor for video-like streams. Pair
	 * `encode -> zstd/lz4` on the way in and `lz4/zstd -> decode` on the way out.
	 */
	frameDeltaEncode(d: Uint8Array, frameSize: number): Uint8Array {
		return this.call((l) => this.m._zk_frame_delta_encode(l, frameSize), d);
	}
	frameDeltaDecode(d: Uint8Array, frameSize: number): Uint8Array {
		return this.call((l) => this.m._zk_frame_delta_decode(l, frameSize), d);
	}
}

let singleton: Promise<ZipKitEngine> | undefined;

/**
 * Return the process-wide engine, instantiating the Wasm module on first call
 * and reusing it thereafter. This is what every high-level helper uses, so the
 * 1.4 MB module loads at most once per process.
 */
export function getEngine(): Promise<ZipKitEngine> {
	return (singleton ??= ZipKitEngine.load());
}
