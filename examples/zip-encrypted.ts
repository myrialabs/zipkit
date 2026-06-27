/**
 * Password-protected ZIP with WinZip AES-256 (AE-2). Reads back with the same
 * password; 7-Zip and WinZip can open it too.
 *
 * Run with:  bun run examples/zip-encrypted.ts
 */

import { zip, unzip } from '../src/zip/index.js';
import { strToU8, strFromU8 } from '../src/index.js';

const password = 'correct horse battery staple';

const archive = await zip(
	[
		{ name: 'secret.txt', data: strToU8('Top secret contents.\n') },
		{ name: 'data.json', data: strToU8(JSON.stringify({ token: 'abc123' })) }
	],
	{ password }
);

await Bun.write('example-encrypted.zip', archive);
console.log('wrote example-encrypted.zip:', archive.length, 'bytes (AES-256)\n');

// Right password → contents.
const files = await unzip(archive, { password });
for (const e of files) console.log(`  ${e.name}: ${strFromU8(e.data).trim()}`);

// Wrong password → rejected before any plaintext is produced.
try {
	await unzip(archive, { password: 'guess' });
} catch (err) {
	console.log('\nwrong password →', (err as Error).message);
}
