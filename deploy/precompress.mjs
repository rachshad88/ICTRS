// Writes .br (Brotli 11) and .gz (gzip 9) copies next to each text file in a frontend build, so
// nginx (brotli_static / gzip_static in nginx-itrs.conf) can send them without compressing on
// every request. Called by deploy-frontend.sh:  node deploy/precompress.mjs <build dir>
// Fonts and images are skipped (already compressed), as is anything that would not get smaller.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node precompress.mjs <build dir>');
  process.exit(1);
}

const TEXT = /\.(js|mjs|css|html|svg|json|webmanifest|txt|xml)$/;
const MIN_BYTES = 256;

function* files(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (TEXT.test(name)) yield p;
  }
}

let raw = 0;
let br = 0;
let count = 0;
for (const f of files(dir)) {
  const data = readFileSync(f);
  if (data.length < MIN_BYTES) continue;
  const b = brotliCompressSync(data, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
    },
  });
  const g = gzipSync(data, { level: 9 });
  if (b.length < data.length) writeFileSync(f + '.br', b);
  if (g.length < data.length) writeFileSync(f + '.gz', g);
  raw += data.length;
  br += Math.min(b.length, data.length);
  count++;
}

const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`Pre-compressed ${count} files: ${kb(raw)} -> ${kb(br)} with Brotli.`);
