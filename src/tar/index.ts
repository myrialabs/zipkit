/**
 * Tar container — create and read POSIX `ustar` archives.
 *
 * Pure TypeScript, no engine: tar is a framing format, not a codec. {@link tar}
 * concatenates 512-byte headers and padded payloads; {@link untar} walks them
 * back. Long paths and large (>8 GB) entries transparently use PAX extended
 * headers, and reading understands the GNU long-name (`L`) and PAX (`x`/`g`)
 * records that `tar`/Docker emit — so archives round-trip with the standard
 * Unix `tar` CLI and Docker image layers.
 *
 * Combine with a codec for the usual on-disk forms: {@link tarGz} (`.tar.gz`)
 * and {@link tarZstd} (`.tar.zst`) pipe the framing through gzip/zstd so callers
 * never hand-wire two functions.
 *
 * @example
 * ```ts
 * import { tar, untar, tarGz } from 'zipkit/tar';
 * const archive = tar([
 *   { name: 'hello.txt', data: strToU8('hi') },
 *   { name: 'src/', type: 'directory' }
 * ]);
 * const gz = await tarGz([{ name: 'big.log', data: bytes }]);
 * const files = untar(archive);
 * ```
 */

import { gzip, gunzip } from '../codecs/gzip.js';
import { zstd, unzstd } from '../codecs/zstd.js';
import { strToU8, strFromU8 } from '../string.js';
import { ZipKitError } from '../types.js';
import type { CompressOptions, DecompressOptions } from '../types.js';

/** A 512-byte tar block. */
const BLOCK = 512;

/** Tar typeflag values ZipKit reads/writes. */
const TYPE_FILE = '0';
const TYPE_DIR = '5';
const TYPE_SYMLINK = '2';
const TYPE_GNU_LONGNAME = 'L';
const TYPE_GNU_LONGLINK = 'K';
const TYPE_PAX_NEXT = 'x';
const TYPE_PAX_GLOBAL = 'g';

/** Entry kind, normalized across the on-disk typeflags. */
export type TarEntryType = 'file' | 'directory' | 'symlink';

/** An entry to write into a tar archive. */
export interface TarEntryInput {
	/** Path within the archive, using `/` separators. */
	name: string;
	/** File contents. Omit (or leave empty) for directories and symlinks. */
	data?: Uint8Array;
	/** Entry kind (default `'file'`, or `'directory'` when `name` ends in `/`). */
	type?: TarEntryType;
	/** Unix permission bits, e.g. `0o644`. Defaults by type. */
	mode?: number;
	/** Last-modified time (default: now). */
	mtime?: Date | number;
	/** Owner uid (default `0`). */
	uid?: number;
	/** Owner gid (default `0`). */
	gid?: number;
	/** Owner user name. */
	uname?: string;
	/** Owner group name. */
	gname?: string;
	/** Symlink target (required when `type` is `'symlink'`). */
	linkname?: string;
}

/** A decoded tar entry. */
export interface TarEntry {
	/** Path within the archive. */
	name: string;
	/** File contents (empty for directories/symlinks). */
	data: Uint8Array;
	/** Entry kind. */
	type: TarEntryType;
	/** Unix permission bits. */
	mode: number;
	/** Last-modified time. */
	mtime: Date;
	/** Owner uid. */
	uid: number;
	/** Owner gid. */
	gid: number;
	/** Owner user name, if recorded. */
	uname: string;
	/** Owner group name, if recorded. */
	gname: string;
	/** Symlink target, if this is a symlink. */
	linkname?: string;
	/** Uncompressed size in bytes. */
	size: number;
}

/** Round `n` up to the next multiple of {@link BLOCK}. */
function pad512(n: number): number {
	return (n + BLOCK - 1) & ~(BLOCK - 1);
}

/** Resolve a `Date | number` to seconds since the epoch. */
function toEpochSeconds(mtime: Date | number | undefined): number {
	if (mtime === undefined) return Math.floor(nowMs() / 1000);
	const ms = typeof mtime === 'number' ? mtime : mtime.getTime();
	return Math.floor(ms / 1000);
}

/** Current wall-clock millis, behind a helper so tests can reason about it. */
function nowMs(): number {
	return Date.now();
}

/** Write `value` as a NUL-padded octal field of width `width` (incl. terminator). */
function writeOctal(block: Uint8Array, offset: number, width: number, value: number): void {
	// Field holds `width - 1` octal digits then a NUL (or space) terminator.
	const digits = width - 1;
	let s = Math.max(0, Math.floor(value)).toString(8);
	if (s.length > digits) s = s.slice(-digits); // overflow guarded by PAX upstream
	s = s.padStart(digits, '0');
	for (let i = 0; i < digits; i++) block[offset + i] = s.charCodeAt(i);
	block[offset + digits] = 0;
}

