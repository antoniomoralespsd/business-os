// Static demo export uses assetPrefix '.', which makes CSS url() paths relative to the CSS file.
// Rewrite them so fonts resolve from _next/static/css/ → _next/static/media/.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'out/_next/static/css');
for (const f of readdirSync(dir).filter((f) => f.endsWith('.css'))) {
  const p = join(dir, f);
  const s = readFileSync(p, 'utf8').replace(/url\((?:\.\/)?(?:a\/)?_next\/static\/media\//g, 'url(../media/');
  writeFileSync(p, s);
}
console.log('demo export: css asset paths fixed');

// The publisher rejects a literal U+FFFD; inside JS strings/regexes the � escape is equivalent.
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
for (const p of walk(join(process.cwd(), 'out/_next/static')).filter((f) => f.endsWith('.js'))) {
  const s = readFileSync(p, 'utf8');
  if (s.includes('�')) writeFileSync(p, s.replaceAll('�', '\\ufffd'));
}
console.log('demo export: U+FFFD escaped');
