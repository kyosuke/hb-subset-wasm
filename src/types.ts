/**
 * Wasm source for initialization.
 *
 * - `WebAssembly.Module` — pre-compiled module (Cloudflare Workers)
 * - `BufferSource` — raw .wasm bytes (Node.js, Deno)
 * - `Response | Promise<Response>` — fetch() response (browser)
 */
export type WasmSource =
  | WebAssembly.Module
  | BufferSource
  | Response
  | Promise<Response>;

/**
 * Options for subsetting a font.
 *
 * At least one of `text`, `unicodes`, or `glyphIds` must be provided.
 */
export interface SubsetOptions {
  /** Characters to retain — the simplest way to subset. */
  text?: string;
  /** Unicode codepoints to retain. */
  unicodes?: number[];
  /** Glyph IDs to retain. */
  glyphIds?: number[];
  /** If true, glyph IDs in the output font are preserved (not renumbered). */
  retainGids?: boolean;
  /** If true, hinting instructions are removed (smaller output). */
  noHinting?: boolean;
  /**
   * Variation axes to pin or constrain.
   *
   * - A number pins the axis to a fixed value (removes variability).
   * - An object `{ min?, max?, default? }` narrows the axis range.
   *
   * Example:
   * ```ts
   * variationAxes: {
   *   wght: 400,                    // pin weight to 400
   *   wdth: { min: 75, max: 100 }   // narrow width range
   * }
   * ```
   */
  variationAxes?: Record<string, number | { min?: number; max?: number; default?: number }>;
  /**
   * Table tags to pass through without subsetting.
   * Example: `['GSUB', 'GPOS']`
   */
  passthroughTables?: string[];
  /**
   * Table tags to drop entirely from the output.
   * Example: `['DSIG']`
   */
  dropTables?: string[];
}

/** @internal Raw wasm exports from the standalone module. */
export interface WasmExports {
  memory: WebAssembly.Memory;
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
    outDataPtrPtr: number, outSizePtr: number,
  ): number;
  hb_wrapper_free(ptr: number): void;
  hb_wrapper_face_get_glyph_count(fontDataPtr: number, fontSize: number): number;
}