/** Write an ASCII string into a fixed field, truncating and NUL-padding. */
function writeStr(block: Uint8Array, offset: number, width: number, value: string): void {
	const bytes = strToU8(value);
	const n = Math.min(bytes.length, width);
	block.set(bytes.subarray(0, n), offset);
}

/** Read a NUL/space-terminated string from a fixed field. */
function readStr(block: Uint8Array, offset: number, width: number): string {
	let end = offset;
	const limit = offset + width;
	while (end < limit && block[end] !== 0) end++;
	return strFromU8(block.subarray(offset, end));
}

/** Read an octal numeric field; tolerant of leading/trailing spaces and NULs. */
function readOctal(block: Uint8Array, offset: number, width: number): number {
	let s = '';
	for (let i = offset; i < offset + width; i++) {
		const c = block[i]!;
		if (c === 0 || c === 0x20) {
			if (s) break;
			continue;
		}
		s += String.fromCharCode(c);
	}
	return s ? parseInt(s, 8) : 0;
}

/** The 8-bit checksum over a header block, with the checksum field read as spaces. */
function headerChecksum(block: Uint8Array): number {
	let sum = 0;
	for (let i = 0; i < BLOCK; i++) {
		// Checksum field is offset 148, width 8 — treated as ASCII spaces.
		sum += i >= 148 && i < 156 ? 0x20 : block[i]!;
	}
	return sum;
}

/** Default permission bits for an entry type. */
function defaultMode(type: TarEntryType): number {
	return type === 'directory' ? 0o755 : type === 'symlink' ? 0o777 : 0o644;
}

/** Normalize a directory name to a trailing slash; leave others untouched. */
function normalizeName(name: string, type: TarEntryType): string {
	if (type === 'directory' && !name.endsWith('/')) return name + '/';
	return name;
}

/** Resolve the effective type for an input entry. */
function resolveType(input: TarEntryInput): TarEntryType {
	if (input.type) return input.type;
	if (input.name.endsWith('/')) return 'directory';
	return 'file';
}

/** Map a normalized type to its on-disk typeflag character. */
function typeflagFor(type: TarEntryType): string {
	return type === 'directory' ? TYPE_DIR : type === 'symlink' ? TYPE_SYMLINK : TYPE_FILE;
}

/**
 * Build one ustar header block for `entry`. Returns the 512-byte header. Any
 * field that overflows ustar's fixed widths is expected to have been handled by
 * a PAX record the caller emitted first; `name`/`linkname`/`size` here are the
 * (possibly truncated) ustar fallbacks.
 */
function buildHeader(
	name: string,
	linkname: string,
	size: number,
	mode: number,
	uid: number,
	gid: number,
	mtime: number,
	type: string,
	uname: string,
	gname: string
): Uint8Array {
	const block = new Uint8Array(BLOCK);

	// ustar splits long names into prefix[155] + name[100] on a `/` boundary.
	let namePart = name;
	let prefix = '';
	if (strToU8(name).length > 100) {
		const cut = name.lastIndexOf('/', 154);
		if (cut > 0 && strToU8(name.slice(cut + 1)).length <= 100) {
			prefix = name.slice(0, cut);
			namePart = name.slice(cut + 1);
		} else {
			namePart = name.slice(0, 100); // PAX 'path' carries the real value
		}
	}

	writeStr(block, 0, 100, namePart);
	writeOctal(block, 100, 8, mode & 0o7777);
	writeOctal(block, 108, 8, uid);
	writeOctal(block, 116, 8, gid);
	writeOctal(block, 124, 12, size);
	writeOctal(block, 136, 12, mtime);
	block[156] = type.charCodeAt(0);
	writeStr(block, 157, 100, linkname);
	writeStr(block, 257, 6, 'ustar');
	block[263] = 0x30; // version "00"
	block[264] = 0x30;
	writeStr(block, 265, 32, uname);
	writeStr(block, 297, 32, gname);
	writeStr(block, 345, 155, prefix);

	// Checksum: compute over the block with the field blanked, then write it
	// back as six octal digits + NUL + space (the canonical encoding).
	const sum = headerChecksum(block);
	const cs = (sum & 0o777777).toString(8).padStart(6, '0');
	for (let i = 0; i < 6; i++) block[148 + i] = cs.charCodeAt(i);
	block[154] = 0;
	block[155] = 0x20;
	return block;
}

