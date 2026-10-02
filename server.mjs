import http from 'node:http';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCallback);
const root = path.dirname(fileURLToPath(import.meta.url));
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const INITIAL_MENU = JSON.parse(await readFile(path.join(root, 'data', 'menu-catalog.json'), 'utf8'));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, file);
}

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Očekivan je JSON objekat.');
  return value;
}

function fields(value, allowed) {
  object(value);
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new HttpError(400, 'Zahtev sadrži nepodržano polje.');
}

function textValue(value, label, maximum, required = false) {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new HttpError(400, `Neispravno polje: ${label}.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new HttpError(400, `Unesite polje: ${label}.`);
  return trimmed;
}

async function body(req, limit = 64 * 1024) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Pošaljite JSON podatke.');
  if (Number(req.headers['content-length']) > limit) throw new HttpError(413, 'Podaci su preveliki.');
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw new HttpError(413, 'Podaci su preveliki.');
    chunks.push(chunk);
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'JSON podaci nisu ispravni.'); }
}

function validatePrice(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000 || Math.abs(Math.round(value * 100) - value * 100) > 0.000001) throw new HttpError(400, 'Cena mora biti broj između 0 i 1.000.000, sa najviše dve decimale.');
  return value;
}

function validateProduct(input, menu, existing) {
  fields(input, ['categoryId', 'name', 'description', 'price', 'variants', 'volume', 'image', 'available', 'featured', 'order']);
  const product = { description: '', volume: '', image: '', variants: [], available: true, featured: false, order: menu.products.length, ...existing, ...input };
  product.name = textValue(product.name, 'naziv', 120, true);
  product.description = textValue(product.description, 'opis', 1000);
  product.volume = textValue(product.volume, 'količina', 40);
  if (!menu.categories.some(category => category.id === product.categoryId)) throw new HttpError(400, 'Izaberite postojeću kategoriju.');
  if (!Array.isArray(product.variants) || product.variants.length > 6) throw new HttpError(400, 'Proizvod može imati najviše šest veličina.');
  const labels = new Set();
  product.variants = product.variants.map(variant => {
    fields(variant, ['label', 'price']);
    const label = textValue(variant.label, 'oznaka veličine', 20, true);
    const key = label.toLocaleLowerCase('sr');
    if (labels.has(key)) throw new HttpError(400, 'Oznake veličina moraju biti različite.');
    labels.add(key);
    return { label, price: validatePrice(variant.price) };
  });
  if (input.price !== undefined) validatePrice(input.price);
  product.price = validatePrice(product.variants.length ? product.variants[0].price : product.price);
  if (typeof product.available !== 'boolean' || typeof product.featured !== 'boolean') throw new HttpError(400, 'Dostupnost i izdvajanje moraju biti da/ne vrednosti.');
  if (!Number.isInteger(product.order) || product.order < 0 || product.order > 100000) throw new HttpError(400, 'Redosled mora biti ceo broj od 0 do 100.000.');
  if (typeof product.image !== 'string' || (product.image !== '' && !/^\/(?:uploads\/[0-9a-f-]+\.(?:jpg|png|webp)|assets\/[a-zA-Z0-9/_-]+\.(?:jpg|jpeg|png|webp|svg|avif))$/.test(product.image))) throw new HttpError(400, 'Fotografija mora biti lokalna slika.');
  return product;
}

function decodeImage(input) {
  fields(input, ['data', 'mimeType']);
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[input.mimeType];
  if (!extension || typeof input.data !== 'string' || !input.data.length || input.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data)) throw new HttpError(400, 'Podržane su JPG, PNG i WebP slike do 3 MB.');
  const buffer = Buffer.from(input.data, 'base64');
  let valid = false;
  if (extension === 'jpg') valid = buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  if (extension === 'png') valid = buffer.length >= 33 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && buffer.toString('ascii', 12, 16) === 'IHDR' && buffer.readUInt32BE(16) > 0 && buffer.readUInt32BE(20) > 0 && buffer.readUInt32BE(16) <= 10000 && buffer.readUInt32BE(20) <= 10000;
  if (extension === 'webp') valid = buffer.length >= 20 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16)) && buffer.readUInt32LE(4) === buffer.length - 8;
  if (!valid || buffer.length > MAX_IMAGE_BYTES) throw new HttpError(400, 'Sadržaj datoteke nije podržana slika.');
  return { extension, buffer };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };

export async function createApp({ dataDir = path.join(root, '.local'), publicDir = path.join(root, 'public'), credentials, sessionTtlMs = 4 * 60 * 60 * 1000, maxLoginAttempts = 8, loginWindowMs = 15 * 60 * 1000, appOrigin = process.env.APP_ORIGIN || '' } = {}) {
  dataDir = path.resolve(dataDir);
  publicDir = path.resolve(publicDir);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await mkdir(path.join(dataDir, 'uploads'), { recursive: true, mode: 0o700 });
  const menuFile = path.join(dataDir, 'menu.json');
  let menu;
  try { menu = JSON.parse(await readFile(menuFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; menu = structuredClone(INITIAL_MENU); await atomicJson(menuFile, menu); }
  if (!Array.isArray(menu.categories) || !Array.isArray(menu.products) || typeof menu.demo !== 'boolean') throw new Error('Lokalna baza menija nije ispravna.');
  const accountFile = path.join(dataDir, 'account.json');
  let account;
  try { account = JSON.parse(await readFile(accountFile, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const username = credentials?.username || 'vlasnik';
    const password = credentials?.password || randomBytes(24).toString('base64url');
    if (password.length < 12 || username.length > 64) throw new Error('Administratorska lozinka mora imati najmanje 12 karaktera.');
    const salt = randomBytes(16).toString('hex');
    account = { username, salt, passwordHash: (await scrypt(password, salt, 64)).toString('hex') };
    await atomicJson(accountFile, account);
    if (!credentials) await writeFile(path.join(dataDir, 'admin-access.txt'), `KUĆA KAFE — PRIVATNI PRISTUP\n\nAdresa: /upravljanje\nKorisničko ime: ${username}\nLozinka: ${password}\n\nČuvajte ove podatke privatno. Ovaj fajl se nikada ne servira kroz sajt.\nNakon bezbednog čuvanja lozinke u upravljaču lozinki, možete ukloniti ovaj fajl.\n`, { mode: 0o600, flag: 'wx' });
  }
  if (typeof account.username !== 'string' || !/^[a-f0-9]{32}$/.test(account.salt) || !/^[a-f0-9]{128}$/.test(account.passwordHash)) throw new Error('Lokalna konfiguracija naloga nije ispravna.');
  const sessions = new Map();
  const attempts = new Map();
  let changes = Promise.resolve();
  function mutate(operation) {
    const next = changes.then(async () => {
      const copy = structuredClone(menu);
      const result = await operation(copy);
      await atomicJson(menuFile, copy);
      menu = copy;
      return result;
    });
    changes = next.catch(() => {});
    return next;
  }

  function authenticate(req) {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
    const token = match?.[1];
    const session = token && sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) { if (token) sessions.delete(token); throw new HttpError(401, 'Prijava je potrebna ili je sesija istekla.'); }
    return { token, ...session };
  }

  async function serveFile(req, res, base, relative) {
    if (relative.split(/[\\/]/).some(segment => segment.startsWith('.')) || relative.includes('\\')) throw new HttpError(404, 'Stranica nije pronađena.');
    const file = path.resolve(base, relative);
    if (!file.startsWith(`${base}${path.sep}`)) throw new HttpError(404, 'Stranica nije pronađena.');
    let info;
    try { info = await stat(file); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new HttpError(404, 'Stranica nije pronađena.'); throw error; }
    if (!info.isFile()) throw new HttpError(404, 'Stranica nije pronađena.');
    const mime = MIME[path.extname(file).toLowerCase()];
    if (!mime) throw new HttpError(404, 'Stranica nije pronađena.');
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': info.size, 'Cache-Control': mime.startsWith('text/html') ? 'no-store' : 'public, max-age=3600' });
    if (req.method === 'HEAD') return res.end();
    res.end(await readFile(file));
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try {
      let url;
      try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch { throw new HttpError(400, 'Neispravna adresa.'); }
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'Neispravna adresa.'); }
      if (pathname.includes('\0')) throw new HttpError(400, 'Neispravna adresa.');
      const method = req.method;
      if (!['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(method)) throw new HttpError(405, 'Metod nije podržan.');
      if (['POST', 'PUT', 'DELETE'].includes(method)) {
        const expected = appOrigin || `${req.socket.encrypted ? 'https:' : 'http:'}//${req.headers.host}`;
        if ((req.headers.origin && req.headers.origin !== expected) || req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Zahtev sa drugog sajta nije dozvoljen.');
      }
      if (pathname === '/api/menu' && method === 'GET') return json(res, 200, menu);
      if (pathname === '/api/auth/login' && method === 'POST') {
        const ip = req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
        const entry = attempts.get(ip) || { count: 0, until: now + loginWindowMs };
        if (entry.count >= maxLoginAttempts) { res.setHeader('Retry-After', Math.ceil((entry.until - now) / 1000)); throw new HttpError(429, 'Previše pokušaja. Pokušajte ponovo kasnije.'); }
        entry.count += 1;
        attempts.set(ip, entry);
        const input = await body(req);
        fields(input, ['username', 'password']);
        if (typeof input.username !== 'string' || typeof input.password !== 'string' || input.username.length > 64 || input.password.length > 1024) throw new HttpError(401, 'Korisničko ime ili lozinka nisu ispravni.');
        const derived = await scrypt(input.password, account.salt, 64);
        const correct = timingSafeEqual(derived, Buffer.from(account.passwordHash, 'hex'));
        if (!correct || input.username !== account.username) throw new HttpError(401, 'Korisničko ime ili lozinka nisu ispravni.');
        attempts.delete(ip);
        for (const [token, session] of sessions) if (session.expiresAt <= now) sessions.delete(token);
        if (sessions.size >= 20) sessions.delete(sessions.keys().next().value);
        const token = randomBytes(32).toString('base64url');
        const expiresAt = Date.now() + sessionTtlMs;
        sessions.set(token, { username: account.username, expiresAt });
        return json(res, 200, { token, expiresAt });
      }
      if (pathname === '/api/auth/session' && method === 'GET') { const session = authenticate(req); return json(res, 200, { username: session.username, expiresAt: session.expiresAt }); }
      if (pathname === '/api/auth/logout' && method === 'POST') { const session = authenticate(req); sessions.delete(session.token); return json(res, 200, { ok: true }); }
      if (pathname.startsWith('/api/admin/')) {
        authenticate(req);
        if (pathname === '/api/admin/menu' && method === 'GET') return json(res, 200, menu);
        if (pathname === '/api/admin/settings' && method === 'PUT') {
          const input = await body(req);
          fields(input, ['demo']);
          if (typeof input.demo !== 'boolean') throw new HttpError(400, 'Demo postavka mora biti da/ne vrednost.');
          await mutate(next => { next.demo = input.demo; });
          return json(res, 200, { demo: menu.demo });
        }
        if (pathname === '/api/admin/uploads' && method === 'POST') {
          const { extension, buffer } = decodeImage(await body(req, Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1024));
          const name = `${randomUUID()}.${extension}`;
          await writeFile(path.join(dataDir, 'uploads', name), buffer, { flag: 'wx', mode: 0o600 });
          return json(res, 201, { url: `/uploads/${name}` });
        }
        if (pathname === '/api/admin/products' && method === 'POST') {
          const input = await body(req);
          const product = await mutate(next => { if (next.products.length >= 500) throw new HttpError(400, 'Najviše 500 proizvoda je podržano.'); const created = { ...validateProduct(input, next), id: `p_${randomUUID()}` }; next.products.push(created); return created; });
          return json(res, 201, { product });
        }
        const productRoute = /^\/api\/admin\/products\/([a-zA-Z0-9_-]+)$/.exec(pathname);
        if (productRoute && ['PUT', 'DELETE'].includes(method)) {
          const input = method === 'PUT' ? await body(req) : null;
          const product = await mutate(next => {
            const index = next.products.findIndex(item => item.id === productRoute[1]);
            if (index < 0) throw new HttpError(404, 'Proizvod nije pronađen.');
            if (method === 'DELETE') { next.products.splice(index, 1); return null; }
            next.products[index] = validateProduct(input, next, next.products[index]);
            return next.products[index];
          });
          return json(res, 200, method === 'DELETE' ? { ok: true } : { product });
        }
        if (pathname === '/api/admin/categories' && method === 'POST') {
          const input = await body(req);
          fields(input, ['name']);
          const name = textValue(input.name, 'naziv kategorije', 80, true);
          const category = await mutate(next => { if (next.categories.length >= 40) throw new HttpError(400, 'Najviše 40 kategorija je podržano.'); if (next.categories.some(item => item.name.toLocaleLowerCase('sr') === name.toLocaleLowerCase('sr'))) throw new HttpError(409, 'Kategorija sa tim nazivom već postoji.'); const created = { id: `c_${randomUUID()}`, name }; next.categories.push(created); return created; });
          return json(res, 201, { category });
        }
        const categoryRoute = /^\/api\/admin\/categories\/([a-zA-Z0-9_-]+)$/.exec(pathname);
        if (categoryRoute && ['PUT', 'DELETE'].includes(method)) {
          const input = method === 'PUT' ? await body(req) : null;
          if (input) fields(input, ['name']);
          const category = await mutate(next => {
            const index = next.categories.findIndex(item => item.id === categoryRoute[1]);
            if (index < 0) throw new HttpError(404, 'Kategorija nije pronađena.');
            if (method === 'DELETE') { if (next.products.some(item => item.categoryId === categoryRoute[1])) throw new HttpError(409, 'Prvo premestite ili obrišite proizvode iz ove kategorije.'); next.categories.splice(index, 1); return null; }
            const name = textValue(input.name, 'naziv kategorije', 80, true);
            if (next.categories.some((item, itemIndex) => itemIndex !== index && item.name.toLocaleLowerCase('sr') === name.toLocaleLowerCase('sr'))) throw new HttpError(409, 'Kategorija sa tim nazivom već postoji.');
            next.categories[index].name = name;
            return next.categories[index];
          });
          return json(res, 200, method === 'DELETE' ? { ok: true } : { category });
        }
      }
      if (pathname.startsWith('/api/')) throw new HttpError(404, 'Putanja nije pronađena.');
      if (!['GET', 'HEAD'].includes(method)) throw new HttpError(405, 'Metod nije podržan.');
      if (pathname.startsWith('/uploads/')) {
        if (!/^\/uploads\/[0-9a-f-]+\.(?:jpg|png|webp)$/.test(pathname)) throw new HttpError(404, 'Slika nije pronađena.');
        return await serveFile(req, res, path.join(dataDir, 'uploads'), pathname.slice('/uploads/'.length));
      }
      if (pathname === '/upravljanje' || pathname === '/upravljanje/' || pathname === '/admin.html') { res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive'); return await serveFile(req, res, publicDir, 'admin.html'); }
      const publicRoutes = ['/', '/meni', '/o-nama', '/lokacija', '/privatnost'];
      if (publicRoutes.includes(pathname.replace(/\/$/, '') || '/')) return await serveFile(req, res, publicDir, 'index.html');
      return await serveFile(req, res, publicDir, pathname.slice(1));
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      if (!(error instanceof HttpError)) console.error('Server error:', error.message);
      json(res, error.status || 500, { error: error instanceof HttpError ? error.message : 'Došlo je do greške. Pokušajte ponovo.' });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
  const username = process.env.ADMIN_USERNAME || '';
  const password = process.env.ADMIN_PASSWORD || '';
  if (Boolean(username) !== Boolean(password)) throw new Error('Podesite i ADMIN_USERNAME i ADMIN_PASSWORD.');
  const credentials = username ? { username, password } : undefined;
  const appOrigin = process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || '';
  const server = await createApp({ credentials, appOrigin });
  server.listen(port, host, () => {
    console.log(`Kuća kafe je pokrenuta: http://${host}:${port}`);
    console.log('Privatni administratorski pristup: .local/admin-access.txt');
  });
}
