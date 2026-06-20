<p align="center">
  <img src="https://tunnelkit.myrialabs.dev/favicon.svg" alt="ZipKit" width="72" height="72" />
</p>

<h1 align="center">ZipKit</h1>

<p align="center">
  <strong>Overkill compression for Node, Bun &amp; the browser.</strong><br />
  gzip · deflate · zlib · zstd · lz4 · snappy · brotli · lzma · bzip2 · ZIP —
  one tiny, typed API over a single Wasm engine.
</p>

<p align="center">
  <a href="https://demo.zipkit.myrialabs.dev/">Demo</a> ·
  <a href="https://www.npmjs.com/package/zipkit">npm</a> ·
  <a href="./docs/api.md">API reference</a> ·
  <a href="./docs/cli.md">CLI reference</a> ·
  <a href="./docs/algorithms.md">Algorithms</a> ·
  <a href="./examples/README.md">Examples</a> ·
  <a href="https://github.com/myrialabs/zipkit/issues">Issues</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/zipkit"><img src="https://img.shields.io/npm/v/zipkit" alt="npm version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/runtime-Node%2018%2B%20%7C%20Bun%20%7C%20Browser-black" alt="Node 18+, Bun and Browser" />
</p>

---

ZipKit compiles best-in-class C compression libraries (libdeflate, zstd, lz4,
brotli, snappy, LZMA, bzip2) into one WebAssembly engine, then wraps them in a
small TypeScript API. The default path is adaptive: native speed where the runtime
wins, the portable engine where it wins, and libdeflate density when ratio matters.

```ts
import { gzip, gunzip, zstd, unzstd, zip, unzip, compress, decompress } from 'zipkit';

const gz = await gzip(bytes);              // balanced default
const back = await gunzip(gz);

const fast = await zstd(bytes, { mode: 'speed' });
const exact = await unzstd(fast);

const archive = await zip([{ name: 'data.bin', data: bytes }]);
const files = await unzip(archive);

const small = await compress(bytes, 'zstd', { mode: 'ratio' });
const orig = await decompress(small);      // auto-detects the format
```

```sh
zipkit compress data.json --codec zstd     # CLI
zipkit zip site.zip index.html app.js --method zstd
```

## Why ZipKit

- **One simple API, every codec** — named imports (`gzip`, `zstd`, `zip`) when you
  know what you want, or `compress()` / `decompress()` for generic dispatch.
- **One clear option** — `mode: 'speed' | 'balanced' | 'ratio'`. No tuning maze;
  `level` is still available when you need exact control.
- **Adaptive performance** — ZipKit chooses native Bun zlib/zstd where it wins,
  the Wasm engine where it wins, and libdeflate for density.
- **Denser gzip when you ask for ratio** — `mode: 'ratio'` uses libdeflate for
  gzip/deflate/zlib and beats runtime zlib output size on every benchmark dataset.
- **Runs everywhere** — Node 18+, Bun, and the browser, from the same import. No
  Bun required; native APIs are accelerators only when present.
- **More than fflate** — feature parity with fflate plus zstd/brotli/lzma/bzip2,
  ZIP-with-zstd, native `TransformStream`s, and lossless image (QOI) and video
  (frame-delta) codecs.
- **Typed & documented** — TypeScript-first, JSDoc on every export, tree-shakeable
  named imports, `sideEffects: false`.

## Install

```sh
bun add zipkit          # or: npm i zipkit / pnpm add zipkit
bun add -g zipkit       # CLI
```

## Quick start

| Task | API |
| --- | --- |
| Compress | `await zstd(bytes)` |
| Decompress | `await unzstd(bytes)` |
| Generic + auto-detect | `await compress(bytes, 'gzip')` · `await decompress(bytes)` |
| Just the smallest | `await pack(bytes)` · `await unpack(packed)` |
| Prefer speed | `await gzip(bytes, { mode: 'speed' })` |
| Prefer ratio | `await zstd(bytes, { mode: 'ratio' })` |
| ZIP archive | `await zip([{ name, data }])` · `await unzip(archive)` |
| Stream | `readable.pipeThrough(compressionStream('gzip'))` |

