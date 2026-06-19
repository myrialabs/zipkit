/**
 * zstd at several levels, plus the auto-detecting decompress().
 *
 * Run with:  bun run examples/zstd.ts
 */

import { zstd, compress, decompress, strToU8 } from '../src/index.js';

const data = strToU8(JSON.stringify({ items: Array.from({ length: 500 }, (_, i) => ({ i, name: `item ${i}` })) }));

for (const level of [3, 19, 22]) {
	const out = await zstd(data, { level });
	console.log(`zstd L${level}:`.padEnd(10), data.length, '→', out.length, `(${((out.length / data.length) * 100).toFixed(1)}%)`);
}

// Generic dispatch + format auto-detection on the way back.
const packed = await compress(data, 'zstd', { level: 19 });
const back = await decompress(packed); // sniffs the zstd magic — no codec needed
console.log('auto-detect roundtrip:', back.length === data.length ? 'OK' : 'MISMATCH');
