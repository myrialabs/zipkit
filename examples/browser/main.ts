import * as zstdWasm from '@bokuweb/zstd-wasm';
import zstdWasmUrl from './node_modules/@bokuweb/zstd-wasm/dist/web/zstd.wasm?url';
import brotliInit, * as brotliWasm from './node_modules/brotli-wasm/pkg.web/brotli_wasm.js';
import brotliWasmUrl from './node_modules/brotli-wasm/pkg.web/brotli_wasm_bg.wasm?url';
import * as fflate from 'fflate';
import lz4 from 'lz4js';
import pako from 'pako';
import snappy from 'snappyjs';
import { compress, decompressWith, getEngine, type Codec, type CompressionMode } from 'zipkit';

interface Scenario {
	id: string;
	name: string;
	description: string;
	payload: string;
	generate?: () => Uint8Array;
}

interface Result {
	codec: Codec;
	implementation: string;
	zipkit: boolean;
	bytes: number;
	ratio: number;
	ms: number;
	compressMs: number;
	decompressMs: number;
	iterations: number;
	ok: boolean;
	error?: string;
}

interface Candidate {
	codec: Codec;
	implementation: string;
	zipkit?: boolean;
	compress: (data: Uint8Array, mode: CompressionMode) => Promise<Uint8Array>;
	decompress: (data: Uint8Array) => Promise<Uint8Array>;
}

const codecs: Codec[] = ['gzip', 'deflate', 'zlib', 'zstd', 'lz4', 'snappy', 'brotli', 'lzma', 'bzip2'];
const utf8 = new TextEncoder();
const zstdReady = zstdWasm.init(zstdWasmUrl);
const brotliModule = brotliInit(brotliWasmUrl).then(() => brotliWasm);
const engineReady = getEngine(); // pre-warm ZipKit engine so first compress() is not penalised

