import { test, expect } from 'bun:test';
import { pack, unpack } from './pack.js';
import { ZipKit } from './zipkit.js';

const data = new TextEncoder().encode('lorem ipsum dolor sit amet '.repeat(400));

test('pack() shrinks the input and unpack() reverses it', async () => {
	const packed = await pack(data);
	expect(packed.length).toBeLessThan(data.length);
	expect(await unpack(packed)).toEqual(data);
});

test('async pack and sync ZipKit.pack are interchangeable', async () => {
	const zk = await ZipKit.load();
	// async-packed → sync-unpacked
	expect(zk.unpack(await pack(data))).toEqual(data);
	// sync-packed → async-unpacked
	expect(await unpack(zk.pack(data))).toEqual(data);
});

test('unpack() rejects an unknown codec tag', async () => {
	const bogus = new Uint8Array([99, 1, 2, 3]);
	expect(unpack(bogus)).rejects.toThrow(/unknown codec tag/);
});
