import { readFile, writeFile, mkdir, rename, lstat, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This is an explicit one-time import. Stop the app before running it so its
// in-memory menu cannot overwrite the imported catalog on the next admin edit.
if (!process.argv.includes('--server-stopped')) {
  throw new Error('Prvo zaustavite server, pa pokrenite: node scripts/import-menu.mjs --server-stopped');
}

const root = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const dataDir = path.join(root, '.local');
const menuFile = path.join(dataDir, 'menu.json');
const backupDir = path.join(dataDir, 'backups');

async function rejectLink(file) {
  try {
    if ((await lstat(file)).isSymbolicLink()) throw new Error(`Uvoz ne koristi simboličke veze: ${file}`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

for (const target of [dataDir, menuFile, backupDir]) {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Putanja uvoza mora biti unutar projekta.');
  await rejectLink(target);
}

const catalog = JSON.parse(await readFile(path.join(root, 'data', 'menu-catalog.json'), 'utf8'));
if (catalog.demo !== false || !Array.isArray(catalog.categories) || !Array.isArray(catalog.products)) throw new Error('Katalog nije ispravan.');
const categoryIds = new Set(catalog.categories.map(category => category.id));
const productIds = new Set();
const validPrice = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000000 && Math.abs(Math.round(value * 100) - value * 100) < 0.000001;
for (const product of catalog.products) {
  if (productIds.has(product.id) || !categoryIds.has(product.categoryId) || !product.name || !validPrice(product.price) || !Array.isArray(product.variants) || product.variants.length > 6) throw new Error(`Neispravan proizvod: ${product.id}`);
  const labels = product.variants.map(variant => variant.label?.trim().toLocaleLowerCase('sr'));
  if (new Set(labels).size !== labels.length || product.variants.some(variant => typeof variant.label !== 'string' || !variant.label.trim() || variant.label.length > 20 || !validPrice(variant.price))) throw new Error(`Neispravne veličine: ${product.id}`);
  if (product.variants.length && product.price !== product.variants[0].price) throw new Error(`Osnovna cena ne odgovara prvoj veličini: ${product.id}`);
  productIds.add(product.id);
}

await mkdir(dataDir, { recursive: true, mode: 0o700 });
let previous;
try { previous = await readFile(menuFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (previous) {
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `menu-before-import-${timestamp}-${randomUUID()}.json`);
  await writeFile(backupFile, previous, { flag: 'wx', mode: 0o600 });
  console.log(`Prethodni meni je sačuvan: ${backupFile}`);
}
const temporary = path.join(dataDir, `menu-import-${randomUUID()}.tmp`);
await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
await rename(temporary, menuFile);
console.log(`Uvezeno: ${catalog.products.length} proizvoda, ${catalog.categories.length} kategorija. Sada možete ponovo pokrenuti server.`);
