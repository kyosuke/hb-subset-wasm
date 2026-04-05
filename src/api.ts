import type { WasmSource, SubsetOptions, WasmExports } from './types.js';

// HarfBuzz subset flag constants (from hb-subset.h)
const HB_SUBSET_FLAGS_NO_HINTING = 0x00000001;
const HB_SUBSET_FLAGS_RETAIN_GIDS = 0x00000002;
const HB_SUBSET_FLAGS_NOTDEF_OUTLINE = 0x00000040;

const ERROR_MESSAGES: Record<number, string> = {
  1: 'Failed to create font blob',
  2: 'Failed to create font face',
  3: 'Font has no glyphs — invalid or corrupted font data',
  4: 'Failed to create subset input — out of memory',
  5: 'Subset operation failed',
  6: 'Failed to serialize subset result',
  7: 'Subset result is empty',
  8: 'Failed to allocate output buffer — out of memory',
};

let ex: WasmExports | null = null;

/** Wasm import stubs — the standalone module needs only these two. */
function buildImportObject(): WebAssembly.Imports {
  return {
    env: {
      emscripten_notify_memory_growth: () => {},
    },
    wasi_snapshot_preview1: {
      proc_exit(code: number) {
        throw new Error(`hb-subset wasm called proc_exit(${code})`);
      },
    },
  };
}

/**
 * Initialize the wasm module.
 *
 * Call once before using `subset()`. Accepts various source types:
 *
 * ```ts
 * // Cloudflare Workers — pre-compiled module (fastest)
 * import wasmModule from 'hb-subset-wasm/wasm';
 * await init(wasmModule);
 *
 * // Node.js — raw bytes
 * import { readFileSync } from 'node:fs';
 * await init(readFileSync('node_modules/hb-subset-wasm/dist/hb-subset.wasm'));
 *
 * // Browser — fetch
 * await init(fetch('/hb-subset.wasm'));
 * ```
 */
export async function init(source: WasmSource): Promise<void> {
  if (ex) return;

  const imports = buildImportObject();
  let instance: WebAssembly.Instance;

  if (source instanceof WebAssembly.Module) {
    // Pre-compiled module (Cloudflare Workers) — must use async instantiate
    // because workerd hangs on synchronous new WebAssembly.Instance() for large modules.
    instance = await WebAssembly.instantiate(source, imports) as unknown as WebAssembly.Instance;
  } else if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    // Raw bytes (Node.js, Deno)
    const bytes = source instanceof ArrayBuffer
      ? source
      : (source as Uint8Array).buffer.slice(
          (source as Uint8Array).byteOffset,
          (source as Uint8Array).byteOffset + (source as Uint8Array).byteLength,
        );
    const { instance: inst } = await WebAssembly.instantiate(bytes, imports) as
      unknown as { instance: WebAssembly.Instance };
    instance = inst;
  } else {
    // Response or Promise<Response> (browser fetch)
    const response = await source;
    if (typeof WebAssembly.instantiateStreaming === 'function') {
      try {
        const { instance: inst } = await WebAssembly.instantiateStreaming(response, imports) as
          unknown as { instance: WebAssembly.Instance };
        instance = inst;
      } catch {
        // Fallback if content-type isn't application/wasm
        const buf = await response.clone().arrayBuffer();
        const { instance: inst } = await WebAssembly.instantiate(buf, imports) as
          unknown as { instance: WebAssembly.Instance };
        instance = inst;
      }
    } else {
      const buf = await response.arrayBuffer();
      const { instance: inst } = await WebAssembly.instantiate(buf, imports) as
        unknown as { instance: WebAssembly.Instance };
      instance = inst;
    }
  }

  ex = instance.exports as unknown as WasmExports;

  // STANDALONE_WASM reactors need _initialize called once
  if (typeof ex._initialize === 'function') {
    ex._initialize();
  }
}

function getWasm(): WasmExports {
  if (!ex) {
    throw new Error('hb-subset-wasm not initialized. Call init() first.');
  }
  return ex;
}

/** Get the current wasm memory buffer (may change after growth). */
function buf(): ArrayBuffer {
  return getWasm().memory.buffer;
}

/**
 * Encode a 4-character tag string to bytes. Pads with spaces if shorter.
 */
function encodeTag(tag: string): [number, number, number, number] {
  const padded = (tag + '    ').slice(0, 4);
  return [
    padded.charCodeAt(0),
    padded.charCodeAt(1),
    padded.charCodeAt(2),
    padded.charCodeAt(3),
  ];
}

/**
 * Subset a font, returning the subsetted font bytes.
 *
 * ```ts
 * const result = await subset(fontBytes, { text: 'Hello, world!' });
 * ```
 */