/** Encode a single `key=value` PAX record (`"<len> key=value\n"`). */
function paxRecord(key: string, value: string): Uint8Array {
	const body = ` ${key}=${value}\n`;
	// The length prefix counts its own digits, so solve for the fixed point.
	let len = strToU8(body).length;
	let total = len + String(len).length;
	while (String(total).length !== String(len).length) {
		len = total;
		total = strToU8(body).length + String(len).length;
	}
	return strToU8(`${total}${body}`);
}

/** Build the data block(s) of a PAX extended header from a record map. */
function paxExtended(records: Record<string, string>): Uint8Array {
	const parts: Uint8Array[] = [];
	for (const [k, v] of Object.entries(records)) parts.push(paxRecord(k, v));
	return concat(parts);
}

/** Concatenate byte chunks into one buffer. */
function concat(chunks: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const c of chunks) total += c.length;
	const out = new Uint8Array(total);
	let off = 0;
	for (const c of chunks) {
		out.set(c, off);
		off += c.length;
	}
	return out;
}

/**
 * Create a tar archive from `entries`. Synchronous and engine-free. Emits PAX
 * extended headers for paths over 100 bytes that don't fit the ustar
 * prefix/name split, and for entries larger than 8 GB (ustar's octal size
 * ceiling). The result ends with the two zero blocks `tar` expects.
 */
export function tar(entries: TarEntryInput[]): Uint8Array {
	const blocks: Uint8Array[] = [];

	for (const input of entries) {
		const type = resolveType(input);
		const data = type === 'file' ? input.data ?? new Uint8Array(0) : new Uint8Array(0);
		const name = normalizeName(input.name, type);
		const linkname = input.linkname ?? '';
		const mode = input.mode ?? defaultMode(type);
		const mtime = toEpochSeconds(input.mtime);
		const uid = input.uid ?? 0;
		const gid = input.gid ?? 0;
		const uname = input.uname ?? '';
		const gname = input.gname ?? '';

		// Decide whether ustar's fixed fields can hold name/linkname/size; if not,
		// precede the entry with a PAX extended header carrying the real values.
		const pax: Record<string, string> = {};
		const nameBytes = strToU8(name).length;
		const ustarNameOk =
			nameBytes <= 100 || (name.lastIndexOf('/', 154) > 0 && strToU8(name.slice(name.lastIndexOf('/', 154) + 1)).length <= 100);
		if (!ustarNameOk) pax.path = name;
		if (strToU8(linkname).length > 100) pax.linkpath = linkname;
		if (data.length > 0o77777777777) pax.size = String(data.length); // > 8 GB

		if (Object.keys(pax).length > 0) {
			const ext = paxExtended(pax);
			blocks.push(
				buildHeader('PaxHeaders/' + (name.split('/').pop() || 'entry'), '', ext.length, 0o644, uid, gid, mtime, TYPE_PAX_NEXT, uname, gname)
			);
			blocks.push(ext);
			const padN = pad512(ext.length) - ext.length;
			if (padN) blocks.push(new Uint8Array(padN));
		}

		blocks.push(buildHeader(name, linkname, data.length, mode, uid, gid, mtime, typeflagFor(type), uname, gname));
		if (data.length > 0) {
			blocks.push(data);
			const padN = pad512(data.length) - data.length;
			if (padN) blocks.push(new Uint8Array(padN));
		}
	}

	// Two trailing zero blocks mark end-of-archive.
	blocks.push(new Uint8Array(BLOCK * 2));
	return concat(blocks);
}

/** Parse the `key=value` records of a PAX extended header payload. */
function parsePax(payload: Uint8Array): Record<string, string> {
	const records: Record<string, string> = {};
	let i = 0;
	while (i < payload.length) {
		let j = i;
		while (j < payload.length && payload[j] !== 0x20) j++; // length prefix
		const len = parseInt(strFromU8(payload.subarray(i, j)), 10);
		if (!Number.isFinite(len) || len <= 0) break;
		const record = strFromU8(payload.subarray(i, i + len));
		const eq = record.indexOf('=');
		const space = record.indexOf(' ');
		if (eq > space && space >= 0) {
			records[record.slice(space + 1, eq)] = record.slice(eq + 1).replace(/\n$/, '');
		}
		i += len;
	}
	return records;
}

/** Map an on-disk typeflag to a normalized entry type. */
function typeFromFlag(flag: string, name: string): TarEntryType {
	if (flag === TYPE_DIR || (flag === TYPE_FILE && name.endsWith('/'))) return 'directory';
	if (flag === TYPE_SYMLINK) return 'symlink';
	return 'file';
}

/**
 * Read a tar archive into its entries. Synchronous and engine-free. Understands
 * the ustar prefix/name split, GNU long-name/long-link records, and PAX
 * extended headers (so it reads archives from the Unix `tar` CLI and Docker
 * layers). Throws {@link ZipKitError} on a corrupt header checksum.
 */
