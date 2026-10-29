/*
 * ADAHRA Bienes Raíces · editor local del catálogo
 *
 * No hay autenticación, backend ni escritura remota. El catálogo vive en
 * memoria; el humano exporta `properties.json` y lo publica con Git.
 */

import {
  CURRENT_CATALOG_VERSION,
  MAX_CATALOG_BYTES,
  MAX_PROPERTIES,
  OPERATION_LABELS,
  TYPE_LABELS,
  CatalogError,
  createStaticCatalogRepository,
  formatPrice,
  nextId,
  parseCatalogJson,
  serializeCatalogDocument,
  sortProperties,
  validateCatalogDocument,
  validateProperty
} from './properties-data.js';

const byId = (id) => document.getElementById(id);
const normalize = (value) => (value == null ? '' : String(value))
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const repository = createStaticCatalogRepository({ url: './data/properties.json' });

const permanentBanner = byId('permanent-banner');
const editorWarning = byId('editor-warning');
const dirtyState = byId('dirty-state');
const importInput = byId('import-input');
const loadCurrentButton = byId('btn-load-current');
const exportButton = byId('btn-export');
const addButton = byId('btn-add');

const summaryTotal = byId('summary-total');
const summarySale = byId('summary-sale');
const summaryRent = byId('summary-rent');
const summaryTypes = byId('summary-types');
const searchInput = byId('admin-search');
const recordsWrap = byId('records-wrap');
const recordBody = byId('record-body');
const recordsCount = byId('records-count');
const adminEmpty = byId('admin-empty');
const emptyTitle = byId('empty-admin-title');
const emptyText = byId('empty-admin-text');
const emptyAdd = byId('empty-add');
const emptyClear = byId('empty-clear');
const adminStatus = byId('admin-status');

const editorDialog = byId('editor-dialog');
const editorTitle = byId('editor-title');
const editorCode = byId('editor-code');
const editorClose = byId('editor-close');
const editorCancel = byId('editor-cancel');
const editorErrors = byId('editor-errors');
const propertyForm = byId('property-form');
const editorSave = byId('editor-save');

const idInput = byId('field-id');
const titleInput = byId('field-title');
const operationSelect = byId('field-operation');
const typeSelect = byId('field-type');
const neighborhoodInput = byId('field-neighborhood');
const cityInput = byId('field-city');
const stateInput = byId('field-state');
const addressInput = byId('field-address');
const priceInput = byId('field-price');
const constructionInput = byId('field-construction');
const lotInput = byId('field-lot');
const bedsInput = byId('field-beds');
const bathsInput = byId('field-baths');
const parkingInput = byId('field-parking');
const yearInput = byId('field-year');
const descriptionInput = byId('field-description');
const featuresInput = byId('field-features');
const imageInput = byId('field-image');
const altInput = byId('field-alt');
const constructionHint = byId('hint-construction');
const imagePreview = byId('image-preview');
const imageFallback = byId('image-fallback');

const deleteDialog = byId('delete-dialog');
const deleteTitle = byId('delete-title');
const deleteText = byId('delete-text');
const deleteError = byId('delete-error');
const deleteConfirm = byId('delete-confirm');
const deleteCancel = byId('delete-cancel');

const fieldMap = {
  id: { input: idInput, error: byId('error-id') },
  title: { input: titleInput, error: byId('error-title') },
  operation: { input: operationSelect, error: byId('error-operation') },
  type: { input: typeSelect, error: byId('error-type') },
  neighborhood: { input: neighborhoodInput, error: byId('error-neighborhood') },
  city: { input: cityInput, error: byId('error-city') },
  state: { input: stateInput, error: byId('error-state') },
  address: { input: addressInput, error: byId('error-address') },
  price: { input: priceInput, error: byId('error-price') },
  construction: { input: constructionInput, error: byId('error-construction') },
  lot: { input: lotInput, error: byId('error-lot') },
  beds: { input: bedsInput, error: byId('error-beds') },
  baths: { input: bathsInput, error: byId('error-baths') },
  parking: { input: parkingInput, error: byId('error-parking') },
  year: { input: yearInput, error: byId('error-year') },
  description: { input: descriptionInput, error: byId('error-description') },
  features: { input: featuresInput, error: byId('error-features') },
  image: { input: imageInput, error: byId('error-image') },
  alt: { input: altInput, error: byId('error-alt') }
};

