# ZipKit — Production Performance Benchmark

**Env:** Bun 1.3.14, darwin, 2026-06-20
**Method:** 8 warmup + 40 measured iterations, average compress & decompress time.

**Markers:** ⚠ = roundtrip mismatch

---

## E-commerce API

| Codec | Implementation | Size | Ratio | Compress | Decompress | OK |
|-------|----------------|------|-------|----------|------------|-----|
| **gzip** | | | | | | |
|  | ZipKit | 5.0 KB | 5.1% | 391 MB/s | 2.4 GB/s | ✓ |
|  | ZipKit (ratio) | 4.8 KB | 4.9% | 51 MB/s | 2.4 GB/s | ✓ |
|  | fflate | 5.8 KB | 5.9% | 54 MB/s | 121 MB/s | ✓ |
|  | pako | 5.6 KB | 5.7% | 106 MB/s | 216 MB/s | ✓ |
|  | Bun.gzipSync | 5.0 KB | 5.1% | 395 MB/s | 2.6 GB/s | ✓ |
| **deflate** | | | | | | |
|  | ZipKit | 5.0 KB | 5.1% | 409 MB/s | 2.5 GB/s | ✓ |
|  | ZipKit (ratio) | 4.8 KB | 4.9% | 53 MB/s | 2.5 GB/s | ✓ |
|  | fflate | 5.8 KB | 5.9% | 66 MB/s | 118 MB/s | ✓ |
|  | pako | 5.5 KB | 5.7% | 156 MB/s | 530 MB/s | ✓ |
|  | Bun.deflateSync | 5.0 KB | 5.1% | 408 MB/s | 2.9 GB/s | ✓ |
| **zlib** | | | | | | |
|  | ZipKit | 5.9 KB | 6.0% | 262 MB/s | 1.2 GB/s | ✓ |
|  | ZipKit (ratio) | 4.8 KB | 4.9% | 53 MB/s | 2.0 GB/s | ✓ |
|  | fflate | 5.8 KB | 5.9% | 67 MB/s | 117 MB/s | ✓ |
|  | pako | 5.6 KB | 5.7% | 147 MB/s | 527 MB/s | ✓ |
| **zstd** | | | | | | |
|  | ZipKit | 5.5 KB | 5.6% | 1.6 GB/s | 3.5 GB/s | ✓ |
|  | ZipKit (ratio) | 3.8 KB | 3.9% | 2 MB/s | 4.7 GB/s | ✓ |
|  | zstd-wasm | 5.5 KB | 5.6% | 354 MB/s | 970 MB/s | ✓ |
|  | Bun.zstdCompressSync | 5.5 KB | 5.6% | 1.9 GB/s | 3.5 GB/s | ✓ |
| **lz4** | | | | | | |
|  | ZipKit | 12.6 KB | 12.9% | 1022 MB/s | 2.1 GB/s | ✓ |
|  | lz4js | 12.2 KB | 12.5% | 402 MB/s | 492 MB/s | ✓ |
| **snappy** | | | | | | |
|  | ZipKit | 13.2 KB | 13.5% | 575 MB/s | 1.5 GB/s | ✓ |
|  | snappyjs | 13.2 KB | 13.5% | 357 MB/s | 440 MB/s | ✓ |
| **brotli** | | | | | | |
|  | ZipKit | 4.0 KB | 4.1% | 108 MB/s | 969 MB/s | ✓ |
|  | ZipKit (ratio) | 3.3 KB | 3.4% | 613.1 KB/s | 1.8 GB/s | ✓ |
|  | brotli-wasm | 4.0 KB | 4.1% | 43 MB/s | 600 MB/s | ✓ |
| **lzma** | | | | | | |
|  | ZipKit | 3.7 KB | 3.8% | 18 MB/s | 395 MB/s | ✓ |
| **bzip2** | | | | | | |
|  | ZipKit | 3.3 KB | 3.4% | 17 MB/s | 83 MB/s | ✓ |

## Web logs

