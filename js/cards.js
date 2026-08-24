import { deleteCard, loadCatalogSetting, loadSavedCards, saveCard, saveCatalogSetting, saveOwner } from './storage.js';
import { loadDefaultOwnerId } from './settings.js';
import { initializeOwnerPicker, notifyOwnerRegistryUpdated, refreshOwnerOptions, resolveOwnerPicker, setOwnerPickerValue } from './owner-picker.js';
import { isActiveOwner } from './owners.js';
import {
  clearSelectedCardImage,
  chooseCardImageFromLibrary,
  getCardDetailImageSource,
  getCardLibraryImageSource,
  hydrateCardImageSources,
  prepareCardImageForSave
} from './card-images.js';
import { createCardTagVocabularyStore } from './card-tags.js';
import { createTagPicker } from './tag-picker.js';

const CARD_SIZE_PRESETS = {
  'a2-portrait': { label: 'A2 Portrait — 4.25 × 5.5 inches', width: 4.25, height: 5.5 },
  'a2-landscape': { label: 'A2 Landscape — 5.5 × 4.25 inches', width: 5.5, height: 4.25 },
  square: { label: 'Square — 6 × 6 inches', width: 6, height: 6 },
  'mini-slimline': { label: 'Mini Slimline — 3.25 × 6.25 inches', width: 3.25, height: 6.25 },
  slimline: { label: 'Slimline — 3.5 × 8.5 inches', width: 3.5, height: 8.5 },
  custom: { label: 'Custom', width: '', height: '' }
};
const ADD_CARD_LAST_OWNER_SETTING_ID = 'addCardLastOwnerId';

