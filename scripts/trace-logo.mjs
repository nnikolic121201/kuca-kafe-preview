// Reproducible vector extraction of the supplied brand artwork, not replacement typography.
// Optional build-only dependencies: npm install --prefix .local/tools potrace pngjs
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../.local/tools/package.json', import.meta.url));
const { PNG } = require('pngjs');
const { trace } = require('potrace');

const original = PNG.sync.read(await fs.readFile(new URL('../public/assets/logo-original.png', import.meta.url)));
const scale = 4;
const width = original.width * scale;
const height = original.height * scale;
const mask = new PNG({ width, height });
function sample(x, y, channel) {
  x = Math.max(0, Math.min(original.width - 1, x));
  y = Math.max(0, Math.min(original.height - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, original.width - 1), y1 = Math.min(y0 + 1, original.height - 1);
  const fx = x - x0, fy = y - y0;
  const at = (px, py) => original.data[(py * original.width + px) * 4 + channel];
  return at(x0, y0) * (1 - fx) * (1 - fy) + at(x1, y0) * fx * (1 - fy) + at(x0, y1) * (1 - fx) * fy + at(x1, y1) * fx * fy;
}
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const sx = x / scale, sy = y / scale;
    const r = sample(sx, sy, 0), g = sample(sx, sy, 1), b = sample(sx, sy, 2);
    // Separate the gold ink from red fabric; exclude the photographed top/right edges.
    const ink = sx > 7 && sx < 160 && sy > 8 && sy < 145 && g > r * 0.76 && g - b > 3;
    const offset = (y * width + x) * 4;
    mask.data[offset] = mask.data[offset + 1] = mask.data[offset + 2] = ink ? 0 : 255;
    mask.data[offset + 3] = 255;
  }
}
const svg = await new Promise((resolve, reject) => trace(PNG.sync.write(mask), {
  threshold: 127, turdSize: 14, alphaMax: 1, optCurve: true, optTolerance: 0.65,
  color: '#c5aa73', background: 'transparent'
}, (error, value) => error ? reject(error) : resolve(value)));
const path = svg.match(/<path[^>]+\/>/g).join('\n').replace(/ transform="[^"]*"/g, '');
const wrap = color => `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="8 10 151 134" role="img" aria-label="Kuća kafe">\n  <title>Kuća kafe</title>\n  <g transform="scale(${1 / scale})">\n${path.replaceAll('#c5aa73', color)}\n  </g>\n</svg>\n`;
await fs.writeFile(new URL('../public/assets/logo.svg', import.meta.url), wrap('#c5aa73'));
await fs.writeFile(new URL('../public/assets/logo-ink.svg', import.meta.url), wrap('#431c29'));
await fs.writeFile(new URL('../public/favicon.svg', import.meta.url), wrap('#c5aa73'));
console.log('Generated gold and burgundy vector brand artwork.');
