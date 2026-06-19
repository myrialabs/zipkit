# Claude Code Guidelines

Guidelines for Claude Code when working on **zipkit**.

---

## What This Project Is

zipkit is a TypeScript-native compression library and CLI for Node 18+, Bun, and
the browser. It compiles best-in-class C libraries into a single WebAssembly
engine and exposes one typed API:

- Named async codec functions (`gzip`, `zstd`, `brotli`, …) — tree-shakeable.
- A synchronous `ZipKit` class with hybrid native dispatch (native gzip/zstd on
  Bun, the Wasm engine everywhere else).
- A ZIP container (`zipkit/zip`), web-standard streams (`zipkit/streams`), a
  worker pool (`zipkit/workers`), and HTTP middleware (`zipkit/middleware`).

The package ships ESM (`NodeNext`) from `src/` to `dist/`, exports the API from
`src/index.ts`, and exposes the `zipkit` command through `dist/cli.js`. The Wasm
engine lives in `engine/dist/` and is published alongside `dist/`.

---

## Non-Negotiables

- The engine in `engine/dist/*.{mjs,wasm}` is a committed, published deliverable.
  Consumers never need Emscripten. Rebuild + commit the artifacts only when
  `engine/zipkit.c` or `engine/build.sh` changes (`bun run build:engine`).
- Keep `src/` cross-runtime (Node 18+, Bun, browser). Gate `node:worker_threads`
  and `Bun.*` behind feature checks with a portable fallback.
- Preserve hybrid dispatch in `src/zipkit.ts`: zstd dispatches to native on Bun
  (the speed ceiling — same libzstd), the Wasm engine elsewhere. gzip/deflate/
  zlib always use the libdeflate engine, which is denser than the native zlib —
  ZipKit beats native gzip/deflate on output size. Don't revert either decision
  without re-measuring.
- Codecs are byte-only (`Uint8Array`); strings convert via `src/string.ts`.
- The library core stays silent. Terminal writes belong only in `src/cli.ts`.
- Use ESM imports with explicit `.js` specifiers. Don't loosen the compiler or
  lint settings to make a change pass.
- Don't overwrite unrelated user changes — check `git status` first.

---

## Current Architecture

- `src/index.ts` — public exports.
- `src/engine.ts` — `ZipKitEngine` (Emscripten module loader) + `getEngine()`
  process-wide singleton. Imports `../engine/dist/zipkit-engine.mjs`.
- `src/zipkit.ts` — synchronous `ZipKit` class, hybrid dispatch, `pack`/`unpack`,
  image/video, plus `init()` shared instance.
- `src/codecs/*.ts` — async per-codec façades; `image.ts` (QOI), `video.ts`
  (frame-delta), `index.ts` barrel.
- `src/compress.ts` — `compress`, `decompressWith`, auto-detect `decompress`.
- `src/detect.ts` — magic-byte detection (gzip/zlib/zstd/lz4-frame/zip).
- `src/internal.ts` — `clampLevel`, abort/progress helpers.
- `src/string.ts` — `strToU8`/`strFromU8`, streaming `DecodeUTF8`/`EncodeUTF8`.
- `src/streams/index.ts` — `compressionStream`/`decompressionStream` (native for
  gzip/zlib/deflate, buffered otherwise).
- `src/workers/` — `WorkerPool`/`sharedPool` (`index.ts`), worker entry
  (`worker.ts`); inline fallback when `worker_threads` is unavailable.
- `src/parallel/` — `compressParallel`/`decompressParallel`: multi-core block
  compression over the worker pool, framed in the `ZKP1` container. The main
  performance edge over single-threaded competitors (incl. native) on large data.
- `src/zip/` — `index.ts` (zip/unzip/listEntries, ZIP64), `crc32.ts`, `datetime.ts`.
- `src/middleware/` — `hono.ts`, `express.ts`, `elysia.ts`, `shared.ts`, `index.ts`.
- `src/cli.ts` — CLI entry/dispatch only.
- `engine/` — Wasm source + committed `dist/`.
- `docs/`, `examples/` — public docs and runnable examples.

---

## Work Protocol

### Before Editing
- Inspect the relevant source and nearby tests.
- Use `rg` for search.
- Check `docs/` if the change touches public API or CLI behavior.

### While Editing
- Match local style: tabs, single quotes, semicolons, `const` by default.
- kebab-case files; `camelCase`/`PascalCase`/`UPPER_SNAKE_CASE` per the above.
- Add `bun:test` tests next to non-trivial logic. Codec changes need a roundtrip
  test; format changes need a detection/interop test.
- Keep `any` limited to the Wasm/runtime boundary.
- Prefer focused changes over broad refactors.

### After Editing
```sh
bun run typecheck
bun run lint
bun run test
bun run build
```
For docs-only changes, say so and skip the code checks if nothing else changed.

---

## Public Surface Rules

- Public API changes → update `README.md` and `docs/api.md`.
- CLI changes → update `README.md` and `docs/cli.md`.
- Keep examples aligned with the documented API.
- `README.md` may be dirty from user edits; don't overwrite unless required.
- Keep repository-facing text in English, following `CONTRIBUTING.md`.

---

## Verification Reference

- `bun run typecheck` — `tsc -p tsconfig.json --noEmit`
- `bun run lint` — ESLint flat config
- `bun run test` — `bun:test`
- `bun run build` — emit `dist/`
- `bun run build:engine` — rebuild the Wasm engine (needs Emscripten)
- `bun run prepublishOnly` — clean and build
