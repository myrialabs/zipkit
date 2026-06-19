/**
 * Response compression for Hono — negotiates Accept-Encoding and compresses
 * with the best codec the client supports (brotli -> zstd -> gzip -> deflate).
 *
 * Needs Hono:  bun add hono
 * Run with:    bun run examples/middleware-hono.ts   (then curl localhost:3000)
 */

import { Hono } from 'hono';
import { hono as compress } from '../src/middleware/index.js';

const app = new Hono();

app.use('*', compress({ threshold: 256 }));

app.get('/', (c) =>
	c.json({
		message: 'This response is compressed when your client accepts it.',
		items: Array.from({ length: 200 }, (_, i) => ({ i, value: `row ${i}` }))
	})
);

export default { port: 3000, fetch: app.fetch };

console.log('Listening on http://localhost:3000');
console.log('Try:  curl -s -H "Accept-Encoding: br" localhost:3000 | wc -c');
