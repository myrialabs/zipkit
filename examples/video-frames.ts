/**
 * Lossless temporal video compression: frame-delta prediction + zstd.
 * Great for screen recordings and raw frame buffers where frames change little.
 *
 * Run with:  bun run examples/video-frames.ts
 */

import { ZipKit } from '../src/index.js';

const zk = await ZipKit.load();

const w = 64;
const h = 64;
const frameSize = w * h * 4;
const frameCount = 30;

// A detailed (high-entropy) scene that drifts slightly every frame — e.g. a
// gradual brightness/fade change, common in real footage. Consecutive frames
// are *similar but never identical*, so zstd can't dedupe them outright, while
// frame-delta turns the per-frame change into a tiny, highly-compressible
// residual. This is exactly where temporal prediction pays off.
let seed = 0x9e3779b9;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) >>> 24) & 0xff;
const noise = new Uint8Array(frameSize);
for (let i = 0; i < frameSize; i++) noise[i] = rand();

const frames = new Uint8Array(frameSize * frameCount);
for (let f = 0; f < frameCount; f++) {
	const base = f * frameSize;
	for (let i = 0; i < frameSize; i++) {
		// Static detail + a global drift that grows each frame.
		frames[base + i] = (noise[i]! + f * 3) & 0xff;
	}
}

const encoded = zk.encodeFrames(frames, frameSize, 'zstd');
const decoded = zk.decodeFrames(encoded, frameSize, 'zstd');
const plainZstd = zk.zstd(frames, 19);

console.log('raw frames        :', frames.length, 'bytes');
console.log('plain zstd        :', plainZstd.length, 'bytes');
console.log('frame-delta + zstd:', encoded.length, `bytes (${((encoded.length / plainZstd.length) * 100).toFixed(1)}% of plain zstd)`);
console.log('lossless          :', Buffer.from(decoded).equals(Buffer.from(frames)) ? 'OK' : 'MISMATCH');
