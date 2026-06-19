import { test, expect } from 'bun:test';
import { gzipSync, deflateSync, zstdCompressSync } from 'bun';
import { detectFormat } from './detect.js';
import { compress, decompress, decompressWith } from './compress.js';
import { gunzip } from './codecs/gzip.js';

const data = new TextEncoder().encode('interop sample data '.repeat(100));

test('detects gzip / zlib / zstd from magic bytes', async () => {
	expect(detectFormat(await compress(data, 'gzip'))).toBe('gzip');
	expect(detectFormat(await compress(data, 'zlib'))).toBe('zlib');
	expect(detectFormat(await compress(data, 'zstd'))).toBe('zstd');
});

test('returns undefined for headerless / ZipKit-framed codecs', async () => {
	expect(detectFormat(await compress(data, 'brotli'))).toBeUndefined();
	expect(detectFormat(await compress(data, 'snappy'))).toBeUndefined();
	expect(detectFormat(await compress(data, 'bzip2'))).toBeUndefined();
	expect(detectFormat(await compress(data, 'lzma'))).toBeUndefined();
	// ZipKit's lz4 is a raw block (no frame header), so it is not detectable.
	expect(detectFormat(await compress(data, 'lz4'))).toBeUndefined();
});

test('detects ZIP archives from the PK signature', () => {
	expect(detectFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe('zip');
	expect(detectFormat(new Uint8Array([0x50, 0x4b, 0x05, 0x06]))).toBe('zip');
});

test('decompress() auto-detects and reverses compress()', async () => {
	for (const codec of ['gzip', 'zlib', 'zstd'] as const) {
		const out = await decompress(await compress(data, codec));
		expect(out).toEqual(data);
	}
});

test('decompress() throws a helpful error on unrecognized input', async () => {
	const brotli = await compress(data, 'brotli');
	expect(decompress(brotli)).rejects.toThrow(/auto-detect/);
});

test('interop: ZipKit reads gzip produced by Bun/zlib', async () => {
	const native = gzipSync(data);
	const out = await gunzip(new Uint8Array(native));
	expect(out).toEqual(data);
});

test('interop: Bun/zlib reads gzip produced by ZipKit', async () => {
	const ours = await compress(data, 'gzip');
	const back = Bun.gunzipSync(ours);
	expect(new Uint8Array(back)).toEqual(data);
});

test('interop: deflate and zstd cross-decode with Bun', async () => {
	expect(new Uint8Array(Bun.inflateSync(await compress(data, 'deflate')))).toEqual(data);
	expect(await decompressWith(new Uint8Array(deflateSync(data)), 'deflate')).toEqual(data);
	expect(new Uint8Array(Bun.zstdDecompressSync(await compress(data, 'zstd')))).toEqual(data);
	expect(await decompressWith(new Uint8Array(zstdCompressSync(data)), 'zstd')).toEqual(data);
});
