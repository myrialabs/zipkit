# ZipKit — Production Performance Benchmark

**Env:** Bun 1.3.14, darwin, 2026-06-27
**Method:** 8 warmup + 40 measured iterations, average compress & decompress time.

**Markers:** ⚠ = roundtrip mismatch

---

## E-commerce API

| Codec | Implementation | Size | Ratio | Compress | Decompress | OK |
|-------|----------------|------|-------|----------|------------|-----|
| **gzip** | | | | | | |
|  | ZipKit | 5.0 KB | 5.1% | 396 MB/s | 2.7 GB/s | ✓ |
|  | ZipKit (ratio) | 4.8 KB | 4.9% | 51 MB/s | 2.6 GB/s | ✓ |
|  | fflate | 5.8 KB | 5.9% | 55 MB/s | 122 MB/s | ✓ |
|  | pako | 5.6 KB | 5.7% | 102 MB/s | 202 MB/s | ✓ |
|  | Bun.gzipSync | 5.0 KB | 5.1% | 380 MB/s | 2.5 GB/s | ✓ |
| **deflate** | | | | | | |
|  | ZipKit | 5.0 KB | 5.1% | 400 MB/s | 2.7 GB/s | ✓ |
|  | ZipKit (ratio) | 4.8 KB | 4.9% | 50 MB/s | 2.5 GB/s | ✓ |
|  | fflate | 5.8 KB | 5.9% | 68 MB/s | 119 MB/s | ✓ |
|  | pako | 5.5 KB | 5.7% | 153 MB/s | 540 MB/s | ✓ |
|  | Bun.deflateSync | 5.0 KB | 5.1% | 399 MB/s | 2.7 GB/s | ✓ |
| **zlib** | | | | | | |
|  | ZipKit | 5.9 KB | 6.0% | 273 MB/s | 1.2 GB/s | ✓ |
|  | ZipKit (ratio) | 4.8 KB | 4.9% | 53 MB/s | 2.0 GB/s | ✓ |
|  | fflate | 5.8 KB | 5.9% | 63 MB/s | 112 MB/s | ✓ |
|  | pako | 5.6 KB | 5.7% | 134 MB/s | 515 MB/s | ✓ |
| **zstd** | | | | | | |
|  | ZipKit | 5.5 KB | 5.6% | 1.5 GB/s | 3.4 GB/s | ✓ |
|  | ZipKit (ratio) | 3.8 KB | 3.9% | 2 MB/s | 5.3 GB/s | ✓ |
|  | zstd-wasm | 5.5 KB | 5.6% | 354 MB/s | 978 MB/s | ✓ |
|  | Bun.zstdCompressSync | 5.5 KB | 5.6% | 1.9 GB/s | 3.5 GB/s | ✓ |
| **lz4** | | | | | | |
|  | ZipKit | 12.6 KB | 12.9% | 1018 MB/s | 2.1 GB/s | ✓ |
|  | lz4js | 12.2 KB | 12.5% | 399 MB/s | 515 MB/s | ✓ |
| **snappy** | | | | | | |
|  | ZipKit | 13.2 KB | 13.5% | 599 MB/s | 1.5 GB/s | ✓ |
|  | snappyjs | 13.2 KB | 13.5% | 358 MB/s | 437 MB/s | ✓ |
| **brotli** | | | | | | |
|  | ZipKit | 4.0 KB | 4.1% | 107 MB/s | 844 MB/s | ✓ |
|  | ZipKit (ratio) | 3.3 KB | 3.4% | 611.5 KB/s | 1.8 GB/s | ✓ |
|  | brotli-wasm | 4.0 KB | 4.1% | 42 MB/s | 560 MB/s | ✓ |
| **lzma** | | | | | | |
|  | ZipKit | 3.7 KB | 3.8% | 18 MB/s | 423 MB/s | ✓ |
| **bzip2** | | | | | | |
|  | ZipKit | 3.3 KB | 3.4% | 17 MB/s | 83 MB/s | ✓ |
| **xz** | | | | | | |
|  | ZipKit | 3.7 KB | 3.8% | 16 MB/s | 367 MB/s | ✓ |