export async function initializeCardLibrary({ paperPacks = [], owners = [] } = {}) {
  const gallery = document.querySelector('[data-card-library]');
  const toolbar = gallery?.closest('#cards')?.querySelector('.library-toolbar');
  const addCardButton = document.querySelector('[data-add-card-open]');
  const resultCount = toolbar?.querySelector('[data-card-library-result-count]');

  if (!gallery || !toolbar || !addCardButton) {
    return;
  }

  const detailView = createCardDetailView();
  const cardTagVocabulary = createCardTagVocabularyStore();
  const addCardView = createAddCardView({ owners, onCreateTag: (tag) => cardTagVocabulary.create(tag) });
  const cards = [];
  const filterForm = document.querySelector('[data-card-library-filter-form]');
  const searchInput = document.querySelector('[data-card-library-search]');
  const favoritesButton = document.querySelector('[data-card-library-favorites]');
  const ownerFilter = document.querySelector('[data-card-library-owner]');
  const holidayFilter = document.querySelector('[data-card-library-holiday]');
  const statusFilter = document.querySelector('[data-card-library-status]');
  const sortControl = document.querySelector('[data-card-library-sort]');
  const clearFiltersButton = document.querySelector('[data-card-library-clear]');
  const tagFilter = document.querySelector('[data-card-library-tag-filters]');
  const clearTagsButton = document.querySelector('[data-card-library-clear-tags]');
  const toggleTagsButton = document.querySelector('[data-card-library-toggle-tags]');
  const paperPackNamesById = new Map(paperPacks.map((paperPack) => [paperPack.id, paperPack.name]));
  let activeTile = null;

  refreshCardOwnerFilter(ownerFilter, owners);
  const defaultOwnerId = await loadDefaultOwnerId().catch(() => '');
  if (ownerFilter && owners.some((owner) => isActiveOwner(owner) && owner.id === defaultOwnerId)) {
    ownerFilter.value = defaultOwnerId;
  }

  const renderCurrent = () => {
    const selectedTags = getSelectedCardTags(tagFilter);
    const favoritesOnly = favoritesButton?.getAttribute('aria-pressed') === 'true';
    const hasActiveFilters = Boolean(
      searchInput?.value.trim() || favoritesOnly || ownerFilter?.value || holidayFilter?.value ||
      statusFilter?.value || selectedTags.length > 0
    );
    const visibleCards = filterAndSortCards(cards, {
      query: searchInput?.value,
      favoritesOnly,
      ownerId: ownerFilter?.value,
      holiday: holidayFilter?.value,
      status: statusFilter?.value,
      selectedTags,
      sortOrder: sortControl?.value,
      paperPackNamesById
    });

    renderCardLibrary(gallery, visibleCards, cards.length, paperPackNamesById);
    updateCardLibraryResultCount(resultCount, visibleCards.length, cards.length);
    updateCardQuickFilterStates({ favoritesButton, ownerFilter, holidayFilter, statusFilter });

    if (clearFiltersButton) {
      clearFiltersButton.hidden = !hasActiveFilters;
    }

    if (clearTagsButton) {
      clearTagsButton.hidden = selectedTags.length === 0;
    }
  };

  renderCurrent();
  document.body.append(detailView.overlay, addCardView.overlay);
  loadAvailablePaperPacks(addCardView, paperPacks);

  const reloadCards = async () => {
    const savedCards = await loadSavedCards();
    await hydrateCardImageSources(savedCards);
    sortCards(savedCards);
    cards.splice(0, cards.length, ...savedCards);
    const tagVocabulary = await cardTagVocabulary.load(cards);
    addCardView.tagPicker.setVocabulary(tagVocabulary);
    refreshCardTagFilters(tagFilter, tagVocabulary);
    renderCurrent();
  };

  try {
    await reloadCards();
  } catch (error) {
    renderCardLibraryError(gallery);
  }

  document.addEventListener('catalog:card-image-library-selected', async () => {
    await hydrateCardImageSources(cards);
    renderCurrent();
  });

  document.addEventListener('catalog:cards-restored', async () => {
    try {
      await reloadCards();
    } catch (error) {
      renderCardLibraryError(gallery);
    }
  });

  document.addEventListener('catalog:card-tags-updated', async () => {
    await reloadCards();
  });

  addCardButton.addEventListener('click', async () => {
    const [defaultOwnerId, lastOwnerId] = await Promise.all([
      loadDefaultOwnerId().catch(() => ''),
      loadCatalogSetting(ADD_CARD_LAST_OWNER_SETTING_ID).catch(() => '')
    ]);
    loadAvailablePaperPacks(addCardView, paperPacks);
    openAddCardView(addCardView, selectNewCardOwnerId(defaultOwnerId, lastOwnerId, owners));
  });
  searchInput?.addEventListener('input', renderCurrent);
  favoritesButton?.addEventListener('click', () => {
    favoritesButton.setAttribute(
      'aria-pressed',
      String(favoritesButton.getAttribute('aria-pressed') !== 'true')
    );
    renderCurrent();
  });
  ownerFilter?.addEventListener('change', renderCurrent);
  holidayFilter?.addEventListener('change', renderCurrent);
  statusFilter?.addEventListener('change', renderCurrent);
  tagFilter?.addEventListener('change', renderCurrent);
  sortControl?.addEventListener('change', renderCurrent);
  filterForm?.addEventListener('submit', (event) => event.preventDefault());
  clearFiltersButton?.addEventListener('click', () => {
    searchInput.value = '';
    favoritesButton?.setAttribute('aria-pressed', 'false');
    if (ownerFilter) ownerFilter.value = '';
    if (holidayFilter) holidayFilter.value = '';
    if (statusFilter) statusFilter.value = '';
    clearSelectedCardTags(tagFilter);
    renderCurrent();
    searchInput.focus();
  });
  document.addEventListener('catalog:owners-updated', () => {
    refreshCardOwnerFilter(ownerFilter, owners);
    renderCurrent();
  });
  clearTagsButton?.addEventListener('click', () => {
    clearSelectedCardTags(tagFilter);
    renderCurrent();
  });
  toggleTagsButton?.addEventListener('click', () => {
    const options = tagFilter?.querySelector('[data-card-tag-filter-options]');

    if (!options) {
      return;
    }

    const isExpanded = toggleTagsButton.getAttribute('aria-expanded') === 'true';
    toggleTagsButton.setAttribute('aria-expanded', String(!isExpanded));
    options.hidden = isExpanded;
  });
  addCardView.close.addEventListener('click', () => closeAddCardView(addCardView, addCardButton));
  addCardView.cancel.addEventListener('click', () => closeAddCardView(addCardView, addCardButton));
  addCardView.overlay.addEventListener('click', (event) => {
    if (event.target === addCardView.overlay) {
      closeAddCardView(addCardView, addCardButton);
    }
  });

  gallery.addEventListener('click', async (event) => {
    const favoriteButton = event.target.closest('[data-toggle-card-favorite]');

    if (favoriteButton) {
      event.stopPropagation();
      await toggleCardFavorite(
        findCard(cards, favoriteButton.dataset.toggleCardFavorite),
        cards,
        favoriteButton,
        renderCurrent
      );
      return;
    }

    const tile = event.target.closest('[data-card-id]');

    if (tile) {
      openCardDetail(detailView, findCard(cards, tile.dataset.cardId), tile, cards, paperPacks);
      activeTile = tile;
    }
  });

  gallery.addEventListener('keydown', (event) => {
    if (event.target.closest('[data-toggle-card-favorite]')) {
      return;
    }

    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    const tile = event.target.closest('[data-card-id]');

    if (tile) {
      event.preventDefault();
      openCardDetail(detailView, findCard(cards, tile.dataset.cardId), tile, cards, paperPacks);
      activeTile = tile;
    }
  });

  detailView.close.addEventListener('click', () => closeCardDetail(detailView, activeTile));
  detailView.overlay.addEventListener('click', (event) => {
    if (event.target === detailView.overlay) {
      closeCardDetail(detailView, activeTile);
    }
  });

  document.addEventListener('card:detail-request', (event) => {
    const card = findCard(cards, event.detail?.cardId);

    if (!card) {
      return;
    }

    activeTile = event.detail?.sourceElement || null;
    openCardDetail(detailView, card, activeTile, cards, paperPacks, event.detail?.sourcePaperPackId);
  });

  detailView.back.addEventListener('click', (event) => {
    event.stopPropagation();
    const sourcePaperPackId = detailView.overlay.dataset.sourcePaperPackId;

    if (!sourcePaperPackId) {
      return;
    }

    closeCardDetail(detailView, activeTile);
    document.dispatchEvent(
      new CustomEvent('paper-pack:detail-request', {
        detail: { paperPackId: sourcePaperPackId }
      })
    );
  });
  detailView.body.addEventListener('click', (event) => {
    const paperPackLink = event.target.closest('[data-card-detail-paper-pack]');

    if (paperPackLink) {
      event.stopPropagation();
      const paperPackId = paperPackLink.dataset.cardDetailPaperPack;
      const sourceCardId = detailView.overlay.dataset.selectedCardId;
      const sourcePaperPackId = detailView.overlay.dataset.sourcePaperPackId;
      const needsPaperLibraryScreen = window.location.hash !== '#library';

      if (needsPaperLibraryScreen) {
        window.addEventListener(
          'hashchange',
          () => closeCardDetail(detailView, null),
          { once: true }
        );
      }

      document.dispatchEvent(
        new CustomEvent('paper-pack:detail-request', {
          detail: { paperPackId, sourceCardId, sourcePaperPackId }
        })
      );

      if (!needsPaperLibraryScreen) {
        closeCardDetail(detailView, null);
      }

      return;
    }

    const deleteButton = event.target.closest('[data-delete-card]');

    if (deleteButton) {
      const card = findCard(cards, deleteButton.dataset.deleteCard);

      if (card && deleteSelectedCard(card, cards, detailView, activeTile, renderCurrent)) {
        activeTile = null;
      }

      return;
    }

    const editButton = event.target.closest('[data-edit-card]');

    if (!editButton) {
      return;
    }

    const card = findCard(cards, editButton.dataset.editCard);

    if (card) {
      closeCardDetail(detailView, activeTile);
      loadAvailablePaperPacks(addCardView, paperPacks);
      openEditCardView(addCardView, card);
    }
  });

  addCardView.form.addEventListener('submit', async () => {
    addStampSetsFromInput(addCardView, false);
    const isNewCard = !addCardView.existingCard;
    const owner = resolveOwnerPicker(addCardView.owner, addCardView.newOwner, owners);
    if (!owner) return;
    const card = createCardRecord(addCardView);
    card.ownerId = owner.id;
    addCardView.save.disabled = true;

    try {
      const existingOwnerIndex = owners.findIndex((candidate) => candidate.id === owner.id);
      if (existingOwnerIndex < 0 || !isActiveOwner(owners[existingOwnerIndex])) {
        await saveOwner(owner);
        if (existingOwnerIndex >= 0) owners.splice(existingOwnerIndex, 1, owner);
        else owners.push(owner);
        refreshOwnerOptions(owners);
        notifyOwnerRegistryUpdated();
      }
      const imageResult = await prepareCardImageForSave(card, addCardView.selectedImage);
      await saveCard(imageResult.card);
      await hydrateCardImageSources([imageResult.card]);
      const existingCardIndex = cards.findIndex((candidate) => candidate.id === imageResult.card.id);

      if (existingCardIndex >= 0) {
        cards.splice(existingCardIndex, 1, imageResult.card);
      } else {
        cards.push(imageResult.card);
      }
      sortCards(cards);
      renderCurrent();
      if (isNewCard && card.ownerId) {
        saveCatalogSetting(ADD_CARD_LAST_OWNER_SETTING_ID, card.ownerId).catch(() => {});
      }
      closeAddCardView(addCardView, addCardButton);
      if (isNewCard) {
        window.location.hash = 'cards';
      }

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

  return cards;
}

function createAddCardView({ owners = [], onCreateTag } = {}) {
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
  const status = document.createElement('select');
  status.name = 'status';
  status.append(new Option('Available', 'available'), new Option('Sent', 'sent'));
  const owner = document.createElement('select');
  owner.name = 'ownerId';
  owner.required = true;
  const newOwner = document.createElement('input');
  newOwner.type = 'text';
  newOwner.name = 'owner';
  newOwner.placeholder = 'New owner name';
  initializeOwnerPicker(owner, newOwner, owners);
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
    createAddCardField('Owner', owner, newOwner),
    createAddCardField('Status', status),
    createAddCardField('Card Size', sizePreset),
    dimensions,
    createFavoriteField(favorite)
  );
  const stampSetPicker = createStampSetPicker();
  controls.append(stampSetPicker.section);
  const tagPicker = createTagPicker({
    label: 'Tags',
    inputLabel: 'Search or create Card tags',
    placeholder: 'Search Card tags',
    onCreateTag
  });
  controls.append(tagPicker.element);
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
    title,
    close,
    cancel,
    save,
    owners,
    dateCreated,
    status,
    owner,
    newOwner,
    sizePreset,
    width,
    height,
    favorite,
    stampSetInput: stampSetPicker.input,
    stampSetList: stampSetPicker.selected,
    stampSets: [],
    tagPicker,
    imageChooseButton: imagePicker.choose,
    imagePreview: imagePicker.preview,
    imagePlaceholder: imagePicker.placeholder,
    imageMessage: imagePicker.message,
    selectedImage: null,
    existingCard: null,
    existingImageSource: '',
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

function openAddCardView(addCardView, ownerId = '') {
  resetAddCardForm(addCardView);
  setOwnerPickerValue(addCardView.owner, addCardView.newOwner, ownerId, '', addCardView.owners);
  addCardView.overlay.hidden = false;
  addCardView.close.focus();
}

function openEditCardView(addCardView, card) {
  resetAddCardForm(addCardView);
  addCardView.existingCard = card;
  addCardView.title.textContent = 'Edit Card';
  addCardView.save.textContent = 'Save Changes';
  addCardView.dateCreated.value = card.dateCreated;
  addCardView.status.value = card.status;
  setOwnerPickerValue(addCardView.owner, addCardView.newOwner, card.ownerId, '', addCardView.owners);
  addCardView.sizePreset.value = getCardSizePreset(card.size);
  applyCardSizePreset(addCardView);
  addCardView.width.value = card.size.width;
  addCardView.height.value = card.size.height;
  addCardView.favorite.checked = card.favorite;
  addCardView.stampSets = [...(card.stampSets || [])];
  addCardView.tagPicker.setSelected(card.tags || []);
  addCardView.paperPackIds = [...(card.paperPackIds || [])];
  addCardView.existingImageSource = getCardDetailImageSource(card);
  addCardView.imageMessage.textContent = card.imageName || '';
  renderSelectedStampSets(addCardView);
  renderSelectedPaperPacks(addCardView);
  renderPaperPackSearchResults(addCardView);
  renderSelectedCardImage(addCardView);
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

function createAddCardField(labelText, control, secondaryControl = null) {
  const label = document.createElement('label');
  label.className = 'card-add-field';
  const text = document.createElement('span');
  text.textContent = labelText;
  label.append(text, control);
  if (secondaryControl) label.append(secondaryControl);
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
  const imageSource = addCardView.selectedImage?.previewSrc || addCardView.existingImageSource;
  const hasImage = Boolean(imageSource);
  addCardView.imagePreview.hidden = !hasImage;
  addCardView.imagePlaceholder.hidden = hasImage;
  addCardView.imagePreview.src = hasImage ? imageSource : '';

  if (addCardView.selectedImage) {
    addCardView.imageMessage.textContent = addCardView.selectedImage.name;
  }
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
  addCardView.status.value = 'available';
  addCardView.sizePreset.value = 'a2-portrait';
  addCardView.paperPackIds = [];
  addCardView.tagPicker.reset();
  addCardView.stampSets = [];
  addCardView.selectedImage = null;
  addCardView.existingCard = null;
  addCardView.existingImageSource = '';
  addCardView.title.textContent = 'Add Card';
  addCardView.save.textContent = 'Save';
  addCardView.imageMessage.textContent = '';
  addCardView.paperPackSearch.value = '';
  applyCardSizePreset(addCardView);
  renderSelectedPaperPacks(addCardView);
  renderPaperPackSearchResults(addCardView);
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
  const timestamp = new Date().toISOString();
  const existingCard = addCardView.existingCard;

  return {
    ...(existingCard || {}),
    id: existingCard?.id || createCardId(timestamp),
    status: addCardView.status.value === 'sent' ? 'sent' : 'available',
    dateCreated: addCardView.dateCreated.value,
    size: {
      preset: addCardView.sizePreset.value,
      width: Number(addCardView.width.value),
      height: Number(addCardView.height.value)
    },
    tags: addCardView.tagPicker.getSelected(),
    stampSets: [...addCardView.stampSets],
    paperPackIds: [...addCardView.paperPackIds],
    colorIds: [...(existingCard?.colorIds || [])],
    favorite: addCardView.favorite.checked,
    createdAt: existingCard?.createdAt || timestamp,
    updatedAt: timestamp
  };
}

export function selectNewCardOwnerId(defaultOwnerId, lastOwnerId, owners = []) {
  const ownerIds = new Set(owners.filter(isActiveOwner).map((owner) => owner.id));
  if (ownerIds.has(defaultOwnerId)) return defaultOwnerId;
  if (ownerIds.has(lastOwnerId)) return lastOwnerId;
  return '';
}

function getCardSizePreset(size) {
  if (size?.preset && CARD_SIZE_PRESETS[size.preset]) {
    return size.preset;
  }

  const matchingPreset = Object.entries(CARD_SIZE_PRESETS).find(([, preset]) =>
    preset.width === size?.width && preset.height === size?.height
  );
  return matchingPreset?.[0] || 'custom';
}

function createCardId(createdAt) {
  const randomPart = globalThis.crypto?.randomUUID?.();
  return randomPart
    ? `card-${randomPart}`
    : `card-${createdAt.replace(/\D/g, '')}-${Math.random().toString(36).slice(2, 10)}`;
}

export function filterAndSortCards(cards, options = {}) {
  const query = String(options.query || '').trim().toLocaleLowerCase();
  const selectedTags = (options.selectedTags || []).map((tag) => tag.toLocaleLowerCase());
  const filteredCards = cards.filter((card) => {
    if (options.favoritesOnly && !card.favorite) {
      return false;
    }

    if (options.ownerId && card.ownerId !== options.ownerId) {
      return false;
    }

    if (options.status && card.status !== options.status) {
      return false;
    }

    const cardTags = (card.tags || []).map((tag) => tag.toLocaleLowerCase());

    if (options.holiday === 'only' && !cardTags.includes('holiday')) {
      return false;
    }

    if (options.holiday === 'exclude' && cardTags.includes('holiday')) {
      return false;
    }

    if (!selectedTags.every((tag) => cardTags.includes(tag))) {
      return false;
    }

    if (!query) {
      return true;
    }

    const searchableValues = [
      ...(card.tags || []),
      ...(card.stampSets || []),
      ...(card.paperPackIds || []).map((paperPackId) => options.paperPackNamesById?.get(paperPackId)),
      card.dateCreated
    ];

    return searchableValues.some((value) => String(value || '').toLocaleLowerCase().includes(query));
  });

  return sortCards(filteredCards, options.sortOrder);
}

function refreshCardOwnerFilter(select, owners = []) {
  if (!select) return;

  const selectedOwnerId = select.value;
  select.replaceChildren(
    new Option('All', ''),
    ...owners.filter(isActiveOwner)
      .slice()
      .sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: 'base' }))
      .map((owner) => new Option(owner.name, owner.id))
  );
  select.value = [...select.options].some((option) => option.value === selectedOwnerId)
    ? selectedOwnerId
    : '';
}

function updateCardQuickFilterStates({ favoritesButton, ownerFilter, holidayFilter, statusFilter }) {
  const favoritesOnly = favoritesButton?.getAttribute('aria-pressed') === 'true';
  const favoritesIcon = favoritesButton?.querySelector('.card-library-favorites-icon');
  if (favoritesIcon) favoritesIcon.textContent = favoritesOnly ? '♥' : '♡';

  for (const control of [ownerFilter, holidayFilter, statusFilter]) {
    control?.closest('.card-library-quick-filter')?.classList.toggle('is-active', Boolean(control.value));
  }
}

function getSelectedCardTags(container) {
  if (!container) {
    return [];
  }

  return [...container.querySelectorAll('input[name="card-library-tags"]:checked')].map(
    (input) => input.value
  );
}

function clearSelectedCardTags(container) {
  for (const input of container?.querySelectorAll('input[name="card-library-tags"]:checked') || []) {
    input.checked = false;
  }
}

function refreshCardTagFilters(container, tags = []) {
  if (!container) {
    return;
  }

  const selectedTags = new Set(getSelectedCardTags(container));
  const existingOptions = container.querySelector('[data-card-tag-filter-options]');
  const optionsWereHidden = existingOptions?.hidden || false;
  const options = document.createElement('div');

  options.className = 'keyword-picker-options library-tag-filter-options';
  options.dataset.cardTagFilterOptions = '';
  options.hidden = optionsWereHidden;

  options.append(...tags.map((tag) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    const text = document.createElement('span');

    label.className = 'keyword-option library-tag-option';
    input.type = 'checkbox';
    input.name = 'card-library-tags';
    input.value = tag;
    input.checked = selectedTags.has(tag);
    text.textContent = tag;
    label.append(input, text);
    return label;
  }));

  existingOptions?.remove();
  container.append(options);
}

