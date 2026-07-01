/**
 * Extract any archive with one API — `extractStream()` auto-detects the
 * container (ZIP here, then a .tar.gz) and yields entry chunks you can write
 * straight out, with a decompressed-size cap that stops zip bombs.
 *
 * Run with:  bun run examples/extract-stream.ts
 */

import { extractStream, zip, tar, gzip, strToU8, strFromU8, type ArchiveEntryChunk } from '../src/index.js';

/** Drain the stream into a name → text map, concatenating each entry's chunks. */
async function collect(stream: AsyncIterable<ArchiveEntryChunk>): Promise<Map<string, string>> {
	const parts = new Map<string, Uint8Array[]>();
	const out = new Map<string, string>();
	for await (const { info, chunk, done } of stream) {
		if (info.type === 'directory') {
			out.set(info.name, '<dir>');
			continue;
		}
		const acc = parts.get(info.name) ?? [];
		if (chunk.length) acc.push(chunk);
		parts.set(info.name, acc);
		if (done) out.set(info.name, strFromU8(Uint8Array.from(acc.flatMap((c) => [...c]))));
	}
	return out;
}

// A ZIP with mixed methods — extractStream detects it from the PK magic.
const zipBytes = await zip([
	{ name: 'notes/hello.txt', data: strToU8('hi from zip'), method: 'deflate' },
	{ name: 'data.json', data: strToU8('{"z":true}'), method: 'zstd' },
	{ name: 'empty/', data: new Uint8Array(0) }
]);
console.log('ZIP:');
for (const [name, text] of await collect(extractStream(zipBytes, { maxTotalBytes: 1 << 20 }))) {
	console.log(`  ${name.padEnd(18)} ${text}`);
}

// A gzipped tar — same call, auto-detected as tar.gz.
const tgz = await gzip(tar([{ name: 'a.txt', data: strToU8('inside a tarball') }]));
console.log('\n.tar.gz (same API):');
for (const [name, text] of await collect(extractStream(tgz))) {
	console.log(`  ${name.padEnd(18)} ${text}`);
}

// The cap rejects a bomb before it can allocate: 1 MB of zeros → tiny deflate.
const bomb = await zip([{ name: 'bomb.bin', data: new Uint8Array(1 << 20), method: 'deflate' }]);
try {
	for await (const _ of extractStream(bomb, { maxTotalBytes: 4096 })) void _;
} catch (err) {
	console.log('\ncap enforced:', (err as Error).message);
}
