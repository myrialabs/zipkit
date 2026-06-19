/**
 * Lossless temporal video compression: frame-delta prediction followed by a
 * fast general codec. Subtract each frame from the previous one (the residual
 * is mostly zeros) then compress the residual with zstd or lz4. Ideal for
 * screen recordings, raw frame buffers, and video IPC — not a lossy codec.
 */
import { getEngine } from '../engine.js';

/** The fast codec applied to the frame-delta residual. */
export type FrameCodec = 'zstd' | 'lz4';

/**
 * Encode a sequence of equally-sized raw frames losslessly.
 *
 * @param frames - All frames concatenated, each exactly `frameSize` bytes.
 * @param frameSize - Bytes per frame (e.g. `width * height * channels`).
 * @param codec - Residual codec: `'zstd'` (denser) or `'lz4'` (faster).
 */
export async function encodeFrames(
	frames: Uint8Array,
	frameSize: number,
	codec: FrameCodec = 'zstd'
): Promise<Uint8Array> {
	const e = await getEngine();
	const residual = e.frameDeltaEncode(frames, frameSize);
	return codec === 'lz4' ? e.lz4Compress(residual) : e.zstdCompress(residual, 19);
}

/** Decode frames produced by {@link encodeFrames} (same `frameSize`/`codec`). */
export async function decodeFrames(
	data: Uint8Array,
	frameSize: number,
	codec: FrameCodec = 'zstd'
): Promise<Uint8Array> {
	const e = await getEngine();
	const residual = codec === 'lz4' ? e.lz4Decompress(data) : e.zstdDecompress(data);
	return e.frameDeltaDecode(residual, frameSize);
}
