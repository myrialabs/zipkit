/**
 * Compression for Elysia, as an `onAfterHandle` hook. Negotiates
 * `Accept-Encoding` and returns a compressed `Response` with the right headers.
 *
 * @example
 * ```ts
 * import { Elysia } from 'elysia';
 * import { elysia as compression } from '@myrialabs/zipkit/middleware';
 * const app = new Elysia().onAfterHandle(compression()).get('/', () => bigJson);
 * ```
 */
import { negotiate, compressBody, toBytes, type CompressionOptions } from './shared.js';

/** Create an Elysia `onAfterHandle` compression hook. */
export function elysia(options: CompressionOptions = {}) {
	const threshold = options.threshold ?? 1024;
	return async (ctx: any): Promise<Response | undefined> => {
		const { response, request, set } = ctx;
		const encoding = negotiate(request?.headers?.get?.('accept-encoding'), options.encodings);
		if (!encoding) return undefined;

		// Normalize the handler's return value into bytes.
		let body: Uint8Array | null = null;
		if (response instanceof Response) {
			if (response.headers.get('Content-Encoding')) return undefined;
			body = new Uint8Array(await response.arrayBuffer());
		} else if (typeof response === 'object' && response !== null) {
			body = new TextEncoder().encode(JSON.stringify(response));
			set.headers['Content-Type'] ??= 'application/json';
		} else {
			body = toBytes(response);
		}
		if (!body || body.length < threshold) return undefined;

		const compressed = await compressBody(body, encoding, options.level);
		set.headers['Content-Encoding'] = encoding;
		set.headers['Vary'] = 'Accept-Encoding';
		return new Response(compressed as any, { headers: set.headers, status: set.status ?? 200 });
	};
}
