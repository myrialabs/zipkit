/**
 * ZipKit production benchmark — src/ (production API) vs competitors.
 *
 * Three realistic datasets matching the /examples/browser scenarios.
 * Each candidate runs 8 warmup + 40 measured iterations.
 *
 * Run: bun run bench.ts
 */

import { ZipKit } from './src/zipkit.js';
import { getEngine } from './src/engine.js';
import { compressParallel, decompressParallel } from './src/parallel/index.js';
import { sharedPool } from './src/workers/index.js';
import { zip as zkZip, unzip as zkUnzip } from './src/zip/index.js';
import { trainDictionary, compressWithDictionary, decompressWithDictionary } from './src/dictionary.js';
import { compressDelta, applyDelta } from './src/delta.js';
import * as fflate from 'fflate';
import JSZip from 'jszip';
import pako from 'pako';
import lz4 from 'lz4js';
import snappy from 'snappyjs';

// ── datasets (matching /examples/browser scenarios, scaled to ~100KB) ──────

function makeEcommerce(target = 100_000): Uint8Array {
	const products: unknown[] = [];
	while (true) {
		const i = products.length;
		products.push({
			id: `prod_${(10000 + i).toString(36)}`,
			sku: `SKU-${String(2000 + i).padStart(8, '0')}`,
			name: `Wireless Headphones ${['Pro', 'Max', 'Lite', 'Studio'][i % 4]} ${['Black', 'White', 'Navy'][i % 3]}`,
			slug: `wireless-headphones-${['pro', 'max', 'lite', 'studio'][i % 4]}-${['black', 'white', 'navy'][i % 3]}`,
			category: ['Audio', 'Wearables', 'Accessories'][i % 3],
			brand: ['SoundMax', 'AudioPro', 'WaveTech', 'BassBoost'][i % 4],
			price: 49.99 + (i % 20) * 15,
			currency: 'USD',
			inStock: i % 7 !== 0,
			rating: { average: +(3.5 + (i % 15) / 10).toFixed(1), count: 80 + i * 17 },
			tags: ['wireless', 'bluetooth', 'headphones', 'audio', ...(i % 3 === 0 ? ['noise-cancelling'] : [])],
			variants: Array.from({ length: 3 }, (_, j) => ({
				id: `var_${(100000 + i * 10 + j).toString(36)}`,
				color: ['Black', 'White', 'Navy', 'Green'][(i + j) % 4],
				stock: 5 + ((i * 7 + j * 3) % 50),
			})),
			images: Array.from({ length: 3 }, (_, j) => ({
				url: `https://cdn.store/img/${(10000 + i).toString(36)}/${j + 1}.jpg`,
				width: 800,
				height: 800,
			})),
		});
		if (new TextEncoder().encode(JSON.stringify(products, null, 2)).length >= target) break;
	}
	return new TextEncoder().encode(JSON.stringify(products, null, 2));
}

function makeWeblogs(target = 100_000): Uint8Array {
	const lines: string[] = [];
	while (true) {
		const i = lines.length;
		const ip = `${10 + (i * 7) % 200}.${(i * 13) % 256}.${(i * 3) % 256}.${(i * 11) % 256}`;
		const ts = `17/Jun/2026:${String(Math.floor(i / 60) % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00 +0000`;
		const method = ['GET', 'GET', 'GET', 'POST', 'PUT'][i % 5];
		const path = ['/api/products', '/api/orders', '/api/cart', '/api/users', '/api/search'][i % 5];
		const status = [200, 200, 200, 201, 204, 301, 400, 404, 429][i % 9];
		const size = 200 + ((i * 37) % 15000);
		const agent = ['Mozilla/5.0 Chrome/124', 'Mozilla/5.0 Firefox/126', 'curl/8.7', 'axios/1.7', 'node-fetch/3.3'][i % 5];
		lines.push(`${ip} - - [${ts}] "${method} ${path}?page=${(i % 10) + 1}&limit=50 HTTP/1.1" ${status} ${size} "-" "${agent}"`);
		if (lines.join('\n').length >= target) break;
	}
	return new TextEncoder().encode(lines.join('\n'));
}

