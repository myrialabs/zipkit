/**
 * 7z container — read and write `.7z` archives.
 *
 * Built on the engine's LZMA: the writer stores each file in its own folder with
 * a copy or LZMA1 coder and a plain header; the reader parses the 7z structure
 * (plain or LZMA-encoded header) and decodes copy / LZMA1 / LZMA2 single-coder
 * folders — covering archives from `7z a` (LZMA2 by default), `-m0=lzma`, and
 * `-m0=copy`. Multi-coder folders (e.g. BCJ filter chains) are reported as
 * unsupported rather than silently mis-decoded.
 *
 * @example
 * ```ts
 * import { sevenZip, unSevenZip } from 'zipkit/sevenzip';
 * const archive = await sevenZip([{ name: 'a.txt', data: strToU8('hi') }]);
 * const files = await unSevenZip(archive);
 * ```
 */

import { getEngine } from '../engine.js';
import { ZipKitError } from '../types.js';

const SIGNATURE = new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);

// Property IDs.
const K = {
	End: 0x00,
	Header: 0x01,
	MainStreamsInfo: 0x04,
	FilesInfo: 0x05,
	PackInfo: 0x06,
	UnpackInfo: 0x07,
	SubStreamsInfo: 0x08,
	Size: 0x09,
	CRC: 0x0a,
	Folder: 0x0b,
	CodersUnpackSize: 0x0c,
	NumUnpackStream: 0x0d,
	EmptyStream: 0x0e,
	EmptyFile: 0x0f,
	Name: 0x11,
	MTime: 0x14,
	WinAttributes: 0x15,
	EncodedHeader: 0x17
} as const;

// Coder IDs.
const COPY_ID = 0x00;
const LZMA1_ID = 0x030101;
const LZMA2_ID = 0x21;

/** An entry to write into a 7z archive. */
export interface SevenZipEntryInput {
	/** Path within the archive (use `/` separators). */
	name: string;
	/** File contents. */
	data: Uint8Array;
	/** Coder: `'lzma'` (default, dense) or `'copy'` (stored). */
	method?: 'lzma' | 'copy';
	/** LZMA level 0–9 (default 6). */
	level?: number;
}

/** A decoded 7z entry. */
export interface SevenZipEntry {
	/** Path within the archive. */
	name: string;
	/** File contents. */
	data: Uint8Array;
	/** Uncompressed size in bytes. */
	size: number;
}

// ---------------------------------------------------------------------------
// 7z variable-length numbers
// ---------------------------------------------------------------------------

/** A growable byte sink with the 7z number encoding. */
class ByteWriter {
	private buf: number[] = [];
	byte(b: number): void {
		this.buf.push(b & 0xff);
	}
	bytes(b: Uint8Array): void {
		for (const x of b) this.buf.push(x);
	}
	u32(v: number): void {
		this.byte(v);
		this.byte(v >>> 8);
		this.byte(v >>> 16);
		this.byte(v >>> 24);
	}
	u64(v: number): void {
		// Little-endian 64-bit (values stay within 2^53 in practice).
		for (let i = 0; i < 8; i++) {
			this.byte(Math.floor(v / 2 ** (8 * i)) & 0xff);
		}
	}
	/** Encode a 7z variable-length number. */
	number(value: number): void {
		let firstByte = 0;
		let mask = 0x80;
		let i = 0;
		for (; i < 8; i++) {
			if (value < 2 ** (7 * (i + 1))) {
				firstByte |= Math.floor(value / 2 ** (8 * i)) & 0xff;
				break;
			}
			firstByte |= mask;
			mask >>= 1;
		}
		this.byte(firstByte);
		for (let j = 0; j < i; j++) {
			this.byte(Math.floor(value / 2 ** (8 * j)) & 0xff);
		}
	}
	take(): Uint8Array {
		return new Uint8Array(this.buf);
	}
}

