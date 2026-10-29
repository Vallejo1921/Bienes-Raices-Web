import test from 'node:test';
import assert from 'node:assert/strict';

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const expected = [
  '.nojekyll',
  'assets/adahra-logo-full.webp',
  'assets/adahra-mark.webp',
  'assets/favicon.png',
  'data/properties.json',
  'index.html',
  'properties-data.js',
  'public-app.js'
];

function walk(directory, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walk(`${directory}/${entry.name}`, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

test('build:pages produce exactamente la allowlist de GitHub Pages', () => {
  const result = spawnSync(process.execPath, ['scripts/build-pages.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `build falló:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /build-pages: OK · 8 archivos/);

  const files = walk(`${root}/_site`);
  assert.deepEqual(files, expected);

  for (const file of files) {
    const info = statSync(`${root}/_site/${file}`);
    assert.equal(info.isFile(), true, `${file} no es archivo`);
    if (file !== '.nojekyll') assert.ok(info.size > 0, `${file} está vacío`);
  }
  assert.deepEqual(
    JSON.parse(readFileSync(`${root}/_site/data/properties.json`, 'utf8')),
    JSON.parse(readFileSync(`${root}/data/properties.json`, 'utf8'))
  );

  for (const forbidden of ['admin.html', 'admin-app.js', 'README.md', 'package.json', 'tests', 'scripts', 'start.sh', '.github']) {
    assert.equal(files.includes(forbidden), false, `el artefacto no debe incluir ${forbidden}`);
  }
});

test('el build audita allowlist, secretos y referencias Firebase', () => {
  const source = readFileSync(`${root}/scripts/build-pages.mjs`, 'utf8');
  assert.match(source, /\.nojekyll/);
  assert.match(source, /index\.html/);
  assert.match(source, /public-app\.js/);
  assert.match(source, /properties-data\.js/);
  assert.match(source, /data\/properties\.json/);
  assert.match(source, /assets\/adahra-logo-full\.webp/);
  assert.match(source, /assets\/adahra-mark\.webp/);
  assert.match(source, /assets\/favicon\.png/);
  assert.match(source, /SECRET_PATTERNS/);
  assert.match(source, /firebase/);
  assert.match(source, /MAX_PROPERTIES|500/);
  assert.match(source, /process\.exit\(1\)/);
});

test('el artefacto no contiene panel, tests, dependencias ni documentación', () => {
  const files = walk(`${root}/_site`);
  for (const file of files) {
    assert.equal(/admin|test|package|node_modules|README|DEPLOY|start-/i.test(file), false, `archivo inesperado: ${file}`);
  }
  const html = readFileSync(`${root}/_site/index.html`, 'utf8');
  assert.equal(/admin\.html|DEPLOY|firebase|firestore/i.test(html), false);
});

test('el artefacto no publica fotos originales de WhatsApp y sí los derivados optimizados', () => {
  const files = walk(`${root}/_site`);

  assert.equal(
    files.some((file) => /(?:^|\/)WhatsApp Image .*\.(?:jpe?g|png)$/i.test(file)),
    false,
    'el artefacto no debe contener fotos originales de WhatsApp'
  );
  for (const asset of ['assets/adahra-logo-full.webp', 'assets/adahra-mark.webp', 'assets/favicon.png']) {
    assert.ok(files.includes(asset), `el artefacto debe publicar el derivado ${asset}`);
  }

  for (const file of files.filter((name) => /\.(?:html|js|json|css|txt)$/i.test(name))) {
    assert.equal(
      /WhatsApp Image /i.test(readFileSync(`${root}/_site/${file}`, 'utf8')),
      false,
      `${file} no debe referenciar fotos originales`
    );
  }
});

test('git ignora las fotos originales de WhatsApp sin ignorar assets/', () => {
  const repo = mkdtempSync(join(tmpdir(), 'adahra-gitignore-'));
  try {
    const init = spawnSync('git', ['init', '--quiet', repo], { encoding: 'utf8' });
    if (init.error || init.status !== 0) {
      assert.match(readFileSync(`${root}/.gitignore`, 'utf8'), /^WhatsApp Image \*\.jpeg\s*$/m);
      return;
    }

    copyFileSync(`${root}/.gitignore`, join(repo, '.gitignore'));
    mkdirSync(join(repo, 'assets'));
    writeFileSync(join(repo, 'WhatsApp Image prueba.jpeg'), '');
    writeFileSync(join(repo, 'assets/adahra-logo-full.webp'), '');

    const original = spawnSync('git', ['-C', repo, 'check-ignore', '-q', 'WhatsApp Image prueba.jpeg']);
    assert.equal(original.status, 0, 'git debe ignorar las fotos originales de WhatsApp');

    const derivative = spawnSync('git', ['-C', repo, 'check-ignore', '-q', 'assets/adahra-logo-full.webp']);
    assert.equal(derivative.status, 1, 'git no debe ignorar los derivados de assets/');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