## Web logs

| Codec | Implementation | Size | Ratio | Compress | Decompress | OK |
|-------|----------------|------|-------|----------|------------|-----|
| **gzip** | | | | | | |
|  | ZipKit | 10.4 KB | 10.6% | 318 MB/s | 1.7 GB/s | ✓ |
|  | ZipKit (ratio) | 9.4 KB | 9.6% | 81 MB/s | 1.8 GB/s | ✓ |
|  | fflate | 10.9 KB | 11.2% | 44 MB/s | 104 MB/s | ✓ |
|  | pako | 10.3 KB | 10.5% | 81 MB/s | 222 MB/s | ✓ |
|  | Bun.gzipSync | 10.4 KB | 10.6% | 319 MB/s | 1.8 GB/s | ✓ |
| **deflate** | | | | | | |
|  | ZipKit | 10.4 KB | 10.6% | 335 MB/s | 1.7 GB/s | ✓ |
|  | ZipKit (ratio) | 9.4 KB | 9.6% | 84 MB/s | 2.0 GB/s | ✓ |
|  | fflate | 10.9 KB | 11.1% | 52 MB/s | 101 MB/s | ✓ |
|  | pako | 10.3 KB | 10.5% | 112 MB/s | 706 MB/s | ✓ |
|  | Bun.deflateSync | 10.4 KB | 10.6% | 332 MB/s | 1.7 GB/s | ✓ |
| **zlib** | | | | | | |
|  | ZipKit | 9.5 KB | 9.7% | 228 MB/s | 1.6 GB/s | ✓ |
|  | ZipKit (ratio) | 9.4 KB | 9.6% | 83 MB/s | 1.7 GB/s | ✓ |
|  | fflate | 10.9 KB | 11.1% | 51 MB/s | 100 MB/s | ✓ |
|  | pako | 10.3 KB | 10.5% | 104 MB/s | 473 MB/s | ✓ |
| **zstd** | | | | | | |
|  | ZipKit | 11.8 KB | 12.0% | 1016 MB/s | 2.8 GB/s | ✓ |
|  | ZipKit (ratio) | 8.4 KB | 8.6% | 4 MB/s | 3.0 GB/s | ✓ |
|  | zstd-wasm | 11.8 KB | 12.0% | 336 MB/s | 1.3 GB/s | ✓ |
|  | Bun.zstdCompressSync | 11.8 KB | 12.0% | 1000 MB/s | 2.8 GB/s | ✓ |
| **lz4** | | | | | | |
|  | ZipKit | 21.0 KB | 21.5% | 1.3 GB/s | 3.9 GB/s | ✓ |
|  | lz4js | 20.2 KB | 20.7% | 324 MB/s | 588 MB/s | ✓ |
| **snappy** | | | | | | |
|  | ZipKit | 20.2 KB | 20.7% | 786 MB/s | 3.6 GB/s | ✓ |
|  | snappyjs | 20.2 KB | 20.7% | 286 MB/s | 417 MB/s | ✓ |
| **brotli** | | | | | | |
|  | ZipKit | 8.8 KB | 9.0% | 68 MB/s | 1.1 GB/s | ✓ |
|  | ZipKit (ratio) | 7.5 KB | 7.7% | 794.1 KB/s | 761 MB/s | ✓ |
|  | brotli-wasm | 8.8 KB | 9.0% | 30 MB/s | 515 MB/s | ✓ |
| **lzma** | | | | | | |
|  | ZipKit | 9.1 KB | 9.4% | 9 MB/s | 243 MB/s | ✓ |
| **bzip2** | | | | | | |
|  | ZipKit | 7.8 KB | 8.0% | 16 MB/s | 89 MB/s | ✓ |
| **xz** | | | | | | |
|  | ZipKit | 9.2 KB | 9.4% | 8 MB/s | 216 MB/s | ✓ |

## Binary-like

