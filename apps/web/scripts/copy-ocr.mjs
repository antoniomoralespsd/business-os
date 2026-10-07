// Copies the OCR engine and Spanish language data into public/ocr so photos are read
// without depending on third-party CDNs. Runs before dev/build (public/ocr is gitignored).
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'ocr');
mkdirSync(out, { recursive: true });
const tjs = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(createRequire(join(tjs, 'package.json')).resolve('tesseract.js-core/package.json'));
const spa = dirname(require.resolve('@tesseract.js-data/spa/package.json'));
copyFileSync(join(tjs, 'dist', 'worker.min.js'), join(out, 'worker.min.js'));
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js']) copyFileSync(join(core, f), join(out, f));
copyFileSync(join(spa, '4.0.0_best_int', 'spa.traineddata.gz'), join(out, 'spa.traineddata.gz'));
console.log('ocr: engine and Spanish data copied to public/ocr');
