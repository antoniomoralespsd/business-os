// Static demo export uses assetPrefix '.', which makes CSS url() paths relative to the CSS file.
// Rewrite them so fonts resolve from _next/static/css/ → _next/static/media/.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'out/_next/static/css');
for (const f of readdirSync(dir).filter((f) => f.endsWith('.css'))) {
  const p = join(dir, f);
  const s = readFileSync(p, 'utf8').replaceAll('url(_next/static/media/', 'url(../media/').replaceAll('url(./_next/static/media/', 'url(../media/');
  writeFileSync(p, s);
}
console.log('demo export: css asset paths fixed');
