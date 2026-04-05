# hb-subset-wasm

HarfBuzz font subsetting compiled to WebAssembly. Optimized for Cloudflare Workers.

This is an **unofficial** package that wraps HarfBuzz's subset API in a minimal, standalone WebAssembly module. It is designed to be easy to use for common font subsetting tasks.

## Why this exists

- **Not harfbuzzjs** — harfbuzzjs exposes a large, low-level HarfBuzz API. This package exposes only subsetting, with a small high-level API.
- **Cloudflare Workers first** — standalone wasm with no JS glue code, no WASI, no filesystem access, no Node.js-specific imports. Works everywhere.
- **Variable font support** — supports pinning variation axes and narrowing axis ranges.
- **Composable** — output is a standard `Uint8Array` that can be piped into [woff2-encode-wasm](https://www.npmjs.com/package/woff2-encode-wasm) or any other tool.

## Install

```bash
npm install hb-subset-wasm
```

> **Note:** This package is ESM-only.

## Quick start

### Cloudflare Workers

```ts
import { init, subset } from 'hb-subset-wasm';
import wasmModule from 'hb-subset-wasm/wasm';

const ready = init(wasmModule);

export default {
  async fetch(request) {
    await ready;

    const fontData = new Uint8Array(/* fetch from R2, KV, or origin */);
    const result = await subset(fontData, {
      text: 'The characters you need',
    });

    return new Response(result, {
      headers: { 'Content-Type': 'font/sfnt' },
    });
  },
};
```

### Node.js

```ts
import { readFileSync } from 'node:fs';
import { init, subset } from 'hb-subset-wasm';

await init(readFileSync('node_modules/hb-subset-wasm/dist/hb-subset.wasm'));

const fontData = new Uint8Array(/* ... your .ttf or .otf bytes ... */);
const result = await subset(fontData, { text: 'Hello, world!' });
```

## Safety limits for untrusted input

When subsetting user-supplied fonts in a service:

- Enforce a request/body size limit before calling `subset()`.
- Keep memory growth bounded. `scripts/build-wasm.sh` uses `MAXIMUM_MEMORY_BYTES` (default: `268435456`, i.e. 256MiB).
- Apply normal service safeguards (timeouts, rate limits, concurrency limits).

The Worker E2E example includes a 10MiB request-body limit and returns `413` for oversized payloads.

## API

### `init(source): Promise<void>`

Initialize the WebAssembly module. Call once before using `subset()`.

`source` accepts:

| Type | Use case |
|---|---|
| `WebAssembly.Module` | Cloudflare Workers (pre-compiled, fastest startup) |
| `BufferSource` | Node.js / Deno (raw .wasm bytes via `readFileSync`) |
| `Response \| Promise<Response>` | Browser (`fetch()` response, supports streaming compilation) |

### `subset(fontData, options): Promise<Uint8Array>`

Subset a font. Returns the subsetted font as a `Uint8Array`.

| Option | Type | Description |
|---|---|---|
| `text` | `string` | Characters to retain (easiest option) |
| `unicodes` | `number[]` | Unicode codepoints to retain |
| `glyphIds` | `number[]` | Glyph IDs to retain |
| `retainGids` | `boolean` | Preserve original glyph IDs (don't renumber) |
| `noHinting` | `boolean` | Remove hinting instructions (smaller output) |
| `variationAxes` | `Record<string, number \| {min?, max?, default?}>` | Pin or narrow variation axes |
| `passthroughTables` | `string[]` | Table tags to pass through without subsetting |
| `dropTables` | `string[]` | Table tags to drop entirely |

At least one of `text`, `unicodes`, or `glyphIds` must be provided.

## Variable fonts

Pin a variation axis to a fixed value (removes variability, smaller output):

```ts
const result = await subset(fontData, {
  text: 'Hello',
  variationAxes: { wght: 400 },
});
```

Narrow a variation axis range:

```ts
const result = await subset(fontData, {
  text: 'Hello',
  variationAxes: {
    wght: { min: 300, max: 700 },
    wdth: { min: 75, max: 100, default: 100 },
  },
});
```

## Composing with WOFF2 encoding

This package outputs standard TrueType/OpenType font bytes. To convert to WOFF2, pipe the output into a WOFF2 encoder:

```ts
import { readFileSync } from 'node:fs';
import { init as initSubset, subset } from 'hb-subset-wasm';
import { init as initWoff2, encode } from 'woff2-encode-wasm';

await initSubset(readFileSync('node_modules/hb-subset-wasm/dist/hb-subset.wasm'));
await initWoff2(readFileSync('node_modules/woff2-encode-wasm/dist/encoder.wasm'));

const subsetFont = await subset(fontData, { text: 'Hello' });
const woff2Font = await encode(subsetFont);
```

## Performance

On a test machine (Apple Silicon), subsetting a small font takes approximately **0.05ms per operation**. The wasm binary is ~577KB (standalone, no JS glue).

## Limitations

- **WOFF2 encoding is out of scope** — use a separate package like `woff2-encode-wasm`.
- **Single face only** — font collections (TTC) are not supported; only the first face is used.
- **No shaping** — this package only performs subsetting, not text shaping.
- **Axis range narrowing** — fully supported via HarfBuzz's `hb_subset_input_set_axis_range`. Behavior depends on the font's variation data.
- **AAT features** — Apple Advanced Typography tables are not included in the build to reduce binary size.

## HarfBuzz version

Built against HarfBuzz 10.4.0. The HarfBuzz source is included as a git submodule under `deps/harfbuzz`.

## License

MIT (this package). HarfBuzz itself is licensed under the [Old MIT license](https://github.com/harfbuzz/harfbuzz/blob/main/COPYING). See [THIRD_PARTY_NOTICES](./THIRD_PARTY_NOTICES) for full details.
