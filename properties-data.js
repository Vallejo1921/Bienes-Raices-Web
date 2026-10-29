/*
 * ADAHRA Bienes Raíces · modelo puro del catálogo estático (ESM)
 *
 * Este módulo no habla con ningún servicio remoto ni guarda el catálogo en el
 * navegador. Define el esquema del documento `properties.json`, su validación
 * estricta, la serialización estable, un repositorio de sólo lectura sobre
 * `fetch` y las utilidades de formato/favoritos locales.
 */

export const TYPE_LABELS = Object.freeze({
  casa: 'Casa',
  departamento: 'Departamento',
  penthouse: 'Penthouse',
  terreno: 'Terreno'
});

export const OPERATION_LABELS = Object.freeze({
  venta: 'Venta',
  renta: 'Renta'
});

export const PROPERTY_FIELDS = Object.freeze([
  'id',
  'title',
  'operation',
  'type',
  'neighborhood',
  'city',
  'state',
  'address',
  'price',
  'construction',
  'lot',
  'beds',
  'baths',
  'parking',
  'year',
  'description',
  'features',
  'image',
  'alt'
]);

export const STORED_FIELDS = Object.freeze(PROPERTY_FIELDS.concat(['createdAt', 'updatedAt']));

export const CATALOG_FIELDS = Object.freeze(['version', 'updatedAt', 'properties']);

export const CURRENT_CATALOG_VERSION = 1;
export const MAX_PROPERTIES = 500;
export const MAX_CATALOG_BYTES = 2 * 1024 * 1024;

export const ID_PATTERN = /^UI-\d{3,}$/;
export const ID_MAX_LENGTH = 40;

export const MIN_YEAR = 1800;
export const MAX_YEAR = 2100;
export const MAX_PRICE = 1000000000;
export const MAX_MEASURE = 10000000;

export const LIMITS = Object.freeze({
  id: ID_MAX_LENGTH,
  titleMin: 1,
  titleMax: 120,
  neighborhoodMax: 80,
  cityMax: 80,
  stateMax: 80,
  addressMax: 160,
  descriptionMin: 10,
  descriptionMax: 3000,
  featuresMin: 1,
  featuresMax: 8,
  featureMax: 80,
  imageMax: 1000,
  altMax: 200,
  bathsMax: 100,
  countMax: 100,
  priceMin: 1,
  priceMax: MAX_PRICE,
  measureMax: MAX_MEASURE,
  yearMin: MIN_YEAR,
  yearMax: MAX_YEAR
});

export const FAVORITES_KEY = 'adahra-favoritos-v1';

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

const money = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

const numbers = new Intl.NumberFormat('es-MX');

let storageOk = true;

