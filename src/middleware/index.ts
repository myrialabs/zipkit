/**
 * HTTP compression middleware for popular frameworks. Each adapter negotiates
 * `Accept-Encoding` and compresses responses with the best codec the client
 * supports (brotli → zstd → gzip → deflate).
 *
 * ```ts
 * import { elysia, express, hono } from 'zipkit/middleware';
 * ```
 */
export { elysia } from './elysia.js';
export { express } from './express.js';
export { hono } from './hono.js';
export { negotiate, type CompressionOptions, type Encoding } from './shared.js';
