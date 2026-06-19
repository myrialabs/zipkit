import { test, expect } from 'bun:test';
import { compressionStream, decompressionStream } from './index.js';
import type { Codec } from '../types.js';

const data = new TextEncoder().encode('streaming payload chunk '.repeat(500));

function chunked(input: Uint8Array, size: number): ReadableStream<Uint8Array> {
	let off = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (off >= input.length) return controller.close();
			controller.enqueue(input.subarray(off, off + size));
			off += size;
		}
	});
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	const reader = stream.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) chunks.push(value);
	}
	const total = chunks.reduce((n, c) => n + c.length, 0);
	const out = new Uint8Array(total);
	let off = 0;
	for (const c of chunks) {
		out.set(c, off);
		off += c.length;
	}
	return out;
}

const codecs: Codec[] = ['gzip', 'zlib', 'deflate', 'zstd', 'lz4', 'brotli', 'bzip2'];

for (const codec of codecs) {
	test(`${codec}: pipeThrough compress -> decompress roundtrips`, async () => {
		const out = await collect(
			chunked(data, 137).pipeThrough(compressionStream(codec)).pipeThrough(decompressionStream(codec))
		);
		expect(out).toEqual(data);
	});
}

test('gzip stream output is decodable by Bun (native interop)', async () => {
	const compressed = await collect(chunked(data, 200).pipeThrough(compressionStream('gzip')));
	expect(new Uint8Array(Bun.gunzipSync(compressed))).toEqual(data);
});
