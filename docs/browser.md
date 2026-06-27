# Browser usage

ZipKit runs in the browser using the same Wasm engine as Node/Bun. The only
concern is making sure the bundler ships and resolves the `.wasm` asset.

## How the engine loads

The Emscripten module locates its `.wasm` relative to itself via `import.meta.url`:

```js
new URL('zipkit-engine.wasm', import.meta.url)
```

Modern bundlers understand this pattern and emit the `.wasm` as an asset
automatically — **no configuration needed** with:

- **Vite** (dev and build)
- **webpack 5** (`asyncWebAssembly` / asset modules)
- **esbuild** (with `--loader:.wasm=file` or the default asset handling)
- **Rollup** (`@rollup/plugin-url` or native asset handling)

```ts
import { gzip, zstd } from 'zipkit';

const compressed = await zstd(new TextEncoder().encode(text));
```

The engine is instantiated lazily on first use and cached for the page lifetime.

## Vite example

A minimal Vite app is in [`examples/browser`](../examples/browser). It depends on
the local repo via `file:../..`, so build the package once before installing the
example:

```sh
bun run build
cd examples/browser
bun install
bun run dev
```

Open the Vite URL it prints, usually `http://localhost:5173`. Do not open
`examples/browser/index.html` directly as a `file://` URL; browser module loading
and Wasm fetches are blocked by CORS/security rules outside an HTTP dev server.
The example's `vite.config.ts` allows Vite to serve the local repo's committed
`engine/dist/*.wasm` file during development.

## Bundle size

The combined engine is ~1.4 MB of `.wasm` because it contains every encoder. It's
loaded once and cached, and `await import()`-ing ZipKit keeps it off your initial
JS bundle. For size-sensitive apps:

- Lazy-load ZipKit only on the route/interaction that needs it
  (`const { gzip } = await import('zipkit')`).
- Prefer gzip/zlib/deflate via [`zipkit/streams`](./streaming.md), which use the
  browser's **native** `CompressionStream` and don't touch the Wasm engine at all.

> **Roadmap:** per-codec Wasm splitting (a small `core` module plus lazy
> zstd/brotli/lzma modules) is planned so browser apps can ship only the codecs
> they use. Until then, the combined engine is the single artifact.

## Web Streams

`compressionStream('gzip' | 'zlib' | 'deflate')` returns the browser's native
`CompressionStream` — true streaming with zero Wasm. Other codecs buffer and use
the engine. See [streaming.md](./streaming.md).

## File System Access

`zipkit/fsa` bridges the browser's `FileSystemFileHandle` to the streaming ZIP
writer, so you can zip large local files straight to disk without reading them
all into memory:

```ts
import { zipToFileHandle, entriesFromFileHandles } from 'zipkit/fsa';

const out = await window.showSaveFilePicker({ suggestedName: 'archive.zip' });
const picked = await window.showOpenFilePicker({ multiple: true });
await zipToFileHandle(out, entriesFromFileHandles(picked));
```

The module imports cleanly everywhere (handles are typed structurally); it just
needs real handles at call time, so use it behind a `showSaveFilePicker` check.

## Workers

`zipkit/workers` targets Node/Bun `worker_threads`. In the browser it transparently
falls back to inline (main-thread) execution. To compress off the main thread in a
browser, run ZipKit inside your own Web Worker.

## SIMD

The engine is built with `-msimd128`. All current browsers support Wasm SIMD; very
old versions may not. If you must support them, feature-detect and gate ZipKit
behind a capability check.