const FIELD_ORDER = [
  'id', 'title', 'operation', 'type', 'neighborhood', 'city', 'state',
  'address', 'price', 'construction', 'lot', 'beds', 'baths', 'parking',
  'year', 'description', 'features', 'image', 'alt'
];

const state = {
  properties: [],
  loaded: false,
  dirty: false,
  editingId: null,
  deleteId: null,
  formDirty: false,
  saving: false,
  deleting: false,
  busy: false,
  focusAfterSave: null
};

function valueText(value) {
  return value === null || value === undefined ? '' : String(value);
}

function parseInteger(value) {
  const text = value == null ? '' : String(value).trim();
  if (!text) return null;
  // Sin espacios internos: la coma es el único separador de miles aceptado.
  if (/^\d+$/.test(text)) {
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) ? parsed : NaN;
  }
  if (/^\d{1,3}(,\d{3})+$/.test(text)) {
    const parsed = Number(text.replace(/,/g, ''));
    return Number.isSafeInteger(parsed) ? parsed : NaN;
  }
  return NaN;
}

function parseDecimal(value) {
  const text = value == null ? '' : String(value).trim();
  if (!text) return null;
  // La coma se reserva para separadores de miles en los campos enteros.
  // En baños el decimal se escribe con punto para que "2,500" nunca sea
  // ambiguo (¿2.5 o 2500?). El modelo aplica el mismo contrato.
  if (!/^\d+(\.\d+)?$/.test(text)) return NaN;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function findProperty(id) {
  return state.properties.find((property) => property.id === id) || null;
}

function blankProperty() {
  return {
    id: nextId(state.properties),
    title: '',
    operation: 'venta',
    type: 'casa',
    neighborhood: '',
    city: '',
    state: '',
    address: '',
    price: null,
    construction: null,
    lot: null,
    beds: null,
    baths: null,
    parking: null,
    year: null,
    description: '',
    features: [],
    image: '',
    alt: ''
  };
}

function fillForm(property) {
  idInput.value = valueText(property.id);
  titleInput.value = valueText(property.title);
  operationSelect.value = property.operation || 'venta';
  typeSelect.value = property.type || 'casa';
  neighborhoodInput.value = valueText(property.neighborhood);
  cityInput.value = valueText(property.city);
  stateInput.value = valueText(property.state);
  addressInput.value = valueText(property.address);
  priceInput.value = valueText(property.price);
  constructionInput.value = valueText(property.construction);
  lotInput.value = valueText(property.lot);
  bedsInput.value = valueText(property.beds);
  bathsInput.value = valueText(property.baths);
  parkingInput.value = valueText(property.parking);
  yearInput.value = valueText(property.year);
  descriptionInput.value = valueText(property.description);
  featuresInput.value = Array.isArray(property.features) ? property.features.join('\n') : '';
  imageInput.value = valueText(property.image);
  altInput.value = valueText(property.alt);
}

function readForm() {
  const type = typeSelect.value;
  const isLand = type === 'terreno';

  return {
    id: idInput.value.trim(),
    title: titleInput.value.trim(),
    operation: operationSelect.value,
    type,
    neighborhood: neighborhoodInput.value.trim(),
    city: cityInput.value.trim(),
    state: stateInput.value.trim(),
    address: addressInput.value.trim(),
    price: parseInteger(priceInput.value),
    construction: isLand ? null : parseInteger(constructionInput.value),
    lot: parseInteger(lotInput.value),
    beds: isLand ? null : parseInteger(bedsInput.value),
    baths: isLand ? null : parseDecimal(bathsInput.value),
    parking: isLand ? null : parseInteger(parkingInput.value),
    year: isLand ? null : parseInteger(yearInput.value),
    description: descriptionInput.value.trim(),
    features: featuresInput.value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean),
    image: imageInput.value.trim(),
    alt: altInput.value.trim()
  };
}

