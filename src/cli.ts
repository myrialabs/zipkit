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

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compress, decompress, decompressWith } from './compress.js';
import { detectFormat } from './detect.js';
import { zip as zipArchive, unzip as unzipArchive, listEntries, type ZipMethod } from './zip/index.js';
import type { Codec, CompressionMode } from './types.js';

const CODECS: Codec[] = ['gzip', 'deflate', 'zlib', 'zstd', 'lz4', 'snappy', 'brotli', 'lzma', 'bzip2'];
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

async function cmdCompress(args: ReturnType<typeof parseArgs>): Promise<void> {
	const file = args.positional[0];
	if (!file) fail('Usage: zipkit compress <file> [--codec <codec>] [--mode speed|balanced|ratio] [--level N] [-o out]');
	const codec = (args.flags.codec as Codec) ?? 'zstd';
	if (!CODECS.includes(codec)) fail(`Unknown codec: ${codec}. One of: ${CODECS.join(', ')}`);
	const mode = args.flags.mode as CompressionMode | undefined;
	if (mode && !MODES.includes(mode)) fail(`Unknown mode: ${mode}. One of: ${MODES.join(', ')}`);
	const level = typeof args.flags.level === 'string' ? Number(args.flags.level) : undefined;
	const input = readFileSync(file);
	const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	const compressed = await compress(data, codec, { mode, level });
	const dest = (args.flags.out as string) ?? `${file}.${EXT[codec] ?? codec}`;
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
	const input = readFileSync(file);
	const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	const codec = args.flags.codec as Codec | undefined;
	const result = codec ? await decompressWith(data, codec) : await decompress(data);
	const dest = (args.flags.out as string) ?? (file.replace(/\.[^.]+$/, '') || `${file}.out`);
	writeFileSync(dest, result);
	out(`${c.green('✓')} ${fmtBytes(data.length)} → ${fmtBytes(result.length)}  ${c.dim(dest)}`);
}

async function cmdZip(args: ReturnType<typeof parseArgs>): Promise<void> {
	const [archive, ...files] = args.positional;
	if (!archive || files.length === 0) fail('Usage: zipkit zip <archive.zip> <files...> [--method deflate|zstd|store]');
	const method = (args.flags.method as ZipMethod) ?? 'deflate';
	const entries = files.map((f) => {
		const buf = readFileSync(f);
		return { name: basename(f), data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), method };
	});
	const out2 = await zipArchive(entries);
	writeFileSync(archive, out2);
	out(`${c.green('✓')} ${files.length} file(s) → ${archive} ${c.dim(`(${fmtBytes(out2.length)})`)}`);
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

async function cmdBench(args: ReturnType<typeof parseArgs>): Promise<void> {
	const file = args.positional[0];
	if (!file) fail('Usage: zipkit bench <file>');
	const input = readFileSync(file);
	const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	out(`${c.bold('bench')} ${file} ${c.dim(`(${fmtBytes(data.length)})`)}`);
	out(c.dim('codec     ratio    size        comp     decomp'));
	for (const codec of CODECS) {
		try {
			const t0 = performance.now();
			const comp = await compress(data, codec);
			const t1 = performance.now();
			await decompressWith(comp, codec);
			const t2 = performance.now();
			const ratio = data.length ? comp.length / data.length : 0;
			out(
				`${codec.padEnd(9)} ${(ratio * 100).toFixed(1).padStart(5)}%  ${fmtBytes(comp.length).padStart(10)}  ` +
					`${(t1 - t0).toFixed(1).padStart(6)}ms ${(t2 - t1).toFixed(1).padStart(6)}ms`
			);
		} catch (e) {
			out(`${codec.padEnd(9)} ${c.red('failed')} ${c.dim(e instanceof Error ? e.message : String(e))}`);
		}
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
  zip <out.zip> <files...>   Create a ZIP     ${c.dim('--method deflate|zstd|store')}
  unzip <archive.zip>  Extract a ZIP          ${c.dim('-d <dir>')}
  info <file>          Show format / ZIP listing
  bench <file>         Compare every codec on a file
  version              Print the version
  help                 Show this help

${c.bold('CODECS')}
  ${CODECS.join(', ')}

${c.bold('MODES')}
  ${MODES.join(', ')}  ${c.dim('(speed | balanced [default] | ratio — picks a codec-specific level)')}

${c.bold('EXAMPLES')}
  zipkit compress data.json --codec zstd --mode ratio
  zipkit decompress data.json.zst
  zipkit zip site.zip index.html app.js --method zstd
  zipkit unzip site.zip -d ./out
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
