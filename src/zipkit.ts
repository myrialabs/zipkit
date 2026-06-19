/**
 * ZipKit — the high-level, synchronous API with runtime-adaptive dispatch.
 *
 * Goal: keep the public API small while still taking the best path available:
 *   • gzip/deflate — balanced/speed may use native Bun zlib for small text-like
 *     inputs where call latency wins; ratio mode forces libdeflate density.
 *   • zlib — uses the libdeflate engine for standard zlib streams.
 *   • zstd — where Bun ships native libzstd (the speed ceiling), dispatch to
 *     native. In the browser / Node, fall back to the ZipKit Wasm engine.
 *   • lz4/snappy/brotli/lzma/bzip2/qoi/frame-delta — no native competitor
 *     exists anywhere, so always use the ZipKit engine.
 *
 * Net effect: the default is practical and fast, while `mode: 'ratio'` makes
 * density explicit without exposing a maze of options.
 *
 * Methods here are synchronous because the engine is already loaded — construct
 * an instance with `await ZipKit.load()`. For the async, lazy-loading helpers,
 * import the named codec functions from the package root instead.
 */

import { ZipKitEngine } from './engine.js';
import { compressionMode, levelForMode, likelyTextOrRepetitive } from './internal.js';
import { packSync, unpackSync } from './pack.js';
import type { CompressOptions } from './types.js';

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
const B: any = (globalThis as { Bun?: unknown }).Bun;

type SyncCompressOptions = number | CompressOptions | undefined;

function optsFrom(levelOrOpts: SyncCompressOptions): CompressOptions | undefined {
	return typeof levelOrOpts === 'number' ? { level: levelOrOpts } : levelOrOpts;
}

function useNativeDeflateFamily(data: Uint8Array, opts: CompressOptions | undefined, method: 'gzip' | 'deflate'): boolean {
	const mode = compressionMode(opts);
	const fn = method === 'gzip' ? B?.gzipSync : B?.deflateSync;
	return mode !== 'ratio' && typeof fn === 'function' && data.length <= 1024 * 1024 && likelyTextOrRepetitive(data);
}

/** The codec used to compress the frame-delta residual (see {@link ZipKit.encodeFrames}). */
export type FrameCodec = 'zstd' | 'lz4';

export class ZipKit {
	/** The underlying raw Wasm engine, for codecs not surfaced as methods here. */
	readonly engine: ZipKitEngine;
	/**
	 * Which path zstd dispatches to: native (`'bun'`) or the Wasm engine
	 * (`'wasm'`).
	 */
	readonly runtime: 'bun' | 'wasm';

	private constructor(engine: ZipKitEngine) {
		this.engine = engine;
		this.runtime = isBun ? 'bun' : 'wasm';
	}

	/** Instantiate the engine and return a ready-to-use, synchronous instance. */
	static async load(): Promise<ZipKit> {
		return new ZipKit(await ZipKitEngine.load());
	}

	// ---- gzip / deflate / zlib: standard streams with adaptive policy ----
	gzip(d: Uint8Array, levelOrOpts?: SyncCompressOptions): Uint8Array {
		const opts = optsFrom(levelOrOpts);
		const level = levelForMode(opts, 0, 9, { speed: 1, balanced: 6, ratio: 9 });
		if (useNativeDeflateFamily(d, opts, 'gzip')) return new Uint8Array(B.gzipSync(d, { level }));
		return this.engine.gzipCompress(d, level);
	}
	gunzip(d: Uint8Array): Uint8Array {
		if (isBun && B?.gunzipSync) return new Uint8Array(B.gunzipSync(d));
		return this.engine.gzipDecompress(d);
	}
	deflate(d: Uint8Array, levelOrOpts?: SyncCompressOptions): Uint8Array {
		const opts = optsFrom(levelOrOpts);
		const level = levelForMode(opts, 0, 9, { speed: 1, balanced: 6, ratio: 9 });
		if (useNativeDeflateFamily(d, opts, 'deflate')) return new Uint8Array(B.deflateSync(d, { level }));
		return this.engine.deflateCompress(d, level);
	}
	inflate(d: Uint8Array): Uint8Array {
		if (isBun && B?.inflateSync) return new Uint8Array(B.inflateSync(d));
		return this.engine.deflateDecompress(d);
	}
	zlib(d: Uint8Array, levelOrOpts?: SyncCompressOptions): Uint8Array {
		const opts = optsFrom(levelOrOpts);
		const level = levelForMode(opts, 0, 9, { speed: 1, balanced: 6, ratio: 9 });
		return this.engine.zlibCompress(d, level);
	}
	unzlib(d: Uint8Array): Uint8Array {
		return this.engine.zlibDecompress(d);
	}

