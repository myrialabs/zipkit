/**
 * Lossless image compression with QOI, then further squeezed with zstd.
 *
 * Run with:  bun run examples/image-qoi.ts
 */

import { ZipKit } from '../src/index.js';

const zk = await ZipKit.load();

// A synthetic 64×64 RGBA gradient (real apps pass decoded pixel data).
const w = 64;
const h = 64;
const pixels = new Uint8Array(w * h * 4);
for (let y = 0; y < h; y++) {
	for (let x = 0; x < w; x++) {
		const i = (y * w + x) * 4;
		pixels[i] = x * 4; // R
		pixels[i + 1] = y * 4; // G
		pixels[i + 2] = 128; // B
		pixels[i + 3] = 255; // A
	}
}

const qoi = zk.encodeImage(pixels, w, h, 4);
const qoiThenZstd = zk.zstd(qoi, 19);
const decoded = zk.decodeImage(qoi);

console.log('raw pixels :', pixels.length, 'bytes');
console.log('QOI        :', qoi.length, `bytes (${((qoi.length / pixels.length) * 100).toFixed(1)}%)`);
console.log('QOI → zstd :', qoiThenZstd.length, `bytes (${((qoiThenZstd.length / pixels.length) * 100).toFixed(1)}%)`);
console.log('lossless   :', Buffer.from(decoded).equals(Buffer.from(pixels)) ? 'OK' : 'MISMATCH');
