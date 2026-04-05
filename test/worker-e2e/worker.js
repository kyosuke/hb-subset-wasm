import { init, subset } from '../../dist/index.js';
import wasmModule from '../../dist/hb-subset.wasm';

const ready = init(wasmModule);

export default {
  async fetch(request) {
    await ready;

    const url = new URL(request.url);
    const path = url.pathname;

    // Read font from request body or use built-in test
    if (path === '/health') {
      return new Response('ok');
    }

    if (path === '/subset') {
      try {
        const fontData = new Uint8Array(await request.arrayBuffer());
        const text = url.searchParams.get('text') || 'Hello';
        const result = await subset(fontData, { text });
        return Response.json({
          ok: true,
          inputSize: fontData.length,
          outputSize: result.length,
          ratio: (result.length / fontData.length * 100).toFixed(1) + '%',
        });
      } catch (e) {
        return Response.json({ ok: false, error: e.message }, { status: 500 });
      }
    }

    if (path === '/subset/varfont') {
      try {
        const fontData = new Uint8Array(await request.arrayBuffer());
        const text = url.searchParams.get('text') || 'ABC';
        const pinWght = url.searchParams.get('wght');
        const options = { text };
        if (pinWght) {
          options.variationAxes = { wght: parseFloat(pinWght) };
        }
        const result = await subset(fontData, options);
        return Response.json({
          ok: true,
          inputSize: fontData.length,
          outputSize: result.length,
          pinnedWght: pinWght || null,
        });
      } catch (e) {
        return Response.json({ ok: false, error: e.message }, { status: 500 });
      }
    }

    return new Response('Not found', { status: 404 });
  },
};
