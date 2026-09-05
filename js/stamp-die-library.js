import {
  chooseStampImages, selectStampImageFiles, chooseStampImageDirectory, loadStampImageDirectory,
  prepareStampImagesForSave, hydrateStampImages, clearStampImageSources,
  clearDraftStampImages, removeDraftStampImage, getStampLibraryImageSource
} from './stamp-die-images.js';
import { inferStampDieImageTags, reconcileStampDieImageTags, orderStampDieImages } from './stamp-die-image-tags.js';
import { supportsOpenFilePicker, supportsDirectoryPicker } from './browser-capabilities.js';
import { loadGlobalTagCatalog, loadSavedStampDieSets, saveStampDieSet } from './storage.js';
import { createTagPicker, projectTagNames } from './tag-picker.js';
import { normalizeStampDieSet } from './stamp-die-sets.js';
import { getLocalDateValue } from './ui.js';
import { getTagKey } from './tag-utils.js';

export function createStampDieSetRecord(values, catalog) {
  return normalizeStampDieSet({
    id: values.id || createSetId(),
    name: values.name,
    dateCreated: values.dateCreated,
    releaseYear: values.releaseYear,
    favorite: values.favorite,
    tagIds: values.tagIds,
    imageRefs: values.imageRefs || []
  }, catalog);
}

