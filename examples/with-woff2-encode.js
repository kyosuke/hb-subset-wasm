/**
 * Example: Subset a font and then encode it as WOFF2.
 *
 * This shows how to compose hb-subset-wasm with woff2-encode-wasm.
 * Install both packages:
 *   npm install hb-subset-wasm woff2-encode-wasm
 */
import { readFile, writeFile } from 'node:fs/promises';
import { init as initSubset, subset } from 'hb-subset-wasm';
// import { init as initWoff2, encode } from 'woff2-encode-wasm';

async function main() {
  // Initialize both wasm modules with raw bytes
  const subsetWasm = await readFile('node_modules/hb-subset-wasm/dist/hb-subset.wasm');
  await initSubset(subsetWasm);
  // const woff2Wasm = await readFile('node_modules/woff2-encode-wasm/dist/encoder.wasm');
  // await initWoff2(woff2Wasm);

  // Read the source font
  const fontData = await readFile('MyFont.ttf');

  // Subset to only the characters we need
  const subsetData = await subset(fontData, {
    text: 'The quick brown fox jumps over the lazy dog',
    noHinting: true, // smaller output
  });

  console.log(`Original: ${fontData.length} bytes`);
  console.log(`Subset:   ${subsetData.length} bytes`);

  // Encode as WOFF2 (uncomment when woff2-encode-wasm is installed)
  // const woff2Data = await encode(subsetData);
  // console.log(`WOFF2:    ${woff2Data.length} bytes`);
  // await writeFile('MyFont.subset.woff2', woff2Data);

  // Or just save the subset TTF
  await writeFile('MyFont.subset.ttf', subsetData);
}

main().catch(console.error);
