import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CURRENT_CATALOG_VERSION,
  MAX_CATALOG_BYTES,
  MAX_PROPERTIES,
  CatalogError,
  createStaticCatalogRepository,
  formatMeasure,
  formatPrice,
  isHttpsUrl,
  isIsoTimestamp,
  loadFavorites,
  nextId,
  parseCatalogJson,
  sanitizeProperty,
  saveFavorites,
  serializeCatalogDocument,
  sortProperties,
  validateCatalogDocument,
  validateProperty,
  validatePropertyDocument
} from '../properties-data.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function validProperty(overrides = {}) {
  return {
    id: 'UI-001',
    title: 'Casa con patio en Del Valle',
    operation: 'venta',
    type: 'casa',
    neighborhood: 'Del Valle',
    city: 'Ciudad de México',
    state: 'CDMX',
    address: 'Calle de prueba 123',
    price: 4500000,
    construction: 220,
    lot: 300,
    beds: 3,
    baths: 2.5,
    parking: 2,
    year: 2015,
    description: 'Casa de dos niveles con patio, luz natural y cocina integral.',
    features: ['Patio', 'Cochera', 'Cocina integral'],
    image: 'https://example.com/casa.jpg',
    alt: 'Fachada de casa con patio',
    createdAt: '2026-01-10T12:00:00.000Z',
    updatedAt: '2026-02-15T18:30:00.000Z',
    ...overrides
  };
}

function validDocument(properties = [validProperty()]) {
  return { version: CURRENT_CATALOG_VERSION, updatedAt: null, properties };
}

function expectCatalogError(code, callback) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof CatalogError, 'debe ser CatalogError');
    assert.equal(error.code, code);
    return true;
  });
}

test('documento vacío: versión 1, updatedAt null y lista vacía', () => {
  const document = JSON.parse('{"version":1,"updatedAt":null,"properties":[]}');
  assert.deepEqual(validateCatalogDocument(document), { ok: true, details: [] });
  assert.match(serializeCatalogDocument(document), /"version": 1/);
  assert.equal(parseCatalogJson(JSON.stringify(document)).properties.length, 0);
});

test('documento lleno: valida, normaliza y serializa con orden estable', () => {
  const second = validProperty({ id: 'UI-002', title: 'Departamento con terraza' });
  const document = validDocument([second, validProperty()]);
  const parsed = parseCatalogJson(JSON.stringify(document));

  assert.deepEqual(parsed.properties.map((item) => item.id), ['UI-001', 'UI-002']);
  const text = serializeCatalogDocument({ ...document, updatedAt: '2026-03-01T10:00:00.000Z' });
  assert.match(text, /"updatedAt": "2026-03-01T10:00:00.000Z"/);
  assert.ok(text.indexOf('"id": "UI-001"') < text.indexOf('"id": "UI-002"'));
  assert.equal(text.endsWith('\n'), true);
});

test('JSON corrupto y documento no-objeto fallan con códigos seguros', () => {
  expectCatalogError('PARSE', () => parseCatalogJson('{ no es json'));
  expectCatalogError('VALIDATION', () => parseCatalogJson('[]'));
});

test('versión distinta es rechazada', () => {
  const document = validDocument();
  document.version = 2;
  const result = validateCatalogDocument(document);
  assert.equal(result.ok, false);
  assert.match(result.errors.version, /versión/);
  expectCatalogError('VALIDATION', () => parseCatalogJson(JSON.stringify(document)));
});

test('updatedAt acepta null o ISO y rechaza fechas inválidas', () => {
  assert.equal(validateCatalogDocument(validDocument()).ok, true);
  assert.equal(validateCatalogDocument({ ...validDocument(), updatedAt: '2026-02-15T18:30:00.000Z' }).ok, true);
  assert.equal(validateCatalogDocument({ ...validDocument(), updatedAt: '15/02/2026' }).ok, false);
  assert.equal(isIsoTimestamp('2026-02-15T18:30:00.000Z'), true);
  assert.equal(isIsoTimestamp('ayer'), false);
});

test('límite de 2 MiB se aplica antes de parsear', () => {
  const oversized = 'x'.repeat(MAX_CATALOG_BYTES + 1);
  expectCatalogError('TOO_LARGE', () => parseCatalogJson(oversized));
});

test('máximo de 500 propiedades', () => {
  const properties = Array.from({ length: MAX_PROPERTIES + 1 }, (_, index) =>
    validProperty({ id: `UI-${String(index + 1).padStart(3, '0')}`, title: `Propiedad ${index + 1}` })
  );
  const result = validateCatalogDocument(validDocument(properties));
  assert.equal(result.ok, false);
  assert.match(result.errors.properties, /500/);
});

test('IDs duplicados y fichas inválidas se reportan con detalle', () => {
  const duplicate = validateCatalogDocument(validDocument([validProperty(), validProperty({ title: 'Otra casa' })]));
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.details.some((detail) => detail.errors.id && /duplicada/.test(detail.errors.id)));

  const invalid = validateCatalogDocument(validDocument([validProperty({ price: 0 })]));
  assert.equal(invalid.ok, false);
  assert.ok(invalid.details[0].errors.price);
});

