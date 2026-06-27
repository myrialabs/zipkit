/**
 * Zstd dictionary compression — the big win for many small, *similar* payloads
 * (log lines, JSON records, RPC messages, chat-history entries). Train a
 * dictionary once from representative samples, then compress each small payload
 * against it: the shared structure lives in the dictionary instead of being
 * repeated in every frame, so tiny inputs shrink dramatically.
 *
 * Backed by the engine's `ZDICT_trainFromBuffer` + `ZSTD_*_usingDict`. The
 * resulting frames are standard zstd-with-dictionary — interoperable with any
 * zstd that is given the same dictionary.
 *
 * @example
 * ```ts
 * import { trainDictionary, compressWithDictionary, decompressWithDictionary } from 'zipkit';
 * const dict = await trainDictionary(logLines);          // Uint8Array[]
 * const packed = await compressWithDictionary(oneLine, dict);
 * const back = await decompressWithDictionary(packed, dict);
 * ```
 */

import { getEngine } from './engine.js';
import { levelForMode, runAsync } from './internal.js';
import { ZipKitError } from './types.js';
import type { CompressOptions, DecompressOptions } from './types.js';

/** Options for {@link trainDictionary}. */
export interface TrainOptions {
	/** Target dictionary size in bytes (default 112 640 — zstd's own default). */
	maxSize?: number;
}

/**
 * Train a zstd dictionary from representative `samples`. More, smaller samples
 * that share structure train a better dictionary; zstd recommends at least ~100
 * samples. Throws {@link ZipKitError} if training fails (typically too few or
 * too-uniform samples).
 */
export async function trainDictionary(samples: Uint8Array[], opts?: TrainOptions): Promise<Uint8Array> {
	if (samples.length === 0) throw new ZipKitError('trainDictionary needs at least one sample');
	const e = await getEngine();
	const maxSize = opts?.maxSize ?? 112_640;

	// Concatenate the samples and build the parallel u32-LE size table.
	let total = 0;
	for (const s of samples) total += s.length;
	const concat = new Uint8Array(total);
	const sizes = new Uint8Array(samples.length * 4);
	const sizeView = new DataView(sizes.buffer);
	let off = 0;
	for (let i = 0; i < samples.length; i++) {
		concat.set(samples[i]!, off);
		sizeView.setUint32(i * 4, samples[i]!.length, true);
		off += samples[i]!.length;
	}

	e.setAux(sizes); // staged size table for the trainer
	const dict = e.zstdTrainDict(concat, samples.length, maxSize);
	if (dict.length === 0) {
		throw new ZipKitError('Dictionary training failed — provide more, more varied samples');
	}
	return dict;
}

/** Compress `data` against `dict`. Level follows the usual zstd 1–22 scale. */
export async function compressWithDictionary(
	data: Uint8Array,
	dict: Uint8Array,
	opts?: CompressOptions
): Promise<Uint8Array> {
	const e = await getEngine();
	const level = levelForMode(opts, 1, 22, { speed: 3, balanced: 19, ratio: 22 });
	return runAsync(() => {
		e.setAux(dict);
		return e.zstdCompressDict(data, level);
	}, opts, data.length);
}

/** Decompress `data` produced by {@link compressWithDictionary} with the same `dict`. */
export async function decompressWithDictionary(
	data: Uint8Array,
	dict: Uint8Array,
	opts?: DecompressOptions
): Promise<Uint8Array> {
	const e = await getEngine();
	return runAsync(() => {
		e.setAux(dict);
		return e.zstdDecompressDict(data);
	}, opts, data.length);
}