function setFieldError(key, message) {
  const entry = fieldMap[key];
  if (!entry) return false;
  if (message) {
    entry.input.setAttribute('aria-invalid', 'true');
    entry.error.textContent = message;
    entry.error.hidden = false;
  } else {
    entry.input.setAttribute('aria-invalid', 'false');
    entry.error.textContent = '';
    entry.error.hidden = true;
  }
  return true;
}

function clearFieldErrors() {
  FIELD_ORDER.forEach((key) => setFieldError(key, ''));
}

function showValidationErrors(errors) {
  const general = [];
  let count = 0;

  Object.keys(errors).forEach((key) => {
    const message = errors[key];
    if (!message) return;
    count += 1;
    if (!setFieldError(key, message)) general.push(message);
  });

  editorErrors.textContent = count === 1
    ? 'Revisa el campo marcado antes de guardar.'
    : `Revisa ${count} campos marcados antes de guardar.`;
  if (general.length) {
    editorErrors.textContent += ' ' + general.join(' ');
  }
  editorErrors.hidden = false;

  const firstKey = FIELD_ORDER.find((key) => errors[key]);
  if (firstKey && fieldMap[firstKey]) {
    fieldMap[firstKey].input.focus();
    fieldMap[firstKey].input.scrollIntoView({ block: 'nearest' });
  }
}

function showFormError(message) {
  editorErrors.textContent = message;
  editorErrors.hidden = false;
}

function announce(message) {
  adminStatus.textContent = '';
  window.setTimeout(() => {
    adminStatus.textContent = message;
  }, 30);
}

function clearWarning() {
  editorWarning.textContent = '';
  editorWarning.hidden = true;
}

function showWarning(message) {
  editorWarning.textContent = message;
  editorWarning.hidden = false;
  announce(message);
}

function setBusy(busy) {
  state.busy = busy;
  loadCurrentButton.disabled = busy;
  exportButton.disabled = busy;
  importInput.disabled = busy;
}

function setDirty(value) {
  state.dirty = Boolean(value);
  dirtyState.dataset.dirty = String(state.dirty);
  dirtyState.textContent = state.dirty ? 'Cambios sin exportar' : 'Sin cambios pendientes';
}

function syncTypeFields(options) {
  const clear = Boolean(options && options.clear);
  const isLand = typeSelect.value === 'terreno';
  const numericFields = [
    ['construction', constructionInput],
    ['beds', bedsInput],
    ['baths', bathsInput],
    ['parking', parkingInput],
    ['year', yearInput]
  ];

  numericFields.forEach(([key, input]) => {
    input.disabled = isLand;
    input.required = false;
    if (isLand && clear) input.value = '';
    if (isLand) setFieldError(key, '');
  });

  constructionInput.disabled = isLand;
  constructionHint.textContent = isLand
    ? 'No aplica en terreno. Se guarda como nulo.'
    : 'Obligatorio para casa, departamento o penthouse.';
}

function updatePreview(url) {
  const value = url == null ? '' : String(url).trim();
  previewAlt();

  if (!value) {
    imagePreview.hidden = true;
    imagePreview.removeAttribute('src');
    imageFallback.hidden = false;
    return;
  }

  imageFallback.hidden = true;
  imagePreview.hidden = false;
  if (imagePreview.getAttribute('src') !== value) {
    imagePreview.src = value;
  }
  if (imagePreview.complete && imagePreview.naturalWidth === 0) {
    imagePreview.hidden = true;
    imageFallback.hidden = false;
  }
}

