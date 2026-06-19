/**
 * Minimal example: gzip a string and read it back.
 *
 * Run with:  bun run examples/gzip.ts
 */

import { gzip, gunzip, strToU8, strFromU8 } from '../src/index.js';

const original = 'The quick brown fox jumps over the lazy dog. '.repeat(50);

const compressed = await gzip(strToU8(original), { level: 9 });
const restored = strFromU8(await gunzip(compressed));

console.log('original  :', original.length, 'bytes');
console.log('compressed:', compressed.length, 'bytes');
console.log('ratio     :', ((compressed.length / original.length) * 100).toFixed(1) + '%');
console.log('roundtrip :', restored === original ? 'OK' : 'MISMATCH');
