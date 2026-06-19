import { test, expect, afterAll } from 'bun:test';
import { WorkerPool } from './index.js';
import { AbortError } from '../types.js';

const pool = new WorkerPool({ size: 2 });
const data = new TextEncoder().encode('worker pool payload '.repeat(300));

afterAll(async () => {
	await pool.destroy();
});

test('compresses and decompresses off-thread', async () => {
	const comp = await pool.compress(data, 'zstd', { level: 19 });
	expect(comp.length).toBeLessThan(data.length);
	const back = await pool.decompress(comp, 'zstd');
	expect(back).toEqual(data);
});

test('runs many jobs concurrently across the pool', async () => {
	const jobs = Array.from({ length: 20 }, (_, i) =>
		pool.compress(new TextEncoder().encode(`job ${i} `.repeat(100)), 'gzip').then((c) => pool.decompress(c, 'gzip'))
	);
	const results = await Promise.all(jobs);
	for (let i = 0; i < results.length; i++) {
		expect(new TextDecoder().decode(results[i]!)).toContain(`job ${i}`);
	}
});

test('does not detach the caller buffer', async () => {
	const input = new TextEncoder().encode('do not detach me '.repeat(50));
	await pool.compress(input, 'gzip');
	// If the buffer had been transferred, length would read 0.
	expect(input.length).toBeGreaterThan(0);
});

test('rejects with AbortError when the signal is already aborted', async () => {
	expect(pool.compress(data, 'gzip', { signal: AbortSignal.abort() })).rejects.toBeInstanceOf(AbortError);
});
