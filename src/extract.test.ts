import { describe, expect, test } from 'bun:test';

import { extractStream, type ArchiveEntryChunk } from './extract.js';
import { zip } from './zip/index.js';
import { tar } from './tar/index.js';
import { sevenZip } from './sevenzip/index.js';
import { gzip } from './codecs/gzip.js';
import { zstd } from './codecs/zstd.js';
import { strToU8, strFromU8 } from './string.js';

/** Drain a stream into a name -> bytes map, concatenating each entry's chunks. */
async function collect(stream: AsyncIterable<ArchiveEntryChunk>): Promise<Map<string, Uint8Array>> {
	const files = new Map<string, Uint8Array>();
	const buffers = new Map<string, Uint8Array[]>();
	for await (const { info, chunk, done } of stream) {
		if (info.type === 'directory') {
			files.set(info.name, new Uint8Array(0));
			continue;
		}
		const acc = buffers.get(info.name) ?? [];
		if (chunk.length) acc.push(chunk);
		buffers.set(info.name, acc);
		if (done) {
			const total = acc.reduce((n, c) => n + c.length, 0);
			const out = new Uint8Array(total);
			let off = 0;
			for (const c of acc) {
				out.set(c, off);
				off += c.length;
			}
			files.set(info.name, out);
		}
	}
	return files;
}

describe('extractStream — round-trips', () => {
	test('zip: deflate, store, and zstd entries', async () => {
		const archive = await zip([
			{ name: 'a.txt', data: strToU8('hello deflate'), method: 'deflate' },
			{ name: 'b.bin', data: strToU8('stored raw'), method: 'store' },
			{ name: 'c.json', data: strToU8('{"z":"zstd"}'), method: 'zstd' },
			{ name: 'dir/', data: new Uint8Array(0) }
		]);
		const files = await collect(extractStream(archive));
		expect(strFromU8(files.get('a.txt')!)).toBe('hello deflate');
		expect(strFromU8(files.get('b.bin')!)).toBe('stored raw');
		expect(strFromU8(files.get('c.json')!)).toBe('{"z":"zstd"}');
		expect(files.has('dir/')).toBe(true);
	});

	test('zip: AES-encrypted round-trips with the password', async () => {
		const archive = await zip([{ name: 's.txt', data: strToU8('secret') }], { password: 'pw' });
		const files = await collect(extractStream(archive, { password: 'pw' }));
		expect(strFromU8(files.get('s.txt')!)).toBe('secret');
	});

	test('zip: encrypted without a password throws', async () => {
		const archive = await zip([{ name: 's.txt', data: strToU8('secret') }], { password: 'pw' });
		await expect(collect(extractStream(archive))).rejects.toThrow(/encrypted/);
	});

	test('tar (raw)', async () => {
		const archive = tar([
			{ name: 'x.txt', data: strToU8('tar body') },
			{ name: 'sub/', type: 'directory' }
		]);
		const files = await collect(extractStream(archive));
		expect(strFromU8(files.get('x.txt')!)).toBe('tar body');
		expect(files.has('sub/')).toBe(true);
	});

	test('tar.gz auto-detected from a gzip wrapper', async () => {
		const archive = await gzip(tar([{ name: 'g.txt', data: strToU8('gz tar') }]));
		const files = await collect(extractStream(archive));
		expect(strFromU8(files.get('g.txt')!)).toBe('gz tar');
	});

	test('lone gzip stream surfaces as a single named entry', async () => {
		const archive = await gzip(strToU8('just a file'));
		const files = await collect(extractStream(archive, { entryName: 'note.txt' }));
		expect(strFromU8(files.get('note.txt')!)).toBe('just a file');
	});

	test('lone zstd stream (explicit format)', async () => {
		const archive = await zstd(strToU8('zstd file'));
		const files = await collect(extractStream(archive, { format: 'zstd', entryName: 'z.txt' }));
		expect(strFromU8(files.get('z.txt')!)).toBe('zstd file');
	});

	test('7z round-trips', async () => {
		const archive = await sevenZip([{ name: 'seven.txt', data: strToU8('7z body') }]);
		const files = await collect(extractStream(archive));
		expect(strFromU8(files.get('seven.txt')!)).toBe('7z body');
	});
});

describe('extractStream — safety', () => {
	test('filter skips rejected entries', async () => {
		const archive = await zip([
			{ name: 'keep.txt', data: strToU8('keep') },
			{ name: 'drop.txt', data: strToU8('drop') }
		]);
		const files = await collect(extractStream(archive, { filter: (e) => e.name === 'keep.txt' }));
		expect(files.has('keep.txt')).toBe(true);
		expect(files.has('drop.txt')).toBe(false);
	});

	test('maxTotalBytes rejects an oversized deflate entry mid-stream', async () => {
		// One highly-compressible megabyte, capped at 1 KB of output.
		const big = new Uint8Array(1024 * 1024); // all zeros → tiny deflate, huge inflate
		const archive = await zip([{ name: 'bomb.bin', data: big, method: 'deflate' }]);
		await expect(collect(extractStream(archive, { maxTotalBytes: 1024 }))).rejects.toThrow(/maxTotalBytes|remaining cap/);
	});

	test('signal aborts extraction', async () => {
		const controller = new AbortController();
		controller.abort();
		const archive = await zip([{ name: 'a.txt', data: strToU8('x') }]);
		await expect(collect(extractStream(archive, { signal: controller.signal }))).rejects.toThrow();
	});
});
