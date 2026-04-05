// WebAssembly types for non-DOM environments
declare namespace WebAssembly {
  class Module {
    constructor(bytes: BufferSource);
  }
  class Instance {
    readonly exports: Record<string, unknown>;
    constructor(module: Module, importObject?: Imports);
  }
  interface WebAssemblyInstantiatedSource {
    instance: Instance;
    module: Module;
  }
  class Memory {
    readonly buffer: ArrayBuffer;
    grow(delta: number): number;
  }
  type Imports = Record<string, Record<string, unknown>>;
  function instantiate(
    bytes: BufferSource,
    importObject?: Imports,
  ): Promise<WebAssemblyInstantiatedSource>;
  function instantiate(
    module: Module,
    importObject?: Imports,
  ): Promise<Instance>;
  function instantiateStreaming(
    response: Response | Promise<Response>,
    importObject?: Imports,
  ): Promise<WebAssemblyInstantiatedSource>;
  function compile(bytes: BufferSource): Promise<Module>;
}

// Response type for non-DOM environments
// BufferSource for non-DOM environments
type BufferSource = ArrayBufferView | ArrayBuffer;

// Response type for non-DOM environments
declare class Response {
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  clone(): Response;
}
