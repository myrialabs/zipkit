/**
 * Worker entry point. Runs codec operations off the main thread, one Wasm
 * engine per worker. Speaks the tiny message protocol in {@link WorkerRequest} /
 * {@link WorkerResponse}; transfers buffers both ways for zero-copy handoff.
 */
import { parentPort } from 'node:worker_threads';
import { getEngine } from '../engine.js';
import { compress, decompressWith } from '../compress.js';
import type { Codec, CompressionMode } from '../types.js';

export interface WorkerRequest {
	id: number;
	kind: 'compress' | 'decompress' | 'zipCompress';
	codec: Codec;
	mode?: CompressionMode;
	level?: number;
	/** ZIP entry method (`zipCompress` only) — raw libdeflate / zstd, no native dispatch. */
	method?: 'deflate' | 'zstd';
	data: Uint8Array;
}

export interface WorkerResponse {
	id: number;
	ok: boolean;
	result?: Uint8Array;
	error?: string;
}

if (parentPort) {
	const port = parentPort;
	// Warm the engine immediately so the first job doesn't pay instantiation.
	void getEngine();

	port.on('message', async (req: WorkerRequest) => {
		try {
			let result: Uint8Array;
			if (req.kind === 'zipCompress') {
				// ZIP entries must use the raw libdeflate / zstd engine (denser than
				// native, and byte-identical to the inline path), bypassing the
				// codec's native dispatch.
				const e = await getEngine();
				result =
					req.method === 'zstd'
						? e.zstdCompress(req.data, req.level ?? 19)
						: e.deflateCompress(req.data, req.level ?? 6);
			} else if (req.kind === 'compress') {
				result = await compress(req.data, req.codec, { mode: req.mode, level: req.level });
			} else {
				result = await decompressWith(req.data, req.codec);
			}
			const res: WorkerResponse = { id: req.id, ok: true, result };
			port.postMessage(res, [result.buffer as ArrayBuffer]);
		} catch (err) {
			const res: WorkerResponse = {
				id: req.id,
				ok: false,
				error: err instanceof Error ? err.message : String(err)
			};
			port.postMessage(res);
		}
	});
}
