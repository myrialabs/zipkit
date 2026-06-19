/**
 * "Just make it smallest": pack() tries the dense codecs and keeps the winner.
 *
 * Run with:  bun run examples/pack.ts
 */

import { ZipKit, strToU8 } from '../src/index.js';

const zk = await ZipKit.load();
const data = strToU8('lorem ipsum dolor sit amet '.repeat(400));

const packed = zk.pack(data);
const codecName = ['brotli', 'lzma', 'bzip2', 'zstd-max'][packed[0]!];

console.log('runtime   :', zk.runtime);
console.log('original  :', data.length, 'bytes');
console.log('packed    :', packed.length, 'bytes via', codecName);
console.log('roundtrip :', zk.unpack(packed).length === data.length ? 'OK' : 'MISMATCH');