function sortCards(cards, sortOrder = 'date-desc') {
  const direction = sortOrder === 'date-asc' ? 1 : -1;

  return cards.sort((first, second) => {
    if (sortOrder === 'favorite-desc') {
      const favoriteComparison = Number(Boolean(second.favorite)) - Number(Boolean(first.favorite));

      if (favoriteComparison) {
        return favoriteComparison;
      }
    }

    return String(first.dateCreated).localeCompare(String(second.dateCreated)) * direction ||
      String(first.createdAt || '').localeCompare(String(second.createdAt || '')) * direction;
  });
}

function renderCardLibrary(gallery, cards, totalCount = cards.length, paperPackNamesById = new Map()) {
  if (cards.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'card-library-empty';
    empty.textContent = totalCount > 0
      ? 'No cards match the current filters.'
      : 'No cards have been added yet.';
    gallery.replaceChildren(empty);
    return;
  }

  gallery.replaceChildren(...cards.map((card, index) => createCardTile(card, index, paperPackNamesById)));
}

function updateCardLibraryResultCount(resultCount, visibleCount, totalCount) {
  if (!resultCount) {
    return;
  }

  const cardLabel = totalCount === 1 ? 'card' : 'cards';
  resultCount.textContent = `Showing ${visibleCount} of ${totalCount} ${cardLabel}`;
}

