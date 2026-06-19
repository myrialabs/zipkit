# Agent Guidelines

This file is for coding agents working in the **zipkit** repository.

## Project Snapshot

zipkit is a TypeScript ESM library and CLI for compression, running on Node 18+,
Bun, and the browser. It compiles best-in-class C libraries (libdeflate, lz4,
zstd, brotli, snappy, LZMA, bzip2, qoi) into a single WebAssembly engine and
wraps it in one typed API: named codec functions, a synchronous `ZipKit` class
with hybrid native dispatch, a ZIP container, web-standard streams, a worker
pool, and HTTP middleware.

Development uses Bun for scripts and tests.

## Core Rules

- The Wasm engine in `engine/dist/` is a committed deliverable. Rebuilding it
  needs Emscripten (`bun run build:engine`); building/testing the library does
  not. If you edit `engine/zipkit.c` or `engine/build.sh`, rebuild and commit the
  artifacts.
- Keep library code (`src/`) cross-runtime: Node 18+, Bun, browser. Gate
  `node:worker_threads` / `Bun.*` behind feature checks with a portable fallback.
- Preserve hybrid dispatch in `src/zipkit.ts` (native on Bun, engine elsewhere).
- Codecs are byte-only (`Uint8Array`). String handling lives in `src/string.ts`.
- Do not write to stdout/stderr from the library core — only `src/cli.ts`.
- Use explicit `.js` import specifiers. Keep strict TypeScript and ESLint intact.
- Do not revert or overwrite unrelated user changes.
- Update public docs when public behavior changes.

## Repository Map

- `src/index.ts` — package exports (barrel).
- `src/engine.ts` — `ZipKitEngine` Wasm loader + `getEngine()` singleton.
- `src/zipkit.ts` — high-level synchronous `ZipKit` class + hybrid dispatch.
- `src/codecs/*.ts` — per-codec async façades (gzip, zstd, brotli, …, image, video).
- `src/compress.ts` — generic `compress` / `decompressWith` / auto-detect `decompress`.
- `src/detect.ts` — magic-byte format detection.
- `src/string.ts` — string ↔ bytes helpers.
- `src/internal.ts` — level clamping, abort/progress helpers.
- `src/streams/` — `TransformStream` wrappers (native gzip/zlib/deflate + buffered).
- `src/workers/` — `worker_threads` pool (`index.ts`) + worker entry (`worker.ts`).
- `src/zip/` — ZIP container: `index.ts`, `crc32.ts`, `datetime.ts`.
- `src/middleware/` — Hono / Express / Elysia adapters + `shared.ts`.
- `src/cli.ts` — CLI entry and dispatch.
- `engine/` — Wasm source (`zipkit.c`, `build.sh`, `vendor/`) and `dist/` artifacts.
- `docs/*.md` — api, cli, algorithms, streaming, zip, browser.
- `examples/` — runnable usage examples.

## Style

- TypeScript strict. Tabs, single quotes, semicolons. `const` by default.
- `camelCase` values, `PascalCase` types/classes, `UPPER_SNAKE_CASE` constants,
  `kebab-case` files.
- `any` only at the Wasm/runtime boundary.
- Focused comments that explain non-obvious behavior.

## Testing And Checks

```sh
bun run typecheck
bun run lint
bun run test
bun run build
bun test src/zip/zip.test.ts   # targeted
```

Add `*.test.ts` next to non-trivial logic. Every codec must roundtrip
byte-identically; standard formats must stay interoperable (verified against
Bun/zlib in `src/detect.test.ts`).

## Documentation Rules

- Public API changes: update `README.md` and `docs/api.md`.
- CLI changes: update `README.md` and `docs/cli.md`.
- Example-affecting changes: update `examples/` or `examples/README.md`.
- Do not create new Markdown files unless requested or clearly needed.

## Contribution Metadata

Follow `CONTRIBUTING.md` for branch names, commit messages, PR titles, and PR
descriptions. Repository-facing text must be in English.
