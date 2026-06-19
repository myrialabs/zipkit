# Contributing Guide

Thanks for considering a contribution to **zipkit**. This guide covers the dev
setup, conventions, and the submission process.

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.2+ (used for dev, tests, and CI).
- **Emscripten** (`emcc` 5.x) + Binaryen — only needed to *rebuild* the Wasm
  engine (`bun run build:engine`). The built engine is committed under
  `engine/dist/`, so building and testing the library needs **no** toolchain.

```bash
brew install emscripten binaryen   # only for engine rebuilds
```

zipkit ships as a TypeScript ESM library plus one prebuilt Wasm engine, running
on **Node 18+, Bun, and the browser**. Use `bun` for all package management and
scripts.

### Setup

```bash
git clone https://github.com/YOUR_USERNAME/zipkit.git
cd zipkit
git remote add upstream https://github.com/myrialabs/zipkit.git
bun install
bun run typecheck && bun run lint && bun run test && bun run build
```

All of these should pass on a fresh clone.

---

## Development Workflow

```bash
git checkout main && git pull upstream main
git checkout -b feature/your-feature
# develop & verify:
bun run typecheck && bun run lint && bun run test && bun run build
git commit -m "feat(zip): add streaming reader"
git push origin feature/your-feature   # then open a PR targeting main
```

---

## Project Principles

Non-negotiable — a PR that breaks one needs explicit discussion first:

- **One committed engine.** `engine/dist/zipkit-engine.{mjs,wasm}` are checked-in
  deliverables; consumers never need Emscripten. If you change `engine/zipkit.c`
  or `engine/build.sh`, rebuild and commit the artifacts in the same PR.
- **Cross-runtime.** Library code in `src/` must run on Node 18+, Bun, and the
  browser. Gate runtime-specific paths (e.g. `node:worker_threads`, `Bun.*`)
  behind feature checks with a portable fallback.
- **Never slower than native.** Preserve the hybrid dispatch in `ZipKit`
  (native gzip/zstd on Bun, Wasm engine elsewhere).
- **Quiet core.** Only `src/cli.ts` writes to stdout/stderr. The library never
  logs.
- **Bytes in, bytes out.** Codecs operate on `Uint8Array`; string handling lives
  in `src/string.ts`.
- **Public API changes are documented.** Update `README.md` and the relevant
  `docs/*.md` in the same PR.

---

## Code Style

- TypeScript, strict mode. `const` by default; `let` only when reassigned.
- ESM with explicit `.js` import specifiers (required by `NodeNext`).
- Tabs, single quotes, semicolons. No Prettier — manual consistency.
- Naming: `camelCase` values, `PascalCase` types/classes, `UPPER_SNAKE_CASE`
  constants, `kebab-case` files.
- `any` is acceptable only at the Wasm/runtime boundary (Emscripten module,
  Bun globals, framework middleware payloads).

### Tests

Add a `*.test.ts` next to the source using `bun:test` for any non-trivial logic
where a regression would be silent — codec roundtrips, format detection, ZIP
read/write, stream composition. All codecs must roundtrip byte-identically.

```bash
bun test src/zip/zip.test.ts   # single file
bun test                       # full suite
```

---

## Submitting Changes

All repository-facing text — branch names, commit messages, PR titles and
descriptions, PR comments — must be in **English**.

### Branch Naming

`<type>/<description>` — lowercase, kebab-case, exactly one `/`.
Types: `feature/`, `fix/`, `docs/`, `chore/`.

### Commit Messages

`<type>(<scope>): <subject>` — imperative, lowercase, no period, ≤72 chars.
Types: `feat`, `fix`, `docs`, `chore`, `release`.
Common scopes: `engine`, `codecs`, `zip`, `streams`, `workers`, `cli`,
`middleware`, `readme`, `examples`.

```
feat(zip): support ZIP64 on write
fix(detect): stop shadowing zstd with the zlib check
docs(algorithms): add brotli vs lzma guidance
```

### Pre-commit Checklist

- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] `bun run test` passes
- [ ] `bun run build` emits `dist/` cleanly
- [ ] Engine artifacts rebuilt & committed if `engine/` changed
- [ ] Public API/CLI change reflected in `README.md` + `docs/`

### Pull Request Description Template

```markdown
## Summary
What this PR does, in a sentence or two.

## Why
The motivation — bug it fixes, behavior it changes.

## Changes
- concrete bullet list

## Notes (optional)
Trade-offs, follow-ups.
```

Add `## Breaking changes` with a migration note whenever the public API changes.

---

## Reference

```bash
bun run typecheck     # tsc --noEmit
bun run lint          # eslint
bun run test          # bun:test
bun run build         # emit dist/
bun run build:engine  # rebuild the Wasm engine (needs emscripten)
```

- [TypeScript Docs](https://www.typescriptlang.org/docs/)
- [Bun Docs](https://bun.sh/docs)
- [Emscripten Docs](https://emscripten.org/)
- [Conventional Commits](https://www.conventionalcommits.org/)

## Questions?

- [Issues](https://github.com/myrialabs/zipkit/issues)