function renderCardLibraryError(gallery) {
  const error = document.createElement('p');
  error.className = 'card-library-empty';
  error.textContent = 'Cards could not be loaded.';
  gallery.replaceChildren(error);
}

function createCardTile(card, index, paperPackNamesById) {
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

  const favorite = document.createElement('button');
  favorite.className = 'card-library-favorite';
  favorite.type = 'button';
  favorite.dataset.toggleCardFavorite = card.id;
  favorite.dataset.favorite = String(Boolean(card.favorite));
  favorite.setAttribute('aria-label', card.favorite ? 'Remove card from favorites' : 'Add card to favorites');
  favorite.setAttribute('aria-pressed', String(Boolean(card.favorite)));
  favorite.title = card.favorite ? 'Remove from favorites' : 'Add to favorites';
  favorite.textContent = '♥';
  image.append(favorite);

  const metadata = createCardLibraryMetadata(card, paperPackNamesById);

  const tagList = document.createElement('ul');
  tagList.className = 'card-library-tags';
  tagList.setAttribute('aria-label', 'Card tags');

  card.tags.forEach((tag) => {
    const item = document.createElement('li');
    item.textContent = tag;
    tagList.append(item);
  });

  tile.append(image, tagList, metadata);
  return tile;
}

function createCardLibraryMetadata(card, paperPackNamesById) {
  const metadata = document.createElement('dl');
  const paperPackNames = (card.paperPackIds || [])
    .map((paperPackId) => paperPackNamesById.get(paperPackId))
    .filter(Boolean);

  metadata.className = 'card-library-metadata';
  appendCardLibraryMetadata(metadata, 'Paper Packs', paperPackNames);
  appendCardLibraryMetadata(metadata, 'Stamp Sets', card.stampSets || []);
  return metadata;
}

