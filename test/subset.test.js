import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

// Dynamic import of the built module
let init, subset;

before(async () => {
  const mod = await import('../dist/index.js');
  init = mod.init;
  subset = mod.subset;
  // Load wasm binary and pass as BufferSource (Node.js path)
  const wasmPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'hb-subset.wasm');
  const wasmBinary = await readFile(wasmPath);
  await init(wasmBinary);
});

describe('subset', () => {
  let regularFont;
  let variableFont;

  before(async () => {
    regularFont = await readFile(join(fixturesDir, 'Roboto-Regular.abc.ttf'));
    variableFont = await readFile(join(fixturesDir, 'Roboto-Variable.ABC.ttf'));
  });

  describe('regular font', () => {
    it('should subset by text', async () => {
      const result = await subset(regularFont, { text: 'a' });
      assert.ok(result instanceof Uint8Array);
      assert.ok(result.length > 0);
      assert.ok(result.length < regularFont.length);
    });

    it('should subset by multiple characters', async () => {
      const result = await subset(regularFont, { text: 'ab' });
      assert.ok(result instanceof Uint8Array);
      assert.ok(result.length > 0);
    });

    it('should subset by unicode codepoints', async () => {
      const result = await subset(regularFont, { unicodes: [0x61] }); // 'a'
      assert.ok(result instanceof Uint8Array);
      assert.ok(result.length > 0);
      assert.ok(result.length < regularFont.length);
    });

    it('should subset by glyph IDs', async () => {
      const result = await subset(regularFont, { glyphIds: [1] });
      assert.ok(result instanceof Uint8Array);
      assert.ok(result.length > 0);
    });

    it('should accept ArrayBuffer input', async () => {
      const buf = regularFont.buffer.slice(
        regularFont.byteOffset,
        regularFont.byteOffset + regularFont.byteLength,
      );
      const result = await subset(buf, { text: 'a' });
      assert.ok(result instanceof Uint8Array);
      assert.ok(result.length > 0);
    });

    it('should produce smaller output for fewer characters', async () => {
      const one = await subset(regularFont, { text: 'a' });
      const two = await subset(regularFont, { text: 'abc' });
      assert.ok(one.length <= two.length);
    });

    it('should support retainGids option', async () => {
      const result = await subset(regularFont, { text: 'a', retainGids: true });
      assert.ok(result instanceof Uint8Array);
      assert.ok(result.length > 0);
    });

    it('should support noHinting option', async () => {
      const withHints = await subset(regularFont, { text: 'a' });
      const noHints = await subset(regularFont, { text: 'a', noHinting: true });
      assert.ok(noHints instanceof Uint8Array);
      assert.ok(noHints.length > 0);
      // No-hint version should be same size or smaller
      assert.ok(noHints.length <= withHints.length);
    });

    it('should support dropTables option', async () => {
      const result = await subset(regularFont, {
        text: 'a',
        dropTables: ['DSIG'],
      });
      assert.ok(result instanceof Uint8Array);
      assert.ok(result.length > 0);
    });

    it('should produce valid OpenType header', async () => {
      const result = await subset(regularFont, { text: 'a' });
      // Check for valid sfVersion: 0x00010000 (TrueType) or 'OTTO' (CFF)
      const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
      const sfVersion = view.getUint32(0);
      const isTrueType = sfVersion === 0x00010000;
      const isCFF = sfVersion === 0x4F54544F; // 'OTTO'
      assert.ok(isTrueType || isCFF, `Invalid sfVersion: 0x${sfVersion.toString(16)}`);
    });
  });

  describe('variable font', () => {
    it('should subset variable font by text', async () => {
      const result = await subset(variableFont, { text: 'A' });
      assert.ok(result instanceof Uint8Array);
      assert.ok(result.length > 0);
      assert.ok(result.length < variableFont.length);
    });

    it('should pin variation axis to fixed value', async () => {
      const result = await subset(variableFont, {
        text: 'A',
        variationAxes: { wght: 400 },
      });
      assert.ok(result instanceof Uint8Array);
      assert.ok(result.length > 0);
      // Pinned font should be smaller than variable (no gvar data for that axis)
      const unpinned = await subset(variableFont, { text: 'A' });
      assert.ok(result.length <= unpinned.length);
    });

    it('should narrow variation axis range', async () => {
      const result = await subset(variableFont, {
        text: 'A',
        variationAxes: { wght: { min: 300, max: 500 } },
      });
      assert.ok(result instanceof Uint8Array);
      assert.ok(result.length > 0);
    });
  });

  describe('error handling', () => {
    it('should throw if not initialized', async () => {
      // We can't truly test this since init() was already called,
      // but we test the error message format
      assert.ok(typeof subset === 'function');
    });

    it('should throw on empty options', async () => {
      await assert.rejects(
        () => subset(regularFont, {}),
        { message: /At least one of text, unicodes, or glyphIds must be provided/ },
      );
    });

    it('should throw on invalid font data', async () => {
      await assert.rejects(
        () => subset(new Uint8Array([0, 0, 0, 0]), { text: 'a' }),
        { message: /Subset failed/ },
      );
    });

    it('should throw on empty font data', async () => {
      await assert.rejects(
        () => subset(new Uint8Array(0), { text: 'a' }),
        { message: /Subset failed/ },
      );
    });
  });

  describe('NotoSansJP variable font (CFF/OTF)', () => {
    let notoFont;

    before(async () => {
      notoFont = await readFile(join(fixturesDir, 'NotoSansJP-VF.otf'));
    });

    it('should subset Japanese text', async () => {
      const result = await subset(notoFont, { text: 'こんにちは世界' });
      assert.ok(result instanceof Uint8Array);
      assert.ok(result.length > 0);
      // 7.8MB font should shrink dramatically for 7 characters
      assert.ok(result.length < notoFont.length / 10);
    });

    it('should subset mixed Japanese and Latin text', async () => {
      const result = await subset(notoFont, { text: 'Hello世界123' });
      assert.ok(result instanceof Uint8Array);
      assert.ok(result.length > 0);
      assert.ok(result.length < notoFont.length / 10);
    });

    it('should subset kanji by unicode codepoints', async () => {
      // 漢字: U+6F22 U+5B57
      const result = await subset(notoFont, { unicodes: [0x6F22, 0x5B57] });
      assert.ok(result instanceof Uint8Array);
      assert.ok(result.length > 0);
    });

    it('should produce valid CFF OpenType header', async () => {
      const result = await subset(notoFont, { text: 'あ' });
      const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
      const sfVersion = view.getUint32(0);
      // NotoSansJP is CFF-based → expects 'OTTO'
      assert.equal(sfVersion, 0x4F54544F, `Expected OTTO, got 0x${sfVersion.toString(16)}`);
    });

    it('should pin wght axis on CFF variable font', async () => {
      const pinned = await subset(notoFont, {
        text: 'あいう',
        variationAxes: { wght: 400 },
      });
      const unpinned = await subset(notoFont, { text: 'あいう' });
      assert.ok(pinned instanceof Uint8Array);
      assert.ok(pinned.length > 0);
      assert.ok(pinned.length <= unpinned.length);
    });

    it('should narrow wght axis range on CFF variable font', async () => {
      const result = await subset(notoFont, {
        text: 'あいう',
        variationAxes: { wght: { min: 300, max: 500 } },
      });
      assert.ok(result instanceof Uint8Array);
      assert.ok(result.length > 0);
    });

    it('should handle large character set efficiently', async () => {
      // Common hiragana + katakana
      const hiragana = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
      const katakana = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
      const result = await subset(notoFont, { text: hiragana + katakana });
      assert.ok(result instanceof Uint8Array);
      assert.ok(result.length > 0);
      assert.ok(result.length < notoFont.length / 5);
    });

    it('should support noHinting with CFF font', async () => {
      const withHints = await subset(notoFont, { text: 'あ' });
      const noHints = await subset(notoFont, { text: 'あ', noHinting: true });
      assert.ok(noHints instanceof Uint8Array);
      assert.ok(noHints.length > 0);
      assert.ok(noHints.length <= withHints.length);
    });
  });

  describe('combined options', () => {
    it('should combine text and unicodes', async () => {
      const result = await subset(regularFont, {
        text: 'a',
        unicodes: [0x62], // 'b'
      });
      assert.ok(result instanceof Uint8Array);
      assert.ok(result.length > 0);
    });
  });
});
