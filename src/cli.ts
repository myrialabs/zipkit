#!/usr/bin/env node

/**
 * zipkit CLI
 *
 * A thin command line over the library, so ZipKit can be used straight from a
 * terminal (`npm i -g zipkit` / `bun add -g zipkit`).
 *
 *   zipkit compress <file> [--codec zstd] [--mode ratio] [--level N] [-o out]
 *   zipkit decompress <file> [--codec gzip] [-o out]   (auto-detects by default)
 *   zipkit zip <archive.zip> <files...> [--method deflate|zstd|store]
 *   zipkit unzip <archive.zip> [-d <dir>]
 *   zipkit info <file>                 Inspect a file (format, or ZIP listing)
 *   zipkit bench <file>                Compare every codec on a file
 *   zipkit version | help
 */

import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, basename, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compress, decompress, decompressWith } from './compress.js';
import { detectFormat } from './detect.js';
import { zip as zipArchive, unzip as unzipArchive, listEntries, type ZipMethod } from './zip/index.js';
import { tar, untar, tarGz, untarGz, tarZstd, untarZstd, type TarEntryInput } from './tar/index.js';
import { sevenZip, unSevenZip, type SevenZipEntryInput } from './sevenzip/index.js';
import { xz as xzCompressFn, unxz } from './codecs/xz.js';
import { presetCorpus } from './bench/corpus.js';
import type { Codec, CompressionMode, CompressOptions } from './types.js';

const CODECS: Codec[] = ['gzip', 'deflate', 'zlib', 'zstd', 'lz4', 'snappy', 'brotli', 'lzma', 'bzip2'];
/** Codecs selectable on the CLI — the {@link Codec} set plus the `xz` container. */
const CLI_CODECS = [...CODECS, 'xz'] as const;
type CliCodec = (typeof CLI_CODECS)[number];

/** Compress with a CLI codec, routing `xz` to its container codec. */
function cliCompress(data: Uint8Array, codec: CliCodec, opts?: CompressOptions): Promise<Uint8Array> {
	return codec === 'xz' ? xzCompressFn(data, opts) : compress(data, codec, opts);
}

/** Decompress with an explicit CLI codec, routing `xz` to its container codec. */
function cliDecompress(data: Uint8Array, codec: CliCodec): Promise<Uint8Array> {
	return codec === 'xz' ? unxz(data) : decompressWith(data, codec);
}
const MODES: CompressionMode[] = ['speed', 'balanced', 'ratio'];

// --- tiny ANSI helpers (no deps) ---
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = {
	bold: wrap('1'),
	dim: wrap('2'),
	red: wrap('31'),
	green: wrap('32'),
	cyan: wrap('36'),
	accent: wrap('35')
};
const out = (s = '') => process.stdout.write(s + '\n');
const err = (s = '') => process.stderr.write(s + '\n');

function fail(message: string): never {
	err(c.red(message));
	err(c.dim('Run `zipkit help` for usage.'));
	process.exit(1);
}

function readVersion(): string {
	try {
		const here = dirname(fileURLToPath(import.meta.url));
		const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
		return pkg.version ?? '0.0.0';
	} catch {
		return '0.0.0';
	}
}

/** Minimal flag parser: `--key value`, `--flag`, `-o value`, rest are positionals. */
function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
	const positional: string[] = [];
	const flags: Record<string, string | boolean> = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a === '-o' || a === '--out') {
			flags.out = argv[++i] ?? '';
		} else if (a === '-d' || a === '--dir') {
			flags.dir = argv[++i] ?? '';
		} else if (a.startsWith('--')) {
			const key = a.slice(2);
			const next = argv[i + 1];
			if (next === undefined || next.startsWith('-')) flags[key] = true;
			else flags[key] = argv[++i]!;
		} else {
			positional.push(a);
		}
	}
	return { positional, flags };
}

/** Read a file as a standalone Uint8Array (not a Buffer view into a pool). */
function readBytes(file: string): Uint8Array {
	const buf = readFileSync(file);
	return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Recursively yield every regular file under `dir`. */
function* walkDir(dir: string): Generator<string> {
	for (const ent of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, ent.name);
		if (ent.isDirectory()) yield* walkDir(p);
		else if (ent.isFile()) yield p;
	}
}

/**
 * Expand CLI inputs into archive entries. A directory is walked recursively and
 * its files keep paths relative to the directory's parent (so `zipkit zip out
 * mydir` stores `mydir/...`); a file is stored under its basename. Archive paths
 * always use `/` separators.
 */
function collectEntries(inputs: string[]): { name: string; data: Uint8Array }[] {
	const entries: { name: string; data: Uint8Array }[] = [];
	for (const input of inputs) {
		const st = statSync(input);
		if (st.isDirectory()) {
			const base = dirname(input);
			for (const filePath of walkDir(input)) {
				entries.push({ name: relative(base, filePath).split(sep).join('/'), data: readBytes(filePath) });
			}
		} else {
			entries.push({ name: basename(input), data: readBytes(input) });
		}
	}
	return entries;
}

function fmtBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const EXT: Partial<Record<Codec, string>> = {
	gzip: 'gz',
	zlib: 'zz',
	deflate: 'deflate',
	zstd: 'zst',
	lz4: 'lz4',
	snappy: 'snappy',
	brotli: 'br',
	lzma: 'lzma',
	bzip2: 'bz2'
};
const XZ_EXT = 'xz';

async function cmdCompress(args: ReturnType<typeof parseArgs>): Promise<void> {
	const file = args.positional[0];
	if (!file) fail('Usage: zipkit compress <file> [--codec <codec>] [--mode speed|balanced|ratio] [--level N] [-o out]');
	const codec = (args.flags.codec as CliCodec) ?? 'zstd';
	if (!CLI_CODECS.includes(codec)) fail(`Unknown codec: ${codec}. One of: ${CLI_CODECS.join(', ')}`);
	const mode = args.flags.mode as CompressionMode | undefined;
	if (mode && !MODES.includes(mode)) fail(`Unknown mode: ${mode}. One of: ${MODES.join(', ')}`);
	const level = typeof args.flags.level === 'string' ? Number(args.flags.level) : undefined;
	const data = readBytes(file);
	const compressed = await cliCompress(data, codec, { mode, level });
	const dest = (args.flags.out as string) ?? `${file}.${codec === 'xz' ? XZ_EXT : EXT[codec as Codec] ?? codec}`;
	writeFileSync(dest, compressed);
	const ratio = data.length ? (compressed.length / data.length) : 0;
	out(
		`${c.green('✓')} ${codec}  ${fmtBytes(data.length)} → ${fmtBytes(compressed.length)}  ` +
			c.dim(`(${(ratio * 100).toFixed(1)}%)  ${dest}`)
	);
}

async function cmdDecompress(args: ReturnType<typeof parseArgs>): Promise<void> {
	const file = args.positional[0];
	if (!file) fail('Usage: zipkit decompress <file> [--codec <codec>] [-o out]');
	const data = readBytes(file);
	const codec = args.flags.codec as CliCodec | undefined;
	if (codec && !CLI_CODECS.includes(codec)) fail(`Unknown codec: ${codec}. One of: ${CLI_CODECS.join(', ')}`);
	const result = codec ? await cliDecompress(data, codec) : await decompress(data);
	const dest = (args.flags.out as string) ?? (file.replace(/\.[^.]+$/, '') || `${file}.out`);
	writeFileSync(dest, result);
	out(`${c.green('✓')} ${fmtBytes(data.length)} → ${fmtBytes(result.length)}  ${c.dim(dest)}`);
}

async function cmdZip(args: ReturnType<typeof parseArgs>): Promise<void> {
	const [archive, ...inputs] = args.positional;
	if (!archive || inputs.length === 0) {
		fail('Usage: zipkit zip <archive.zip> <files|dirs...> [--method deflate|zstd|store]');
	}
	const method = (args.flags.method as ZipMethod) ?? 'deflate';
	const entries = collectEntries(inputs).map((e) => ({ ...e, method }));
	const out2 = await zipArchive(entries);
	writeFileSync(archive, out2);
	out(`${c.green('✓')} ${entries.length} file(s) → ${archive} ${c.dim(`(${fmtBytes(out2.length)})`)}`);
}

/** Pick the tar flavor from the archive extension. */
function tarFlavor(name: string): 'plain' | 'gz' | 'zst' {
	if (/\.t(ar\.)?gz$/i.test(name) || /\.taz$/i.test(name)) return 'gz';
	if (/\.t(ar\.)?zst?$/i.test(name)) return 'zst';
	return 'plain';
}

async function cmdTar(args: ReturnType<typeof parseArgs>): Promise<void> {
	const [archive, ...inputs] = args.positional;
	if (!archive || inputs.length === 0) {
		fail('Usage: zipkit tar <archive.tar|.tar.gz|.tar.zst> <files|dirs...>');
	}
	const entries: TarEntryInput[] = collectEntries(inputs);
	const flavor = tarFlavor(archive);
	const bytes = flavor === 'gz' ? await tarGz(entries) : flavor === 'zst' ? await tarZstd(entries) : tar(entries);
	writeFileSync(archive, bytes);
	out(`${c.green('✓')} ${entries.length} file(s) → ${archive} ${c.dim(`(${fmtBytes(bytes.length)}, ${flavor})`)}`);
}