function previewAlt() {
  imagePreview.alt = altInput.value.trim() || 'Previsualización de la imagen';
}

function renderSummary() {
  const total = state.properties.length;
  const sale = state.properties.filter((property) => property.operation === 'venta').length;
  const rent = state.properties.filter((property) => property.operation === 'renta').length;
  const types = new Set(state.properties.map((property) => property.type)).size;

  summaryTotal.textContent = String(total);
  summarySale.textContent = String(sale);
  summaryRent.textContent = String(rent);
  summaryTypes.textContent = String(types);
}

function buildRow(property) {
  const row = document.createElement('tr');
  row.dataset.id = property.id;

  const codeCell = document.createElement('th');
  codeCell.scope = 'row';
  codeCell.className = 'record-code';
  codeCell.dataset.label = 'Clave';
  codeCell.textContent = property.id;

  const identityCell = document.createElement('td');
  identityCell.dataset.label = 'Propiedad';
  const title = document.createElement('span');
  title.className = 'record-title';
  title.textContent = property.title;
  const location = document.createElement('span');
  location.className = 'record-location';
  location.textContent = `${property.neighborhood} · ${property.city}, ${property.state}`;
  identityCell.append(title, location);

  const tagsCell = document.createElement('td');
  tagsCell.dataset.label = 'Operación / tipo';
  const tags = document.createElement('div');
  tags.className = 'record-tags';
  const operationTag = document.createElement('span');
  operationTag.className = 'tag tag-op';
  operationTag.textContent = OPERATION_LABELS[property.operation] || property.operation;
  const typeTag = document.createElement('span');
  typeTag.className = 'tag tag-type';
  typeTag.textContent = TYPE_LABELS[property.type] || property.type;
  tags.append(operationTag, typeTag);
  tagsCell.append(tags);

  const priceCell = document.createElement('td');
  priceCell.className = 'record-price';
  priceCell.dataset.label = 'Precio';
  priceCell.textContent = formatPrice(property);

  const actionsCell = document.createElement('td');
  actionsCell.dataset.label = 'Acciones';
  const actions = document.createElement('div');
  actions.className = 'record-actions';

  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.className = 'btn btn-line record-edit';
  editButton.dataset.id = property.id;
  editButton.setAttribute('aria-label', `Editar ${property.id}: ${property.title}`);
  editButton.textContent = 'Editar';

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'btn btn-danger record-delete';
  deleteButton.dataset.id = property.id;
  deleteButton.setAttribute('aria-label', `Eliminar ${property.id}: ${property.title}`);
  deleteButton.textContent = 'Eliminar';

  actions.append(editButton, deleteButton);
  actionsCell.append(actions);

  row.append(codeCell, identityCell, tagsCell, priceCell, actionsCell);
  return row;
}

function renderRecords() {
  const query = normalize(searchInput.value);
  const visible = state.properties.filter((property) => {
    if (!query) return true;
    return normalize([
      property.id,
      property.title,
      property.neighborhood,
      property.city,
      property.state,
      property.address,
      OPERATION_LABELS[property.operation],
      TYPE_LABELS[property.type]
    ].join(' ')).includes(query);
  });

  recordBody.replaceChildren();
  recordsCount.textContent = `${visible.length} de ${state.properties.length} propiedades`;

  if (!state.loaded) {
    recordsWrap.hidden = true;
    adminEmpty.hidden = false;
    emptyTitle.textContent = 'Catálogo sin cargar';
    emptyText.textContent = 'Carga el JSON actual o importa un archivo. También puedes agregar una ficha desde cero.';
    emptyAdd.hidden = false;
    emptyClear.hidden = true;
    return;
  }

  if (state.properties.length === 0) {
    recordsWrap.hidden = true;
    adminEmpty.hidden = false;
    emptyTitle.textContent = 'Sin propiedades';
    emptyText.textContent = 'No hay fichas en memoria. Agrega la primera propiedad y exporta el documento cuando termines.';
    emptyAdd.hidden = false;
    emptyClear.hidden = true;
    return;
  }

  if (visible.length === 0) {
    recordsWrap.hidden = true;
    adminEmpty.hidden = false;
    emptyTitle.textContent = 'Sin coincidencias';
    emptyText.textContent = 'Ninguna ficha coincide con la búsqueda. Limpia el filtro para ver el catálogo completo.';
    emptyAdd.hidden = true;
    emptyClear.hidden = false;
    return;
  }

  recordsWrap.hidden = false;
  adminEmpty.hidden = true;
  for (const property of visible) {
    recordBody.append(buildRow(property));
  }
}

