/**
 * QOI — the Quite OK Image format. Lossless, single-pass, and tiny to decode.
 * Operates on raw interleaved pixel bytes (RGB = 3 channels, RGBA = 4).
 */
import { getEngine } from '../engine.js';

/** Encode raw RGB/RGBA pixels to QOI bytes. */
export async function encodeImage(
	pixels: Uint8Array,
	width: number,
	height: number,
	channels: 3 | 4
): Promise<Uint8Array> {
	const e = await getEngine();
	return e.qoiEncode(pixels, width, height, channels);
}

/** Decode QOI bytes back to raw interleaved pixels. */
export async function decodeImage(data: Uint8Array): Promise<Uint8Array> {
	const e = await getEngine();
	return e.qoiDecode(data);
}