async function cmdUntar(args: ReturnType<typeof parseArgs>): Promise<void> {
	const file = args.positional[0];
	if (!file) fail('Usage: zipkit untar <archive.tar|.tar.gz|.tar.zst> [-d <dir>]');
	const dir = (args.flags.dir as string) ?? '.';
	const data = readBytes(file);
	const flavor = tarFlavor(file);
	const entries = flavor === 'gz' ? await untarGz(data) : flavor === 'zst' ? await untarZstd(data) : untar(data);
	let files = 0;
	for (const e of entries) {
		const dest = join(dir, e.name);
		if (e.type === 'directory') {
			mkdirSync(dest, { recursive: true });
			continue;
		}
		mkdirSync(dirname(dest), { recursive: true });
		writeFileSync(dest, e.data);
		files++;
		out(`  ${c.dim('extract')} ${e.name} ${c.dim(`(${fmtBytes(e.size)})`)}`);
	}
	out(`${c.green('✓')} ${files} file(s) → ${dir}`);
}

async function cmdUnzip(args: ReturnType<typeof parseArgs>): Promise<void> {
	const file = args.positional[0];
	if (!file) fail('Usage: zipkit unzip <archive.zip> [-d <dir>]');
	const dir = (args.flags.dir as string) ?? '.';
	const input = readFileSync(file);
	const entries = await unzipArchive(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
	for (const e of entries) {
		const dest = join(dir, e.name);
		mkdirSync(dirname(dest), { recursive: true });
		writeFileSync(dest, e.data);
		out(`  ${c.dim('extract')} ${e.name} ${c.dim(`(${fmtBytes(e.size)})`)}`);
	}
	out(`${c.green('✓')} ${entries.length} file(s) → ${dir}`);
}

async function cmdSevenZip(args: ReturnType<typeof parseArgs>): Promise<void> {
	const [archive, ...inputs] = args.positional;
	if (!archive || inputs.length === 0) fail('Usage: zipkit 7z <archive.7z> <files|dirs...> [--method lzma|copy]');
	const method = (args.flags.method as 'lzma' | 'copy') ?? 'lzma';
	const entries: SevenZipEntryInput[] = collectEntries(inputs).map((e) => ({ ...e, method }));
	const bytes = await sevenZip(entries);
	writeFileSync(archive, bytes);
	out(`${c.green('✓')} ${entries.length} file(s) → ${archive} ${c.dim(`(${fmtBytes(bytes.length)})`)}`);
}

async function cmdUnSevenZip(args: ReturnType<typeof parseArgs>): Promise<void> {
	const file = args.positional[0];
	if (!file) fail('Usage: zipkit un7z <archive.7z> [-d <dir>]');
	const dir = (args.flags.dir as string) ?? '.';
	const entries = await unSevenZip(readBytes(file));
	for (const e of entries) {
		const dest = join(dir, e.name);
		mkdirSync(dirname(dest), { recursive: true });
		writeFileSync(dest, e.data);
		out(`  ${c.dim('extract')} ${e.name} ${c.dim(`(${fmtBytes(e.size)})`)}`);
	}
	out(`${c.green('✓')} ${entries.length} file(s) → ${dir}`);
}

async function cmdInfo(args: ReturnType<typeof parseArgs>): Promise<void> {
	const file = args.positional[0];
	if (!file) fail('Usage: zipkit info <file>');
	const input = readFileSync(file);
	const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	const fmt = detectFormat(data);
	out(`${c.bold(file)}  ${c.dim(fmtBytes(data.length))}`);
	out(`format: ${fmt ? c.cyan(fmt) : c.dim('unrecognized (headerless codec or raw data)')}`);
	if (fmt === 'zip') {
		const list = await listEntries(data);
		out(c.dim(`${list.length} entries:`));
		for (const e of list) {
			out(`  ${e.name}  ${c.dim(`${fmtBytes(e.size)} → ${fmtBytes(e.compressedSize)}, method ${e.method}`)}`);
		}
	}
}

interface BenchRow {
	codec: string;
	ratio: number;
	size: number;
	compMs: number;
	decompMs: number;
	error?: string;
}

/** Run every CLI codec over `data`, returning one row each. */
async function benchDataset(data: Uint8Array): Promise<BenchRow[]> {
	const rows: BenchRow[] = [];
	for (const codec of CLI_CODECS) {
		try {
			const t0 = performance.now();
			const comp = await cliCompress(data, codec);
			const t1 = performance.now();
			await cliDecompress(comp, codec);
			const t2 = performance.now();
			rows.push({
				codec,
				ratio: data.length ? comp.length / data.length : 0,
				size: comp.length,
				compMs: t1 - t0,
				decompMs: t2 - t1
			});
		} catch (e) {
			rows.push({ codec, ratio: 0, size: 0, compMs: 0, decompMs: 0, error: e instanceof Error ? e.message : String(e) });
		}
	}
	return rows;
}

function printBenchTable(rows: BenchRow[]): void {
	out(c.dim('codec     ratio    size        comp     decomp'));
	for (const r of rows) {
		if (r.error) {
			out(`${r.codec.padEnd(9)} ${c.red('failed')} ${c.dim(r.error)}`);
			continue;
		}
		out(
			`${r.codec.padEnd(9)} ${(r.ratio * 100).toFixed(1).padStart(5)}%  ${fmtBytes(r.size).padStart(10)}  ` +
				`${r.compMs.toFixed(1).padStart(6)}ms ${r.decompMs.toFixed(1).padStart(6)}ms`
		);
	}
}

async function cmdBench(args: ReturnType<typeof parseArgs>): Promise<void> {
	const file = args.positional[0];
	const asJson = args.flags.json === true;

	// Datasets: an explicit file, or the built-in deterministic preset corpus.
	const datasets: { name: string; description?: string; data: Uint8Array }[] = file
		? [{ name: file, data: readBytes(file) }]
		: presetCorpus().map((d) => ({ name: d.name, description: d.description, data: d.data }));

	const report: { dataset: string; bytes: number; rows: BenchRow[] }[] = [];
	for (const ds of datasets) {
		report.push({ dataset: ds.name, bytes: ds.data.length, rows: await benchDataset(ds.data) });
	}

	if (asJson) {
		out(JSON.stringify(report, null, 2));
		return;
	}

	if (!file) out(c.dim('No file given — benchmarking the built-in preset corpus.'));
	for (const r of report) {
		out('');
		out(`${c.bold('bench')} ${r.dataset} ${c.dim(`(${fmtBytes(r.bytes)})`)}`);
		printBenchTable(r.rows);
	}
}

function showHelp(version: string): void {
	out(`
${c.accent('zipkit')} ${c.dim(`v${version}`)} — overkill compression from your terminal

${c.bold('USAGE')}
  zipkit <command> [options]

${c.bold('COMMANDS')}
  compress <file>      Compress a file        ${c.dim('--codec <c> --mode <m> --level N -o out')}
  decompress <file>    Decompress a file      ${c.dim('--codec <c> (auto-detects) -o out')}
  zip <out.zip> <files|dirs...>   Create a ZIP ${c.dim('--method deflate|zstd|store (dirs recurse)')}
  unzip <archive.zip>  Extract a ZIP          ${c.dim('-d <dir>')}
  tar <out.tar[.gz|.zst]> <files|dirs...>   Create a tarball ${c.dim('(flavor by extension)')}
  untar <archive.tar[.gz|.zst]>   Extract a tarball ${c.dim('-d <dir>')}
  7z <out.7z> <files|dirs...>   Create a 7z archive ${c.dim('--method lzma|copy')}
  un7z <archive.7z>    Extract a 7z archive       ${c.dim('-d <dir>')}
  info <file>          Show format / ZIP listing
  bench [file]         Compare every codec ${c.dim('(preset corpus if no file; --json for CI)')}
  version              Print the version
  help                 Show this help

${c.bold('CODECS')}
  ${CLI_CODECS.join(', ')}

${c.bold('MODES')}
  ${MODES.join(', ')}  ${c.dim('(speed | balanced [default] | ratio — picks a codec-specific level)')}

${c.bold('EXAMPLES')}
  zipkit compress data.json --codec zstd --mode ratio
  zipkit decompress data.json.zst
  zipkit zip site.zip ./public --method zstd
  zipkit unzip site.zip -d ./out
  zipkit tar release.tar.zst ./dist
  zipkit untar release.tar.zst -d ./out
  zipkit bench big.log

Docs: https://github.com/myrialabs/zipkit
`);
}

async function main(): Promise<void> {
	const version = readVersion();
	const argv = process.argv.slice(2);
	const command = argv[0];

	if (!command || command === 'help' || command === '-h' || command === '--help') {
		showHelp(version);
		return;
	}
	if (command === 'version' || command === '-v' || command === '--version') {
		out(`v${version}`);
		return;
	}

	const rest = parseArgs(argv.slice(1));
	switch (command) {
		case 'compress':
			return cmdCompress(rest);
		case 'decompress':
			return cmdDecompress(rest);
		case 'zip':
			return cmdZip(rest);
		case 'unzip':
			return cmdUnzip(rest);
		case 'tar':
			return cmdTar(rest);
		case 'untar':
			return cmdUntar(rest);
		case '7z':
			return cmdSevenZip(rest);
		case 'un7z':
			return cmdUnSevenZip(rest);
		case 'info':
			return cmdInfo(rest);
		case 'bench':
			return cmdBench(rest);
		default:
			fail(`Unknown command: ${command}`);
	}
}

main().catch((e) => {
	err(c.red(`Error: ${e instanceof Error ? e.message : String(e)}`));
	process.exit(1);
});
