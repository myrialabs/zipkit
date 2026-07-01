/**
 * File System Access API helpers (browser).
 *
 * Bridges the browser's `FileSystemFileHandle` to ZipKit's streaming writer so
 * you can zip large local files straight to disk without first reading them all
 * into memory: {@link zipToFileHandle} pipes {@link zipStream} into the handle's
 * writable, and {@link entriesFromFileHandles} turns picked files into the entry
 * stream it consumes.
 *
 * The handle shapes are typed structurally (not via the DOM lib), so this module
 * imports cleanly in Node/Bun too — it just needs real handles at call time.
 *
 * @example
 * ```ts
 * import { zipToFileHandle, entriesFromFileHandles } from '@myrialabs/zipkit';
 * const out = await window.showSaveFilePicker({ suggestedName: 'archive.zip' });
 * const picked = await window.showOpenFilePicker({ multiple: true });
 * await zipToFileHandle(out, entriesFromFileHandles(picked, h => h));
 * ```
 */

import { zipStream, type ZipStreamOptions } from './zip/index.js';
import type { ZipEntryInput, ZipMethod } from './zip/index.js';

/** The slice of `File` ZipKit reads. */
export interface FileLike {
	name: string;
	lastModified: number;
	arrayBuffer(): Promise<ArrayBuffer>;
}

/** The slice of `FileSystemFileHandle` ZipKit reads from. */
export interface ReadableFileHandle {
	getFile(): Promise<FileLike>;
}

/** The slice of `FileSystemFileHandle` ZipKit writes to. */
export interface WritableFileHandle {
	createWritable(): Promise<WritableStream<Uint8Array>>;
}

/** How to name and compress an entry derived from a file handle. */
export interface FileHandleEntryOptions {
	/** Archive path for the file (default: the file's own `name`). */
	name?: (file: FileLike) => string;
	/** Compression method (default `'deflate'`). */
	method?: ZipMethod;
}

/**
 * Turn picked file handles into the entry stream {@link zipStream} consumes,
 * reading each file only when its turn comes (peak memory = one file at a time).
 */
export async function* entriesFromFileHandles(
	handles: Iterable<ReadableFileHandle>,
	opts: FileHandleEntryOptions = {}
): AsyncGenerator<ZipEntryInput> {
	for (const handle of handles) {
		const file = await handle.getFile();
		yield {
			name: opts.name ? opts.name(file) : file.name,
			data: new Uint8Array(await file.arrayBuffer()),
			method: opts.method,
			mtime: file.lastModified
		};
	}
}

/**
 * Stream a ZIP archive built from `entries` straight into a `FileSystemFileHandle`
 * obtained via `showSaveFilePicker`. The archive is never fully buffered.
 */
export async function zipToFileHandle(
	handle: WritableFileHandle,
	entries: Iterable<ZipEntryInput> | AsyncIterable<ZipEntryInput>,
	opts?: ZipStreamOptions
): Promise<void> {
	const writable = await handle.createWritable();
	await zipStream(entries, opts).pipeTo(writable);
}
