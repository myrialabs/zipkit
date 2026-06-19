# ZipKit — Production Performance Benchmark

**Env:** Bun 1.3.14, darwin, 2026-06-19
**Method:** 8 warmup + 40 measured iterations, average compress & decompress time.

**Markers:** ⚠ = roundtrip mismatch

---

## E-commerce API

| Codec | Implementation | Size | Ratio | Compress | Decompress | OK |
|-------|----------------|------|-------|----------|------------|-----|
| **gzip** | | | | | | |
|  | ZipKit | 5.0 KB | 5.1% | 365 MB/s | 1.8 GB/s | ✓ |
|  | ZipKit (ratio) | 4.8 KB | 4.9% | 50 MB/s | 2.0 GB/s | ✓ |
|  | fflate | 5.8 KB | 5.9% | 53 MB/s | 118 MB/s | ✓ |
|  | pako | 5.6 KB | 5.7% | 104 MB/s | 198 MB/s | ✓ |
|  | Bun.gzipSync | 5.0 KB | 5.1% | 386 MB/s | 2.6 GB/s | ✓ |
| **deflate** | | | | | | |
|  | ZipKit | 5.0 KB | 5.1% | 379 MB/s | 1.9 GB/s | ✓ |
|  | ZipKit (ratio) | 4.8 KB | 4.9% | 52 MB/s | 1.9 GB/s | ✓ |
|  | fflate | 5.8 KB | 5.9% | 65 MB/s | 118 MB/s | ✓ |
|  | pako | 5.5 KB | 5.7% | 155 MB/s | 509 MB/s | ✓ |
|  | Bun.deflateSync | 5.0 KB | 5.1% | 407 MB/s | 2.8 GB/s | ✓ |
| **zlib** | | | | | | |
|  | ZipKit | 5.9 KB | 6.0% | 256 MB/s | 1.2 GB/s | ✓ |
|  | ZipKit (ratio) | 4.8 KB | 4.9% | 52 MB/s | 1.9 GB/s | ✓ |
|  | fflate | 5.8 KB | 5.9% | 66 MB/s | 116 MB/s | ✓ |
|  | pako | 5.6 KB | 5.7% | 144 MB/s | 498 MB/s | ✓ |
| **zstd** | | | | | | |
|  | ZipKit | 5.5 KB | 5.6% | 1.5 GB/s | 3.4 GB/s | ✓ |
|  | ZipKit (ratio) | 3.8 KB | 3.9% | 2 MB/s | 4.3 GB/s | ✓ |
|  | zstd-wasm | 5.5 KB | 5.6% | 346 MB/s | 880 MB/s | ✓ |
|  | Bun.zstdCompressSync | 5.5 KB | 5.6% | 1.9 GB/s | 3.3 GB/s | ✓ |
| **lz4** | | | | | | |
|  | ZipKit | 12.6 KB | 12.9% | 1010 MB/s | 1.4 GB/s | ✓ |
|  | lz4js | 12.2 KB | 12.5% | 333 MB/s | 481 MB/s | ✓ |
| **snappy** | | | | | | |
|  | ZipKit | 13.2 KB | 13.5% | 566 MB/s | 1.5 GB/s | ✓ |
|  | snappyjs | 13.2 KB | 13.5% | 340 MB/s | 430 MB/s | ✓ |
| **brotli** | | | | | | |
|  | ZipKit | 4.0 KB | 4.1% | 102 MB/s | 947 MB/s | ✓ |
|  | ZipKit (ratio) | 3.3 KB | 3.4% | 592.7 KB/s | 1.7 GB/s | ✓ |
|  | brotli-wasm | 4.0 KB | 4.1% | 41 MB/s | 569 MB/s | ✓ |
| **lzma** | | | | | | |
|  | ZipKit | 3.7 KB | 3.8% | 17 MB/s | 393 MB/s | ✓ |
| **bzip2** | | | | | | |
|  | ZipKit | 3.3 KB | 3.4% | 16 MB/s | 77 MB/s | ✓ |

## Web logs

