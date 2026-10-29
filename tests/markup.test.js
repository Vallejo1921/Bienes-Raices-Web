import test from 'node:test';
import assert from 'node:assert/strict';

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function read(file) {
  return readFileSync(`${root}/${file}`, 'utf8');
}

function ids(html) {
  return [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
}

function attributeTokens(html, attribute) {
  const values = [];
  const pattern = new RegExp(`\\b${attribute}="([^"]+)"`, 'g');
  for (const match of html.matchAll(pattern)) {
    values.push(...match[1].split(/\s+/).filter(Boolean));
  }
  return values;
}

function javascriptIds(source) {
  const values = [];
  for (const match of source.matchAll(/\b(?:byId|getElementById)\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    values.push(match[1]);
  }
  return values;
}

const productionModules = ['properties-data.js', 'public-app.js', 'admin-app.js'];

test('index.html es sólo UI pública: sin admin, Firebase ni enlaces de despliegue', () => {
  const html = read('index.html');
  assert.match(html, /<script type="module" src="public-app\.js"><\/script>/);
  assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), false, 'no debe haber scripts inline');
  assert.equal(/admin\.html/i.test(html), false, 'no debe enlazar al editor local');
  assert.equal(/DEPLOY/i.test(html), false, 'no debe enlazar documentación de despliegue');
  assert.equal(/firebase|firestore|gstatic/i.test(html), false, 'no debe nombrar Firebase');
  assert.equal(/id="config-banner"|id="protocol-warning"|id="btn-empty-admin"/.test(html), false);
  assert.match(html, /id="btn-empty-retry"/);
  assert.match(html, /id="catalog-grid"/);
});

test('la identidad ADAHRA usa sólo assets locales y dimensiones explícitas', () => {
  const html = read('index.html');
  assert.match(html, /<title>ADAHRA Bienes Raíces/);
  assert.match(html, /name="theme-color" content="#05080E"/);
  assert.match(html, /assets\/favicon\.png/);
  assert.match(html, /assets\/adahra-logo-full\.webp/);
  assert.match(html, /assets\/adahra-mark\.webp/);
  assert.match(html, /src="assets\/adahra-logo-full\.webp"[^>]*width="800"[^>]*height="771"/);
  assert.match(html, /src="assets\/adahra-logo-full\.webp"[^>]*loading="eager"/);
  assert.match(html, /src="assets\/adahra-logo-full\.webp"[^>]*fetchpriority="high"/);
  assert.match(html, /src="assets\/adahra-mark\.webp"[^>]*width="320"[^>]*height="296"/);

  for (const match of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = match[0];
    assert.match(tag, /\bwidth="\d+"/, `img sin width: ${tag}`);
    assert.match(tag, /\bheight="\d+"/, `img sin height: ${tag}`);
    assert.match(tag, /\balt="/, `img sin alt: ${tag}`);
    assert.equal(/\bsrc="https?:/.test(tag), false, `img remota: ${tag}`);
  }
});

test('las fotos originales de WhatsApp no se publican ni se versionan; los derivados sí', () => {
  const ignore = read('.gitignore');
  assert.match(ignore, /^WhatsApp Image \*\.jpeg\s*$/m, '.gitignore debe ignorar las fotos originales de WhatsApp');
  assert.equal(/^!?\s*assets\/?\s*$/m.test(ignore), false, '.gitignore no debe ignorar assets/');

  for (const file of ['index.html', 'admin.html', ...productionModules]) {
    assert.equal(/WhatsApp Image /i.test(read(file)), false, `${file} no debe referenciar fotos originales`);
  }

  for (const asset of [
    'assets/adahra-logo-full.webp',
    'assets/adahra-mark.webp',
    'assets/favicon.png'
  ]) {
    assert.ok(existsSync(`${root}/${asset}`), `falta el derivado versionado ${asset}`);
  }

  const generator = read('scripts/generate-assets.py');
  assert.match(generator, /WhatsApp Image 2026-10-28 at 5\.25\.50 PM\.jpeg/);
  assert.match(generator, /ASSETS = ROOT \/ "assets"/);
});

test('admin.html es un editor local con importación, exportación y estado dirty', () => {
  const html = read('admin.html');
  assert.match(html, /<script type="module" src="admin-app\.js"><\/script>/);
  assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), false, 'no debe haber scripts inline');
  for (const id of [
    'permanent-banner', 'import-input', 'btn-load-current', 'btn-export',
    'dirty-state', 'editor-warning', 'record-body', 'editor-dialog'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `falta #${id}`);
  }
  assert.match(html, /id="import-input"[^>]*type="file"|type="file"[^>]*id="import-input"/);
  assert.match(html, /no escribe en Internet/i);
  assert.equal(/type="password"|id="login-form"|id="auth-panel"|firebase|firestore|gstatic/i.test(html), false);
  assert.equal(/id="admin-workspace"/.test(html), false, 'el panel ya no se oculta tras un login');
});

test('admin.html no conserva restos del panel de autenticación ni de Firebase', () => {
  const html = read('admin.html');
  assert.equal(/auth-panel/.test(html), false, 'no debe quedar #auth-panel');
  assert.equal(/auth-state-line/.test(html), false, 'no debe quedar #auth-state-line');
  assert.equal(/\blogin\b/i.test(html), false, 'no debe quedar ningún login');
  assert.equal(/\bpassword\b|type="password"/i.test(html), false, 'no debe pedir contraseña');
  assert.equal(/firebase|firestore|gstatic/i.test(html), false, 'no debe referenciar Firebase');
  assert.equal(/firebase-config\.js/i.test(html), false, 'no debe cargar firebase-config.js');
});

