#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HB_DIR="$ROOT_DIR/deps/harfbuzz/src"
WRAPPER="$ROOT_DIR/wasm/wrapper.c"
OUT_DIR="$ROOT_DIR/dist"
BUILD_DIR="$ROOT_DIR/build"
INITIAL_MEMORY_BYTES=2097152
STACK_SIZE_BYTES=65536
MAXIMUM_MEMORY_BYTES="${MAXIMUM_MEMORY_BYTES:-268435456}"

mkdir -p "$OUT_DIR" "$BUILD_DIR"

# HarfBuzz base sources (core library — subset-only, no shaping/drawing)
HB_BASE_SOURCES=(
  hb-blob.cc
  hb-buffer.cc
  hb-common.cc
  hb-face.cc
  hb-face-builder.cc
  hb-font.cc
  hb-map.cc
  hb-number.cc
  hb-ot-cff1-table.cc
  hb-ot-cff2-table.cc
  hb-ot-color.cc
  hb-ot-face.cc
  hb-ot-font.cc
  hb-ot-layout.cc
  hb-ot-map.cc
  hb-ot-metrics.cc
  hb-ot-name.cc
  hb-ot-shaper-default.cc
  hb-ot-shape.cc
  hb-ot-tag.cc
  hb-ot-var.cc
  hb-set.cc
  hb-shape-plan.cc
  hb-shape.cc
  hb-shaper.cc
  hb-static.cc
  hb-ucd.cc
  hb-unicode.cc
)

# HarfBuzz subset sources
HB_SUBSET_SOURCES=(
  hb-subset.cc
  hb-subset-cff-common.cc
  hb-subset-cff1.cc
  hb-subset-cff2.cc
  hb-subset-input.cc
  hb-subset-instancer-iup.cc
  hb-subset-instancer-solver.cc
  hb-subset-plan.cc
  hb-subset-serialize.cc
  graph/gsubgpos-context.cc
)

# Common compile flags
CFLAGS=(
  -I"$HB_DIR"
  -I"$HB_DIR/.."
  -DHB_NO_MT
  -DHB_NO_UCD_UNASSIGNED
  -DHB_MINIMIZE_MEMORY_USAGE
  -DHB_OPTIMIZE_SIZE
  -DHB_OPTIMIZE_SIZE_MORE
  -DHB_DISABLE_DEPRECATED
  -DHB_NO_ATEXIT
  -DHB_NO_BUFFER_MESSAGE
  -DHB_NO_BUFFER_SERIALIZE
  -DHB_NO_BUFFER_VERIFY
  -DHB_NO_ERRNO
  -DHB_NO_GETENV
  -DHB_NO_MMAP
  -DHB_NO_OPEN
  -DHB_NO_SETLOCALE
  -DHB_NO_AAT
  -DHB_NO_LEGACY
  -DHB_NO_DRAW
  -DHB_NO_PAINT
  -DHB_NO_STYLE
  -DHB_NO_MATH
  -DHB_NO_META
  -DHB_NO_HINTING
  -DHB_NO_BITMAP
  -DHB_NO_OT_FONT_GLYPH_NAMES
  -DHB_NO_OT_SHAPE_FRACTIONS
  -DHB_NO_FACE_COLLECT_UNICODES
  -DHB_NO_VERTICAL
  -DHB_NO_LAYOUT_FEATURE_PARAMS
  -DHB_NO_LAYOUT_COLLECT_GLYPHS
  -DHB_NO_LAYOUT_RARELY_USED
  -DHB_NO_LAYOUT_UNUSED
  -fvisibility=hidden
  -DNDEBUG
  -DHAVE_ROUND
  -DHAVE_STRTOD_L=0
  -fno-exceptions
  -fno-rtti
  -fno-threadsafe-statics
  -flto
  -Oz
)

echo "Building hb-subset.wasm (standalone)..."

if ! [[ "$MAXIMUM_MEMORY_BYTES" =~ ^[0-9]+$ ]]; then
  echo "MAXIMUM_MEMORY_BYTES must be a positive integer (bytes), got: $MAXIMUM_MEMORY_BYTES" >&2
  exit 1