export function untar(data: Uint8Array): TarEntry[] {
	const entries: TarEntry[] = [];
	let offset = 0;
	// Overrides accumulated from preceding GNU/PAX meta headers.
	let pendingPax: Record<string, string> = {};
	let pendingName: string | undefined;
	let pendingLink: string | undefined;

	while (offset + BLOCK <= data.length) {
		const header = data.subarray(offset, offset + BLOCK);

		// A zero block signals (the first of two) end-of-archive markers.
		if (isZeroBlock(header)) break;

		const stored = readOctal(header, 148, 8);
		if (stored !== (headerChecksum(header) & 0o777777) && stored !== headerChecksum(header)) {
			throw new ZipKitError(`Corrupt tar header at offset ${offset} (checksum mismatch)`);
		}

		const flag = String.fromCharCode(header[156] || 0x30);
		const size = pendingPax.size ? parseInt(pendingPax.size, 10) : readOctal(header, 124, 12);
		const dataStart = offset + BLOCK;
		const payload = data.subarray(dataStart, dataStart + size);

		if (flag === TYPE_PAX_NEXT) {
			pendingPax = { ...pendingPax, ...parsePax(payload) };
			offset = dataStart + pad512(size);
			continue;
		}
		if (flag === TYPE_PAX_GLOBAL) {
			// Global headers apply to all following entries; merge but keep them.
			pendingPax = { ...pendingPax, ...parsePax(payload) };
			offset = dataStart + pad512(size);
			continue;
		}
		if (flag === TYPE_GNU_LONGNAME) {
			pendingName = strFromU8(payload).replace(/\0+$/, '');
			offset = dataStart + pad512(size);
			continue;
		}
		if (flag === TYPE_GNU_LONGLINK) {
			pendingLink = strFromU8(payload).replace(/\0+$/, '');
			offset = dataStart + pad512(size);
			continue;
		}

		// A real entry: resolve name/linkname from any pending overrides.
		const prefix = readStr(header, 345, 155);
		const baseName = readStr(header, 0, 100);
		let name = pendingPax.path ?? pendingName ?? (prefix ? `${prefix}/${baseName}` : baseName);
		const type = typeFromFlag(flag, name);
		if (type === 'directory' && !name.endsWith('/')) name += '/';

		entries.push({
			name,
			data: type === 'file' ? data.slice(dataStart, dataStart + size) : new Uint8Array(0),
			type,
			mode: readOctal(header, 100, 8) & 0o7777,
			mtime: new Date((pendingPax.mtime ? parseFloat(pendingPax.mtime) : readOctal(header, 136, 12)) * 1000),
			uid: pendingPax.uid ? parseInt(pendingPax.uid, 10) : readOctal(header, 108, 8),
			gid: pendingPax.gid ? parseInt(pendingPax.gid, 10) : readOctal(header, 116, 8),
			uname: pendingPax.uname ?? readStr(header, 265, 32),
			gname: pendingPax.gname ?? readStr(header, 297, 32),
			linkname: type === 'symlink' ? pendingPax.linkpath ?? pendingLink ?? readStr(header, 157, 100) : undefined,
			size: type === 'file' ? size : 0
		});

		// Consume any pending overrides — they apply to one entry only.
		pendingPax = {};
		pendingName = undefined;
		pendingLink = undefined;
		offset = dataStart + (type === 'file' ? pad512(size) : 0);
	}

	return entries;
}

/** True when every byte in the block is zero. */
function isZeroBlock(block: Uint8Array): boolean {
	for (let i = 0; i < block.length; i++) if (block[i] !== 0) return false;
	return true;
}

/** Create a `.tar.gz` archive: {@link tar} then gzip. */
export async function tarGz(entries: TarEntryInput[], opts?: CompressOptions): Promise<Uint8Array> {
	return gzip(tar(entries), opts);
}

/** Read a `.tar.gz` archive: gunzip then {@link untar}. */
export async function untarGz(data: Uint8Array, opts?: DecompressOptions): Promise<TarEntry[]> {
	return untar(await gunzip(data, opts));
}

/** Create a `.tar.zst` archive: {@link tar} then zstd. */
export async function tarZstd(entries: TarEntryInput[], opts?: CompressOptions): Promise<Uint8Array> {
	return zstd(tar(entries), opts);
}

/** Read a `.tar.zst` archive: unzstd then {@link untar}. */
export async function untarZstd(data: Uint8Array, opts?: DecompressOptions): Promise<TarEntry[]> {
	return untar(await unzstd(data, opts));
}
