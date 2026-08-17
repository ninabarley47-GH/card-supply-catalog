import { loadSavedCards, saveCard } from './storage.js';
import {
  clearSelectedCardImage,
  chooseCardImageFromLibrary,
  getCardDetailImageSource,
  getCardLibraryImageSource,
  hydrateCardImageSources,
  prepareCardImageForSave
} from './card-images.js';

const CARD_SIZE_PRESETS = {
  'a2-portrait': { label: 'A2 Portrait — 4.25 × 5.5 inches', width: 4.25, height: 5.5 },
  'a2-landscape': { label: 'A2 Landscape — 5.5 × 4.25 inches', width: 5.5, height: 4.25 },
  square: { label: 'Square — 6 × 6 inches', width: 6, height: 6 },
  'mini-slimline': { label: 'Mini Slimline — 3.25 × 6.25 inches', width: 3.25, height: 6.25 },
  slimline: { label: 'Slimline — 3.5 × 8.5 inches', width: 3.5, height: 8.5 },
  custom: { label: 'Custom', width: '', height: '' }
};

export async function initializeCardLibrary({ paperPacks = [] } = {}) {
  const gallery = document.querySelector('[data-card-library]');
  const toolbar = gallery?.closest('#cards')?.querySelector('.library-toolbar');

  if (!gallery || !toolbar) {
    return;
  }

  const detailView = createCardDetailView();
  const addCardView = createAddCardView();
  const addCardButton = createAddCardButton();
  const cards = [];
  let activeTile = null;

  renderCardLibrary(gallery, cards);
  toolbar.append(addCardButton);
  document.body.append(detailView.overlay, addCardView.overlay);
  loadAvailablePaperPacks(addCardView, paperPacks);

  try {
    cards.push(...await loadSavedCards());
    await hydrateCardImageSources(cards);
    sortCards(cards);
    renderCardLibrary(gallery, cards);
  } catch (error) {
    renderCardLibraryError(gallery);
  }

  document.addEventListener('catalog:card-image-library-selected', async () => {
    await hydrateCardImageSources(cards);
    renderCardLibrary(gallery, cards);
  });

  addCardButton.addEventListener('click', () => {
    loadAvailablePaperPacks(addCardView, paperPacks);
    openAddCardView(addCardView);
  });
  addCardView.close.addEventListener('click', () => closeAddCardView(addCardView, addCardButton));
  addCardView.cancel.addEventListener('click', () => closeAddCardView(addCardView, addCardButton));
  addCardView.overlay.addEventListener('click', (event) => {
    if (event.target === addCardView.overlay) {
      closeAddCardView(addCardView, addCardButton);
    }
  });

  gallery.addEventListener('click', (event) => {
    const tile = event.target.closest('[data-card-id]');

    if (tile) {
      openCardDetail(detailView, findCard(cards, tile.dataset.cardId), tile, cards);
      activeTile = tile;
    }
  });

  gallery.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    const tile = event.target.closest('[data-card-id]');

    if (tile) {
      event.preventDefault();
      openCardDetail(detailView, findCard(cards, tile.dataset.cardId), tile, cards);
      activeTile = tile;
    }
  });

  detailView.close.addEventListener('click', () => closeCardDetail(detailView, activeTile));
  detailView.overlay.addEventListener('click', (event) => {
    if (event.target === detailView.overlay) {
      closeCardDetail(detailView, activeTile);
    }
  });

  addCardView.form.addEventListener('submit', async () => {
    addStampSetsFromInput(addCardView, false);
    addCardTagsFromInput(addCardView, false);
    const card = createCardRecord(addCardView);
    addCardView.save.disabled = true;

    try {
      const imageResult = await prepareCardImageForSave(card, addCardView.selectedImage);
      await saveCard(imageResult.card);
      await hydrateCardImageSources([imageResult.card]);
      cards.push(imageResult.card);
      sortCards(cards);
      renderCardLibrary(gallery, cards);
      closeAddCardView(addCardView, addCardButton);

      if (imageResult.usedFallback) {
        window.alert('The card was saved, but its image was kept in browser storage because the Card image folder was unavailable.');
      }
    } catch (error) {
      window.alert('The card could not be saved.');
    } finally {
      addCardView.save.disabled = false;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !addCardView.overlay.hidden) {
      closeAddCardView(addCardView, addCardButton);
      return;
    }

    if (event.key === 'Escape' && !detailView.overlay.hidden) {
      closeCardDetail(detailView, activeTile);
    }
  });
}