const scenarios: Scenario[] = [
	{
		id: 'ecommerce',
		name: 'E-commerce API',
		description: 'GraphQL product catalog with variants, images, and reviews.',
		payload: JSON.stringify(Array.from({ length: 80 }, (_, i) => ({
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
				stock: 5 + ((i * 7 + j * 3) % 50)
			})),
			images: Array.from({ length: 3 }, (_, j) => ({
				url: `https://cdn.store/img/${(10000 + i).toString(36)}/${j + 1}.jpg`,
				width: 800,
				height: 800
			}))
		})), null, 2)
	},
	{
		id: 'weblogs',
		name: 'Web logs',
		description: 'Nginx combined-format access logs with varied routes and agents.',
		payload: Array.from({ length: 300 }, (_, i) => {
			const ip = `${10 + (i * 7) % 200}.${(i * 13) % 256}.${(i * 3) % 256}.${(i * 11) % 256}`;
			const ts = `17/Jun/2026:${String(Math.floor(i / 60) % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00 +0000`;
			const method = ['GET', 'GET', 'GET', 'POST', 'PUT'][i % 5];
			const path = ['/api/products', '/api/orders', '/api/cart', '/api/users', '/api/search'][i % 5];
			const status = [200, 200, 200, 201, 204, 301, 400, 404, 429][i % 9];
			const size = 200 + ((i * 37) % 15000);
			const agent = ['Mozilla/5.0 Chrome/124', 'Mozilla/5.0 Firefox/126', 'curl/8.7', 'axios/1.7', 'node-fetch/3.3'][i % 5];
			return `${ip} - - [${ts}] "${method} ${path}?page=${(i % 10) + 1}&limit=50 HTTP/1.1" ${status} ${size} "-" "${agent}"`;
		}).join('\n')
	},
	{
		id: 'dashboard',
		name: 'Admin dashboard',
		description: 'Full HTML5 page with sidebar navigation, tables, and inline CSS.',
		payload: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard</title><style>'
			+ '*{box-sizing:border-box;margin:0;padding:0}body{font:14px/1.5 Inter,sans-serif;background:#f5f6fa;display:grid;grid-template-columns:260px 1fr;min-height:100vh}'
			+ 'nav{background:#1e293b;color:#fff;padding:20px}nav h2{font-size:16px;margin-bottom:20px;opacity:.7}nav a{display:block;padding:10px 14px;color:#94a3b8;text-decoration:none;border-radius:6px;margin-bottom:4px}'
			+ 'nav a.active,nav a:hover{background:#334155;color:#fff}main{padding:24px}.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}'
			+ '.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}.card{background:#fff;border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08)}'
			+ '.card .label{font-size:12px;color:#64748b;margin-bottom:4px}.card .value{font-size:24px;font-weight:700}'
			+ 'table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}'
			+ 'th,td{padding:12px 14px;text-align:left;border-bottom:1px solid #e2e8f0}th{background:#f8fafc;font-weight:600;color:#475569;font-size:12px;text-transform:uppercase}'
			+ '.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600}.badge.active{background:#dcfce7;color:#166534}.badge.pending{background:#fef9c3;color:#854d0e}'
			+ '.badge.cancelled{background:#fee2e2;color:#991b1b}@media(max-width:768px){body{grid-template-columns:1fr}nav{display:none}.cards{grid-template-columns:1fr 1fr}}</style></head><body>'
			+ '<nav><h2>MyApp Admin</h2>'
			+ ['Dashboard', 'Orders', 'Products', 'Customers', 'Analytics', 'Settings'].map(s => `<a href="/${s.toLowerCase()}" class="${s === 'Dashboard' ? 'active' : ''}">${s}</a>`).join('')
			+ '</nav><main>'
			+ '<div class="header"><h1>Dashboard</h1><div><select style="padding:8px 12px;border:1px solid #e2e8f0;border-radius:6px"><option>Last 7 days</option><option>Last 30 days</option></select></div></div>'
			+ '<div class="cards">'
			+ [
				{ label: 'Total revenue', value: '$48,290' },
				{ label: 'Orders', value: '1,842' },
				{ label: 'Customers', value: '12,487' },
				{ label: 'Conversion', value: '3.24%' }
			].map(c => `<div class="card"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`).join('')
			+ '</div>'
			+ '<table><thead><tr><th>Order</th><th>Customer</th><th>Product</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>'
			+ Array.from({ length: 50 }, (_, i) => {
				const status = ['active', 'pending', 'cancelled'][i % 3];
				return `<tr><td>#${1000 + i}</td><td>${['alice@mail.com', 'bob@mail.com', 'carol@mail.com', 'dave@mail.com'][i % 4]}</td>`
					+ `<td>Wireless Headphones ${['Pro', 'Max', 'Lite'][i % 3]}</td><td>$${(49.99 + (i % 5) * 30).toFixed(2)}</td>`
					+ `<td><span class="badge ${status}">${status}</span></td><td>${new Date(Date.now() - i * 86400000).toLocaleDateString('en-CA')}</td></tr>`;
			}).join('')
			+ '</tbody></table></main></body></html>'
	},
	{
		id: 'lockfile',
		name: 'npm lockfile',
		description: 'Deeply nested package-lock.json with repeated dependency trees.',
		payload: JSON.stringify({
			name: 'my-app',
			lockfileVersion: 3,
			requires: true,
			packages: Object.fromEntries(
				Array.from({ length: 180 }, (_, i) => {
					const scope = ['@core', '@ui', '@utils', '@api'][i % 4];
					const name = `${scope}/${['kit', 'hooks', 'icons', 'utils', 'styles', 'config', 'types', 'helpers'][(i * 3) % 8]}`;
					const version = `${1 + (i % 5)}.${(i * 7) % 10}.${(i * 13) % 99}`;
					const deps: Record<string, string> = {};
					if (i % 3 === 0) deps[`@core/react`] = `^${1 + (i % 2)}.0.0`;
					if (i % 5 === 0) deps[`@utils/helpers`] = `^0.${(i * 3) % 9}.0`;
					return [`node_modules/${name}`, {
						version,
						license: 'MIT',
						resolved: `https://registry.npmjs.org/${name}/-/${name.replace('/', '-')}-${version}.tgz`,
						integrity: `sha512-${btoa(String.fromCharCode(...new Uint8Array(32).map(() => (i * 17 + 53) % 256))).slice(0, 27)}`,
						engines: { node: '>=18.0.0' },
						...(i % 4 === 0 && { dependencies: { '@babel/runtime': '^7.24.0', 'tslib': '^2.6.0' } }),
						...(Object.keys(deps).length && { dependencies: deps })
					}];
				})
			)
		}, null, 2)
	},
	{
		id: 'binary',
		name: 'Binary-like',
		description: 'Deterministic high-entropy bytes rendered as Latin-1 text.',
		payload: Array.from({ length: 24_000 }, (_, i) => String.fromCharCode((i * 1103515245 + 12345) & 0xff)).join('')
	},
	{
		id: 'dbdump',
		name: 'Database dump',
		description: 'SQL dump with 2000 INSERT rows across 12 tables.',
		generate: () => {
			const tables = ['users', 'orders', 'products', 'reviews', 'inventory', 'categories', 'tags', 'sessions', 'logs', 'analytics', 'shipping', 'payments'];
			const lines: string[] = [];
			for (let t = 0; t < tables.length; t++) {
				const table = tables[t];
				const rows = 100 + t * 50;
				const cols = ['id', 'name', 'created_at', 'updated_at', 'status'];
				lines.push(`INSERT INTO \`${table}\` (${cols.join(', ')}) VALUES\n`);
				for (let r = 0; r < rows; r++) {
					const id = t * 10000 + r + 1;
					const name = `'${table}_${r}_${'x'.repeat(20 + (r % 60))}'`;
					const ts = `'2026-0${1 + (t % 9)}-${String(10 + (r % 20)).padStart(2, '0')} 00:00:00'`;
					const status = `'${['active', 'pending', 'archived'][r % 3]}'`;
					lines.push(`  (${id}, ${name}, ${ts}, ${ts}, ${status})${r < rows - 1 ? ',' : ';'}\n`);
				}
				lines.push('\n');
			}
			return new TextEncoder().encode(lines.join(''));
		}
	},
	{
		id: 'videos',
		name: 'Video metadata',
		description: 'JSON catalog of 800 videos with titles, tags, URLs, and stats.',
		payload: JSON.stringify(Array.from({ length: 800 }, (_, i) => ({
			id: `vid_${i.toString(36).padStart(6, '0')}`,
			title: [
				'How to deploy a Node.js app with Docker',
				'Understanding WebAssembly for frontend developers',
				'TypeScript 5.7 new features explained',
				'Building a REST API with Express and Prisma',
				'React Server Components in depth',
				'CSS Grid vs Flexbox: when to use what',
				'Introduction to WebSocket with Bun',
				'Database indexing strategies for PostgreSQL',
				'Unit testing best practices with Vitest',
				'Monorepos with Turborepo and pnpm workspaces',
			][i % 10],
			channel: ['TechTalks', 'CodeCraft', 'DevDose', 'ByteGrad', 'SyntaxFM'][i % 5],
			durationSec: 120 + ((i * 37) % 3600),
			resolution: [1080, 1440, 2160][i % 3],
			fps: [24, 30, 60][i % 3],
			codec: ['h264', 'h265', 'av1'][i % 3],
			tags: [
				['tutorial', 'javascript'],
				['web', 'performance'],
				['typescript', 'guide'],
				['backend', 'api'],
				['react', 'frontend'],
				['css', 'layout'],
				['websocket', 'bun'],
				['database', 'postgres'],
				['testing', 'vitest'],
				['monorepo', 'tools'],
			][i % 10],
			views: 1000 + (i * 137 % 99000),
			likes: 50 + (i * 23 % 5000),
			published: `2026-0${1 + (i % 9)}-${String(10 + (i % 20)).padStart(2, '0')}T08:00:00Z`,
			thumbnails: {
				small: `https://cdn.techvids/thumb/${i}_sm.jpg`,
				large: `https://cdn.techvids/thumb/${i}_lg.jpg`,
			},
			streamUrl: `https://cdn.techvids/stream/${i}/index.m3u8`,
		})), null, 2)
	},
	{
		id: 'upload',
		name: 'Upload file',
		description: 'Use a file from your device as the payload.',
		payload: ''
	}
];



