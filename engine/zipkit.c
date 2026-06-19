// ZipKit unified Wasm engine — best-in-class C codecs in ONE module.
// Compiled to Wasm via Emscripten. Uniform ABI: persistent input/output
// buffers, one copy in + one copy out per call, no per-call free across JS.
//
// Codecs (added incrementally, each guarded by a macro):
//   ZK_LIBDEFLATE -> gzip / deflate / zlib   (libdeflate — beats zlib)
//   ZK_LZ4        -> lz4 block               (official lz4)
//   ZK_ZSTD       -> zstandard               (official libzstd)
//   ZK_BROTLI     -> brotli                  (official brotli)
//   ZK_SNAPPY     -> snappy                  (csnappy, C port)

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>

// ---- persistent buffers -----------------------------------------------------

static uint8_t *g_in = 0;
static size_t g_in_cap = 0;
static uint8_t *g_out = 0;
static size_t g_out_cap = 0;
static size_t g_result_len = 0;

static uint8_t *ensure(uint8_t **buf, size_t *cap, size_t need) {
  if (*cap < need) {
    size_t n = need + (need >> 1) + 64;
    *buf = (uint8_t *)realloc(*buf, n);
    *cap = n;
  }
  return *buf;
}

EMSCRIPTEN_KEEPALIVE uint8_t *zk_input_ptr(size_t size) {
  return ensure(&g_in, &g_in_cap, size);
}
EMSCRIPTEN_KEEPALIVE uint8_t *zk_result_ptr(void) { return g_out; }
EMSCRIPTEN_KEEPALIVE size_t zk_result_len(void) { return g_result_len; }

static void set_out(size_t n) { g_result_len = n; }

// =============================================================================
// libdeflate — gzip / deflate / zlib
// =============================================================================
#ifdef ZK_LIBDEFLATE
#include "libdeflate.h"

// Reusable compressors per level are cheap to recreate; keep a small cache.
static struct libdeflate_compressor *g_comp = 0;
static int g_comp_level = -1;
static struct libdeflate_decompressor *g_decomp = 0;

static struct libdeflate_compressor *comp(int level) {
  if (!g_comp || g_comp_level != level) {
    if (g_comp) libdeflate_free_compressor(g_comp);
    g_comp = libdeflate_alloc_compressor(level);
    g_comp_level = level;
  }
  return g_comp;
}
static struct libdeflate_decompressor *decomp(void) {
  if (!g_decomp) g_decomp = libdeflate_alloc_decompressor();
  return g_decomp;
}

EMSCRIPTEN_KEEPALIVE void zk_gzip_compress(size_t len, int level) {
  struct libdeflate_compressor *c = comp(level);
  size_t bound = libdeflate_gzip_compress_bound(c, len);
  ensure(&g_out, &g_out_cap, bound);
  size_t n = libdeflate_gzip_compress(c, g_in, len, g_out, g_out_cap);
  set_out(n);
}
EMSCRIPTEN_KEEPALIVE void zk_gzip_decompress(size_t len) {
  // gzip trailer ISIZE = uncompressed size mod 2^32 (little-endian last 4 bytes)
  uint32_t isize = 0;
  if (len >= 4)
    isize = g_in[len - 4] | (g_in[len - 3] << 8) | (g_in[len - 2] << 16) |
            ((uint32_t)g_in[len - 1] << 24);
  size_t outcap = isize ? isize : (len * 4 + 1024);
  ensure(&g_out, &g_out_cap, outcap);
  size_t actual = 0;
  enum libdeflate_result r =
      libdeflate_gzip_decompress(decomp(), g_in, len, g_out, g_out_cap, &actual);
  set_out(r == LIBDEFLATE_SUCCESS ? actual : 0);
}