function renderAll() {
  renderSummary();
  renderRecords();
}

function focusRecordEdit(id) {
  const buttons = recordBody.querySelectorAll('.record-edit');
  for (const button of buttons) {
    if (button.dataset.id === id) {
      button.focus();
      return;
    }
  }
  addButton.focus();
}

function openEditor(property) {
  state.editingId = property ? property.id : null;
  state.formDirty = false;
  editorErrors.hidden = true;
  clearFieldErrors();

  if (property) {
    editorTitle.textContent = 'Editar propiedad';
    editorCode.textContent = `Ficha ${property.id}`;
    idInput.readOnly = true;
    fillForm(property);
  } else {
    editorTitle.textContent = 'Agregar propiedad';
    editorCode.textContent = 'Nueva ficha';
    idInput.readOnly = true;
    fillForm(blankProperty());
  }

  syncTypeFields({ clear: false });
  updatePreview(imageInput.value);
  editorDialog.showModal();
  titleInput.focus();
}

function closeEditor() {
  state.formDirty = false;
  if (editorDialog.open) editorDialog.close();
}

function openDelete(property) {
  state.deleteId = property.id;
  deleteTitle.textContent = `Eliminar ${property.id}`;
  deleteText.textContent = `¿Eliminar «${property.title}» (${property.id}) de la copia en memoria? La web pública no cambia hasta que exportes y publiques el JSON.`;
  deleteError.hidden = true;
  deleteError.textContent = '';
  deleteDialog.showModal();
  deleteCancel.focus();
}

function buildDocument(updatedAt) {
  return {
    version: CURRENT_CATALOG_VERSION,
    updatedAt,
    properties: sortProperties(state.properties)
  };
}

function replaceCatalog(document, message) {
  state.properties = sortProperties(document.properties);
  state.loaded = true;
  state.formDirty = false;
  if (editorDialog.open) editorDialog.close();
  clearWarning();
  setDirty(false);
  renderAll();
  announce(message);
}

function confirmDiscard(actionLabel) {
  if (!state.dirty) return true;
  return window.confirm(`Hay cambios sin exportar. ¿${actionLabel} y descartarlos?`);
}

async function loadCurrent() {
  if (state.busy) return;
  if (!confirmDiscard('Cargar el JSON actual')) return;

  setBusy(true);
  clearWarning();
  try {
    const document = await repository.load();
    replaceCatalog(document, `Catálogo actual cargado: ${document.properties.length} propiedades.`);
  } catch (error) {
    const message = error instanceof CatalogError
      ? error.message
      : 'No se pudo cargar data/properties.json.';
    showWarning(`${message} Puedes importar un archivo o empezar desde cero.`);
  } finally {
    setBusy(false);
  }
}

function readFileText(file) {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsText(file);
  });
}

async function importFile(file) {
  if (!file) return;
  clearWarning();

  if (file.size > MAX_CATALOG_BYTES) {
    showWarning(`El archivo supera el máximo de ${MAX_CATALOG_BYTES / (1024 * 1024)} MiB.`);
    return;
  }

  if (!confirmDiscard('Importar otro archivo')) return;

  setBusy(true);
  try {
    const text = await readFileText(file);
    const document = parseCatalogJson(text);
    replaceCatalog(document, `Archivo importado: ${document.properties.length} propiedades.`);
  } catch (error) {
    const message = error instanceof CatalogError
      ? error.message
      : 'No se pudo importar el archivo seleccionado.';
    showWarning(message);
  } finally {
    setBusy(false);
    importInput.value = '';
  }
}