test('esquema de ficha: campos desconocidos, timestamps y campos inválidos', () => {
  assert.equal(validateProperty(validProperty()).ok, false, 'validateProperty no acepta timestamps');
  assert.equal(validatePropertyDocument(validProperty()).ok, true);

  const extra = validatePropertyDocument({ ...validProperty(), ownerEmail: 'x@example.com' });
  assert.equal(extra.ok, false);
  assert.match(extra.errors._form, /ownerEmail/);

  const missingTimestamp = validatePropertyDocument({ ...validProperty(), createdAt: undefined });
  assert.equal(missingTimestamp.ok, false);
  assert.ok(missingTimestamp.errors.createdAt);

  const business = { ...validProperty() };
  delete business.createdAt;
  delete business.updatedAt;
  assert.equal(validateProperty(business).ok, true);
});

test('modelo: sanitiza textos y números, rechaza formatos ambiguos', () => {
  const clean = sanitizeProperty({
    ...validProperty(),
    title: '  Casa   con patio  ',
    price: '4,500,000',
    construction: '220',
    baths: '2.5',
    features: ['  Patio ', 'Cochera']
  });
  assert.equal(clean.title, 'Casa con patio');
  assert.equal(clean.price, 4500000);
  assert.equal(clean.construction, 220);
  assert.equal(clean.baths, 2.5);
  assert.deepEqual(clean.features, ['Patio', 'Cochera']);

  for (const price of ['4,50,000', '4.500.000', '12,34', '1e6', '+4500000', 'Infinity', 'NaN']) {
    assert.equal(Number.isNaN(sanitizeProperty({ ...validProperty(), price }).price), true, price);
  }
  assert.equal(sanitizeProperty({ ...validProperty(), price: '' }).price, null);
});

test('validación de negocio conserva límites, HTTPS y terrenos', () => {
  const business = (overrides) => {
    const value = { ...validProperty(), ...overrides };
    delete value.createdAt;
    delete value.updatedAt;
    return value;
  };
  assert.equal(validateProperty(business({})).ok, true);
  assert.equal(validateProperty(business({ title: '' })).ok, false);
  assert.equal(validateProperty(business({ description: 'corta' })).ok, false);
  assert.equal(validateProperty(business({ features: [] })).ok, false);
  assert.equal(validateProperty(business({ id: 'casa-1' })).ok, false);
  assert.equal(validateProperty(business({ construction: null })).ok, false);
  assert.equal(validateProperty(business({ type: 'terreno', construction: null, lot: 300 })).ok, true);
  assert.equal(validateProperty(business({ type: 'terreno', construction: 10 })).ok, false);
  assert.equal(isHttpsUrl('https://example.com/a.jpg'), true);
  assert.equal(isHttpsUrl('http://example.com/a.jpg'), false);
  assert.equal(isHttpsUrl('javascript:alert(1)'), false);
});

test('nextId, orden natural y formatos', () => {
  assert.equal(nextId([]), 'UI-001');
  assert.equal(nextId([{ id: 'UI-009' }, { id: 'UI-010' }]), 'UI-011');
  assert.deepEqual(sortProperties([{ id: 'UI-10' }, { id: 'UI-2' }, { id: 'UI-1' }]).map((item) => item.id), ['UI-1', 'UI-2', 'UI-10']);
  assert.match(formatPrice({ price: 4500000, operation: 'venta' }), /4,500,000/);
  assert.match(formatPrice({ price: 25000, operation: 'renta' }), /mes/);
  assert.match(formatMeasure(120), /120/);
  assert.equal(formatMeasure(null), '—');
});

test('favoritos sólo guardan IDs existentes y toleran storage roto', () => {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key)
  };

  const saved = saveFavorites(['UI-001', 'UI-002', 'UI-002', 'no-valido'], [validProperty(), validProperty({ id: 'UI-002' })]);
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.ids, ['UI-001', 'UI-002']);
  assert.deepEqual(loadFavorites([validProperty()]), ['UI-001']);

  globalThis.localStorage = {
    getItem: () => { throw new Error('bloqueado'); },
    setItem: () => { throw new Error('bloqueado'); }
  };
  assert.equal(saveFavorites(['UI-001'], [validProperty()]).ok, false);
  delete globalThis.localStorage;
});

test('repositorio: URL relativa, cache no-store y validación', async () => {
  let seen = null;
  const fetchImpl = async (url, options) => {
    seen = { url, options };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(validDocument())
    };
  };

  const repository = createStaticCatalogRepository({ fetchImpl });
  assert.equal(repository.url, './data/properties.json');
  const document = await repository.load();
  assert.equal(document.properties.length, 1);
  assert.equal(seen.url, './data/properties.json');
  assert.equal(seen.options.cache, 'no-store');

  const badJson = createStaticCatalogRepository({
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => 'no-json' })
  });
  await assert.rejects(badJson.load(), (error) => error instanceof CatalogError && error.code === 'PARSE');

  const httpError = createStaticCatalogRepository({
    fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' })
  });
  await assert.rejects(httpError.load(), (error) => error instanceof CatalogError && error.code === 'HTTP');

  const networkError = createStaticCatalogRepository({
    fetchImpl: async () => { throw new Error('offline'); }
  });
  await assert.rejects(networkError.load(), (error) => error instanceof CatalogError && error.code === 'NETWORK');

  assert.throws(() => createStaticCatalogRepository({ url: 'https://example.com/properties.json', fetchImpl }), TypeError);
  assert.throws(() => createStaticCatalogRepository({ url: '/data/properties.json', fetchImpl }), TypeError);
});

test('serialización rechaza documentos inválidos', () => {
  expectCatalogError('VALIDATION', () => serializeCatalogDocument({ version: 9, updatedAt: null, properties: [] }));
  expectCatalogError('VALIDATION', () => serializeCatalogDocument(validDocument([validProperty({ price: -1 })])));
  assert.equal(clone(validProperty()).id, 'UI-001');
});
