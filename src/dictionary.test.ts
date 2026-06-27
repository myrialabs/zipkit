import { test, expect } from 'bun:test';
import { trainDictionary, compressWithDictionary, decompressWithDictionary } from './dictionary.js';
import { zstd } from './codecs/zstd.js';
import { strToU8 } from './string.js';

// Many small, structurally-similar JSON records — the dictionary use case.
function makeSamples(n: number): Uint8Array[] {
	const out: Uint8Array[] = [];
	for (let i = 0; i < n; i++) {
		out.push(strToU8(JSON.stringify({ ts: 1_700_000_000 + i, level: 'info', svc: 'api', msg: `request ${i} handled`, ok: true })));
	}
	return out;
}

test('trains a dictionary and round-trips a payload against it', async () => {
	const samples = makeSamples(300);
	const dict = await trainDictionary(samples);
	expect(dict.length).toBeGreaterThan(0);

	const record = samples[42]!;
	const packed = await compressWithDictionary(record, dict);
	expect(await decompressWithDictionary(packed, dict)).toEqual(record);
});

test('dictionary beats plain zstd on tiny similar payloads', async () => {
	const samples = makeSamples(300);
	const dict = await trainDictionary(samples);
	const record = samples[7]!;

	const withDict = (await compressWithDictionary(record, dict)).length;
	const plain = (await zstd(record, { level: 19 })).length;
	// The shared JSON shape lives in the dictionary, so the frame is much smaller.
	expect(withDict).toBeLessThan(plain);
});

test('throws on empty sample set', async () => {
	expect(trainDictionary([])).rejects.toThrow(/at least one sample/);
});
