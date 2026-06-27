/**
 * Build & read a 7z archive (LZMA). Interoperates with 7-Zip both directions.
 *
 * Run with:  bun run examples/sevenzip-archive.ts
 */

import { sevenZip, unSevenZip } from '../src/sevenzip/index.js';
import { strToU8, strFromU8 } from '../src/index.js';

const archive = await sevenZip([
	{ name: 'notes.txt', data: strToU8('Compressed with ZipKit 7z (LZMA).\n'.repeat(50)) },
	{ name: 'data/log.txt', data: strToU8('event line\n'.repeat(500)) },
	{ name: 'raw.bin', data: new Uint8Array([1, 2, 3, 4, 5]), method: 'copy' }
]);

await Bun.write('example.7z', archive);
console.log('wrote example.7z:', archive.length, 'bytes\n');

for (const e of await unSevenZip(archive)) {
	console.log(`  ${e.name.padEnd(16)} ${e.size}B  ${strFromU8(e.data).slice(0, 24).replace(/\n/g, ' ')}…`);
}

// Tip: `7z x example.7z` (or `7zz x`) extracts this with the real 7-Zip tool.
