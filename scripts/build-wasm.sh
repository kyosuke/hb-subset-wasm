#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HB_DIR="$ROOT_DIR/deps/harfbuzz/src"
WRAPPER="$ROOT_DIR/wasm/wrapper.c"
OUT_DIR="$ROOT_DIR/dist"
BUILD_DIR="$ROOT_DIR/build"

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

# Step 1: Compile .cc sources to .o
OBJECTS=()
for src in "${HB_BASE_SOURCES[@]}" "${HB_SUBSET_SOURCES[@]}"; do
  obj="$BUILD_DIR/$(echo "$src" | tr '/' '_').o"
  if [ ! -f "$obj" ] || [ "$HB_DIR/$src" -nt "$obj" ]; then
    emcc "${CFLAGS[@]}" -Wno-macro-redefined -c "$HB_DIR/$src" -o "$obj"
  fi
  OBJECTS+=("$obj")
done

# Step 2: Compile wrapper.c
WRAPPER_OBJ="$BUILD_DIR/wrapper.o"
if [ ! -f "$WRAPPER_OBJ" ] || [ "$WRAPPER" -nt "$WRAPPER_OBJ" ]; then
  emcc "${CFLAGS[@]}" -c "$WRAPPER" -o "$WRAPPER_OBJ"
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
  -s INITIAL_MEMORY=2097152 \
  -s STACK_SIZE=65536 \
  -s MALLOC=emmalloc \
  -s EXPORTED_FUNCTIONS='["_hb_wrapper_subset","_hb_wrapper_free","_hb_wrapper_face_get_glyph_count","_malloc","_free"]' \
  -o "$OUT_DIR/hb-subset.wasm"

# Report sizes
echo ""
echo "Build complete:"
ls -lh "$OUT_DIR/hb-subset.wasm"