const input = document.getElementById('input') as HTMLTextAreaElement;
const file = document.getElementById('file') as HTMLInputElement;
const run = document.getElementById('run') as HTMLButtonElement;
const mode = document.getElementById('mode') as HTMLSelectElement;
const iterationsInput = document.getElementById('iterations') as HTMLInputElement;
const scenarioList = document.getElementById('scenarios') as HTMLDivElement;
const codecList = document.getElementById('codecs') as HTMLDivElement;
const resultsBody = document.getElementById('results') as HTMLTableSectionElement;
const inputSize = document.getElementById('input-size') as HTMLElement;
const bestRatio = document.getElementById('best-ratio') as HTMLElement;
const bestCompress = document.getElementById('best-compress') as HTMLElement;
const bestDecompress = document.getElementById('best-decompress') as HTMLElement;
const payloadMeta = document.getElementById('payload-meta') as HTMLElement;
const fileMeta = document.getElementById('file-meta') as HTMLElement;
const errorBox = document.getElementById('error') as HTMLElement;
const editorSection = document.getElementById('editor-section') as HTMLDivElement;
const uploadSection = document.getElementById('upload-section') as HTMLDivElement;
const includeCompetitorsCheck = document.getElementById('include-competitors') as HTMLInputElement;

let activeScenario = scenarios[0]!;
let uploaded: Uint8Array | undefined;
let generatedPayload: Uint8Array | undefined;

