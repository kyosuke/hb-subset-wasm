# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

hb-subset-wasm wraps HarfBuzz's font subsetting API in a standalone WebAssembly module with a minimal TypeScript API. It targets Cloudflare Workers first (no JS glue, no WASI filesystem, no Node-specific imports) but works in Node.js and browsers too.

## Build & test commands

```bash
# Full build (wasm + TypeScript)
npm run build

# Build only the wasm binary (requires emscripten SDK — emcc)
npm run build:wasm

# Build only TypeScript (tsc + postbuild script)
npm run build:ts

# Run tests (automatically runs pretest → full build first)
npm test

# Run a single test by name filter
node --test --test-name-pattern="should subset by text" test/subset.test.js

# Run benchmarks
npm run bench
```

## Architecture

The package has two layers:

1. **C wrapper** (`wasm/wrapper.c`) — thin C layer over HarfBuzz's subset API (`hb-subset.h`). Exposes `hb_wrapper_subset()` which takes all options as flat arrays/pointers and returns subsetted font bytes. Compiled to a standalone `.wasm` with no JS glue.

2. **TypeScript API** (`src/`) — handles wasm initialization, memory management (malloc/free), and marshals JS options into the flat C ABI.
   - `src/api.ts` — `init()` and `subset()` functions. All wasm memory allocation/deallocation happens here.
   - `src/types.ts` — `SubsetOptions`, `WasmSource`, and `WasmExports` interfaces.
   - `src/index.ts` — re-exports public API.

### Wasm build pipeline

`scripts/build-wasm.sh` compiles HarfBuzz sources (from `deps/harfbuzz` git submodule, pinned to 10.4.0) + `wasm/wrapper.c` using emscripten (`emcc`). Object files are cached in `build/`. Output goes to `dist/hb-subset.wasm`. Key build choices: standalone wasm (`--no-entry`, `STANDALONE_WASM=1`), emmalloc allocator, aggressive size optimization (`-Os`, `-flto`, many `HB_NO_*` defines).

### Package exports

- `hb-subset-wasm` → `dist/index.js` (init + subset)
- `hb-subset-wasm/wasm` → `dist/hb-subset.wasm` (raw wasm binary, typed as `WebAssembly.Module` for Cloudflare Workers)

## Testing

Tests use Node.js built-in test runner (`node:test`). Font fixtures in `test/fixtures/` include TrueType (Roboto), variable TrueType (Roboto Variable), and CFF/OTF variable (NotoSansJP). Tests import from `dist/` so a build is required first (handled by `pretest`).

There is also a Cloudflare Workers e2e test in `test/worker-e2e/` that can be run with wrangler.

## Key constraints

- The wasm module provides only two import stubs: `emscripten_notify_memory_growth` (no-op) and `proc_exit`. No other runtime dependencies.
- Memory is manually managed: `api.ts` allocates via `malloc()`, passes pointers to `hb_wrapper_subset()`, and frees everything in a `finally` block. The wasm output buffer is freed separately via `hb_wrapper_free()`.
- `init()` is idempotent — second call is a no-op. The wasm instance is stored in module-level state.
