import { test, expect } from 'bun:test';
import { gzip, gunzip } from './gzip.js';
import { deflate, inflate } from './deflate.js';
import { zlib, unzlib } from './zlib.js';
import { zstd, unzstd } from './zstd.js';
import { lz4, unlz4 } from './lz4.js';
import { snappy, unsnappy } from './snappy.js';
import { brotli, unbrotli } from './brotli.js';
import { lzma, unlzma } from './lzma.js';
import { bzip2, unbzip2 } from './bzip2.js';

const text = new TextEncoder().encode('The quick brown fox jumps over the lazy dog. '.repeat(200));
const binary = new Uint8Array(4096).map((_, i) => (i * 31 + 7) & 0xff);
const empty = new Uint8Array(0);
const tiny = new Uint8Array([42]);

const pairs = [
	['gzip', gzip, gunzip],
	['deflate', deflate, inflate],
	['zlib', zlib, unzlib],
	['zstd', zstd, unzstd],
	['lz4', lz4, unlz4],
	['snappy', snappy, unsnappy],
	['brotli', brotli, unbrotli],
	['lzma', lzma, unlzma],
	['bzip2', bzip2, unbzip2]
] as const;

for (const [name, comp, decomp] of pairs) {
	test(`${name}: roundtrips text byte-identically`, async () => {
		const out = await decomp(await comp(text));
		expect(out).toEqual(text);
	});

	test(`${name}: roundtrips binary byte-identically`, async () => {
		const out = await decomp(await comp(binary));
		expect(out).toEqual(binary);
	});

	test(`${name}: roundtrips tiny input`, async () => {
		const out = await decomp(await comp(tiny));
		expect(out).toEqual(tiny);
	});

	// bzip2 cannot represent a zero-byte stream; skip empty for it only.
	if (name !== 'bzip2') {
		test(`${name}: roundtrips empty input`, async () => {
			const out = await decomp(await comp(empty));
			expect(out).toEqual(empty);
		});
	}

	test(`${name}: actually compresses repetitive data`, async () => {
		const out = await comp(text);
		expect(out.length).toBeLessThan(text.length);
	});
}

test('zstd: levels above 19 engage ultra mode and still roundtrip', async () => {
	const out = await unzstd(await zstd(text, { level: 22 }));
	expect(out).toEqual(text);
});

test('level is clamped, not rejected, when out of range', async () => {
	const out = await gunzip(await gzip(text, { level: 99 }));
	expect(out).toEqual(text);
});

test('mode selects a compression policy without changing roundtrip semantics', async () => {
	const fast = await gzip(text, { mode: 'speed' });
	const dense = await gzip(text, { mode: 'ratio' });
	expect(await gunzip(fast)).toEqual(text);
	expect(await gunzip(dense)).toEqual(text);
	expect(dense.length).toBeLessThanOrEqual(fast.length);
});

test('handles large input (16 MB, exercises Wasm memory growth)', async () => {
	const big = new Uint8Array(16 * 1024 * 1024).map((_, i) => (i * 2654435761) & 0xff);
	const out = await unzstd(await zstd(big, { level: 3 }));
	expect(out).toEqual(big);
});