function createAddCardButton() {
  const button = document.createElement('button');
  button.className = 'button button-primary';
  button.type = 'button';
  button.textContent = '+ Add Card';
  button.setAttribute('aria-haspopup', 'dialog');
  return button;
}

function createAddCardView() {
  const overlay = document.createElement('div');
  overlay.className = 'card-add-overlay';
  overlay.hidden = true;

  const panel = document.createElement('aside');
  panel.className = 'card-add-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'card-add-title');

  const header = document.createElement('header');
  header.className = 'card-add-header';
  const title = document.createElement('h3');
  title.id = 'card-add-title';
  title.textContent = 'Add Card';

  const close = document.createElement('button');
  close.className = 'card-add-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close Add Card');
  close.textContent = String.fromCodePoint(215);
  header.append(title, close);

  const form = document.createElement('form');
  form.className = 'card-add-form';
  form.addEventListener('submit', (event) => event.preventDefault());

  const content = document.createElement('div');
  content.className = 'card-add-form-content';

  const layout = document.createElement('div');
  layout.className = 'card-add-form-layout';
  const imagePicker = createCardImagePicker();

  const controls = document.createElement('div');
  controls.className = 'card-add-controls';
  const dateCreated = document.createElement('input');
  dateCreated.type = 'date';
  dateCreated.name = 'dateCreated';
  const sizePreset = document.createElement('select');
  sizePreset.name = 'cardSize';
  Object.entries(CARD_SIZE_PRESETS).forEach(([value, preset]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = preset.label;
    sizePreset.append(option);
  });

  const dimensions = document.createElement('div');
  dimensions.className = 'card-add-dimensions';
  const width = createDimensionInput('width');
  const height = createDimensionInput('height');
  const favorite = document.createElement('input');
  favorite.type = 'checkbox';
  favorite.name = 'favorite';
  dimensions.append(
    createAddCardField('Width (inches)', width),
    createAddCardField('Height (inches)', height)
  );
  controls.append(
    createAddCardField('Date Created', dateCreated),
    createAddCardField('Card Size', sizePreset),
    dimensions,
    createFavoriteField(favorite)
  );
  const stampSetPicker = createStampSetPicker();
  controls.append(stampSetPicker.section);
  const tagPicker = createCardTagPicker();
  controls.append(tagPicker.section);
  const paperPackPicker = createPaperPackPicker();
  controls.append(paperPackPicker.section);
  layout.append(imagePicker.container, controls);
  content.append(layout);

  const actions = document.createElement('div');
  actions.className = 'card-add-actions';
  const cancel = document.createElement('button');
  cancel.className = 'button';
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const save = document.createElement('button');
  save.className = 'button button-primary';
  save.type = 'submit';
  save.textContent = 'Save';
  actions.append(cancel, save);
  form.append(content, actions);
  panel.append(header, form);
  overlay.append(panel);

  const addCardView = {
    overlay,
    panel,
    form,
    close,
    cancel,
    save,
    dateCreated,
    sizePreset,
    width,
    height,
    favorite,
    stampSetInput: stampSetPicker.input,
    stampSetList: stampSetPicker.selected,
    stampSets: [],
    tagInput: tagPicker.input,
    tagList: tagPicker.selected,
    tags: [],
    imageChooseButton: imagePicker.choose,
    imagePreview: imagePicker.preview,
    imagePlaceholder: imagePicker.placeholder,
    imageMessage: imagePicker.message,
    selectedImage: null,
    paperPackSearch: paperPackPicker.search,
    paperPackResults: paperPackPicker.results,
    paperPackSelected: paperPackPicker.selected,
    paperPackStatus: paperPackPicker.status,
    availablePaperPacks: [],
    paperPackIds: []
  };
  sizePreset.addEventListener('change', () => applyCardSizePreset(addCardView));
  stampSetPicker.add.addEventListener('click', () => addStampSetsFromInput(addCardView));
  stampSetPicker.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addStampSetsFromInput(addCardView);
    }
  });
  stampSetPicker.selected.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-stamp-set]');

    if (button) {
      removeStampSet(addCardView, button.dataset.removeStampSet);
    }
  });
  tagPicker.add.addEventListener('click', () => addCardTagsFromInput(addCardView));
  tagPicker.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addCardTagsFromInput(addCardView);
    }
  });
  tagPicker.selected.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-card-tag]');

    if (button) {
      removeCardTag(addCardView, button.dataset.removeCardTag);
    }
  });
  imagePicker.choose.addEventListener('click', async () => {
    const result = await chooseCardImageFromLibrary();

    if (result.image) {
      clearSelectedCardImage(addCardView.selectedImage);
      addCardView.selectedImage = result.image;
      renderSelectedCardImage(addCardView);
    }

    imagePicker.message.textContent = result.message || result.image?.name || '';
  });
  paperPackPicker.search.addEventListener('input', () => renderPaperPackSearchResults(addCardView));
  paperPackPicker.results.addEventListener('click', (event) => {
    const button = event.target.closest('[data-add-paper-pack]');

    if (button) {
      addTemporaryPaperPack(addCardView, button.dataset.addPaperPack);
    }
  });
  paperPackPicker.selected.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-paper-pack]');

    if (button) {
      removeTemporaryPaperPack(addCardView, button.dataset.removePaperPack);
    }
  });
  resetAddCardForm(addCardView);
  return addCardView;
}