async function saveText(text) {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'properties.json',
        types: [{ description: 'Catálogo JSON', accept: { 'application/json': ['.json'] } }]
      });
      const writable = await handle.createWritable();
      try {
        await writable.write(text);
      } finally {
        await writable.close();
      }
      return { ok: true, method: 'selector de archivos' };
    } catch (error) {
      if (error && error.name === 'AbortError') {
        return { ok: false, cancelled: true, message: 'Exportación cancelada; no se descargó nada.' };
      }
      // Si el selector falla, la descarga sigue siendo el camino obligatorio.
    }
  }

  try {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'properties.json';
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true, method: 'descarga' };
  } catch (error) {
    return { ok: false, message: 'No se pudo iniciar la descarga en este navegador.' };
  }
}

async function exportCatalog() {
  if (state.busy) return;

  let text;
  try {
    text = serializeCatalogDocument(buildDocument(new Date().toISOString()));
  } catch (error) {
    const message = error instanceof CatalogError
      ? error.message
      : 'El catálogo no cumple el esquema y no se puede exportar.';
    showWarning(message);
    return;
  }

  setBusy(true);
  clearWarning();
  try {
    const result = await saveText(text);
    if (!result.ok) {
      if (result.cancelled) {
        showWarning(result.message);
      } else {
        showWarning(result.message || 'No se pudo exportar el catálogo.');
      }
      return;
    }
    setDirty(false);
    announce(`Catálogo exportado por ${result.method}: ${state.properties.length} propiedades. Reemplaza data/properties.json y publica con Git.`);
  } finally {
    setBusy(false);
  }
}

searchInput.addEventListener('input', renderRecords);

addButton.addEventListener('click', () => openEditor(null));
emptyAdd.addEventListener('click', () => openEditor(null));
emptyClear.addEventListener('click', () => {
  searchInput.value = '';
  renderRecords();
  searchInput.focus();
});

loadCurrentButton.addEventListener('click', loadCurrent);
exportButton.addEventListener('click', exportCatalog);
importInput.addEventListener('change', () => {
  const file = importInput.files && importInput.files[0];
  importFile(file);
});

recordBody.addEventListener('click', (event) => {
  const editButton = event.target.closest('.record-edit');
  if (editButton) {
    const property = findProperty(editButton.dataset.id);
    if (property) openEditor(property);
    return;
  }

  const deleteButton = event.target.closest('.record-delete');
  if (deleteButton) {
    const property = findProperty(deleteButton.dataset.id);
    if (property) openDelete(property);
  }
});

editorClose.addEventListener('click', closeEditor);
editorCancel.addEventListener('click', closeEditor);
editorDialog.addEventListener('close', () => {
  state.editingId = null;
  state.formDirty = false;
  editorErrors.hidden = true;
  clearFieldErrors();
});

imagePreview.addEventListener('load', () => {
  imagePreview.hidden = false;
  imageFallback.hidden = true;
});
imagePreview.addEventListener('error', () => {
  imagePreview.hidden = true;
  imageFallback.hidden = false;
});

propertyForm.addEventListener('input', (event) => {
  state.formDirty = true;
  const key = event.target.dataset ? event.target.dataset.field : '';
  if (key) setFieldError(key, '');
  if (event.target === imageInput) updatePreview(imageInput.value);
  if (event.target === altInput) previewAlt();
  if (!editorErrors.hidden) editorErrors.hidden = true;
});

propertyForm.addEventListener('change', (event) => {
  state.formDirty = true;
  const key = event.target.dataset ? event.target.dataset.field : '';
  if (key) setFieldError(key, '');
  if (event.target === typeSelect) syncTypeFields({ clear: true });
});

propertyForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (state.saving) return;

  editorErrors.hidden = true;
  clearFieldErrors();

  const candidate = readForm();
  const validation = validateProperty(candidate);
  const errors = { ...validation.errors };
  const isEdit = Boolean(state.editingId);

  if (!isEdit && state.properties.some((property) => property.id === candidate.id)) {
    errors.id = `La clave ${candidate.id} ya existe. Elimina o edita la ficha existente.`;
  }

  if (Object.keys(errors).length > 0) {
    showValidationErrors(errors);
    announce('No se guardó: revisa los campos marcados.');
    return;
  }

  const now = new Date().toISOString();
  let nextProperties;

  if (isEdit) {
    const index = state.properties.findIndex((property) => property.id === state.editingId);
    if (index < 0) {
      showFormError(`La ficha ${state.editingId} ya no existe en memoria. Cierra el editor y vuelve a intentarlo.`);
      announce('No se guardó: la ficha ya no existe.');
      return;
    }
    nextProperties = state.properties.slice();
    nextProperties[index] = {
      ...candidate,
      createdAt: state.properties[index].createdAt,
      updatedAt: now
    };
  } else {
    nextProperties = state.properties.concat([{
      ...candidate,
      createdAt: now,
      updatedAt: now
    }]);
  }

  if (nextProperties.length > MAX_PROPERTIES) {
    showFormError(`El catálogo no debe superar ${MAX_PROPERTIES} propiedades.`);
    announce('No se guardó: se alcanzó el máximo de propiedades.');
    return;
  }

  const check = validateCatalogDocument({
    version: CURRENT_CATALOG_VERSION,
    updatedAt: null,
    properties: nextProperties
  });

  if (!check.ok) {
    const first = check.details && check.details[0];
    if (first && first.errors) {
      showValidationErrors(first.errors);
    } else {
      showFormError('El catálogo resultante no cumple el esquema.');
    }
    announce('No se guardó: el catálogo resultante no es válido.');
    return;
  }

  state.properties = sortProperties(nextProperties);
  state.saving = true;
  editorSave.disabled = true;
  state.focusAfterSave = candidate.id;
  setDirty(true);
  closeEditor();
  renderAll();

  const target = state.focusAfterSave;
  state.focusAfterSave = null;
  if (target) focusRecordEdit(target);

  state.saving = false;
  editorSave.disabled = false;
  announce(`${isEdit ? 'Se actualizó' : 'Se agregó'} la ficha ${candidate.id} en memoria. Exporta para conservar los cambios.`);
});

deleteCancel.addEventListener('click', () => {
  if (deleteDialog.open) deleteDialog.close();
});

deleteDialog.addEventListener('close', () => {
  state.deleteId = null;
  deleteError.hidden = true;
  deleteError.textContent = '';
});

deleteConfirm.addEventListener('click', () => {
  const id = state.deleteId;
  if (!id || state.deleting) return;

  state.deleting = true;
  deleteConfirm.disabled = true;
  deleteConfirm.textContent = 'Eliminando…';
  deleteError.hidden = true;

  const next = state.properties.filter((property) => property.id !== id);
  if (next.length === state.properties.length) {
    deleteError.textContent = `La ficha ${id} ya no existe en memoria.`;
    deleteError.hidden = false;
    state.deleting = false;
    deleteConfirm.disabled = false;
    deleteConfirm.textContent = 'Eliminar definitivamente';
    return;
  }

  state.properties = next;
  setDirty(true);
  renderAll();
  deleteDialog.close();
  announce(`Se eliminó la ficha ${id} en memoria. Exporta para conservar los cambios.`);
  searchInput.focus();

  state.deleting = false;
  deleteConfirm.disabled = false;
  deleteConfirm.textContent = 'Eliminar definitivamente';
});

window.addEventListener('beforeunload', (event) => {
  if (state.dirty || state.formDirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});

renderAll();
