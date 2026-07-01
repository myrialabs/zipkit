/**
 * Web-standard `TransformStream` wrappers for every codec, so ZipKit drops into
 * any `pipeThrough()` pipeline (`fetch` bodies, files, sockets).
 *
 * gzip / zlib / raw-deflate are backed by the platform's native
 * `CompressionStream` / `DecompressionStream` when present (Node 18+, Bun, and
 * modern browsers) — true incremental streaming with no buffering. The other
 * codecs (zstd, lz4, snappy, brotli, lzma, bzip2) are one-shot in the engine,
 * so their streams buffer the input and compress on flush; this still composes
 * cleanly in a pipeline, it just isn't incremental. Pick gzip/zlib/deflate for
 * unbounded streams.
 *
 * @example
 * ```ts
 * import { compressionStream } from '@myrialabs/zipkit';
 * await response.body
 *   .pipeThrough(compressionStream('gzip'))
 *   .pipeTo(writable);
 * ```
 */

import type { Codec, CompressOptions, DecompressOptions } from '../types.js';
import { compress, decompressWith } from '../compress.js';

/** Codecs whose streaming is delegated to the platform's native streams. */
const NATIVE_FORMAT: Partial<Record<Codec, CompressionFormat>> = {
	gzip: 'gzip',
	zlib: 'deflate',
	deflate: 'deflate-raw'
};

const hasNative = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

function concat(chunks: Uint8Array[], total: number): Uint8Array {
	const out = new Uint8Array(total);
	let off = 0;
	for (const c of chunks) {
		out.set(c, off);
		off += c.length;
	}
	return out;
}

/** A buffering transform: collect every chunk, run `op` once on flush. */
function bufferingStream(op: (input: Uint8Array) => Promise<Uint8Array>): TransformStream<Uint8Array, Uint8Array> {
	const chunks: Uint8Array[] = [];
	let total = 0;
	return new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk) {
			chunks.push(chunk);
			total += chunk.length;
		},
		async flush(controller) {
			controller.enqueue(await op(concat(chunks, total)));
		}
	});
}

/**
 * A `TransformStream` that compresses with `codec`. Native and incremental for
 * gzip/zlib/deflate; buffered for every other codec.
 */
export function compressionStream(
	codec: Codec,
	opts?: CompressOptions
): TransformStream<Uint8Array, Uint8Array> {
	const native = NATIVE_FORMAT[codec];
	// A CompressionStream accepts BufferSource on its writable side, which is
	// wider than Uint8Array — safe to narrow the public type to Uint8Array.
	if (native && hasNative) return new CompressionStream(native) as unknown as TransformStream<Uint8Array, Uint8Array>;
	return bufferingStream((input) => compress(input, codec, opts));
}

/**
 * A `TransformStream` that decompresses with `codec`. Native and incremental
 * for gzip/zlib/deflate; buffered for every other codec.
 */
export function decompressionStream(
	codec: Codec,
	opts?: DecompressOptions
): TransformStream<Uint8Array, Uint8Array> {
	const native = NATIVE_FORMAT[codec];
	if (native && hasNative) return new DecompressionStream(native) as unknown as TransformStream<Uint8Array, Uint8Array>;
	return bufferingStream((input) => decompressWith(input, codec, opts));
}
