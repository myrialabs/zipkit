/**
 * Stream a payload through gzip and back using web-standard TransformStreams.
 * gzip/zlib/deflate are backed by the platform's native CompressionStream.
 *
 * Run with:  bun run examples/streaming.ts
 */

import { compressionStream, decompressionStream } from '../src/streams/index.js';
import { strToU8, strFromU8 } from '../src/index.js';

const source = strToU8('streamed line of text\n'.repeat(2000));

// Emit the source in small chunks to prove it streams.
function chunks(data: Uint8Array, size: number): ReadableStream<Uint8Array> {
	let off = 0;
	return new ReadableStream({
		pull(controller) {
			if (off >= data.length) return controller.close();
			controller.enqueue(data.subarray(off, off + size));
			off += size;
		}
	});
}

const roundTripped = chunks(source, 256)
	.pipeThrough(compressionStream('gzip'))
	.pipeThrough(decompressionStream('gzip'));

const buf = await new Response(roundTripped as unknown as ReadableStream).arrayBuffer();
const output = new Uint8Array(buf);
console.log('input :', source.length, 'bytes');
console.log('output:', output.length, 'bytes');
console.log('match :', strFromU8(output) === strFromU8(source) ? 'OK' : 'MISMATCH');
