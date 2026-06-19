/**
 * Response compression for Express — negotiates Accept-Encoding and compresses
 * with the best codec the client supports (brotli -> zstd -> gzip -> deflate).
 *
 * Needs Express:  bun add express
 * Run with:       bun run examples/middleware-express.ts
 */

import express from 'express';
import { express as compression } from '../src/middleware/index.js';

const app = express();

app.use(compression({ threshold: 256 }));

app.get('/', (_req, res) => {
	res.json({
		message: 'This response is compressed when your client accepts it.',
		items: Array.from({ length: 200 }, (_, i) => ({ i, value: `row ${i}` }))
	});
});

app.listen(3000, () => {
	console.log('Listening on http://localhost:3000');
	console.log('Try:  curl -s -H "Accept-Encoding: br" localhost:3000 | wc -c');
});
