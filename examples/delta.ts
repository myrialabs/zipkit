/**
 * Delta (incremental) compression — encode a new revision against the previous
 * one so only the change costs bytes. Great for logs, chat history, snapshots.
 *
 * Run with:  bun run examples/delta.ts
 */

import { compressDelta, applyDelta } from '../src/delta.js';
import { zstd } from '../src/codecs/zstd.js';
import { strToU8, strFromU8 } from '../src/index.js';

const base = strToU8('chat log\n' + 'user: hello\nbot: hi there\n'.repeat(300));
const updated = strToU8(strFromU8(base) + 'user: one more message\n'); // tiny change

const patch = await compressDelta(base, updated);
const standalone = await zstd(updated, { level: 19 });

console.log('updated revision:', updated.length, 'bytes');
console.log('  standalone zstd:', standalone.length, 'bytes');
console.log('  delta vs base:  ', patch.length, 'bytes  ←', Math.round(standalone.length / patch.length) + '× smaller');

const restored = await applyDelta(base, patch);
console.log('\nround-trip ok:', strFromU8(restored) === strFromU8(updated));
