/**
 * Build & read tar archives — plain, .tar.gz, and .tar.zst.
 *
 * Run with:  bun run examples/tar-archive.ts
 */

import { tar, untar, tarGz, untarGz, tarZstd, untarZstd } from '../src/tar/index.js';
import { strToU8, strFromU8 } from '../src/index.js';

const entries = [
	{ name: 'readme.txt', data: strToU8('Hello from ZipKit tar!\n'), mode: 0o644 },
	{ name: 'src/', type: 'directory' as const },
	{ name: 'src/app.js', data: strToU8('console.log("hi")\n') }
];

// Plain tar — pure framing, no compression. Interops with the Unix `tar` CLI.
const plain = tar(entries);
await Bun.write('example.tar', plain);
console.log('example.tar:', plain.length, 'bytes');
for (const e of untar(plain)) {
	console.log(`  ${e.type.padEnd(9)} ${e.name.padEnd(16)} ${e.size}B`);
}

// Compressed tarballs — one call each, no manual piping.
const gz = await tarGz(entries);
const zst = await tarZstd(entries);
console.log('\n.tar.gz:', gz.length, 'bytes  ·  .tar.zst:', zst.length, 'bytes');

const fromGz = await untarGz(gz);
const fromZst = await untarZstd(zst);
console.log('round-trip .tar.gz:', strFromU8(fromGz[0]!.data).trim());
console.log('round-trip .tar.zst:', strFromU8(fromZst[2]!.data).trim());