function openAddCardView(addCardView) {
  resetAddCardForm(addCardView);
  addCardView.overlay.hidden = false;
  addCardView.close.focus();
}

function closeAddCardView(addCardView, addCardButton) {
  if (addCardView.overlay.hidden) {
    return;
  }

  addCardView.overlay.hidden = true;
  resetAddCardForm(addCardView);
  addCardButton.focus();
}

function createAddCardField(labelText, control) {
  const label = document.createElement('label');
  label.className = 'card-add-field';
  const text = document.createElement('span');
  text.textContent = labelText;
  label.append(text, control);
  return label;
}

function createFavoriteField(control) {
  const label = document.createElement('label');
  label.className = 'card-add-favorite-field';
  const text = document.createElement('span');
  text.textContent = 'Favorite';
  label.append(control, text);
  return label;
}

function createStampSetPicker() {
  const section = document.createElement('section');
  section.className = 'card-add-stamp-sets';
  const heading = document.createElement('h4');
  heading.textContent = 'Stamp Sets';
  const inputRow = document.createElement('div');
  inputRow.className = 'card-add-stamp-set-input-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Add a stamp set';
  input.setAttribute('aria-label', 'Add stamp sets');
  const add = document.createElement('button');
  add.className = 'button';
  add.type = 'button';
  add.textContent = 'Add';
  inputRow.append(input, add);
  const help = document.createElement('p');
  help.className = 'card-add-stamp-set-help';
  help.textContent = 'Separate multiple stamp sets with commas.';
  const selected = document.createElement('ul');
  selected.className = 'card-add-selected-stamp-sets';
  selected.setAttribute('aria-label', 'Selected stamp sets');
  section.append(heading, inputRow, help, selected);
  return { section, input, add, selected };
}

function addStampSetsFromInput(addCardView, shouldFocus = true) {
  const candidates = addCardView.stampSetInput.value
    .split(',')
    .map(normalizeCardTag)
    .filter(Boolean);
  const existingStampSets = new Set(addCardView.stampSets.map((stampSet) => stampSet.toLocaleLowerCase()));

  for (const candidate of candidates) {
    const stampSetKey = candidate.toLocaleLowerCase();

    if (!existingStampSets.has(stampSetKey)) {
      addCardView.stampSets.push(candidate);
      existingStampSets.add(stampSetKey);
    }
  }

  addCardView.stampSetInput.value = '';
  renderSelectedStampSets(addCardView);

  if (shouldFocus) {
    addCardView.stampSetInput.focus();
  }
}

