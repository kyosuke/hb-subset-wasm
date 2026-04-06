import type { ResponseLike, SubsetOptions, WasmSource } from './types.js';

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
  9: 'Failed to pin variation axis — invalid axis tag for this font',
  10: 'Failed to set variation axis range — invalid axis tag or range',
};

const MAX_UNICODE_CODEPOINT = 0x10FFFF;
const MAX_UINT32 = 0xFFFFFFFF;
const TAG_PATTERN = /^[\x20-\x7E]{4}$/;

type ImportObject = Record<string, Record<string, unknown>>;

interface WasmInstanceLike {
  exports: unknown;
}

interface WasmInstantiateResultLike {
  instance: WasmInstanceLike;
}

interface WebAssemblyLike {
  Module: new (...args: unknown[]) => object;
  instantiate(
    source: ArrayBuffer | ArrayBufferView | object,
    importObject?: ImportObject,
  ): Promise<WasmInstanceLike | WasmInstantiateResultLike>;
  instantiateStreaming?: (
    source: ResponseLike | Promise<ResponseLike>,
    importObject?: ImportObject,
  ) => Promise<WasmInstanceLike | WasmInstantiateResultLike>;
}

interface WasmExports {
  memory: { buffer: ArrayBuffer };
  _initialize?: () => void;
  malloc(size: number): number;
  free(ptr: number): void;
  hb_wrapper_subset(
    fontDataPtr: number, fontSize: number,
    unicodesPtr: number, unicodesLen: number,
    glyphIdsPtr: number, glyphIdsLen: number,
    flags: number,
    passthroughTagsPtr: number, passthroughTagsLen: number,
    dropTagsPtr: number, dropTagsLen: number,
    axisTagsPtr: number, axisValuesPtr: number, axisCount: number,
    axisRangeTagsPtr: number,
    axisRangeMinsPtr: number, axisRangeMaxsPtr: number,
    axisRangeDefsPtr: number, axisRangeCount: number,
    layoutFeatureTagsPtr: number, layoutFeatureTagsLen: number,
    layoutFeaturesAll: number,
    outDataPtrPtr: number, outSizePtr: number,
  ): number;
  hb_wrapper_free(ptr: number): void;
  hb_wrapper_face_get_glyph_count(fontDataPtr: number, fontSize: number): number;
}

let ex: WasmExports | null = null;
let initPromise: Promise<void> | null = null;

function getRuntimeWebAssembly(): WebAssemblyLike {
  const wasm = (globalThis as { WebAssembly?: WebAssemblyLike }).WebAssembly;
  if (!wasm) {
    throw new Error('WebAssembly is not available in this runtime');
  }
  return wasm;
}