EMSCRIPTEN_KEEPALIVE void zk_deflate_compress(size_t len, int level) {
  struct libdeflate_compressor *c = comp(level);
  size_t bound = libdeflate_deflate_compress_bound(c, len);
  ensure(&g_out, &g_out_cap, bound);
  size_t n = libdeflate_deflate_compress(c, g_in, len, g_out, g_out_cap);
  set_out(n);
}
EMSCRIPTEN_KEEPALIVE void zk_deflate_decompress(size_t len, size_t hint) {
  size_t outcap = hint ? hint : (len * 4 + 1024);
  ensure(&g_out, &g_out_cap, outcap);
  size_t actual = 0;
  enum libdeflate_result r = LIBDEFLATE_INSUFFICIENT_SPACE;
  for (int tries = 0; tries < 8; tries++) {
    r = libdeflate_deflate_decompress(decomp(), g_in, len, g_out, g_out_cap, &actual);
    if (r != LIBDEFLATE_INSUFFICIENT_SPACE) break;
    ensure(&g_out, &g_out_cap, g_out_cap * 2);
  }
  set_out(r == LIBDEFLATE_SUCCESS ? actual : 0);
}

EMSCRIPTEN_KEEPALIVE void zk_zlib_compress(size_t len, int level) {
  struct libdeflate_compressor *c = comp(level);
  size_t bound = libdeflate_zlib_compress_bound(c, len);
  ensure(&g_out, &g_out_cap, bound);
  size_t n = libdeflate_zlib_compress(c, g_in, len, g_out, g_out_cap);
  set_out(n);
}
EMSCRIPTEN_KEEPALIVE void zk_zlib_decompress(size_t len, size_t hint) {
  size_t outcap = hint ? hint : (len * 4 + 1024);
  ensure(&g_out, &g_out_cap, outcap);
  size_t actual = 0;
  enum libdeflate_result r = LIBDEFLATE_INSUFFICIENT_SPACE;
  for (int tries = 0; tries < 8; tries++) {
    r = libdeflate_zlib_decompress(decomp(), g_in, len, g_out, g_out_cap, &actual);
    if (r != LIBDEFLATE_INSUFFICIENT_SPACE) break;
    ensure(&g_out, &g_out_cap, g_out_cap * 2);
  }
  set_out(r == LIBDEFLATE_SUCCESS ? actual : 0);
}

// CRC-32 (IEEE) over the input buffer — the checksum every ZIP entry carries.
// Returns the value directly (no result buffer). Pass `seed` (a prior result)
// to continue a running CRC; pass 0 to start fresh. Uses libdeflate's
// SIMD-accelerated implementation, far faster than a byte-at-a-time table.
EMSCRIPTEN_KEEPALIVE uint32_t zk_crc32(size_t len, uint32_t seed) {
  return libdeflate_crc32(seed, g_in, len);
}
#endif // ZK_LIBDEFLATE

// =============================================================================
// LZ4 — block format, 4-byte LE uncompressed-size prefix
// =============================================================================
#ifdef ZK_LZ4
#include "lz4.h"
EMSCRIPTEN_KEEPALIVE void zk_lz4_compress(size_t len) {
  size_t bound = (size_t)LZ4_compressBound((int)len) + 4;
  ensure(&g_out, &g_out_cap, bound);
  g_out[0] = (uint8_t)len; g_out[1] = (uint8_t)(len >> 8);
  g_out[2] = (uint8_t)(len >> 16); g_out[3] = (uint8_t)(len >> 24);
  int n = LZ4_compress_default((const char *)g_in, (char *)g_out + 4, (int)len,
                               (int)(g_out_cap - 4));
  set_out(n > 0 ? (size_t)n + 4 : 0);
}
EMSCRIPTEN_KEEPALIVE void zk_lz4_decompress(size_t len) {
  uint32_t orig = g_in[0] | (g_in[1] << 8) | (g_in[2] << 16) |
                  ((uint32_t)g_in[3] << 24);
  ensure(&g_out, &g_out_cap, orig);
  int n = LZ4_decompress_safe((const char *)g_in + 4, (char *)g_out,
                              (int)(len - 4), (int)g_out_cap);
  set_out(n > 0 ? (size_t)n : 0);
}
#endif // ZK_LZ4

