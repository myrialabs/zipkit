/**
 * Internal helpers shared across codec façades. Not part of the public API.
 */

import { AbortError, type CompressionMode, type CompressOptions, type DecompressOptions } from './types.js';

/** Clamp a level into `[min, max]`, falling back to `def` when undefined. */
export function clampLevel(level: number | undefined, min: number, max: number, def: number): number {
	if (level === undefined) return def;
	if (!Number.isFinite(level)) return def;
	return Math.max(min, Math.min(max, Math.round(level)));
}

/** Resolve the public policy option to its default. */
export function compressionMode(opts?: CompressOptions): CompressionMode {
	return opts?.mode ?? 'balanced';
}

/** Pick a level from mode defaults unless the caller supplied one explicitly. */
export function levelForMode(
	opts: CompressOptions | undefined,
	min: number,
	max: number,
	defaults: Record<CompressionMode, number>
): number {
	return clampLevel(opts?.level, min, max, defaults[compressionMode(opts)]);
}

export function bunRuntime(): any | undefined {
	return (globalThis as { Bun?: any }).Bun;
}

/**
 * Cheap content signal for Bun's native zlib path. Native zlib is very fast on
 * small textual/repetitive inputs, while libdeflate usually wins on high-entropy
 * binary and on ratio.
 */
export function likelyTextOrRepetitive(data: Uint8Array): boolean {
	const len = Math.min(data.length, 4096);
	if (len === 0) return true;
	const seen = new Uint8Array(256);
	let distinct = 0;
	let printable = 0;
	for (let i = 0; i < len; i++) {
		const b = data[i]!;
		if (seen[b] === 0) {
			seen[b] = 1;
			distinct++;
		}
		if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126)) printable++;
	}
	return distinct <= 128 || printable / len >= 0.9;
}

/** Throw {@link AbortError} if the signal is already aborted. */
export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new AbortError();
}

/**
 * Run a synchronous codec on the engine inside a Promise, honoring an
 * `AbortSignal` at entry and reporting trivial start/finish progress. The
 * engine itself is one-shot and cannot yield mid-call; for genuinely
 * off-thread work use `zipkit/workers`.
 */
export async function runAsync(
	work: () => Uint8Array,
	opts: CompressOptions | DecompressOptions | undefined,
	inputLen: number
): Promise<Uint8Array> {
	throwIfAborted(opts?.signal);
	opts?.onProgress?.(0, 0);
	const out = work();
	opts?.onProgress?.(1, inputLen);
	return out;
}
