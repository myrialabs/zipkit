/**
 * Compression middleware for Express / Connect. Buffers the response, then
 * compresses on `end()` with the best supported codec when the client accepts
 * one and the body clears the size threshold.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { express as compression } from '@myrialabs/zipkit';
 * const app = express();
 * app.use(compression());
 * ```
 */
import { negotiate, compressBody, toBytes, type CompressionOptions } from './shared.js';

/** Create an Express compression middleware. */
export function express(options: CompressionOptions = {}) {
	const threshold = options.threshold ?? 1024;
	return (req: any, res: any, next: () => void): void => {
		const encoding = negotiate(req.headers?.['accept-encoding'], options.encodings);
		if (!encoding) return next();

		const chunks: Uint8Array[] = [];
		const origWrite = res.write.bind(res);
		const origEnd = res.end.bind(res);

		res.write = (chunk: any, ...rest: any[]): boolean => {
			const bytes = toBytes(chunk);
			if (bytes) chunks.push(bytes);
			else return origWrite(chunk, ...rest);
			return true;
		};

		res.end = (chunk?: any, ...rest: any[]): any => {
			const tail = toBytes(chunk);
			if (tail) chunks.push(tail);
			const total = chunks.reduce((n, c) => n + c.length, 0);
			const body = new Uint8Array(total);
			let off = 0;
			for (const ch of chunks) {
				body.set(ch, off);
				off += ch.length;
			}

			if (body.length < threshold || res.getHeader('Content-Encoding')) {
				res.write = origWrite;
				res.end = origEnd;
				return origEnd(body, ...rest);
			}

			void compressBody(body, encoding, options.level).then((compressed) => {
				res.setHeader('Content-Encoding', encoding);
				res.setHeader('Vary', 'Accept-Encoding');
				res.removeHeader('Content-Length');
				res.write = origWrite;
				res.end = origEnd;
				origEnd(Buffer.from(compressed), ...rest);
			});
			return res;
		};

		next();
	};
}