/** Wasm import stubs — the standalone module needs only these two. */
function buildImportObject(): ImportObject {
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

function isBinarySource(source: WasmSource): source is ArrayBuffer | ArrayBufferView {
  return source instanceof ArrayBuffer || ArrayBuffer.isView(source);
}

function isWasmModule(source: WasmSource, wasm: WebAssemblyLike): boolean {
  return source instanceof wasm.Module;
}

function hasInstance(
  result: WasmInstanceLike | WasmInstantiateResultLike,
): result is WasmInstantiateResultLike {
  return typeof result === 'object' && result !== null && 'instance' in result;
}

function getInstance(result: WasmInstanceLike | WasmInstantiateResultLike): WasmInstanceLike {
  return hasInstance(result) ? result.instance : result;
}

function assertResponseLike(value: unknown): asserts value is ResponseLike {
  if (!value || typeof value !== 'object' || typeof (value as ResponseLike).arrayBuffer !== 'function') {
    throw new TypeError(
      'init(source) expects a WebAssembly.Module, ArrayBuffer, ArrayBufferView, Response, or Promise<Response>',
    );
  }
}

function finiteNumber(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

function integerInRange(name: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

function validateTag(tag: unknown, field: string): string {
  if (typeof tag !== 'string' || !TAG_PATTERN.test(tag)) {
    throw new TypeError(`${field} must be exactly 4 printable ASCII characters`);
  }
  return tag;
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
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const wasm = getRuntimeWebAssembly();
    const imports = buildImportObject();
    let instance: WasmInstanceLike;

    if (isWasmModule(source, wasm)) {
      // Pre-compiled module (Cloudflare Workers)
      const instantiated = await wasm.instantiate(source, imports);
      instance = getInstance(instantiated);
    } else if (isBinarySource(source)) {
      // Raw bytes (Node.js, Deno)
      const bytes = source instanceof ArrayBuffer
        ? source
        : source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
      const instantiated = await wasm.instantiate(bytes, imports);
      instance = getInstance(instantiated);
    } else {
      // Response or Promise<Response> (browser fetch)
      const response = await source;
      assertResponseLike(response);

      if (typeof wasm.instantiateStreaming === 'function' && typeof response.clone === 'function') {
        try {
          const instantiated = await wasm.instantiateStreaming(response, imports);
          instance = getInstance(instantiated);
        } catch {
          // Fallback if content-type isn't application/wasm
          const buf = await response.clone().arrayBuffer();
          const instantiated = await wasm.instantiate(buf, imports);
          instance = getInstance(instantiated);
        }
      } else {
        const buf = await response.arrayBuffer();
        const instantiated = await wasm.instantiate(buf, imports);
        instance = getInstance(instantiated);
      }
    }

    ex = instance.exports as WasmExports;

    // STANDALONE_WASM reactors need _initialize called once
    if (typeof ex._initialize === 'function') {
      ex._initialize();
    }
  })();

  try {
    await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
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
 * Encode a 4-character OpenType tag string to bytes.
 */
function encodeTag(tag: string): [number, number, number, number] {
  validateTag(tag, 'tag');
  return [
    tag.charCodeAt(0),
    tag.charCodeAt(1),
    tag.charCodeAt(2),
    tag.charCodeAt(3),
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
  if (!options || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  if (options.text !== undefined && typeof options.text !== 'string') {
    throw new TypeError('text must be a string');
  }
  if (options.unicodes !== undefined && !Array.isArray(options.unicodes)) {
    throw new TypeError('unicodes must be an array of integers');
  }
  if (options.glyphIds !== undefined && !Array.isArray(options.glyphIds)) {
    throw new TypeError('glyphIds must be an array of integers');
  }
  if (options.retainGids !== undefined && typeof options.retainGids !== 'boolean') {
    throw new TypeError('retainGids must be a boolean');
  }
  if (options.noHinting !== undefined && typeof options.noHinting !== 'boolean') {
    throw new TypeError('noHinting must be a boolean');
  }
  if (options.passthroughTables !== undefined && !Array.isArray(options.passthroughTables)) {
    throw new TypeError('passthroughTables must be an array of OpenType tags');
  }
  if (options.dropTables !== undefined && !Array.isArray(options.dropTables)) {
    throw new TypeError('dropTables must be an array of OpenType tags');
  }
  if (
    options.variationAxes !== undefined
    && (typeof options.variationAxes !== 'object' || options.variationAxes === null || Array.isArray(options.variationAxes))
  ) {
    throw new TypeError('variationAxes must be an object mapping axis tags to numbers or ranges');
  }
  if (
    options.layoutFeatures !== undefined
    && options.layoutFeatures !== '*'
    && !Array.isArray(options.layoutFeatures)
  ) {
    throw new TypeError("layoutFeatures must be '*' or an array of OpenType tags");
  }

  const m = getWasm();
  const font = fontData instanceof Uint8Array ? fontData : new Uint8Array(fontData);
  if (font.length === 0) {
    throw new RangeError('fontData must not be empty');
  }

  // Collect all unicode codepoints
  const unicodes: number[] = [];
  if (options.text) {
    for (const char of options.text) {
      const cp = char.codePointAt(0);
      if (cp !== undefined) unicodes.push(cp);
    }
  }
  if (options.unicodes) {
    options.unicodes.forEach((cp, index) => {
      unicodes.push(integerInRange(`unicodes[${index}]`, cp, 0, MAX_UNICODE_CODEPOINT));
    });
  }

  const glyphIds = (options.glyphIds ?? []).map((gid, index) =>
    integerInRange(`glyphIds[${index}]`, gid, 0, MAX_UINT32),
  );

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
    for (const [rawTag, rawValue] of Object.entries(options.variationAxes)) {
      const tag = validateTag(rawTag, `variationAxes key "${rawTag}"`);
      const encoded = encodeTag(tag);

      if (typeof rawValue === 'number') {
        pinTags.push(encoded);
        pinValues.push(finiteNumber(`variationAxes.${tag}`, rawValue));
        continue;
      }

      if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
        throw new TypeError(`variationAxes.${tag} must be a finite number or { min?, max?, default? }`);
      }

      const hasMin = rawValue.min !== undefined;
      const hasMax = rawValue.max !== undefined;
      const hasDefault = rawValue.default !== undefined;

      if (!hasMin && !hasMax && !hasDefault) {
        throw new TypeError(`variationAxes.${tag} must specify at least one of min, max, or default`);
      }

      const min = hasMin ? finiteNumber(`variationAxes.${tag}.min`, rawValue.min) : Number.NaN;
      const max = hasMax ? finiteNumber(`variationAxes.${tag}.max`, rawValue.max) : Number.NaN;
      const def = hasDefault ? finiteNumber(`variationAxes.${tag}.default`, rawValue.default) : Number.NaN;

      if (!Number.isNaN(min) && !Number.isNaN(max) && min > max) {
        throw new RangeError(`variationAxes.${tag}.min must be <= variationAxes.${tag}.max`);
      }
      if (!Number.isNaN(def) && !Number.isNaN(min) && def < min) {
        throw new RangeError(`variationAxes.${tag}.default must be >= variationAxes.${tag}.min`);
      }
      if (!Number.isNaN(def) && !Number.isNaN(max) && def > max) {
        throw new RangeError(`variationAxes.${tag}.default must be <= variationAxes.${tag}.max`);
      }

      rangeTags.push(encoded);
      rangeMins.push(min);
      rangeMaxs.push(max);
      rangeDefs.push(def);
    }
  }

  // Prepare tag arrays
  const passthroughTags = (options.passthroughTables ?? []).map((tag, index) =>
    encodeTag(validateTag(tag, `passthroughTables[${index}]`)),
  );
  const dropTags = (options.dropTables ?? []).map((tag, index) =>
    encodeTag(validateTag(tag, `dropTables[${index}]`)),
  );

  // Prepare layout feature tags
  const layoutFeaturesAll = options.layoutFeatures === '*' ? 1 : 0;
  const layoutFeatureTags = (Array.isArray(options.layoutFeatures) ? options.layoutFeatures : []).map(
    (tag, index) => encodeTag(validateTag(tag, `layoutFeatures[${index}]`)),
  );

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

    // Layout feature tags
    const layoutFeaturesPtr = walloc(layoutFeatureTags.length * 4);
    if (layoutFeatureTags.length > 0) writeTags(layoutFeatureTags, layoutFeaturesPtr);

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
      layoutFeaturesPtr, layoutFeatureTags.length, layoutFeaturesAll,
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