	// ---- zstd: native in Bun, engine elsewhere ----
	zstd(d: Uint8Array, levelOrOpts?: SyncCompressOptions): Uint8Array {
		const opts = optsFrom(levelOrOpts);
		const level = levelForMode(opts, 1, 22, { speed: 1, balanced: 3, ratio: 19 });
		if (isBun) return B.zstdCompressSync(d, { level });
		return level > 19 ? this.engine.zstdMaxCompress(d, level) : this.engine.zstdCompress(d, level);
	}
	unzstd(d: Uint8Array): Uint8Array {
		return isBun ? B.zstdDecompressSync(d) : this.engine.zstdDecompress(d);
	}

	// ---- engine-only (no native competitor anywhere) ----
	lz4(d: Uint8Array): Uint8Array {
		return this.engine.lz4Compress(d);
	}
	unlz4(d: Uint8Array): Uint8Array {
		return this.engine.lz4Decompress(d);
	}
	snappy(d: Uint8Array): Uint8Array {
		return this.engine.snappyCompress(d);
	}
	unsnappy(d: Uint8Array): Uint8Array {
		return this.engine.snappyDecompress(d);
	}
	brotli(d: Uint8Array, levelOrOpts?: SyncCompressOptions): Uint8Array {
		const opts = optsFrom(levelOrOpts);
		const quality = levelForMode(opts, 0, 11, { speed: 4, balanced: 6, ratio: 11 });
		return this.engine.brotliCompress(d, quality);
	}
	unbrotli(d: Uint8Array): Uint8Array {
		return this.engine.brotliDecompress(d);
	}
	lzma(d: Uint8Array, levelOrOpts?: SyncCompressOptions): Uint8Array {
		const opts = optsFrom(levelOrOpts);
		const level = levelForMode(opts, 0, 9, { speed: 3, balanced: 6, ratio: 9 });
		return this.engine.lzmaCompress(d, level);
	}
	unlzma(d: Uint8Array): Uint8Array {
		return this.engine.lzmaDecompress(d);
	}
	bzip2(d: Uint8Array, levelOrOpts?: SyncCompressOptions): Uint8Array {
		const opts = optsFrom(levelOrOpts);
		const level = levelForMode(opts, 1, 9, { speed: 1, balanced: 6, ratio: 9 });
		return this.engine.bzip2Compress(d, level);
	}
	unbzip2(d: Uint8Array): Uint8Array {
		return this.engine.bzip2Decompress(d);
	}

	// ---- image (QOI) ----
	encodeImage(pixels: Uint8Array, w: number, h: number, channels: 3 | 4): Uint8Array {
		return this.engine.qoiEncode(pixels, w, h, channels);
	}
	decodeImage(d: Uint8Array): Uint8Array {
		return this.engine.qoiDecode(d);
	}

	// ---- video / temporal streams: frame-delta + a fast codec ----
	encodeFrames(frames: Uint8Array, frameSize: number, codec: FrameCodec = 'zstd'): Uint8Array {
		const residual = this.engine.frameDeltaEncode(frames, frameSize);
		return codec === 'lz4' ? this.engine.lz4Compress(residual) : this.engine.zstdCompress(residual, 19);
	}
	decodeFrames(d: Uint8Array, frameSize: number, codec: FrameCodec = 'zstd'): Uint8Array {
		const residual = codec === 'lz4' ? this.engine.lz4Decompress(d) : this.engine.zstdDecompress(d);
		return this.engine.frameDeltaDecode(residual, frameSize);
	}

	// ---- "smallest possible" — pick the densest codec for the data ----
	/**
	 * Try the max-ratio codecs (brotli, lzma, bzip2, zstd-ultra) and return the
	 * smallest result, tagged with a one-byte codec id so {@link unpack} can
	 * reverse it. Use when output size matters more than compression time. For
	 * the async, lazy-loading form, import `pack` from the package root.
	 */
	pack(d: Uint8Array): Uint8Array {
		return packSync(this.engine, d);
	}
	/** Reverse {@link pack}. */
	unpack(d: Uint8Array): Uint8Array {
		return unpackSync(this.engine, d);
	}
}

let singleton: Promise<ZipKit> | undefined;

/**
 * Load (or reuse) a process-wide {@link ZipKit} instance. Convenient when you
 * want the synchronous API without managing the instance yourself.
 */
export function init(): Promise<ZipKit> {
	return (singleton ??= ZipKit.load());
}
