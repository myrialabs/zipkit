import { test, expect } from 'bun:test';
import { entriesFromFileHandles, zipToFileHandle, type ReadableFileHandle, type WritableFileHandle } from './fsa.js';
import { unzip } from './zip/index.js';
import { strToU8, strFromU8 } from './string.js';

/** Mock a FileSystemFileHandle around in-memory bytes. */
function readHandle(name: string, data: Uint8Array, lastModified = 0): ReadableFileHandle {
	return {
		getFile: async () => ({
			name,
			lastModified,
			arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
		})
	};
}

/** Mock a writable file handle that collects everything written. */
function writeHandle(): { handle: WritableFileHandle; collected: () => Uint8Array } {
	const parts: Uint8Array[] = [];
	const handle: WritableFileHandle = {
		createWritable: async () =>
			new WritableStream<Uint8Array>({
				write(chunk) {
					parts.push(chunk);
				}
			})
	};
	return {
		handle,
		collected: () => {
			const total = parts.reduce((n, p) => n + p.length, 0);
			const out = new Uint8Array(total);
			let off = 0;
			for (const p of parts) {
				out.set(p, off);
				off += p.length;
			}
			return out;
		}
	};
}

test('entriesFromFileHandles + zipToFileHandle round-trip through unzip', async () => {
	const handles = [readHandle('a.txt', strToU8('alpha')), readHandle('b.txt', strToU8('beta'))];
	const { handle, collected } = writeHandle();
	await zipToFileHandle(handle, entriesFromFileHandles(handles));

	const out = await unzip(collected());
	expect(out.map((e) => e.name)).toEqual(['a.txt', 'b.txt']);
	expect(strFromU8(out[0]!.data)).toBe('alpha');
	expect(strFromU8(out[1]!.data)).toBe('beta');
});

test('honors a custom name mapper and method', async () => {
	const handles = [readHandle('photo.raw', strToU8('x'.repeat(500)))];
	const { handle, collected } = writeHandle();
	await zipToFileHandle(handle, entriesFromFileHandles(handles, { name: (f) => `assets/${f.name}`, method: 'store' }));

	const out = await unzip(collected());
	expect(out[0]!.name).toBe('assets/photo.raw');
	expect(out[0]!.method).toBe(0); // store
});
