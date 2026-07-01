# Streaming

`@myrialabs/zipkit` provides web-standard `TransformStream`s for every codec, so
ZipKit drops into any `pipeThrough()` / `pipeTo()` pipeline — `fetch` bodies,
files, sockets, anything that speaks Web Streams (Node 18+, Bun, browsers).

```ts
import { compressionStream, decompressionStream } from '@myrialabs/zipkit';

compressionStream(codec, opts?): TransformStream<Uint8Array, Uint8Array>
decompressionStream(codec, opts?): TransformStream<Uint8Array, Uint8Array>
```

## Incremental vs buffered

| Codec | Backing | Behavior |
| --- | --- | --- |
| `gzip`, `zlib`, `deflate` | native `CompressionStream` / `DecompressionStream` | **true incremental streaming** — constant memory, no buffering |
| everything else | ZipKit engine | **buffered** — collects all input, compresses once on flush |

The engine codecs are one-shot, so their streams buffer the full input before
producing output. They still compose cleanly in a pipeline; they just aren't
incremental. **For unbounded streams, prefer gzip / zlib / deflate.**

> **Note on `level`/`mode` for the native streams.** gzip / zlib / deflate are
> backed by the platform's `CompressionStream`, which exposes no level knob, so
> a `level` or `mode` passed to `compressionStream('gzip', …)` is ignored. To
> control the level, compress the buffer in one shot with `gzip(bytes, { level })`
> instead. The buffered (engine) codecs do honor `level`/`mode`.

## Examples

Compress a fetch response to a file:

```ts
import { compressionStream } from '@myrialabs/zipkit';

const res = await fetch('https://example.com/big.json');
await res.body!
  .pipeThrough(compressionStream('gzip'))
  .pipeTo(Bun.file('big.json.gz').writer());
```

Decompress while reading:

```ts
import { decompressionStream } from '@myrialabs/zipkit';

const text = await new Response(
  Bun.file('big.json.gz').stream().pipeThrough(decompressionStream('gzip'))
).text();
```

Round-trip through a pipeline:

```ts
const out = readable
  .pipeThrough(compressionStream('zstd'))
  .pipeThrough(decompressionStream('zstd'));
```

## Extracting archives, memory-bounded

`extractStream` reads any container (ZIP, tar, `.tar.gz`/`.tar.zst`, 7z, or a lone
compressed stream) as an async iterable of entry chunks — you write each entry out
as it arrives, never buffering the whole archive:

```ts
import { extractStream } from '@myrialabs/zipkit';

for await (const { info, chunk, done } of extractStream(bytes, { maxTotalBytes: 1 << 30 })) {
  if (info.type === 'directory') continue;
  await sink(info.name).write(chunk);
}
```

`maxTotalBytes` caps decompressed output. On the streamable path (ZIP
`store`/`deflate`, gzip, plain tar) the cap is enforced *during* decompression via
the native `DecompressionStream`, so a zip bomb is rejected before it can allocate
past the cap; the one-shot codecs (zstd, xz, bzip2, 7z) fall back to a best-effort
pre/post-decode size check. `extractStream` decodes bytes only — validate entry
paths (`../`, absolute names) before writing to disk.

## Interop

gzip / zlib / deflate streams emit standard output, decodable by any conformant
decompressor (`zlib`, `Bun.gunzipSync`, browser `DecompressionStream`, etc.).

## Strings

For text streams, pair with the streaming string helpers:

```ts
import { EncodeUTF8, DecodeUTF8 } from '@myrialabs/zipkit';
```

`DecodeUTF8` correctly reassembles multi-byte code points split across chunks.
