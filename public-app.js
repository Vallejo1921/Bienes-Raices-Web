/*
 * ADAHRA Bienes Raíces · página pública
 * Lee el catálogo estático `data/properties.json`; los favoritos viven sólo
 * en este navegador. No hay backend, autenticación ni escritura remota.
 */

import {
  OPERATION_LABELS,
  TYPE_LABELS,
  CatalogError,
  createStaticCatalogRepository,
  formatMeasure,
  formatPrice,
  getStorageStatus,
  isFileProtocol,
  loadFavorites,
  saveFavorites
} from './properties-data.js';

const byId = (id) => document.getElementById(id);
const normalize = (value) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const repository = createStaticCatalogRepository({ url: './data/properties.json' });

const siteHeader = document.querySelector('.site-header');
const menuToggle = byId('menu-toggle');
const menuLabel = menuToggle.querySelector('.menu-toggle-label');
const primaryNav = byId('primary-nav');
const heroForm = byId('hero-search-form');
const heroSearch = byId('hero-search');
const catalogTitle = byId('catalog-title');
const catalogWarning = byId('catalog-storage-warning');
const catalogStatus = byId('catalog-status');
const heroNoteCount = byId('hero-note-count');
const heroCountProperties = byId('hero-count-properties');
const heroCountTypes = byId('hero-count-types');
const heroCountStates = byId('hero-count-states');

const filtersForm = byId('filters-form');
const filterSearch = byId('filter-search');
const filterOperation = byId('filter-operation');
const filterType = byId('filter-type');
const filterMaxPrice = byId('filter-max-price');
const filterFavsOnly = byId('filter-favs-only');
const btnClearFilters = byId('btn-clear-filters');
const resultsCounter = byId('results-counter');
const favoritesWarning = byId('favorites-warning');
const favoritesStatus = byId('favorites-status');
const catalogGrid = byId('catalog-grid');
const emptyState = byId('empty-state');
const emptyTitle = byId('empty-title');
const emptyText = byId('empty-text');
const btnEmptyClear = byId('btn-empty-clear');
const btnEmptyRetry = byId('btn-empty-retry');
const cardTemplate = byId('property-card-template');

const modal = byId('property-modal');
const modalCode = byId('modal-code');
const modalOperation = byId('modal-operation');
const modalClose = byId('modal-close');
const modalCloseBottom = byId('modal-close-bottom');
const modalImg = byId('modal-img');
const modalFallback = byId('modal-fallback');
const modalFallbackLabel = modalFallback.querySelector('.fallback-label');
const modalTitle = byId('modal-title');
const modalLocation = byId('modal-location');
const modalPrice = byId('modal-price');
const modalDescription = byId('modal-description');
const modalSpecs = byId('modal-specs');
const modalFeatures = byId('modal-features');
const modalCta = byId('modal-cta');
const modalSimilar = byId('modal-similar');
const modalSimilarList = byId('modal-similar-list');

const contactSection = byId('contacto');
const contactForm = byId('contact-form');
const contactName = byId('contact-name');
const contactEmail = byId('contact-email');
const contactPhone = byId('contact-phone');
const contactProperty = byId('contact-property');
const contactMessage = byId('contact-message');
const contactPrivacy = byId('contact-privacy');
const formErrors = byId('form-errors');
const formSuccess = byId('form-success');
const year = byId('year');

let properties = [];
let favorites = new Set();
let catalogState = 'loading';
let fatalMessage = '';
let lastSignature = '';
let storageOk = true;

function announce(message) {
  catalogStatus.textContent = '';
  window.setTimeout(() => {
    catalogStatus.textContent = message;
  }, 30);
}

function updateCounts() {
  const total = properties.length;
  const typeCount = new Set(properties.map((property) => property.type)).size;
  const stateCount = new Set(properties.map((property) => property.state)).size;
  heroNoteCount.textContent = String(total);
  heroCountProperties.textContent = String(total).padStart(2, '0');
  heroCountTypes.textContent = String(typeCount).padStart(2, '0');
  heroCountStates.textContent = String(stateCount).padStart(2, '0');
}