function appendCardLibraryMetadata(metadata, label, values) {
  if (values.length === 0) {
    return;
  }

  const group = document.createElement('div');
  const term = document.createElement('dt');
  const description = document.createElement('dd');

  term.textContent = label;
  description.textContent = values.join(', ');
  group.append(term, description);
  metadata.append(group);
}

async function toggleCardFavorite(card, cards, button, renderCurrent) {
  if (!card) {
    return;
  }

  const updatedCard = {
    ...card,
    favorite: !card.favorite,
    updatedAt: new Date().toISOString()
  };

  button.disabled = true;

  try {
    await saveCard(updatedCard);
    const cardIndex = cards.indexOf(card);

    if (cardIndex >= 0) {
      cards.splice(cardIndex, 1, updatedCard);
    }

    renderCurrent();
    document.querySelector(`[data-toggle-card-favorite="${CSS.escape(card.id)}"]`)?.focus();
  } catch (error) {
    button.disabled = false;
    window.alert('The favorite status could not be saved.');
  }
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
  const back = document.createElement('button');
  back.className = 'card-detail-back';
  back.type = 'button';
  back.hidden = true;
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Card Library';
  const title = document.createElement('h3');
  title.id = 'card-detail-title';
  title.textContent = 'Card Details';
  heading.append(back, eyebrow, title);

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

  return { overlay, panel, close, back, body };
}

