import { test, expect } from 'bun:test';
import { presetCorpus } from './corpus.js';

test('preset corpus is deterministic across calls', () => {
	const a = presetCorpus(16 * 1024);
	const b = presetCorpus(16 * 1024);
	expect(a.map((d) => d.name)).toEqual(['text', 'json', 'log', 'binary']);
	for (let i = 0; i < a.length; i++) {
		expect(a[i]!.data).toEqual(b[i]!.data); // byte-identical run to run
	}
});

test('datasets are roughly the requested size and non-empty', () => {
	for (const d of presetCorpus(32 * 1024)) {
		expect(d.data.length).toBeGreaterThan(8 * 1024);
		expect(d.data.length).toBeLessThan(64 * 1024);
	}
});
