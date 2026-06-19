# Streaming

`zipkit/streams` provides web-standard `TransformStream`s for every codec, so
ZipKit drops into any `pipeThrough()` / `pipeTo()` pipeline — `fetch` bodies,
files, sockets, anything that speaks Web Streams (Node 18+, Bun, browsers).

```ts
import { compressionStream, decompressionStream } from 'zipkit/streams';

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
import { compressionStream } from 'zipkit/streams';

const res = await fetch('https://example.com/big.json');
await res.body!
  .pipeThrough(compressionStream('gzip'))
  .pipeTo(Bun.file('big.json.gz').writer());
```

Decompress while reading:

```ts
import { decompressionStream } from 'zipkit/streams';

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

## Interop

gzip / zlib / deflate streams emit standard output, decodable by any conformant
decompressor (`zlib`, `Bun.gunzipSync`, browser `DecompressionStream`, etc.).

## Strings

For text streams, pair with the streaming string helpers:

```ts
import { EncodeUTF8, DecodeUTF8 } from 'zipkit';
```

`DecodeUTF8` correctly reassembles multi-byte code points split across chunks.
