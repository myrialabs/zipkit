import { test, expect } from 'bun:test';
import { strToU8, strFromU8, DecodeUTF8, EncodeUTF8 } from './string.js';

test('UTF-8 roundtrip including multibyte code points', () => {
	const s = 'héllo — 世界 🚀';
	expect(strFromU8(strToU8(s))).toBe(s);
});

test('Latin-1 roundtrip is byte-exact for 0–255', () => {
	const bytes = new Uint8Array(256).map((_, i) => i);
	expect(strToU8(strFromU8(bytes, true), true)).toEqual(bytes);
});

test('streaming UTF-8 decoder reassembles split multibyte sequences', () => {
	const full = strToU8('café 世界');
	const mid = 4; // split inside a multibyte sequence
	const dec = new DecodeUTF8();
	let s = dec.push(full.subarray(0, mid));
	s += dec.end(full.subarray(mid));
	expect(s).toBe('café 世界');
});

test('streaming UTF-8 encoder matches one-shot encoding', () => {
	const enc = new EncodeUTF8();
	const a = enc.push('foo ');
	const b = enc.push('bar');
	const joined = new Uint8Array(a.length + b.length);
	joined.set(a);
	joined.set(b, a.length);
	expect(joined).toEqual(strToU8('foo bar'));
});
