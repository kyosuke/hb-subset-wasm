/**
 * Pre-compiled WebAssembly module for hb-subset.
 *
 * In Cloudflare Workers, import this directly:
 * ```ts
 * import wasmModule from 'hb-subset-wasm/wasm';
 * await init(wasmModule);
 * ```
 */
declare const wasmModule: WebAssembly.Module;
export default wasmModule;