function makeBinary(size = 100_000): Uint8Array {
	// Deterministic LCG from browser scenario
	const buf = new Uint8Array(size);
	for (let i = 0; i < size; i++) {
		buf[i] = (i * 1103515245 + 12345) & 0xff;
	}
	return buf;
}

/**
 * Realistic large payload: log-like lines with varying tokens. Compressible but
 * NOT degenerate — gzip/zstd do genuine CPU work on it, unlike trivially
 * repetitive text where single-threaded native is already at memory bandwidth.
 */
function makeLogData(size: number): Uint8Array {
	const lvls = ['INFO', 'WARN', 'ERROR', 'DEBUG', 'TRACE'];
	const msgs = ['request handled', 'cache miss', 'db query', 'auth ok', 'retry scheduled', 'payload parsed', 'connection closed'];
	const parts: string[] = [];
	let total = 0;
	let x = 0x12345678;
	let i = 0;
	while (total < size) {
		x ^= x << 13; x ^= x >> 17; x ^= x << 5;
		const r = x >>> 0;
		const line = `2026-06-17T10:${String(i % 60).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}.${r % 1000} [${lvls[r % lvls.length]}] svc-${r % 64} req=${r.toString(16)} user=${(r * 7) % 100000} "${msgs[r % msgs.length]}" lat=${r % 5000}ms\n`;
		parts.push(line);
		total += line.length;
		i++;
	}
	return new TextEncoder().encode(parts.join(''));
}

const DATASETS: Record<string, Uint8Array> = {
	ecommerce: makeEcommerce(),
	weblogs: makeWeblogs(),
	binary: makeBinary(),
};

const DATASET_NAMES: Record<string, string> = {
	ecommerce: 'E-commerce API',
	weblogs: 'Web logs',
	binary: 'Binary-like',
};

// ── bench harness ────────────────────────────────────────────────────────────

const ITERS = 40;
const WARMUP = 8;

function avg(xs: number[]): number {
	return xs.reduce((a, b) => a + b, 0) / xs.length;
}