| Codec | Implementation | Size | Ratio | Compress | Decompress | OK |
|-------|----------------|------|-------|----------|------------|-----|
| **gzip** | | | | | | |
|  | ZipKit | 10.4 KB | 10.6% | 299 MB/s | 1.3 GB/s | ✓ |
|  | ZipKit (ratio) | 9.4 KB | 9.6% | 78 MB/s | 1.4 GB/s | ✓ |
|  | fflate | 10.9 KB | 11.2% | 42 MB/s | 100 MB/s | ✓ |
|  | pako | 10.3 KB | 10.5% | 75 MB/s | 223 MB/s | ✓ |
|  | Bun.gzipSync | 10.4 KB | 10.6% | 313 MB/s | 1.7 GB/s | ✓ |
| **deflate** | | | | | | |
|  | ZipKit | 10.4 KB | 10.6% | 316 MB/s | 1.6 GB/s | ✓ |
|  | ZipKit (ratio) | 9.4 KB | 9.6% | 82 MB/s | 1.7 GB/s | ✓ |
|  | fflate | 10.9 KB | 11.1% | 51 MB/s | 100 MB/s | ✓ |
|  | pako | 10.3 KB | 10.5% | 108 MB/s | 581 MB/s | ✓ |
|  | Bun.deflateSync | 10.4 KB | 10.6% | 326 MB/s | 1.3 GB/s | ✓ |
| **zlib** | | | | | | |
|  | ZipKit | 9.5 KB | 9.7% | 221 MB/s | 1.5 GB/s | ✓ |
|  | ZipKit (ratio) | 9.4 KB | 9.6% | 81 MB/s | 1.7 GB/s | ✓ |
|  | fflate | 10.9 KB | 11.1% | 51 MB/s | 99 MB/s | ✓ |
|  | pako | 10.3 KB | 10.5% | 104 MB/s | 502 MB/s | ✓ |
| **zstd** | | | | | | |
|  | ZipKit | 11.8 KB | 12.0% | 1009 MB/s | 2.6 GB/s | ✓ |
|  | ZipKit (ratio) | 8.4 KB | 8.6% | 4 MB/s | 2.6 GB/s | ✓ |
|  | zstd-wasm | 11.8 KB | 12.0% | 322 MB/s | 1.3 GB/s | ✓ |
|  | Bun.zstdCompressSync | 11.8 KB | 12.0% | 996 MB/s | 2.6 GB/s | ✓ |
| **lz4** | | | | | | |
|  | ZipKit | 21.0 KB | 21.5% | 1.4 GB/s | 4.0 GB/s | ✓ |
|  | lz4js | 20.2 KB | 20.7% | 274 MB/s | 491 MB/s | ✓ |
| **snappy** | | | | | | |
|  | ZipKit | 20.2 KB | 20.7% | 775 MB/s | 2.8 GB/s | ✓ |
|  | snappyjs | 20.2 KB | 20.7% | 261 MB/s | 383 MB/s | ✓ |
| **brotli** | | | | | | |
|  | ZipKit | 8.8 KB | 9.0% | 66 MB/s | 768 MB/s | ✓ |
|  | ZipKit (ratio) | 7.5 KB | 7.7% | 779.0 KB/s | 725 MB/s | ✓ |
|  | brotli-wasm | 8.8 KB | 9.0% | 30 MB/s | 509 MB/s | ✓ |
| **lzma** | | | | | | |
|  | ZipKit | 9.1 KB | 9.4% | 9 MB/s | 240 MB/s | ✓ |
| **bzip2** | | | | | | |
|  | ZipKit | 7.8 KB | 8.0% | 17 MB/s | 91 MB/s | ✓ |

## Binary-like

| Codec | Implementation | Size | Ratio | Compress | Decompress | OK |
|-------|----------------|------|-------|----------|------------|-----|
| **gzip** | | | | | | |
|  | ZipKit | 729 B | 0.7% | 411 MB/s | 3.2 GB/s | ✓ |
|  | ZipKit (ratio) | 729 B | 0.7% | 440 MB/s | 3.2 GB/s | ✓ |
|  | fflate | 727 B | 0.7% | 74 MB/s | 138 MB/s | ✓ |
|  | pako | 731 B | 0.7% | 146 MB/s | 302 MB/s | ✓ |
|  | Bun.gzipSync | 1.1 KB | 1.1% | 2.0 GB/s | 3.7 GB/s | ✓ |
| **deflate** | | | | | | |
|  | ZipKit | 711 B | 0.7% | 548 MB/s | 4.1 GB/s | ✓ |
|  | ZipKit (ratio) | 711 B | 0.7% | 571 MB/s | 3.5 GB/s | ✓ |
|  | fflate | 709 B | 0.7% | 87 MB/s | 141 MB/s | ✓ |
|  | pako | 713 B | 0.7% | 239 MB/s | 1020 MB/s | ✓ |
|  | Bun.deflateSync | 1.1 KB | 1.1% | 2.7 GB/s | 4.7 GB/s | ✓ |
| **zlib** | | | | | | |
|  | ZipKit | 717 B | 0.7% | 500 MB/s | 3.1 GB/s | ✓ |
|  | ZipKit (ratio) | 717 B | 0.7% | 509 MB/s | 3.1 GB/s | ✓ |
|  | fflate | 715 B | 0.7% | 86 MB/s | 135 MB/s | ✓ |
|  | pako | 719 B | 0.7% | 201 MB/s | 546 MB/s | ✓ |
| **zstd** | | | | | | |
|  | ZipKit | 279 B | 0.3% | 10.0 GB/s | 9.8 GB/s | ✓ |
|  | ZipKit (ratio) | 279 B | 0.3% | 1.4 GB/s | 18.2 GB/s | ✓ |
|  | zstd-wasm | 279 B | 0.3% | 663 MB/s | 6.3 GB/s | ✓ |
|  | Bun.zstdCompressSync | 279 B | 0.3% | 9.1 GB/s | 17.0 GB/s | ✓ |
| **lz4** | | | | | | |
|  | ZipKit | 662 B | 0.7% | 7.7 GB/s | 14.9 GB/s | ✓ |
|  | lz4js | 675 B | 0.7% | 1.0 GB/s | 612 MB/s | ✓ |
| **snappy** | | | | | | |
|  | ZipKit | 5.1 KB | 5.2% | 1.8 GB/s | 9.9 GB/s | ✓ |
|  | snappyjs | 5.1 KB | 5.2% | 677 MB/s | 514 MB/s | ✓ |
| **brotli** | | | | | | |
|  | ZipKit | 281 B | 0.3% | 667 MB/s | 1.0 GB/s | ✓ |
|  | ZipKit (ratio) | 242 B | 0.2% | 19 MB/s | 1.2 GB/s | ✓ |
|  | brotli-wasm | 281 B | 0.3% | 74 MB/s | 801 MB/s | ✓ |
| **lzma** | | | | | | |
|  | ZipKit | 337 B | 0.3% | 55 MB/s | 2.7 GB/s | ✓ |
| **bzip2** | | | | | | |
|  | ZipKit | 955 B | 1.0% | 8 MB/s | 158 MB/s | ✓ |