function openCardDetail(detailView, card, tile, cards, paperPacks, sourcePaperPackId = '') {
  if (!card) {
    return;
  }

  const cardIndex = cards.indexOf(card);
  detailView.body.replaceChildren(createCardDetailContent(card, cardIndex, paperPacks));
  detailView.overlay.dataset.selectedCardId = card.id;
  const sourcePaperPack = paperPacks.find((paperPack) => paperPack.id === sourcePaperPackId);
  applyCardDetailSourceState(detailView.overlay, sourcePaperPack?.id, detailView.back, sourcePaperPack?.name);
  detailView.overlay.hidden = false;
  detailView.close.focus();
}

function closeCardDetail(detailView, tile) {
  if (detailView.overlay.hidden) {
    return;
  }

  detailView.overlay.hidden = true;
  detailView.body.replaceChildren();
  delete detailView.overlay.dataset.selectedCardId;
  applyCardDetailSourceState(detailView.overlay, '', detailView.back);

  if (tile?.isConnected) {
    tile.focus();
  }
}

function createCardDetailContent(card, index, paperPacks) {
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
    createCardDetailRelationshipMetadata(card, paperPacks),
    createChipSection('Tags', card.tags),
    createChipSection('Colors', card.colorIds),
    createCardDetailActions(card)
  );

  content.append(image, metadata);
  return content;
}

