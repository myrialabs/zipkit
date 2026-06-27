/**
 * zstd dictionary compression — the win for many small, similar payloads
 * (log lines, JSON records, RPC messages).
 *
 * Run with:  bun run examples/dictionary.ts
 */

import { trainDictionary, compressWithDictionary, decompressWithDictionary } from '../src/dictionary.js';
import { zstd } from '../src/codecs/zstd.js';
import { strToU8, strFromU8 } from '../src/index.js';

// 500 structurally-similar JSON records.
const records = Array.from({ length: 500 }, (_, i) =>
	strToU8(JSON.stringify({ ts: 1_700_000_000 + i, level: ['info', 'warn', 'error'][i % 3], svc: 'api', msg: `request ${i} ok` }))
);

const dict = await trainDictionary(records);
console.log('trained dictionary:', dict.length, 'bytes\n');

// Compare one tiny record: plain zstd vs zstd-with-dictionary.
const sample = records[123]!;
const plain = await zstd(sample, { level: 19 });
const withDict = await compressWithDictionary(sample, dict);

console.log('one record:', sample.length, 'bytes raw');
console.log('  plain zstd:     ', plain.length, 'bytes');
console.log('  with dictionary:', withDict.length, 'bytes  ← shared shape lives in the dict');

const restored = await decompressWithDictionary(withDict, dict);
console.log('\nround-trip ok:', strFromU8(restored) === strFromU8(sample));
