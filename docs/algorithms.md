# Algorithms — which codec to use

ZipKit bundles nine general-purpose codecs plus lossless image/video. They span
the entire speed↔ratio frontier, so there's a right tool for every need. All
numbers below come from the repository benchmarks (Bun 1.3.14, Apple M2);
reproduce them with `bun run bench.ts`.

## TL;DR

| You want… | Use | Why |
| --- | --- | --- |
| Maximum speed | **lz4** or **snappy** | sub-millisecond, no native rival |
| Balanced speed/ratio | **zstd** or `mode: 'balanced'` | native where it wins, engine elsewhere |
| Smallest output | `mode: 'ratio'`, **lzma/bzip2** (text), **brotli** (web) | top of the ratio frontier |
| Web responses | **brotli** or **gzip** | understood by every browser |
| Don't care, just smallest | **`pack()`** | tries the dense codecs, keeps the smallest |
| Lossless image | **QOI** (`encodeImage`) | beats brotli on raw pixels |
| Lossless video/frames | **frame-delta + zstd** (`encodeFrames`) | 2× smaller than plain zstd |

## Side-by-side performance

The full throughput tables (three datasets + parallel) live in
[bench-results.md](../bench-results.md); the README has a representative slice.
The picture that drives codec choice:

- **gzip / deflate / zlib** — ZipKit tracks Bun's native zlib and runs several×
  faster than fflate and pako, at the same or smaller output.
- **zstd** — native-equivalent on Bun (same libzstd), and far ahead of zstd-wasm
  in the browser/Node.
- **lz4 / snappy** — fastest in their group; roughly 2× the JS competitors on
  large data, much more on small inputs.
- **brotli / lzma / bzip2** — slowest to compress but the densest output; reach
  for them when size is the only thing that matters.

## Ratio frontier (smallest output)

`mode: 'ratio'` switches gzip/deflate/zlib to libdeflate at the top level. Across
the benchmark datasets libdeflate is consistently smaller than native zlib —
roughly 15% on JSON and up to 2–3× on highly compressible text — so `ratio` is
the densest gzip available in a portable JS library. For the smallest output of
all, brotli/lzma/bzip2 (or `pack()`) win on size at the cost of speed.

## Image & video (domains portable libraries don't cover)

| Image (RGBA 256×256 lossless) | Ratio |
| --- | --- |
| brotli-wasm q11 | 0.429 |
| **ZipKit QOI** | **0.335** |
| **ZipKit QOI → zstd** | **0.050** |

| Video (30 frames RGBA lossless) | Ratio |
| --- | --- |
| zstd-wasm L19 (plain) | 0.0006 |
| **ZipKit frame-delta + zstd** | **0.0003** |

## Adaptive dispatch — the honest part

For codecs where Bun ships a native implementation, native can be the speed ceiling
on some inputs. ZipKit resolves this with a small public policy:

- `mode: 'speed'` favors lower levels and native runtime paths where they win.
- `mode: 'balanced'` is the default: standard output, practical levels, adaptive dispatch.
- `mode: 'ratio'` favors smaller output; for gzip/deflate/zlib it forces libdeflate.

For codecs with no native rival (lz4, snappy, brotli, lzma, bzip2, QOI,
frame-delta) the engine is the fast portable option.

## Levels

| Codec | Range | Default | Notes |
| --- | --- | --- | --- |
| gzip / deflate / zlib | 0–9 | speed 1, balanced 6, ratio 9 | 0 = store |
| zstd | 1–22 | speed 1, balanced 3, ratio 19 | > 19 enables ultra mode + long-distance matching |
| brotli | 0–11 | speed 4, balanced 6, ratio 11 | |
| lzma | 0–9 | speed 3, balanced 6, ratio 9 | |
| xz | 0–9 | speed 1, balanced 6, ratio 9 | standard `.xz` (LZMA2) |
| bzip2 | 1–9 | speed 1, balanced 6, ratio 9 | level = block size ×100 kB |

Out-of-range levels are clamped, not rejected.

## Standard-format compatibility

`gzip`, `deflate`, `zlib`, `zstd`, `snappy`, `brotli`, and `xz` produce standard,
interoperable output (verified against Bun/zlib, the `xz` CLI, and the system
tools). `lz4` uses the raw block format (no frame header). `lzma` and `bzip2` are
wrapped in a small ZipKit length-prefix frame, so decode them with ZipKit (not
external tools) — for a standard LZMA container that other tools read, use `xz`.

Container formats — **tar** (`@myrialabs/zipkit/tar`), **7z** (`@myrialabs/zipkit/sevenzip`), and the
**ZIP** family — interoperate with the Unix `tar`, 7-Zip, and standard ZIP tools
respectively (including WinZip AES for encrypted ZIPs).

## Third-party licenses

The Wasm engine statically links these open-source libraries. Each retains its own
license; consult `engine/vendor/` for the full texts.

| Library | License |
| --- | --- |
| libdeflate 1.22 | MIT |
| lz4 1.10.0 | BSD-2-Clause |
| zstd 1.5.6 | BSD-3-Clause / GPL-2.0 (dual) |
| brotli 1.1.0 | MIT |
| snappy 1.2.1 | BSD-3-Clause |
| LZMA SDK | public domain |
| bzip2 1.0.8 | bzip2 license (BSD-like) |
| qoi.h | MIT |