| Codec | Implementation | Size | Ratio | Compress | Decompress | OK |
|-------|----------------|------|-------|----------|------------|-----|
| **gzip** | | | | | | |
|  | ZipKit | 1.1 KB | 1.1% | 2.1 GB/s | 4.4 GB/s | ✓ |
|  | ZipKit (ratio) | 729 B | 0.7% | 446 MB/s | 4.1 GB/s | ✓ |
|  | fflate | 727 B | 0.7% | 76 MB/s | 147 MB/s | ✓ |
|  | pako | 731 B | 0.7% | 154 MB/s | 168 MB/s | ✓ |
|  | Bun.gzipSync | 1.1 KB | 1.1% | 2.0 GB/s | 4.5 GB/s | ✓ |
| **deflate** | | | | | | |
|  | ZipKit | 1.1 KB | 1.1% | 2.8 GB/s | 4.8 GB/s | ✓ |
|  | ZipKit (ratio) | 711 B | 0.7% | 577 MB/s | 4.4 GB/s | ✓ |
|  | fflate | 709 B | 0.7% | 95 MB/s | 143 MB/s | ✓ |
|  | pako | 713 B | 0.7% | 240 MB/s | 1012 MB/s | ✓ |
|  | Bun.deflateSync | 1.1 KB | 1.1% | 2.9 GB/s | 4.2 GB/s | ✓ |
| **zlib** | | | | | | |
|  | ZipKit | 717 B | 0.7% | 521 MB/s | 2.8 GB/s | ✓ |
|  | ZipKit (ratio) | 717 B | 0.7% | 517 MB/s | 2.7 GB/s | ✓ |
|  | fflate | 715 B | 0.7% | 89 MB/s | 143 MB/s | ✓ |
|  | pako | 719 B | 0.7% | 207 MB/s | 656 MB/s | ✓ |
| **zstd** | | | | | | |
|  | ZipKit | 279 B | 0.3% | 9.9 GB/s | 9.0 GB/s | ✓ |
|  | ZipKit (ratio) | 279 B | 0.3% | 1.5 GB/s | 8.9 GB/s | ✓ |
|  | zstd-wasm | 279 B | 0.3% | 716 MB/s | 5.8 GB/s | ✓ |
|  | Bun.zstdCompressSync | 279 B | 0.3% | 10.4 GB/s | 9.1 GB/s | ✓ |
| **lz4** | | | | | | |
|  | ZipKit | 662 B | 0.7% | 8.5 GB/s | 8.5 GB/s | ✓ |
|  | lz4js | 675 B | 0.7% | 1.1 GB/s | 845 MB/s | ✓ |
| **snappy** | | | | | | |
|  | ZipKit | 5.1 KB | 5.2% | 2.0 GB/s | 10.2 GB/s | ✓ |
|  | snappyjs | 5.1 KB | 5.2% | 701 MB/s | 558 MB/s | ✓ |
| **brotli** | | | | | | |
|  | ZipKit | 281 B | 0.3% | 699 MB/s | 1.3 GB/s | ✓ |
|  | ZipKit (ratio) | 242 B | 0.2% | 22 MB/s | 1.1 GB/s | ✓ |
|  | brotli-wasm | 281 B | 0.3% | 77 MB/s | 774 MB/s | ✓ |
| **lzma** | | | | | | |
|  | ZipKit | 337 B | 0.3% | 56 MB/s | 2.6 GB/s | ✓ |
| **bzip2** | | | | | | |
|  | ZipKit | 955 B | 1.0% | 8 MB/s | 163 MB/s | ✓ |
| **xz** | | | | | | |
|  | ZipKit | 388 B | 0.4% | 37 MB/s | 1.2 GB/s | ✓ |

---

## Parallel — multi-core, large data (8 cores)

The simple API stays standard-format by default. For controlled ZipKit-to-ZipKit large payloads, the advanced parallel container spreads independent blocks across the worker pool; this is the multi-core path single-threaded libraries do not have.