function setEmptyActions(options) {
  btnEmptyClear.hidden = !options.clear;
  btnEmptyRetry.hidden = !options.retry;
}

function applyFilters() {
  updateCounts();

  if (properties.length === 0) {
    catalogGrid.replaceChildren();
    catalogGrid.hidden = true;
    emptyState.hidden = false;

    if (catalogState === 'loading') {
      emptyTitle.textContent = 'Cargando catálogo';
      emptyText.textContent = 'Leyendo el archivo estático data/properties.json.';
      setEmptyActions({});
      resultsCounter.textContent = 'Cargando catálogo…';
      return;
    }

    if (catalogState === 'error') {
      emptyTitle.textContent = 'No se pudo cargar el catálogo';
      emptyText.textContent = fatalMessage || 'Revisa tu conexión e inténtalo de nuevo.';
      setEmptyActions({ retry: true });
      resultsCounter.textContent = '0 de 0 propiedades';
      return;
    }

    emptyTitle.textContent = 'Catálogo vacío';
    emptyText.textContent = 'Todavía no hay propiedades publicadas en este catálogo. Puedes reintentar la carga o volver más tarde.';
    setEmptyActions({ retry: true });
    resultsCounter.textContent = '0 de 0 propiedades';
    return;
  }

  setEmptyActions({ clear: true });

  const query = normalize(filterSearch.value);
  const operation = filterOperation.value;
  const type = filterType.value;
  const maxPrice = Number(filterMaxPrice.value.replace(/\D/g, '')) || 0;
  const favoritesOnly = filterFavsOnly.checked;

  const visible = properties.filter((property) => {
    if (operation && property.operation !== operation) return false;
    if (type && property.type !== type) return false;
    if (maxPrice && property.price > maxPrice) return false;
    if (favoritesOnly && !favorites.has(property.id)) return false;
    if (query) {
      const haystack = normalize([
        property.id,
        property.title,
        property.neighborhood,
        property.city,
        property.state,
        property.address,
        TYPE_LABELS[property.type],
        OPERATION_LABELS[property.operation]
      ].join(' '));
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  renderCards(visible);
  resultsCounter.textContent = `${visible.length} de ${properties.length} propiedades`;
  catalogGrid.hidden = visible.length === 0;
  emptyState.hidden = visible.length !== 0;

  if (visible.length === 0) {
    if (favoritesOnly && favorites.size === 0) {
      emptyTitle.textContent = 'Aún no hay favoritos';
      emptyText.textContent = 'Marca «Guardar» en una ficha para conservarla aquí. Los favoritos se guardan únicamente en este navegador.';
    } else {
      emptyTitle.textContent = 'Sin coincidencias';
      emptyText.textContent = 'No encontramos propiedades con esos filtros. Prueba con otra zona, otra operación o un precio máximo mayor.';
    }
  }
}

function refreshStorageWarning() {
  storageOk = getStorageStatus().ok;
  favoritesWarning.hidden = storageOk;
}

function persistFavorites() {
  const result = saveFavorites([...favorites], properties);
  storageOk = result.ok && getStorageStatus().ok;
  if (result.ok) favorites = new Set(result.ids);
  favoritesWarning.hidden = storageOk;
  if (!result.ok && result.error) announce(result.error);
}

function setFavoriteButton(button, property) {
  const active = favorites.has(property.id);
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', active ? `Quitar ${property.title} de favoritos` : `Guardar ${property.title} en favoritos`);
  button.querySelector('.fav-text').textContent = active ? 'Guardado' : 'Guardar';
}

function buildCard(property) {
  const card = cardTemplate.content.firstElementChild.cloneNode(true);
  card.dataset.id = property.id;

  const image = card.querySelector('.card-img');
  const fallback = card.querySelector('.media-fallback');
  const fallbackLabel = card.querySelector('.fallback-label');
  image.addEventListener('load', () => {
    fallback.hidden = true;
  }, { once: true });
  image.addEventListener('error', () => {
    image.hidden = true;
    fallback.hidden = false;
    fallbackLabel.textContent = 'Imagen no disponible';
  }, { once: true });
  image.src = property.image;
  image.alt = property.alt;

  card.querySelector('.card-code').textContent = property.id;
  card.querySelector('.card-kicker').textContent = `${OPERATION_LABELS[property.operation]} · ${TYPE_LABELS[property.type]}`;
  card.querySelector('.card-title').textContent = property.title;
  card.querySelector('.card-location').textContent = `${property.neighborhood} · ${property.city}`;
  card.querySelector('.card-price').textContent = formatPrice(property);

  const specs = card.querySelector('.card-specs');
  const count = (value, singular, plural) => {
    const total = Number(value);
    return `${new Intl.NumberFormat('es-MX').format(total)} ${total === 1 ? singular : plural}`;
  };
  const specTexts = [
    property.construction != null ? `${formatMeasure(property.construction)} const.` : null,
    property.lot != null ? `${formatMeasure(property.lot)} terreno` : null,
    property.beds != null ? count(property.beds, 'recámara', 'recámaras') : null,
    property.baths != null ? count(property.baths, 'baño', 'baños') : null,
    property.parking != null ? count(property.parking, 'auto', 'autos') : null
  ].filter((text) => text !== null).slice(0, 4);
  for (const text of specTexts) {
    const item = document.createElement('li');
    item.textContent = text;
    specs.append(item);
  }

  const favoriteButton = card.querySelector('.fav-btn');
  favoriteButton.dataset.id = property.id;
  setFavoriteButton(favoriteButton, property);

  const openButton = card.querySelector('.card-open');
  openButton.dataset.id = property.id;
  openButton.setAttribute('aria-label', `Ver ficha de ${property.title}`);

  return card;
}

function renderCards(list) {
  const fragment = document.createDocumentFragment();
  for (const property of list) {
    fragment.append(buildCard(property));
  }
  catalogGrid.replaceChildren(fragment);
}

function resetFilterValues() {
  filterSearch.value = '';
  filterOperation.value = '';
  filterType.value = '';
  filterMaxPrice.value = '';
  filterFavsOnly.checked = false;
}

function clearFilters() {
  resetFilterValues();
  applyFilters();
  filterSearch.focus();
}

function refreshFavoriteButtons(propertyId) {
  catalogGrid.querySelectorAll('.fav-btn').forEach((button) => {
    if (button.dataset.id === propertyId) {
      const property = properties.find((item) => item.id === propertyId);
      if (property) setFavoriteButton(button, property);
    }
  });
}

function toggleFavorite(propertyId) {
  const property = properties.find((item) => item.id === propertyId);
  if (!property) return;
  const wasFavorite = favorites.has(property.id);

  const next = new Set(favorites);
  if (wasFavorite) next.delete(property.id);
  else next.add(property.id);

  const result = saveFavorites([...next], properties);
  favorites = result.ok ? new Set(result.ids) : next;
  storageOk = result.ok && getStorageStatus().ok;
  favoritesWarning.hidden = storageOk;

  refreshFavoriteButtons(property.id);
  favoritesStatus.textContent = `${wasFavorite ? 'Se quitó' : 'Se guardó'} ${property.title} ${wasFavorite ? 'de' : 'en'} favoritos.${storageOk ? '' : ' Sólo durante esta sesión.'}`;

  if (filterFavsOnly.checked) {
    applyFilters();
    filterFavsOnly.focus();
  }
}

function fillDialog(property) {
  modalCode.textContent = `Ficha ${property.id}`;
  modalOperation.textContent = `${OPERATION_LABELS[property.operation]} · ${TYPE_LABELS[property.type]}`;
  modalTitle.textContent = property.title;
  modalLocation.textContent = `${property.address}, ${property.neighborhood} · ${property.city}, ${property.state}`;
  modalPrice.textContent = formatPrice(property);
  modalDescription.textContent = property.description;

  const rows = [
    ['Operación', OPERATION_LABELS[property.operation]],
    ['Tipología', TYPE_LABELS[property.type]],
    ...(property.construction != null ? [['Construcción', formatMeasure(property.construction)]] : []),
    ...(property.lot != null ? [['Terreno', formatMeasure(property.lot)]] : []),
    ...(property.beds != null ? [['Recámaras', String(property.beds)]] : []),
    ...(property.baths != null ? [['Baños', String(property.baths)]] : []),
    ...(property.parking != null ? [['Estacionamiento', `${property.parking} autos`]] : []),
    ...(property.year != null ? [['Año', String(property.year)]] : [])
  ];

  modalSpecs.replaceChildren();
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'spec-row';
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value;
    row.append(term, detail);
    modalSpecs.append(row);
  }

  modalFeatures.replaceChildren();
  for (const feature of property.features) {
    const item = document.createElement('li');
    item.textContent = feature;
    modalFeatures.append(item);
  }

  modalImg.hidden = false;
  modalFallback.hidden = false;
  modalFallbackLabel.textContent = 'Cargando imagen';
  modalImg.alt = property.alt;
  if (modalImg.getAttribute('src') !== property.image) {
    modalImg.src = property.image;
  }
  if (modalImg.complete) {
    if (modalImg.naturalWidth > 0) {
      modalFallback.hidden = true;
    } else {
      modalImg.hidden = true;
      modalFallbackLabel.textContent = 'Imagen no disponible';
    }
  }

  modalCta.dataset.id = property.id;
  fillSimilar(property);
}

function fillSimilar(property) {
  const others = properties.filter((item) => item.id !== property.id).slice(0, 3);
  modalSimilarList.replaceChildren();

  if (others.length === 0) {
    modalSimilar.hidden = true;
    return;
  }

  for (const item of others) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'similar-item';
    button.dataset.id = item.id;

    const title = document.createElement('span');
    title.textContent = `${item.id} · ${item.title}`;
    const price = document.createElement('span');
    price.textContent = formatPrice(item);

    button.append(title, price);
    modalSimilarList.append(button);
  }
  modalSimilar.hidden = false;
}

function openProperty(propertyId) {
  const property = properties.find((item) => item.id === propertyId);
  if (!property) return;
  const alreadyOpen = modal.open;
  fillDialog(property);
  if (!alreadyOpen) {
    modal.showModal();
    return;
  }
  modal.scrollTo({ top: 0, behavior: 'auto' });
  modalTitle.focus({ preventScroll: true });
}

function populateContactProperties() {
  const previous = contactProperty.value;
  contactProperty.replaceChildren();

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Selecciona una ficha';
  contactProperty.append(placeholder);

  const general = document.createElement('option');
  general.value = 'asesoria';
  general.textContent = 'Aún no lo sé / asesoría general';
  contactProperty.append(general);

  for (const property of properties) {
    const option = document.createElement('option');
    option.value = property.id;
    option.textContent = `${property.id} · ${property.title}`;
    contactProperty.append(option);
  }

  if (previous && Array.from(contactProperty.options).some((option) => option.value === previous)) {
    contactProperty.value = previous;
  }
}

function handleCatalog(document) {
  const wasLoading = catalogState !== 'ready';
  const signature = `${document.updatedAt || 'sin-fecha'}|${document.properties.map((property) => property.id).join(',')}`;

  catalogState = 'ready';
  fatalMessage = '';
  catalogWarning.hidden = true;
  catalogWarning.textContent = '';
  properties = document.properties;

  if (properties.length > 0) {
    const valid = new Set(properties.map((property) => property.id));
    const pruned = [...favorites].filter((id) => valid.has(id));
    if (pruned.length !== favorites.size) {
      favorites = new Set(pruned);
      persistFavorites();
    }
  }

  refreshStorageWarning();
  populateContactProperties();
  applyFilters();

  const openId = modal.open ? modalCta.dataset.id : null;
  if (openId) {
    const current = properties.find((property) => property.id === openId);
    if (!current) {
      modal.close();
      announce(`La ficha ${openId} ya no está publicada. Se cerró el detalle.`);
    } else {
      fillDialog(current);
    }
  }

  if (wasLoading) {
    announce(properties.length === 0
      ? 'Catálogo cargado. No hay propiedades publicadas.'
      : `Catálogo cargado con ${properties.length} propiedades.`);
  } else if (signature !== lastSignature) {
    announce(`El catálogo se actualizó: ${properties.length} propiedades.`);
  }

  lastSignature = signature;
}

function handleCatalogError(error) {
  const typed = error instanceof CatalogError;
  const base = typed && error.message ? error.message : 'No se pudo cargar el catálogo.';
  const message = isFileProtocol()
    ? `${base} Abre el sitio con ./start.sh; los módulos y fetch no funcionan con file://.`
    : base;

  if (catalogState === 'loading' || properties.length === 0) {
    catalogState = 'error';
    fatalMessage = message;
    properties = [];
    catalogWarning.hidden = true;
  } else {
    catalogWarning.hidden = false;
    catalogWarning.textContent = `${message} Se muestra la última versión disponible.`;
  }

  applyFilters();
  announce('No se pudo actualizar el catálogo.');
}

async function loadCatalog() {
  catalogState = 'loading';
  fatalMessage = '';
  catalogWarning.hidden = true;
  applyFilters();

  try {
    const document = await repository.load();
    handleCatalog(document);
  } catch (error) {
    handleCatalogError(error);
  }
}

const validators = {
  name: {
    input: contactName,
    error: byId('contact-name-error'),
    validate: (value) => value.trim().length >= 2 ? '' : 'Escribe tu nombre (mínimo 2 caracteres).'
  },
  email: {
    input: contactEmail,
    error: byId('contact-email-error'),
    validate: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim()) ? '' : 'Escribe un correo válido, por ejemplo nombre@dominio.mx.'
  },
  phone: {
    input: contactPhone,
    error: byId('contact-phone-error'),
    validate: (value) => /^\d{10}$/.test(value.replace(/[\s().-]/g, '')) ? '' : 'Escribe los 10 dígitos del teléfono, sin lada de país.'
  },
  property: {
    input: contactProperty,
    error: byId('contact-property-error'),
    validate: (value) => value !== '' ? '' : 'Selecciona una ficha o la opción de asesoría general.'
  },
  message: {
    input: contactMessage,
    error: byId('contact-message-error'),
    validate: (value) => value.trim().length >= 10 ? '' : 'Cuéntanos un poco más (mínimo 10 caracteres).'
  },
  privacy: {
    input: contactPrivacy,
    error: byId('contact-privacy-error'),
    validate: (value) => value === true ? '' : 'Confirma que aceptas el uso local de tus datos.'
  }
};