| Codec | Implementation | Size | Ratio | Compress | Decompress | OK |
|-------|----------------|------|-------|----------|------------|-----|
| **gzip** | | | | | | |
|  | ZipKit | 10.4 KB | 10.6% | 315 MB/s | 1.6 GB/s | ✓ |
|  | ZipKit (ratio) | 9.4 KB | 9.6% | 78 MB/s | 1.8 GB/s | ✓ |
|  | fflate | 10.9 KB | 11.2% | 44 MB/s | 104 MB/s | ✓ |
|  | pako | 10.3 KB | 10.5% | 81 MB/s | 229 MB/s | ✓ |
|  | Bun.gzipSync | 10.4 KB | 10.6% | 321 MB/s | 1.8 GB/s | ✓ |
| **deflate** | | | | | | |
|  | ZipKit | 10.4 KB | 10.6% | 341 MB/s | 1.7 GB/s | ✓ |
|  | ZipKit (ratio) | 9.4 KB | 9.6% | 79 MB/s | 1.8 GB/s | ✓ |
|  | fflate | 10.9 KB | 11.1% | 53 MB/s | 99 MB/s | ✓ |
|  | pako | 10.3 KB | 10.5% | 112 MB/s | 740 MB/s | ✓ |
|  | Bun.deflateSync | 10.4 KB | 10.6% | 333 MB/s | 2.0 GB/s | ✓ |
| **zlib** | | | | | | |
|  | ZipKit | 9.5 KB | 9.7% | 227 MB/s | 1.7 GB/s | ✓ |
|  | ZipKit (ratio) | 9.4 KB | 9.6% | 83 MB/s | 1.6 GB/s | ✓ |
|  | fflate | 10.9 KB | 11.1% | 52 MB/s | 100 MB/s | ✓ |
|  | pako | 10.3 KB | 10.5% | 104 MB/s | 441 MB/s | ✓ |
| **zstd** | | | | | | |
|  | ZipKit | 11.8 KB | 12.0% | 1010 MB/s | 2.8 GB/s | ✓ |
|  | ZipKit (ratio) | 8.4 KB | 8.6% | 4 MB/s | 2.9 GB/s | ✓ |
|  | zstd-wasm | 11.8 KB | 12.0% | 335 MB/s | 1.3 GB/s | ✓ |
|  | Bun.zstdCompressSync | 11.8 KB | 12.0% | 1005 MB/s | 2.6 GB/s | ✓ |
| **lz4** | | | | | | |
|  | ZipKit | 21.0 KB | 21.5% | 1.4 GB/s | 4.4 GB/s | ✓ |
|  | lz4js | 20.2 KB | 20.7% | 329 MB/s | 447 MB/s | ✓ |
| **snappy** | | | | | | |
|  | ZipKit | 20.2 KB | 20.7% | 767 MB/s | 3.1 GB/s | ✓ |
|  | snappyjs | 20.2 KB | 20.7% | 270 MB/s | 390 MB/s | ✓ |
| **brotli** | | | | | | |
|  | ZipKit | 8.8 KB | 9.0% | 68 MB/s | 1.1 GB/s | ✓ |
|  | ZipKit (ratio) | 7.5 KB | 7.7% | 800.9 KB/s | 714 MB/s | ✓ |
|  | brotli-wasm | 8.8 KB | 9.0% | 30 MB/s | 536 MB/s | ✓ |
| **lzma** | | | | | | |
|  | ZipKit | 9.1 KB | 9.4% | 9 MB/s | 241 MB/s | ✓ |
| **bzip2** | | | | | | |
|  | ZipKit | 7.8 KB | 8.0% | 17 MB/s | 94 MB/s | ✓ |

## Binary-like

| Codec | Implementation | Size | Ratio | Compress | Decompress | OK |
|-------|----------------|------|-------|----------|------------|-----|
| **gzip** | | | | | | |
|  | ZipKit | 1.1 KB | 1.1% | 2.2 GB/s | 3.6 GB/s | ✓ |
|  | ZipKit (ratio) | 729 B | 0.7% | 444 MB/s | 3.9 GB/s | ✓ |
|  | fflate | 727 B | 0.7% | 74 MB/s | 146 MB/s | ✓ |
|  | pako | 731 B | 0.7% | 153 MB/s | 304 MB/s | ✓ |
|  | Bun.gzipSync | 1.1 KB | 1.1% | 2.0 GB/s | 4.2 GB/s | ✓ |
| **deflate** | | | | | | |
|  | ZipKit | 1.1 KB | 1.1% | 2.8 GB/s | 4.8 GB/s | ✓ |
|  | ZipKit (ratio) | 711 B | 0.7% | 571 MB/s | 4.6 GB/s | ✓ |
|  | fflate | 709 B | 0.7% | 93 MB/s | 146 MB/s | ✓ |
|  | pako | 713 B | 0.7% | 247 MB/s | 1.1 GB/s | ✓ |
|  | Bun.deflateSync | 1.1 KB | 1.1% | 2.9 GB/s | 5.5 GB/s | ✓ |
| **zlib** | | | | | | |
|  | ZipKit | 717 B | 0.7% | 519 MB/s | 3.2 GB/s | ✓ |
|  | ZipKit (ratio) | 717 B | 0.7% | 527 MB/s | 3.2 GB/s | ✓ |
|  | fflate | 715 B | 0.7% | 90 MB/s | 146 MB/s | ✓ |
|  | pako | 719 B | 0.7% | 197 MB/s | 664 MB/s | ✓ |
| **zstd** | | | | | | |
|  | ZipKit | 279 B | 0.3% | 9.9 GB/s | 20.2 GB/s | ✓ |
|  | ZipKit (ratio) | 279 B | 0.3% | 1.5 GB/s | 19.7 GB/s | ✓ |
|  | zstd-wasm | 279 B | 0.3% | 727 MB/s | 7.2 GB/s | ✓ |
|  | Bun.zstdCompressSync | 279 B | 0.3% | 10.9 GB/s | 18.3 GB/s | ✓ |
| **lz4** | | | | | | |
|  | ZipKit | 662 B | 0.7% | 8.5 GB/s | 16.3 GB/s | ✓ |
|  | lz4js | 675 B | 0.7% | 1.2 GB/s | 621 MB/s | ✓ |
| **snappy** | | | | | | |
|  | ZipKit | 5.1 KB | 5.2% | 2.0 GB/s | 10.4 GB/s | ✓ |
|  | snappyjs | 5.1 KB | 5.2% | 710 MB/s | 565 MB/s | ✓ |
| **brotli** | | | | | | |
|  | ZipKit | 281 B | 0.3% | 709 MB/s | 1.3 GB/s | ✓ |
|  | ZipKit (ratio) | 242 B | 0.2% | 22 MB/s | 1.1 GB/s | ✓ |
|  | brotli-wasm | 281 B | 0.3% | 77 MB/s | 766 MB/s | ✓ |
| **lzma** | | | | | | |
|  | ZipKit | 337 B | 0.3% | 56 MB/s | 2.7 GB/s | ✓ |
| **bzip2** | | | | | | |
|  | ZipKit | 955 B | 1.0% | 8 MB/s | 166 MB/s | ✓ |