/** Sequential reader with the 7z number encoding. */
class ByteReader {
	pos = 0;
	constructor(private data: Uint8Array) {}
	byte(): number {
		if (this.pos >= this.data.length) throw new ZipKitError('7z header truncated');
		return this.data[this.pos++]!;
	}
	bytes(n: number): Uint8Array {
		const out = this.data.subarray(this.pos, this.pos + n);
		this.pos += n;
		return out;
	}
	number(): number {
		const firstByte = this.byte();
		let mask = 0x80;
		let value = 0;
		for (let i = 0; i < 8; i++) {
			if ((firstByte & mask) === 0) {
				value += (firstByte & (mask - 1)) * 2 ** (8 * i);
				return value;
			}
			value += this.byte() * 2 ** (8 * i);
			mask >>= 1;
		}
		return value;
	}
	expect(id: number, what: string): void {
		const got = this.byte();
		if (got !== id) throw new ZipKitError(`7z parse error: expected ${what} (0x${id.toString(16)}), got 0x${got.toString(16)}`);
	}
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function crc32LE(w: ByteWriter, crc: number): void {
	w.u32(crc >>> 0);
}

/** UTF-16LE encode a name with a trailing null terminator. */
function nameUtf16(name: string): Uint8Array {
	const out: number[] = [];
	for (const ch of name) {
		let code = ch.codePointAt(0)!;
		if (code > 0xffff) {
			// Surrogate pair.
			code -= 0x10000;
			const hi = 0xd800 + (code >> 10);
			const lo = 0xdc00 + (code & 0x3ff);
			out.push(hi & 0xff, hi >> 8, lo & 0xff, lo >> 8);
		} else {
			out.push(code & 0xff, code >> 8);
		}
	}
	out.push(0, 0);
	return new Uint8Array(out);
}

interface PreparedEntry {
	name: string;
	packed: Uint8Array;
	unpackSize: number;
	unpackCrc: number;
	coderId: number;
	props?: Uint8Array;
}

/**
 * Create a 7z archive from `entries`. Each file is stored in its own folder
 * (non-solid) with an LZMA1 or copy coder and a plain (uncompressed) header.
 */
export async function sevenZip(entries: SevenZipEntryInput[]): Promise<Uint8Array> {
	const e = await getEngine();
	const prepared: PreparedEntry[] = [];

	for (const entry of entries) {
		const method = entry.method ?? 'lzma';
		const raw = entry.data;
		const unpackCrc = e.crc32(raw) >>> 0;
		if (method === 'copy') {
			prepared.push({ name: entry.name, packed: raw, unpackSize: raw.length, unpackCrc, coderId: COPY_ID });
		} else {
			// engine LZMA frame: [5 props][4 LE size][raw LZMA1 stream] — strip to
			// the bare props + stream a 7z folder expects.
			const frame = e.lzmaCompress(raw, entry.level ?? 6);
			const props = frame.subarray(0, 5);
			const stream = frame.subarray(9);
			prepared.push({
				name: entry.name,
				packed: stream.slice(),
				unpackSize: raw.length,
				unpackCrc,
				coderId: LZMA1_ID,
				props: props.slice()
			});
		}
	}

	// Packed streams blob (sits right after the 32-byte signature header).
	let packTotal = 0;
	for (const p of prepared) packTotal += p.packed.length;
	const packedBlob = new Uint8Array(packTotal);
	{
		let off = 0;
		for (const p of prepared) {
			packedBlob.set(p.packed, off);
			off += p.packed.length;
		}
	}

	const header = buildHeader(prepared);
	const nextHeaderCrc = e.crc32(header) >>> 0;

	const start = new ByteWriter();
	start.u64(packedBlob.length); // NextHeaderOffset (relative to offset 32)
	start.u64(header.length); // NextHeaderSize
	start.u32(nextHeaderCrc); // NextHeaderCRC
	const startHeader = start.take();
	const startHeaderCrc = e.crc32(startHeader) >>> 0;

	const out = new ByteWriter();
	out.bytes(SIGNATURE);
	out.byte(0x00); // version major
	out.byte(0x04); // version minor
	out.u32(startHeaderCrc);
	out.bytes(startHeader);
	out.bytes(packedBlob);
	out.bytes(header);
	return out.take();
}

function buildHeader(prepared: PreparedEntry[]): Uint8Array {
	const w = new ByteWriter();
	w.byte(K.Header);

	w.byte(K.MainStreamsInfo);

	// --- PackInfo ---
	w.byte(K.PackInfo);
	w.number(0); // PackPos
	w.number(prepared.length); // NumPackStreams
	w.byte(K.Size);
	for (const p of prepared) w.number(p.packed.length);
	w.byte(K.End);

	// --- UnpackInfo ---
	w.byte(K.UnpackInfo);
	w.byte(K.Folder);
	w.number(prepared.length); // NumFolders (one per file)
	w.byte(0); // External = 0 (folders inline)
	for (const p of prepared) {
		w.number(1); // NumCoders
		if (p.coderId === COPY_ID) {
			w.byte(0x01); // idSize 1, no attrs
			w.byte(0x00); // copy id
		} else {
			// LZMA1 id is 3 bytes (03 01 01), with attributes.
			w.byte(0x23); // idSize 3 | 0x20 (has attributes)
			w.byte(0x03);
			w.byte(0x01);
			w.byte(0x01);
			w.number(p.props!.length);
			w.bytes(p.props!);
		}
	}
	w.byte(K.CodersUnpackSize);
	for (const p of prepared) w.number(p.unpackSize);
	// Per-folder unpack CRCs (all defined).
	w.byte(K.CRC);
	w.byte(1); // AllAreDefined
	for (const p of prepared) crc32LE(w, p.unpackCrc);
	w.byte(K.End);

	w.byte(K.End); // end MainStreamsInfo

	// --- FilesInfo ---
	w.byte(K.FilesInfo);
	w.number(prepared.length);
	// Names property.
	const names = new ByteWriter();
	names.byte(0); // External = 0
	for (const p of prepared) names.bytes(nameUtf16(p.name));
	const nameData = names.take();
	w.byte(K.Name);
	w.number(nameData.length);
	w.bytes(nameData);
	w.byte(K.End); // end FilesInfo

	w.byte(K.End); // end Header
	return w.take();
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

interface Coder {
	id: number;
	numIn: number;
	numOut: number;
	props?: Uint8Array;
}
interface Folder {
	coders: Coder[];
	numPackedStreams: number;
	unpackSizes: number[]; // per output stream
	crc?: number;
}
interface StreamsInfo {
	packPos: number;
	packSizes: number[];
	folders: Folder[];
	numUnpackStreamsPerFolder: number[];
	subSizes: number[][]; // per folder, per substream
	subCrcs: (number | undefined)[]; // flat per substream
}

function readBitVector(r: ByteReader, n: number): boolean[] {
	const bits: boolean[] = [];
	let mask = 0;
	let b = 0;
	for (let i = 0; i < n; i++) {
		if (mask === 0) {
			b = r.byte();
			mask = 0x80;
		}
		bits.push((b & mask) !== 0);
		mask >>= 1;
	}
	return bits;
}

/** Read an "all-defined or bit-vector" flag set. */
function readBoolVectorAllable(r: ByteReader, n: number): boolean[] {
	const allDefined = r.byte();
	if (allDefined !== 0) return new Array(n).fill(true);
	return readBitVector(r, n);
}

/** Read a digest set: which streams have a CRC, then the 32-bit CRCs. */
function readDigests(r: ByteReader, n: number): (number | undefined)[] {
	const defined = readBoolVectorAllable(r, n);
	const out: (number | undefined)[] = [];
	for (let i = 0; i < n; i++) {
		if (defined[i]) {
			out.push((r.byte() | (r.byte() << 8) | (r.byte() << 16) | (r.byte() << 24)) >>> 0);
		} else {
			out.push(undefined);
		}
	}
	return out;
}

function parseFolder(r: ByteReader): Folder {
	const numCoders = r.number();
	const coders: Coder[] = [];
	let totalIn = 0;
	let totalOut = 0;
	for (let i = 0; i < numCoders; i++) {
		const flag = r.byte();
		const idSize = flag & 0x0f;
		const isComplex = (flag & 0x10) !== 0;
		const hasAttr = (flag & 0x20) !== 0;
		let id = 0;
		for (const b of r.bytes(idSize)) id = id * 256 + b;
		let numIn = 1;
		let numOut = 1;
		if (isComplex) {
			numIn = r.number();
			numOut = r.number();
		}
		let props: Uint8Array | undefined;
		if (hasAttr) props = r.bytes(r.number()).slice();
		coders.push({ id, numIn, numOut, props });
		totalIn += numIn;
		totalOut += numOut;
	}
	const numBindPairs = totalOut - 1;
	for (let i = 0; i < numBindPairs; i++) {
		r.number(); // inIndex
		r.number(); // outIndex
	}
	const numPackedStreams = totalIn - numBindPairs;
	if (numPackedStreams > 1) {
		for (let i = 0; i < numPackedStreams; i++) r.number(); // packed stream indices
	}
	return { coders, numPackedStreams, unpackSizes: [] };
}

function parseStreamsInfo(r: ByteReader): StreamsInfo {
	let packPos = 0;
	let packSizes: number[] = [];
	let folders: Folder[] = [];
	let id = r.byte();

	if (id === K.PackInfo) {
		packPos = r.number();
		const numPack = r.number();
		let next = r.byte();
		while (next !== K.End) {
			if (next === K.Size) {
				packSizes = [];
				for (let i = 0; i < numPack; i++) packSizes.push(r.number());
			} else if (next === K.CRC) {
				readDigests(r, numPack);
			} else {
				throw new ZipKitError(`7z: unexpected id 0x${next.toString(16)} in PackInfo`);
			}
			next = r.byte();
		}
		id = r.byte();
	}

	if (id === K.UnpackInfo) {
		r.expect(K.Folder, 'kFolder');
		const numFolders = r.number();
		const external = r.byte();
		if (external !== 0) throw new ZipKitError('7z: external folder definitions are unsupported');
		folders = [];
		for (let i = 0; i < numFolders; i++) folders.push(parseFolder(r));
		r.expect(K.CodersUnpackSize, 'kCodersUnpackSize');
		for (const f of folders) {
			let totalOut = 0;
			for (const c of f.coders) totalOut += c.numOut;
			for (let i = 0; i < totalOut; i++) f.unpackSizes.push(r.number());
		}
		let next = r.byte();
		while (next !== K.End) {
			if (next === K.CRC) {
				const crcs = readDigests(r, numFolders);
				folders.forEach((f, i) => (f.crc = crcs[i]));
			} else {
				throw new ZipKitError(`7z: unexpected id 0x${next.toString(16)} in UnpackInfo`);
			}
			next = r.byte();
		}
		id = r.byte();
	}

	// Defaults: one substream per folder, sized to the folder's final output.
	const numUnpackStreamsPerFolder = folders.map(() => 1);
	const subSizes: number[][] = folders.map((f) => [folderOutSize(f)]);
	let subCrcs: (number | undefined)[] = folders.map((f) => f.crc);

	if (id === K.SubStreamsInfo) {
		let next = r.byte();
		if (next === K.NumUnpackStream) {
			for (let i = 0; i < folders.length; i++) numUnpackStreamsPerFolder[i] = r.number();
			next = r.byte();
		}
		// Sizes (all but the last substream of each folder are explicit).
		for (let f = 0; f < folders.length; f++) {
			const n = numUnpackStreamsPerFolder[f]!;
			if (n === 0) {
				subSizes[f] = [];
				continue;
			}
			const sizes: number[] = [];
			let sum = 0;
			if (next === K.Size) {
				for (let i = 0; i < n - 1; i++) {
					const s = r.number();
					sizes.push(s);
					sum += s;
				}
			}
			sizes.push(folderOutSize(folders[f]!) - sum);
			subSizes[f] = sizes;
		}
		if (next === K.Size) next = r.byte();
		// CRCs for substreams whose folder CRC wasn't already known.
		let totalStreams = 0;
		for (const n of numUnpackStreamsPerFolder) totalStreams += n;
		if (next === K.CRC) {
			const numUnknown = folders.reduce(
				(acc, f, i) => acc + (numUnpackStreamsPerFolder[i] === 1 && f.crc !== undefined ? 0 : numUnpackStreamsPerFolder[i]!),
				0
			);
			const digs = readDigests(r, numUnknown);
			const flat: (number | undefined)[] = [];
			let di = 0;
			folders.forEach((f, i) => {
				if (numUnpackStreamsPerFolder[i] === 1 && f.crc !== undefined) flat.push(f.crc);
				else for (let s = 0; s < numUnpackStreamsPerFolder[i]!; s++) flat.push(digs[di++]);
			});
			subCrcs = flat;
			next = r.byte();
		} else {
			subCrcs = new Array(totalStreams).fill(undefined);
		}
		while (next !== K.End) next = r.byte();
		id = r.byte();
	}

	if (id !== K.End) throw new ZipKitError(`7z: expected end of StreamsInfo, got 0x${id.toString(16)}`);
	return { packPos, packSizes, folders, numUnpackStreamsPerFolder, subSizes, subCrcs };
}

/** The output size a folder produces (its final, non-bound output stream). */
function folderOutSize(f: Folder): number {
	// For the single-coder folders ZipKit reads, the only output is the result.
	return f.unpackSizes[f.unpackSizes.length - 1] ?? 0;
}

interface FilesInfo {
	names: string[];
	emptyStream: boolean[];
	emptyFile: boolean[];
}

function parseFilesInfo(r: ByteReader): FilesInfo {
	const numFiles = r.number();
	let emptyStream = new Array(numFiles).fill(false);
	let emptyFile: boolean[] = [];
	let names: string[] = [];
	for (;;) {
		const propType = r.byte();
		if (propType === K.End) break;
		const size = r.number();
		const end = r.pos + size;
		if (propType === K.EmptyStream) {
			emptyStream = readBitVector(r, numFiles);
		} else if (propType === K.EmptyFile) {
			const numEmpty = emptyStream.filter(Boolean).length;
			emptyFile = readBitVector(r, numEmpty);
		} else if (propType === K.Name) {
			const external = r.byte();
			if (external !== 0) throw new ZipKitError('7z: external file names are unsupported');
			names = decodeNames(r.bytes(end - r.pos));
		}
		r.pos = end; // skip any unconsumed property bytes (mtime, attrs, …)
	}
	return { names, emptyStream, emptyFile };
}

/** Decode a run of null-terminated UTF-16LE names. */
function decodeNames(data: Uint8Array): string[] {
	const names: string[] = [];
	const units: number[] = [];
	for (let i = 0; i + 1 < data.length; i += 2) {
		const u = data[i]! | (data[i + 1]! << 8);
		if (u === 0) {
			names.push(String.fromCharCode(...units));
			units.length = 0;
		} else {
			units.push(u);
		}
	}
	return names;
}

function readU64LE(d: Uint8Array, off: number): number {
	let v = 0;
	for (let i = 0; i < 8; i++) v += d[off + i]! * 2 ** (8 * i);
	return v;
}

/** Decode one single-coder folder's packed bytes to its unpacked output. */
async function decodeFolder(folder: Folder, packed: Uint8Array): Promise<Uint8Array> {
	if (folder.coders.length !== 1) {
		throw new ZipKitError('7z: multi-coder folders (e.g. BCJ filter chains) are not supported');
	}
	const coder = folder.coders[0]!;
	const outSize = folderOutSize(folder);
	const e = await getEngine();

	if (coder.id === COPY_ID) return packed.slice();
	if (coder.id === LZMA1_ID) {
		const props = coder.props ?? new Uint8Array(5);
		// Rebuild the engine frame: [5 props][4 LE unpackSize][stream].
		const frame = new Uint8Array(9 + packed.length);
		frame.set(props.subarray(0, 5), 0);
		frame[5] = outSize & 0xff;
		frame[6] = (outSize >>> 8) & 0xff;
		frame[7] = (outSize >>> 16) & 0xff;
		frame[8] = (outSize >>> 24) & 0xff;
		frame.set(packed, 9);
		return e.lzmaDecompress(frame);
	}
	if (coder.id === LZMA2_ID) {
		const prop = coder.props?.[0] ?? 0;
		return e.lzma2Decompress(packed, prop, outSize);
	}
	throw new ZipKitError(`7z: unsupported coder id 0x${coder.id.toString(16)} (only copy, LZMA, LZMA2)`);
}

/** Read a 7z archive into its entries. */
export async function unSevenZip(data: Uint8Array): Promise<SevenZipEntry[]> {
	for (let i = 0; i < SIGNATURE.length; i++) {
		if (data[i] !== SIGNATURE[i]) throw new ZipKitError('Not a 7z archive (bad signature)');
	}
	const nextHeaderOffset = readU64LE(data, 12);
	const nextHeaderSize = readU64LE(data, 20);
	const base = 32;
	let headerBytes = data.subarray(base + nextHeaderOffset, base + nextHeaderOffset + nextHeaderSize);
	if (headerBytes.length === 0) return []; // empty archive

	let r = new ByteReader(headerBytes);
	let id = r.byte();

	// An encoded header is itself a packed stream described by a StreamsInfo;
	// decode it, then parse the result as a normal header.
	if (id === K.EncodedHeader) {
		const si = parseStreamsInfo(r);
		const decoded = await decodeStreams(data, base, si);
		if (decoded.length !== 1) throw new ZipKitError('7z: unexpected encoded-header layout');
		headerBytes = decoded[0]!;
		r = new ByteReader(headerBytes);
		id = r.byte();
	}

	if (id !== K.Header) throw new ZipKitError(`7z: expected header, got 0x${id.toString(16)}`);

	let streams: StreamsInfo | undefined;
	let files: FilesInfo | undefined;
	let next = r.byte();
	if (next === 0x02) {
		// ArchiveProperties — skip to its end marker.
		while (r.byte() !== K.End) {
			/* property size + data already consumed by structure below */
		}
		next = r.byte();
	}
	if (next === K.MainStreamsInfo) {
		streams = parseStreamsInfo(r);
		next = r.byte();
	}
	if (next === K.FilesInfo) {
		files = parseFilesInfo(r);
		next = r.byte();
	}

	// Decode every folder, then split into substreams in folder order.
	const folderOutputs = streams ? await decodeStreams(data, base, streams) : [];
	const substreams: Uint8Array[] = [];
	if (streams) {
		for (let f = 0; f < streams.folders.length; f++) {
			const sizes = streams.subSizes[f]!;
			let off = 0;
			for (const s of sizes) {
				substreams.push(folderOutputs[f]!.subarray(off, off + s));
				off += s;
			}
		}
	}

	// Map substreams to files (empty-stream files have no data).
	const entries: SevenZipEntry[] = [];
	const names = files?.names ?? [];
	const emptyStream = files?.emptyStream ?? [];
	let streamIdx = 0;
	const numFiles = names.length || substreams.length;
	for (let i = 0; i < numFiles; i++) {
		const name = names[i] ?? `file${i}`;
		if (emptyStream[i]) {
			entries.push({ name, data: new Uint8Array(0), size: 0 });
		} else {
			const d = substreams[streamIdx++] ?? new Uint8Array(0);
			entries.push({ name, data: d.slice(), size: d.length });
		}
	}
	return entries;
}

/** Decode each folder in `si`, returning one buffer per folder. */
async function decodeStreams(data: Uint8Array, base: number, si: StreamsInfo): Promise<Uint8Array[]> {
	const packBase = base + si.packPos;
	// Pack-stream offsets are cumulative; each single-packed folder takes one.
	const packOffsets: number[] = [];
	let acc = packBase;
	for (const s of si.packSizes) {
		packOffsets.push(acc);
		acc += s;
	}

	const outputs: Uint8Array[] = [];
	let packIdx = 0;
	for (const folder of si.folders) {
		if (folder.numPackedStreams !== 1) {
			throw new ZipKitError('7z: folders with multiple packed streams are not supported');
		}
		const off = packOffsets[packIdx]!;
		const size = si.packSizes[packIdx]!;
		packIdx++;
		outputs.push(await decodeFolder(folder, data.subarray(off, off + size)));
	}
	return outputs;
}
