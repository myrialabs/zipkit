import { test, expect } from 'bun:test';
import JSZip from 'jszip';
import { zipStream } from './stream.js';
import { unzip } from './index.js';
import { strToU8, strFromU8 } from '../string.js';
import type { ZipEntryInput } from './index.js';

/** Drain a ReadableStream into one buffer. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const reader = stream.getReader();
	const parts: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		parts.push(value);
		total += value.length;
	}
	const out = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

test('streams an archive that unzip() reads back', async () => {
	const entries: ZipEntryInput[] = [
		{ name: 'a.txt', data: strToU8('first') },
		{ name: 'dir/b.json', data: strToU8('{"n":2}'), method: 'zstd' },
		{ name: 'c.bin', data: strToU8('x'.repeat(1000)), method: 'store' }
	];
	const archive = await drain(zipStream(entries));
	const out = await unzip(archive);
	expect(out.map((e) => e.name)).toEqual(['a.txt', 'dir/b.json', 'c.bin']);
	expect(strFromU8(out[0]!.data)).toBe('first');
	expect(strFromU8(out[1]!.data)).toBe('{"n":2}');
	expect(out[2]!.data.length).toBe(1000);
});

test('accepts an async iterable source', async () => {
	async function* gen(): AsyncGenerator<ZipEntryInput> {
		for (let i = 0; i < 5; i++) yield { name: `f${i}.txt`, data: strToU8(`body ${i}`) };
	}
	const archive = await drain(zipStream(gen()));
	const out = await unzip(archive);
	expect(out).toHaveLength(5);
	expect(strFromU8(out[4]!.data)).toBe('body 4');
});

test('interop: JSZip reads a streamed deflate archive', async () => {
	const archive = await drain(
		zipStream([{ name: 'hello.txt', data: strToU8('streamed via zipkit'), method: 'deflate' }])
	);
	const z = await JSZip.loadAsync(archive);
	expect(await z.file('hello.txt')!.async('string')).toBe('streamed via zipkit');
});

test('reports progress per entry', async () => {
	const seen: number[] = [];
	const archive = await drain(
		zipStream(
			[
				{ name: '1', data: strToU8('a') },
				{ name: '2', data: strToU8('b') }
			],
			{ onProgress: (n) => seen.push(n) }
		)
	);
	expect(await unzip(archive)).toHaveLength(2);
	expect(seen).toEqual([1, 2]);
});
