'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const state = { token: '', categories: [], products: [], uploading: false, loading: false, editorVersion: 0, variantSequence: 0, qrSvg: '', qrUrl: '', noticeTimer: null, expiryTimer: null };
  const money = new Intl.NumberFormat('sr-Latn-RS', { maximumFractionDigits: 2 });
  const icons = {
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z"/></svg>',
    delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>',
    save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>'
  };

  function element(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }

  function errorMessage(error) {
    return error && error.message ? error.message : 'Došlo je do greške. Pokušajte ponovo.';
  }

  function notice(message, isError = false) {
    clearTimeout(state.noticeTimer);
    $('notice').textContent = message;
    $('notice').classList.toggle('error', isError);
    $('notice').hidden = false;
    if (!isError) state.noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 7000);
  }

  function showLogin(message = '') {
    state.token = '';
    state.products = [];
    state.categories = [];
    state.uploading = false;
    state.editorVersion += 1;
    clearTimeout(state.expiryTimer);
    document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
    $('dashboard').hidden = true;
    $('login-screen').hidden = false;
    $('password').value = '';
    $('login-error').textContent = message;
    $('notice').hidden = true;
  }

  async function api(path, { method = 'GET', body, auth = true } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;
      response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', cache: 'no-store', signal: controller.signal });
    } catch (error) {
      throw new Error(error.name === 'AbortError' ? 'Server ne odgovara. Proverite vezu i pokušajte ponovo.' : 'Povezivanje nije uspelo. Proverite internet vezu.');
    } finally { clearTimeout(timeout); }
    let data = {};
    const responseText = await response.text();
    if (responseText) {
      try { data = JSON.parse(responseText); } catch { throw new Error('Server je vratio neočekivan odgovor. Pokušajte ponovo.'); }
    }
    if (!response.ok) {
      if (response.status === 401 && auth) showLogin('Sesija je istekla. Prijavite se ponovo.');
      const message = typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : 'Promena nije sačuvana. Pokušajte ponovo.';
      throw new Error(message);
    }
    return data;
  }

  async function refreshMenu() {
    const menu = await api('/api/admin/menu');
    if (!Array.isArray(menu.categories) || !Array.isArray(menu.products)) throw new Error('Cenovnik nije moguće učitati. Pokušajte ponovo.');
    state.categories = menu.categories;
    state.products = menu.products;
    renderCategoriesSelect();
    renderProducts();
    if ($('category-dialog').open) renderCategoryList();
  }

  function categoryName(id) { return state.categories.find((category) => category.id === id)?.name || 'Bez kategorije'; }

  function renderCategoriesSelect() {
    const previous = $('category-filter').value;
    $('category-filter').replaceChildren(new Option('Sve kategorije', ''));
    state.categories.forEach((category) => $('category-filter').add(new Option(category.name, category.id)));
    if (state.categories.some((category) => category.id === previous)) $('category-filter').value = previous;
  }

  function safeImageUrl(value) {
    if (!value || typeof value !== 'string') return '';
    try {
      const url = new URL(value, location.origin);
      return url.origin === location.origin && ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }

  function actionButton(icon, label, onClick, danger = false) {
    const button = element('button', `icon-button${danger ? ' danger' : ''}`);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = icons[icon];
    button.addEventListener('click', onClick);
    return button;
  }

  function renderProducts() {
    const query = $('search').value.trim().toLocaleLowerCase('sr-Latn');
    const filter = $('category-filter').value;
    const products = state.products.filter((product) => (!filter || product.categoryId === filter) && (!query || `${product.name} ${product.description || ''} ${categoryName(product.categoryId)}`.toLocaleLowerCase('sr-Latn').includes(query))).sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name, 'sr-Latn'));
    $('product-count').textContent = products.length;
    $('product-list').replaceChildren();
    if (!products.length) {
      const empty = element('div', 'empty-state');
      empty.append(element('h3', '', state.products.length ? 'Nema pronađenih proizvoda.' : 'Počnite od prve kafe.'), element('p', '', state.products.length ? 'Pokušajte sa drugim pojmom ili izaberite drugu kategoriju.' : 'Dodajte kategoriju, zatim prvi proizvod u vaš cenovnik.'));
      $('product-list').append(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    products.forEach((product) => {
      const row = element('article', 'product-row');
      const info = element('div', 'product-info');
      const imageUrl = safeImageUrl(product.image);
      if (imageUrl) {
        const img = element('img', 'product-thumb');
        img.src = imageUrl;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', () => { img.replaceWith(element('span', 'product-thumb product-placeholder', 'K')); }, { once: true });
        info.append(img);
      } else info.append(element('span', 'product-thumb product-placeholder', 'K'));
      const infoText = element('div');
      const title = element('h3', '', product.name);
      if (product.featured) {
        const star = element('span', 'product-name-badge', '✦');
        star.title = 'Izdvojen proizvod';
        star.setAttribute('aria-label', 'Izdvojen proizvod');
        title.append(star);
      }
      infoText.append(title, element('p', '', [categoryName(product.categoryId), product.volume].filter(Boolean).join(' · ')));
      info.append(infoText);
      const variants = Array.isArray(product.variants) ? product.variants : [];
      const price = element('div', `product-price${variants.length ? ' product-price-variants' : ''}`);
      if (variants.length) {
        variants.forEach((variant) => {
          const sizePrice = element('span', 'size-price');
          sizePrice.append(element('span', 'size-label', variant.label), element('span', '', money.format(Number(variant.price) || 0)));
          price.append(sizePrice);
        });
      } else price.append(document.createTextNode(money.format(Number(product.price) || 0)));
      price.append(element('small', '', 'RSD'));
      const availability = element('div', `product-availability${product.available ? '' : ' unavailable'}`, product.available ? 'Dostupno' : 'Trenutno nema');
      const actions = element('div', 'product-actions');
      actions.append(actionButton('edit', `Uredi: ${product.name}`, () => openProduct(product)), actionButton('delete', `Obriši: ${product.name}`, (event) => deleteProduct(product, event.currentTarget), true));
      row.append(info, price, availability, actions);
      fragment.append(row);
    });
    $('product-list').append(fragment);
  }

  function showImage(value) {
    const imageUrl = safeImageUrl(value);
    $('image-preview').hidden = !imageUrl;
    if (imageUrl) $('image-preview').src = imageUrl;
    else $('image-preview').removeAttribute('src');
    $('remove-image').hidden = !value;
  }

  function syncVariantEditor() {
    const rows = $('variant-list').children;
    const hasVariants = rows.length > 0;
    $('product-price').disabled = hasVariants;
    $('product-price').required = !hasVariants;
    $('price-help').hidden = !hasVariants;
    $('add-variant').disabled = rows.length >= 6;
    if (hasVariants) $('product-price').value = rows[0].querySelector('.variant-price').value;
  }

  function addVariant(variant = null, focus = true) {
    if ($('variant-list').children.length >= 6) return;
    const row = element('div', 'variant-row');
    const id = `variant-${++state.variantSequence}`;
    const labelField = element('div', 'variant-field');
    const label = element('label', '', 'Veličina');
    label.htmlFor = `${id}-label`;
    const labelInput = element('input', 'variant-label');
    labelInput.id = label.htmlFor;
    labelInput.maxLength = 20;
    labelInput.required = true;
    labelInput.placeholder = ['S', 'M', 'L'][$('variant-list').children.length] || 'Veličina';
    labelInput.value = variant?.label || '';
    labelField.append(label, labelInput);
    const priceField = element('div', 'variant-field');
    const priceLabel = element('label', '', 'Cena (RSD)');
    priceLabel.htmlFor = `${id}-price`;
    const priceInput = element('input', 'variant-price');
    priceInput.id = priceLabel.htmlFor;
    priceInput.type = 'text';
    priceInput.inputMode = 'decimal';
    priceInput.maxLength = 12;
    priceInput.required = true;
    priceInput.placeholder = '190';
    priceInput.value = variant ? String(variant.price) : ($('variant-list').children.length ? '' : $('product-price').value);
    priceInput.addEventListener('input', syncVariantEditor);
    priceField.append(priceLabel, priceInput);
    const remove = actionButton('delete', 'Ukloni veličinu', () => {
      row.remove();
      syncVariantEditor();
      $('add-variant').focus();
    }, true);
    row.append(labelField, priceField, remove);
    $('variant-list').append(row);
    syncVariantEditor();
    if (focus) labelInput.focus();
  }

  function parsePrice(input) {
    const value = input.value.trim();
    if (!/^\d+(?:[,.]\d{1,2})?$/.test(value) || Number(value.replace(',', '.')) > 1000000) {
      input.focus();
      throw new Error('Unesite ispravnu cenu između 0 i 1.000.000 RSD, sa najviše dve decimale.');
    }
    return Number(value.replace(',', '.'));
  }

  function readVariants() {
    const usedLabels = new Set();
    return Array.from($('variant-list').children).map((row) => {
      const input = row.querySelector('.variant-label');
      const label = input.value.trim();
      const key = label.toLocaleLowerCase('sr-Latn');
      if (!label || label.length > 20 || usedLabels.has(key)) {
        input.focus();
        throw new Error('Svaka veličina mora imati jedinstven naziv, do 20 znakova.');
      }
      usedLabels.add(key);
      return { label, price: parsePrice(row.querySelector('.variant-price')) };
    });
  }

  function openProduct(product = null) {
    if (!state.categories.length) {
      notice('Najpre dodajte kategoriju za vaš proizvod.');
      openCategories();
      return;
    }
    $('product-form').reset();
    state.editorVersion += 1;
    $('product-error').textContent = '';
    $('upload-status').textContent = '';
    $('product-dialog-title').textContent = product ? 'Uredi proizvod' : 'Novi proizvod';
    $('product-id').value = product?.id || '';
    $('product-category').replaceChildren();
    state.categories.forEach((category) => $('product-category').add(new Option(category.name, category.id)));
    $('product-name').value = product?.name || '';
    $('product-category').value = product?.categoryId || $('category-filter').value || state.categories[0].id;
    $('product-price').value = product ? String(product.price) : '';
    $('variant-list').replaceChildren();
    (Array.isArray(product?.variants) ? product.variants : []).forEach((variant) => addVariant(variant, false));
    syncVariantEditor();
    $('product-description').value = product?.description || '';
    $('product-volume').value = product?.volume || '';
    $('product-order').value = product?.order || 0;
    $('product-available').checked = product ? Boolean(product.available) : true;
    $('product-featured').checked = Boolean(product?.featured);
    $('product-image').value = product?.image || '';
    showImage(product?.image || '');
    state.uploading = false;
    $('product-photo').disabled = false;
    $('save-product').disabled = false;
    $('save-product').textContent = 'Sačuvaj proizvod';
    $('product-dialog').showModal();
  }

  async function deleteProduct(product, button) {
    if (!confirm(`Obrisati proizvod „${product.name}”? Ova promena će odmah biti vidljiva u javnom meniju.`)) return;
    button.disabled = true;
    let saved = false;
    try {
      await api(`/api/admin/products/${encodeURIComponent(product.id)}`, { method: 'DELETE' });
      saved = true;
      await refreshMenu();
      notice('Proizvod je obrisan.');
    } catch (error) { notice(saved ? 'Proizvod je obrisan, ali novi prikaz nije učitan. Prijavite se ponovo da biste osvežili cenovnik.' : errorMessage(error), true); }
    finally { button.disabled = false; }
  }

  function openCategories() {
    $('category-error').textContent = '';
    $('new-category-name').value = '';
    renderCategoryList();
    $('category-dialog').showModal();
  }

  function renderCategoryList() {
    $('category-list').replaceChildren();
    if (!state.categories.length) $('category-list').append(element('p', 'category-empty', 'Još nema kategorija. Dodajte prvu iznad.'));
    state.categories.forEach((category) => {
      const row = element('div', 'category-row');
      const input = element('input');
      input.value = category.name;
      input.maxLength = 80;
      input.setAttribute('aria-label', `Naziv kategorije: ${category.name}`);
      const count = state.products.filter((product) => product.categoryId === category.id).length;
      const countLabel = element('span', 'category-count', count);
      countLabel.title = `${count} proizvoda`;
      const save = actionButton('save', `Sačuvaj kategoriju: ${category.name}`, async () => {
        const name = input.value.trim();
        if (!name) { $('category-error').textContent = 'Unesite naziv kategorije.'; input.focus(); return; }
        save.disabled = true;
        await categoryMutation(`/api/admin/categories/${encodeURIComponent(category.id)}`, 'PUT', { name }, 'Naziv kategorije je sačuvan.');
        save.disabled = false;
      });
      const remove = actionButton('delete', `Obriši kategoriju: ${category.name}`, async () => {
        if (count) { $('category-error').textContent = 'Kategorija sadrži proizvode. Premestite ih u drugu kategoriju ili ih obrišite pre uklanjanja kategorije.'; return; }
        if (!confirm(`Obrisati kategoriju „${category.name}”?`)) return;
        remove.disabled = true;
        await categoryMutation(`/api/admin/categories/${encodeURIComponent(category.id)}`, 'DELETE', undefined, 'Kategorija je obrisana.');
        remove.disabled = false;
      }, true);
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); save.click(); } });
      row.append(input, countLabel, save, remove);
      $('category-list').append(row);
    });
  }

  async function categoryMutation(path, method, body, message) {
    $('category-error').textContent = '';
    let saved = false;
    try {
      await api(path, { method, body });
      saved = true;
      await refreshMenu();
      notice(message);
      return true;
    } catch (error) {
      $('category-error').textContent = saved ? 'Promena je sačuvana, ali osvežavanje nije uspelo. Zatvorite i ponovo otvorite prijavu da biste učitali cenovnik.' : errorMessage(error);
      return false;
    }
  }

  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.loading) return;
    state.loading = true;
    $('login-error').textContent = '';
    $('login-submit').disabled = true;
    $('login-submit').textContent = 'Prijavljivanje…';
    try {
      const result = await api('/api/auth/login', { method: 'POST', auth: false, body: { username: $('username').value.trim(), password: $('password').value } });
      if (!result.token || typeof result.token !== 'string') throw new Error('Prijava nije uspela. Pokušajte ponovo.');
      state.token = result.token;
      await refreshMenu();
      $('password').value = '';
      $('login-screen').hidden = true;
      $('dashboard').hidden = false;
      $('search').value = '';
      $('category-filter').value = '';
      renderProducts();
      const expiration = typeof result.expiresAt === 'number' ? (result.expiresAt < 1e12 ? result.expiresAt * 1000 : result.expiresAt) : Date.parse(result.expiresAt);
      if (Number.isFinite(expiration)) state.expiryTimer = setTimeout(() => showLogin('Sesija je istekla. Prijavite se ponovo.'), Math.max(0, expiration - Date.now()));
      $('new-product').focus();
      if (!$('qr-url').value) $('qr-url').value = new URL('/meni', location.origin).href;
      generateQr();
    } catch (error) { showLogin(errorMessage(error)); }
    finally { state.loading = false; $('login-submit').disabled = false; $('login-submit').textContent = 'Prijavi se ↗'; }
  });

  $('logout').addEventListener('click', async () => {
    $('logout').disabled = true;
    try { await api('/api/auth/logout', { method: 'POST' }); }
    catch { /* The local session is always cleared, even if the server is unavailable. */ }
    finally { showLogin(); $('logout').disabled = false; $('username').focus(); }
  });

  $('new-product').addEventListener('click', () => openProduct());
  $('add-variant').addEventListener('click', () => addVariant());
  $('manage-categories').addEventListener('click', openCategories);
  $('search').addEventListener('input', renderProducts);
  $('category-filter').addEventListener('change', renderProducts);
  document.querySelectorAll('.close-dialog').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));

  $('product-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.uploading || $('save-product').disabled) return;
    $('product-error').textContent = '';
    let variants, price;
    try {
      variants = readVariants();
      price = variants.length ? variants[0].price : parsePrice($('product-price'));
    } catch (error) { $('product-error').textContent = errorMessage(error); return; }
    const order = Number($('product-order').value);
    if (!Number.isInteger(order) || order < 0 || order > 9999) { $('product-error').textContent = 'Redosled mora biti ceo broj od 0 do 9999.'; $('product-order').focus(); return; }
    const product = { name: $('product-name').value.trim(), categoryId: $('product-category').value, price, variants, description: $('product-description').value.trim(), volume: $('product-volume').value.trim(), order, image: $('product-image').value, available: $('product-available').checked, featured: $('product-featured').checked };
    if (!product.name || !product.categoryId) { $('product-error').textContent = 'Unesite naziv i izaberite kategoriju.'; return; }
    const id = $('product-id').value;
    $('save-product').disabled = true;
    $('save-product').textContent = 'Čuvanje…';
    let saved = false;
    try {
      await api(id ? `/api/admin/products/${encodeURIComponent(id)}` : '/api/admin/products', { method: id ? 'PUT' : 'POST', body: product });
      saved = true;
      await refreshMenu();
      $('product-dialog').close();
      notice(id ? 'Izmene proizvoda su sačuvane.' : 'Novi proizvod je dodat u cenovnik.');
    } catch (error) {
      if (saved) { $('product-dialog').close(); notice('Proizvod je sačuvan, ali novi prikaz nije učitan. Prijavite se ponovo da biste osvežili cenovnik.', true); }
      else $('product-error').textContent = errorMessage(error);
    } finally { $('save-product').disabled = false; $('save-product').textContent = 'Sačuvaj proizvod'; }
  });

  $('product-photo').addEventListener('change', async () => {
    const file = $('product-photo').files[0];
    if (!file) return;
    $('product-error').textContent = '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { $('product-error').textContent = 'Izaberite JPG, PNG ili WebP fotografiju.'; $('product-photo').value = ''; return; }
    if (file.size > 3 * 1024 * 1024) { $('product-error').textContent = 'Fotografija je prevelika. Najveća dozvoljena veličina je 3 MB.'; $('product-photo').value = ''; return; }
    state.uploading = true;
    $('save-product').disabled = true;
    $('product-photo').disabled = true;
    $('upload-status').textContent = 'Otpremanje fotografije…';
    const editorVersion = state.editorVersion;
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Fotografiju nije moguće pročitati. Izaberite je ponovo.'));
        reader.readAsDataURL(file);
      });
      const result = await api('/api/admin/uploads', { method: 'POST', body: { data: dataUrl.split(',')[1], mimeType: file.type } });
      if (!safeImageUrl(result.url)) throw new Error('Server nije vratio ispravnu adresu fotografije.');
      if (!$('product-dialog').open || state.editorVersion !== editorVersion) return;
      $('product-image').value = result.url;
      showImage(result.url);
      $('upload-status').textContent = 'Fotografija je otpremljena. Sačuvajte proizvod da biste objavili izmenu.';
    } catch (error) { if (state.editorVersion === editorVersion) { $('product-error').textContent = errorMessage(error); $('upload-status').textContent = ''; } }
    finally { if (state.editorVersion === editorVersion) { state.uploading = false; $('save-product').disabled = false; $('product-photo').disabled = false; } }
  });

  $('remove-image').addEventListener('click', () => { $('product-image').value = ''; $('product-photo').value = ''; $('upload-status').textContent = ''; showImage(''); });

  $('category-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('new-category-name').value.trim();
    if (!name) { $('category-error').textContent = 'Unesite naziv nove kategorije.'; return; }
    $('add-category').disabled = true;
    const success = await categoryMutation('/api/admin/categories', 'POST', { name }, 'Nova kategorija je dodata.');
    if (success) $('new-category-name').value = '';
    $('add-category').disabled = false;
  });

  function menuUrl() {
    let url;
    try { url = new URL($('qr-url').value.trim()); }
    catch { throw new Error('Unesite celu adresu sajta, na primer https://vas-domen.rs/meni.'); }
    const local = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/i.test(url.hostname) || url.hostname.endsWith('.local');
    if (url.username || url.password || url.search || url.hash || !['/', '/meni', '/meni/'].includes(url.pathname)) throw new Error('Koristite samo javnu adresu sajta sa putanjom /meni, bez dodatnih parametara.');
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('Javna adresa menija treba da počinje sa https://.');
    url.pathname = '/meni';
    return { url: url.href, local };
  }

  function generateQr() {
    state.qrSvg = '';
    state.qrUrl = '';
    $('download-qr').disabled = true;
    $('qr-preview').replaceChildren();
    try {
      const { url, local } = menuUrl();
      if (typeof qrcode !== 'function') throw new Error('QR generator nije učitan. Osvežite stranicu i pokušajte ponovo.');
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      state.qrSvg = qr.createSvgTag({ cellSize: 6, margin: 24, scalable: true });
      state.qrUrl = url;
      $('qr-url').value = url;
      $('qr-preview').innerHTML = state.qrSvg;
      $('qr-preview').querySelector('svg')?.setAttribute('aria-hidden', 'true');
      $('download-qr').disabled = false;
      $('qr-status').classList.toggle('warning', local);
      $('qr-status').textContent = local ? 'Ovo je lokalna adresa za pregled. Za štampu QR koda unesite konačan javni domen, dostupan telefonima gostiju.' : 'Pre štampe testirajte QR kod telefonom i proverite da javna adresa otvara vaš meni.';
      return true;
    } catch (error) { $('qr-status').textContent = errorMessage(error); $('qr-status').classList.add('warning'); return false; }
  }

  $('qr-form').addEventListener('submit', (event) => { event.preventDefault(); generateQr(); });
  $('qr-url').addEventListener('input', () => { state.qrSvg = ''; state.qrUrl = ''; $('download-qr').disabled = true; $('qr-preview').replaceChildren(); $('qr-status').textContent = 'Kliknite „Napravi QR” da biste primenili novu adresu.'; $('qr-status').classList.remove('warning'); });
  $('download-qr').addEventListener('click', () => {
    if (!state.qrSvg) return;
    const objectUrl = URL.createObjectURL(new Blob([state.qrSvg], { type: 'image/svg+xml;charset=utf-8' }));
    const link = element('a');
    link.href = objectUrl;
    link.download = 'kuca-kafe-meni-qr.svg';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  });

  $('copy-menu-link').addEventListener('click', async () => {
    if (!state.qrUrl && !generateQr()) return;
    const url = state.qrUrl;
    try {
      await navigator.clipboard.writeText(url);
      notice('Link javnog menija je kopiran.');
    } catch { notice(`Link menija: ${url}. Kopirajte ovu adresu za QR kod.`, true); }
  });
})();