---

## Parallel — multi-core, large data (8 cores)

The simple API stays standard-format by default. For controlled ZipKit-to-ZipKit large payloads, the advanced parallel container spreads independent blocks across the worker pool; this is the multi-core path single-threaded libraries do not have.

| Implementation | Threads | Size | Ratio | Compress | Decompress | OK |
|----------------|:-------:|------|-------|----------|------------|-----|
| ZipKit compressParallel (gzip) | 8 | 7.95 MB | 24.8% | 583 MB/s | 2.1 GB/s | ✓ |
| ZipKit single-thread (gzip ratio) | 1 | 7.42 MB | 23.2% | 98 MB/s | 784 MB/s | ✓ |
| Bun.gzipSync (gzip) | 1 | 7.93 MB | 24.8% | 115 MB/s | 738 MB/s | ✓ |
| fflate (gzip) | 1 | 8.20 MB | 25.6% | 39 MB/s | 74 MB/s | ✓ |
| ZipKit compressParallel (zstd L19) | 8 | 5.87 MB | 18.3% | 23 MB/s | 3.6 GB/s | ✓ |
| ZipKit single-thread (zstd L19) | 1 | 4.87 MB | 15.2% | 3 MB/s | 1.4 GB/s | ✓ |
| Bun.zstdCompressSync (zstd L19) | 1 | 4.87 MB | 15.2% | 3 MB/s | 1.4 GB/s | ✓ |

### Headline

On 34 MB of realistic (log-like) data, 8 cores:

- **gzip:** ZipKit parallel is **5.1× faster** than native `Bun.gzipSync` (583 MB/s vs 115 MB/s), and **0% denser**.
- **gzip:** ZipKit parallel is **15.1× faster** than fflate, and denser too.
- **zstd L19:** ZipKit parallel is **7.8× faster** than native `Bun.zstdCompressSync`, for 21% larger output (per-block independence at L19 — raise `blockSize` to trade speed back for ratio).

---

## ZIP archive — multi-file container (8 cores)

Archive: 20 files, 8.00 MB uncompressed, DEFLATE level 6.

| Implementation | Threads | Size | Ratio | Compress | Decompress | OK |
|----------------|:-------:|------|-------|----------|------------|-----|
| ZipKit zip (deflate, parallel) | 8 | 1.87 MB | 23.4% | 311 MB/s | 779 MB/s | ✓ |
| ZipKit zip (deflate, 1 thread) | 1 | 1.87 MB | 23.4% | 84 MB/s | 900 MB/s | ✓ |
| fflate (deflate) | 1 | 2.07 MB | 25.8% | 36 MB/s | 75 MB/s | ✓ |
| JSZip (deflate) | 1 | 1.95 MB | 24.3% | 42 MB/s | 222 MB/s | ✓ |
| ZipKit zip (zstd, parallel) | 8 | 1.54 MB | 19.2% | 18 MB/s | 508 MB/s | ✓ |

### Headline

On a 20-file, 8.00 MB archive (DEFLATE level 6), 8 cores:

- ZipKit parallel zip is **8.5× faster** than fflate and **7.5× faster** than JSZip, at **10% smaller** output (libdeflate).
- The `zstd` method packs the same archive denser still — a container no JS competitor offers.

---

## Legend

- **Ratio**: `compressed / original × 100%` — lower is smaller output.
- **Compress / Decompress**: throughput in auto-scaled units — higher is faster.
- **Implementation column**: fastest / smallest output
- **ZipKit**: default balanced mode (adaptive dispatch — native on Bun, Wasm elsewhere).
- **ZipKit (ratio)**: high-compression mode. For gzip/deflate this uses libdeflate (denser than zlib); for zstd uses level 19; for brotli uses quality 11.
- **Competitors**: fflate and pako use level 6, zstd-wasm uses level 3, brotli-wasm uses quality 6.