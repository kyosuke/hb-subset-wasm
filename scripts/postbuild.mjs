// Post-build: copy global.d.ts into dist/ and add triple-slash reference
// so consumers in non-DOM TypeScript environments get the ambient types.

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

// Copy global.d.ts to dist/
copyFileSync('src/global.d.ts', 'dist/global.d.ts');

// Prepend reference to types.d.ts so TS resolves WebAssembly, BufferSource, Response
const typesPath = 'dist/types.d.ts';
const content = readFileSync(typesPath, 'utf8');
const ref = '/// <reference path="global.d.ts" />\n';
if (!content.startsWith(ref)) {
  writeFileSync(typesPath, ref + content);
}
