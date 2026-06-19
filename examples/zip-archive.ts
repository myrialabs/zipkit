/**
 * Build a ZIP archive (mixed methods + metadata), write it, read it back.
 *
 * Run with:  bun run examples/zip-archive.ts
 */

import { zip, unzip, listEntries } from '../src/zip/index.js';
import { strToU8, strFromU8 } from '../src/index.js';

const archive = await zip([
	{ name: 'readme.txt', data: strToU8('Hello from ZipKit!\n'), unixPermissions: 0o644 },
	{ name: 'data/payload.json', data: strToU8(JSON.stringify({ ok: true }).repeat(100)), method: 'zstd' },
	{ name: 'bin/raw', data: new Uint8Array([1, 2, 3, 4, 5]), method: 'store', comment: 'uncompressed' }
]);

await Bun.write('example.zip', archive);
console.log('wrote example.zip:', archive.length, 'bytes\n');

console.log('listing (no decompression):');
for (const e of await listEntries(archive)) {
	console.log(`  ${e.name.padEnd(20)} ${e.size} → ${e.compressedSize} (method ${e.method})`);
}

console.log('\nextracting only .txt and .json:');
const wanted = await unzip(archive, { filter: (e) => /\.(txt|json)$/.test(e.name) });
for (const e of wanted) {
	console.log(`  ${e.name}: ${strFromU8(e.data).slice(0, 30)}…`);
}
