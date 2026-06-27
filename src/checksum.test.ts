import { test, expect } from 'bun:test';
import { crc32, verifyChecksum } from './checksum.js';
import { zip, unzip } from './zip/index.js';
import { strToU8 } from './string.js';

const data = strToU8('the quick brown fox '.repeat(50));

test('crc32 matches the well-known IEEE check value', async () => {
	// CRC-32 of "123456789" is 0xCBF43926.
	expect(await crc32(strToU8('123456789'))).toBe(0xcbf43926);
});

test('crc32 chains across chunks via seed', async () => {
	const whole = await crc32(data);
	const half = data.length >> 1;
	const chained = await crc32(data.subarray(half), await crc32(data.subarray(0, half)));
	expect(chained).toBe(whole);
});

test('verifyChecksum confirms and rejects', async () => {
	const sum = await crc32(data);
	expect(await verifyChecksum(data, sum)).toBe(true);
	expect(await verifyChecksum(data, sum ^ 0xff)).toBe(false);
});

test('unzip({ verify: true }) passes on a clean archive', async () => {
	const archive = await zip([{ name: 'a.txt', data }]);
	const out = await unzip(archive, { verify: true });
	expect(out[0]!.data).toEqual(data);
});

test('unzip({ verify: true }) throws on corrupted entry bytes', async () => {
	const archive = await zip([{ name: 'a.txt', data, method: 'store' }]);
	// Flip a byte inside the stored payload (just past the local header + name).
	const corrupt = archive.slice();
	corrupt[40] = corrupt[40]! ^ 0xff;
	expect(unzip(corrupt, { verify: true })).rejects.toThrow(/Checksum mismatch/);
});