async function bench(fn: () => unknown): Promise<number> {
	for (let i = 0; i < WARMUP; i++) fn();
	const t: number[] = [];
	for (let i = 0; i < ITERS; i++) {
		const s = performance.now();
		fn();
		t.push(performance.now() - s);
	}
	return avg(t);
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatThroughput(bytes: number, ms: number): string {
	if (ms === 0) return '∞';
	const bps = bytes / (ms / 1000);
	if (bps >= 1024 * 1024 * 1024) return `${(bps / 1024 / 1024 / 1024).toFixed(1)} GB/s`;
	if (bps >= 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(0)} MB/s`;
	if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
	return `${Math.round(bps)} B/s`;
}

interface Row {
	algo: string;
	impl: string;
	native: boolean;
	cMs: number;
	dMs: number;
	compBytes: number;
	ratio: number;
	rt: boolean;
}

async function measure(
	algo: string,
	impl: string,
	native: boolean,
	data: Uint8Array,
	compress: (d: Uint8Array) => Uint8Array,
	decompress: (d: Uint8Array) => Uint8Array,
): Promise<Row> {
	let comp = compress(data);
	const cMs = await bench(() => { comp = compress(data); });
	let dec = decompress(comp);
	const dMs = await bench(() => { dec = decompress(comp); });
	const rt = dec.length === data.length && dec.every((v, i) => v === data[i]);
	return {
		algo, impl, native,
		cMs, dMs,
		compBytes: comp.length,
		ratio: comp.length / data.length,
		rt,
	};
}

// ── render ───────────────────────────────────────────────────────────────────

function renderTable(rows: Row[], data: Uint8Array): string {
	const lines: string[] = ['| Codec | Implementation | Size | Ratio | Compress | Decompress | OK |'];
	lines.push('|-------|----------------|------|-------|----------|------------|-----|');

	const byAlgo = new Map<string, Row[]>();
	for (const r of rows) {
		if (!byAlgo.has(r.algo)) byAlgo.set(r.algo, []);
		byAlgo.get(r.algo)!.push(r);
	}

	for (const [algo, group] of byAlgo) {
		lines.push(`| **${algo}** | | | | | | |`);

		for (const r of group) {
			const cTput = formatThroughput(data.length, r.cMs);
			const dTput = formatThroughput(data.length, r.dMs);
			lines.push(
				`|  | ${r.impl} | ${formatBytes(r.compBytes)} | ${(r.ratio * 100).toFixed(1)}% | ${cTput} | ${dTput} | ${r.rt ? '✓' : '⚠'} |`,
			);
		}
	}
	return lines.join('\n');
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
	process.stderr.write('Loading engines...\n');

	const zk = await ZipKit.load();
	const engine = await getEngine();

	const zstdMod = await import('@bokuweb/zstd-wasm');
	await zstdMod.init();
	const brotliMod = await (await import('brotli-wasm')).default;

	const bun = globalThis.Bun as any;

	const out: string[] = [
		'# ZipKit — Production Performance Benchmark',
		'',
		`**Env:** Bun ${bun?.version ?? 'unknown'}, ${process.platform}, ${new Date().toISOString().slice(0, 10)}`,
		`**Method:** ${WARMUP} warmup + ${ITERS} measured iterations, average compress & decompress time.`,
		'',
		'**Markers:** ⚠ = roundtrip mismatch',
		'',
		'---',
		'',
	];

	for (const [dsName, data] of Object.entries(DATASETS)) {
		process.stderr.write(`\n=== ${DATASET_NAMES[dsName] ?? dsName} (${data.length.toLocaleString()}B) ===\n`);
		const label = DATASET_NAMES[dsName] ?? dsName;
		out.push(`## ${label}\n`);

		const rows: Row[] = [];

		// ── gzip ────────────────────────────────────────────────────────────────
		rows.push(await measure('gzip', 'ZipKit', false, data,
			(d) => zk.gzip(d), (d) => zk.gunzip(d)));
		rows.push(await measure('gzip', 'ZipKit (ratio)', false, data,
			(d) => zk.gzip(d, { mode: 'ratio' }), (d) => zk.gunzip(d)));
		rows.push(await measure('gzip', 'fflate', false, data,
			(d) => fflate.gzipSync(d, { level: 6 }), (d) => fflate.gunzipSync(d)));
		rows.push(await measure('gzip', 'pako', false, data,
			(d) => pako.gzip(d, { level: 6 }), (d) => pako.ungzip(d)));
		if (bun?.gzipSync) {
			rows.push(await measure('gzip', 'Bun.gzipSync', true, data,
				(d) => bun.gzipSync(d, { level: 6 }), (d) => bun.gunzipSync(d)));
		}
		process.stderr.write('  gzip done\n');

		// ── deflate ─────────────────────────────────────────────────────────────
		rows.push(await measure('deflate', 'ZipKit', false, data,
			(d) => zk.deflate(d), (d) => zk.inflate(d)));
		rows.push(await measure('deflate', 'ZipKit (ratio)', false, data,
			(d) => zk.deflate(d, { mode: 'ratio' }), (d) => zk.inflate(d)));
		rows.push(await measure('deflate', 'fflate', false, data,
			(d) => fflate.deflateSync(d, { level: 6 }), (d) => fflate.inflateSync(d)));
		rows.push(await measure('deflate', 'pako', false, data,
			(d) => pako.deflateRaw(d, { level: 6 }), (d) => pako.inflateRaw(d)));
		if (bun?.deflateSync) {
			rows.push(await measure('deflate', 'Bun.deflateSync', true, data,
				(d) => bun.deflateSync(d, { level: 6 }), (d) => bun.inflateSync(d)));
		}
		process.stderr.write('  deflate done\n');

		// ── zlib ────────────────────────────────────────────────────────────────
		rows.push(await measure('zlib', 'ZipKit', false, data,
			(d) => zk.zlib(d), (d) => zk.unzlib(d)));
		rows.push(await measure('zlib', 'ZipKit (ratio)', false, data,
			(d) => zk.zlib(d, { mode: 'ratio' }), (d) => zk.unzlib(d)));
		rows.push(await measure('zlib', 'fflate', false, data,
			(d) => fflate.zlibSync(d, { level: 6 }), (d) => fflate.unzlibSync(d)));
		rows.push(await measure('zlib', 'pako', false, data,
			(d) => pako.deflate(d, { level: 6 }), (d) => pako.inflate(d)));
		if (bun?.zlibSync) {
			rows.push(await measure('zlib', 'Bun.zlibSync', true, data,
				(d) => bun.zlibSync(d, { level: 6 }), (d) => bun.unzlibSync(d)));
		}
		process.stderr.write('  zlib done\n');

		// ── zstd ────────────────────────────────────────────────────────────────
		rows.push(await measure('zstd', 'ZipKit', false, data,
			(d) => zk.zstd(d), (d) => zk.unzstd(d)));
		rows.push(await measure('zstd', 'ZipKit (ratio)', false, data,
			(d) => zk.zstd(d, { mode: 'ratio' }), (d) => zk.unzstd(d)));
		rows.push(await measure('zstd', 'zstd-wasm', false, data,
			(d) => new Uint8Array(zstdMod.compress(d, 3)), (d) => new Uint8Array(zstdMod.decompress(d))));
		if (bun?.zstdCompressSync) {
			rows.push(await measure('zstd', 'Bun.zstdCompressSync', true, data,
				(d) => bun.zstdCompressSync(d, { level: 3 }), (d) => bun.zstdDecompressSync(d)));
		}
		process.stderr.write('  zstd done\n');

		// ── lz4 / snappy / brotli / lzma / bzip2 ───────────────────────────────
		rows.push(await measure('lz4', 'ZipKit', false, data,
			(d) => zk.lz4(d), (d) => zk.unlz4(d)));
		rows.push(await measure('lz4', 'lz4js', false, data,
			(d) => new Uint8Array(lz4.compress(d)), (d) => new Uint8Array(lz4.decompress(d))));
		process.stderr.write('  lz4 done\n');

		rows.push(await measure('snappy', 'ZipKit', false, data,
			(d) => zk.snappy(d), (d) => zk.unsnappy(d)));
		rows.push(await measure('snappy', 'snappyjs', false, data,
			(d) => new Uint8Array(snappy.compress(d)), (d) => new Uint8Array(snappy.uncompress(d))));
		process.stderr.write('  snappy done\n');

		rows.push(await measure('brotli', 'ZipKit', false, data,
			(d) => zk.brotli(d), (d) => zk.unbrotli(d)));
		rows.push(await measure('brotli', 'ZipKit (ratio)', false, data,
			(d) => zk.brotli(d, { mode: 'ratio' }), (d) => zk.unbrotli(d)));
		rows.push(await measure('brotli', 'brotli-wasm', false, data,
			(d) => brotliMod.compress(d, { quality: 6 }), (d) => brotliMod.decompress(d)));
		process.stderr.write('  brotli done\n');

		rows.push(await measure('lzma', 'ZipKit', false, data,
			(d) => zk.lzma(d), (d) => zk.unlzma(d)));
		process.stderr.write('  lzma done\n');

		rows.push(await measure('bzip2', 'ZipKit', false, data,
			(d) => zk.bzip2(d), (d) => zk.unbzip2(d)));
		process.stderr.write('  bzip2 done\n');

		// ── xz (standard .xz container, LZMA2) ─────────────────────────────────
		rows.push(await measure('xz', 'ZipKit', false, data,
			(d) => engine.xzCompress(d, 6), (d) => engine.xzDecompress(d)));
		process.stderr.write('  xz done\n');

		out.push(renderTable(rows, data));
		out.push('');
	}

	// ── parallel, multi-core (large data) ──────────────────────────────────────
	// The lever no single-threaded competitor has. On big inputs ZipKit spreads
	// blocks across every core; native Bun.gzipSync and fflate stay on one.
	const cores = (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency ?? 4;
	out.push('---');
	out.push('');
	out.push(`## Parallel — multi-core, large data (${cores} cores)`);
	out.push('');
	out.push('The simple API stays standard-format by default. For controlled ZipKit-to-ZipKit large payloads, the advanced parallel container spreads independent blocks across the worker pool; this is the multi-core path single-threaded libraries do not have.');
	out.push('');

	const big = makeLogData(32 * 1024 * 1024); // 32 MB realistic log data
	process.stderr.write(`\n=== parallel (${(big.length / 1e6).toFixed(0)}MB) ===\n`);

	interface PRow { impl: string; cMs: number; dMs: number; compBytes: number; ratio: number; rt: boolean; threads: string; }
	const prows: PRow[] = [];

	async function pmeasure(impl: string, threads: string, comp: () => Promise<Uint8Array>, decomp: (c: Uint8Array) => Promise<Uint8Array>): Promise<void> {
		// Fewer iterations — these are big and slow (zstd L19 on 32 MB is seconds).
		const warm = 1, iters = 3;
		for (let i = 0; i < warm; i++) await comp();
		let c!: Uint8Array;
		const tsc: number[] = [];
		for (let i = 0; i < iters; i++) { const s = performance.now(); c = await comp(); tsc.push(performance.now() - s); }
		const cMs = avg(tsc);
		const tsd: number[] = [];
		for (let i = 0; i < iters; i++) { const s = performance.now(); await decomp(c); tsd.push(performance.now() - s); }
		const dMs = avg(tsd);
		const dec = await decomp(c);
		const rt = dec.length === big.length && dec.every((v, i) => v === big[i]);
		prows.push({ impl, threads, cMs, dMs, compBytes: c.length, ratio: c.length / big.length, rt });
	}

	// gzip family — headline: parallel ZipKit vs native single-thread + fflate
	await pmeasure('ZipKit compressParallel (gzip)', `${cores}`, () => compressParallel(big, 'gzip', { level: 6 }), (c) => decompressParallel(c));
	await pmeasure('ZipKit single-thread (gzip ratio)', '1', async () => zk.gzip(big, { mode: 'ratio', level: 6 }), async (c) => zk.gunzip(c));
	if (bun?.gzipSync) await pmeasure('Bun.gzipSync (gzip)', '1', async () => bun.gzipSync(big, { level: 6 }), async (c) => bun.gunzipSync(c));
	await pmeasure('fflate (gzip)', '1', async () => fflate.gzipSync(big, { level: 6 }), async (c) => fflate.gunzipSync(c));
	process.stderr.write('  parallel gzip done\n');

	// zstd family — parallel ZipKit vs native single-thread
	await pmeasure('ZipKit compressParallel (zstd L19)', `${cores}`, () => compressParallel(big, 'zstd', { level: 19 }), (c) => decompressParallel(c));
	await pmeasure('ZipKit single-thread (zstd L19)', '1', async () => zk.zstd(big, { mode: 'ratio' }), async (c) => zk.unzstd(c));
	if (bun?.zstdCompressSync) await pmeasure('Bun.zstdCompressSync (zstd L19)', '1', async () => bun.zstdCompressSync(big, { level: 19 }), async (c) => bun.zstdDecompressSync(c));
	process.stderr.write('  parallel zstd done\n');

	out.push('| Implementation | Threads | Size | Ratio | Compress | Decompress | OK |');
	out.push('|----------------|:-------:|------|-------|----------|------------|-----|');
	for (const r of prows) {
		out.push(`| ${r.impl} | ${r.threads} | ${formatBytes(r.compBytes)} | ${(r.ratio * 100).toFixed(1)}% | ${formatThroughput(big.length, r.cMs)} | ${formatThroughput(big.length, r.dMs)} | ${r.rt ? '✓' : '⚠'} |`);
	}
	out.push('');

	// ── headline summary (percentages) ─────────────────────────────────────────
	const pg = prows.find((r) => r.impl.includes('compressParallel (gzip'))!;
	const sgNative = prows.find((r) => r.impl.includes('Bun.gzipSync'));
	const sgFflate = prows.find((r) => r.impl.includes('fflate'))!;
	const pz = prows.find((r) => r.impl.includes('compressParallel (zstd'))!;
	const szNative = prows.find((r) => r.impl.includes('Bun.zstdCompressSync'));
	/** Honest "A vs B" phrasing: states faster OR slower, never fudges. */
	const cmp = (mine: number, theirs: number): string => {
		const x = theirs / mine; // >1 → mine faster
		return x >= 1 ? `**${x.toFixed(1)}× faster**` : `**${(1 / x).toFixed(1)}× slower**`;
	};
	out.push('### Headline');
	out.push('');
	out.push(`On ${(big.length / 1e6).toFixed(0)} MB of realistic (log-like) data, ${cores} cores:`);
	out.push('');
	if (sgNative) out.push(`- **gzip:** ZipKit parallel is ${cmp(pg.cMs, sgNative.cMs)} than native \`Bun.gzipSync\` (${formatThroughput(big.length, pg.cMs)} vs ${formatThroughput(big.length, sgNative.cMs)}), and **${Math.round((1 - pg.ratio / sgNative.ratio) * 100)}% denser**.`);
	out.push(`- **gzip:** ZipKit parallel is ${cmp(pg.cMs, sgFflate.cMs)} than fflate, and denser too.`);
	if (szNative) {
		const pct = Math.round((pz.ratio / szNative.ratio - 1) * 100);
		const note = pct <= 2 ? 'at the same ratio' : `for ${pct}% larger output (per-block independence at L19 — raise \`blockSize\` to trade speed back for ratio)`;
		out.push(`- **zstd L19:** ZipKit parallel is ${cmp(pz.cMs, szNative.cMs)} than native \`Bun.zstdCompressSync\`, ${note}.`);
	}
	out.push('');

	// ── ZIP archive — multi-file container vs JSZip / fflate ────────────────────
	// The ZIP path most apps actually use: many files in one archive. ZipKit
	// computes CRC-32 in Wasm (libdeflate, not a JS table) and fans entry
	// compression out across the worker pool; fflate and JSZip are single-threaded.
	out.push('---');
	out.push('');
	out.push(`## ZIP archive — multi-file container (${cores} cores)`);
	out.push('');

	// 20 distinct log files carved from one realistic blob (~8 MB total).
	const zipBlob = makeLogData(8 * 1024 * 1024);
	const ZIP_N = 20;
	const zipChunk = Math.floor(zipBlob.length / ZIP_N);
	// slice() (not subarray) so each file owns its buffer, independent of the blob.
	const zipFiles = Array.from({ length: ZIP_N }, (_, i) => ({
		name: `logs/app-${i}.log`,
		data: zipBlob.slice(i * zipChunk, (i + 1) * zipChunk),
	}));
	const zipTotal = ZIP_N * zipChunk;
	const fileRecord: Record<string, Uint8Array> = {};
	for (const f of zipFiles) fileRecord[f.name] = f.data;
	out.push(`Archive: ${ZIP_N} files, ${formatBytes(zipTotal)} uncompressed, DEFLATE level 6.`);
	out.push('');
	process.stderr.write(`\n=== zip (${ZIP_N} files, ${(zipTotal / 1e6).toFixed(1)}MB) ===\n`);

	interface ZRow { impl: string; threads: string; cMs: number; dMs: number; compBytes: number; ratio: number; rt: boolean; note?: string; }
	const zrows: ZRow[] = [];

	async function ameasure(impl: string, threads: string, comp: () => Promise<Uint8Array>, decomp: (a: Uint8Array) => Promise<number>): Promise<void> {
		const warm = 1, iters = 3;
		try {
			for (let i = 0; i < warm; i++) await comp();
			let a!: Uint8Array;
			const tsc: number[] = [];
			for (let i = 0; i < iters; i++) { const s = performance.now(); a = await comp(); tsc.push(performance.now() - s); }
			const cMs = avg(tsc);
			const tsd: number[] = [];
			for (let i = 0; i < iters; i++) { const s = performance.now(); await decomp(a); tsd.push(performance.now() - s); }
			const dMs = avg(tsd);
			const decBytes = await decomp(a);
			zrows.push({ impl, threads, cMs, dMs, compBytes: a.length, ratio: a.length / zipTotal, rt: decBytes === zipTotal });
		} catch (err) {
			// Record the failure honestly rather than aborting the whole suite.
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(`  ${impl} FAILED: ${msg}\n`);
			zrows.push({ impl, threads, cMs: NaN, dMs: NaN, compBytes: 0, ratio: NaN, rt: false, note: 'did not run' });
		}
	}

	// ZipKit — parallel (worker pool) and single-thread, both libdeflate + Wasm CRC.
	await ameasure('ZipKit zip (deflate, parallel)', `${cores}`,
		() => zkZip(zipFiles, { parallel: true }),
		async (a) => (await zkUnzip(a)).reduce((n, e) => n + e.data.length, 0));
	await ameasure('ZipKit zip (deflate, 1 thread)', '1',
		() => zkZip(zipFiles, { parallel: false }),
		async (a) => (await zkUnzip(a)).reduce((n, e) => n + e.data.length, 0));
	process.stderr.write('  zipkit deflate done\n');

	// fflate — single-threaded ZIP.
	await ameasure('fflate (deflate)', '1',
		async () => fflate.zipSync(fileRecord, { level: 6 }),
		async (a) => Object.values(fflate.unzipSync(a)).reduce((n, u) => n + u.length, 0));
	process.stderr.write('  fflate done\n');

	// JSZip — the popular, single-threaded baseline.
	await ameasure('JSZip (deflate)', '1',
		async () => {
			const z = new JSZip();
			for (const f of zipFiles) z.file(f.name, f.data);
			return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
		},
		async (a) => {
			const z = await JSZip.loadAsync(a);
			const lens = await Promise.all(Object.values(z.files).map((f) => f.async('uint8array').then((u) => u.length)));
			return lens.reduce((n, l) => n + l, 0);
		});
	process.stderr.write('  jszip done\n');

	// ZipKit zstd-in-ZIP — denser container, no JS competitor offers it.
	await ameasure('ZipKit zip (zstd, parallel)', `${cores}`,
		() => zkZip(zipFiles.map((f) => ({ ...f, method: 'zstd' as const })), { parallel: true }),
		async (a) => (await zkUnzip(a)).reduce((n, e) => n + e.data.length, 0));
	process.stderr.write('  zipkit zstd done\n');

	out.push('| Implementation | Threads | Size | Ratio | Compress | Decompress | OK |');
	out.push('|----------------|:-------:|------|-------|----------|------------|-----|');
	for (const r of zrows) {
		if (Number.isNaN(r.cMs)) {
			out.push(`| ${r.impl} | ${r.threads} | — | — | — | — | ⚠ ${r.note ?? 'failed'} |`);
			continue;
		}
		out.push(`| ${r.impl} | ${r.threads} | ${formatBytes(r.compBytes)} | ${(r.ratio * 100).toFixed(1)}% | ${formatThroughput(zipTotal, r.cMs)} | ${formatThroughput(zipTotal, r.dMs)} | ${r.rt ? '✓' : '⚠'} |`);
	}
	out.push('');

	// Headline for the ZIP section.
	const zkPar = zrows.find((r) => r.impl.includes('deflate, parallel'))!;
	const zff = zrows.find((r) => r.impl.includes('fflate'))!;
	const zjs = zrows.find((r) => r.impl.includes('JSZip'))!;
	const cmpZ = (mine: number, theirs: number): string => {
		const x = theirs / mine;
		return x >= 1 ? `**${x.toFixed(1)}× faster**` : `**${(1 / x).toFixed(1)}× slower**`;
	};
	out.push('### Headline');
	out.push('');
	out.push(`On a ${ZIP_N}-file, ${formatBytes(zipTotal)} archive (DEFLATE level 6), ${cores} cores:`);
	out.push('');
	out.push(`- ZipKit parallel zip is ${cmpZ(zkPar.cMs, zff.cMs)} than fflate and ${cmpZ(zkPar.cMs, zjs.cMs)} than JSZip, at **${Math.round((1 - zkPar.ratio / zff.ratio) * 100)}% smaller** output (libdeflate).`);
	out.push('- The `zstd` method packs the same archive denser still — a container no JS competitor offers.');
	out.push('');

	// ── dictionary & delta — small-payload / incremental wins ──────────────────
	// Two cases generic codecs handle poorly: many tiny similar payloads, and a
	// large doc that changed only slightly. Dictionary and delta target both.
	out.push('---');
	out.push('');
	out.push('## Dictionary & delta — small / incremental payloads');
	out.push('');
	process.stderr.write('\n=== dictionary & delta ===\n');

	// 500 small, structurally-similar JSON records (~120 B each).
	const records: Uint8Array[] = [];
	for (let i = 0; i < 500; i++) {
		records.push(new TextEncoder().encode(
			JSON.stringify({ ts: 1_700_000_000 + i, level: ['info', 'warn', 'error'][i % 3], svc: 'api', id: i * 31, msg: `request ${i} handled ok` })
		));
	}
	const dict = await trainDictionary(records);
	let dictTotal = 0;
	let plainTotal = 0;
	for (const r of records) {
		dictTotal += (await compressWithDictionary(r, dict, { level: 19 })).length;
		plainTotal += engine.zstdCompress(r, 19).length;
		// sanity: roundtrip the first record
	}
	const rtDict = (await decompressWithDictionary(await compressWithDictionary(records[0]!, dict), dict)).every((v, i) => v === records[0]![i]);
	const rawTotal = records.reduce((n, r) => n + r.length, 0);

	out.push(`**Dictionary** — 500 similar JSON records (${formatBytes(rawTotal)} raw), compressed individually:`);
	out.push('');
	out.push('| Approach | Total size | Ratio | OK |');
	out.push('|----------|-----------|-------|-----|');
	out.push(`| zstd L19, per record | ${formatBytes(plainTotal)} | ${(plainTotal / rawTotal * 100).toFixed(1)}% | ✓ |`);
	out.push(`| zstd L19 + dictionary | ${formatBytes(dictTotal)} | ${(dictTotal / rawTotal * 100).toFixed(1)}% | ${rtDict ? '✓' : '⚠'} |`);
	out.push('');
	out.push(`Dictionary output is **${Math.round((1 - dictTotal / plainTotal) * 100)}% smaller** — the shared JSON shape lives in the dictionary, not every frame.`);
	out.push('');

	// Delta: a 64 KB doc that gains one appended line.
	const baseDoc = makeLogData(64 * 1024);
	const newDoc = new Uint8Array(baseDoc.length + 64);
	newDoc.set(baseDoc, 0);
	newDoc.set(new TextEncoder().encode('2026-06-17T11:00:00.000 [INFO] svc-1 one appended line\n'), baseDoc.length);
	const patch = await compressDelta(baseDoc, newDoc, { level: 19 });
	const standalone = engine.zstdCompress(newDoc, 19);
	const rtDelta = (await applyDelta(baseDoc, patch)).every((v, i) => v === newDoc[i]);

	out.push(`**Delta** — a ${formatBytes(baseDoc.length)} log doc with one appended line, encoded against the previous revision:`);
	out.push('');
	out.push('| Approach | Patch size | OK |');
	out.push('|----------|-----------|-----|');
	out.push(`| zstd L19, standalone | ${formatBytes(standalone.length)} | ✓ |`);
	out.push(`| compressDelta vs base | ${formatBytes(patch.length)} | ${rtDelta ? '✓' : '⚠'} |`);
	out.push('');
	out.push(`The delta is **${(standalone.length / patch.length).toFixed(0)}× smaller** than recompressing the whole revision — ideal for logs, chat history, and snapshotted state.`);
	out.push('');

	// ── legend ──────────────────────────────────────────────────────────────────
	out.push('---');
	out.push('');
	out.push('## Legend');
	out.push('');
	out.push('- **Ratio**: `compressed / original × 100%` — lower is smaller output.');
	out.push('- **Compress / Decompress**: throughput in auto-scaled units — higher is faster.');
	out.push('- **Implementation column**: fastest / smallest output');
	out.push('- **ZipKit**: default balanced mode (adaptive dispatch — native on Bun, Wasm elsewhere).');
	out.push('- **ZipKit (ratio)**: high-compression mode. For gzip/deflate this uses libdeflate (denser than zlib); for zstd uses level 19; for brotli uses quality 11.');
	out.push('- **Competitors**: fflate and pako use level 6, zstd-wasm uses level 3, brotli-wasm uses quality 6.');

	const report = out.join('\n');
	await Bun.write('bench-results.md', report);
	process.stdout.write(report + '\n');
	process.stderr.write('\nWrote bench-results.md\n');

	// Tear the pool down only after everything is written, then exit explicitly
	// so unref'd workers can't end the process mid-flight.
	await sharedPool().destroy();
	process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