> **Auto-detect scope.** `decompress()` recognizes only the self-describing
> formats — **gzip, zlib, zstd** (and it flags ZIP archives, pointing you to
> `unzip`). For headerless or ZipKit-framed codecs (brotli, snappy, lz4, lzma,
> bzip2) name the codec: `decompressWith(bytes, 'brotli')`.

### The two API styles

**Named functions** (async, tree-shakeable) — the default. Each lazily loads the
shared engine the first time it's called.

```ts
import { brotli, unbrotli } from 'zipkit';
const c = await brotli(bytes, { mode: 'ratio' });
```

**The `ZipKit` class** (synchronous) — load the engine once, then call
synchronously. It accepts the same `mode` option as the async helpers while still
supporting the old numeric level argument (`zk.gzip(bytes, 6)`).

```ts
import { ZipKit } from 'zipkit';
const zk = await ZipKit.load();
const gz = zk.gzip(bytes, { mode: 'speed' }); // sync
const smallest = zk.pack(bytes); // tries brotli/lzma/bzip2/zstd-max, keeps the smallest
```

## Performance

Bun 1.3.14, every codec against its best competitor. Reproduce with
`bun run bench.ts`; the full tables (three datasets + parallel + ZIP archive vs
JSZip/fflate) live in [bench-results.md](./bench-results.md). All roundtrips are
byte-identical.

Representative — **E-commerce API**, ~97 KB JSON (throughput, higher is faster):

| Codec | Implementation | Ratio | Compress | Decompress |
|-------|----------------|------:|---------:|-----------:|
| **gzip** | | | | |
| | ZipKit | 5.1% | 391 MB/s | 2.4 GB/s |
| | ZipKit (ratio) | 4.9% | 51 MB/s | 2.4 GB/s |
| | fflate | 5.9% | 54 MB/s | 121 MB/s |
| | Bun.gzipSync | 5.1% | 395 MB/s | 2.6 GB/s |
| **deflate** | | | | |
| | ZipKit | 5.1% | 409 MB/s | 2.5 GB/s |
| | ZipKit (ratio) | 4.9% | 53 MB/s | 2.5 GB/s |
| | fflate | 5.9% | 66 MB/s | 118 MB/s |
| | Bun.deflateSync | 5.1% | 408 MB/s | 2.9 GB/s |
| **zlib** | | | | |
| | ZipKit | 6.0% | 262 MB/s | 1.2 GB/s |
| | ZipKit (ratio) | 4.9% | 53 MB/s | 2.0 GB/s |
| | fflate | 5.9% | 67 MB/s | 117 MB/s |
| **zstd** | | | | |
| | ZipKit | 5.6% | 1.6 GB/s | 3.5 GB/s |
| | ZipKit (ratio) | 3.9% | 2 MB/s | 4.7 GB/s |
| | zstd-wasm | 5.6% | 354 MB/s | 970 MB/s |
| | Bun.zstdCompressSync | 5.6% | 1.9 GB/s | 3.5 GB/s |
| **lz4** | | | | |
| | ZipKit | 12.9% | 1022 MB/s | 2.1 GB/s |
| | lz4js | 12.5% | 402 MB/s | 492 MB/s |
| **snappy** | | | | |
| | ZipKit | 13.5% | 575 MB/s | 1.5 GB/s |
| | snappyjs | 13.5% | 357 MB/s | 440 MB/s |
| **brotli** | | | | |
| | ZipKit | 4.1% | 108 MB/s | 969 MB/s |
| | ZipKit (ratio) | 3.4% | 613.1 KB/s | 1.8 GB/s |
| | brotli-wasm | 4.1% | 43 MB/s | 600 MB/s |
| **lzma** | | | | |
| | ZipKit | 3.8% | 18 MB/s | 395 MB/s |
| **bzip2** | | | | |
| | ZipKit | 3.4% | 17 MB/s | 83 MB/s |

What the full run adds beyond this table:

- **Against portable JS** (fflate, pako, zstd-wasm, brotli-wasm), ZipKit
  compresses several× faster at an equal-or-better ratio across all datasets.
- **`mode: 'ratio'`** trades speed for size: libdeflate gzip/deflate is denser
  than native zlib, and brotli/lzma/bzip2 reach the smallest output (~3.3–3.8% on JSON).
