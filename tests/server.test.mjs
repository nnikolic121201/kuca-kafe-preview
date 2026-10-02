import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server.mjs';

const CREDENTIALS = { username: 'test-owner', password: 'Test-only_very-strong-password_2026' };

async function fixture(options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'kuca-kafe-test-'));
  const dataDir = path.join(directory, 'data');
  const publicDir = path.join(directory, 'public');
  await mkdir(publicDir);
  await writeFile(path.join(publicDir, 'index.html'), '<h1>Test javna stranica</h1>');
  await writeFile(path.join(publicDir, 'admin.html'), '<h1>Test prijava</h1>');
  let server;
  let base;
  async function start() {
    server = await createApp({ dataDir, publicDir, credentials: CREDENTIALS, ...options });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    const done = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await done;
  }
  await start();
  async function request(route, { method = 'GET', data, token, origin, headers = {} } = {}) {
    const response = await fetch(`${base}${route}`, {
      method,
      signal: AbortSignal.timeout(5000),
      headers: { ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}), ...headers },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
      redirect: 'manual',
    });
    const contentType = response.headers.get('content-type') || '';
    const result = contentType.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, headers: response.headers, body: result };
  }
  async function login() {
    const result = await request('/api/auth/login', { method: 'POST', data: CREDENTIALS });
    assert.equal(result.status, 200);
    assert.match(result.body.token, /^[A-Za-z0-9_-]{43}$/);
    return result.body.token;
  }
  return { request, login, dataDir, async restart() { await stop(); await start(); }, async close() { await stop(); await rm(directory, { recursive: true, force: true }); } };
}

test('public pages and menu do not create cookies and protect private files', async () => {
  const app = await fixture();
  try {
  for (const route of ['/', '/meni', '/o-nama', '/lokacija', '/privatnost']) {
    const result = await app.request(route);
    assert.equal(result.status, 200);
    assert.match(result.body, /Test javna/);
    assert.equal(result.headers.get('set-cookie'), null);
    assert.match(result.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  }
  const menu = await app.request('/api/menu');
  assert.equal(menu.status, 200);
  assert.equal(menu.body.demo, false);
  assert.equal(menu.body.categories.length, 11);
  assert.equal(menu.body.products.length, 65);
  assert.equal(menu.body.products.find(product => product.id === 'espresso').price, 130);
  assert.deepEqual(menu.body.products.find(product => product.id === 'cappuccino').variants, [{ label: 'S', price: 180 }, { label: 'M', price: 210 }, { label: 'L', price: 230 }]);
  assert.ok(menu.body.products.every(product => product.description === '' && Array.isArray(product.variants)));
  assert.equal(menu.headers.get('cache-control'), 'no-store');
  for (const route of ['/.local/account.json', '/%2e%2e%2fdata/account.json', '/uploads/%2e%2e%2faccount.json', '/server.mjs', '/package.json', '/.env', '/api/missing']) {
    const result = await app.request(route);
    assert.equal(result.status, 404, route);
    assert.doesNotMatch(JSON.stringify(result.body), /passwordHash|Test-only/);
  }
  assert.match((await app.request('/upravljanje')).headers.get('x-robots-tag'), /noindex/);
  } finally { await app.close(); }
});

test('backend requires authorization and validates login; logout revokes token', async () => {
  const app = await fixture();
  try {
  const denied = await app.request('/api/admin/products', { method: 'POST', data: { name: 'Unauthorized' } });
  assert.equal(denied.status, 401);
  assert.equal((await app.request('/api/admin/menu')).status, 401);
  const badPassword = await app.request('/api/auth/login', { method: 'POST', data: { ...CREDENTIALS, password: 'incorrect' } });
  const badUsername = await app.request('/api/auth/login', { method: 'POST', data: { ...CREDENTIALS, username: 'nobody' } });
  assert.equal(badPassword.status, 401);
  assert.deepEqual(badPassword.body, badUsername.body);
  const token = await app.login();
  const session = await app.request('/api/auth/session', { token });
  assert.equal(session.body.username, CREDENTIALS.username);
  assert.ok(session.body.expiresAt > Date.now());
  assert.equal(session.headers.get('set-cookie'), null);
  assert.equal((await app.request('/api/admin/menu', { token })).status, 200);
  assert.equal((await app.request('/api/auth/logout', { method: 'POST', token })).status, 200);
  assert.equal((await app.request('/api/auth/session', { token })).status, 401);
  const storedAccount = JSON.parse(await readFile(path.join(app.dataDir, 'account.json'), 'utf8'));
  assert.equal(storedAccount.password, undefined);
  assert.equal(storedAccount.passwordHash.length, 128);
  assert.doesNotMatch(JSON.stringify(storedAccount), /Test-only/);
  } finally { await app.close(); }
});

test('CRUD persists products, categories and demo settings through restart', async () => {
  const app = await fixture();
  try {
  let token = await app.login();
  const createdCategory = await app.request('/api/admin/categories', { method: 'POST', token, data: { name: 'Posebna ponuda' } });
  assert.equal(createdCategory.status, 201);
  const category = createdCategory.body.category;
  const createdProduct = await app.request('/api/admin/products', { method: 'POST', token, data: { name: 'Test kafa', categoryId: category.id, price: 250.5, description: 'Probni opis', volume: '200 ml' } });
  assert.equal(createdProduct.status, 201);
  const product = createdProduct.body.product;
  assert.equal(product.available, true);
  assert.equal((await app.request(`/api/admin/categories/${category.id}`, { method: 'DELETE', token })).status, 409);
  assert.equal((await app.request(`/api/admin/products/${product.id}`, { method: 'PUT', token, data: { price: 275, available: false, featured: true } })).status, 200);
  assert.equal((await app.request(`/api/admin/categories/${category.id}`, { method: 'PUT', token, data: { name: 'Sezonski napici' } })).status, 200);
  assert.equal((await app.request('/api/admin/settings', { method: 'PUT', token, data: { demo: false } })).status, 200);
  await app.restart();
  assert.equal((await app.request('/api/auth/session', { token })).status, 401);
  const persisted = (await app.request('/api/menu')).body;
  assert.equal(persisted.demo, false);
  assert.equal(persisted.categories.find(item => item.id === category.id).name, 'Sezonski napici');
  assert.equal(persisted.products.find(item => item.id === product.id).price, 275);
  assert.equal(persisted.products.find(item => item.id === product.id).available, false);
  token = await app.login();
  assert.equal((await app.request(`/api/admin/products/${product.id}`, { method: 'DELETE', token })).status, 200);
  assert.equal((await app.request(`/api/admin/categories/${category.id}`, { method: 'DELETE', token })).status, 200);
  assert.equal((await app.request(`/api/admin/products/${product.id}`, { method: 'PUT', token, data: { price: 300 } })).status, 404);
  } finally { await app.close(); }
});

test('serialized writes retain concurrent product updates', async () => {
  const app = await fixture();
  try {
  const token = await app.login();
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => app.request('/api/admin/products', { method: 'POST', token, data: { name: `Kafa ${index}`, categoryId: 'kafa', price: 200 + index } })));
  assert.ok(results.every(result => result.status === 201));
  const menu = (await app.request('/api/menu')).body;
  assert.equal(menu.products.length, 73);
  assert.equal(new Set(menu.products.map(item => item.id)).size, 73);
  const disk = JSON.parse(await readFile(path.join(app.dataDir, 'menu.json'), 'utf8'));
  assert.equal(disk.products.length, 73);
  } finally { await app.close(); }
});

