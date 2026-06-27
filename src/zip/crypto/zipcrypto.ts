/**
 * Legacy PKWARE "ZipCrypto" — decryption only, for reading old encrypted
 * archives. The cipher is weak and long deprecated, so ZipKit never *writes* it
 * (new encrypted archives use WinZip AES, {@link import('./winzip.js')}); this
 * exists purely for read compatibility with historical files.
 */

import { ZipKitError } from '../../types.js';

/** CRC-32 byte-update table (IEEE 802.3), built once. */
const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32Update(crc: number, byte: number): number {
	return (CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;
}

/** The three rolling keys of the ZipCrypto cipher. */
interface Keys {
	k0: number;
	k1: number;
	k2: number;
}

function initKeys(password: string): Keys {
	const keys: Keys = { k0: 0x12345678, k1: 0x23456789, k2: 0x34567890 };
	for (const byte of new TextEncoder().encode(password)) updateKeys(keys, byte);
	return keys;
}

function updateKeys(keys: Keys, byte: number): void {
	keys.k0 = crc32Update(keys.k0, byte);
	keys.k1 = (keys.k1 + (keys.k0 & 0xff)) >>> 0;
	keys.k1 = (Math.imul(keys.k1, 134775813) + 1) >>> 0;
	keys.k2 = crc32Update(keys.k2, keys.k1 >>> 24);
}

function decryptByte(keys: Keys): number {
	const temp = (keys.k2 | 2) & 0xffff;
	return (Math.imul(temp, temp ^ 1) >> 8) & 0xff;
}

/**
 * Decrypt a ZipCrypto entry: the raw bytes are a 12-byte encryption header
 * followed by the (still-compressed) ciphertext. `checkByte` is the expected
 * high byte of the verification value — the CRC-32's top byte, or the DOS time's
 * high byte when the entry used a data descriptor. Throws on a wrong password.
 */
export function zipCryptoDecrypt(data: Uint8Array, password: string, checkByte: number): Uint8Array {
	if (data.length < 12) throw new ZipKitError('ZipCrypto entry is too short (missing encryption header)');
	const keys = initKeys(password);
	const header = new Uint8Array(12);
	for (let i = 0; i < 12; i++) {
		const c = (data[i]! ^ decryptByte(keys)) & 0xff;
		updateKeys(keys, c);
		header[i] = c;
	}
	if (header[11] !== (checkByte & 0xff)) {
		throw new ZipKitError('Wrong password for ZipCrypto entry (verification byte mismatch)');
	}
	const out = new Uint8Array(data.length - 12);
	for (let i = 12; i < data.length; i++) {
		const c = (data[i]! ^ decryptByte(keys)) & 0xff;
		updateKeys(keys, c);
		out[i - 12] = c;
	}
	return out;
}
