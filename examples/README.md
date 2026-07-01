# ZipKit examples

Each file is a self-contained, runnable scenario. Run any with Bun:

```sh
bun run examples/<file>.ts
```

## Files

| Example | What it shows |
| --- | --- |
| [`gzip.ts`](./gzip.ts) | Compress/decompress a string with gzip |
| [`zstd.ts`](./zstd.ts) | zstd at multiple levels + auto-detecting `decompress()` |
| [`pack.ts`](./pack.ts) | `pack()` — automatically pick the smallest codec |
| [`zip-archive.ts`](./zip-archive.ts) | Build & read a ZIP (mixed methods, metadata, filter) |
| [`zip-streaming.ts`](./zip-streaming.ts) | `zipStream()` — stream a ZIP to disk, memory-bounded |
| [`zip-encrypted.ts`](./zip-encrypted.ts) | Password-protected ZIP (WinZip AES-256) |
| [`extract-stream.ts`](./extract-stream.ts) | `extractStream()` — read any archive (ZIP/tar/7z/…) with a zip-bomb cap |
| [`tar-archive.ts`](./tar-archive.ts) | tar / `.tar.gz` / `.tar.zst` build & read |
| [`sevenzip-archive.ts`](./sevenzip-archive.ts) | Build & read a `.7z` archive (LZMA) |
| [`xz-codec.ts`](./xz-codec.ts) | Standard `.xz` (LZMA2) + auto-detect |
| [`dictionary.ts`](./dictionary.ts) | zstd dictionary for many small, similar payloads |
| [`delta.ts`](./delta.ts) | Delta compression for incremental text/JSON |
| [`streaming.ts`](./streaming.ts) | `TransformStream` compress → decompress pipeline |
| [`image-qoi.ts`](./image-qoi.ts) | Lossless image compression (QOI, then QOI→zstd) |
| [`video-frames.ts`](./video-frames.ts) | Lossless temporal video (frame-delta + zstd) |
| [`middleware-elysia.ts`](./middleware-elysia.ts) | HTTP response compression for Elysia |
| [`middleware-express.ts`](./middleware-express.ts) | HTTP response compression for Express |
| [`middleware-hono.ts`](./middleware-hono.ts) | HTTP response compression for Hono |
| [`browser/`](./browser) | Vite browser lab: compare ZipKit vs competitors across 7 real-world scenarios, with throughput (MB/s), separate compress/decompress metrics, and capability matrix. |

## Notes

- The Node/Bun examples import from `../src/index.js`, so they run straight from a
  clone. In your own project, import from `'@myrialabs/zipkit'` instead.
- `middleware-elysia.ts` needs `bun add elysia`.
- `middleware-express.ts` needs `bun add express`.
- `middleware-hono.ts` needs `bun add hono`.
- The browser example depends on the local repo via `file:../..`. From a clone,
  run `bun run build` at the repo root first, then run it through Vite:
  `cd examples/browser && bun install && bun run dev`. It also installs browser
  competitors (`fflate`, `pako`, `lz4js`, `snappyjs`, `zstd-wasm`,
  `brotli-wasm`) for side-by-side comparison. Opening `index.html` directly as
  `file://` will not load browser modules or Wasm. The example's Vite config
  allows serving the repo-local Wasm engine in dev mode.
  
  The benchmark table shows **7 columns**: `Implementation | Size | Ratio | Compress | Decompress | OK`, with
  compress/decompress throughput in auto-scaled units (MB/s, GB/s). A summary
  row shows the **fastest compress** and **fastest decompress** champions across all
  codecs. Each codec group is separated by a header row for easy scanning.