function removeStampSet(addCardView, stampSetKey) {
  addCardView.stampSets = addCardView.stampSets.filter(
    (stampSet) => stampSet.toLocaleLowerCase() !== stampSetKey
  );
  renderSelectedStampSets(addCardView);
}

function renderSelectedStampSets(addCardView) {
  addCardView.stampSetList.replaceChildren();

  for (const stampSet of addCardView.stampSets) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = stampSet;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.removeStampSet = stampSet.toLocaleLowerCase();
    remove.setAttribute('aria-label', `Remove ${stampSet}`);
    remove.textContent = String.fromCodePoint(215);
    item.append(name, remove);
    addCardView.stampSetList.append(item);
  }
}

function createCardTagPicker() {
  const section = document.createElement('section');
  section.className = 'card-add-tags';
  const heading = document.createElement('h4');
  heading.textContent = 'Tags';
  const inputRow = document.createElement('div');
  inputRow.className = 'card-add-tag-input-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Birthday, floral, fun fold';
  input.setAttribute('aria-label', 'Add Card tags');
  const add = document.createElement('button');
  add.className = 'button';
  add.type = 'button';
  add.textContent = 'Add';
  inputRow.append(input, add);
  const help = document.createElement('p');
  help.className = 'card-add-tag-help';
  help.textContent = 'Separate multiple tags with commas.';
  const selected = document.createElement('ul');
  selected.className = 'card-add-selected-tags';
  selected.setAttribute('aria-label', 'Selected Card tags');
  section.append(heading, inputRow, help, selected);
  return { section, input, add, selected };
}

function addCardTagsFromInput(addCardView, shouldFocus = true) {
  const candidates = addCardView.tagInput.value
    .split(',')
    .map(normalizeCardTag)
    .filter(Boolean);
  const existingTags = new Set(addCardView.tags.map((tag) => tag.toLocaleLowerCase()));

  for (const candidate of candidates) {
    const tagKey = candidate.toLocaleLowerCase();

    if (!existingTags.has(tagKey)) {
      addCardView.tags.push(candidate);
      existingTags.add(tagKey);
    }
  }

  addCardView.tagInput.value = '';
  renderSelectedCardTags(addCardView);
  if (shouldFocus) {
    addCardView.tagInput.focus();
  }
}

function removeCardTag(addCardView, tagKey) {
  addCardView.tags = addCardView.tags.filter((tag) => tag.toLocaleLowerCase() !== tagKey);
  renderSelectedCardTags(addCardView);
}

function renderSelectedCardTags(addCardView) {
  addCardView.tagList.replaceChildren();

  for (const tag of addCardView.tags) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = tag;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.removeCardTag = tag.toLocaleLowerCase();
    remove.setAttribute('aria-label', `Remove ${tag}`);
    remove.textContent = String.fromCodePoint(215);
    item.append(name, remove);
    addCardView.tagList.append(item);
  }
}

function normalizeCardTag(tag) {
  return String(tag || '').trim().replace(/\s+/g, ' ');
}

function createCardImagePicker() {
  const container = document.createElement('section');
  container.className = 'card-add-image-picker';
  const previewFrame = document.createElement('div');
  previewFrame.className = 'card-add-image-preview-frame';
  const preview = document.createElement('img');
  preview.className = 'card-add-image-preview';
  preview.alt = 'Selected card preview';
  preview.hidden = true;
  const placeholder = document.createElement('p');
  placeholder.className = 'card-add-image-placeholder';
  placeholder.textContent = 'No image selected';
  previewFrame.append(preview, placeholder);

  const choose = document.createElement('button');
  choose.className = 'button';
  choose.type = 'button';
  choose.textContent = 'Choose Card Image';
  const message = document.createElement('p');
  message.className = 'card-add-image-message';
  message.setAttribute('aria-live', 'polite');
  container.append(previewFrame, choose, message);

  return { container, choose, preview, placeholder, message };
}

function renderSelectedCardImage(addCardView) {
  const hasImage = Boolean(addCardView.selectedImage?.previewSrc);
  addCardView.imagePreview.hidden = !hasImage;
  addCardView.imagePlaceholder.hidden = hasImage;
  addCardView.imagePreview.src = hasImage ? addCardView.selectedImage.previewSrc : '';
  addCardView.imageMessage.textContent = hasImage ? addCardView.selectedImage.name : '';
}

