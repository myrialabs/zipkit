#!/usr/bin/env bash
# Build the unified ZipKit Wasm engine with Emscripten.
# One module: libdeflate (gzip/deflate/zlib) + lz4 + zstd(+ultra) + brotli +
# snappy + lzma + bzip2 + qoi(image) + frame-delta(video).
set -euo pipefail
cd "$(dirname "$0")"

bash vendor-download.sh

V=vendor
LIBDEFLATE=$V/libdeflate-1.22
LZ4=$V/lz4-1.10.0
ZSTD=$V/zstd-1.5.6
BROTLI=$V/brotli-1.1.0
SNAPPY=$V/snappy-1.2.1
LZMA=$V/lzma-sdk
BZIP2=$V/bzip2-1.0.8
OUT=dist
mkdir -p "$OUT"

# Exported wrapper functions (underscore-prefixed C symbols).
EXPORTS='["_zk_input_ptr","_zk_result_ptr","_zk_result_len"'
for s in \
  zk_gzip_compress zk_gzip_decompress zk_deflate_compress zk_deflate_decompress \
  zk_zlib_compress zk_zlib_decompress zk_crc32 \
  zk_lz4_compress zk_lz4_decompress \
  zk_zstd_compress zk_zstd_decompress zk_zstd_max_compress \
  zk_brotli_compress zk_brotli_decompress \
  zk_snappy_compress zk_snappy_decompress \
  zk_lzma_compress zk_lzma_decompress \
  zk_bzip2_compress zk_bzip2_decompress \
  zk_qoi_encode zk_qoi_decode \
  zk_frame_delta_encode zk_frame_delta_decode ; do
  EXPORTS+=",\"_$s\""
done
EXPORTS+=']'

# Source files.
SRC=(zipkit.c)
SRC+=("$LIBDEFLATE"/lib/adler32.c "$LIBDEFLATE"/lib/crc32.c
  "$LIBDEFLATE"/lib/deflate_compress.c "$LIBDEFLATE"/lib/deflate_decompress.c
  "$LIBDEFLATE"/lib/gzip_compress.c "$LIBDEFLATE"/lib/gzip_decompress.c
  "$LIBDEFLATE"/lib/zlib_compress.c "$LIBDEFLATE"/lib/zlib_decompress.c
  "$LIBDEFLATE"/lib/utils.c)
SRC+=("$LZ4"/lib/lz4.c)
# zstd: all C in common/compress/decompress, EXCLUDING the .S asm file.
while IFS= read -r f; do SRC+=("$f"); done < <(find "$ZSTD"/lib/common "$ZSTD"/lib/compress "$ZSTD"/lib/decompress -name '*.c')
# brotli: common + enc + dec
while IFS= read -r f; do SRC+=("$f"); done < <(find "$BROTLI"/c/common "$BROTLI"/c/enc "$BROTLI"/c/dec -name '*.c')
# snappy: C++ core + C API
SRC+=("$SNAPPY"/snappy.cc "$SNAPPY"/snappy-sinksource.cc
  "$SNAPPY"/snappy-stubs-internal.cc "$SNAPPY"/snappy-c.cc)
# lzma: 7-zip SDK, single-thread
SRC+=("$LZMA"/LzmaLib.c "$LZMA"/LzmaEnc.c "$LZMA"/LzmaDec.c "$LZMA"/LzFind.c
  "$LZMA"/Alloc.c "$LZMA"/CpuArch.c)
# bzip2: core (no file/program units)
SRC+=("$BZIP2"/blocksort.c "$BZIP2"/huffman.c "$BZIP2"/crctable.c
  "$BZIP2"/randtable.c "$BZIP2"/compress.c "$BZIP2"/decompress.c "$BZIP2"/bzlib.c)

INCLUDES="-I$LIBDEFLATE -I$LZ4/lib -I$ZSTD/lib -I$BROTLI/c/include -I$SNAPPY -I$LZMA -I$BZIP2 -I$V"

emcc "${SRC[@]}" \
  -DZK_LIBDEFLATE -DZK_LZ4 -DZK_ZSTD -DZK_BROTLI -DZK_SNAPPY \
  -DZK_LZMA -DZK_BZIP2 -DZK_QOI \
  -DZSTD_DISABLE_ASM=1 -DXXH_NAMESPACE=ZK_ -DHAVE_CONFIG_H=0 \
  -D_7ZIP_ST=1 \
  $INCLUDES \
  -O3 -msimd128 -flto \
  -Wno-unused-command-line-argument \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=node,web \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB -sMAXIMUM_MEMORY=4GB \
  -sEXPORTED_FUNCTIONS="$EXPORTS" \
  -sEXPORTED_RUNTIME_METHODS='["HEAPU8"]' \
  -sEXPORT_NAME=ZipKitModule \
  -o "$OUT/zipkit-engine.mjs"

echo "Built: $OUT/zipkit-engine.mjs"
ls -la "$OUT"/zipkit-engine.* | awk '{print $5, $9}'
