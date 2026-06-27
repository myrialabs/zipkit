# ZIP archives

`zipkit/zip` reads and writes standard ZIP archives, with an optional zstd method
for much denser archives between ZipKit-aware peers.

```ts
import { zip, unzip, listEntries } from 'zipkit';
```

## Creating an archive

```ts
const archive = await zip([
  { name: 'index.html', data: html },
  { name: 'app.js', data: js, method: 'zstd', level: 19 },
  { name: 'logo.png', data: png, method: 'store' },
  {
    name: 'run.sh',
    data: script,
    unixPermissions: 0o755,
    mtime: new Date('2026-01-01'),
    comment: 'entrypoint'
  }
]);
```

### `ZipEntryInput`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `name` | `string` | — | path within the archive (`/` separators) |
| `data` | `Uint8Array` | — | uncompressed contents |
| `method` | `'store' \| 'deflate' \| 'zstd'` | `'deflate'` | compression method |
| `level` | `number` | codec default | deflate/zstd level |
| `mtime` | `Date \| number` | now | last-modified time |
| `unixPermissions` | `number` | — | e.g. `0o644`, stored in external attrs |
| `comment` | `string` | — | per-entry comment |

### Options

`zip(entries, opts?)` accepts:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `parallel` | `boolean` | auto | compress entries across the worker pool |
| `onProgress` | `(done, total) => void` | — | fires as each entry finishes compressing |
| `password` | `string` | — | encrypt every entry with WinZip AES-256 (AE-2) |

CRC-32 is computed in Wasm (libdeflate's SIMD path). Entry compression fans out
over the worker pool — `parallel` defaults to on once there are at least two
entries totalling ≥256 KB, off otherwise (the hand-off would cost more than it
saves on tiny archives). The container is assembled in order, so a parallel
archive is byte-identical to a single-threaded one; pass `parallel: true`/`false`
to force it either way.

## Reading an archive

```ts
const entries = await unzip(archive);
for (const e of entries) {
  console.log(e.name, e.size, e.mtime, e.unixPermissions);
  await Bun.write(e.name, e.data);
}
```

### Encryption

```ts
const enc = await zip(entries, { password: 'secret' });   // WinZip AES-256 (AE-2)
const out = await unzip(enc, { password: 'secret' });     // also reads legacy ZipCrypto
```

New archives use WinZip AES-256 (AE-2), interoperable with 7-Zip and WinZip. On
read, both WinZip AES and legacy PKWARE ZipCrypto are decrypted; a wrong password
throws `ZipKitError` before any plaintext is produced. PBKDF2/HMAC-SHA1 come from
WebCrypto, so encryption needs `crypto.subtle` (present in Node 18+, Bun, and
browsers).

### Integrity check

```ts
const out = await unzip(archive, { verify: true });  // re-checks every entry's CRC-32
```

### Streaming writer

For archives too large to hold in memory, `zipStream()` emits the archive
incrementally through a `ReadableStream<Uint8Array>` — peak memory is one entry:

```ts
import { zipStream } from 'zipkit/zip';
await zipStream(entriesIterable).pipeTo(destinationWritable);
```

### Filtering

Skip decompressing entries you don't need — the `filter` runs on metadata, before
any decompression work:

```ts
const jsFiles = await unzip(archive, { filter: (e) => e.name.endsWith('.js') });
```

### Listing without extracting

```ts
const list = await listEntries(archive);   // ZipEntryInfo[] — names, sizes, methods
```

### `ZipEntry`

| Field | Type | Notes |
| --- | --- | --- |
| `name` | `string` | |
| `data` | `Uint8Array` | decompressed contents |
| `method` | `number` | 0 = store, 8 = deflate, 93 = zstd |
| `mtime` | `Date` | 2-second resolution (DOS time) |
| `size` / `compressedSize` | `number` | |
| `crc32` | `number` | stored checksum of the original data |
| `unixPermissions` | `number?` | if the archive recorded any |
| `comment` | `string?` | |

## Compatibility

- `store` and `deflate` entries interoperate with every standard ZIP tool
  (`unzip`, Explorer, macOS Archive Utility, fflate, …).
- `zstd` entries use method **93**; they're readable by ZipKit and other
  zstd-aware ZIP readers, but not by tools that only support deflate.
- **ZIP64** is engaged automatically when any size/offset exceeds 4 GB or there
  are more than 65 535 entries — both on write and on read.
- Filenames are stored UTF-8 (the language-encoding flag is set).

## Limitations

- `zip()` / `unzip()` build and read fully in memory (async because the codecs
  are Wasm). For multi-gigabyte archives, use `zipStream()`, whose peak memory is
  the single largest entry.
- Encrypted reading covers WinZip AES (AE-1/AE-2) and legacy ZipCrypto; ZipKit
  only ever *writes* WinZip AES (the weak ZipCrypto cipher is read-only).