// =============================================================================
// Zstandard
// =============================================================================
#ifdef ZK_ZSTD
#include "zstd.h"
// Persistent contexts: reused across calls so the (large, for high levels)
// match tables are allocated ONCE, not per call. This is the key edge over a
// stateless native wrapper that recreates a context every invocation.
static ZSTD_CCtx *g_cctx = 0;
static ZSTD_DCtx *g_dctx = 0;

EMSCRIPTEN_KEEPALIVE void zk_zstd_compress(size_t len, int level) {
  if (!g_cctx) g_cctx = ZSTD_createCCtx();
  size_t bound = ZSTD_compressBound(len);
  ensure(&g_out, &g_out_cap, bound);
  size_t n = ZSTD_compressCCtx(g_cctx, g_out, g_out_cap, g_in, len, level);
  set_out(ZSTD_isError(n) ? 0 : n);
}
EMSCRIPTEN_KEEPALIVE void zk_zstd_decompress(size_t len) {
  if (!g_dctx) g_dctx = ZSTD_createDCtx();
  unsigned long long sz = ZSTD_getFrameContentSize(g_in, len);
  size_t outcap = (sz != ZSTD_CONTENTSIZE_UNKNOWN &&
                   sz != ZSTD_CONTENTSIZE_ERROR && sz > 0)
                      ? (size_t)sz
                      : len * 8 + 1024;
  ensure(&g_out, &g_out_cap, outcap);
  size_t n = ZSTD_decompressDCtx(g_dctx, g_out, g_out_cap, g_in, len);
  set_out(ZSTD_isError(n) ? 0 : n);
}
#endif // ZK_ZSTD

// =============================================================================
// Brotli
// =============================================================================
#ifdef ZK_BROTLI
#include "brotli/encode.h"
#include "brotli/decode.h"
EMSCRIPTEN_KEEPALIVE void zk_brotli_compress(size_t len, int quality) {
  size_t bound = BrotliEncoderMaxCompressedSize(len);
  if (bound == 0) bound = len * 2 + 1024;
  ensure(&g_out, &g_out_cap, bound);
  size_t outsize = g_out_cap;
  BROTLI_BOOL ok = BrotliEncoderCompress(quality, BROTLI_DEFAULT_WINDOW,
                                         BROTLI_MODE_GENERIC, len, g_in,
                                         &outsize, g_out);
  set_out(ok ? outsize : 0);
}
EMSCRIPTEN_KEEPALIVE void zk_brotli_decompress(size_t len) {
  ensure(&g_out, &g_out_cap, len * 8 + 1024);
  for (int tries = 0; tries < 8; tries++) {
    size_t outsize = g_out_cap;
    BrotliDecoderResult r =
        BrotliDecoderDecompress(len, g_in, &outsize, g_out);
    if (r == BROTLI_DECODER_RESULT_SUCCESS) { set_out(outsize); return; }
    ensure(&g_out, &g_out_cap, g_out_cap * 2);
  }
  set_out(0);
}
#endif // ZK_BROTLI

// =============================================================================
// Snappy (C API over the official C++ library)
// =============================================================================
#ifdef ZK_SNAPPY
#include "snappy-c.h"
EMSCRIPTEN_KEEPALIVE void zk_snappy_compress(size_t len) {
  size_t bound = snappy_max_compressed_length(len);
  ensure(&g_out, &g_out_cap, bound);
  size_t outlen = g_out_cap;
  snappy_status s =
      snappy_compress((const char *)g_in, len, (char *)g_out, &outlen);
  set_out(s == SNAPPY_OK ? outlen : 0);
}
EMSCRIPTEN_KEEPALIVE void zk_snappy_decompress(size_t len) {
  size_t orig = 0;
  snappy_uncompressed_length((const char *)g_in, len, &orig);
  ensure(&g_out, &g_out_cap, orig);
  size_t outlen = g_out_cap;
  snappy_status s =
      snappy_uncompress((const char *)g_in, len, (char *)g_out, &outlen);
  set_out(s == SNAPPY_OK ? outlen : 0);
}
#endif // ZK_SNAPPY