test('los módulos no inyectan HTML, no evalúan código y no persisten el catálogo', () => {
  for (const file of productionModules) {
    const source = read(file);
    assert.equal(/<script/i.test(source), false, `${file} no debe inyectar scripts`);
    assert.equal(/\binnerHTML\b|\bouterHTML\b|\binsertAdjacentHTML\b/.test(source), false, `${file} no debe usar HTML dinámico`);
    assert.equal(/\beval\s*\(|\bnew\s+Function\s*\(/.test(source), false, `${file} no debe evaluar código dinámico`);
    assert.equal(/firebase|firestore|gstatic\.com/i.test(source), false, `${file} no debe referenciar Firebase`);
  }

  for (const file of ['public-app.js', 'admin-app.js']) {
    const source = read(file);
    assert.equal(/localStorage\.setItem\(['"]adahra-propiedades/.test(source), false, `${file} no debe persistir un catálogo local`);
  }

  assert.match(read('public-app.js'), /createStaticCatalogRepository/);
  assert.match(read('admin-app.js'), /serializeCatalogDocument/);
  assert.match(read('admin-app.js'), /showSaveFilePicker/);
  assert.match(read('admin-app.js'), /beforeunload/);
});

for (const [page, script] of [['index.html', 'public-app.js'], ['admin.html', 'admin-app.js']]) {
  test(`${page} tiene IDs únicos, labels e imports válidos y sin manejadores inline`, () => {
    const html = read(page);
    const pageIds = ids(html);
    assert.equal(new Set(pageIds).size, pageIds.length, `${page} tiene IDs duplicados`);

    for (const target of attributeTokens(html, 'for')) {
      assert.ok(pageIds.includes(target), `${page}: label for="${target}" sin destino`);
    }
    for (const attribute of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
      for (const target of attributeTokens(html, attribute)) {
        assert.ok(pageIds.includes(target), `${page}: ${attribute}="${target}" sin destino`);
      }
    }
    for (const match of html.matchAll(/href="#([^"]+)"/g)) {
      assert.ok(pageIds.includes(match[1]), `${page}: enlace interno #${match[1]} sin destino`);
    }

    const scriptTags = [...html.matchAll(/<script\b([^>]*)><\/script>/g)].map((match) => match[1]);
    assert.equal(scriptTags.length, 1, `${page} debe cargar exactamente un módulo`);
    assert.match(scriptTags[0], /type="module"/);
    const src = /src="([^"]+)"/.exec(scriptTags[0]);
    assert.ok(src, `${page} debe declarar src`);
    assert.equal(src[1], script);
    assert.ok(existsSync(`${root}/${src[1]}`), `${page}: no existe ${src[1]}`);

    assert.equal(/\bon[a-z]+\s*="/i.test(html), false, `${page} no debe usar manejadores inline`);
    assert.equal(/javascript:/i.test(html), false, `${page} no debe usar URLs javascript:`);

    const source = read(script);
    for (const target of javascriptIds(source)) {
      assert.ok(pageIds.includes(target), `${script} usa #${target}, que no existe en ${page}`);
    }
  });
}

test('los imports locales son relativos y ningún HTML carga scripts remotos', () => {
  for (const file of productionModules) {
    const source = read(file);
    for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      assert.ok(match[1].startsWith('.'), `${file}: import no relativo ${match[1]}`);
      assert.ok(existsSync(new URL(match[1], `file://${root}/${file}`)), `${file}: no existe ${match[1]}`);
    }
  }

  for (const page of ['index.html', 'admin.html']) {
    for (const match of read(page).matchAll(/<script[^>]+src="([^"]+)"/g)) {
      assert.equal(/^https?:/.test(match[1]), false, `${page}: no debe cargar scripts remotos`);
    }
  }
});

test('el workflow de Pages usa acciones oficiales, permisos mínimos y Node 22', () => {
  const workflow = read('.github/workflows/pages.yml');
  assert.match(workflow, /branches:\s*\[main, master\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read\s*\n\s*pages:\s*write\s*\n\s*id-token:\s*write/);
  assert.match(workflow, /group:\s*pages/);
  assert.match(workflow, /node-version:\s*22/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build:pages/);
  assert.match(workflow, /path:\s*_site/);

  const uses = [...workflow.matchAll(/uses:\s*([^\s]+)/g)].map((match) => match[1]);
  assert.deepEqual(uses.sort(), [
    'actions/checkout@v4',
    'actions/configure-pages@v5',
    'actions/deploy-pages@v4',
    'actions/setup-node@v4',
    'actions/upload-pages-artifact@v3'
  ].sort());
});

test('los archivos de producción y el workflow no contienen secretos evidentes', () => {
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /"type"\s*:\s*"service_account"/,
    /\bAIza[0-9A-Za-z_-]{20,}\b/,
    /\b(?:password|passwd|secret|token)\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
    /\bghp_[0-9A-Za-z]{20,}\b/,
    /\bgithub_pat_[0-9A-Za-z_]{20,}\b/,
    /\bsk-[0-9A-Za-z]{20,}\b/
  ];
  const files = ['index.html', 'admin.html', ...productionModules, 'start.sh', 'start-admin.sh', '.github/workflows/pages.yml', 'data/properties.json'];
  for (const file of files) {
    const source = read(file);
    for (const pattern of patterns) {
      assert.equal(pattern.test(source), false, `${file}: posible secreto (${pattern})`);
    }
  }
});
