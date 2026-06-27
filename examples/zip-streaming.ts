/**
 * Stream a ZIP archive to disk without buffering the whole thing in memory.
 * Peak memory is one entry, so this scales to multi-GB archives.
 *
 * Run with:  bun run examples/zip-streaming.ts
 */

import { zipStream, unzip } from '../src/zip/index.js';
import { strToU8 } from '../src/index.js';
import type { ZipEntryInput } from '../src/zip/index.js';

// An async source — entries are produced (and read) one at a time.
async function* source(): AsyncGenerator<ZipEntryInput> {
	for (let i = 0; i < 50; i++) {
		yield { name: `logs/app-${i}.log`, data: strToU8(`log file ${i}\n`.repeat(200)) };
	}
}

const stream = zipStream(source(), {
	onProgress: (done) => {
		if (done % 10 === 0) process.stdout.write(`  …${done} entries written\n`);
	}
});

// Pipe straight to a file via a WritableStream backed by Bun's incremental
// FileSink — nothing buffers the whole archive.
const sink = Bun.file('example-streamed.zip').writer();
await stream.pipeTo(
	new WritableStream<Uint8Array>({
		write(chunk) {
			sink.write(chunk);
		},
		close() {
			sink.end();
		}
	})
);

const back = await unzip(new Uint8Array(await Bun.file('example-streamed.zip').arrayBuffer()));
console.log(`\nwrote example-streamed.zip — ${back.length} entries read back`);
