import { test, expect, afterAll } from 'bun:test';
import { compressParallel, decompressParallel, isParallelContainer } from './index.js';
import { decompressWith } from '../compress.js';
import { sharedPool } from '../workers/index.js';
import type { Codec } from '../types.js';

afterAll(() => sharedPool().destroy());

// A few MB so the input genuinely spans many blocks across the pool.
const big = new Uint8Array(5 * 1024 * 1024).map((_, i) => (i * 2654435761) & 0xff);
const text = new TextEncoder().encode('parallel roundtrip sample '.repeat(100_000));

const codecs: Codec[] = ['gzip', 'deflate', 'zlib', 'zstd', 'lz4', 'snappy', 'brotli', 'lzma', 'bzip2'];

for (const codec of codecs) {
	test(`${codec}: parallel roundtrip is byte-identical (multi-block)`, async () => {
		const packed = await compressParallel(text, codec, { level: 6, blockSize: 64 * 1024 });
		expect(isParallelContainer(packed)).toBe(true);
		const out = await decompressParallel(packed);
		expect(out).toEqual(text);
	});
}

test('compresses large binary across many blocks and reverses exactly', async () => {
	const packed = await compressParallel(big, 'zstd', { level: 3 });
	const out = await decompressParallel(packed);
	expect(out).toEqual(big);
});

test('single small block still produces a valid container', async () => {
	const tiny = new TextEncoder().encode('hi');
	const packed = await compressParallel(tiny, 'gzip');
	expect(isParallelContainer(packed)).toBe(true);
	expect(await decompressParallel(packed)).toEqual(tiny);
});

test('blocks are independently valid streams of the named codec', async () => {
	// With one block, the body after the header+table is exactly one codec stream.
	const data = new TextEncoder().encode('independent block '.repeat(500));
	const packed = await compressParallel(data, 'gzip', { blockSize: 1 << 30 });
	const HEADER = 18;
	const block = packed.subarray(HEADER + 4); // skip header + one u32 length entry
	expect(await decompressWith(block, 'gzip')).toEqual(data);
});

test('reports progress as blocks complete', async () => {
	let last = 0;
	await compressParallel(big, 'lz4', { blockSize: 256 * 1024, onProgress: (p) => { last = p; } });
	expect(last).toBeCloseTo(1, 5);
});

test('rejects a non-container on decompress', async () => {
	expect(decompressParallel(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toThrow(/parallel container/);
});