function createSetId() {
  const randomPart = globalThis.crypto?.randomUUID?.();
  return randomPart
    ? `set-${randomPart}`
    : `set-${new Date().toISOString().replace(/\D/g, '')}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function initializeStampDieLibrary(services = {}) {
  const storage = { loadGlobalTagCatalog, loadSavedStampDieSets, saveStampDieSet,
    chooseStampImages, selectStampImageFiles, chooseStampImageDirectory, loadStampImageDirectory,
    prepareStampImagesForSave, hydrateStampImages, ...services };
  const screen = document.getElementById('stamps-dies');
  if (!screen) return;
  const add = screen.querySelector('[data-add-set]');
  const gallery = screen.querySelector('[data-set-library]');
  const status = screen.querySelector('[data-set-library-status]');
  status.className += ' form-message';
  const view = createSetFormView();
  document.body.append(view.dialog);
  let catalog;
  let picker;
  let draftId;
  let draftSession = 0;
  let editingRecord = null;
  let saving = false;
  let selecting = false;
  let draftImages = [];
  let inferredTags = [];
  let imageDirectory = null;
  let displayedRecords = [];

  function reset() {
    draftSession++;
    clearDraftStampImages(draftImages);
    draftImages = [];
    inferredTags = [];
    selecting = false;
    view.chooseImages.disabled = false;
    view.save.disabled = false;
    view.previews.replaceChildren();
    view.imageMessage.textContent = '';
    view.form.reset();
    view.name.setCustomValidity('');
    view.releaseYear.value = String(new Date().getFullYear());
    view.releaseYear.required = true;
    picker?.reset();
    view.message.textContent = '';
    view.message.dataset.tone = '';
    draftId = null;
    editingRecord = null;
  }

  async function refresh() {
    try {
      const [records, nextCatalog] = await Promise.all([
        storage.loadSavedStampDieSets(), storage.loadGlobalTagCatalog()
      ]);
      await storage.hydrateStampImages(records);
      clearStampImageSources(displayedRecords);
      displayedRecords = records;
      if (!view.dialog.open) catalog = nextCatalog;
      renderStampDieLibrary(gallery, records, nextCatalog, (id) => openForm(id));
      status.dataset.tone = '';
      status.textContent = `${records.length} set${records.length === 1 ? '' : 's'}`;
    } catch {
      status.dataset.tone = 'error';
      status.textContent = 'Sets could not be loaded. Reload to try again.';
    }
  }

  async function openForm(id = null) {
    if (view.dialog.open || add.disabled) return;
    add.disabled = true;
    try {
      catalog = await storage.loadGlobalTagCatalog();
      reset();
      if (!picker) {
        picker = createTagPicker({ label: 'Tags', productType: 'stamp', catalog });
        view.tags.append(picker.element);
      } else picker.setCatalog(catalog);
      if (id) {
        const records = await storage.loadSavedStampDieSets();
        const record = records.find((entry) => entry.id === id);
        if (!record) throw new Error('Set no longer available');
        editingRecord = record;
        await storage.hydrateStampImages([record]);
        view.name.value = record.name;
        view.releaseYear.value = record.releaseYear === undefined ? '' : String(record.releaseYear);
        view.releaseYear.required = record.releaseYear !== undefined;
        view.favorite.checked = record.favorite;
        picker.setSelectedTagIds(record.tagIds);
        draftImages = record.imageRefs.map((reference) => ({
          existingReference: reference,
          name: reference.imageName || reference.imagePath?.split('/').pop() || 'Set image',
          previewSrc: getStampLibraryImageSource(reference)
        }));
        renderDraftImages();
      }
      imageDirectory = await storage.loadStampImageDirectory('read').catch(() => null);
      view.folderMessage.textContent = imageDirectory
        ? `Image folder: ${imageDirectory.name}` : 'Without an accessible image folder, images are saved in this browser.';
      draftId = id || createSetId();
      view.title.textContent = id ? 'Edit Stamp & Die Set' : 'Add Stamp & Die Set';
      view.dialog.showModal();
      view.name.focus();
    } catch {
      reset();
      status.dataset.tone = 'error';
      status.textContent = `${id ? 'Edit' : 'Add'} Set could not be opened. Please try again.`;
    } finally { add.disabled = false; }
  }
  add.addEventListener('click', () => openForm());

  function renderDraftImages() {
    draftImages = orderStampDieImages(draftImages);
    view.previews.replaceChildren(...draftImages.map((image, index) => {
      const item = document.createElement('div');
      item.className = 'stamp-set-draft-image';
      const preview = document.createElement('img');
      if (image.previewSrc) preview.src = image.previewSrc;
      const missing = document.createElement('span');
      missing.textContent = 'Image unavailable';
      missing.hidden = Boolean(image.previewSrc);
      preview.hidden = !image.previewSrc;
      preview.addEventListener('error', () => {
        const full = image.existingReference?.imagePreviewSrc || image.existingReference?.imageSrc;
        if (full && preview.src !== full) preview.src = full;
        else { preview.hidden = true; missing.hidden = false; }
      });
      preview.alt = image.name;
      const remove = document.createElement('button');
      remove.className = 'button';
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${image.name}`);
      remove.addEventListener('click', () => {
        if (saving || selecting) return;
        draftImages = removeDraftStampImage(draftImages, index);
        renderDraftImages();
        // Removing an image never removes inferred or manually chosen tags.
      });
      item.append(preview, missing, remove);
      return item;
    }));
  }

  async function receiveImages(selection) {
    const currentDraft = draftSession;
    selecting = true;
    view.save.disabled = true;
    view.chooseImages.disabled = true;
    view.imageMessage.textContent = 'Loading images...';
    view.imageMessage.dataset.tone = '';
    try {
      const images = await selection;
      if (currentDraft !== draftSession) { clearDraftStampImages(images || []); return; }
      if (!images?.length) { view.imageMessage.textContent = ''; return; }
      const inferred = inferStampDieImageTags(catalog, picker.getSelectedTagIds(), images.map((image) => image.name));
      inferredTags.push(...inferred.inferredTags.filter((tag) => !catalog.tags.some((existing) => existing.id === tag.id)));
      catalog = inferred.catalog;
      picker.setCatalog(catalog);
      picker.setSelectedTagIds(inferred.tagIds);
      draftImages.push(...images);
      renderDraftImages();
      view.imageMessage.textContent = 'Stamp/Die/Mask tags added from filenames. You can change them below.';
    } catch (error) {
      if (currentDraft !== draftSession) return;
      view.imageMessage.textContent = error?.name === 'AbortError' ? '' : 'Images could not be selected. Choose JPEG, PNG, WebP, or GIF files and try again.';
      view.imageMessage.dataset.tone = 'error';
    } finally {
      if (currentDraft === draftSession) {
        selecting = false;
        view.save.disabled = false;
        view.chooseImages.disabled = false;
        view.imageInput.value = '';
      }
    }
  }

  view.chooseImages.addEventListener('click', () => {
    if (saving || selecting) return;
    if (supportsOpenFilePicker(globalThis)) return receiveImages(storage.chooseStampImages(globalThis, imageDirectory));
    view.imageInput.click();
  });
  view.imageInput.addEventListener('change', () => receiveImages(storage.selectStampImageFiles([...view.imageInput.files])));
  view.chooseFolder.hidden = !supportsDirectoryPicker(globalThis);
  view.chooseFolder.addEventListener('click', async () => {
    if (saving || selecting) return;
    try {
      imageDirectory = await storage.chooseStampImageDirectory();
      if (imageDirectory) {
        view.folderMessage.textContent = `Image folder: ${imageDirectory.name}`;
        await refresh();
      }
    } catch (error) {
      if (error?.name !== 'AbortError') {
        view.folderMessage.textContent = 'Folder unavailable. Images will be saved in this browser.';
      }
    }
  });

  view.cancel.addEventListener('click', () => { if (!saving) view.dialog.close(); });
  view.dialog.addEventListener('cancel', (event) => { if (saving) event.preventDefault(); });
  view.dialog.addEventListener('close', () => { reset(); add.focus(); });
  view.name.addEventListener('input', () => view.name.setCustomValidity(''));
  view.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving || selecting) return;
    view.name.setCustomValidity(view.name.value.trim() ? '' : 'Enter a Set Name.');
    if (!view.form.reportValidity()) return;
    saving = true;
    view.fields.disabled = true;
    view.save.disabled = true;
    view.cancel.disabled = true;
    view.message.textContent = 'Saving set…';
    view.message.dataset.tone = '';
    let saved = false;
    let usedFallback = false;
    try {
      // This is a Set-only data-quality check; generated IDs remain identity.
      const existingSets = await storage.loadSavedStampDieSets();
      const nameKey = getTagKey(view.name.value);
      if (existingSets.some((record) => record.id !== draftId && getTagKey(record.name) === nameKey)) {
        view.message.dataset.tone = 'error';
        view.message.textContent = 'A Stamp & Die Set with this name already exists. Enter a different Set Name.';
        return;
      }
      const latestCatalog = await storage.loadGlobalTagCatalog();
      const reconciled = reconcileStampDieImageTags({ tagIds: picker.getSelectedTagIds() }, latestCatalog, inferredTags);
      const record = createStampDieSetRecord({
        id: draftId,
        name: view.name.value,
        dateCreated: editingRecord?.dateCreated || getLocalDateValue(),
        releaseYear: editingRecord && editingRecord.releaseYear === undefined && !view.releaseYear.value
          ? undefined : Number(view.releaseYear.value),
        favorite: view.favorite.checked,
        tagIds: reconciled.record.tagIds
      }, reconciled.catalog);
      const prepared = await storage.prepareStampImagesForSave(draftImages);
      record.imageRefs = prepared.imageRefs;
      usedFallback = prepared.usedFallback;
      await storage.saveStampDieSet(normalizeStampDieSet(record, reconciled.catalog), { inferredTags });
      saved = true;
    } catch {
      view.message.dataset.tone = 'error';
      view.message.textContent = 'The set could not be saved. Check the release year and selected tags, or try fewer images. Your draft is still here.';
    } finally {
      saving = false;
      view.fields.disabled = false;
      view.save.disabled = false;
      view.cancel.disabled = false;
    }
    if (!saved) return;
    view.dialog.close();
    window.location.hash = '#stamps-dies';
    await refresh();
    status.textContent = status.textContent.startsWith('Sets could not')
      ? 'Set saved. Reload to display your sets.'
      : `Set saved. ${status.textContent}`;
    if (usedFallback) status.textContent += ' Images saved in this browser.';
    document.dispatchEvent(new CustomEvent('catalog:stamp-die-set-saved'));
    document.dispatchEvent(new CustomEvent('catalog:global-tags-updated', { detail: { source: 'stamp-die-save' } }));
  });

  document.addEventListener('catalog:global-tags-updated', (event) => { if (event.detail?.source !== 'stamp-die-save') return refresh(); });
  await refresh();
}

