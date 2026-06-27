/**
 * Delta (incremental) compression for text/JSON that changes in small steps —
 * log streams, chat histories, config snapshots, agent conversation state. The
 * analogue of `encodeFrames` (frame-delta + zstd) for video, but for text: given
 * a `base` revision, {@link compressDelta} encodes a new revision against it so
 * only what changed costs bytes.
 *
 * Implemented as zstd with the base loaded as a raw content prefix (the same
 * mechanism as zstd `--patch-from`): the encoder can copy long runs straight
 * from the base, so an append or a small edit compresses to a tiny patch. The
 * exact same `base` must be supplied to {@link applyDelta}.
 *
 * @example
 * ```ts
 * import { compressDelta, applyDelta } from 'zipkit';
 * const v1 = strToU8(JSON.stringify(stateV1));
 * const patch = await compressDelta(v1, strToU8(JSON.stringify(stateV2)));
 * const v2 = await applyDelta(v1, patch); // === bytes of stateV2
 * ```
 */

import { getEngine } from './engine.js';
import { levelForMode, runAsync } from './internal.js';
import type { CompressOptions, DecompressOptions } from './types.js';

/**
 * Compress `target` as a delta against `base`. The closer `target` is to
 * `base`, the smaller the result. Decode with {@link applyDelta} and the same
 * `base`.
 */
export async function compressDelta(
	base: Uint8Array,
	target: Uint8Array,
	opts?: CompressOptions
): Promise<Uint8Array> {
	const e = await getEngine();
	const level = levelForMode(opts, 1, 22, { speed: 3, balanced: 19, ratio: 22 });
	return runAsync(() => {
		e.setAux(base);
		return e.zstdCompressDict(target, level);
	}, opts, target.length);
}

/** Reconstruct the target bytes from `base` and a patch from {@link compressDelta}. */
export async function applyDelta(base: Uint8Array, patch: Uint8Array, opts?: DecompressOptions): Promise<Uint8Array> {
	const e = await getEngine();
	return runAsync(() => {
		e.setAux(base);
		return e.zstdDecompressDict(patch);
	}, opts, patch.length);
}
