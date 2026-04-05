import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { init, subset } from '../dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const wasmBinary = await readFile(join(__dirname, '../dist/hb-subset.wasm'));
  await init(wasmBinary);

  const regularFont = await readFile(join(__dirname, '../test/fixtures/Roboto-Regular.abc.ttf'));
  const variableFont = await readFile(join(__dirname, '../test/fixtures/Roboto-Variable.ABC.ttf'));

  const iterations = 1000;

  // Warm up
  await subset(regularFont, { text: 'a' });
  await subset(variableFont, { text: 'A' });

  // Benchmark regular font
  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await subset(regularFont, { text: 'ab' });
  }
  let elapsed = performance.now() - start;
  console.log(`Regular font subset (${iterations} iterations): ${elapsed.toFixed(1)}ms (${(elapsed / iterations).toFixed(3)}ms/op)`);

  // Benchmark variable font
  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await subset(variableFont, { text: 'AB' });
  }
  elapsed = performance.now() - start;
  console.log(`Variable font subset (${iterations} iterations): ${elapsed.toFixed(1)}ms (${(elapsed / iterations).toFixed(3)}ms/op)`);

  // Benchmark variable font with axis pinning
  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await subset(variableFont, { text: 'AB', variationAxes: { wght: 400 } });
  }
  elapsed = performance.now() - start;
  console.log(`Variable font subset + pin wght (${iterations} iterations): ${elapsed.toFixed(1)}ms (${(elapsed / iterations).toFixed(3)}ms/op)`);
}

main().catch(console.error);
