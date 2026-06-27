import { test, expect } from 'bun:test';
import { compressDelta, applyDelta } from './delta.js';
import { zstd } from './codecs/zstd.js';
import { strToU8, strFromU8 } from './string.js';

test('round-trips a small edit against a base', async () => {
	const base = strToU8('the quick brown fox jumps over the lazy dog\n'.repeat(40));
	const target = strToU8('the quick brown fox jumps over the lazy dog\n'.repeat(40) + 'one new appended line\n');
	const patch = await compressDelta(base, target);
	expect(strFromU8(await applyDelta(base, patch))).toBe(strFromU8(target));
});

test('a near-identical revision yields a far smaller patch than standalone zstd', async () => {
	const lines: string[] = [];
	for (let i = 0; i < 500; i++) lines.push(`${i} ${1_700_000_000 + i} info request handled ok`);
	const base = strToU8(lines.join('\n'));
	lines.push('500 1700000500 info one more request handled ok'); // append one line
	const target = strToU8(lines.join('\n'));

	const patch = await compressDelta(base, target);
	const standalone = (await zstd(target, { level: 19 })).length;
	expect(patch.length).toBeLessThan(standalone / 2);
	expect(strFromU8(await applyDelta(base, patch))).toBe(strFromU8(target));
});

test('round-trips a completely different target (delta degrades gracefully)', async () => {
	const base = strToU8('aaaaaaaaaa');
	const target = strToU8('a totally unrelated payload of bytes 12345');
	expect(strFromU8(await applyDelta(base, await compressDelta(base, target)))).toBe(strFromU8(target));
});