function setFieldState(key, message) {
  const { input, error } = validators[key];
  if (message) {
    input.setAttribute('aria-invalid', 'true');
    error.textContent = message;
    error.hidden = false;
  } else {
    input.setAttribute('aria-invalid', 'false');
    error.textContent = '';
    error.hidden = true;
  }
}

function validateField(key) {
  const { input, validate } = validators[key];
  const value = input.type === 'checkbox' ? input.checked : input.value;
  const message = validate(value);
  setFieldState(key, message);
  return message === '';
}

function closeMenu() {
  siteHeader.classList.remove('nav-open');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuLabel.textContent = 'Menú';
}

function openMenu() {
  siteHeader.classList.add('nav-open');
  menuToggle.setAttribute('aria-expanded', 'true');
  menuLabel.textContent = 'Cerrar';
}

menuToggle.addEventListener('click', () => {
  if (menuToggle.getAttribute('aria-expanded') === 'true') {
    closeMenu();
  } else {
    openMenu();
  }
});

primaryNav.addEventListener('click', (event) => {
  if (event.target.closest('a')) closeMenu();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && siteHeader.classList.contains('nav-open')) {
    closeMenu();
    menuToggle.focus();
  }
});

const desktopQuery = window.matchMedia('(min-width: 901px)');
const handleDesktopChange = (event) => {
  if (event.matches) closeMenu();
};
if (typeof desktopQuery.addEventListener === 'function') {
  desktopQuery.addEventListener('change', handleDesktopChange);
} else {
  desktopQuery.addListener(handleDesktopChange);
}

