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

test('detects external container formats from their magic', () => {
	expect(detectFormat(new Uint8Array([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]))).toBe('xz');
	expect(detectFormat(new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))).toBe('7z');
	expect(detectFormat(new Uint8Array([0x04, 0x22, 0x4d, 0x18]))).toBe('lz4-frame');
	expect(detectFormat(new Uint8Array([0x42, 0x5a, 0x68, 0x39]))).toBe('bzip2');
	const tarHeader = new Uint8Array(512);
	tarHeader.set([0x75, 0x73, 0x74, 0x61, 0x72], 257); // "ustar"
	expect(detectFormat(tarHeader)).toBe('tar');
});

test('decompress() routes recognized containers to the right API', async () => {
	const tarHeader = new Uint8Array(512);
	tarHeader.set([0x75, 0x73, 0x74, 0x61, 0x72], 257);
	expect(decompress(tarHeader)).rejects.toThrow(/untar\(\)/);
	expect(decompress(new Uint8Array([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]))).rejects.toThrow(/xz/);
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