let lastScenarioId = '';
let lastMode = '';
let lastIterations = '';

function resetResultsIfConfigChanged(): void {
	const modeVal = mode.value;
	const iterVal = iterationsInput.value;
	if (activeScenario.id !== lastScenarioId || modeVal !== lastMode || iterVal !== lastIterations) {
		resultsBody.innerHTML = '<tr><td colspan="7" style="text-align:left">Run a comparison to see results.</td></tr>';
		bestCompress.textContent = '-';
		bestDecompress.textContent = '-';
		bestRatio.textContent = '-';
	}
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatThroughput(bytes: number, ms: number): string {
	if (ms === 0) {
		// below timer resolution (~0.01ms) — show lower bound
		const bps = bytes / 1e-5;
		return formatBPS(bps, '≥');
	}
	const bps = bytes / (ms / 1000);
	return formatBPS(bps);
}

function formatBPS(bps: number, prefix = ''): string {
	if (bps >= 1024 * 1024 * 1024) return `${prefix}${(bps / 1024 / 1024 / 1024).toFixed(1)} GB/s`;
	if (bps >= 1024 * 1024) return `${prefix}${(bps / 1024 / 1024).toFixed(0)} MB/s`;
	if (bps >= 1024) return `${prefix}${(bps / 1024).toFixed(1)} KB/s`;
	return `${prefix}${Math.round(bps)} B/s`;
}


function selectedCodecs(): Codec[] {
	const checked = Array.from(codecList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'));
	return checked.map((el) => el.value as Codec);
}

function editorBytes(): Uint8Array {
	return utf8.encode(input.value);
}

function currentPayload(): Uint8Array {
	if (generatedPayload) return generatedPayload;
	if (activeScenario.id === 'upload') return uploaded ?? editorBytes();
	return editorBytes();
}

function updatePayloadMeta(): void {
	const bytes = currentPayload();
	inputSize.textContent = formatBytes(bytes.length);
	if (activeScenario.generate) {
		payloadMeta.textContent = `${formatBytes(bytes.length)} from ${activeScenario.name}`;
	} else if (activeScenario.id === 'upload') {
		payloadMeta.textContent = uploaded
			? `${formatBytes(uploaded.length)} from uploaded file`
			: 'No file selected.';
	} else {
		payloadMeta.textContent = `${formatBytes(editorBytes().length)} from ${activeScenario.name}`;
	}
}

function setScenario(scenario: Scenario): void {
	activeScenario = scenario;
	uploaded = undefined;
	generatedPayload = undefined;
	file.value = '';
	const isUpload = scenario.id === 'upload';
	const isGenerated = !!scenario.generate;
	editorSection.style.display = isUpload || isGenerated ? 'none' : '';
	uploadSection.style.display = isUpload ? '' : 'none';
	if (isGenerated) {
		try {
			generatedPayload = scenario.generate!();
		} catch (err) {
			generatedPayload = undefined;
			errorBox.textContent = err instanceof Error ? err.message : String(err);
			return;
		}
		input.value = `[generated: ${formatBytes(generatedPayload.length)}]`;
		fileMeta.textContent = 'Generated programmatically — edit disabled.';
	} else {
		input.value = scenario.payload;
		fileMeta.textContent = isUpload ? 'Select a file to use as the payload.' : 'No file selected. The editor payload is used.';
	}
	for (const button of scenarioList.querySelectorAll<HTMLButtonElement>('button')) {
		button.classList.toggle('active', button.dataset.id === scenario.id);
	}
	resetResultsIfConfigChanged();
	updatePayloadMeta();
}

function renderScenarios(): void {
	scenarioList.innerHTML = '';
	for (const scenario of scenarios) {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'scenario';
		button.dataset.id = scenario.id;
		button.innerHTML = `<strong>${scenario.name}</strong><span>${scenario.description}</span>`;
		button.addEventListener('click', () => setScenario(scenario));
		scenarioList.append(button);
	}
}

function renderCodecs(): void {
	codecList.innerHTML = '';
	for (const codec of codecs) {
		const label = document.createElement('label');
		label.innerHTML = `<input type="checkbox" value="${codec}" checked> ${codec}`;
		codecList.append(label);
	}
}

function candidatesFor(codec: Codec): Candidate[] {
	const candidates: Candidate[] = [
		{
			codec,
			implementation: 'ZipKit',
			zipkit: true,
			compress: async (data, mode) => compress(data, codec, { mode }),
			decompress: async (data) => decompressWith(data, codec),
		}
	];

	if (codec === 'gzip') {
		candidates.push(
			{
				codec,
				implementation: 'fflate',
				compress: async (data) => fflate.gzipSync(data, { level: 6 }),
				decompress: async (data) => fflate.gunzipSync(data),
			},
			{
				codec,
				implementation: 'pako',
				compress: async (data) => pako.gzip(data, { level: 6 }),
				decompress: async (data) => pako.ungzip(data),
			}
		);
	}

	if (codec === 'deflate') {
		candidates.push(
			{
				codec,
				implementation: 'fflate',
				compress: async (data) => fflate.deflateSync(data, { level: 6 }),
				decompress: async (data) => fflate.inflateSync(data),
			},
			{
				codec,
				implementation: 'pako',
				compress: async (data) => pako.deflateRaw(data, { level: 6 }),
				decompress: async (data) => pako.inflateRaw(data),
			}
		);
	}

	if (codec === 'zlib') {
		candidates.push(
			{
				codec,
				implementation: 'fflate',
				compress: async (data) => fflate.zlibSync(data, { level: 6 }),
				decompress: async (data) => fflate.unzlibSync(data),
			},
			{
				codec,
				implementation: 'pako',
				compress: async (data) => pako.deflate(data, { level: 6 }),
				decompress: async (data) => pako.inflate(data),
			}
		);
	}

	if (codec === 'zstd') {
		candidates.push({
			codec,
			implementation: 'zstd-wasm',
			compress: async (data) => { await zstdReady; return new Uint8Array(zstdWasm.compress(data, 3)); },
			decompress: async (data) => new Uint8Array(zstdWasm.decompress(data)),
		});
	}

	if (codec === 'lz4') {
		candidates.push({
			codec,
			implementation: 'lz4js',
			compress: async (data) => new Uint8Array(lz4.compress(data)),
			decompress: async (data) => new Uint8Array(lz4.decompress(data)),
		});
	}

	if (codec === 'snappy') {
		candidates.push({
			codec,
			implementation: 'snappyjs',
			compress: async (data) => new Uint8Array(snappy.compress(data)),
			decompress: async (data) => new Uint8Array(snappy.uncompress(data)),
		});
	}

	if (codec === 'brotli') {
		candidates.push({
			codec,
			implementation: 'brotli-wasm',
			compress: async (data, mode) => {
				const brotli = await brotliModule;
				const quality = mode === 'ratio' ? 11 : mode === 'speed' ? 4 : 6;
				return brotli.compress(data, { quality });
			},
			decompress: async (data) => {
				const brotli = await brotliModule;
				return brotli.decompress(data);
			},
		});
	}

	return candidates;
}

async function readFile(selected: File | undefined): Promise<void> {
	if (!selected) {
		uploaded = undefined;
		fileMeta.textContent = activeScenario.id === 'upload'
			? 'No file selected.'
			: 'No file selected. The editor payload is used.';
		updatePayloadMeta();
		return;
	}
	uploaded = new Uint8Array(await selected.arrayBuffer());
	fileMeta.textContent = `${selected.name} · ${formatBytes(uploaded.length)} · ${selected.type || 'unknown type'}`;
	updatePayloadMeta();
}

function setBusy(isBusy: boolean): void {
	run.disabled = isBusy;
	run.textContent = isBusy ? 'Running...' : 'Run comparison';
}

function renderResults(results: Result[], dataLength: number): void {
	const okResults = results.filter((r) => r.ok);
	const fastest = okResults.reduce<Result | undefined>((best, r) => !best || r.ms < best.ms ? r : best, undefined);
	const smallest = okResults.reduce<Result | undefined>((best, r) => !best || r.bytes < best.bytes ? r : best, undefined);
	const compressChamp = okResults.reduce<Result | undefined>((best, r) => !best || r.compressMs < best.compressMs ? r : best, undefined);
	const decompressChamp = okResults.reduce<Result | undefined>((best, r) => !best || r.decompressMs < best.decompressMs ? r : best, undefined);

	bestCompress.textContent = compressChamp
		? `${compressChamp.implementation} (${compressChamp.codec}) · ${formatThroughput(dataLength, compressChamp.compressMs)}`
		: '-';
	bestDecompress.textContent = decompressChamp
		? `${decompressChamp.implementation} (${decompressChamp.codec}) · ${formatThroughput(dataLength, decompressChamp.decompressMs)}`
		: '-';
	bestRatio.textContent = smallest ? `${smallest.implementation} (${smallest.codec}) · ${(smallest.ratio * 100).toFixed(1)}%` : '-';

	const grouped = new Map<string, Result[]>();
	for (const result of results) {
		const group = grouped.get(result.codec) ?? [];
		group.push(result);
		grouped.set(result.codec, group);
	}

	const loadingRow = resultsBody.querySelector('.loading');
	resultsBody.innerHTML = '';
	for (const [codec, group] of grouped) {
		const headerRow = document.createElement('tr');
		headerRow.className = 'codec-group';
		headerRow.innerHTML = `<td colspan="7"><strong>${codec}</strong></td>`;
		resultsBody.append(headerRow);

		const ok = group.filter((r) => r.ok);

		for (const result of group) {
			const tr = document.createElement('tr');
			const globalBest = result === fastest
				? '<span class="badge" style="background:#fef9c3;color:#854d0e">fastest</span>'
				: result === smallest
					? '<span class="badge" style="background:#e6f4ff;color:#175cd3">smallest</span>'
					: '';

			if (result.ok) {
				tr.innerHTML = `<td>${globalBest}</td><td>${result.implementation}</td>`
					+ `<td>${formatBytes(result.bytes)}</td>`
					+ `<td>${(result.ratio * 100).toFixed(1)}%</td>`
					+ `<td>${formatThroughput(dataLength, result.compressMs)}</td>`
					+ `<td>${formatThroughput(dataLength, result.decompressMs)}</td>`
					+ `<td>ok</td>`;
			} else {
				tr.innerHTML = `<td></td><td>${result.implementation}</td><td colspan="5" style="text-align:left">${result.error ?? 'failed'}</td>`;
			}
			resultsBody.append(tr);
		}
	}
	if (loadingRow) resultsBody.append(loadingRow);
}


async function runComparison(): Promise<void> {
	errorBox.textContent = '';
	if (activeScenario.id === 'upload' && !uploaded) {
		errorBox.textContent = 'Select a file first.';
		return;
	}
	const data = currentPayload();
	const chosen = selectedCodecs();
	if (chosen.length === 0) {
		errorBox.textContent = 'Select at least one codec.';
		return;
	}
	const includeCompetitors = includeCompetitorsCheck.checked;
	const iters = Math.max(1, parseInt(iterationsInput.value, 10) || 1);
	setBusy(true);
	const label = iters > 1 ? `Running ${iters}× per candidate…` : 'Compressing…';
	resultsBody.innerHTML = `<tr class="loading"><td colspan="7">${label}</td></tr>`;
	await new Promise((r) => requestAnimationFrame(r));
	const rows: Result[] = [];
	for (const codec of chosen) {
		const loadingEl = resultsBody.querySelector('.loading td:last-child');
		if (loadingEl) loadingEl.textContent = `${codec}${iters > 1 ? ` ×${iters}` : ''}…`;
		for (const candidate of candidatesFor(codec)) {
			if (!includeCompetitors && !candidate.zipkit) continue;
			try {
				const activeMode = mode.value as CompressionMode;
				let compressed: Uint8Array;
				let restored: Uint8Array;

				const t0 = performance.now();
				for (let n = 0; n < iters; n++) {
					const c = await candidate.compress(data, activeMode);
					if (n === 0) compressed = c;
				}
				const t1 = performance.now();

				const t2 = performance.now();
				for (let n = 0; n < iters; n++) {
					restored = await candidate.decompress(compressed!);
				}
				const t3 = performance.now();

				const compressMs = (t1 - t0) / iters;
				const decompressMs = (t3 - t2) / iters;
				const ok = restored!.length === data.length && restored!.every((v, i) => v === data[i]);
				rows.push({
					codec,
					implementation: candidate.implementation,
					zipkit: candidate.zipkit ?? false,
					bytes: compressed!.length,
					ratio: data.length ? compressed!.length / data.length : 0,
					ms: compressMs + decompressMs,
					compressMs,
					decompressMs,
					iterations: iters,
					ok
				});
			} catch (err) {
				rows.push({
					codec,
					implementation: candidate.implementation,
					zipkit: candidate.zipkit ?? false,
					bytes: 0,
					ratio: 0,
					ms: 0,
					compressMs: 0,
					decompressMs: 0,
					iterations: iters,
					ok: false,
					error: err instanceof Error ? err.message : String(err)
				});
			}
			renderResults(rows, data.length);
			// yield so browser can paint the spinner animation
			await new Promise((r) => setTimeout(r, 0));
		}
	}
	// remove loading row once fully done
	resultsBody.querySelector('.loading')?.remove();
	lastScenarioId = activeScenario.id;
	lastMode = mode.value;
	lastIterations = iterationsInput.value;
	setBusy(false);
}

input.addEventListener('input', () => {
	if (activeScenario.id === 'upload') return;
	uploaded = undefined;
	file.value = '';
	fileMeta.textContent = 'No file selected. The editor payload is used.';
	updatePayloadMeta();
});

file.addEventListener('change', () => {
	void readFile(file.files?.[0]);
});

uploadSection.addEventListener('dragover', (event) => {
	event.preventDefault();
	uploadSection.classList.add('drag');
});

uploadSection.addEventListener('dragleave', () => {
	uploadSection.classList.remove('drag');
});

uploadSection.addEventListener('drop', (event) => {
	event.preventDefault();
	uploadSection.classList.remove('drag');
	const selected = event.dataTransfer?.files?.[0];
	if (selected) {
		const transfer = new DataTransfer();
		transfer.items.add(selected);
		file.files = transfer.files;
		void readFile(selected);
	}
});

run.addEventListener('click', () => {
	void runComparison();
});

mode.addEventListener('change', () => resetResultsIfConfigChanged());
iterationsInput.addEventListener('input', () => resetResultsIfConfigChanged());

renderScenarios();
renderCodecs();
setScenario(activeScenario);
