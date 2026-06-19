/**
 * Shared HTTP compression helpers used by the framework adapters. Handles
 * `Accept-Encoding` negotiation and maps a chosen encoding to a ZipKit codec.
 */

import type { Codec } from '../types.js';
import { compress } from '../compress.js';

/** HTTP content codings ZipKit can emit, best-ratio first. */
export type Encoding = 'br' | 'zstd' | 'gzip' | 'deflate';

const ENCODING_TO_CODEC: Record<Encoding, Codec> = {
	br: 'brotli',
	zstd: 'zstd',
	gzip: 'gzip',
	deflate: 'zlib'
};

/** Default server preference order (highest ratio first). */
export const DEFAULT_ENCODINGS: Encoding[] = ['br', 'zstd', 'gzip', 'deflate'];

export interface CompressionOptions {
	/**
	 * Encodings the server is willing to emit, in preference order. The first
	 * one the client also accepts wins. Defaults to `['br','zstd','gzip','deflate']`.
	 */
	encodings?: Encoding[];
	/** Don't compress responses smaller than this many bytes. Default `1024`. */
	threshold?: number;
	/** Compression level passed to the chosen codec. */
	level?: number;
}

/**
 * Pick the best mutually-supported encoding from an `Accept-Encoding` header,
 * or `null` if none match (or the client sent `identity;q=0`-style refusals).
 */
export function negotiate(acceptEncoding: string | null | undefined, encodings = DEFAULT_ENCODINGS): Encoding | null {
	if (!acceptEncoding) return null;
	const accepted = new Set(
		acceptEncoding
			.split(',')
			.map((part) => part.trim().split(';')[0]!.trim().toLowerCase())
			.filter(Boolean)
	);
	for (const enc of encodings) {
		if (accepted.has(enc) || accepted.has('*')) return enc;
	}
	return null;
}

/** Compress a response body for the negotiated `encoding`. */
export function compressBody(body: Uint8Array, encoding: Encoding, level?: number): Promise<Uint8Array> {
	return compress(body, ENCODING_TO_CODEC[encoding], { level });
}

/** Coerce common body shapes into bytes. */
export function toBytes(body: unknown): Uint8Array | null {
	if (body == null) return null;
	if (body instanceof Uint8Array) return body;
	if (body instanceof ArrayBuffer) return new Uint8Array(body);
	if (typeof body === 'string') return new TextEncoder().encode(body);
	return null;
}