---

## Parallel — multi-core, large data (8 cores)

The simple API stays standard-format by default. For controlled ZipKit-to-ZipKit large payloads, the advanced parallel container spreads independent blocks across the worker pool; this is the multi-core path single-threaded libraries do not have.

| Implementation | Threads | Size | Ratio | Compress | Decompress | OK |
|----------------|:-------:|------|-------|----------|------------|-----|
| ZipKit compressParallel (gzip) | 8 | 7.46 MB | 23.3% | 392 MB/s | 1.6 GB/s | ✓ |
| ZipKit single-thread (gzip ratio) | 1 | 7.42 MB | 23.2% | 94 MB/s | 647 MB/s | ✓ |
| Bun.gzipSync (gzip) | 1 | 7.93 MB | 24.8% | 107 MB/s | 687 MB/s | ✓ |
| fflate (gzip) | 1 | 8.20 MB | 25.6% | 36 MB/s | 70 MB/s | ✓ |
| ZipKit compressParallel (zstd L19) | 8 | 5.87 MB | 18.3% | 19 MB/s | 1.9 GB/s | ✓ |
| ZipKit single-thread (zstd L19) | 1 | 4.87 MB | 15.2% | 3 MB/s | 1.2 GB/s | ✓ |
| Bun.zstdCompressSync (zstd L19) | 1 | 4.87 MB | 15.2% | 3 MB/s | 1.2 GB/s | ✓ |

### Headline

On 34 MB of realistic (log-like) data, 8 cores:

- **gzip:** ZipKit parallel is **3.7× faster** than native `Bun.gzipSync` (392 MB/s vs 107 MB/s), and **6% denser**.
- **gzip:** ZipKit parallel is **10.8× faster** than fflate, and denser too.
- **zstd L19:** ZipKit parallel is **7.0× faster** than native `Bun.zstdCompressSync`, for 21% larger output (per-block independence at L19 — raise `blockSize` to trade speed back for ratio).

---

## ZIP archive — multi-file container (8 cores)

Archive: 20 files, 8.00 MB uncompressed, DEFLATE level 6.

| Implementation | Threads | Size | Ratio | Compress | Decompress | OK |
|----------------|:-------:|------|-------|----------|------------|-----|
| ZipKit zip (deflate, parallel) | 8 | 1.87 MB | 23.4% | 307 MB/s | 735 MB/s | ✓ |
| ZipKit zip (deflate, 1 thread) | 1 | 1.87 MB | 23.4% | 81 MB/s | 873 MB/s | ✓ |
| fflate (deflate) | 1 | 2.07 MB | 25.8% | 36 MB/s | 73 MB/s | ✓ |
| JSZip (deflate) | 1 | 1.95 MB | 24.3% | 40 MB/s | 223 MB/s | ✓ |
| ZipKit zip (zstd, parallel) | 8 | 1.54 MB | 19.2% | 16 MB/s | 500 MB/s | ✓ |

### Headline

On a 20-file, 8.00 MB archive (DEFLATE level 6), 8 cores:

- ZipKit parallel zip is **8.5× faster** than fflate and **7.7× faster** than JSZip, at **10% smaller** output (libdeflate).
- The `zstd` method packs the same archive denser still — a container no JS competitor offers.

---

## Legend

- **Ratio**: `compressed / original × 100%` — lower is smaller output.
- **Compress / Decompress**: throughput in auto-scaled units — higher is faster.
- **Implementation column**: fastest / smallest output
- **ZipKit**: default balanced mode (adaptive dispatch — native on Bun, Wasm elsewhere).
- **ZipKit (ratio)**: high-compression mode. For gzip/deflate this uses libdeflate (denser than zlib); for zstd uses level 19; for brotli uses quality 11.
- **Competitors**: fflate and pako use level 6, zstd-wasm uses level 3, brotli-wasm uses quality 6.