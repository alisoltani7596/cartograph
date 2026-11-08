// Copies the OCR engine and English language data into public/ocr so the app can
// self-host them (no third-party CDN). Runs before dev and build.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const out = join(process.cwd(), 'public', 'ocr');
mkdirSync(out, { recursive: true });
const tjs = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(require.resolve('tesseract.js-core/package.json'));
const eng = require('@tesseract.js-data/eng');
const files = [
  [join(tjs, 'dist', 'worker.min.js'), 'worker.min.js'],
  [join(core, 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [join(core, 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [join(core, 'tesseract-core-relaxedsimd-lstm.wasm.js'), 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  [join(eng.langPath, 'eng.traineddata.gz'), 'eng.traineddata.gz'],
];
for (const [src, name] of files) {
  if (!existsSync(src)) throw new Error(`missing ${src}`);
  cpSync(src, join(out, name));
}
console.log(`OCR assets copied to ${out}`);