export function resolvePaperPackDisplayNames(paperPackIds = [], paperPacks = []) {
  const namesById = new Map(paperPacks.map((paperPack) => [paperPack.id, paperPack.name]));
  return paperPackIds.map((paperPackId) => namesById.get(paperPackId) || paperPackId);
}

export function resolvePaperPackReferences(paperPackIds = [], paperPacks = []) {
  const paperPacksById = new Map(paperPacks.map((paperPack) => [paperPack.id, paperPack]));
  return paperPackIds.map((paperPackId) => {
    const paperPack = paperPacksById.get(paperPackId);
    return {
      id: paperPackId,
      label: paperPack?.name || paperPackId,
      resolved: Boolean(paperPack)
    };
  });
}

export function applyCardDetailSourceState(overlay, sourcePaperPackId, backControl = null, sourcePaperPackName = '') {
  if (sourcePaperPackId) {
    overlay.dataset.sourcePaperPackId = sourcePaperPackId;
  } else {
    delete overlay.dataset.sourcePaperPackId;
  }

  if (backControl) {
    backControl.hidden = !sourcePaperPackId;
    backControl.textContent = sourcePaperPackId ? `← Back to ${sourcePaperPackName}` : '';
  }
}

function createCardDetailActions(card) {
  const actions = document.createElement('div');
  actions.className = 'card-detail-actions';
  const edit = document.createElement('button');
  edit.className = 'button button-primary';
  edit.type = 'button';
  edit.dataset.editCard = card.id;
  edit.textContent = 'Edit Card';

  const deleteButton = document.createElement('button');
  deleteButton.className = 'button button-danger';
  deleteButton.type = 'button';
  deleteButton.dataset.deleteCard = card.id;
  deleteButton.textContent = 'Delete Card';

  actions.append(edit, deleteButton);
  return actions;
}

