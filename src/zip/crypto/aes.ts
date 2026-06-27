/**
 * Compact AES (128/192/256) block cipher in CTR mode.
 *
 * WinZip AES-encrypted ZIP entries use AES in CTR mode with a 16-byte counter
 * that increments **little-endian** starting at 1 — which the WebCrypto
 * `AES-CTR` primitive (big-endian counter, no raw-block/ECB access) cannot
 * produce. So the keystream is built here from a small, dependency-free,
 * synchronous AES, while the standard parts (PBKDF2, HMAC-SHA1) still come from
 * WebCrypto in the caller. Tables are derived once on first use.
 */

let SBOX: Uint8Array;
let T0: Uint32Array, T1: Uint32Array, T2: Uint32Array, T3: Uint32Array;
const RCON = new Uint32Array([0x01000000, 0x02000000, 0x04000000, 0x08000000, 0x10000000, 0x20000000, 0x40000000, 0x80000000, 0x1b000000, 0x36000000]);

/** Build the S-box and the four encryption T-tables (GF(2^8) arithmetic). */
function buildTables(): void {
	SBOX = new Uint8Array(256);
	const inv = new Uint8Array(256);
	let p = 1;
	let q = 1;
	// Generate multiplicative inverses via a generator (3) over GF(2^8).
	do {
		p = p ^ (p << 1) ^ (p & 0x80 ? 0x11b : 0);
		p &= 0xff;
		q ^= q << 1;
		q ^= q << 2;
		q ^= q << 4;
		q &= 0xff;
		if (q & 0x80) q ^= 0x09;
		q &= 0xff;
		inv[p] = q;
	} while (p !== 1);
	SBOX[0] = 0x63;
	for (let i = 0; i < 256; i++) {
		let x = inv[i]!;
		let s = x;
		for (let k = 0; k < 4; k++) {
			s = ((s << 1) | (s >>> 7)) & 0xff;
			x ^= s;
		}
		x ^= 0x63;
		SBOX[i] = i === 0 ? 0x63 : x;
	}

	T0 = new Uint32Array(256);
	T1 = new Uint32Array(256);
	T2 = new Uint32Array(256);
	T3 = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		const s = SBOX[i]!;
		const s2 = xtime(s);
		const s3 = s2 ^ s;
		T0[i] = ((s2 << 24) | (s << 16) | (s << 8) | s3) >>> 0;
		T1[i] = ((s3 << 24) | (s2 << 16) | (s << 8) | s) >>> 0;
		T2[i] = ((s << 24) | (s3 << 16) | (s2 << 8) | s) >>> 0;
		T3[i] = ((s << 24) | (s << 16) | (s3 << 8) | s2) >>> 0;
	}
}

function xtime(a: number): number {
	return ((a << 1) ^ (a & 0x80 ? 0x11b : 0)) & 0xff;
}

/** An AES cipher with an expanded key, exposing single-block ECB encryption. */
export class Aes {
	private rk: Uint32Array;
	private rounds: number;