function createSetFormView() {
  const dialog = document.createElement('dialog');
  dialog.className = 'stamp-set-dialog';
  dialog.setAttribute('aria-labelledby', 'stamp-set-add-title');
  const header = document.createElement('header');
  header.className = 'card-add-header';
  const title = document.createElement('h3');
  title.id = 'stamp-set-add-title';
  title.textContent = 'Add Stamp & Die Set';
  header.append(title);
  const form = document.createElement('form');
  form.className = 'card-add-form';
  const fields = document.createElement('fieldset');
  fields.className = 'card-add-form-content card-add-controls stamp-set-fields';
  const name = document.createElement('input');
  name.name = 'name';
  name.type = 'text';
  name.required = true;
  const releaseYear = document.createElement('input');
  releaseYear.name = 'releaseYear';
  releaseYear.type = 'number';
  releaseYear.min = '1990';
  releaseYear.max = '2100';
  releaseYear.step = '1';
  releaseYear.required = true;
  const favorite = document.createElement('input');
  favorite.name = 'favorite';
  favorite.type = 'checkbox';
  const favoriteLabel = document.createElement('label');
  favoriteLabel.className = 'card-add-favorite-field';
  favoriteLabel.append(favorite, document.createTextNode('Favorite'));
  const imageControls = document.createElement('section');
  imageControls.className = 'stamp-set-image-controls';
  const imageHeading = document.createElement('h4');
  imageHeading.textContent = 'Images';
  const chooseImages = document.createElement('button');
  chooseImages.type = 'button';
  chooseImages.className = 'button';
  chooseImages.textContent = 'Choose Images';
  const imageInput = document.createElement('input');
  imageInput.type = 'file';
  imageInput.accept = '.jpg,.jpeg,.png,.webp,.gif';
  imageInput.multiple = true;
  imageInput.hidden = true;
  const chooseFolder = document.createElement('button');
  chooseFolder.type = 'button';
  chooseFolder.className = 'button';
  chooseFolder.textContent = 'Choose Image Folder';
  const folderMessage = document.createElement('p');
  const imageMessage = document.createElement('p');
  imageMessage.className = 'form-message';
  imageMessage.setAttribute('role', 'status');
  const previews = document.createElement('div');
  previews.className = 'stamp-set-draft-images';
  imageControls.append(imageHeading, chooseImages, imageInput, chooseFolder, folderMessage, imageMessage, previews);
  const tags = document.createElement('div');
  const message = document.createElement('p');
  message.className = 'form-message';
  message.setAttribute('role', 'status');
  fields.append(createField('Set Name', name), createField('Release Year', releaseYear), favoriteLabel, imageControls, tags, message);
  const actions = document.createElement('div');
  actions.className = 'card-add-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'button';
  cancel.textContent = 'Cancel';
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'button button-primary';
  save.textContent = 'Save Set';
  actions.append(cancel, save);
  form.append(fields, actions);
  dialog.append(header, form);
  return { dialog, title, form, fields, name, releaseYear, favorite, tags, message, cancel, save, chooseImages, imageInput, chooseFolder, folderMessage, imageMessage, previews };
}