function createDimensionInput(name) {
  const input = document.createElement('input');
  input.type = 'number';
  input.name = name;
  input.min = '0.25';
  input.step = '0.25';
  input.inputMode = 'decimal';
  return input;
}

function createPaperPackPicker() {
  const section = document.createElement('section');
  section.className = 'card-add-paper-packs';
  const heading = document.createElement('h4');
  heading.textContent = 'Paper Packs Used';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Search paper packs by name';
  search.setAttribute('aria-label', 'Search paper packs by name');
  const status = document.createElement('p');
  status.className = 'card-add-paper-pack-status';
  status.setAttribute('aria-live', 'polite');
  const results = document.createElement('ul');
  results.className = 'card-add-paper-pack-results';
  results.setAttribute('aria-label', 'Paper pack search results');
  const selected = document.createElement('ul');
  selected.className = 'card-add-selected-packs';
  selected.setAttribute('aria-label', 'Selected paper packs');
  section.append(heading, search, status, results, selected);
  return { section, search, status, results, selected };
}

function loadAvailablePaperPacks(addCardView, paperPacks) {
  addCardView.availablePaperPacks = paperPacks
    .filter((paperPack) => paperPack.id && paperPack.name)
    .sort((first, second) => first.name.localeCompare(second.name));
  renderPaperPackSearchResults(addCardView);
}

function renderPaperPackSearchResults(addCardView) {
  const query = addCardView.paperPackSearch.value.trim().toLowerCase();
  addCardView.paperPackResults.replaceChildren();

  if (!query) {
    addCardView.paperPackStatus.textContent = 'Type to search paper packs.';
    return;
  }

  const matches = addCardView.availablePaperPacks.filter((paperPack) =>
    paperPack.name.toLowerCase().includes(query) && !addCardView.paperPackIds.includes(paperPack.id)
  );
  addCardView.paperPackStatus.textContent = matches.length === 0 ? 'No matching paper packs.' : '';

  matches.forEach((paperPack) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.addPaperPack = paperPack.id;
    button.textContent = paperPack.name;
    item.append(button);
    addCardView.paperPackResults.append(item);
  });
}

function addTemporaryPaperPack(addCardView, paperPackId) {
  if (!paperPackId || addCardView.paperPackIds.includes(paperPackId)) {
    return;
  }

  addCardView.paperPackIds.push(paperPackId);
  addCardView.paperPackSearch.value = '';
  renderSelectedPaperPacks(addCardView);
  renderPaperPackSearchResults(addCardView);
  addCardView.paperPackSearch.focus();
}

function removeTemporaryPaperPack(addCardView, paperPackId) {
  addCardView.paperPackIds = addCardView.paperPackIds.filter((id) => id !== paperPackId);
  renderSelectedPaperPacks(addCardView);
  renderPaperPackSearchResults(addCardView);
}

function renderSelectedPaperPacks(addCardView) {
  addCardView.paperPackSelected.replaceChildren();

  addCardView.paperPackIds.forEach((paperPackId) => {
    const paperPack = addCardView.availablePaperPacks.find((candidate) => candidate.id === paperPackId);

    if (!paperPack) {
      return;
    }

    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = paperPack.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.removePaperPack = paperPack.id;
    remove.setAttribute('aria-label', `Remove ${paperPack.name}`);
    remove.textContent = String.fromCodePoint(215);
    item.append(name, remove);
    addCardView.paperPackSelected.append(item);
  });
}

function resetAddCardForm(addCardView) {
  clearSelectedCardImage(addCardView.selectedImage);
  addCardView.form.reset();
  addCardView.dateCreated.value = getLocalDateValue();
  addCardView.sizePreset.value = 'a2-portrait';
  addCardView.paperPackIds = [];
  addCardView.tags = [];
  addCardView.stampSets = [];
  addCardView.selectedImage = null;
  addCardView.paperPackSearch.value = '';
  applyCardSizePreset(addCardView);
  renderSelectedPaperPacks(addCardView);
  renderPaperPackSearchResults(addCardView);
  renderSelectedCardTags(addCardView);
  renderSelectedStampSets(addCardView);
  renderSelectedCardImage(addCardView);
}

