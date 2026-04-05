/**
 * Example: Cloudflare Worker that subsets a font on-the-fly.
 *
 * The wasm module is imported as a pre-compiled WebAssembly.Module
 * via Wrangler's CompiledWasm rule — no JS glue, no Node.js imports.
 */
import { init, subset } from 'hb-subset-wasm';
import wasmModule from 'hb-subset-wasm/wasm';

// Initialize once at module scope
const ready = init(wasmModule);

export default {
  async fetch(request) {
    await ready;

    const url = new URL(request.url);
    const text = url.searchParams.get('text') || 'Hello, world!';

    // In a real worker, you'd fetch the font from R2, KV, or an origin
    const fontResponse = await fetch('https://example.com/fonts/MyFont.ttf');
    const fontData = new Uint8Array(await fontResponse.arrayBuffer());

    const subsetFont = await subset(fontData, { text });

    return new Response(subsetFont, {
      headers: {
        'Content-Type': 'font/sfnt',
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  },
};
