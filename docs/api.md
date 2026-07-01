# API reference

**Single entry point.** Everything — codecs, the `ZipKit` class, the raw engine,
streams, the worker pool, ZIP/tar/7z, `extractStream`, dictionary/delta, and the
HTTP middleware — is exported from `@myrialabs/zipkit`. There are no subpath
imports; tree-shaking keeps only what you use.

All codecs operate on `Uint8Array`. Named codec functions are **async** and lazily
instantiate the shared Wasm engine on first use; the `ZipKit` class is
**synchronous** once loaded.

---

## Named codec functions

Each codec exposes a compress/decompress pair. Signatures:

```ts
function <compress>(data: Uint8Array, opts?: CompressOptions): Promise<Uint8Array>;
function <decompress>(data: Uint8Array, opts?: DecompressOptions): Promise<Uint8Array>;
```

| Compress | Decompress | Level range (balanced / ratio) | Standard-format | Auto-detect |
| --- | --- | --- | --- | --- |
| `gzip` | `gunzip` | 0–9 (6 / 9) | Yes | Yes |
| `deflate` | `inflate` | 0–9 (6 / 9) | Yes (raw DEFLATE) | No¹ |
| `zlib` | `unzlib` | 0–9 (6 / 9) | Yes | Yes |
| `zstd` | `unzstd` | 1–22 (3 / 19) | Yes | Yes |
| `lz4` | `unlz4` | — | raw block (no header) | No |
| `snappy` | `unsnappy` | — | Yes (snappy raw) | No |
| `brotli` | `unbrotli` | 0–11 (6 / 11) | Yes | No |
| `lzma` | `unlzma` | 0–9 (6 / 9) | ZipKit-framed | No |
| `bzip2` | `unbzip2` | 1–9 (6 / 9) | ZipKit-framed | No |

Levels outside a codec's range are **clamped**, never rejected.

**Auto-detect** marks the codecs `decompress()` can recognize from a header
signature; the rest are headerless or ZipKit-framed, so decode them with
`decompressWith(data, codec)`. ¹ Raw DEFLATE has no header, so it can't be
sniffed — decode it with `decompressWith(data, 'deflate')`.

```ts
import { zstd, unzstd } from '@myrialabs/zipkit';
const c = await zstd(bytes, { mode: 'ratio' });
const back = await unzstd(c);
```

### `CompressOptions` / `DecompressOptions`

```ts
interface CompressOptions {
  mode?: 'speed' | 'balanced' | 'ratio'; // default: 'balanced'
  level?: number;             // codec-specific, clamped to range
  signal?: AbortSignal;       // honored by async/worker APIs (checked at entry)
  onProgress?: (percent: number, bytes: number) => void;
}
interface DecompressOptions {
  signal?: AbortSignal;
  onProgress?: (percent: number, bytes: number) => void;
}
```

`mode` is the main public knob:

| Mode | Behavior |
| --- | --- |
| `speed` | Lower default levels and native runtime paths where they are faster |
| `balanced` | Default; standard output with adaptive dispatch and practical levels |
| `ratio` | Higher default levels and denser paths, including libdeflate for gzip/deflate/zlib |

