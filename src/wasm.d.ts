/**
 * Pre-compiled WebAssembly module for hb-subset.
 *
 * In Cloudflare Workers, import this directly:
 * ```ts
 * import wasmModule from 'hb-subset-wasm/wasm';
 * await init(wasmModule);
 * ```
 */
type RuntimeWasmModule =
  typeof globalThis extends { WebAssembly: { Module: infer ModuleType } }
    ? ModuleType
    : unknown;

declare const wasmModule: RuntimeWasmModule;
export default wasmModule;
