/**
 * A persistent, warm worker pool for non-blocking compression on Node and Bun.
 *
 * Spinning up a worker per call (and re-instantiating the 1.4 MB Wasm engine
 * each time) is the cold-start tax fflate's async API pays. ZipKit keeps a
 * fixed pool of workers, each with the engine already loaded, and round-robins
 * jobs across them. Where workers aren't available (e.g. the browser without
 * bundler support), it transparently falls back to running on the calling
 * thread, so the API never breaks.
 *
 * @example
 * ```ts
 * import { WorkerPool } from '@myrialabs/zipkit/workers';
 * const pool = new WorkerPool();
 * const out = await pool.compress(bytes, 'zstd', { level: 19 });
 * await pool.destroy();
 * ```
 */

import type { Worker } from 'node:worker_threads';
import type { Codec, CompressionMode, CompressOptions, DecompressOptions } from '../types.js';
import { AbortError } from '../types.js';
import type { WorkerRequest, WorkerResponse } from './worker.js';

/** Worker file lives next to this module; `.ts` in source, `.js` once built. */
const WORKER_URL = new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url);

interface Pending {
	resolve: (v: Uint8Array) => void;
	reject: (e: Error) => void;
	signal?: AbortSignal;
	onAbort?: () => void;
}

/** Default pool size: one worker per CPU, capped to keep memory sane. */
function defaultSize(): number {
	const cores =
		(globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency ?? 4;
	return Math.max(1, Math.min(cores, 8));
}

async function loadWorkerThreads(): Promise<typeof import('node:worker_threads') | undefined> {
	try {
		return await import('node:worker_threads');
	} catch {
		return undefined;
	}
}

export interface WorkerPoolOptions {
	/** Number of workers to spawn. Defaults to one per CPU core (max 8). */
	size?: number;
}

export class WorkerPool {
	private readonly size: number;
	private workers: Worker[] = [];
	private pending = new Map<number, Pending>();
	private next = 0;
	private seq = 0;
	private ready: Promise<void> | undefined;
	private usable = true;

	/**
	 * Workers are `unref`'d at rest so an idle pool never blocks process exit.
	 * While any job is in flight we `ref` them, so a script whose last action is
	 * `await pool.compress(...)` doesn't exit before the result arrives.
	 */
	private refWhileBusy(): void {
		const busy = this.pending.size > 0;
		for (const w of this.workers) (busy ? w.ref : w.unref).call(w);
	}

	constructor(opts: WorkerPoolOptions = {}) {
		this.size = opts.size ?? defaultSize();
	}

	private async ensure(): Promise<void> {
		if (this.ready) return this.ready;
		this.ready = (async () => {
			const wt = await loadWorkerThreads();
			if (!wt) {
				// No worker_threads (e.g. a browser): fall back to inline execution.
				this.usable = false;
				return;
			}
			for (let i = 0; i < this.size; i++) {
				const worker = new wt.Worker(WORKER_URL);
				worker.on('message', (res: WorkerResponse) => this.settle(res));
				worker.on('error', (err) => this.failAll(err));
				worker.unref();
				this.workers.push(worker);
			}
		})();
		return this.ready;
	}

	private settle(res: WorkerResponse): void {
		const p = this.pending.get(res.id);
		if (!p) return;
		this.pending.delete(res.id);
		this.refWhileBusy();
		if (p.signal && p.onAbort) p.signal.removeEventListener('abort', p.onAbort);
		if (res.ok && res.result) p.resolve(res.result);
		else p.reject(new Error(res.error ?? 'Worker operation failed'));
	}

	private failAll(err: Error): void {
		for (const [, p] of this.pending) p.reject(err);
		this.pending.clear();
		this.refWhileBusy();
	}

	private async run(
		kind: 'compress' | 'decompress' | 'zipCompress',
		data: Uint8Array,
		codec: Codec,
		level?: number,
		mode?: CompressionMode,
		signal?: AbortSignal,
		method?: 'deflate' | 'zstd'
	): Promise<Uint8Array> {
		if (signal?.aborted) throw new AbortError();
		await this.ensure();

		// Fallback: run on this thread when no worker pool is available.
		if (!this.usable) {
			if (kind === 'zipCompress') {
				const { getEngine } = await import('../engine.js');
				const e = await getEngine();
				return method === 'zstd' ? e.zstdCompress(data, level ?? 19) : e.deflateCompress(data, level ?? 6);
			}
			const { compress, decompressWith } = await import('../compress.js');
			return kind === 'compress' ? compress(data, codec, { level, mode }) : decompressWith(data, codec);
		}

		const id = this.seq++;
		const worker = this.workers[this.next++ % this.workers.length]!;
		return new Promise<Uint8Array>((resolve, reject) => {
			const pending: Pending = { resolve, reject, signal };
			if (signal) {
				pending.onAbort = () => {
					this.pending.delete(id);
					this.refWhileBusy();
					reject(new AbortError());
				};
				signal.addEventListener('abort', pending.onAbort, { once: true });
			}
			this.pending.set(id, pending);
			this.refWhileBusy();
			// Copy the input so transferring its buffer can't detach the caller's view.
			const payload = data.slice();
			const req: WorkerRequest = { id, kind, codec, level, mode, method, data: payload };
			worker.postMessage(req, [payload.buffer as ArrayBuffer]);
		});
	}

	/** Compress `data` with `codec` on a worker (or inline as a fallback). */
	compress(data: Uint8Array, codec: Codec, opts?: CompressOptions): Promise<Uint8Array> {
		return this.run('compress', data, codec, opts?.level, opts?.mode, opts?.signal);
	}

	/** Decompress `data` with `codec` on a worker (or inline as a fallback). */
	decompress(data: Uint8Array, codec: Codec, opts?: DecompressOptions): Promise<Uint8Array> {
		return this.run('decompress', data, codec, undefined, undefined, opts?.signal);
	}

	/**
	 * Compress a ZIP entry on a worker using the raw libdeflate / zstd engine —
	 * denser than the native path and byte-identical to the inline container
	 * code, so a parallel archive matches a single-threaded one exactly.
	 */
	zipCompress(data: Uint8Array, method: 'deflate' | 'zstd', level?: number): Promise<Uint8Array> {
		return this.run('zipCompress', data, method, level, undefined, undefined, method);
	}

	/** Terminate all workers and reject any in-flight jobs. */
	async destroy(): Promise<void> {
		this.failAll(new Error('Worker pool destroyed'));
		await Promise.all(this.workers.map((w) => w.terminate()));
		this.workers = [];
		this.ready = undefined;
	}
}

let shared: WorkerPool | undefined;

/** A lazily-created, process-wide {@link WorkerPool}. */
export function sharedPool(): WorkerPool {
	return (shared ??= new WorkerPool());
}