- **Parallel** (8 cores, 34 MB logs) is the multi-core path native libs lack:
  `compressParallel` gzip runs **5.1× faster** than `Bun.gzipSync`, same output size.
- **ZIP archives** fan entry compression across the pool: a 20-file, 8 MB archive
  packs **8.5× faster** than `fflate` and **7.5× faster** than JSZip, 10% smaller.

## Streaming

Web-standard `TransformStream`s for every codec. gzip / zlib / deflate are backed by
the platform's native `CompressionStream` (true incremental streaming); the rest
buffer and compress on flush.

```ts
import { compressionStream } from 'zipkit/streams';

await fetch(url)
  .then((r) => r.body!)
  .then((body) => body.pipeThrough(compressionStream('gzip')).pipeTo(dest));
```

## ZIP archives

```ts
import { zip, unzip } from 'zipkit';

const archive = await zip([
  { name: 'index.html', data: html },
  { name: 'app.js', data: js, method: 'zstd' },     // denser, ZipKit-aware peers
  { name: 'logo.png', data: png, method: 'store', unixPermissions: 0o644 }
]);

const files = await unzip(archive, { filter: (e) => e.name.endsWith('.js') });
```

`store` and `deflate` entries interoperate with every standard ZIP tool; `zstd`
entries (method 93) are much denser between ZipKit-aware peers. ZIP64 kicks in
automatically beyond 4 GB / 65 535 entries.

## HTTP middleware

`Accept-Encoding`-negotiating compression for Elysia, Express, and Hono
(brotli → zstd → gzip → deflate).

```ts
import { Elysia } from 'elysia';
import { elysia as compression } from 'zipkit/middleware';

new Elysia()
  .onAfterHandle(compression())
  .get('/', () => ({ rows: Array.from({ length: 200 }, (_, i) => ({ i })) }))
  .listen(3000);
```

```ts
import express from 'express';
import { express as compression } from 'zipkit/middleware';

const app = express();
app.use(compression());
app.get('/', (_req, res) => res.json({ rows: Array.from({ length: 200 }, (_, i) => ({ i })) }));
app.listen(3000);
```

```ts
import { Hono } from 'hono';
import { hono as compression } from 'zipkit/middleware';

const app = new Hono();
app.use('*', compression());
```

## Browser

The engine loads its `.wasm` via `import.meta.url`, which Vite, webpack 5, esbuild,
and Rollup resolve as an asset out of the box. See [docs/browser.md](./docs/browser.md).

The combined engine is ~1.4 MB of `.wasm` (every codec in one module), loaded
once and cached. Keep it off your initial bundle with a dynamic import
(`const { gzip } = await import('zipkit')`), or skip the engine entirely for
gzip/zlib/deflate by using [`zipkit/streams`](./docs/streaming.md), which run on
the browser's native `CompressionStream`. Per-codec Wasm splitting is on the
roadmap.

## Documentation

- [API reference](./docs/api.md) — every export, option, and method.
- [CLI reference](./docs/cli.md) — every command and flag.
- [Algorithms](./docs/algorithms.md) — which codec to use, with benchmark tables.
- [Streaming](./docs/streaming.md) · [ZIP](./docs/zip.md) · [Browser](./docs/browser.md)
- [Examples](./examples/README.md) — runnable scenarios.

## Support

If ZipKit is useful to you, consider supporting its development:

| Method | Address / Link |
|--------|----------------|
| Bitcoin (BTC) | `bc1qd9fyx4r84cce2a9hkjksetah802knadw5msls3` |
| Solana (SOL) | `Ev3P4KLF1PNC5C9rZYP8M3DdssyBQAQAiNJkvNmPQPVs` |
| Ethereum (ERC-20) | `0x61D826e5b666AA5345302EEEd485Acca39b1AFCF` |
| USDT (TRC-20) | `TLH49i3EoVKhFyLb6u2JUXZWScK7uzksdC` |
| Saweria | [saweria.co/myrialabs](https://saweria.co/myrialabs) |

## License

MIT — see [LICENSE](LICENSE). Bundles several open-source C libraries; see
[their licenses](./docs/algorithms.md#third-party-licenses).