function deleteSelectedCard(card, cards, detailView, activeTile, renderCurrent) {
  const shouldDelete = window.confirm('Delete this Card from the catalog?');

  if (!shouldDelete) {
    return false;
  }

  deleteCard(card.id).catch(() => {
    window.alert('The Card was removed from this session, but the browser could not save the deletion permanently.');
  });

  const cardIndex = cards.findIndex((candidate) => candidate.id === card.id);

  if (cardIndex !== -1) {
    cards.splice(cardIndex, 1);
  }

  renderCurrent();
  closeCardDetail(detailView, activeTile);
  return true;
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
  appendFact(facts, 'Status', card.status === 'sent' ? 'Sent' : 'Available');
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

function createCardDetailRelationshipMetadata(card, paperPacks) {
  const metadata = document.createElement('dl');
  metadata.className = 'card-library-metadata card-detail-relationship-metadata';
  appendPaperPackDetailMetadata(
    metadata,
    'Paper Packs',
    resolvePaperPackReferences(card.paperPackIds, paperPacks)
  );
  appendCardLibraryMetadata(metadata, 'Stamp Sets', card.stampSets || []);
  return metadata;
}

function appendPaperPackDetailMetadata(metadata, label, references) {
  if (references.length === 0) {
    return;
  }

  const group = document.createElement('div');
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  term.textContent = label;

  references.forEach((reference, index) => {
    if (index > 0) {
      description.append(', ');
    }

    if (!reference.resolved) {
      description.append(reference.label);
      return;
    }

    const button = document.createElement('button');
    button.className = 'card-detail-metadata-link';
    button.type = 'button';
    button.dataset.cardDetailPaperPack = reference.id;
    button.setAttribute('aria-label', `Open ${reference.label}`);
    button.textContent = reference.label;
    description.append(button);
  });

  group.append(term, description);
  metadata.append(group);
}