/** Error tipado del catálogo. Nunca incluye cuerpos de respuesta ni rutas privadas. */
export class CatalogError extends Error {
  constructor(code, message, options) {
    super(message);
    this.name = 'CatalogError';
    this.code = code;
    if (options && options.details !== undefined) this.details = options.details;
    if (options && options.status !== undefined) this.status = options.status;
  }
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeDescription(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

export function isIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length < 20 || value.length > 40) return false;
  if (!ISO_TIMESTAMP.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

/**
 * Contrato numérico del modelo:
 * - Un número finito se conserva tal cual (la validación decide si es entero).
 * - Un texto vacío equivale a "sin dato" (null).
 * - Se acepta un decimal con punto: 220, 2.5, -10.
 * - Se aceptan separadores de miles inequívocos: 4,500,000 → 4500000.
 * - Cualquier formato ambiguo o peligroso (coma decimal, puntos de miles,
 *   espacios internos, exponentes, signos "+", NaN/Infinity) devuelve NaN
 *   para que la validación lo rechace en lugar de adivinar.
 */
function numberFrom(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string') return NaN;

  const text = value.trim();
  if (text === '') return null;

  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (/^-?\d{1,3}(,\d{3})+$/.test(text)) return Number(text.replace(/,/g, ''));

  return NaN;
}

export function isHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (text.length === 0 || text.length > LIMITS.imageMax) return false;
  if (!/^https:\/\//i.test(text)) return false;
  if (/\s/.test(text) || CONTROL_CHARS.test(text)) return false;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && url.hostname.length > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Devuelve una copia con sólo los campos de negocio, textos normalizados y
 * números convertidos cuando llegan como texto simple. No recorta longitudes:
 * la validación estricta es la que decide si el resultado es aceptable.
 */
export function sanitizeProperty(input) {
  if (!isPlainObject(input)) return null;

  const source = input;
  const features = Array.isArray(source.features)
    ? source.features.map((feature) => (typeof feature === 'string' ? normalizeText(feature) : feature))
    : source.features;

  return {
    id: typeof source.id === 'string' ? source.id.trim() : source.id,
    title: normalizeText(source.title),
    operation: typeof source.operation === 'string' ? source.operation.trim() : source.operation,
    type: typeof source.type === 'string' ? source.type.trim() : source.type,
    neighborhood: normalizeText(source.neighborhood),
    city: normalizeText(source.city),
    state: normalizeText(source.state),
    address: normalizeText(source.address),
    price: numberFrom(source.price),
    construction: numberFrom(source.construction),
    lot: numberFrom(source.lot),
    beds: numberFrom(source.beds),
    baths: numberFrom(source.baths),
    parking: numberFrom(source.parking),
    year: numberFrom(source.year),
    description: normalizeDescription(source.description),
    features,
    image: typeof source.image === 'string' ? source.image.trim() : source.image,
    alt: normalizeText(source.alt)
  };
}

function textError(value, min, max, label) {
  if (typeof value !== 'string') return `${label} debe ser texto.`;
  const text = value.trim();
  if (CONTROL_CHARS.test(text)) return `${label} contiene caracteres no permitidos.`;
  if (text.length < min) {
    return min <= 1 ? `${label} es obligatorio.` : `${label} debe tener al menos ${min} caracteres.`;
  }
  if (text.length > max) return `${label} no debe superar ${max} caracteres.`;
  return '';
}

/**
 * Valida una ficha de negocio (sin timestamps). Devuelve `{ ok, errors }`.
 * Rechaza campos desconocidos para que el documento tenga un esquema estricto.
 */
export function validateProperty(property) {
  if (!isPlainObject(property)) {
    return { ok: false, errors: { _form: 'La ficha no es un objeto válido.' } };
  }

  const errors = {};
  const unknown = Object.keys(property).filter((key) => !PROPERTY_FIELDS.includes(key));
  if (unknown.length > 0) {
    errors._form = `La ficha contiene campos no permitidos: ${unknown.join(', ')}.`;
  }

  if (typeof property.id !== 'string' || !ID_PATTERN.test(property.id.trim())) {
    errors.id = 'La clave debe tener el formato UI-000.';
  } else if (property.id.trim().length > ID_MAX_LENGTH) {
    errors.id = `La clave no debe superar ${ID_MAX_LENGTH} caracteres.`;
  }

  const titleError = textError(property.title, LIMITS.titleMin, LIMITS.titleMax, 'El título');
  if (titleError) errors.title = titleError;

  if (!Object.prototype.hasOwnProperty.call(OPERATION_LABELS, property.operation)) {
    errors.operation = 'Selecciona una operación válida (venta o renta).';
  }

  if (!Object.prototype.hasOwnProperty.call(TYPE_LABELS, property.type)) {
    errors.type = 'Selecciona una tipología válida.';
  }

  const neighborhoodError = textError(property.neighborhood, 1, LIMITS.neighborhoodMax, 'La colonia');
  if (neighborhoodError) errors.neighborhood = neighborhoodError;

  const cityError = textError(property.city, 1, LIMITS.cityMax, 'La ciudad');
  if (cityError) errors.city = cityError;

  const stateError = textError(property.state, 1, LIMITS.stateMax, 'El estado');
  if (stateError) errors.state = stateError;

  const addressError = textError(property.address, 1, LIMITS.addressMax, 'La dirección');
  if (addressError) errors.address = addressError;

  if (!Number.isInteger(property.price) || property.price < LIMITS.priceMin || property.price > LIMITS.priceMax) {
    errors.price = `El precio debe ser un entero entre ${LIMITS.priceMin} y ${LIMITS.priceMax}.`;
  }

  if (property.construction !== null) {
    if (!Number.isInteger(property.construction) || property.construction < 1 || property.construction > LIMITS.measureMax) {
      errors.construction = `La construcción debe ser un entero entre 1 y ${LIMITS.measureMax}, o quedar vacía.`;
    } else if (property.type === 'terreno') {
      errors.construction = 'Un terreno no debe tener metros de construcción; déjalo vacío.';
    }
  } else if (property.type !== 'terreno') {
    errors.construction = 'La construcción es obligatoria para casa, departamento o penthouse.';
  }

  if (property.lot !== null) {
    if (!Number.isInteger(property.lot) || property.lot < 1 || property.lot > LIMITS.measureMax) {
      errors.lot = `El terreno debe ser un entero entre 1 y ${LIMITS.measureMax}, o quedar vacío.`;
    }
  }

  if (property.beds !== null) {
    if (!Number.isInteger(property.beds) || property.beds < 0 || property.beds > LIMITS.countMax) {
      errors.beds = `Las recámaras deben ser un entero entre 0 y ${LIMITS.countMax}, o quedar vacías.`;
    }
  }

  if (property.baths !== null) {
    if (
      typeof property.baths !== 'number' ||
      !Number.isFinite(property.baths) ||
      property.baths < 0 ||
      property.baths > LIMITS.bathsMax ||
      !Number.isInteger(property.baths * 2)
    ) {
      errors.baths = `Los baños deben ser múltiplo de 0.5 entre 0 y ${LIMITS.bathsMax}, o quedar vacíos.`;
    }
  }

  if (property.parking !== null) {
    if (!Number.isInteger(property.parking) || property.parking < 0 || property.parking > LIMITS.countMax) {
      errors.parking = `El estacionamiento debe ser un entero entre 0 y ${LIMITS.countMax}, o quedar vacío.`;
    }
  }

  if (property.year !== null) {
    if (!Number.isInteger(property.year) || property.year < LIMITS.yearMin || property.year > LIMITS.yearMax) {
      errors.year = `El año debe ser un entero entre ${LIMITS.yearMin} y ${LIMITS.yearMax}, o quedar vacío.`;
    }
  }

  const descriptionError = textError(property.description, LIMITS.descriptionMin, LIMITS.descriptionMax, 'La descripción');
  if (descriptionError) errors.description = descriptionError;

  if (!Array.isArray(property.features)) {
    errors.features = 'Las amenidades deben ser una lista.';
  } else if (property.features.length < LIMITS.featuresMin) {
    errors.features = 'Agrega al menos una amenidad.';
  } else if (property.features.length > LIMITS.featuresMax) {
    errors.features = `Agrega como máximo ${LIMITS.featuresMax} amenidades.`;
  } else {
    const invalid = property.features.some(
      (feature) => typeof feature !== 'string' || normalizeText(feature).length === 0 || normalizeText(feature).length > LIMITS.featureMax
    );
    if (invalid) errors.features = `Cada amenidad debe ser un texto de 1 a ${LIMITS.featureMax} caracteres.`;
  }

  if (!isHttpsUrl(property.image)) {
    errors.image = `La imagen debe ser una URL https:// de hasta ${LIMITS.imageMax} caracteres.`;
  }

  const altError = textError(property.alt, 1, LIMITS.altMax, 'El texto alternativo');
  if (altError) errors.alt = altError;

  return { ok: Object.keys(errors).length === 0, errors };
}

export function validateCollection(collection) {
  if (!Array.isArray(collection)) {
    return { ok: false, error: 'El catálogo debe ser una lista de propiedades.', details: [] };
  }

  const details = [];
  const seen = new Set();

  collection.forEach((property, index) => {
    const result = validateProperty(property);
    const id = property && typeof property.id === 'string' ? property.id : null;

    if (!result.ok) {
      details.push({ index, id, errors: result.errors });
    }

    if (id) {
      if (seen.has(id)) {
        details.push({ index, id, errors: { id: `La clave ${id} está duplicada.` } });
      } else {
        seen.add(id);
      }
    }
  });

  if (details.length > 0) {
    return {
      ok: false,
      error: `El catálogo contiene ${details.length} problema(s) de validación.`,
      details
    };
  }

  return { ok: true, details: [] };
}

/**
 * Valida una ficha almacenada en el documento: campos de negocio más
 * `createdAt`/`updatedAt` en ISO 8601. Devuelve `{ ok, errors }`.
 */
export function validatePropertyDocument(property) {
  if (!isPlainObject(property)) {
    return { ok: false, errors: { _form: 'La ficha no es un objeto válido.' } };
  }

  const errors = {};
  const unknown = Object.keys(property).filter((key) => !STORED_FIELDS.includes(key));
  if (unknown.length > 0) {
    errors._form = `La ficha contiene campos no permitidos: ${unknown.join(', ')}.`;
  }

  const business = {};
  for (const field of PROPERTY_FIELDS) business[field] = property[field];
  const validation = validateProperty(business);
  Object.assign(errors, validation.errors);

  if (!isIsoTimestamp(property.createdAt)) {
    errors.createdAt = 'La fecha de creación debe ser ISO 8601 válida.';
  }
  if (!isIsoTimestamp(property.updatedAt)) {
    errors.updatedAt = 'La fecha de actualización debe ser ISO 8601 válida.';
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

function summarizeCatalogErrors(result) {
  if (result.errors && typeof result.errors === 'object') {
    const keys = Object.keys(result.errors).filter((key) => key !== '_form');
    if (result.errors._form) return result.errors._form;
    if (keys.length > 0) return result.errors[keys[0]];
  }
  if (result.details && result.details.length > 0) {
    return `El catálogo contiene ${result.details.length} ficha(s) con errores de validación.`;
  }
  return 'El catálogo no cumple el esquema esperado.';
}

/**
 * Valida el documento completo `properties.json`.
 * Resultado: `{ ok: true, details: [] }` o `{ ok: false, errors, details }`.
 */
export function validateCatalogDocument(document) {
  if (!isPlainObject(document)) {
    return { ok: false, errors: { _form: 'El catálogo debe ser un objeto JSON.' }, details: [] };
  }

  const errors = {};
  const unknown = Object.keys(document).filter((key) => !CATALOG_FIELDS.includes(key));
  if (unknown.length > 0) {
    errors._form = `El catálogo contiene campos no permitidos: ${unknown.join(', ')}.`;
  }

  if (document.version !== CURRENT_CATALOG_VERSION) {
    errors.version = `La versión del catálogo debe ser ${CURRENT_CATALOG_VERSION}.`;
  }

  if (document.updatedAt !== null && !isIsoTimestamp(document.updatedAt)) {
    errors.updatedAt = 'La fecha del catálogo debe ser null o una fecha ISO 8601 válida.';
  }

  const details = [];
  const seen = new Set();

  if (!Array.isArray(document.properties)) {
    errors.properties = 'Las propiedades deben ser una lista.';
  } else if (document.properties.length > MAX_PROPERTIES) {
    errors.properties = `El catálogo no debe superar ${MAX_PROPERTIES} propiedades.`;
  } else {
    document.properties.forEach((property, index) => {
      const result = validatePropertyDocument(property);
      const id = property && typeof property.id === 'string' ? property.id : null;

      if (!result.ok) {
        details.push({ index, id, errors: result.errors });
      }

      if (id) {
        if (seen.has(id)) {
          details.push({ index, id, errors: { id: `La clave ${id} está duplicada.` } });
        } else {
          seen.add(id);
        }
      }
    });

    if (details.length > 0) {
      errors.properties = `El catálogo contiene ${details.length} problema(s) de validación.`;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, details };
  }

  return { ok: true, details: [] };
}

export function normalizePropertyDocument(property) {
  const normalized = {};
  for (const field of STORED_FIELDS) normalized[field] = property[field];
  return normalized;
}

export function normalizeCatalogDocument(document) {
  return {
    version: CURRENT_CATALOG_VERSION,
    updatedAt: document.updatedAt,
    properties: sortProperties((document.properties || []).map(normalizePropertyDocument))
  };
}

/**
 * Parsea y valida el texto JSON del catálogo. Lanza `CatalogError` con código
 * `TOO_LARGE`, `PARSE` o `VALIDATION`; los mensajes son seguros para mostrar.
 */
export function parseCatalogJson(text) {
  if (typeof text !== 'string') {
    throw new CatalogError('PARSE', 'El contenido del catálogo no es texto válido.');
  }

  if (byteLength(text) > MAX_CATALOG_BYTES) {
    throw new CatalogError('TOO_LARGE', `El catálogo supera el máximo de ${MAX_CATALOG_BYTES / (1024 * 1024)} MiB.`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new CatalogError('PARSE', 'El archivo no contiene JSON válido.');
  }

  const result = validateCatalogDocument(data);
  if (!result.ok) {
    throw new CatalogError('VALIDATION', summarizeCatalogErrors(result), { details: result.details });
  }

  return normalizeCatalogDocument(data);
}

/**
 * Serializa el documento con orden estable (version, updatedAt, propiedades
 * ordenadas por clave y campos en orden fijo). Lanza `CatalogError` si el
 * documento es inválido o supera 2 MiB.
 */
export function serializeCatalogDocument(document) {
  const result = validateCatalogDocument(document);
  if (!result.ok) {
    throw new CatalogError('VALIDATION', summarizeCatalogErrors(result), { details: result.details });
  }

  const canonical = normalizeCatalogDocument(document);
  const text = `${JSON.stringify(canonical, null, 2)}\n`;

  if (byteLength(text) > MAX_CATALOG_BYTES) {
    throw new CatalogError('TOO_LARGE', `El catálogo supera el máximo de ${MAX_CATALOG_BYTES / (1024 * 1024)} MiB.`);
  }

  return text;
}

/**
 * Repositorio de sólo lectura para la página pública.
 * Fuerza una URL relativa (compatible con GitHub Pages), `cache: 'no-store'`
 * y valida el documento antes de devolverlo.
 */
export function createStaticCatalogRepository(options) {
  const settings = options || {};
  const url = settings.url === undefined ? './data/properties.json' : settings.url;
  const fetchImpl = settings.fetchImpl === undefined ? globalThis.fetch : settings.fetchImpl;

  if (typeof url !== 'string' || url.length === 0) {
    throw new TypeError('La URL del catálogo debe ser una cadena no vacía.');
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) || url.startsWith('//') || url.startsWith('/')) {
    throw new TypeError('La URL del catálogo debe ser relativa para funcionar bajo GitHub Pages.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('Se requiere fetch para cargar el catálogo.');
  }

  async function load() {
    let response;
    try {
      response = await fetchImpl(url, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
    } catch (error) {
      throw new CatalogError('NETWORK', 'No se pudo descargar el catálogo. Revisa la conexión e inténtalo de nuevo.');
    }

    if (!response || typeof response.ok !== 'boolean') {
      throw new CatalogError('NETWORK', 'La respuesta del catálogo no es válida.');
    }

    if (!response.ok) {
      throw new CatalogError('HTTP', `El catálogo no está disponible (HTTP ${response.status}).`, { status: response.status });
    }

    let text;
    try {
      text = await response.text();
    } catch (error) {
      throw new CatalogError('NETWORK', 'No se pudo leer el catálogo descargado.');
    }

    return parseCatalogJson(text);
  }

  return Object.freeze({ url, load });
}

export function nextId(collection) {
  let max = 0;
  (Array.isArray(collection) ? collection : []).forEach((property) => {
    if (!property || typeof property.id !== 'string') return;
    const match = /^UI-(\d+)$/.exec(property.id);
    if (match) {
      const value = Number(match[1]);
      if (Number.isSafeInteger(value) && value > max) max = value;
    }
  });
  return `UI-${String(max + 1).padStart(3, '0')}`;
}

export function compareProperties(left, right) {
  return left.id.localeCompare(right.id, 'es-MX', { numeric: true });
}

export function sortProperties(collection) {
  return (Array.isArray(collection) ? collection.slice() : []).sort(compareProperties);
}

export function formatPrice(property) {
  const value = property && typeof property.price === 'number' ? property.price : 0;
  const base = money.format(value);
  return property && property.operation === 'renta' ? `${base} MXN / mes` : `${base} MXN`;
}

export function formatMeasure(value) {
  if (value === null || value === undefined || value === '') return '—';
  return `${numbers.format(Number(value))} m²`;
}

/* ------------------------------------------------------------------ */
/* Favoritos locales: único uso permitido de localStorage             */
/* ------------------------------------------------------------------ */

function getStorage() {
  try {
    return globalThis.localStorage || null;
  } catch (error) {
    return null;
  }
}

function readFavoriteIds() {
  const storage = getStorage();
  if (!storage) {
    storageOk = false;
    return [];
  }

  let raw;
  try {
    raw = storage.getItem(FAVORITES_KEY);
    storageOk = true;
  } catch (error) {
    storageOk = false;
    return [];
  }

  if (!raw) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const seen = new Set();
  const ids = [];
  for (const id of parsed) {
    if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function validIdSet(properties) {
  const set = new Set();
  (Array.isArray(properties) ? properties : []).forEach((property) => {
    if (property && typeof property.id === 'string') set.add(property.id);
  });
  return set;
}

/**
 * Lee los favoritos. Si se entrega el catálogo, descarta IDs que ya no existen.
 */
export function loadFavorites(properties) {
  const ids = readFavoriteIds();
  if (!Array.isArray(properties)) return ids;
  const valid = validIdSet(properties);
  return ids.filter((id) => valid.has(id));
}

export function saveFavorites(ids, properties) {
  const valid = validIdSet(properties);
  const seen = new Set();
  const clean = [];

  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id === 'string' && valid.has(id) && !seen.has(id)) {
      seen.add(id);
      clean.push(id);
    }
  }

  const storage = getStorage();
  if (!storage) {
    storageOk = false;
    return { ok: false, ids: clean, error: 'El almacenamiento local no está disponible.' };
  }

  try {
    storage.setItem(FAVORITES_KEY, JSON.stringify(clean));
    storageOk = true;
    return { ok: true, ids: clean };
  } catch (error) {
    storageOk = false;
    return { ok: false, ids: clean, error: 'No se pudieron guardar los favoritos en este navegador.' };
  }
}

export function cleanOrphanFavorites(properties) {
  const current = readFavoriteIds();
  const valid = validIdSet(properties);
  const clean = current.filter((id) => valid.has(id));
  if (clean.length === current.length) return { ok: true, ids: clean, removed: 0 };
  const saved = saveFavorites(clean, properties);
  return { ...saved, removed: current.length - clean.length };
}

export function getStorageStatus() {
  return { ok: storageOk };
}

export function isFileProtocol() {
  return Boolean(globalThis.location && globalThis.location.protocol === 'file:');
}
