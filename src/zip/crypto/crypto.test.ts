import { test, expect } from 'bun:test';
import { Aes } from './aes.js';
import { aesEncrypt, aesDecrypt } from './winzip.js';
import { strToU8, strFromU8 } from '../../string.js';

function hex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
function fromHex(s: string): Uint8Array {
	const out = new Uint8Array(s.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
	return out;
}

test('AES-256 matches the FIPS-197 known-answer vector', () => {
	const key = fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
	const pt = fromHex('00112233445566778899aabbccddeeff');
	const ct = new Uint8Array(16);
	new Aes(key).encryptBlock(pt, 0, ct, 0);
	expect(hex(ct)).toBe('8ea2b7ca516745bfeafc49904b496089');
});

test('AES-128 matches the FIPS-197 known-answer vector', () => {
	const key = fromHex('000102030405060708090a0b0c0d0e0f');
	const pt = fromHex('00112233445566778899aabbccddeeff');
	const ct = new Uint8Array(16);
	new Aes(key).encryptBlock(pt, 0, ct, 0);
	expect(hex(ct)).toBe('69c4e0d86a7b0430d8cdb78070b4c55a');
});

test('WinZip AE-2 encrypt/decrypt round-trips', async () => {
	const data = strToU8('top secret payload — '.repeat(50));
	const { payload, strength } = await aesEncrypt(data, 'correct horse battery staple');
	expect(strength).toBe(3);
	const back = await aesDecrypt(payload, 'correct horse battery staple', 3);
	expect(strFromU8(back)).toBe(strFromU8(data));
});

test('AE-2 decrypt rejects the wrong password', async () => {
	const { payload } = await aesEncrypt(strToU8('secret'), 'right-password');
	expect(aesDecrypt(payload, 'wrong-password', 3)).rejects.toThrow(/Wrong password/);
});

test('AE-2 decrypt detects tampering via the auth code', async () => {
	const { payload } = await aesEncrypt(strToU8('a'.repeat(100)), 'pw');
	payload[payload.length - 15] ^= 0xff; // flip a ciphertext byte
	expect(aesDecrypt(payload, 'pw', 3)).rejects.toThrow(/Authentication failed/);
});
