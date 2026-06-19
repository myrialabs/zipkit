# CLI reference

```sh
bun add -g zipkit      # or: npm i -g zipkit
zipkit help
```

```
zipkit <command> [options]
```

## Commands

### `compress <file>`
Compress a file. Defaults to zstd.

```sh
zipkit compress data.json                       # → data.json.zst (zstd)
zipkit compress data.json --codec brotli        # → data.json.br
zipkit compress data.json --mode ratio          # smallest, codec-default level
zipkit compress data.json --codec gzip --level 9 -o out.gz
```

| Flag | Description |
| --- | --- |
| `--codec <c>` | One of: gzip, deflate, zlib, zstd, lz4, snappy, brotli, lzma, bzip2 (default zstd) |
| `--mode <m>` | `speed`, `balanced` (default), or `ratio` — picks a codec-specific level |
| `--level <n>` | Compression level (codec-specific, clamped). Overrides `--mode`'s level |
| `-o, --out <file>` | Output path (default: `<file>.<ext>`) |

### `decompress <file>`
Decompress a file. Auto-detects gzip/zlib/zstd by default.

```sh
zipkit decompress data.json.zst
zipkit decompress data.bin --codec brotli       # name the codec for headerless formats
zipkit decompress data.json.gz -o data.json
```

| Flag | Description |
| --- | --- |
| `--codec <c>` | Force a codec (required for brotli, snappy, lz4, lzma, bzip2) |
| `-o, --out <file>` | Output path |

### `zip <archive.zip> <files...>`
Create a ZIP archive.

```sh
zipkit zip site.zip index.html app.js style.css
zipkit zip data.zip *.json --method zstd
```

| Flag | Description |
| --- | --- |
| `--method <m>` | `deflate` (default), `zstd`, or `store` |

### `unzip <archive.zip>`
Extract a ZIP archive.

```sh
zipkit unzip site.zip
zipkit unzip site.zip -d ./out
```

| Flag | Description |
| --- | --- |
| `-d, --dir <dir>` | Output directory (default `.`) |

### `info <file>`
Show the detected format. For ZIP archives, list the entries.

```sh
zipkit info data.json.gz        # format: gzip
zipkit info site.zip            # lists entries with sizes and methods
```

### `bench <file>`
Compress and decompress a file with every codec; print ratio and timings.

```sh
zipkit bench big.log
```

```
bench big.log (5.9 KB)
codec     ratio    size        comp     decomp
gzip        1.2%        73 B     0.1ms    0.1ms
zstd        0.6%        38 B     1.5ms    1.2ms
brotli      0.5%        32 B    11.3ms    1.2ms
...
```

### `version` / `help`

```sh
zipkit version
zipkit help
```

## Notes

- Colors are disabled automatically when stdout is not a TTY, or when `NO_COLOR` is set.
- The CLI runs on both Node and Bun.
