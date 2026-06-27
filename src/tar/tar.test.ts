import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tar, untar, tarGz, untarGz, tarZstd, untarZstd } from './index.js';
import { strToU8, strFromU8 } from '../string.js';

test('round-trips files, directories and metadata', () => {
	const archive = tar([
		{ name: 'a.txt', data: strToU8('hello'), mode: 0o644, mtime: new Date(1_700_000_000_000) },
		{ name: 'dir/', type: 'directory', mode: 0o755 },
		{ name: 'dir/b.json', data: strToU8('{"x":1}'), uid: 501, gid: 20 }
	]);
	const out = untar(archive);
	expect(out.map((e) => e.name)).toEqual(['a.txt', 'dir/', 'dir/b.json']);
	expect(strFromU8(out[0]!.data)).toBe('hello');
	expect(out[0]!.mode).toBe(0o644);
	expect(out[0]!.mtime.getTime()).toBe(1_700_000_000_000);
	expect(out[1]!.type).toBe('directory');
	expect(out[2]!.uid).toBe(501);
	expect(strFromU8(out[2]!.data)).toBe('{"x":1}');
});

test('archive length is a multiple of 512 and ends with two zero blocks', () => {
	const archive = tar([{ name: 'x', data: strToU8('y') }]);
	expect(archive.length % 512).toBe(0);
	const tail = archive.subarray(archive.length - 1024);
	expect(tail.every((b) => b === 0)).toBe(true);
});

test('handles paths longer than 100 bytes via PAX', () => {
	const long = 'nested/' + 'segment/'.repeat(20) + 'file.txt';
	const archive = tar([{ name: long, data: strToU8('deep') }]);
	const out = untar(archive);
	expect(out[0]!.name).toBe(long);
	expect(strFromU8(out[0]!.data)).toBe('deep');
});

test('tarGz / tarZstd round-trip', async () => {
	const entries = [{ name: 'log.txt', data: strToU8('event '.repeat(500)) }];
	expect(strFromU8((await untarGz(await tarGz(entries)))[0]!.data)).toBe('event '.repeat(500));
	expect(strFromU8((await untarZstd(await tarZstd(entries)))[0]!.data)).toBe('event '.repeat(500));
});

const hasTar = spawnSync('tar', ['--version']).status === 0;

test.if(hasTar)('interop: Unix tar extracts a ZipKit archive', () => {
	const dir = mkdtempSync(join(tmpdir(), 'zk-tar-'));
	try {
		const archive = tar([
			{ name: 'readme.txt', data: strToU8('from zipkit') },
			{ name: 'sub/note.md', data: strToU8('# hi') }
		]);
		const path = join(dir, 'a.tar');
		writeFileSync(path, archive);
		const res = spawnSync('tar', ['-xf', path, '-C', dir]);
		expect(res.status).toBe(0);
		expect(readFileSync(join(dir, 'readme.txt'), 'utf8')).toBe('from zipkit');
		expect(readFileSync(join(dir, 'sub/note.md'), 'utf8')).toBe('# hi');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test.if(hasTar)('interop: ZipKit reads an archive produced by Unix tar', () => {
	const dir = mkdtempSync(join(tmpdir(), 'zk-tar-'));
	try {
		writeFileSync(join(dir, 'one.txt'), 'unix one');
		writeFileSync(join(dir, 'two.txt'), 'unix two');
		const path = join(dir, 'u.tar');
		const res = spawnSync('tar', ['-cf', path, '-C', dir, 'one.txt', 'two.txt']);
		expect(res.status).toBe(0);
		const out = untar(readFileSync(path));
		const byName = Object.fromEntries(out.filter((e) => e.type === 'file').map((e) => [e.name, strFromU8(e.data)]));
		expect(byName['one.txt']).toBe('unix one');
		expect(byName['two.txt']).toBe('unix two');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
