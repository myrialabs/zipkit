import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { xz, unxz } from './xz.js';
import { compress, decompress } from '../compress.js';
import { detectFormat } from '../detect.js';
import { strToU8, strFromU8 } from '../string.js';

const data = strToU8('xz roundtrip sample — '.repeat(400));

test('round-trips through the engine', async () => {
	const packed = await xz(data);
	expect(detectFormat(packed)).toBe('xz');
	expect(await unxz(packed)).toEqual(data);
});

test('decompress() auto-detects xz', async () => {
	expect(await decompress(await xz(data))).toEqual(data);
});

test('empty input round-trips', async () => {
	expect(await unxz(await xz(new Uint8Array(0)))).toEqual(new Uint8Array(0));
});

test('large input round-trips (decode spans the growth path)', async () => {
	// ~1.8 MB of varied JSON — the decoded output far exceeds any initial buffer,
	// which previously tripped a too-strict end-of-stream status check.
	const parts: string[] = [];
	for (let i = 0; i < 20_000; i++) parts.push(JSON.stringify({ id: i, name: `item ${i}`, tags: ['a', 'b', 'c'] }));
	const big = strToU8(parts.join('\n'));
	const out = await unxz(await xz(big));
	expect(out.length).toBe(big.length);
	expect(out).toEqual(big);
});

test('compress(data, "zstd") still unaffected by xz wiring', async () => {
	expect(await decompress(await compress(data, 'zstd'))).toEqual(data);
});

const hasXz = spawnSync('xz', ['--version']).status === 0;

test.if(hasXz)('interop: ZipKit reads a stream produced by the xz CLI', async () => {
	const res = spawnSync('xz', ['-zc'], { input: Buffer.from(data) });
	expect(res.status).toBe(0);
	expect(strFromU8(await unxz(new Uint8Array(res.stdout)))).toBe(strFromU8(data));
});

test.if(hasXz)('interop: the xz CLI reads a stream produced by ZipKit', async () => {
	const ours = await xz(data);
	const res = spawnSync('xz', ['-dc'], { input: Buffer.from(ours) });
	expect(res.status).toBe(0);
	expect(new Uint8Array(res.stdout)).toEqual(data);
});
