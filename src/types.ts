/**
 * Wasm source for initialization.
 *
 * - `WebAssembly.Module` — pre-compiled module (Cloudflare Workers)
 * - `ArrayBuffer | ArrayBufferView` — raw .wasm bytes (Node.js, Deno)
 * - `Response | Promise<Response>` — fetch() response (browser)
 */
export interface ResponseLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  clone?(): ResponseLike;
}

type RuntimeWebAssemblyModule =
  typeof globalThis extends { WebAssembly: { Module: infer ModuleType } }
    ? ModuleType
    : never;

type RuntimeResponse =
  typeof globalThis extends { Response: infer ResponseType }
    ? ResponseType
    : ResponseLike;

export type WasmSource =
  | RuntimeWebAssemblyModule
  | ArrayBuffer
  | ArrayBufferView
  | RuntimeResponse
  | Promise<RuntimeResponse>;

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
  /**
   * Layout feature tags to retain in the subset.
   *
   * By default HarfBuzz drops some features (e.g. `palt`, `mark`, `vert`).
   *
   * - `'*'` — retain all layout features (nothing is dropped).
   * - `string[]` — add specific tags to the default retained set.
   *   Example: `['palt', 'mark']`
   * - `undefined` — keep HarfBuzz default behavior.
   */
  layoutFeatures?: '*' | string[];
}
