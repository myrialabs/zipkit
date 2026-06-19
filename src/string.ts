/**
 * String ↔ bytes helpers.
 *
 * Codecs in ZipKit are byte-only by design. These helpers convert between
 * JavaScript strings and {@link Uint8Array} so text can flow through the same
 * API. UTF-8 is the default; Latin-1 (binary) is available for byte-exact
 * single-byte data.
 */

const utf8Encoder = /* @__PURE__ */ new TextEncoder();
const utf8Decoder = /* @__PURE__ */ new TextDecoder('utf-8');

/**
 * Encode a string to bytes.
 *
 * @param str - The string to encode.
 * @param latin1 - When `true`, encode as Latin-1 (one byte per code unit,
 *   code points 0–255). Defaults to UTF-8.
 */
export function strToU8(str: string, latin1 = false): Uint8Array {
	if (latin1) {
		const out = new Uint8Array(str.length);
		for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
		return out;
	}
	return utf8Encoder.encode(str);
}

/**
 * Decode bytes to a string.
 *
 * @param data - The bytes to decode.
 * @param latin1 - When `true`, decode as Latin-1. Defaults to UTF-8.
 */
export function strFromU8(data: Uint8Array, latin1 = false): string {
	if (latin1) {
		let str = '';
		// Chunk to stay well under argument-count limits for large inputs.
		for (let i = 0; i < data.length; i += 0x8000) {
			str += String.fromCharCode(...data.subarray(i, i + 0x8000));
		}
		return str;
	}
	return utf8Decoder.decode(data);
}

/** A streaming UTF-8 decoder: feed chunks, get text out, flush at the end. */
export class DecodeUTF8 {
	private decoder = new TextDecoder('utf-8');
	/** Decode a chunk. Pass `stream: false` (or use {@link end}) on the last one. */
	push(chunk: Uint8Array, stream = true): string {
		return this.decoder.decode(chunk, { stream });
	}
	/** Flush any buffered partial code point and finish decoding. */
	end(chunk?: Uint8Array): string {
		return this.decoder.decode(chunk ?? new Uint8Array(0));
	}
}

/** A streaming UTF-8 encoder: feed text chunks, get bytes out. */
export class EncodeUTF8 {
	private encoder = new TextEncoder();
	/** Encode a chunk of text to UTF-8 bytes. */
	push(chunk: string): Uint8Array {
		return this.encoder.encode(chunk);
	}
}