heroForm.addEventListener('submit', (event) => {
  event.preventDefault();
  resetFilterValues();
  filterSearch.value = heroSearch.value.trim();
  applyFilters();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  byId('catalogo').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  catalogTitle.focus({ preventScroll: true });
});

filtersForm.addEventListener('submit', (event) => {
  event.preventDefault();
  applyFilters();
});

filterSearch.addEventListener('input', applyFilters);
filterMaxPrice.addEventListener('input', applyFilters);
filterOperation.addEventListener('change', applyFilters);
filterType.addEventListener('change', applyFilters);
filterFavsOnly.addEventListener('change', applyFilters);
btnClearFilters.addEventListener('click', clearFilters);
btnEmptyClear.addEventListener('click', clearFilters);
btnEmptyRetry.addEventListener('click', loadCatalog);

catalogGrid.addEventListener('click', (event) => {
  const favoriteButton = event.target.closest('.fav-btn');
  if (favoriteButton) {
    toggleFavorite(favoriteButton.dataset.id);
    return;
  }
  const openButton = event.target.closest('.card-open');
  if (openButton) openProperty(openButton.dataset.id);
});

modalClose.addEventListener('click', () => modal.close());
modalCloseBottom.addEventListener('click', () => modal.close());

modalSimilarList.addEventListener('click', (event) => {
  const button = event.target.closest('.similar-item');
  if (button) openProperty(button.dataset.id);
});