	constructor(key: Uint8Array) {
		if (!SBOX) buildTables();
		if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
			throw new Error(`AES key must be 16/24/32 bytes, got ${key.length}`);
		}
		const Nk = key.length / 4;
		this.rounds = Nk + 6;
		const total = 4 * (this.rounds + 1);
		const rk = new Uint32Array(total);
		for (let i = 0; i < Nk; i++) {
			rk[i] = ((key[4 * i]! << 24) | (key[4 * i + 1]! << 16) | (key[4 * i + 2]! << 8) | key[4 * i + 3]!) >>> 0;
		}
		for (let i = Nk; i < total; i++) {
			let temp = rk[i - 1]!;
			if (i % Nk === 0) {
				temp = (subWord((temp << 8) | (temp >>> 24)) ^ RCON[i / Nk - 1]!) >>> 0;
			} else if (Nk > 6 && i % Nk === 4) {
				temp = subWord(temp);
			}
			rk[i] = (rk[i - Nk]! ^ temp) >>> 0;
		}
		this.rk = rk;
	}

	/** Encrypt one 16-byte block of `src` at `srcOff` into `dst` at `dstOff`. */
	encryptBlock(src: Uint8Array, srcOff: number, dst: Uint8Array, dstOff: number): void {
		const rk = this.rk;
		let s0 = ((src[srcOff]! << 24) | (src[srcOff + 1]! << 16) | (src[srcOff + 2]! << 8) | src[srcOff + 3]!) ^ rk[0]!;
		let s1 = ((src[srcOff + 4]! << 24) | (src[srcOff + 5]! << 16) | (src[srcOff + 6]! << 8) | src[srcOff + 7]!) ^ rk[1]!;
		let s2 = ((src[srcOff + 8]! << 24) | (src[srcOff + 9]! << 16) | (src[srcOff + 10]! << 8) | src[srcOff + 11]!) ^ rk[2]!;
		let s3 = ((src[srcOff + 12]! << 24) | (src[srcOff + 13]! << 16) | (src[srcOff + 14]! << 8) | src[srcOff + 15]!) ^ rk[3]!;

		let rki = 4;
		for (let round = 1; round < this.rounds; round++) {
			const t0 = (T0[(s0 >>> 24) & 0xff]! ^ T1[(s1 >>> 16) & 0xff]! ^ T2[(s2 >>> 8) & 0xff]! ^ T3[s3 & 0xff]! ^ rk[rki]!) >>> 0;
			const t1 = (T0[(s1 >>> 24) & 0xff]! ^ T1[(s2 >>> 16) & 0xff]! ^ T2[(s3 >>> 8) & 0xff]! ^ T3[s0 & 0xff]! ^ rk[rki + 1]!) >>> 0;
			const t2 = (T0[(s2 >>> 24) & 0xff]! ^ T1[(s3 >>> 16) & 0xff]! ^ T2[(s0 >>> 8) & 0xff]! ^ T3[s1 & 0xff]! ^ rk[rki + 2]!) >>> 0;
			const t3 = (T0[(s3 >>> 24) & 0xff]! ^ T1[(s0 >>> 16) & 0xff]! ^ T2[(s1 >>> 8) & 0xff]! ^ T3[s2 & 0xff]! ^ rk[rki + 3]!) >>> 0;
			s0 = t0;
			s1 = t1;
			s2 = t2;
			s3 = t3;
			rki += 4;
		}

		// Final round uses the S-box directly (no mix-columns).
		dst[dstOff] = (SBOX[(s0 >>> 24) & 0xff]! ^ (rk[rki]! >>> 24)) & 0xff;
		dst[dstOff + 1] = (SBOX[(s1 >>> 16) & 0xff]! ^ (rk[rki]! >>> 16)) & 0xff;
		dst[dstOff + 2] = (SBOX[(s2 >>> 8) & 0xff]! ^ (rk[rki]! >>> 8)) & 0xff;
		dst[dstOff + 3] = (SBOX[s3 & 0xff]! ^ rk[rki]!) & 0xff;
		dst[dstOff + 4] = (SBOX[(s1 >>> 24) & 0xff]! ^ (rk[rki + 1]! >>> 24)) & 0xff;
		dst[dstOff + 5] = (SBOX[(s2 >>> 16) & 0xff]! ^ (rk[rki + 1]! >>> 16)) & 0xff;
		dst[dstOff + 6] = (SBOX[(s3 >>> 8) & 0xff]! ^ (rk[rki + 1]! >>> 8)) & 0xff;
		dst[dstOff + 7] = (SBOX[s0 & 0xff]! ^ rk[rki + 1]!) & 0xff;
		dst[dstOff + 8] = (SBOX[(s2 >>> 24) & 0xff]! ^ (rk[rki + 2]! >>> 24)) & 0xff;
		dst[dstOff + 9] = (SBOX[(s3 >>> 16) & 0xff]! ^ (rk[rki + 2]! >>> 16)) & 0xff;
		dst[dstOff + 10] = (SBOX[(s0 >>> 8) & 0xff]! ^ (rk[rki + 2]! >>> 8)) & 0xff;
		dst[dstOff + 11] = (SBOX[s1 & 0xff]! ^ rk[rki + 2]!) & 0xff;
		dst[dstOff + 12] = (SBOX[(s3 >>> 24) & 0xff]! ^ (rk[rki + 3]! >>> 24)) & 0xff;
		dst[dstOff + 13] = (SBOX[(s0 >>> 16) & 0xff]! ^ (rk[rki + 3]! >>> 16)) & 0xff;
		dst[dstOff + 14] = (SBOX[(s1 >>> 8) & 0xff]! ^ (rk[rki + 3]! >>> 8)) & 0xff;
		dst[dstOff + 15] = (SBOX[s2 & 0xff]! ^ rk[rki + 3]!) & 0xff;
	}
}

function subWord(w: number): number {
	return ((SBOX[(w >>> 24) & 0xff]! << 24) | (SBOX[(w >>> 16) & 0xff]! << 16) | (SBOX[(w >>> 8) & 0xff]! << 8) | SBOX[w & 0xff]!) >>> 0;
}

/**
 * Encrypt/decrypt `data` with WinZip's AES-CTR: a 16-byte little-endian counter
 * starting at 1, one keystream block per 16 bytes, XORed into the data. CTR is
 * symmetric, so the same call decrypts.
 */
export function aesCtrXor(cipher: Aes, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(data.length);
	const counter = new Uint8Array(16);
	const keystream = new Uint8Array(16);
	let nonce = 1; // little-endian counter, incremented per block
	for (let off = 0; off < data.length; off += 16) {
		// Write the little-endian counter into the low bytes (WinZip uses a 64-bit
		// counter in practice; 32 bits is ample for any in-memory buffer).
		counter[0] = nonce & 0xff;
		counter[1] = (nonce >>> 8) & 0xff;
		counter[2] = (nonce >>> 16) & 0xff;
		counter[3] = (nonce >>> 24) & 0xff;
		cipher.encryptBlock(counter, 0, keystream, 0);
		const n = Math.min(16, data.length - off);
		for (let i = 0; i < n; i++) out[off + i] = data[off + i]! ^ keystream[i]!;
		nonce++;
	}
	return out;
}
