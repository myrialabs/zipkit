import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zip, unzip } from './index.js';
import { strToU8, strFromU8 } from '../string.js';

const secret = strToU8('classified — '.repeat(80));

test('AES round-trips through zip/unzip with the right password', async () => {
	const archive = await zip([{ name: 'secret.txt', data: secret }], { password: 'hunter2' });
	const out = await unzip(archive, { password: 'hunter2' });
	expect(strFromU8(out[0]!.data)).toBe(strFromU8(secret));
	expect(out[0]!.method).toBe(8); // real method surfaced (deflate), not 99
});

test('AES round-trips with the zstd method too', async () => {
	const archive = await zip([{ name: 'a', data: secret, method: 'zstd' }], { password: 'pw' });
	const out = await unzip(archive, { password: 'pw' });
	expect(out[0]!.data).toEqual(secret);
	expect(out[0]!.method).toBe(93);
});

test('wrong password is rejected', async () => {
	const archive = await zip([{ name: 'a', data: secret }], { password: 'right' });
	expect(unzip(archive, { password: 'wrong' })).rejects.toThrow(/Wrong password/);
});

test('encrypted entry without a password throws a clear error', async () => {
	const archive = await zip([{ name: 'a', data: secret }], { password: 'pw' });
	expect(unzip(archive)).rejects.toThrow(/encrypted/);
});

test('multiple encrypted entries each round-trip', async () => {
	const archive = await zip(
		[
			{ name: 'one.txt', data: strToU8('first secret') },
			{ name: 'two.txt', data: strToU8('second secret'), method: 'store' }
		],
		{ password: 's3cret' }
	);
	const out = await unzip(archive, { password: 's3cret' });
	expect(strFromU8(out[0]!.data)).toBe('first secret');
	expect(strFromU8(out[1]!.data)).toBe('second secret');
});

function sevenZipName(): string | undefined {
	for (const cmd of ['7z', '7zz', '7za']) {
		const r = spawnSync(cmd, ['i']);
		if (r.status !== null && r.error === undefined) return cmd;
	}
	return undefined;
}
const sevenZip = sevenZipName();

test.if(sevenZip !== undefined)('interop: 7-Zip extracts a ZipKit AES-256 archive', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'zk-enc-'));
	try {
		const archive = await zip([{ name: 'msg.txt', data: strToU8('aes interop ok') }], { password: 'pw123' });
		const path = join(dir, 'enc.zip');
		writeFileSync(path, archive);
		const res = spawnSync(sevenZip!, ['e', '-ppw123', '-y', `-o${dir}`, path]);
		expect(res.status).toBe(0);
		const extracted = spawnSync('cat', [join(dir, 'msg.txt')]).stdout.toString();
		expect(extracted).toBe('aes interop ok');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
