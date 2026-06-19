/**
 * Compression middleware for Hono. Negotiates `Accept-Encoding`, compresses the
 * response body with the best supported codec (brotli → zstd → gzip → deflate),
 * and sets `Content-Encoding` / `Vary`.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { hono as compress } from 'zipkit/middleware';
 * const app = new Hono();
 * app.use('*', compress());
 * ```
 */
import { negotiate, compressBody, type CompressionOptions } from './shared.js';

/** Create a Hono compression middleware. */
export function hono(options: CompressionOptions = {}) {
	const threshold = options.threshold ?? 1024;
	return async (c: any, next: () => Promise<void>): Promise<void> => {
		await next();
		const res = c.res;
		if (!res || !res.body) return;
		if (res.headers.get('Content-Encoding')) return; // already encoded

		const encoding = negotiate(c.req.header('Accept-Encoding'), options.encodings);
		if (!encoding) return;

		const original = new Uint8Array(await res.arrayBuffer());
		if (original.length < threshold) {
			c.res = new Response(original, res);
			return;
		}
		const compressed = await compressBody(original, encoding, options.level);
		const headers = new Headers(res.headers);
		headers.set('Content-Encoding', encoding);
		headers.set('Vary', 'Accept-Encoding');
		headers.delete('Content-Length');
		c.res = new Response(compressed as unknown as BodyInit, { status: res.status, headers });
	};
}