// =============================================================================
// Zstd MAX — ultra level 22 + long-distance matching (best zstd ratio).
// No native/portable competitor offers this turnkey. Decompress = zk_zstd_*.
// =============================================================================
#ifdef ZK_ZSTD
EMSCRIPTEN_KEEPALIVE void zk_zstd_max_compress(size_t len, int level) {
  if (!g_cctx) g_cctx = ZSTD_createCCtx();
  ZSTD_CCtx_reset(g_cctx, ZSTD_reset_session_and_parameters);
  ZSTD_CCtx_setParameter(g_cctx, ZSTD_c_compressionLevel, level); // up to 22
  ZSTD_CCtx_setParameter(g_cctx, ZSTD_c_enableLongDistanceMatching, 1);
  size_t bound = ZSTD_compressBound(len);
  ensure(&g_out, &g_out_cap, bound);
  size_t n = ZSTD_compress2(g_cctx, g_out, g_out_cap, g_in, len);
  set_out(ZSTD_isError(n) ? 0 : n);
}
#endif

// =============================================================================
// LZMA (7-zip SDK) — highest general-purpose ratio. Frame: [5 props][8 LE size][data]
// =============================================================================
#ifdef ZK_LZMA
#include "LzmaLib.h"
// Frame: [5 props][4 LE uint32 size][data]. (size_t is 32-bit on wasm32, and
// wasm linear memory caps at 4GB, so a 4-byte length is exact and sufficient.)
EMSCRIPTEN_KEEPALIVE void zk_lzma_compress(size_t len, int level) {
  size_t bound = len + len / 2 + 256;
  ensure(&g_out, &g_out_cap, bound + 9);
  unsigned char props[5];
  size_t propsSize = 5;
  size_t destLen = g_out_cap - 9;
  // Dictionary sized to the input (next pow2, clamped) — avoids LZMA's huge
  // level-default dict (up to 64MB) that would trap on small buffers.
  unsigned dictSize = 1u << 12;
  while (dictSize < len && dictSize < (1u << 26)) dictSize <<= 1;
  int res = LzmaCompress(g_out + 9, &destLen, g_in, len, props, &propsSize,
                         level, dictSize, -1, -1, -1, -1, 1);
  if (res != 0 || propsSize != 5) { set_out(0); return; }
  for (int i = 0; i < 5; i++) g_out[i] = props[i];
  uint32_t n = (uint32_t)len;
  g_out[5] = n; g_out[6] = n >> 8; g_out[7] = n >> 16; g_out[8] = n >> 24;
  set_out(9 + destLen);
}
EMSCRIPTEN_KEEPALIVE void zk_lzma_decompress(size_t len) {
  unsigned char props[5];
  for (int i = 0; i < 5; i++) props[i] = g_in[i];
  uint32_t orig = g_in[5] | (g_in[6] << 8) | (g_in[7] << 16) |
                  ((uint32_t)g_in[8] << 24);
  ensure(&g_out, &g_out_cap, orig);
  size_t destLen = orig;
  size_t srcLen = len - 9;
  int res = LzmaUncompress(g_out, &destLen, g_in + 9, &srcLen, props, 5);
  set_out(res == 0 ? destLen : 0);
}
#endif // ZK_LZMA

