import { test, expect } from 'bun:test';
import { zip, unzip, listEntries } from './index.js';
import { zip as rootZip, unzip as rootUnzip } from '../index.js';
import { strToU8, strFromU8 } from '../string.js';

test('roundtrips multiple files with mixed methods', async () => {
	const entries = [
		{ name: 'a.txt', data: strToU8('alpha '.repeat(100)), method: 'deflate' as const },
		{ name: 'nested/b.json', data: strToU8(JSON.stringify({ x: 1 }).repeat(50)), method: 'zstd' as const },
		{ name: 'c.bin', data: new Uint8Array([0, 1, 2, 3, 255]), method: 'store' as const }
	];
	const archive = await zip(entries);
	const back = await unzip(archive);
	expect(back.map((e) => e.name).sort()).toEqual(['a.txt', 'c.bin', 'nested/b.json']);
	for (const e of entries) {
		const got = back.find((x) => x.name === e.name)!;
		expect(got.data).toEqual(e.data);
	}
});

test('preserves mtime, unix permissions and comments', async () => {
	const mtime = new Date('2026-03-04T05:06:08');
	const archive = await zip([
		{ name: 'f.txt', data: strToU8('hi'), mtime, unixPermissions: 0o754, comment: 'a note' }
	]);
	const [entry] = await unzip(archive);
	expect(entry!.unixPermissions).toBe(0o754);
	expect(entry!.comment).toBe('a note');
	// DOS time has 2-second resolution.
	expect(Math.abs(entry!.mtime.getTime() - mtime.getTime())).toBeLessThan(2000);
});

test('filter avoids decompressing unwanted entries', async () => {
	const archive = await zip([
		{ name: 'keep.json', data: strToU8('{"k":1}') },
		{ name: 'skip.txt', data: strToU8('nope') }
	]);
	const back = await unzip(archive, { filter: (e) => e.name.endsWith('.json') });
	expect(back).toHaveLength(1);
	expect(back[0]!.name).toBe('keep.json');
});

test('listEntries reports metadata without decompressing', async () => {
	const archive = await zip([{ name: 'big.txt', data: strToU8('x'.repeat(5000)) }]);
	const list = await listEntries(archive);
	expect(list[0]!.name).toBe('big.txt');
	expect(list[0]!.size).toBe(5000);
	expect(list[0]!.compressedSize).toBeLessThan(5000);
});

test('records the stored crc32 of the original data', async () => {
	const data = strToU8('checksum me');
	const [entry] = await unzip(await zip([{ name: 'x', data }]));
	expect(entry!.crc32).toBeGreaterThan(0);
});

test('engine crc32 matches the known IEEE value for "123456789"', async () => {
	// The canonical CRC-32 check value (0xCBF43926) for "123456789".
	const [entry] = await unzip(await zip([{ name: 'check', data: strToU8('123456789') }]));
	expect(entry!.crc32 >>> 0).toBe(0xcbf43926);
});

test('parallel and single-threaded zip produce byte-identical archives', async () => {
	// A fixed mtime keeps the DOS timestamps stable across both runs.
	const mtime = new Date('2026-01-02T03:04:06');
	const entries = Array.from({ length: 6 }, (_, i) => ({
		name: `f-${i}.txt`,
		data: strToU8(`payload ${i} `.repeat(8000)),
		method: (i % 2 ? 'zstd' : 'deflate') as const,
		mtime
	}));
	const parallel = await zip(entries, { parallel: true });
	const inline = await zip(entries, { parallel: false });
	expect(parallel).toEqual(inline);
	// And it still roundtrips.
	const back = await unzip(parallel);
	expect(back).toHaveLength(6);
	expect(strFromU8(back[3]!.data)).toContain('payload 3');
});

test('handles many entries', async () => {
	const entries = Array.from({ length: 500 }, (_, i) => ({
		name: `file-${i}.txt`,
		data: strToU8(`content ${i} `.repeat(10))
	}));
	const archive = await zip(entries);
	const back = await unzip(archive);
	expect(back).toHaveLength(500);
	expect(strFromU8(back[123]!.data)).toContain('content 123');
});

test('empty file entry roundtrips', async () => {
	const back = await unzip(await zip([{ name: 'empty', data: new Uint8Array(0) }]));
	expect(back[0]!.data).toEqual(new Uint8Array(0));
	expect(back[0]!.size).toBe(0);
});

test('zip and unzip are exported from the package root', async () => {
	const archive = await rootZip([{ name: 'root.txt', data: strToU8('root export') }]);
	const [entry] = await rootUnzip(archive);
	expect(strFromU8(entry!.data)).toBe('root export');
});