function applyCardSizePreset(addCardView) {
  const preset = CARD_SIZE_PRESETS[addCardView.sizePreset.value];
  const isCustom = addCardView.sizePreset.value === 'custom';
  addCardView.width.readOnly = !isCustom;
  addCardView.height.readOnly = !isCustom;
  addCardView.width.value = preset.width;
  addCardView.height.value = preset.height;
}

function getLocalDateValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createCardRecord(addCardView) {
  const createdAt = new Date().toISOString();

  return {
    id: createCardId(createdAt),
    dateCreated: addCardView.dateCreated.value,
    size: {
      preset: addCardView.sizePreset.value,
      width: Number(addCardView.width.value),
      height: Number(addCardView.height.value)
    },
    tags: [...addCardView.tags],
    stampSets: [...addCardView.stampSets],
    paperPackIds: [...addCardView.paperPackIds],
    colorIds: [],
    favorite: addCardView.favorite.checked,
    createdAt,
    updatedAt: createdAt
  };
}

function createCardId(createdAt) {
  const randomPart = globalThis.crypto?.randomUUID?.();
  return randomPart
    ? `card-${randomPart}`
    : `card-${createdAt.replace(/\D/g, '')}-${Math.random().toString(36).slice(2, 10)}`;
}

function sortCards(cards) {
  cards.sort((first, second) =>
    String(second.dateCreated).localeCompare(String(first.dateCreated)) ||
    String(second.createdAt || '').localeCompare(String(first.createdAt || ''))
  );
}

function renderCardLibrary(gallery, cards) {
  if (cards.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'card-library-empty';
    empty.textContent = 'No cards have been added yet.';
    gallery.replaceChildren(empty);
    return;
  }

  gallery.replaceChildren(...cards.map(createCardTile));
}

function renderCardLibraryError(gallery) {
  const error = document.createElement('p');
  error.className = 'card-library-empty';
  error.textContent = 'Cards could not be loaded.';
  gallery.replaceChildren(error);
}

function createCardTile(card, index) {
  const tile = document.createElement('article');
  tile.className = 'card-library-tile';
  tile.dataset.cardId = card.id;
  tile.setAttribute('role', 'button');
  tile.setAttribute('tabindex', '0');
  tile.setAttribute('aria-haspopup', 'dialog');
  tile.setAttribute('aria-label', `View card created ${card.dateCreated}`);

  const image = document.createElement('div');
  image.className = `card-library-placeholder card-library-placeholder-${getCardPlaceholderNumber(index)}`;
  applyCardMockupSize(image, card);

  const cardImage = createCardImage(card, 'card-library-image', getCardLibraryImageSource(card));

  if (cardImage) {
    cardImage.loading = 'lazy';
    image.append(cardImage);
  } else {
    image.append(createMissingCardImageMessage());
  }

  if (card.favorite) {
    const favorite = document.createElement('span');
    favorite.className = 'card-library-favorite';
    favorite.setAttribute('aria-label', 'Favorite card');
    favorite.textContent = '♥';
    image.append(favorite);
  }

  const tagList = document.createElement('ul');
  tagList.className = 'card-library-tags';
  tagList.setAttribute('aria-label', 'Card tags');

  card.tags.forEach((tag) => {
    const item = document.createElement('li');
    item.textContent = tag;
    tagList.append(item);
  });

  tile.append(image, tagList);
  return tile;
}

function findCard(cards, cardId) {
  return cards.find((card) => card.id === cardId);
}

function createCardDetailView() {
  const overlay = document.createElement('div');
  overlay.className = 'card-detail-overlay';
  overlay.hidden = true;

  const panel = document.createElement('aside');
  panel.className = 'card-detail-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'card-detail-title');

  const header = document.createElement('header');
  header.className = 'card-detail-header';

  const heading = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Card Library';
  const title = document.createElement('h3');
  title.id = 'card-detail-title';
  title.textContent = 'Card Details';
  heading.append(eyebrow, title);

  const close = document.createElement('button');
  close.className = 'card-detail-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close card details');
  close.textContent = '×';

  const body = document.createElement('div');
  body.className = 'card-detail-body';
  header.append(heading, close);
  panel.append(header, body);
  overlay.append(panel);

  return { overlay, panel, close, body };
}

