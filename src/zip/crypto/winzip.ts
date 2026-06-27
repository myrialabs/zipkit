/**
 * WinZip AES (AE-2) encryption for ZIP entries — AES-256 by default.
 *
 * Layout of an encrypted entry's payload: `salt || pwdVerify(2) || ciphertext ||
 * authCode(10)`. Keys come from PBKDF2-HMAC-SHA1 (1000 iterations) over the
 * password and salt; the data is AES-CTR encrypted and authenticated with a
 * truncated HMAC-SHA1. PBKDF2/HMAC use WebCrypto (standard, cross-runtime); the
 * CTR keystream uses {@link Aes} because WebCrypto's counter endianness differs
 * from WinZip's. Interoperates with 7-Zip / WinZip AES archives.
 */

import { Aes, aesCtrXor } from './aes.js';
import { ZipKitError } from '../../types.js';

/** AES strength codes used in the 0x9901 extra field. */
export type AesStrength = 1 | 2 | 3; // 128 / 192 / 256-bit

const KEY_BYTES: Record<AesStrength, number> = { 1: 16, 2: 24, 3: 32 };
const SALT_BYTES: Record<AesStrength, number> = { 1: 8, 2: 12, 3: 16 };
const MAC_BYTES = 10; // truncated HMAC-SHA1
const PBKDF2_ITERATIONS = 1000;

function subtle(): SubtleCrypto {
	const c = (globalThis as { crypto?: Crypto }).crypto;
	if (!c?.subtle) throw new ZipKitError('WebCrypto (crypto.subtle) is required for ZIP AES encryption');
	return c.subtle;
}

function randomBytes(n: number): Uint8Array {
	const c = (globalThis as { crypto?: Crypto }).crypto;
	if (!c?.getRandomValues) throw new ZipKitError('crypto.getRandomValues is required to create encrypted ZIPs');
	return c.getRandomValues(new Uint8Array(n));
}

/** Derive the AES key, MAC key, and 2-byte password verifier via PBKDF2. */
async function deriveKeys(
	password: string,
	salt: Uint8Array,
	strength: AesStrength
): Promise<{ aesKey: Uint8Array; macKey: Uint8Array; verifier: Uint8Array }> {
	const keyLen = KEY_BYTES[strength];
	const baseKey = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
	const bits = await subtle().deriveBits(
		{ name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-1' },
		baseKey,
		(keyLen * 2 + 2) * 8
	);
	const out = new Uint8Array(bits);
	return {
		aesKey: out.subarray(0, keyLen),
		macKey: out.subarray(keyLen, keyLen * 2),
		verifier: out.subarray(keyLen * 2, keyLen * 2 + 2)
	};
}

async function hmacSha1(macKey: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
	const key = await subtle().importKey('raw', macKey as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
	const sig = await subtle().sign('HMAC', key, data as BufferSource);
	return new Uint8Array(sig).subarray(0, MAC_BYTES);
}

/**
 * Encrypt already-compressed `data` as a WinZip AE-2 payload. Returns the bytes
 * that go where the compressed data would otherwise sit, plus the strength code
 * for the entry's 0x9901 extra field.
 */
export async function aesEncrypt(
	data: Uint8Array,
	password: string,
	strength: AesStrength = 3
): Promise<{ payload: Uint8Array; strength: AesStrength }> {
	const salt = randomBytes(SALT_BYTES[strength]);
	const { aesKey, macKey, verifier } = await deriveKeys(password, salt, strength);
	const ciphertext = aesCtrXor(new Aes(aesKey), data);
	const mac = await hmacSha1(macKey, ciphertext);

	const payload = new Uint8Array(salt.length + 2 + ciphertext.length + MAC_BYTES);
	payload.set(salt, 0);
	payload.set(verifier, salt.length);
	payload.set(ciphertext, salt.length + 2);
	payload.set(mac, salt.length + 2 + ciphertext.length);
	return { payload, strength };
}

/**
 * Decrypt a WinZip AE-2 payload back to the compressed bytes. Throws
 * {@link ZipKitError} on a wrong password (verifier mismatch) or a failed
 * authentication check (tampered/corrupt data).
 */
export async function aesDecrypt(payload: Uint8Array, password: string, strength: AesStrength): Promise<Uint8Array> {
	const saltLen = SALT_BYTES[strength];
	if (payload.length < saltLen + 2 + MAC_BYTES) throw new ZipKitError('Encrypted ZIP entry is too short to be valid AES');
	const salt = payload.subarray(0, saltLen);
	const storedVerifier = payload.subarray(saltLen, saltLen + 2);
	const ciphertext = payload.subarray(saltLen + 2, payload.length - MAC_BYTES);
	const storedMac = payload.subarray(payload.length - MAC_BYTES);

	const { aesKey, macKey, verifier } = await deriveKeys(password, salt, strength);
	if (verifier[0] !== storedVerifier[0] || verifier[1] !== storedVerifier[1]) {
		throw new ZipKitError('Wrong password for encrypted ZIP entry');
	}
	const mac = await hmacSha1(macKey, ciphertext);
	for (let i = 0; i < MAC_BYTES; i++) {
		if (mac[i] !== storedMac[i]) throw new ZipKitError('Authentication failed for encrypted ZIP entry (corrupt or tampered)');
	}
	return aesCtrXor(new Aes(aesKey), ciphertext);
}