export async function subset(
  fontData: Uint8Array | ArrayBuffer,
  options: SubsetOptions,
): Promise<Uint8Array> {
  const m = getWasm();
  const font = fontData instanceof Uint8Array ? fontData : new Uint8Array(fontData);

  // Collect all unicode codepoints
  const unicodes: number[] = [];
  if (options.text) {
    for (const char of options.text) {
      const cp = char.codePointAt(0);
      if (cp !== undefined) unicodes.push(cp);
    }
  }
  if (options.unicodes) {
    for (const cp of options.unicodes) unicodes.push(cp);
  }

  const glyphIds = options.glyphIds ?? [];

  if (unicodes.length === 0 && glyphIds.length === 0) {
    throw new Error('At least one of text, unicodes, or glyphIds must be provided');
  }

  // Build flags
  let flags = HB_SUBSET_FLAGS_NOTDEF_OUTLINE; // keep .notdef outline by default
  if (options.retainGids) flags |= HB_SUBSET_FLAGS_RETAIN_GIDS;
  if (options.noHinting) flags |= HB_SUBSET_FLAGS_NO_HINTING;

  // Prepare variation axes
  const pinTags: number[][] = [];
  const pinValues: number[] = [];
  const rangeTags: number[][] = [];
  const rangeMins: number[] = [];
  const rangeMaxs: number[] = [];
  const rangeDefs: number[] = [];

  if (options.variationAxes) {
    for (const [tag, value] of Object.entries(options.variationAxes)) {
      const encoded = encodeTag(tag);
      if (typeof value === 'number') {
        pinTags.push(encoded);
        pinValues.push(value);
      } else {
        rangeTags.push(encoded);
        rangeMins.push(value.min ?? -Infinity);
        rangeMaxs.push(value.max ?? Infinity);
        rangeDefs.push(value.default ?? NaN);
      }
    }
  }

  // Prepare tag arrays
  const passthroughTags = (options.passthroughTables ?? []).map(encodeTag);
  const dropTags = (options.dropTables ?? []).map(encodeTag);

  // --- Allocate wasm memory ---
  const allocations: number[] = [];

  function walloc(size: number): number {
    if (size === 0) return 0;
    const ptr = m.malloc(size);
    if (!ptr) throw new Error('wasm malloc failed');
    allocations.push(ptr);
    return ptr;
  }

  function writeTags(tags: number[][], ptr: number): void {
    const view = new Uint8Array(buf(), ptr, tags.length * 4);
    for (let i = 0; i < tags.length; i++) {
      view[i * 4] = tags[i][0];
      view[i * 4 + 1] = tags[i][1];
      view[i * 4 + 2] = tags[i][2];
      view[i * 4 + 3] = tags[i][3];
    }
  }

  try {
    // Font data
    const fontPtr = walloc(font.length);
    new Uint8Array(buf()).set(font, fontPtr);

    // Unicodes array (uint32)
    const unicodesPtr = walloc(unicodes.length * 4);
    new Uint32Array(buf(), unicodesPtr, unicodes.length).set(unicodes);

    // Glyph IDs array (uint32)
    const glyphIdsPtr = walloc(glyphIds.length * 4);
    if (glyphIds.length > 0) {
      new Uint32Array(buf(), glyphIdsPtr, glyphIds.length).set(glyphIds);
    }

    // Passthrough tags (4 bytes each)
    const passthroughPtr = walloc(passthroughTags.length * 4);
    if (passthroughTags.length > 0) writeTags(passthroughTags, passthroughPtr);

    // Drop tags
    const dropPtr = walloc(dropTags.length * 4);
    if (dropTags.length > 0) writeTags(dropTags, dropPtr);

    // Pin axis tags + values
    const pinTagsPtr = walloc(pinTags.length * 4);
    const pinValuesPtr = walloc(pinTags.length * 4);
    if (pinTags.length > 0) {
      writeTags(pinTags, pinTagsPtr);
      new Float32Array(buf(), pinValuesPtr, pinTags.length).set(pinValues);
    }

    // Range axis tags + min/max/def
    const rangeTagsPtr = walloc(rangeTags.length * 4);
    const rangeMinsPtr = walloc(rangeTags.length * 4);
    const rangeMaxsPtr = walloc(rangeTags.length * 4);
    const rangeDefsPtr = walloc(rangeTags.length * 4);
    if (rangeTags.length > 0) {
      writeTags(rangeTags, rangeTagsPtr);
      new Float32Array(buf(), rangeMinsPtr, rangeTags.length).set(rangeMins);
      new Float32Array(buf(), rangeMaxsPtr, rangeTags.length).set(rangeMaxs);
      new Float32Array(buf(), rangeDefsPtr, rangeTags.length).set(rangeDefs);
    }

    // Output pointers (pointer to pointer + size)
    const outDataPtrPtr = walloc(4);
    const outSizePtr = walloc(4);

    // Call subset
    const result = m.hb_wrapper_subset(
      fontPtr, font.length,
      unicodesPtr, unicodes.length,
      glyphIdsPtr, glyphIds.length,
      flags,
      passthroughPtr, passthroughTags.length,
      dropPtr, dropTags.length,
      pinTagsPtr, pinValuesPtr, pinTags.length,
      rangeTagsPtr, rangeMinsPtr, rangeMaxsPtr, rangeDefsPtr, rangeTags.length,
      outDataPtrPtr, outSizePtr,
    );

    if (result !== 0) {
      const msg = ERROR_MESSAGES[result] || `Unknown error (code ${result})`;
      throw new Error(`Subset failed: ${msg}`);
    }

    // Read output — re-read buffer in case memory grew during subset
    const outDataPtr = new Uint32Array(buf(), outDataPtrPtr, 1)[0];
    const outSize = new Uint32Array(buf(), outSizePtr, 1)[0];

    if (!outDataPtr || !outSize) {
      throw new Error('Subset produced empty output');
    }

    // Copy result to a new Uint8Array before freeing
    const output = new Uint8Array(outSize);
    output.set(new Uint8Array(buf(), outDataPtr, outSize));

    // Free the output buffer allocated by C
    m.hb_wrapper_free(outDataPtr);

    return output;
  } finally {
    for (const ptr of allocations) {
      m.free(ptr);
    }
  }
}
