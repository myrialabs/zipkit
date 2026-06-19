/**
 * Response compression for Elysia — negotiates Accept-Encoding and compresses
 * with the best codec the client supports (brotli -> zstd -> gzip -> deflate).
 *
 * Needs Elysia:  bun add elysia
 * Run with:      bun run examples/middleware-elysia.ts
 */

import { Elysia } from 'elysia';
import { elysia as compression } from '../src/middleware/index.js';

new Elysia()
	.onAfterHandle(compression({ threshold: 256 }))
	.get('/', () => ({
		message: 'This response is compressed when your client accepts it.',
		items: Array.from({ length: 200 }, (_, i) => ({ i, value: `row ${i}` }))
	}))
	.listen(3000);

console.log('Listening on http://localhost:3000');
console.log('Try:  curl -s -H "Accept-Encoding: br" localhost:3000 | wc -c');
