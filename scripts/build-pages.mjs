#!/usr/bin/env node
/*
 * Construye el artefacto exacto que GitHub Pages puede publicar.
 * Sólo copia una allowlist de archivos estáticos y audita el resultado.
 */

import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = path.join(projectRoot, '_site');

const ALLOWLIST = Object.freeze([
  '.nojekyll',
  'index.html',
  'public-app.js',
  'properties-data.js',
  'data/properties.json',
  'assets/adahra-logo-full.webp',
  'assets/adahra-mark.webp',
  'assets/favicon.png'
]);

const FORBIDDEN_NAMES = [
  'admin.html',
  'admin-app.js',
  'tests',
  'scripts',
  'package.json',
  'package-lock.json',
  'node_modules',
  'firebase',
  'firestore',
  'DEPLOY.md',
  'README.md',
  'start.sh',
  'start-admin.sh'
];

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /"type"\s*:\s*"service_account"/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /\bghp_[0-9A-Za-z]{20,}\b/,
  /\bgithub_pat_[0-9A-Za-z_]{20,}\b/,
  /\bsk-[0-9A-Za-z]{20,}\b/,
  /\b(?:password|passwd|secret|token)\s*[:=]\s*['"][^'"\s]{8,}['"]/i
];

function fail(message) {
  console.error(`build-pages: ${message}`);
  process.exit(1);
}

async function walk(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await walk(path.join(directory, entry.name), relative));
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      fail(`entrada no regular en el artefacto: ${relative}`);
    }
  }
  return files.sort();
}

async function main() {
  for (const file of ALLOWLIST) {
    const absolute = path.join(projectRoot, file);
    if (!existsSync(absolute)) fail(`falta el archivo de la allowlist: ${file}`);
    const info = await stat(absolute);
    if (!info.isFile()) fail(`la entrada de la allowlist no es un archivo: ${file}`);
  }

  let catalog;
  try {
    catalog = JSON.parse(await readFile(path.join(projectRoot, 'data/properties.json'), 'utf8'));
  } catch (error) {
    fail('data/properties.json no contiene JSON válido.');
  }

  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.properties)) {
    fail('data/properties.json no tiene version 1 y properties[].');
  }
  if (catalog.updatedAt !== null && typeof catalog.updatedAt !== 'string') {
    fail('data/properties.json tiene updatedAt inválido.');
  }
  if (catalog.properties.length > 500) {
    fail('data/properties.json supera 500 propiedades.');
  }

  await rm(siteDir, { recursive: true, force: true });
  await mkdir(path.join(siteDir, 'data'), { recursive: true });

  for (const file of ALLOWLIST) {
    const destination = path.join(siteDir, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(projectRoot, file), destination);
  }

  const expected = ALLOWLIST.slice().sort();
  const actual = await walk(siteDir);
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) {
    fail(`el artefacto no coincide con la allowlist.\nEsperado: ${expected.join(', ')}\nReal: ${actual.join(', ')}`);
  }

  for (const file of actual) {
    const lower = file.toLowerCase();
    for (const name of FORBIDDEN_NAMES) {
      if (lower === name.toLowerCase() || lower.startsWith(`${name.toLowerCase()}/`)) {
        fail(`archivo prohibido en el artefacto: ${file}`);
      }
    }
    if (/\.(md|test\.js|mjs|sh|yml|yaml|env)$/i.test(file)) {
      fail(`extensión no permitida en el artefacto: ${file}`);
    }

    if (!/\.(?:html|js|json|css|txt)$/i.test(file)) {
      const info = await stat(path.join(siteDir, file));
      if (file !== '.nojekyll' && info.size === 0) fail(`asset vacío en el artefacto: ${file}`);
      continue;
    }

    const source = await readFile(path.join(siteDir, file), 'utf8');
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(source)) fail(`posible secreto en ${file}: ${pattern}`);
    }
    if (/\bfirebase\b|\bfirestore\b|gstatic\.com\/firebasejs/i.test(source)) {
      fail(`referencia a Firebase en el artefacto: ${file}`);
    }
  }

  console.log(`build-pages: OK · ${actual.length} archivos en _site/`);
  for (const file of actual) console.log(`  ${file}`);
}

main().catch((error) => {
  console.error(`build-pages: fallo inesperado: ${error && error.message ? error.message : error}`);
  process.exit(1);
});
