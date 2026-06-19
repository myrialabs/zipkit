# Maintainers Guide

Internal guide for zipkit maintainers. External contributors follow
[CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Guiding Principles

- **Audit before asking the contributor to validate.** Read the full diff and
  adjacent code before requesting changes.
- **Protect the invariants.** A single committed Wasm engine, cross-runtime
  support (Node + Bun + browser), hybrid native dispatch, and a quiet library
  core are load-bearing. A PR that breaks one needs explicit justification.
- **Engine artifacts are part of the diff.** If `engine/zipkit.c` or
  `engine/build.sh` changed, verify `engine/dist/*.{mjs,wasm}` were rebuilt and
  committed — ideally reproduce the build (`bun run build:engine`) and diff the
  Wasm hash.
- **Default to the established pattern.** New mechanisms need a reason the
  existing shape (named codecs / `ZipKit` / `ZipKitEngine` / `zip` / `streams` /
  `workers`) doesn't fit.
- **Warm, brief, substantive — in that order.** Open by naming something specific
  the contributor did well. `file:line` inline for technical points.
- **Attribution always.** Whether you build on a branch or close-and-replace, the
  original find earns credit.

---

## The PR Lifecycle

1. **Intake** — `gh pr checkout <N>`, read the entire diff first.
2. **Audit** — check:
   - **Invariants** — committed-engine, cross-runtime, native-dispatch, quiet core.
   - **Roundtrips** — every codec must roundtrip byte-identically; standard
     formats (gzip/zlib/zstd/deflate) must stay interoperable.
   - **Adjacent code** — same-shape gaps the PR didn't touch.
   - **Tests** — is there a `*.test.ts` where CONTRIBUTING expects one?
   - **Before/after** — walk one concrete scenario in user terms.
3. **Choose a path** (below).
4. **Merge** — squash-merge via the GitHub UI; subject = PR title `(#N)`; body
   empty except a `Co-authored-by:` trailer when reshaping a contributor's work;
   delete the branch.

### Review Paths

| Situation | Path |
|---|---|
| Audit clean | **Approve & merge.** Short approval naming what they did well; note checks green; merge. |
| Right shape, small additions, contributor engaged | **Iterate on the branch.** Push a *new* commit (never amend theirs); `merge` (not rebase) to sync `main`. |
| Out-of-scope same-shape gaps | **Merge as-is, follow-up PR.** Credit the find; open `fix/<scope>-…`. |
| Substantive concerns, you might lack context | **Comment & wait.** Warm opener, `file:line` concerns, the question that would flip your position, a plain-English deadline, explicit auto-stale consequence. |
| Shape must change | **Close & replace.** Explain why with `file:line`; open a replacement crediting them via `Co-authored-by:`. |

When unsure between "comment & wait" and a close, default to comment & wait.

---

## Communication Norms

- **All PR-facing text in English**, warmly, even when the maintainer
  conversation is in another language.
- **Don't link this file from PR comments.** Reference CONTRIBUTING.md instead.
- **Resolve conflicts locally**, never via the web UI. Never `--no-verify`.
  Never force-push to `main`.

---

## Release Process

Tag-driven, automated by `.github/workflows/ci.yml`. The `publish` job runs only
on `v*.*.*` tags, after `ci` (typecheck, lint, test, build, verify dist) passes.

```bash
git checkout main && git pull origin main
# bump "version" in package.json
git commit -am "release: vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

The workflow runs `npm publish --provenance --access public` (using `NPM_TOKEN`)
and creates a GitHub release with generated notes.

**One-time prerequisites:**
- `NPM_TOKEN` repository secret with publish rights to `zipkit`.
- The published tarball must contain `dist/` **and** `engine/dist/` (the latter
  carries the `.wasm`); `package.json#files` lists both. Verify with `npm pack`.

**Versioning (semver):** `fix` → patch, `feat` → minor, breaking public-API
change → major.

---

## Co-authored-by Trailer

```
Co-authored-by: Full Name <email@example.com>
```

Get the email via `git log <branch> -1 --format='%ae'`.
