#!/usr/bin/env bash
# Download and unpack all vendor C libraries needed to build the Wasm engine.
# Run automatically by build.sh if vendor/ is missing, or manually:
#   bash engine/vendor-download.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p vendor

fetch() {
  local name=$1 url=$2
  [ -d "vendor/$name" ] && return
  echo "  → $name"
  curl -fsSL "$url" | tar -xz -C vendor/
}

echo "Fetching vendor libraries..."
fetch libdeflate-1.22 https://github.com/ebiggers/libdeflate/archive/refs/tags/v1.22.tar.gz
fetch lz4-1.10.0      https://github.com/lz4/lz4/archive/refs/tags/v1.10.0.tar.gz
fetch zstd-1.5.6      https://github.com/facebook/zstd/archive/refs/tags/v1.5.6.tar.gz
fetch brotli-1.1.0    https://github.com/google/brotli/archive/refs/tags/v1.1.0.tar.gz
fetch snappy-1.2.1    https://github.com/google/snappy/archive/refs/tags/1.2.1.tar.gz
fetch bzip2-1.0.8     https://sourceware.org/pub/bzip2/bzip2-1.0.8.tar.gz

# LZMA SDK 18.05 — extracts without a top-level wrapper directory.
if [ ! -d vendor/LZMA-SDK-18.05 ]; then
  echo "  → LZMA-SDK-18.05"
  mkdir -p vendor/LZMA-SDK-18.05
  curl -fsSL https://www.7-zip.org/a/lzma1805.tar.bz2 | tar -xj -C vendor/LZMA-SDK-18.05
fi

echo "Done."