function openCardDetail(detailView, card, tile, cards) {
  if (!card) {
    return;
  }

  const cardIndex = cards.indexOf(card);
  detailView.body.replaceChildren(createCardDetailContent(card, cardIndex));
  detailView.overlay.hidden = false;
  detailView.close.focus();
}

function closeCardDetail(detailView, tile) {
  if (detailView.overlay.hidden) {
    return;
  }

  detailView.overlay.hidden = true;
  detailView.body.replaceChildren();

  if (tile?.isConnected) {
    tile.focus();
  }
}

function createCardDetailContent(card, index) {
  const content = document.createElement('div');
  content.className = 'card-detail-content';

  const image = document.createElement('div');
  image.className = `card-detail-placeholder card-library-placeholder-${getCardPlaceholderNumber(index)}`;
  applyCardMockupSize(image, card);
  const cardImage = createCardImage(
    card,
    'card-detail-image',
    getCardDetailImageSource(card),
    getCardLibraryImageSource(card)
  );
  image.append(cardImage || createMissingCardImageMessage());

  const metadata = document.createElement('div');
  metadata.className = 'card-detail-metadata';
  metadata.append(
    createCardFacts(card),
    createChipSection('Stamp sets', card.stampSets || []),
    createChipSection('Tags', card.tags),
    createChipSection('Paper packs', card.paperPackIds),
    createChipSection('Colors', card.colorIds)
  );

  content.append(image, metadata);
  return content;
}

function applyCardMockupSize(element, card) {
  const aspectRatio = card.size.width / card.size.height;
  let mockupWidth = '58%';

  if (aspectRatio > 1) {
    mockupWidth = '78%';
  } else if (aspectRatio === 1) {
    mockupWidth = '68%';
  } else if (aspectRatio < 0.75) {
    mockupWidth = '52%';
  }

  element.style.setProperty('--card-width', card.size.width);
  element.style.setProperty('--card-height', card.size.height);
  element.style.setProperty('--card-mockup-width', mockupWidth);
}

function createCardImage(card, className, imagePath, fallbackPath = null) {
  if (!imagePath) {
    return null;
  }

  const image = document.createElement('img');
  image.className = className;
  image.src = imagePath;
  image.alt = `Handmade card, ${card.size.width} by ${card.size.height} inches`;
  image.decoding = 'async';

  if (fallbackPath) {
    image.addEventListener('error', () => {
      image.src = fallbackPath;
    }, { once: true });
  }

  return image;
}

function getCardPlaceholderNumber(index) {
  return (Math.max(0, index) % 4) + 1;
}

function createMissingCardImageMessage() {
  const message = document.createElement('span');
  message.className = 'card-image-missing';
  message.textContent = 'No image yet';
  return message;
}

function createCardFacts(card) {
  const facts = document.createElement('dl');
  facts.className = 'card-detail-facts';
  appendFact(facts, 'Date created', card.dateCreated);
  appendFact(facts, 'Card size', `${card.size.width} × ${card.size.height} inches`);
  appendFact(facts, 'Favorite', card.favorite ? 'Yes' : 'No');
  return facts;
}

function appendFact(list, label, value) {
  const group = document.createElement('div');
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  term.textContent = label;
  description.textContent = value;
  group.append(term, description);
  list.append(group);
}

function createChipSection(label, values) {
  const section = document.createElement('section');
  section.className = 'card-detail-section';
  const heading = document.createElement('h4');
  heading.textContent = label;
  section.append(heading);

  if (values.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'card-detail-empty';
    empty.textContent = 'None';
    section.append(empty);
    return section;
  }

  const list = document.createElement('ul');
  list.className = 'card-detail-chips';
  values.forEach((value) => {
    const item = document.createElement('li');
    item.textContent = value;
    list.append(item);
  });
  section.append(list);
  return section;
}
