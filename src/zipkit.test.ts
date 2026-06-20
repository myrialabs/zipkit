import { test, expect } from 'bun:test';
import { ZipKit, init } from './zipkit.js';

const zk = await ZipKit.load();
const data = new TextEncoder().encode('ZipKit high-level API '.repeat(200));

test('hybrid codecs roundtrip (native dispatch under Bun)', () => {
	expect(zk.gunzip(zk.gzip(data))).toEqual(data);
	expect(zk.inflate(zk.deflate(data))).toEqual(data);
	expect(zk.unzlib(zk.zlib(data))).toEqual(data);
	expect(zk.unzstd(zk.zstd(data, 19))).toEqual(data);
});

test('gzip/deflate use libdeflate — denser than native zlib', () => {
	// libdeflate beats the native zlib that Bun ships on output size.
	expect(zk.gzip(data, { mode: 'ratio' }).length).toBeLessThanOrEqual(Bun.gzipSync(data, { level: 9 }).length);
	// libdeflate gzip stays standard-format: native Bun decodes it.
	expect(new Uint8Array(Bun.gunzipSync(zk.gzip(data, { mode: 'ratio' })))).toEqual(data);
});

test('balanced gzip/deflate never below native on size (parity guarantee)', () => {
	// balanced/speed dispatch to native on Bun, so default output is never larger
	// than native — the "at least match native" invariant. Density is opt-in via ratio.
	expect(zk.gzip(data).length).toBeLessThanOrEqual(Bun.gzipSync(data, { level: 6 }).length);
	expect(zk.deflate(data).length).toBeLessThanOrEqual(Bun.deflateSync(data, { level: 6 }).length);
	// and still standard-format: native Bun decodes ZipKit's balanced output.
	expect(new Uint8Array(Bun.gunzipSync(zk.gzip(data)))).toEqual(data);
});

test('engine-only codecs roundtrip', () => {
	expect(zk.unlz4(zk.lz4(data))).toEqual(data);
	expect(zk.unsnappy(zk.snappy(data))).toEqual(data);
	expect(zk.unbrotli(zk.brotli(data))).toEqual(data);
	expect(zk.unlzma(zk.lzma(data))).toEqual(data);
	expect(zk.unbzip2(zk.bzip2(data))).toEqual(data);
});

test('runtime is reported as bun in this environment', () => {
	expect(zk.runtime).toBe('bun');
});

test('pack picks the smallest codec and unpack reverses it', () => {
	const packed = zk.pack(data);
	expect(packed.length).toBeLessThan(data.length);
	expect(zk.unpack(packed)).toEqual(data);
});

test('QOI image roundtrip (lossless RGBA)', () => {
	const w = 16;
	const h = 16;
	const px = new Uint8Array(w * h * 4).map((_, i) => (i * 7) & 0xff);
	const encoded = zk.encodeImage(px, w, h, 4);
	expect(zk.decodeImage(encoded)).toEqual(px);
});

test('frame-delta video roundtrip (lossless)', () => {
	const frameSize = 8 * 8 * 4;
	const frames = new Uint8Array(frameSize * 5).map((_, i) => (i >> 3) & 0xff);
	const encoded = zk.encodeFrames(frames, frameSize);
	expect(zk.decodeFrames(encoded, frameSize)).toEqual(frames);
});

test('init() returns a shared instance', async () => {
	const a = await init();
	const b = await init();
	expect(a).toBe(b);
});