function createField(text, input) {
  const label = document.createElement('label');
  label.className = 'card-add-field';
  label.append(document.createTextNode(text), input);
  return label;
}

export function renderStampDieLibrary(gallery, records, catalog, onEdit) {
  const tiles = records.map((record) => {
    const tile = document.createElement('article');
    tile.className = 'stamp-set-tile';
    const placeholder = createSetImageGrid(record.imageRefs);
    const content = document.createElement('div');
    content.className = 'stamp-set-tile-content';
    const name = document.createElement('h3');
    name.textContent = record.name;
    const release = document.createElement('p');
    release.textContent = record.releaseYear === undefined
      ? 'Release year not recorded'
      : `Release year: ${record.releaseYear}`;
    content.append(name, release);
    if (record.favorite) {
      const favorite = document.createElement('p');
      favorite.textContent = '♥ Favorite';
      content.append(favorite);
    }
    const names = projectTagNames(catalog, record.tagIds, 'stamp');
    if (names.length) {
      const tags = document.createElement('ul');
      tags.className = 'card-library-tags';
      tags.setAttribute('aria-label', 'Tags');
      for (const text of names) {
        const tag = document.createElement('li');
        tag.textContent = text;
        tags.append(tag);
      }
      content.append(tags);
    }
    if (onEdit) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'button';
      edit.textContent = 'Edit';
      edit.setAttribute('aria-label', `Edit ${record.name}`);
      edit.addEventListener('click', () => onEdit(record.id));
      content.append(edit);
    }
    tile.append(placeholder, content);
    return tile;
  });
  if (!tiles.length) {
    const empty = document.createElement('p');
    empty.className = 'card-library-empty';
    empty.textContent = 'No sets yet. Add a Stamp & Die Set to start your library.';
    tiles.push(empty);
  }
  gallery.replaceChildren(...tiles);
}

function createSetImageGrid(references = []) {
  const grid = document.createElement('div');
  grid.className = 'stamp-set-images';
  if (!references.length) {
    const empty = document.createElement('div');
    empty.className = 'stamp-set-placeholder';
    empty.textContent = 'No image';
    grid.append(empty);
  }
  for (const [index, reference] of orderStampDieImages(references).entries()) {
    const frame = document.createElement('div');
    const missing = document.createElement('div');
    missing.className = 'stamp-set-placeholder';
    missing.textContent = 'Image unavailable';
    const source = getStampLibraryImageSource(reference);
    if (source) {
      const image = document.createElement('img');
      image.src = source;
      image.alt = reference.imageName || `Set image ${index + 1}`;
      image.loading = 'lazy';
      missing.hidden = true;
      let triedFull = false;
      image.addEventListener('error', () => {
        const full = reference.imagePreviewSrc || reference.imageSrc;
        if (!triedFull && full && full !== source) { triedFull = true; image.src = full; }
        else { image.hidden = true; missing.hidden = false; }
      });
      frame.append(image);
    }
    frame.append(missing);
    grid.append(frame);
  }
  return grid;
}
