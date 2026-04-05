import { init, subset } from '../../dist/index.js';
import wasmModule from '../../dist/hb-subset.wasm';

const ready = init(wasmModule);
const MAX_FONT_BYTES = 10 * 1024 * 1024;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function readFontData(request) {
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      throw httpError(400, 'Invalid Content-Length header');
    }
    if (contentLength > MAX_FONT_BYTES) {
      throw httpError(413, `Font payload exceeds ${MAX_FONT_BYTES} bytes`);
    }
  }

  const fontData = new Uint8Array(await request.arrayBuffer());
  if (fontData.length === 0) {
    throw httpError(400, 'Font payload must not be empty');
  }
  if (fontData.length > MAX_FONT_BYTES) {
    throw httpError(413, `Font payload exceeds ${MAX_FONT_BYTES} bytes`);
  }

  return fontData;
}

function errorResponse(error) {
  const status = typeof error?.status === 'number' ? error.status : 500;
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ ok: false, error: message }, { status });
}

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
        const fontData = await readFontData(request);
        const text = url.searchParams.get('text') || 'Hello';
        const result = await subset(fontData, { text });
        return Response.json({
          ok: true,
          inputSize: fontData.length,
          outputSize: result.length,
          ratio: (result.length / fontData.length * 100).toFixed(1) + '%',
        });
      } catch (e) {
        return errorResponse(e);
      }
    }

    if (path === '/subset/varfont') {
      try {
        const fontData = await readFontData(request);
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
        return errorResponse(e);
      }
    }

    return new Response('Not found', { status: 404 });
  },
};