The named codecs are one-shot (the engine can't yield mid-call), so `signal` is
checked once at entry and `onProgress` fires `0` at the start and `1` on
completion — not incrementally. For genuinely off-thread work with mid-stream
cancellation, use [`@myrialabs/zipkit`](#worker-pool--myrialabszipkitworkers) or
[`@myrialabs/zipkit`](#parallel--myrialabszipkitparallel).

---

## Generic dispatch & auto-detect

```ts
compress(data: Uint8Array, codec: Codec, opts?: CompressOptions): Promise<Uint8Array>
decompressWith(data: Uint8Array, codec: Codec, opts?: DecompressOptions): Promise<Uint8Array>
decompress(data: Uint8Array, opts?: DecompressOptions): Promise<Uint8Array>   // auto-detect
```

`decompress()` sniffs the header (see `detectFormat`) and routes automatically.
Detectable formats: **gzip, zlib, zstd** (plus ZIP archives, which `decompress()`
rejects with a pointer to `unzip`). For headerless or ZipKit-framed codecs
(brotli, snappy, lz4 block, lzma, bzip2) use `decompressWith` with an explicit codec.

```ts
detectFormat(data: Uint8Array): 'gzip' | 'zlib' | 'zstd' | 'zip' | undefined
```

`Codec = 'gzip' | 'deflate' | 'zlib' | 'zstd' | 'lz4' | 'snappy' | 'brotli' | 'lzma' | 'bzip2'`

### `pack` / `unpack` — just the smallest

```ts
pack(data: Uint8Array): Promise<Uint8Array>     // tries brotli/lzma/bzip2/zstd-ultra, keeps the smallest
unpack(data: Uint8Array): Promise<Uint8Array>   // reverses pack(); codec read from a 1-byte tag
```

When you don't care which codec wins and only want the smallest output. The
output is a ZipKit-specific tagged frame (decode it with `unpack`, not a standard
tool). For the synchronous form, use `ZipKit.pack` / `ZipKit.unpack`.

---

## `ZipKit` class (synchronous)

```ts
import { ZipKit, init } from '@myrialabs/zipkit';

const zk = await ZipKit.load();   // or: const zk = await init();  (shared singleton)
zk.runtime;                       // 'bun' | 'wasm' — which path zstd uses
```

Methods accept either the new options object or the old numeric level shorthand:
`zk.gzip(bytes, { mode: 'ratio' })` and `zk.gzip(bytes, 9)` are both valid.
gzip/deflate dispatch to native Bun zlib in `speed`/`balanced` mode so throughput
matches native, while `mode: 'ratio'` forces libdeflate for denser output. zstd
dispatches to native libzstd on Bun (the speed ceiling) and the Wasm engine
elsewhere; `zk.runtime` reports which.
All methods are synchronous.

| Method | Notes |
| --- | --- |
| `gzip(d, opts?)` / `gunzip(d)` | adaptive; `ratio` uses libdeflate |
| `deflate(d, opts?)` / `inflate(d)` | adaptive raw DEFLATE; `ratio` uses libdeflate |
| `zlib(d, opts?)` / `unzlib(d)` | libdeflate zlib wrapper |
| `zstd(d, opts?)` / `unzstd(d)` | native on Bun, engine elsewhere; level > 19 = ultra+LDM |
| `lz4` / `unlz4`, `snappy` / `unsnappy` | engine |
| `brotli(d, q=11)` / `unbrotli(d)` | engine |
| `lzma(d, level=9)` / `unlzma(d)` | engine |
| `bzip2(d, level=9)` / `unbzip2(d)` | engine |
| `pack(d)` / `unpack(d)` | tries brotli/lzma/bzip2/zstd-max, tags the smallest |
| `encodeImage(px, w, h, ch)` / `decodeImage(d)` | QOI lossless image |
| `encodeFrames(frames, frameSize, codec?)` / `decodeFrames(...)` | lossless temporal video |
| `engine` | the underlying `ZipKitEngine` |

```ts
const smallest = zk.pack(bytes);        // 1-byte tag + densest codec output
const original = zk.unpack(smallest);
```

---

## Raw engine

The low-level escape hatch: every codec as a synchronous method, no runtime dispatch.

```ts
import { ZipKitEngine, getEngine } from '@myrialabs/zipkit';

const engine = await getEngine();         // process-wide singleton (recommended)
const engine2 = await ZipKitEngine.load(); // fresh instance

engine.zstdMaxCompress(bytes, 22);        // ultra zstd
engine.frameDeltaEncode(frames, frameSize);
engine.qoiEncode(pixels, w, h, 4);
```

---

## Strings

```ts
import { strToU8, strFromU8, DecodeUTF8, EncodeUTF8 } from '@myrialabs/zipkit';

strToU8('héllo');                 // Uint8Array (UTF-8)
strToU8('binary', true);          // Latin-1 (1 byte/char)
strFromU8(bytes);                 // string (UTF-8)
strFromU8(bytes, true);           // Latin-1

const dec = new DecodeUTF8();     // streaming, handles split code points
dec.push(chunk); dec.end(last);
```

---

## Streams

```ts
compressionStream(codec: Codec, opts?: CompressOptions): TransformStream<Uint8Array, Uint8Array>
decompressionStream(codec: Codec, opts?: DecompressOptions): TransformStream<Uint8Array, Uint8Array>
```

gzip/zlib/deflate are native (incremental); other codecs buffer and compress on
flush. See [streaming.md](./streaming.md).

---

## Worker pool

```ts
import { WorkerPool, sharedPool } from '@myrialabs/zipkit';

const pool = new WorkerPool({ size: 4 });   // default: one per CPU (max 8)
await pool.compress(data, 'zstd', { level: 19, signal });
await pool.decompress(data, 'zstd');
await pool.zipCompress(data, 'deflate', 6);  // raw libdeflate/zstd for ZIP entries
await pool.destroy();

sharedPool();                                // process-wide lazy pool
```

Falls back to inline (same-thread) execution where `worker_threads` is unavailable.

---

## Parallel

Advanced multi-core compression: splits the input into independent blocks,
compresses them concurrently across the worker pool, and frames them in a
self-describing ZipKit container (magic `ZKP1`). Use this when both producer and
consumer are ZipKit and large-payload throughput matters more than a plain
standard stream.

```ts
import { compressParallel, decompressParallel, isParallelContainer } from '@myrialabs/zipkit';

const packed = await compressParallel(data, 'zstd', { level: 19, blockSize, pool, signal, onProgress });
const original = await decompressParallel(packed, { pool, signal });   // codec read from header
isParallelContainer(packed);                                           // true
```

| Option | Default | Notes |
| --- | --- | --- |
| `blockSize` | adaptive (≥256 KB, ~4 blocks/core) | larger = denser, smaller = more parallel |
| `pool` | `sharedPool()` | the worker pool to run on |
| `level`, `signal`, `onProgress` | — | as `CompressOptions` |

Each block is a complete stream of the chosen codec; only the outer container is
ZipKit-specific. Per-block independence costs a little ratio at high zstd levels.
Inputs up to 4 GB. Falls back to inline (single block) where workers are absent.

---

## ZIP

See [zip.md](./zip.md) for full detail.

```ts
import { zip, unzip, listEntries } from '@myrialabs/zipkit';

zip(entries: ZipEntryInput[], opts?: { parallel?: boolean }): Promise<Uint8Array>
unzip(data: Uint8Array, opts?: { filter?: (e: ZipEntryInfo) => boolean }): Promise<ZipEntry[]>
listEntries(data: Uint8Array): Promise<ZipEntryInfo[]>
```

CRC-32 runs in Wasm (libdeflate's SIMD path, not a JS table). Entry
compression fans out across the worker pool: `parallel` defaults to automatic
(on for ≥2 entries totalling ≥256 KB), and the container is assembled in order
so a parallel archive is byte-identical to a single-threaded one. Set
`parallel: true`/`false` to override.

---

## Middleware

```ts
import { Elysia } from 'elysia';
import { elysia as compression } from '@myrialabs/zipkit';

new Elysia()
  .onAfterHandle(compression())
  .get('/', () => ({ ok: true }))
  .listen(3000);
```

```ts
import express from 'express';
import { express as compression } from '@myrialabs/zipkit';

const app = express();
app.use(compression());
app.get('/', (_req, res) => res.json({ ok: true }));
app.listen(3000);
```

```ts
import { Hono } from 'hono';
import { hono as compression } from '@myrialabs/zipkit';

const app = new Hono();
app.use('*', compression());
```

Exports: `elysia`, `express`, `hono`, `negotiate`. Each factory accepts
`CompressionOptions { encodings?, threshold?, level? }`. See
[the README](../README.md#http-middleware).

---

## Archives & containers

### `extractStream` — read any archive, memory-bounded

```ts
import { extractStream } from '@myrialabs/zipkit';

for await (const { info, chunk, done } of extractStream(bytes, {
  format,          // optional; auto-detected from magic bytes otherwise
  password,        // encrypted ZIP entries (WinZip AES / ZipCrypto)
  filter,          // (info) => boolean — extract only matching entries
  maxTotalBytes,   // cap on total decompressed bytes; throws once exceeded
  signal,          // AbortSignal — throws AbortError between chunks
  entryName        // name for the single entry of a lone compressed stream
})) {
  // info: { name, type: 'file'|'directory'|'symlink', size, mode?, mtime?, linkname? }
  // chunk: Uint8Array (empty for dirs/symlinks); done: last chunk of this entry
}
```

One reader for **every container** — ZIP, tar (`.tar`/`.tar.gz`/`.tar.zst`/`.tar.xz`),
7z, and lone gzip/zstd/xz/bzip2/lz4 streams. Entries stream one chunk at a time so
you never hold the whole archive decompressed in memory.

`maxTotalBytes` caps *actually decompressed* bytes. On the streamable path (ZIP
`store`/`deflate`, gzip, plain tar) the cap is enforced **during** decompression
via the platform's incremental `DecompressionStream`, rejecting a zip bomb before
it allocates past the cap; the one-shot codecs (zstd, xz, bzip2, 7z) get a
best-effort declared-size pre-check plus a post-decode check. Path safety
(rejecting `../` / absolute names) is the caller's responsibility — `extractStream`
only decodes bytes.

### tar

```ts
import { tar, untar, tarGz, untarGz, tarZstd, untarZstd } from '@myrialabs/zipkit';
const bytes = tar([{ name: 'a.txt', data }, { name: 'dir/', type: 'directory' }]);
const files = untar(bytes);              // [{ name, data, type, mode, mtime, ... }]
const gz = await tarGz(entries);         // .tar.gz   (untarGz to read)
const zst = await tarZstd(entries);      // .tar.zst  (untarZstd to read)
```

POSIX `ustar` with PAX extensions for long paths / large entries. Interoperates
with the Unix `tar` CLI and Docker layers.

### xz

```ts
import { xz, unxz } from '@myrialabs/zipkit';
const out = await xz(data, { level: 9 });  // standard .xz (LZMA2 + CRC)
const back = await unxz(out);              // reads xz CLI / .tar.xz too
```

Full streaming `.xz` from the 7-Zip SDK; `decompress()` auto-detects it.

### 7z

```ts
import { sevenZip, unSevenZip } from '@myrialabs/zipkit';
const archive = await sevenZip([{ name: 'a.txt', data }]);   // LZMA1 (or method: 'copy')
const files = await unSevenZip(archive);                     // reads copy / LZMA1 / LZMA2
```

Interoperates with 7-Zip both directions, including LZMA-encoded headers.

### Streaming ZIP

```ts
import { zipStream } from '@myrialabs/zipkit';
await zipStream(entriesIterable, { onProgress }).pipeTo(destination);
```

Builds an archive incrementally through a `ReadableStream<Uint8Array>` — peak
memory is one entry, not the whole archive. ZIP64-aware.

### ZIP encryption

```ts
const enc = await zip(entries, { password: 'secret' });   // WinZip AES-256 (AE-2)
const out = await unzip(enc, { password: 'secret' });     // also reads legacy ZipCrypto
```

### Browser File System Access

```ts
import { zipToFileHandle, entriesFromFileHandles } from '@myrialabs/zipkit';
await zipToFileHandle(saveHandle, entriesFromFileHandles(pickedHandles));
```

## Dictionary & delta

```ts
import { trainDictionary, compressWithDictionary, decompressWithDictionary } from '@myrialabs/zipkit';
const dict = await trainDictionary(samples);              // many small similar payloads
const small = await compressWithDictionary(record, dict);

import { compressDelta, applyDelta } from '@myrialabs/zipkit';
const patch = await compressDelta(baseRevision, newRevision);   // log/JSON/chat deltas
const restored = await applyDelta(baseRevision, patch);
```

## Integrity

```ts
import { crc32, verifyChecksum } from '@myrialabs/zipkit';
const sum = await crc32(bytes);
await unzip(archive, { verify: true });   // re-checks every entry's CRC-32
```

## Errors

- `ZipKitError` — invalid input, unknown codec, undetectable format, wrong
  password, or a failed integrity/auth check.
- `AbortError` — operation aborted via an `AbortSignal`.
