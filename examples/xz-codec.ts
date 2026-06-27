/**
 * Standard .xz compression (LZMA2). Interops with the `xz` CLI and .tar.xz.
 *
 * Run with:  bun run examples/xz-codec.ts
 */

import { xz, unxz } from '../src/codecs/xz.js';
import { decompress } from '../src/index.js';
import { strToU8, strFromU8 } from '../src/index.js';

const data = strToU8('the quick brown fox jumps over the lazy dog\n'.repeat(500));

const packed = await xz(data, { level: 9 });
console.log('xz:', data.length, '→', packed.length, 'bytes');

// unxz reverses it; decompress() also auto-detects the .xz magic.
console.log('unxz round-trip ok:', strFromU8(await unxz(packed)) === strFromU8(data));
console.log('auto-detect ok:    ', strFromU8(await decompress(packed)) === strFromU8(data));

await Bun.write('example.xz', packed);
console.log('\nwrote example.xz — try: xz -dc example.xz');
