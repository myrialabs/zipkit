/**
 * Deterministic benchmark corpora.
 *
 * `zipkit bench` with no file compares codecs on these built-in datasets, so
 * ratio/timing comparisons across versions or PRs are apple-to-apple instead of
 * depending on whatever file a user happened to pass. Everything is generated
 * from a fixed seed (no `Math.random`, no bundled fixtures bloating the
 * package), so the same input bytes are reproduced on every machine and run.
 */

/** A named benchmark dataset. */
export interface CorpusEntry {
	/** Short identifier, e.g. `'text'`. */
	name: string;
	/** One-line description of what the dataset models. */
	description: string;
	/** The dataset bytes. */
	data: Uint8Array;
}

/** A tiny deterministic PRNG (mulberry32) — reproducible, no global state. */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const WORDS = (
	'the quick brown fox jumps over a lazy dog while data flows through pipes and ' +
	'buffers compress into smaller frames across every runtime node bun browser ' +
	'engine codec stream archive entry header footer index block size ratio'
).split(' ');

/** Natural-language-like English text — exercises entropy coding and matching. */
function textCorpus(targetBytes: number): Uint8Array {
	const next = rng(0x1234abcd);
	let s = '';
	while (s.length < targetBytes) {
		const len = 6 + Math.floor(next() * 14);
		const line: string[] = [];
		for (let i = 0; i < len; i++) line.push(WORDS[Math.floor(next() * WORDS.length)]!);
		s += line.join(' ') + '.\n';
	}
	return new TextEncoder().encode(s.slice(0, targetBytes));
}

/** Repetitive structured JSON records — the everyday API/log-payload shape. */
function jsonCorpus(targetBytes: number): Uint8Array {
	const next = rng(0x55aa00ff);
	const levels = ['debug', 'info', 'warn', 'error'];
	const svcs = ['api', 'auth', 'cache', 'db', 'queue'];
	const records: string[] = [];
	let size = 0;
	let i = 0;
	while (size < targetBytes) {
		const rec = JSON.stringify({
			ts: 1_700_000_000 + i,
			level: levels[Math.floor(next() * levels.length)],
			svc: svcs[Math.floor(next() * svcs.length)],
			id: Math.floor(next() * 1_000_000),
			ok: next() > 0.1,
			msg: `request ${i} processed in ${Math.floor(next() * 500)}ms`
		});
		records.push(rec);
		size += rec.length + 1;
		i++;
	}
	return new TextEncoder().encode('[' + records.join(',\n') + ']');
}

/** Semi-structured log lines with timestamps and repeated tokens. */
function logCorpus(targetBytes: number): Uint8Array {
	const next = rng(0x0f0f0f0f);
	const paths = ['/api/users', '/api/orders', '/health', '/assets/app.js', '/login'];
	let s = '';
	let i = 0;
	while (s.length < targetBytes) {
		const ms = 1_700_000_000_000 + i * 137;
		s += `${ms} GET ${paths[Math.floor(next() * paths.length)]} ${200 + Math.floor(next() * 5) * 100} ${Math.floor(next() * 9999)}b\n`;
		i++;
	}
	return new TextEncoder().encode(s.slice(0, targetBytes));
}

/** High-entropy bytes with light structure — a near-incompressible baseline. */
function binaryCorpus(targetBytes: number): Uint8Array {
	const next = rng(0xdeadbeef);
	const out = new Uint8Array(targetBytes);
	for (let i = 0; i < targetBytes; i++) {
		// Mostly random, but with occasional runs so it isn't pure noise.
		out[i] = next() < 0.15 ? 0 : Math.floor(next() * 256);
	}
	return out;
}

/** Build the standard corpus at roughly `bytesPerSet` bytes per dataset (default 256 KB). */
export function presetCorpus(bytesPerSet = 256 * 1024): CorpusEntry[] {
	return [
		{ name: 'text', description: 'English-like natural-language text', data: textCorpus(bytesPerSet) },
		{ name: 'json', description: 'repetitive structured JSON records', data: jsonCorpus(bytesPerSet) },
		{ name: 'log', description: 'semi-structured server log lines', data: logCorpus(bytesPerSet) },
		{ name: 'binary', description: 'high-entropy bytes (near-incompressible)', data: binaryCorpus(bytesPerSet) }
	];
}