// =============================================================================
// bzip2 — Burrows-Wheeler. Frame: [8 LE size][data]
// =============================================================================
#ifdef ZK_BZIP2
#include "bzlib.h"
// Frame: [4 LE uint32 size][data]
EMSCRIPTEN_KEEPALIVE void zk_bzip2_compress(size_t len, int level) {
  unsigned int destLen = (unsigned int)(len + len / 100 + 600);
  ensure(&g_out, &g_out_cap, destLen + 4);
  unsigned int outLen = (unsigned int)(g_out_cap - 4);
  int res = BZ2_bzBuffToBuffCompress((char *)g_out + 4, &outLen, (char *)g_in,
                                     (unsigned int)len, level, 0, 0);
  if (res != 0) { set_out(0); return; }
  uint32_t n = (uint32_t)len;
  g_out[0] = n; g_out[1] = n >> 8; g_out[2] = n >> 16; g_out[3] = n >> 24;
  set_out(4 + outLen);
}
EMSCRIPTEN_KEEPALIVE void zk_bzip2_decompress(size_t len) {
  uint32_t orig = g_in[0] | (g_in[1] << 8) | (g_in[2] << 16) |
                  ((uint32_t)g_in[3] << 24);
  ensure(&g_out, &g_out_cap, orig);
  unsigned int outLen = (unsigned int)g_out_cap;
  int res = BZ2_bzBuffToBuffDecompress((char *)g_out, &outLen, (char *)g_in + 4,
                                       (unsigned int)(len - 4), 0, 0);
  set_out(res == 0 ? outLen : 0);
}
#endif // ZK_BZIP2

// =============================================================================
// QOI — lossless image codec (RGB/RGBA). New domain: images.
// =============================================================================
#ifdef ZK_QOI
#define QOI_IMPLEMENTATION
#define QOI_NO_STDIO
#include "qoi.h"
EMSCRIPTEN_KEEPALIVE void zk_qoi_encode(size_t len, int width, int height,
                                        int channels) {
  qoi_desc desc;
  desc.width = (unsigned)width;
  desc.height = (unsigned)height;
  desc.channels = (unsigned char)channels;
  desc.colorspace = 0; // QOI_SRGB
  int outlen = 0;
  void *enc = qoi_encode(g_in, &desc, &outlen);
  if (!enc) { set_out(0); return; }
  ensure(&g_out, &g_out_cap, (size_t)outlen);
  for (int i = 0; i < outlen; i++) g_out[i] = ((unsigned char *)enc)[i];
  free(enc);
  set_out((size_t)outlen);
}
EMSCRIPTEN_KEEPALIVE void zk_qoi_decode(size_t len) {
  qoi_desc desc;
  void *dec = qoi_decode(g_in, (int)len, &desc, 0);
  if (!dec) { set_out(0); return; }
  size_t outlen = (size_t)desc.width * desc.height * desc.channels;
  ensure(&g_out, &g_out_cap, outlen);
  for (size_t i = 0; i < outlen; i++) g_out[i] = ((unsigned char *)dec)[i];
  free(dec);
  set_out(outlen);
}
#endif // ZK_QOI

// =============================================================================
// Frame-delta predictor — lossless temporal prediction for video-like streams.
// Subtracts the previous frame so a codec sees mostly zeros. Pair with zstd/lz4.
// =============================================================================
EMSCRIPTEN_KEEPALIVE void zk_frame_delta_encode(size_t len, size_t frameSize) {
  ensure(&g_out, &g_out_cap, len);
  for (size_t i = 0; i < len; i++)
    g_out[i] = (i < frameSize) ? g_in[i]
                               : (uint8_t)(g_in[i] - g_in[i - frameSize]);
  set_out(len);
}
EMSCRIPTEN_KEEPALIVE void zk_frame_delta_decode(size_t len, size_t frameSize) {
  ensure(&g_out, &g_out_cap, len);
  for (size_t i = 0; i < len; i++)
    g_out[i] = (i < frameSize) ? g_in[i]
                               : (uint8_t)(g_in[i] + g_out[i - frameSize]);
  set_out(len);
}
