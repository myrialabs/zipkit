import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sevenZip, unSevenZip } from './index.js';
import { strToU8, strFromU8 } from '../string.js';

const sample = strToU8('seven-zip payload — '.repeat(200));

test('round-trips LZMA-coded entries', async () => {
	const archive = await sevenZip([
		{ name: 'a.txt', data: sample },
		{ name: 'dir/b.json', data: strToU8('{"k":1}') }
	]);
	const out = await unSevenZip(archive);
	expect(out.map((e) => e.name)).toEqual(['a.txt', 'dir/b.json']);
	expect(strFromU8(out[0]!.data)).toBe(strFromU8(sample));
	expect(strFromU8(out[1]!.data)).toBe('{"k":1}');
});

test('round-trips copy-coded entries', async () => {
	const archive = await sevenZip([{ name: 'raw.bin', data: sample, method: 'copy' }]);
	const out = await unSevenZip(archive);
	expect(out[0]!.data).toEqual(sample);
});

function sevenZipBin(): string | undefined {
	for (const cmd of ['7zz', '7z', '7za']) {
		const r = spawnSync(cmd, ['i']);
		if (r.status !== null && r.error === undefined) return cmd;
	}
	return undefined;
}
const SZ = sevenZipBin();

test.if(SZ !== undefined)('interop: 7-Zip lists and extracts a ZipKit archive', () => {
	const dir = mkdtempSync(join(tmpdir(), 'zk-7z-'));
	try {
		return (async () => {
			const archive = await sevenZip([
				{ name: 'hello.txt', data: strToU8('from zipkit 7z') },
				{ name: 'nums.txt', data: strToU8('0123456789'.repeat(100)) }
			]);
			const path = join(dir, 'a.7z');
			writeFileSync(path, archive);
			const res = spawnSync(SZ!, ['x', '-y', `-o${dir}`, path]);
			expect(res.status).toBe(0);
			expect(readFileSync(join(dir, 'hello.txt'), 'utf8')).toBe('from zipkit 7z');
			expect(readFileSync(join(dir, 'nums.txt'), 'utf8')).toBe('0123456789'.repeat(100));
		})();
	} finally {
		// Note: cleanup runs after the returned promise settles.
		setTimeout(() => rmSync(dir, { recursive: true, force: true }), 2000);
	}
});

async function makeWith7z(method: string): Promise<{ dir: string; archive: Uint8Array }> {
	const dir = mkdtempSync(join(tmpdir(), 'zk-7z-'));
	writeFileSync(join(dir, 'doc.txt'), 'lzma2 interop payload '.repeat(300));
	writeFileSync(join(dir, 'data.csv'), 'a,b,c\n'.repeat(500));
	const path = join(dir, 'made.7z');
	const res = spawnSync(SZ!, ['a', method, '-y', path, join(dir, 'doc.txt'), join(dir, 'data.csv')]);
	expect(res.status).toBe(0);
	return { dir, archive: new Uint8Array(readFileSync(path)) };
}

test.if(SZ !== undefined)('interop: ZipKit reads a 7-Zip LZMA2 archive (default)', async () => {
	const { dir, archive } = await makeWith7z('-m0=lzma2');
	try {
		const out = await unSevenZip(archive);
		const byName = Object.fromEntries(out.map((e) => [e.name.split('/').pop(), strFromU8(e.data)]));
		expect(byName['doc.txt']).toBe('lzma2 interop payload '.repeat(300));
		expect(byName['data.csv']).toBe('a,b,c\n'.repeat(500));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test.if(SZ !== undefined)('interop: ZipKit reads a 7-Zip LZMA1 archive', async () => {
	const { dir, archive } = await makeWith7z('-m0=lzma');
	try {
		const out = await unSevenZip(archive);
		const doc = out.find((e) => e.name.endsWith('doc.txt'))!;
		expect(strFromU8(doc.data)).toBe('lzma2 interop payload '.repeat(300));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test.if(SZ !== undefined)('interop: ZipKit reads a 7-Zip copy archive', async () => {
	const { dir, archive } = await makeWith7z('-m0=copy');
	try {
		const out = await unSevenZip(archive);
		const doc = out.find((e) => e.name.endsWith('doc.txt'))!;
		expect(strFromU8(doc.data)).toBe('lzma2 interop payload '.repeat(300));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
