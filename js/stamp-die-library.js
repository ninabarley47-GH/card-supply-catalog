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
    favorite: values.favorite,
    tagIds: values.tagIds,
    imageRefs: []
  }, catalog);
}

function createSetId() {
  const randomPart = globalThis.crypto?.randomUUID?.();
  return randomPart
    ? `set-${randomPart}`
    : `set-${new Date().toISOString().replace(/\D/g, '')}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function initializeStampDieLibrary(services = {}) {
  const storage = { loadGlobalTagCatalog, loadSavedStampDieSets, saveStampDieSet, ...services };
  const screen = document.getElementById('stamps-dies');
  if (!screen) return;
  const add = screen.querySelector('[data-add-set]');
  const gallery = screen.querySelector('[data-set-library]');
  const status = screen.querySelector('[data-set-library-status]');
  const view = createAddSetView();
  document.body.append(view.dialog);
  let catalog;
  let picker;
  let draftId;
  let saving = false;

  function reset() {
    view.form.reset();
    view.name.setCustomValidity('');
    view.dateCreated.value = getLocalDateValue();
    picker?.reset();
    view.message.textContent = '';
    draftId = null;
  }

  async function refresh() {
    try {
      const [records, nextCatalog] = await Promise.all([
        storage.loadSavedStampDieSets(), storage.loadGlobalTagCatalog()
      ]);
      catalog = nextCatalog;
      renderStampDieLibrary(gallery, records, catalog);
      status.textContent = `${records.length} set${records.length === 1 ? '' : 's'}`;
    } catch {
      status.textContent = 'Sets could not be loaded. Reload to try again.';
    }
  }

  add.addEventListener('click', async () => {
    add.disabled = true;
    try {
      catalog = await storage.loadGlobalTagCatalog();
      reset();
      if (!picker) {
        picker = createTagPicker({ label: 'Tags', productType: 'stamp', catalog });
        view.tags.append(picker.element);
      } else picker.setCatalog(catalog);
      draftId = createSetId();
      view.dialog.showModal();
      view.name.focus();
    } catch {
      status.textContent = 'Add Set could not be opened. Please try again.';
    } finally { add.disabled = false; }
  });

  view.cancel.addEventListener('click', () => { if (!saving) view.dialog.close(); });
  view.dialog.addEventListener('cancel', (event) => { if (saving) event.preventDefault(); });
  view.dialog.addEventListener('close', () => { reset(); add.focus(); });
  view.name.addEventListener('input', () => view.name.setCustomValidity(''));
  view.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    view.name.setCustomValidity(view.name.value.trim() ? '' : 'Enter a Set Name.');
    if (!view.form.reportValidity()) return;
    saving = true;
    view.fields.disabled = true;
    view.save.disabled = true;
    view.cancel.disabled = true;
    view.message.textContent = 'Saving set…';
    let saved = false;
    try {
      // This is a Set-only data-quality check; generated IDs remain identity.
      const existingSets = await storage.loadSavedStampDieSets();
      const nameKey = getTagKey(view.name.value);
      if (existingSets.some((record) => getTagKey(record.name) === nameKey)) {
        view.message.textContent = 'A Stamp & Die Set with this name already exists. Enter a different Set Name.';
        return;
      }
      catalog = await storage.loadGlobalTagCatalog();
      const record = createStampDieSetRecord({
        id: draftId,
        name: view.name.value,
        dateCreated: view.dateCreated.value,
        favorite: view.favorite.checked,
        tagIds: picker.getSelectedTagIds()
      }, catalog);
      await storage.saveStampDieSet(record);
      saved = true;
    } catch {
      view.message.textContent = 'The set could not be saved. Check the date and selected tags, then try again.';
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
    document.dispatchEvent(new CustomEvent('catalog:stamp-die-set-saved'));
  });

  document.addEventListener('catalog:global-tags-updated', refresh);
  await refresh();
}

function createAddSetView() {
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
  const dateCreated = document.createElement('input');
  dateCreated.name = 'dateCreated';
  dateCreated.type = 'date';
  dateCreated.required = true;
  const favorite = document.createElement('input');
  favorite.name = 'favorite';
  favorite.type = 'checkbox';
  const favoriteLabel = document.createElement('label');
  favoriteLabel.className = 'card-add-favorite-field';
  favoriteLabel.append(favorite, document.createTextNode('Favorite'));
  const tags = document.createElement('div');
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  fields.append(createField('Set Name', name), createField('Date Created', dateCreated), favoriteLabel, tags, message);
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
  return { dialog, form, fields, name, dateCreated, favorite, tags, message, cancel, save };
}

function createField(text, input) {
  const label = document.createElement('label');
  label.className = 'card-add-field';
  label.append(document.createTextNode(text), input);
  return label;
}

export function renderStampDieLibrary(gallery, records, catalog) {
  const tiles = records.map((record) => {
    const tile = document.createElement('article');
    tile.className = 'stamp-set-tile';
    const placeholder = document.createElement('div');
    placeholder.className = 'stamp-set-placeholder';
    placeholder.textContent = 'No image';
    const content = document.createElement('div');
    content.className = 'stamp-set-tile-content';
    const name = document.createElement('h3');
    name.textContent = record.name;
    const date = document.createElement('p');
    const time = document.createElement('time');
    time.dateTime = record.dateCreated;
    time.textContent = record.dateCreated;
    date.append(document.createTextNode('Created '), time);
    content.append(name, date);
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