| Implementation | Threads | Size | Ratio | Compress | Decompress | OK |
|----------------|:-------:|------|-------|----------|------------|-----|
| ZipKit compressParallel (gzip) | 8 | 7.95 MB | 24.8% | 600 MB/s | 2.4 GB/s | ✓ |
| ZipKit single-thread (gzip ratio) | 1 | 7.42 MB | 23.2% | 97 MB/s | 744 MB/s | ✓ |
| Bun.gzipSync (gzip) | 1 | 7.93 MB | 24.8% | 111 MB/s | 775 MB/s | ✓ |
| fflate (gzip) | 1 | 8.20 MB | 25.6% | 39 MB/s | 73 MB/s | ✓ |
| ZipKit compressParallel (zstd L19) | 8 | 5.87 MB | 18.3% | 23 MB/s | 3.6 GB/s | ✓ |
| ZipKit single-thread (zstd L19) | 1 | 4.87 MB | 15.2% | 3 MB/s | 1.3 GB/s | ✓ |
| Bun.zstdCompressSync (zstd L19) | 1 | 4.87 MB | 15.2% | 3 MB/s | 1.3 GB/s | ✓ |

### Headline

On 34 MB of realistic (log-like) data, 8 cores:

- **gzip:** ZipKit parallel is **5.4× faster** than native `Bun.gzipSync` (600 MB/s vs 111 MB/s), and **0% denser**.
- **gzip:** ZipKit parallel is **15.5× faster** than fflate, and denser too.
- **zstd L19:** ZipKit parallel is **7.8× faster** than native `Bun.zstdCompressSync`, for 21% larger output (per-block independence at L19 — raise `blockSize` to trade speed back for ratio).

---

## ZIP archive — multi-file container (8 cores)

Archive: 20 files, 8.00 MB uncompressed, DEFLATE level 6.

| Implementation | Threads | Size | Ratio | Compress | Decompress | OK |
|----------------|:-------:|------|-------|----------|------------|-----|
| ZipKit zip (deflate, parallel) | 8 | 1.87 MB | 23.4% | 321 MB/s | 863 MB/s | ✓ |
| ZipKit zip (deflate, 1 thread) | 1 | 1.87 MB | 23.4% | 94 MB/s | 933 MB/s | ✓ |
| fflate (deflate) | 1 | 2.07 MB | 25.8% | 36 MB/s | 74 MB/s | ✓ |
| JSZip (deflate) | 1 | 1.95 MB | 24.3% | 41 MB/s | 223 MB/s | ✓ |
| ZipKit zip (zstd, parallel) | 8 | 1.54 MB | 19.2% | 19 MB/s | 570 MB/s | ✓ |

### Headline

On a 20-file, 8.00 MB archive (DEFLATE level 6), 8 cores:

- ZipKit parallel zip is **8.9× faster** than fflate and **7.8× faster** than JSZip, at **10% smaller** output (libdeflate).
- The `zstd` method packs the same archive denser still — a container no JS competitor offers.

---

## Dictionary & delta — small / incremental payloads

**Dictionary** — 500 similar JSON records (41.7 KB raw), compressed individually:

| Approach | Total size | Ratio | OK |
|----------|-----------|-------|-----|
| zstd L19, per record | 42.3 KB | 101.4% | ✓ |
| zstd L19 + dictionary | 14.3 KB | 34.2% | ✓ |

Dictionary output is **66% smaller** — the shared JSON shape lives in the dictionary, not every frame.

**Delta** — a 64.0 KB log doc with one appended line, encoded against the previous revision:

| Approach | Patch size | OK |
|----------|-----------|-----|
| zstd L19, standalone | 13.7 KB | ✓ |
| compressDelta vs base | 55 B | ✓ |

The delta is **254× smaller** than recompressing the whole revision — ideal for logs, chat history, and snapshotted state.

---

## Legend

- **Ratio**: `compressed / original × 100%` — lower is smaller output.
- **Compress / Decompress**: throughput in auto-scaled units — higher is faster.
- **Implementation column**: fastest / smallest output
- **ZipKit**: default balanced mode (adaptive dispatch — native on Bun, Wasm elsewhere).
- **ZipKit (ratio)**: high-compression mode. For gzip/deflate this uses libdeflate (denser than zlib); for zstd uses level 19; for brotli uses quality 11.
- **Competitors**: fflate and pako use level 6, zstd-wasm uses level 3, brotli-wasm uses quality 6.