test('invalid product data, duplicate categories and cross-origin writes are rejected', async () => {
  const app = await fixture();
  try {
  const token = await app.login();
  const valid = { name: 'Test', categoryId: 'kafa', price: 200 };
  for (const data of [{ ...valid, price: -1 }, { ...valid, price: '200' }, { ...valid, price: 1.234 }, { ...valid, categoryId: 'missing' }, { ...valid, name: '' }, { ...valid, image: 'https://example.com/track.png' }, { ...valid, available: 'yes' }, { ...valid, order: -1 }, { ...valid, id: 'override' }]) {
    assert.equal((await app.request('/api/admin/products', { method: 'POST', token, data })).status, 400);
  }
  assert.equal((await app.request('/api/admin/categories', { method: 'POST', token, data: { name: 'KAFE' } })).status, 409);
  assert.equal((await app.request('/api/admin/settings', { method: 'PUT', token, data: { demo: 'false' } })).status, 400);
  assert.equal((await app.request('/api/admin/settings', { method: 'PUT', token, origin: 'https://evil.example', data: { demo: false } })).status, 403);
  assert.equal((await app.request('/api/auth/login', { method: 'POST', origin: 'https://evil.example', data: CREDENTIALS })).status, 403);
  assert.equal((await app.request('/api/admin/products', { method: 'POST', token, data: valid, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await app.request('/api/menu')).body.products.length, 65);
  } finally { await app.close(); }
});

test('size prices normalize base price, survive partial updates and restart, and can return to a single price', async () => {
  const app = await fixture();
  try {
    let token = await app.login();
    const variants = [{ label: ' S ', price: 190 }, { label: 'M', price: 220.5 }, { label: 'L', price: 240 }];
    const updated = await app.request('/api/admin/products/cappuccino', { method: 'PUT', token, data: { variants } });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.product.price, 190);
    assert.equal(updated.body.product.variants[0].label, 'S');
    const renamed = await app.request('/api/admin/products/cappuccino', { method: 'PUT', token, data: { name: 'Cappuccino novo', featured: false } });
    assert.equal(renamed.status, 200);
    assert.deepEqual(renamed.body.product.variants, updated.body.product.variants);
    await app.restart();
    const persisted = (await app.request('/api/menu')).body.products.find(product => product.id === 'cappuccino');
    assert.equal(persisted.price, 190);
    assert.equal(persisted.name, 'Cappuccino novo');
    assert.deepEqual(persisted.variants, updated.body.product.variants);
    const disk = JSON.parse(await readFile(path.join(app.dataDir, 'menu.json'), 'utf8'));
    assert.deepEqual(disk.products.find(product => product.id === 'cappuccino'), persisted);
    token = await app.login();
    const single = await app.request('/api/admin/products/cappuccino', { method: 'PUT', token, data: { variants: [], price: 230 } });
    assert.equal(single.status, 200);
    assert.equal(single.body.product.price, 230);
    assert.deepEqual(single.body.product.variants, []);
    const created = await app.request('/api/admin/products', { method: 'POST', token, data: { name: 'Napitak po veličini', categoryId: 'kafa', variants: [{ label: 'Mala', price: 250 }, { label: 'Velika', price: 350 }] } });
    assert.equal(created.status, 201);
    assert.equal(created.body.product.price, 250);
  } finally { await app.close(); }
});

test('invalid size labels and prices cannot corrupt or partly overwrite the saved product', async () => {
  const app = await fixture();
  try {
    const token = await app.login();
    const original = (await app.request('/api/menu')).body.products.find(product => product.id === 'cappuccino');
    const invalidVariants = [
      null, {}, 'S',
      [{ label: 'S', price: 200 }, { label: ' s ', price: 210 }],
      [{ label: '', price: 200 }],
      [{ label: 'x'.repeat(21), price: 200 }],
      [{ label: 'S', price: -1 }],
      [{ label: 'S', price: '200' }],
      [{ label: 'S', price: 1.234 }],
      [{ label: 'S', price: 1000001 }],
      [{ label: 'S', price: 200, unexpected: true }],
      [null],
      Array.from({ length: 7 }, (_, index) => ({ label: String(index), price: 200 })),
    ];
    for (const variants of invalidVariants) {
      const result = await app.request('/api/admin/products/cappuccino', { method: 'PUT', token, data: { name: 'Should not persist', variants } });
      assert.equal(result.status, 400, JSON.stringify(variants));
    }
    const current = (await app.request('/api/menu')).body.products.find(product => product.id === 'cappuccino');
    assert.deepEqual(current, original);
    const disk = JSON.parse(await readFile(path.join(app.dataDir, 'menu.json'), 'utf8'));
    assert.deepEqual(disk.products.find(product => product.id === 'cappuccino'), original);
  } finally { await app.close(); }
});

test('upload checks authorization, size, type and signature; stores and serves local image', async () => {
  const app = await fixture();
  try {
  const token = await app.login();
  const image = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' };
  assert.equal((await app.request('/api/admin/uploads', { method: 'POST', data: image })).status, 401);
  assert.equal((await app.request('/api/admin/uploads', { method: 'POST', token, data: { mimeType: 'image/svg+xml', data: Buffer.from('<svg></svg>').toString('base64') } })).status, 400);
  assert.equal((await app.request('/api/admin/uploads', { method: 'POST', token, data: { mimeType: 'image/png', data: Buffer.from('<script>alert(1)</script>').toString('base64') } })).status, 400);
  assert.equal((await app.request('/api/admin/uploads', { method: 'POST', token, data: { ...image, data: 'not base64!!!' } })).status, 400);
  assert.equal((await app.request('/api/admin/uploads', { method: 'POST', token, data: { ...image, data: Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64') } })).status, 400);
  const uploaded = await app.request('/api/admin/uploads', { method: 'POST', token, data: image });
  assert.equal(uploaded.status, 201);
  assert.match(uploaded.body.url, /^\/uploads\/[a-f0-9-]+\.png$/);
  const fetched = await app.request(uploaded.body.url);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.headers.get('content-type'), 'image/png');
  const saved = await app.request('/api/admin/products/espresso', { method: 'PUT', token, data: { image: uploaded.body.url } });
  assert.equal(saved.status, 200);
  } finally { await app.close(); }
});

test('sessions expire and repeated login failures are rate-limited', async () => {
  const app = await fixture({ sessionTtlMs: 25, maxLoginAttempts: 3 });
  try {
  const token = await app.login();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal((await app.request('/api/auth/session', { token })).status, 401);
  for (let attempt = 0; attempt < 3; attempt += 1) assert.equal((await app.request('/api/auth/login', { method: 'POST', data: { ...CREDENTIALS, password: 'wrong' } })).status, 401);
  const blocked = await app.request('/api/auth/login', { method: 'POST', data: CREDENTIALS });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  } finally { await app.close(); }
});