fi
if (( MAXIMUM_MEMORY_BYTES < INITIAL_MEMORY_BYTES )); then
  echo "MAXIMUM_MEMORY_BYTES ($MAXIMUM_MEMORY_BYTES) must be >= INITIAL_MEMORY_BYTES ($INITIAL_MEMORY_BYTES)" >&2
  exit 1
fi

FLAGS_STAMP="$BUILD_DIR/.compile-flags.sha256"
FLAGS_HASH="$(
  {
    printf '%s\n' "${CFLAGS[@]}"
    printf 'EMCC=%s\n' "$(emcc --version | head -n 1)"
  } | shasum -a 256 | awk '{print $1}'
)"
FORCE_REBUILD=0
if [ ! -f "$FLAGS_STAMP" ] || [ "$(cat "$FLAGS_STAMP")" != "$FLAGS_HASH" ]; then
  FORCE_REBUILD=1
  printf '%s' "$FLAGS_HASH" > "$FLAGS_STAMP"
  echo "  Detected compiler flag/toolchain change; rebuilding all objects"
fi

dep_paths_from_file() {
  local dep_file="$1"
  awk '
    {
      gsub(/\\/, "", $0);
      if (NR == 1) sub(/^[^:]*:[[:space:]]*/, "", $0);
      n = split($0, parts, /[[:space:]]+/);
      for (i = 1; i <= n; i++) {
        if (parts[i] != "") print parts[i];
      }
    }
  ' "$dep_file"
}

needs_rebuild() {
  local src="$1"
  local obj="$2"
  local dep="$3"

  if [ "$FORCE_REBUILD" -eq 1 ] || [ ! -f "$obj" ] || [ ! -f "$dep" ] || [ "$src" -nt "$obj" ]; then
    return 0
  fi

  while IFS= read -r dep_path; do
    if [ -f "$dep_path" ] && [ "$dep_path" -nt "$obj" ]; then
      return 0
    fi
  done < <(dep_paths_from_file "$dep")

  return 1
}

# Step 1: Compile .cc sources to .o
OBJECTS=()
for src in "${HB_BASE_SOURCES[@]}" "${HB_SUBSET_SOURCES[@]}"; do
  obj="$BUILD_DIR/$(echo "$src" | tr '/' '_').o"
  dep="$BUILD_DIR/$(echo "$src" | tr '/' '_').d"
  if needs_rebuild "$HB_DIR/$src" "$obj" "$dep"; then
    emcc "${CFLAGS[@]}" -Wno-macro-redefined -MMD -MF "$dep" -c "$HB_DIR/$src" -o "$obj"
  fi
  OBJECTS+=("$obj")
done

# Step 2: Compile wrapper.c
WRAPPER_OBJ="$BUILD_DIR/wrapper.o"
WRAPPER_DEP="$BUILD_DIR/wrapper.d"
if needs_rebuild "$WRAPPER" "$WRAPPER_OBJ" "$WRAPPER_DEP"; then
  emcc "${CFLAGS[@]}" -MMD -MF "$WRAPPER_DEP" -c "$WRAPPER" -o "$WRAPPER_OBJ"
fi
OBJECTS+=("$WRAPPER_OBJ")

echo "  Compiled ${#OBJECTS[@]} object files"

# Step 3: Link into standalone wasm (no JS glue)
emcc \
  "${OBJECTS[@]}" \
  -Oz \
  -flto \
  --no-entry \
  -s STANDALONE_WASM=1 \
  -s FILESYSTEM=0 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY="$INITIAL_MEMORY_BYTES" \
  -s MAXIMUM_MEMORY="$MAXIMUM_MEMORY_BYTES" \
  -s STACK_SIZE="$STACK_SIZE_BYTES" \
  -s MALLOC=emmalloc \
  -s EXPORTED_FUNCTIONS='["_hb_wrapper_subset","_hb_wrapper_free","_hb_wrapper_face_get_glyph_count","_malloc","_free"]' \
  -o "$OUT_DIR/hb-subset.wasm"

# Report sizes
echo ""
echo "Build complete:"
ls -lh "$OUT_DIR/hb-subset.wasm"