modalImg.addEventListener('load', () => {
  modalFallback.hidden = true;
});

modalImg.addEventListener('error', () => {
  modalImg.hidden = true;
  modalFallback.hidden = false;
  modalFallbackLabel.textContent = 'Imagen no disponible';
});

modalCta.addEventListener('click', () => {
  const propertyId = modalCta.dataset.id;
  if (!propertyId) return;
  modal.close();
  if (Array.from(contactProperty.options).some((option) => option.value === propertyId)) {
    contactProperty.value = propertyId;
  }
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  contactSection.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  contactName.focus({ preventScroll: true });
});

if (typeof HTMLDialogElement !== 'undefined' && !('closedBy' in HTMLDialogElement.prototype)) {
  let pressedOutside = false;
  const isOutside = (event) => {
    const rect = modal.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  };
  modal.addEventListener('pointerdown', (event) => {
    pressedOutside = isOutside(event);
  });
  modal.addEventListener('pointerup', (event) => {
    if (pressedOutside && isOutside(event)) modal.close();
    pressedOutside = false;
  });
}

Object.keys(validators).forEach((key) => {
  const input = validators[key].input;
  const eventName = input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input';
  input.addEventListener(eventName, () => {
    if (input.getAttribute('aria-invalid') === 'true') validateField(key);
    if (!formSuccess.hidden) formSuccess.hidden = true;
  });
});

contactForm.addEventListener('submit', (event) => {
  event.preventDefault();
  formSuccess.hidden = true;
  const invalidKeys = Object.keys(validators).filter((key) => !validateField(key));

  if (invalidKeys.length > 0) {
    formErrors.textContent = invalidKeys.length === 1
      ? 'Revisa el campo marcado antes de continuar.'
      : `Revisa ${invalidKeys.length} campos marcados antes de continuar.`;
    formErrors.hidden = false;
    validators[invalidKeys[0]].input.focus();
    return;
  }

  formErrors.hidden = true;
  formErrors.textContent = '';
  contactForm.reset();
  Object.keys(validators).forEach((key) => setFieldState(key, ''));
  formSuccess.textContent = 'Listo. Tu mensaje se validó únicamente en este navegador. Este formulario no envía la consulta a un servidor ni la guarda en una base de datos.';
  formSuccess.hidden = false;
  formSuccess.focus();
});

year.textContent = String(new Date().getFullYear());
favorites = new Set(loadFavorites());
refreshStorageWarning();
populateContactProperties();
applyFilters();
loadCatalog();
