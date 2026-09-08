import { detailNavigation } from './detail-navigation.js';
import { CATALOG_SCHEMA_VERSION } from './schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeStampDieLibrary, createStampDieSetRecord, findCardsUsingStampDieSet } from './stamp-die-library.js';
import { getLocalDateValue } from './ui.js';

const initialCatalog = () => ({
  schemaVersion: 1,
  tags: [
    { id: 'stable-paper', name: 'Floral', appliesTo: ['paper'], categoryIds: ['nature'] },
    { id: 'stable-card', name: 'Birthday', appliesTo: ['card'], categoryIds: [] }
  ],
  categories: [{ id: 'nature', name: 'Nature' }]
});

// Minimal DOM/event harness runs the real form and shared tag picker without dependencies.
class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.className = '';
    this.ownText = '';
  }
  set textContent(value) { this.ownText = value; this.children = []; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(''); }
  get options() { return this.children; }
  get parentElement() { return this.parent; }
  get childElementCount() { return this.children.length; }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.ownText = ''; this.append(...children); }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  async emit(type, values = {}) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...values };
    for (const listener of this.listeners[type] || []) await listener(event);
    return event;
  }
  dispatchEvent(event) { return this.emit(event.type, { target: event.target || this, detail: event.detail }); }
  remove() { this.parent.children = this.parent.children.filter((child) => child !== this); }
  get classList() { return { toggle() {} }; }
  matches(selector) {
    for (const match of selector.matchAll(/:not\(([^)]+)\)/g)) if (this.matches(match[1])) return false;
    selector = selector.replace(/:not\([^)]+\)/g, '');
    if (selector.includes(':checked') && !this.checked) return false;
    selector = selector.replace(/:checked/g, '');
    const tag = selector.match(/^[a-z][a-z0-9]*/);
    if (tag && this.tagName !== tag[0]) return false;
    const className = selector.match(/\.([\w-]+)/);
    if (className && !this.className.split(' ').includes(className[1])) return false;
    for (const match of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      const key = match[1];
      const value = key.startsWith('data-')
        ? this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())]
        : this[key] ?? this.attributes[key];
      if (value === undefined || (match[2] !== undefined && value !== match[2])) return false;
    }
    return true;
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector); }
  focus() { globalThis.document.activeElement = this; }
  setCustomValidity(value) { this.validationMessage = value; }
  reportValidity() { return this.querySelectorAll('input').every((input) => !input.validationMessage && (!input.required || input.value !== '')); }
  reset() { for (const input of this.querySelectorAll('input')) { input.value = ''; input.checked = false; } }
  showModal() { this.open = true; }
  close() { this.open = false; return this.emit('close'); }
}

async function harness(t, otherCatalogServices = {}) {
  const previous = { document: globalThis.document, window: globalThis.window, Option: globalThis.Option };
  t.after(() => { detailNavigation.close(); Object.assign(globalThis, previous); });
  const document = new Element('document');
  document.createElement = (name) => new Element(name);
  document.createTextNode = (text) => Object.assign(new Element('text'), { textContent: text });
  document.body = new Element('body');
  document.append(document.body);
  document.getElementById = (id) => document.querySelectorAll('[id]').find((element) => element.id === id);
  const screen = Object.assign(new Element('section'), { id: 'stamps-dies' });
  const add = new Element('button'); add.dataset.addSet = '';
  const gallery = new Element('div'); gallery.dataset.setLibrary = '';
  const status = new Element('p'); status.dataset.setLibraryStatus = '';
  screen.append(add, gallery, status);
  document.body.append(screen);
  const headerAdd = new Element('button'); headerAdd.dataset.addStampSetOpen = '';
  document.body.append(headerAdd);
  const filterForm = new Element('form'); filterForm.dataset.setLibraryFilterForm = '';
  const filterControls = {};
  for (const [key, tag] of Object.entries({ search: 'input', owner: 'select', year: 'select', favorites: 'button', clear: 'button', clearTags: 'button', toggleTags: 'button', tagFilters: 'fieldset' })) {
    const control = new Element(tag);
    control.dataset['setLibrary' + key[0].toUpperCase() + key.slice(1)] = '';
    filterControls[key] = control;
    filterForm.append(control);
  }
  document.body.append(filterForm);
  globalThis.Option = function(text, value) { return Object.assign(new Element('option'), { textContent: text, value }); };
  globalThis.document = document;
  globalThis.window = { location: { hash: '#stamps-dies' } };
  const records = [];
  let catalog = initialCatalog();
  let failure = false;
  let commitGate;
  let calls = 0;
  const saveOptions = [];
  let recordReads = 0;
  const owners = [{ id: 'owner-nina', name: 'Nina' }, { id: 'owner-amanda', name: 'Amanda' }];
  await initializeStampDieLibrary({
    owners,
    loadDefaultOwnerId: async () => 'owner-nina',
    loadCatalogSetting: async () => '',
    saveCatalogSetting: async () => {},
    loadGlobalTagCatalog: async () => structuredClone(catalog),
    loadSavedStampDieSets: async () => { recordReads++; return structuredClone(records); },
    saveStampDieSet: async (record, options) => {
      calls += 1;
      saveOptions.push(structuredClone(options));
      if (commitGate) await commitGate;
      if (failure) throw new Error('Storage unavailable');
      const index = records.findIndex((entry) => entry.id === record.id);
      if (index === -1) records.push(structuredClone(record));
      else records[index] = structuredClone(record);
      const changes = options?.cardRelationshipChanges || { add: [], remove: [] };
      return (otherCatalogServices.cards || []).filter(card => changes.add.includes(card.id) || changes.remove.includes(card.id))
        .map(card => ({ ...card, stampDieSetIds: changes.add.includes(card.id)
          ? [...new Set([...(card.stampDieSetIds || []), record.id])]
          : (card.stampDieSetIds || []).filter(id => id !== record.id) }));
    },
    ...otherCatalogServices
  });
  const dialog = document.querySelector('dialog');
  const form = dialog.querySelector('form');
  const name = form.querySelector('input[name="name"]');
  const year = form.querySelector('input[name="releaseYear"]');
  const favorite = form.querySelector('input[name="favorite"]');
  const cancel = form.querySelectorAll('button').find((button) => button.textContent === 'Cancel');
  async function select(id) {
    const input = form.querySelector(`[data-tag-id="${id}"]`);
    input.checked = true;
    await form.querySelector('.global-tag-picker').emit('change', { target: input });
  }
  return { headerAdd, saveOptions, filterControls, owners, owner: form.querySelector('select[name="ownerId"]'), newOwner: form.querySelector('input[name="owner"]'), document, add, gallery, status, dialog, form, name, year, favorite, cancel, records, select,
    recordReads: () => recordReads, calls: () => calls, setFailure: (value) => { failure = value; }, setGate: (value) => { commitGate = value; },
    renameTag: () => { catalog.tags[0].name = 'Botanical'; } };
}

test('Add Set opens with current release year, empty name/tags and Favorite off; blank names cannot save', async (t) => {
  const h = await harness(t);
  await h.add.emit('click');
  assert.equal(h.dialog.open, true);
  assert.equal(h.document.activeElement, h.name);
  assert.equal(h.name.value, '');
  assert.equal(h.year.value, String(new Date().getFullYear()));
  assert.equal(h.favorite.checked, false);
  h.name.value = '   ';
  await h.form.emit('submit');
  assert.equal(h.records.length, 0);
  assert.equal(h.name.validationMessage, 'Enter a Set Name.');
});

test('header Add Stamp Set opens the existing Add form and saves through its normal workflow', async (t) => {
  const h = await harness(t);
  globalThis.window.location.hash = '#library';
  await h.headerAdd.emit('click');
  assert.equal(h.dialog.className, 'stamp-set-dialog stamp-set-form-panel');
  assert.equal(h.dialog.open, true);
  assert.equal(h.document.activeElement, h.name);
  assert.equal(h.name.value, '');
  h.name.value = 'Header Set';
  await h.headerAdd.emit('click');
  assert.equal(h.name.value, 'Header Set');
  await h.form.emit('submit');
  assert.equal(h.records.length, 1);
  assert.equal(h.records[0].name, 'Header Set');
  assert.equal(h.dialog.open, false);
  await h.add.emit('click');
  assert.equal(h.dialog.open, true);
  assert.equal(h.name.value, '');
});

test('Stamp form uses a full-height right-edge panel without moving Stamp Detail', async () => {
  const css = await readFile(new URL('../css/cards.css', import.meta.url), 'utf8');
  const panel = css.match(/\.stamp-set-form-panel\s*\{([^}]+)\}/)[1];
  assert.match(panel, /position: fixed/);
  assert.match(panel, /inset: 0 0 0 auto/);
  assert.match(panel, /margin: 0/);
  assert.match(panel, /width: min\(34rem, 100vw\)/);
  assert.match(panel, /height: 100dvh/);
  assert.match(panel, /border-radius: 0/);
});

test('shared date helper uses local calendar components, including year boundaries', () => {
  assert.equal(getLocalDateValue(new Date(2026, 0, 1, 0, 1)), '2026-01-01');
  assert.equal(getLocalDateValue(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
});

test('save persists Favorite and universal stable tag IDs, then renders a no-image Set', async (t) => {
  const h = await harness(t);
  await h.add.emit('click');
  assert.ok(h.form.querySelector('[data-tag-id="stable-paper"]'));
  assert.ok(h.form.querySelector('[data-tag-id="stable-card"]'));
  assert.equal(h.form.querySelector('[data-tag-id="nature"]'), null);
  assert.ok(h.form.querySelector('[data-category-id="nature"]'));
  h.name.value = '  Garden  ';
  h.year.value = '2024';
  h.favorite.checked = true;
  await h.select('stable-paper');
  await h.select('stable-card');
  let saves = 0;
  h.document.addEventListener('catalog:stamp-die-set-saved', () => saves++);
  await h.form.emit('submit');
  const record = h.records[0];
  assert.match(record.id, /^set-/);
  assert.deepEqual(record, { schemaVersion: CATALOG_SCHEMA_VERSION, id: record.id, ownerId: 'owner-nina', name: 'Garden', dateCreated: getLocalDateValue(), releaseYear: 2024, favorite: true, tagIds: ['stable-paper', 'stable-card'], imageRefs: [] });
  assert.equal(h.dialog.open, false);
  assert.equal(saves, 1);
  assert.match(h.gallery.textContent, /Garden.*No image.*Floral.*Birthday.*2024/);
  assert.equal(h.gallery.querySelector('img'), null);
  h.renameTag();
  await h.document.emit('catalog:global-tags-updated');
  assert.match(h.gallery.textContent, /Botanical/);
  assert.deepEqual(h.records[0].tagIds, ['stable-paper', 'stable-card']);
});

test('Cancel and Escape discard all fields and picker search; reopening starts clean', async (t) => {
  const h = await harness(t);
  for (const action of ['cancel', 'escape']) {
    await h.add.emit('click');
    h.name.value = 'Unsaved';
    h.year.value = '2000';
    h.favorite.checked = true;
    await h.select('stable-paper');
    h.form.querySelector('input[type="search"]').value = 'floral';
    if (action === 'cancel') await h.cancel.emit('click');
    else {
      const event = await h.dialog.emit('cancel');
      if (!event.defaultPrevented) await h.dialog.close();
    }
    assert.equal(h.dialog.open, false);
    assert.equal(h.records.length, 0);
    assert.equal(h.document.activeElement, h.add);
    await h.add.emit('click');
    assert.equal(h.name.value, '');
    assert.equal(h.year.value, String(new Date().getFullYear()));
    assert.equal(h.favorite.checked, false);
    assert.ok(h.form.querySelectorAll('[data-tag-id]').every((input) => !input.checked));
    assert.equal(h.form.querySelector('input[type="search"]').value, '');
    await h.cancel.emit('click');
  }
});

test('distinct Set names save with separate generated IDs', async (t) => {
  const h = await harness(t);
  for (let index = 0; index < 2; index++) {
    await h.add.emit('click');
    h.name.value = index === 0 ? 'Beautiful Balloons' : 'Beautiful Flowers';
    await h.form.emit('submit');
  }
  assert.equal(h.records.length, 2);
  assert.notEqual(h.records[0].id, h.records[1].id);
});

for (const [variation, duplicateName] of [
  ['exact', 'Beautiful Balloons'],
  ['case-only', 'beautiful balloons'],
  ['surrounding whitespace', '  Beautiful Balloons  '],
  ['repeated internal whitespace', 'Beautiful   Balloons']
]) {
  test(`${variation} duplicate is rejected without losing the draft; correcting the name saves`, async (t) => {
    const h = await harness(t);
    await h.add.emit('click');
    h.name.value = 'Beautiful Balloons';
    await h.form.emit('submit');
    const original = structuredClone(h.records[0]);
    await h.add.emit('click');
    h.name.value = duplicateName;
    h.year.value = '2023';
    h.favorite.checked = true;
    await h.select('stable-paper');
    await h.form.emit('submit');
    assert.equal(h.calls(), 1);
    assert.deepEqual(h.records, [original]);
    assert.equal(h.dialog.open, true);
    assert.match(h.form.textContent, /A Stamp & Die Set with this name already exists/);
    assert.equal(h.name.value, duplicateName);
    assert.equal(h.year.value, '2023');
    assert.equal(h.favorite.checked, true);
    assert.equal(h.form.querySelector('[data-tag-id="stable-paper"]').checked, true);
    assert.equal(h.form.querySelector('fieldset').disabled, false);
    h.name.value = 'Beautiful Flowers';
    await h.name.emit('input');
    await h.form.emit('submit');
    assert.equal(h.dialog.open, false);
    assert.equal(h.records.length, 2);
    assert.deepEqual(h.records[1].tagIds, ['stable-paper']);
    assert.equal(h.records[1].favorite, true);
    assert.equal(h.records[1].releaseYear, 2023);
    assert.equal(h.records[1].dateCreated, getLocalDateValue());
    assert.notEqual(h.records[1].id, original.id);
  });
}

test('same names in Paper and Cards are irrelevant to Set validation', async (t) => {
  const paperRecords = [{ id: 'paper-one', name: 'Beautiful Balloons' }];
  const cardRecords = [{ id: 'card-one', name: 'Beautiful Balloons' }];
  let otherCatalogReads = 0;
  const h = await harness(t, {
    loadSavedPaperPacks: async () => { otherCatalogReads++; return paperRecords; },
    loadSavedCards: async () => { otherCatalogReads++; return cardRecords; }
  });
  await h.add.emit('click');
  h.name.value = 'Beautiful Balloons';
  await h.form.emit('submit');
  assert.equal(h.records.length, 1);
  assert.equal(h.records[0].name, paperRecords[0].name);
  assert.equal(h.records[0].name, cardRecords[0].name);
  assert.equal(otherCatalogReads, 0);
});

test('duplicate check reads saved Sets again at submit, rather than the opening Library snapshot', async (t) => {
  const h = await harness(t);
  await h.add.emit('click');
  h.name.value = 'Beautiful Balloons';
  const existing = createStampDieSetRecord({ name: '  BEAUTIFUL   BALLOONS  ', dateCreated: '2026-08-01', favorite: false, tagIds: [] }, initialCatalog());
  h.records.push(existing);
  await h.form.emit('submit');
  assert.equal(h.calls(), 0);
  assert.deepEqual(h.records, [existing]);
  assert.equal(h.dialog.open, true);
  assert.match(h.form.textContent, /already exists/);
});

test('failed save preserves the draft and retry succeeds; pending save blocks duplicate submits', async (t) => {
  const h = await harness(t);
  await h.add.emit('click');
  h.name.value = 'Keep draft';
  h.setFailure(true);
  await h.form.emit('submit');
  assert.equal(h.dialog.open, true);
  assert.equal(h.name.value, 'Keep draft');
  assert.equal(h.records.length, 0);
  assert.match(h.form.textContent, /could not be saved/);
  h.setFailure(false);
  let release;
  h.setGate(new Promise((resolve) => { release = resolve; }));
  const saving = h.form.emit('submit');
  await Promise.resolve();
  await h.form.emit('submit');
  await h.cancel.emit('click');
  const close = h.dialog.querySelector('.card-add-close');
  assert.equal(close.disabled, true);
  await close.emit('click');
  assert.equal((await h.dialog.emit('cancel')).defaultPrevented, true);
  assert.equal(h.dialog.open, true);
  assert.equal(h.calls(), 2);
  release();
  await saving;
  assert.equal(h.records.length, 1);
});

test('record creation rejects malformed dates/category assignments and supports optional images', () => {
  const input = { name: 'Garden', dateCreated: '2026-09-01', favorite: false, tagIds: [] };
  assert.throws(() => createStampDieSetRecord({ ...input, dateCreated: '2026-02-30' }, initialCatalog()));
  assert.throws(() => createStampDieSetRecord({ ...input, tagIds: ['nature'] }, initialCatalog()));
  assert.deepEqual(createStampDieSetRecord(input, initialCatalog()).imageRefs, []);
  assert.deepEqual(createStampDieSetRecord({ ...input, imageRefs: [{ imagePath: 'selected.jpg' }] }, initialCatalog()).imageRefs, [{ imagePath: 'selected.jpg' }]);
});

test('Add Set is wired into the application and offline shell with isolated image handling', async () => {
  const [app, shell, html, source, settings] = await Promise.all(['app.js', '../sw.js', '../index.html', 'stamp-die-library.js', 'settings.js'].map((file) => readFile(new URL(file, import.meta.url), 'utf8')));
  assert.match(app, /await initializeStampDieLibrary\(\{ owners, cards \}\)/);
  assert.match(shell, /\.\/js\/stamp-die-library\.js/);
  assert.match(shell, /\.\/js\/ui\.js/);
  assert.match(html, /data-add-set>Add Set/);
  const header = html.match(/<div class="header-actions"[\s\S]*?<\/div>/)[0];
  assert.match(header, /class="button button-primary"[^>]*data-add-stamp-set-open[^>]*aria-haspopup="dialog">[\s\S]*?Add Stamp Set/);
  assert.match(header, /data-add-dsp-open>\s*<span aria-hidden="true">\+<\/span>\s*Add Paper/);
  assert.doesNotMatch(header, /Add DSP/);
  assert.match(settings, /catalog:stamp-die-set-saved/);
  assert.doesNotMatch(source, /showOpenFilePicker|showDirectoryPicker|FileReader|createObjectURL|createWritable/);
  assert.match(shell, /\.\/js\/image-references\.js/);
  assert.match(shell, /\.\/js\/stamp-die-images\.js/);
});


test('Library does not present an older creation date as a release year', async (t) => {
  const h = await harness(t);
  h.records.push(createStampDieSetRecord({ name: 'Older Set', dateCreated: '2020-05-01', favorite: false, tagIds: [] }, initialCatalog()));
  await h.document.emit('catalog:global-tags-updated');
  assert.match(h.gallery.textContent, /Release year not recorded/);
  assert.doesNotMatch(h.gallery.textContent, /2020/);
});

test('Add Set previews selected images in order, preserves manual tag removal on save, and renders all images', async (t) => {
  const imageCatalog = initialCatalog();
  imageCatalog.tags.push({ id: 'stamp', name: 'Stamp', categoryIds: [] }, { id: 'die', name: 'Die', categoryIds: [] });
  let preparedNames;
  const h = await harness(t, {
    loadGlobalTagCatalog: async () => structuredClone(imageCatalog),
    selectStampImageFiles: async (files) => files.map((file) => ({ file, name: file.name, previewSrc: 'data:image/jpeg;base64,cHJldmlldw==' })),
    prepareStampImagesForSave: async (images) => {
      preparedNames = images.map((image) => image.name);
      return { usedFallback: true, imageRefs: images.map((image) => ({ imageName: image.name, imageSrc: 'data:image/jpeg;base64,ZnVsbA==', thumbnailImageSrc: 'data:image/jpeg;base64,dGh1bWI=', imageStorageStrategy: 'embedded-indexed-db' })) };
    }
  });
  await h.add.emit('click');
  h.name.value = 'Both images';
  await h.select('stable-paper');
  const input = h.form.querySelector('input[type="file"]');
  assert.equal(input.multiple, true);
  input.files = [{ name: 'stamp.jpg' }, { name: 'DIES.jpg' }];
  await input.emit('change');
  assert.deepEqual(h.form.querySelector('.stamp-set-draft-images').querySelectorAll('img').map((image) => image.alt), ['stamp.jpg', 'DIES.jpg']);
  const stamp = h.form.querySelector('[data-tag-id="stamp"]');
  const die = h.form.querySelector('[data-tag-id="die"]');
  assert.equal(stamp.checked, true);
  assert.equal(die.checked, true);
  die.checked = false;
  await h.form.querySelector('.global-tag-picker').emit('change', { target: die });
  await h.form.emit('submit');
  assert.deepEqual(preparedNames, ['stamp.jpg', 'DIES.jpg']);
  assert.deepEqual(h.records[0].tagIds, ['stable-paper', 'stamp']);
  assert.deepEqual(h.gallery.querySelectorAll('img').map((image) => image.alt), ['stamp.jpg', 'DIES.jpg']);
  assert.ok(h.gallery.querySelectorAll('img').every((image) => image.src === 'data:image/jpeg;base64,dGh1bWI='));
  const displayed = h.gallery.querySelector('img');
  await displayed.emit('error');
  assert.equal(displayed.src, 'data:image/jpeg;base64,ZnVsbA==');
  await displayed.emit('error');
  assert.equal(displayed.hidden, true);
});

test('draft image removal never removes inferred tags; Cancel discards images without preparation or persistence', async (t) => {
  let preparationCalls = 0;
  const h = await harness(t, {
    selectStampImageFiles: async (files) => files.map((file) => ({ file, name: file.name, previewSrc: 'data:image/jpeg;base64,cHJldmlldw==' })),
    prepareStampImagesForSave: async () => { preparationCalls++; throw new Error('Must not save'); }
  });
  await h.add.emit('click');
  const input = h.form.querySelector('input[type="file"]');
  input.files = [{ name: 'stamp.jpg' }, { name: 'die.jpg' }];
  await input.emit('change');
  const previews = h.form.querySelector('.stamp-set-draft-images');
  await previews.querySelector('button').emit('click');
  assert.deepEqual(previews.querySelectorAll('img').map((image) => image.alt), ['die.jpg']);
  assert.equal(h.form.querySelectorAll('[data-tag-id]').filter((checkbox) => checkbox.checked).length, 2);
  await h.cancel.emit('click');
  assert.equal(preparationCalls, 0);
  assert.equal(h.records.length, 0);
  await h.add.emit('click');
  assert.equal(previews.children.length, 0);
  assert.equal(h.form.querySelectorAll('[data-tag-id]').filter((checkbox) => checkbox.checked).length, 0);
  assert.equal(h.form.querySelectorAll('[data-tag-id]').length, 2); // Only the original global tags remain.
});

test('cancel during image loading discards late results without restoring draft state', async (t) => {
  let release;
  const h = await harness(t, {
    selectStampImageFiles: () => new Promise((resolve) => { release = resolve; })
  });
  await h.add.emit('click');
  const input = h.form.querySelector('input[type="file"]');
  input.files = [{ name: 'stamp.jpg' }];
  const selection = input.emit('change');
  await h.cancel.emit('click');
  release([{ name: 'stamp.jpg', previewSrc: 'data:image/jpeg;base64,cHJldmlldw==' }]);
  await selection;
  await h.add.emit('click');
  assert.equal(h.form.querySelector('.stamp-set-draft-images').children.length, 0);
  assert.equal(h.records.length, 0);
});

async function seedEdit(h, overrides = {}) {
  h.records.push(createStampDieSetRecord({ id: 'set-existing', name: 'Original',
    dateCreated: '2020-01-02', releaseYear: 2022, favorite: true,
    tagIds: ['stable-paper'], imageRefs: [], ...overrides }, initialCatalog()));
  await h.document.emit('catalog:global-tags-updated');
  await h.gallery.querySelector('button[aria-label="Edit Original"]').emit('click');
}

const editReferences = () => [
  { imageName: 'Stamp.jpg', imageSrc: 'data:image/jpeg;base64,YQ==', thumbnailImageSrc: 'data:image/jpeg;base64,Yg==', imageStorageStrategy: 'embedded-indexed-db' },
  { imageName: 'Dies.jpg', imagePath: 'Dies.jpg', imageLibrary: 'stamp-die-images', thumbnailImagePath: 'Dies.thumb.jpg', imageStorageStrategy: 'local-folder' }
];

test('Edit loads fields and existing images without inference; unchanged save preserves ID, metadata, tags and image fields', async (t) => {
  const h = await harness(t, { hydrateStampImages: async () => {} });
  await seedEdit(h, { imageRefs: editReferences() });
  const before = structuredClone(h.records[0]);
  assert.match(h.dialog.textContent, /Edit Stamp & Die Set/);
  assert.equal(h.name.value, 'Original');
  assert.equal(h.year.value, '2022');
  assert.equal(h.favorite.checked, true);
  assert.equal(h.form.querySelector('[data-tag-id="stable-paper"]').checked, true);
  assert.equal(h.form.querySelectorAll('[data-tag-id]').length, 2);
  assert.deepEqual(h.form.querySelectorAll('img').map((image) => image.alt), ['Stamp.jpg', 'Dies.jpg']);
  await h.form.emit('submit');
  assert.equal(h.dialog.open, false);
  assert.deepEqual(h.records, [before]);
});

test('Edit rename, Release Year, Favorite and canonical tag changes update one stable record', async (t) => {
  const h = await harness(t);
  await seedEdit(h);
  h.name.value = '  Renamed  ';
  h.year.value = '2025';
  h.favorite.checked = false;
  await h.select('stable-card');
  await h.form.emit('submit');
  assert.deepEqual(h.records, [{ schemaVersion: CATALOG_SCHEMA_VERSION, id: 'set-existing', name: 'Renamed', dateCreated: '2020-01-02', releaseYear: 2025, favorite: false, tagIds: ['stable-paper', 'stable-card'], imageRefs: [] }]);
  assert.match(h.gallery.textContent, /Renamed.*2025/);
});

test('Edit duplicate conflict and storage failure preserve draft for retry', async (t) => {
  const h = await harness(t);
  await seedEdit(h);
  h.records.push(createStampDieSetRecord({ id: 'another', name: 'Other Set', dateCreated: '2020-01-01', favorite: false, tagIds: [], imageRefs: [] }, initialCatalog()));
  h.name.value = '  OTHER   set  ';
  await h.form.emit('submit');
  assert.match(h.form.textContent, /already exists/);
  assert.equal(h.name.value, '  OTHER   set  ');
  assert.equal(h.records[0].name, 'Original');
  h.name.value = 'Corrected';
  h.setFailure(true);
  await h.form.emit('submit');
  assert.equal(h.dialog.open, true);
  assert.equal(h.name.value, 'Corrected');
  h.setFailure(false);
  await h.form.emit('submit');
  assert.equal(h.records.length, 2);
  assert.equal(h.records[0].name, 'Corrected');
});

for (const dismiss of ['cancel', 'escape']) {
  test(`Edit ${dismiss} discards added/removed images and fields; reopen reads persisted state`, async (t) => {
    let prepared = 0;
    const h = await harness(t, {
      hydrateStampImages: async () => {},
      selectStampImageFiles: async (files) => files.map((file) => ({ name: file.name, file, previewSrc: 'data:image/jpeg;base64,YQ==' })),
      prepareStampImagesForSave: async () => { prepared++; throw new Error('Unexpected image write'); }
    });
    await seedEdit(h, { imageRefs: editReferences() });
    const before = structuredClone(h.records);
    await h.form.querySelector('.stamp-set-draft-images').querySelector('button').emit('click');
    const input = h.form.querySelector('input[type="file"]');
    input.files = [{ name: 'new masks.jpg' }];
    await input.emit('change');
    h.name.value = 'Discard me';
    if (dismiss === 'cancel') await h.cancel.emit('click');
    else { const event = await h.dialog.emit('cancel'); if (!event.defaultPrevented) await h.dialog.close(); }
    assert.deepEqual(h.records, before);
    assert.equal(prepared, 0);
    await h.gallery.querySelector('button[aria-label="Edit Original"]').emit('click');
    assert.equal(h.name.value, 'Original');
    assert.deepEqual(h.form.querySelectorAll('img').map((image) => image.alt), ['Stamp.jpg', 'Dies.jpg']);
    assert.equal(h.form.querySelectorAll('[data-tag-id]').length, 2);
  });
}

test('Edit new images infer all types only at selection; manual removal survives Save and removal keeps tags', async (t) => {
  const catalog = initialCatalog();
  for (const name of ['Stamp', 'Die', 'Mask']) catalog.tags.push({ id: name, name, categoryIds: [] });
  const h = await harness(t, {
    loadGlobalTagCatalog: async () => structuredClone(catalog),
    hydrateStampImages: async () => {},
    selectStampImageFiles: async (files) => files.map((file) => ({ name: file.name, file, previewSrc: 'data:image/jpeg;base64,YQ==' })),
    prepareStampImagesForSave: async (images) => ({ usedFallback: false, imageRefs: images.map((image) => image.existingReference || { imageName: image.name, imageSrc: 'data:image/jpeg;base64,YQ==' }) })
  });
  await seedEdit(h, { imageRefs: editReferences() });
  const input = h.form.querySelector('input[type="file"]');
  input.files = ['Masks 1.jpg', 'DIES MASK.jpg', 'Flower 1.jpg', 'Masks 2.jpg', 'dies 2.jpg', 'Flower 2.jpg'].map((name) => ({ name }));
  await input.emit('change');
  for (const id of ['Stamp', 'Die', 'Mask']) assert.equal(h.form.querySelector(`[data-tag-id="${id}"]`).checked, true);
  const expected = ['Stamp.jpg', 'Flower 1.jpg', 'Flower 2.jpg', 'Dies.jpg', 'DIES MASK.jpg', 'dies 2.jpg', 'Masks 1.jpg', 'Masks 2.jpg'];
  assert.deepEqual(h.form.querySelectorAll('img').map((image) => image.alt), expected);
  const die = h.form.querySelector('[data-tag-id="Die"]');
  die.checked = false;
  await h.form.querySelector('.global-tag-picker').emit('change', { target: die });
  // Remove every Mask image; its tag must remain assigned.
  for (let i = 0; i < 2; i++) {
    const buttons = h.form.querySelector('.stamp-set-draft-images').querySelectorAll('button');
    await buttons.at(-1).emit('click');
  }
  await h.form.emit('submit');
  assert.equal(h.records.length, 1);
  assert.deepEqual(h.records[0].tagIds, ['stable-paper', 'Mask', 'Stamp']);
  assert.deepEqual(h.records[0].imageRefs.map((image) => image.imageName), expected.slice(0, -2));
  assert.deepEqual(h.gallery.querySelectorAll('img').map((image) => image.alt), expected.slice(0, -2).filter((name) => name !== 'Dies.jpg'));
  assert.match(h.gallery.textContent, /Image unavailable/);
});

test('late image reads from canceled Edit cannot enter a reopened session for the same ID', async (t) => {
  let release;
  const h = await harness(t, { selectStampImageFiles: () => new Promise((resolve) => { release = resolve; }) });
  await seedEdit(h);
  const input = h.form.querySelector('input[type="file"]');
  input.files = [{ name: 'Late die.jpg' }];
  const selecting = input.emit('change');
  await h.cancel.emit('click');
  await h.gallery.querySelector('button[aria-label="Edit Original"]').emit('click');
  release([{ name: 'Late die.jpg', previewSrc: 'data:image/jpeg;base64,YQ==' }]);
  await selecting;
  assert.equal(h.form.querySelectorAll('img').length, 0);
  assert.equal(h.form.querySelectorAll('[data-tag-id]').length, 2);
  await h.form.emit('submit');
  assert.deepEqual(h.records[0].imageRefs, []);
});

test('unchanged legacy Edit leaves an unknown Release Year absent instead of inventing one', async (t) => {
  const h = await harness(t);
  await seedEdit(h, { releaseYear: undefined });
  const before = structuredClone(h.records);
  assert.equal(h.year.value, '');
  await h.form.emit('submit');
  assert.equal(h.dialog.open, false);
  assert.deepEqual(h.records, before);
});

function setDetail(h) { return h.document.querySelector('.stamp-set-detail'); }

test('Library click and keyboard open correct Detail metadata and canonical tags; close and Escape return focus', async (t) => {
  const h = await harness(t);
  await seedEdit(h);
  await h.cancel.emit('click');
  const tile = h.gallery.querySelector('article');
  await tile.emit('click');
  const detail = setDetail(h);
  assert.equal(detail.open, true);
  assert.match(detail.textContent, /Original.*No image.*2022.*Floral/);
  assert.equal(h.calls(), 0);
  await detail.querySelector('.card-detail-close').emit('click');
  assert.equal(detail.open, false);
  assert.equal(h.document.activeElement, tile);
  await tile.emit('keydown', { key: 'Enter' });
  assert.equal(detail.open, true);
  const event = await detail.emit('cancel');
  if (!event.defaultPrevented) await detail.close();
  assert.equal(detail.open, false);
  assert.equal(h.document.activeElement, tile);
  h.records.push(createStampDieSetRecord({ id: 'second', name: 'Second Set', dateCreated: '2020-01-01', favorite: false, tagIds: ['stable-card'], imageRefs: [] }, initialCatalog()));
  await h.document.emit('catalog:global-tags-updated');
  await h.gallery.querySelectorAll('article')[1].emit('click');
  assert.match(detail.textContent, /Second Set.*Release YearNot recorded.*Birthday/);
  assert.doesNotMatch(detail.textContent, /Original|Floral/);
});

test('Detail shows all ordered images at full quality with read-only thumbnail/missing fallbacks', async (t) => {
  const full = 'data:image/jpeg;base64,YQ==';
  const thumb = 'data:image/jpeg;base64,Yg==';
  const h = await harness(t, {
    hydrateStampImages: async (records) => {
      for (const record of records) for (const ref of record.imageRefs) {
        if (ref.imagePath === 'Dies.jpg') { ref.imagePreviewSrc = full; ref.imageThumbnailSrc = thumb; }
      }
    }
  });
  const names = ['Mask 1.jpg', 'Dies.jpg', 'Stamp 1.jpg', 'Mask 2.jpg', 'Die 2.jpg', 'Stamp 2.jpg'];
  await seedEdit(h, { imageRefs: names.map((imageName) => imageName === 'Dies.jpg'
    ? { imageName, imagePath: 'Dies.jpg', imageLibrary: 'stamp-die-images', thumbnailImagePath: 'Dies.thumb.jpg' }
    : { imageName, imageSrc: full, thumbnailImageSrc: thumb }) });
  await h.cancel.emit('click');
  const before = structuredClone(h.records);
  await h.gallery.querySelector('article').emit('click');
  const detail = setDetail(h);
  const images = detail.querySelectorAll('img');
  assert.deepEqual(images.map((image) => image.alt), ['Stamp 1.jpg', 'Stamp 2.jpg', 'Dies.jpg', 'Die 2.jpg', 'Mask 1.jpg', 'Mask 2.jpg']);
  assert.ok(images.every((image) => image.src === full));
  await images[0].emit('error');
  assert.equal(images[0].src, thumb);
  await images[0].emit('error');
  assert.equal(images[0].hidden, true);
  assert.match(detail.textContent, /Image unavailable/);
  assert.deepEqual(h.records, before);
  assert.equal(h.calls(), 0);
});

test('unresolved folder image remains in persisted data when Detail opens and closes', async (t) => {
  const h = await harness(t, { hydrateStampImages: async () => {} });
  await seedEdit(h, { imageRefs: [{ imagePath: 'Missing.jpg', imageLibrary: 'stamp-die-images' }] });
  await h.cancel.emit('click');
  const before = structuredClone(h.records);
  await h.gallery.querySelector('article').emit('click');
  assert.match(setDetail(h).textContent, /Image unavailable/);
  await setDetail(h).close();
  assert.deepEqual(h.records, before);
  assert.equal(h.calls(), 0);
});

test('Edit from Detail reuses form, preserves ID, refreshes selected Set and returns to Detail after cancel', async (t) => {
  const imageCatalog = initialCatalog();
  imageCatalog.tags.push({ id: 'stamp', name: 'Stamp', categoryIds: [] });
  const h = await harness(t, {
    loadGlobalTagCatalog: async () => structuredClone(imageCatalog),
    selectStampImageFiles: async (files) => files.map((file) => ({ name: file.name, file, previewSrc: 'data:image/jpeg;base64,YQ==' })),
    prepareStampImagesForSave: async (images) => ({ usedFallback: true, imageRefs: images.map((image) => image.existingReference || { imageName: image.name, imageSrc: 'data:image/jpeg;base64,YQ==' }) })
  });
  await seedEdit(h);
  await h.cancel.emit('click');
  await h.gallery.querySelector('article').emit('click');
  const detail = setDetail(h);
  const edit = detail.querySelectorAll('button').find((button) => button.textContent === 'Edit Set');
  await edit.emit('click');
  assert.equal(h.dialog.open, true);
  assert.equal(h.name.value, 'Original');
  const input = h.form.querySelector('input[type="file"]');
  input.files = [{ name: 'New stamp.jpg' }];
  await input.emit('change');
  h.name.value = 'Edited in Detail';
  h.year.value = '2024';
  h.favorite.checked = false;
  await h.select('stable-card');
  await h.form.emit('submit');
  assert.equal(h.dialog.open, false);
  assert.equal(detail.open, true);
  assert.match(detail.textContent, /Edited in Detail.*2024.*Birthday/);
  assert.equal(h.records.length, 1);
  assert.equal(h.records[0].id, 'set-existing');
  assert.equal(detail.querySelector('img').alt, 'New stamp.jpg');
  assert.equal(h.document.activeElement, edit);
  await edit.emit('click');
  h.name.value = 'Discard this';
  await h.cancel.emit('click');
  assert.equal(detail.open, true);
  assert.match(detail.textContent, /Edited in Detail/);
  assert.doesNotMatch(detail.textContent, /Discard this/);
  await detail.querySelector('.card-detail-close').emit('click');
  assert.equal(h.document.activeElement, h.gallery.querySelector('article'));
});

test('Detail resolves renamed global tags without changing assignments', async (t) => {
  const h = await harness(t);
  await seedEdit(h);
  await h.cancel.emit('click');
  await h.gallery.querySelector('article').emit('click');
  h.renameTag();
  await h.document.emit('catalog:global-tags-updated');
  assert.match(setDetail(h).textContent, /Botanical/);
  assert.deepEqual(h.records[0].tagIds, ['stable-paper']);
});

test('Delete requires confirmation, targets selected Set, and clears Detail after commit', async (t) => {
  let target;
  const h = await harness(t, { deleteStampDieSet: async (id) => {
    target = id;
    h.records.splice(h.records.findIndex((record) => record.id === id), 1);
  } });
  await seedEdit(h, { imageRefs: editReferences() });
  await h.cancel.emit('click');
  await h.gallery.querySelector('article').emit('click');
  const detail = setDetail(h);
  const remove = detail.querySelectorAll('button').find((button) => button.textContent === 'Delete Set');
  let confirmation;
  window.confirm = (message) => { confirmation = message; return false; };
  await remove.emit('click');
  assert.match(confirmation, /Original.*from CSC.*Image files will not be deleted/);
  assert.equal(target, undefined);
  assert.equal(h.records.length, 1);
  assert.equal(detail.open, true);
  window.confirm = () => true;
  await remove.emit('click');
  assert.equal(target, 'set-existing');
  assert.deepEqual(h.records, []);
  assert.equal(detail.open, false);
  assert.doesNotMatch(detail.textContent, /Original/);
  assert.match(h.gallery.textContent, /No sets yet/);
  assert.equal(window.location.hash, '#stamps-dies');
});

test('failed Delete keeps persisted record and Detail intact with a visible error', async (t) => {
  const h = await harness(t, { deleteStampDieSet: async () => { throw new Error('Failed'); } });
  await seedEdit(h, { imageRefs: editReferences() });
  await h.cancel.emit('click');
  const before = structuredClone(h.records);
  await h.gallery.querySelector('article').emit('click');
  window.confirm = () => true;
  await setDetail(h).querySelectorAll('button').find((button) => button.textContent === 'Delete Set').emit('click');
  assert.deepEqual(h.records, before);
  assert.equal(setDetail(h).open, true);
  assert.match(setDetail(h).textContent, /Original.*could not be deleted/);
});

test('Set Favorite is an inline heart with Paper colors for either state and does not edit storage', async (t) => {
  const h = await harness(t);
  await seedEdit(h);
  await h.cancel.emit('click');
  let heart = h.gallery.querySelector('.stamp-set-favorite');
  assert.equal(heart.dataset.favorite, 'true');
  assert.equal(heart.textContent, '\u2665');
  assert.equal(heart.tagName, 'button');
  h.records[0].favorite = false;
  await h.document.emit('catalog:global-tags-updated');
  heart = h.gallery.querySelector('.stamp-set-favorite');
  assert.equal(heart.dataset.favorite, 'false');
  assert.equal(heart.getAttribute('aria-label'), 'Add set to favorites');
  assert.equal(h.calls(), 0);
});


test('Set owner defaults, edits, rename display, and cancel use the shared registry', async (t) => {
  const h = await harness(t);
  await h.add.emit('click');
  assert.equal(h.owner.value, 'owner-nina');
  h.name.value = 'Owned set';
  h.owner.value = 'owner-amanda';
  await h.form.emit('submit');
  assert.equal(h.records[0].ownerId, 'owner-amanda');
  assert.equal('owner' in h.records[0], false);
  assert.match(h.gallery.textContent, /Amanda/);
  await h.gallery.querySelector('article').emit('click');
  const detail = setDetail(h);
  assert.match(detail.textContent, /OwnerAmanda/);
  h.owners[1].name = 'Mandy';
  await h.document.emit('catalog:owners-updated');
  assert.match(h.gallery.textContent, /Mandy/);
  assert.match(detail.textContent, /OwnerMandy/);
  await detail.querySelectorAll('button').find((b) => b.textContent === 'Edit Set').emit('click');
  assert.equal(h.owner.value, 'owner-amanda');
  h.owner.value = 'owner-nina';
  await h.cancel.emit('click');
  assert.equal(h.records[0].ownerId, 'owner-amanda');
  await detail.querySelectorAll('button').find((b) => b.textContent === 'Edit Set').emit('click');
  h.owner.value = 'owner-nina';
  await h.form.emit('submit');
  assert.equal(h.records[0].ownerId, 'owner-nina');
  assert.match(detail.textContent, /OwnerNina/);
});

test('New owner stays in draft on failure and joins the registry after successful save', async (t) => {
  const h = await harness(t);
  await h.add.emit('click');
  h.name.value = 'New owner set';
  h.owner.value = '__new_owner__';
  await h.owner.emit('change');
  h.newOwner.value = '  Jordan  ';
  h.setFailure(true);
  await h.form.emit('submit');
  assert.equal(h.owners.length, 2);
  assert.equal(h.newOwner.value, '  Jordan  ');
  h.setFailure(false);
  await h.form.emit('submit');
  assert.equal(h.owners[2].name, 'Jordan');
  assert.equal(h.records[0].ownerId, h.owners[2].id);
});

test('Legacy sets keep missing ownership until explicitly assigned', async (t) => {
  const h = await harness(t);
  await seedEdit(h);
  assert.equal(h.owner.value, '');
  assert.equal(h.owner.required, false);
  await h.form.emit('submit');
  assert.equal('ownerId' in h.records[0], false);
  assert.match(h.gallery.textContent, /Owner not recorded/);
});

test('Add Set requires an owner and falls back to the last used owner', async (t) => {
  const h = await harness(t, { loadDefaultOwnerId: async () => 'missing', loadCatalogSetting: async () => 'owner-amanda' });
  await h.add.emit('click');
  assert.equal(h.owner.value, 'owner-amanda');
  h.name.value = 'Needs owner';
  h.owner.value = '';
  await h.form.emit('submit');
  assert.equal(h.records.length, 0);
});

test('Set sidebar combines filters, clears tags independently, resets all, and never reloads images on filter changes', async (t) => {
  let imageReads = 0;
  const h = await harness(t, { hydrateStampImages: async () => { imageReads++; } });
  await seedEdit(h, { ownerId: 'owner-nina' });
  await h.cancel.emit('click');
  h.records.push(createStampDieSetRecord({ id: 'second', name: 'Other', dateCreated: '2020-01-01', releaseYear: 2026, favorite: false, ownerId: 'owner-amanda', tagIds: ['stable-card'] }, initialCatalog()));
  await h.document.emit('catalog:global-tags-updated');
  const before = structuredClone(h.records);
  const imagesBefore = imageReads;
  const readsBefore = h.recordReads();
  const c = h.filterControls;
  c.search.value = 'original'; await c.search.emit('input');
  c.owner.value = 'owner-nina'; await c.owner.emit('change');
  c.year.value = '2022'; await c.year.emit('change');
  await c.favorites.emit('click');
  const floral = c.tagFilters.querySelector('input[data-filter-category-member="nature"][data-global-tag-id="stable-paper"]');
  floral.checked = true; await c.tagFilters.emit('change', { target: floral });
  assert.equal(h.gallery.querySelectorAll('article').length, 1);
  assert.equal(h.gallery.querySelector('article').dataset.setId, 'set-existing');
  assert.equal(h.status.textContent, 'Showing 1 of 2 sets');
  assert.equal(c.clear.hidden, false);
  c.owner.value = 'owner-amanda'; await c.owner.emit('change');
  assert.match(h.gallery.textContent, /No sets match the current filters/);
  assert.equal(c.search.value, 'original');
  await c.clearTags.emit('click');
  assert.equal(floral.checked, false);
  assert.equal(c.year.value, '2022');
  await c.clear.emit('click');
  assert.equal(h.gallery.querySelectorAll('article').length, 2);
  assert.equal(c.search.value, ''); assert.equal(c.owner.value, ''); assert.equal(c.year.value, '');
  assert.equal(c.favorites.getAttribute('aria-pressed'), 'false');
  assert.equal(c.clear.hidden, true);
  assert.equal(h.document.activeElement, c.search);
  assert.deepEqual(h.records, before);
  assert.equal(h.calls(), 0);
  assert.equal(imageReads, imagesBefore);
  assert.equal(h.recordReads(), readsBefore);
});

test('Set category controls refine members, combine with owner, preserve renamed tags, and reset', async (t) => {
  const h = await harness(t);
  await seedEdit(h, { ownerId: 'owner-nina' }); await h.cancel.emit('click');
  const c = h.filterControls;
  const member = c.tagFilters.querySelector('input[data-filter-category-member="nature"]');
  member.checked = true; await c.tagFilters.emit('change', { target: member });
  assert.equal(c.tagFilters.querySelector('input[data-filter-category-id="nature"]').checked, true);
  c.owner.value = 'owner-nina'; await c.owner.emit('change');
  assert.equal(h.gallery.querySelectorAll('article').length, 1);
  h.renameTag(); await h.document.emit('catalog:global-tags-updated');
  assert.match(c.tagFilters.textContent, /Botanical/);
  assert.equal(c.tagFilters.querySelector('input[data-filter-category-member="nature"]').checked, true);
  assert.equal(h.records[0].tagIds[0], 'stable-paper');
  const category = c.tagFilters.querySelector('input[data-filter-category-id="nature"]');
  category.checked = false; await c.tagFilters.emit('change', { target: category });
  assert.equal(c.tagFilters.querySelector('input[data-filter-category-member="nature"]').checked, false);
  await c.clear.emit('click');
  assert.equal(c.tagFilters.querySelectorAll('input:checked').length, 0);
});

test('Set owner dropdown matches Paper: active names, canonical values, rename retention, inactive selection reset', async (t) => {
  const h = await harness(t);
  await seedEdit(h, { ownerId: 'owner-nina' }); await h.cancel.emit('click');
  const c = h.filterControls;
  c.owner.value = 'owner-nina'; await c.owner.emit('change');
  const before = structuredClone(h.records);
  h.owners[0].name = 'Renamed Nina'; await h.document.emit('catalog:owners-updated');
  assert.equal(c.owner.value, 'owner-nina');
  assert.match(c.owner.textContent, /Renamed Nina/);
  assert.match(h.gallery.textContent, /Renamed Nina/);
  h.owners[0].archived = true; await h.document.emit('catalog:owners-updated');
  assert.equal(c.owner.value, '');
  assert.doesNotMatch(c.owner.textContent, /Renamed Nina/);
  assert.equal(h.gallery.querySelectorAll('article').length, 1);
  assert.match(h.gallery.textContent, /Renamed Nina/);
  assert.deepEqual(h.records, before);
});

test('filtered Detail/Edit/Delete keep stable identity and filter state; Add still reapplies filters', async (t) => {
  let deleted;
  const h = await harness(t, { deleteStampDieSet: async (id) => {
    deleted = id;
    h.records.splice(h.records.findIndex((record) => record.id === id), 1);
  } });
  await seedEdit(h, { ownerId: 'owner-nina' }); await h.cancel.emit('click');
  h.records.unshift(createStampDieSetRecord({ id: 'hidden-set', name: 'Hidden', dateCreated: '2020-01-01', releaseYear: 2025, favorite: false, tagIds: [] }, initialCatalog()));
  await h.document.emit('catalog:global-tags-updated');
  const c = h.filterControls;
  c.year.value = '2022'; await c.year.emit('change');
  await h.gallery.querySelector('article').emit('click');
  const detail = setDetail(h);
  assert.match(detail.textContent, /Original/);
  await detail.querySelectorAll('button').find((button) => button.textContent === 'Edit Set').emit('click');
  assert.equal(h.name.value, 'Original');
  h.name.value = 'Edited visible'; await h.form.emit('submit');
  assert.equal(c.year.value, '2022');
  assert.equal(h.records.find((record) => record.id === 'set-existing').name, 'Edited visible');
  assert.match(detail.textContent, /Edited visible/);
  globalThis.window.confirm = () => true;
  await detail.querySelectorAll('button').find((button) => button.textContent === 'Delete Set').emit('click');
  assert.equal(deleted, 'set-existing');
  assert.equal(h.records[0].id, 'hidden-set');
  assert.equal(c.year.value, '2022');
  assert.match(h.gallery.textContent, /No sets match/);
  await h.add.emit('click'); h.name.value = 'New matching'; h.year.value = '2022';
  await h.form.emit('submit');
  assert.equal(c.year.value, '2022');
  assert.match(h.gallery.textContent, /New matching/);
  await c.clear.emit('click');
  assert.equal(h.gallery.querySelectorAll('article').length, 2);
});

test('Set empty catalog differs from zero matching records', async (t) => {
  const h = await harness(t);
  assert.match(h.gallery.textContent, /No sets yet/);
  assert.equal(h.status.textContent, 'Showing 0 of 0 sets');
  await seedEdit(h); await h.cancel.emit('click');
  h.filterControls.search.value = 'no-match'; await h.filterControls.search.emit('input');
  assert.match(h.gallery.textContent, /No sets match the current filters/);
  assert.equal(h.status.textContent, 'Showing 0 of 1 sets');
});


test('Stamps sidebar uses the shared navigation group and quick-filter styles', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const group = html.slice(html.indexOf('<div data-sidebar-controls="stamps-dies"'), html.indexOf('<details class="app-version"'));
  for (const name of ['search', 'owner', 'year', 'favorites', 'tag-filters', 'clear', 'clear-tags']) {
    assert.ok(group.includes(`data-set-library-${name}`));
  }
  assert.match(group, /class="card-library-quick-filter card-library-select-filter"/);
  assert.match(group, /data-sidebar-controls="stamps-dies" hidden/);
  assert.doesNotMatch(group, /data-card-library|data-library-owner|data-set-library-status|data-set-library-holiday/);
});


test('Edit can stop matching without clearing filters or losing the open Detail record', async (t) => {
  const h = await harness(t);
  await seedEdit(h); await h.cancel.emit('click');
  h.filterControls.year.value = '2022'; await h.filterControls.year.emit('change');
  await h.gallery.querySelector('article').emit('keydown', { key: 'Enter' });
  const detail = setDetail(h);
  await detail.querySelectorAll('button').find((button) => button.textContent === 'Edit Set').emit('click');
  h.year.value = '2026'; await h.form.emit('submit');
  assert.equal(detail.open, true);
  assert.match(detail.textContent, /2026/);
  assert.equal(h.records[0].id, 'set-existing');
  assert.equal(h.filterControls.year.value, '2022');
  assert.match(h.gallery.textContent, /No sets match/);
  await detail.querySelectorAll('button').find((button) => button.getAttribute('aria-label') === 'Close set details').emit('click');
  assert.equal(h.document.activeElement, h.add);
  await h.filterControls.clear.emit('click');
  assert.equal(h.gallery.querySelector('article').dataset.setId, 'set-existing');
});

test('Set filter options stay stable under search and selections, then clear after last usage is removed', async (t) => {
  const h = await harness(t);
  await seedEdit(h); await h.cancel.emit('click');
  h.records.push(createStampDieSetRecord({ id: 'other', name: 'Other', dateCreated: '2020-01-01', releaseYear: 2026, favorite: false, tagIds: ['stable-card'] }, initialCatalog()));
  await h.document.emit('catalog:global-tags-updated');
  const c = h.filterControls;
  const options = c.tagFilters.querySelector('[data-global-tag-filter-options]');
  assert.equal(c.tagFilters.querySelector('input[name="set-library-tags"][data-global-tag-id="stable-paper"]'), null);
  c.search.value = 'Original'; await c.search.emit('input');
  assert.equal(c.tagFilters.querySelector('[data-global-tag-filter-options]'), options);
  const birthday = c.tagFilters.querySelector('input[name="set-library-tags"][data-global-tag-id="stable-card"]');
  birthday.checked = true; await c.tagFilters.emit('change', { target: birthday });
  assert.match(h.gallery.textContent, /No sets match/);
  assert.equal(c.tagFilters.querySelector('[data-global-tag-filter-options]'), options);
  assert.ok(c.tagFilters.querySelector('input[data-filter-category-id="nature"]'));
  h.records.splice(h.records.findIndex((record) => record.id === 'other'), 1);
  await h.document.emit('catalog:global-tags-updated');
  assert.equal(c.tagFilters.querySelector('input[data-global-tag-id="stable-card"]'), null);
  assert.equal(c.clearTags.hidden, true);
  assert.equal(c.search.value, 'Original');
  assert.match(h.gallery.textContent, /Original/);
  assert.equal(h.calls(), 0);
  await h.add.emit('click');
  assert.ok(h.form.querySelector('[data-tag-id="stable-card"]'));
});

test('Set Detail reuses context/title/close header and places destructive actions inside metadata', async (t) => {
  const h = await harness(t);
  await seedEdit(h, { ownerId: 'owner-nina' }); await h.cancel.emit('click');
  const tile = h.gallery.querySelector('article'); await tile.emit('click');
  const detail = setDetail(h);
  const header = detail.querySelector('header');
  assert.equal(header.className, 'card-detail-header');
  assert.equal(header.querySelector('.eyebrow').textContent, 'Stamps & Dies');
  assert.equal(header.querySelector('h3').textContent, 'Original');
  assert.equal(header.querySelectorAll('button').length, 3);
  assert.equal(header.querySelector('.card-detail-back').hidden, true);
  const titleRow = header.querySelector('.card-title-row');
  assert.equal(titleRow.children[0], header.querySelector('h3'));
  assert.equal(titleRow.children[1].className, 'stamp-set-favorite');
  assert.equal(detail.querySelector('.detail-metadata').querySelector('.stamp-set-favorite'), null);
  const close = header.querySelector('.card-detail-close');
  assert.equal(close.className, 'card-detail-close');
  assert.equal(close.textContent, '\u00d7');
  assert.equal(close.getAttribute('aria-label'), 'Close set details');
  assert.doesNotMatch(detail.textContent, /Back to Stamps/);
  const content = detail.querySelector('.stamp-set-detail-content');
  assert.ok(content.className.includes('card-detail-content'));
  assert.ok(content.children[0].className.includes('stamp-set-detail-images'));
  const metadata = content.querySelector('.detail-metadata');
  assert.deepEqual(metadata.querySelectorAll('h4').map((heading) => heading.textContent), ['Set Info', 'Tags', 'Related Cards', 'Actions']);
  const facts = metadata.querySelector('dl');
  assert.equal(facts.className, 'detail-meta-list');
  assert.deepEqual(facts.querySelectorAll('dt').map((term) => term.textContent), ['Owner', 'Release Year']);
  assert.equal(facts.querySelectorAll('dd')[0].textContent, 'Nina');
  assert.equal(facts.querySelectorAll('dd')[1].textContent, '2022');
  assert.equal(metadata.querySelector('.card-detail-chips').textContent, 'Floral');
  const actions = metadata.querySelector('.detail-actions');
  assert.deepEqual(actions.querySelectorAll('button').map((button) => button.textContent), ['Edit Set', 'Delete Set']);
  assert.ok(actions.querySelectorAll('button')[0].className.includes('button-primary'));
  assert.ok(actions.querySelectorAll('button')[1].className.includes('button-danger'));
  assert.ok(actions.querySelector('.detail-action-row'));
  assert.equal(h.calls(), 0);
  await close.emit('click');
  assert.equal(detail.open, false); assert.equal(h.document.activeElement, tile);
});

for (const favorite of [false, true]) test(`Detail Favorite heart toggles directly from state ${favorite}`, async (t) => {
  const h = await harness(t);
  await seedEdit(h, { favorite, tagIds: [] }); await h.cancel.emit('click');
  const before = structuredClone(h.records);
  await h.gallery.querySelector('article').emit('click');
  const detail = setDetail(h);
  const heart = detail.querySelector('.stamp-set-favorite');
  assert.equal(heart.tagName, 'button');
  assert.equal(heart.dataset.favorite, String(favorite));
  assert.equal(heart.getAttribute('aria-pressed'), String(favorite));
  assert.equal(heart.getAttribute('aria-label'), favorite ? 'Remove set from favorites' : 'Add set to favorites');
  assert.equal(heart.textContent, '\u2665');
  assert.doesNotMatch(detail.textContent, /Not a favorite/);
  assert.equal(detail.querySelector('.card-detail-empty').textContent, 'No tags');
  await heart.emit('click');
  assert.deepEqual(h.records, [{ ...before[0], favorite: !favorite }]); assert.equal(h.calls(), 1);
});


test('Set Library tiles place the name and heart together above the image gallery like Paper', async (t) => {
  const h = await harness(t);
  await seedEdit(h); await h.cancel.emit('click');
  const tile = h.gallery.querySelector('article');
  assert.equal(tile.children[0].className, 'card-title-row');
  assert.equal(tile.children[0].querySelector('h4').textContent, 'Original');
  assert.ok(tile.children[0].querySelector('.stamp-set-favorite'));
  assert.ok(tile.children[1].className.includes('stamp-set-images'));
  assert.equal(tile.children[2].className, 'card-body stamp-set-tile-content');
  await tile.emit('click');
  assert.equal(setDetail(h).querySelector('.card-title-row').querySelector('h3').textContent, 'Original');
});

test('Library heart saves only Favorite, stays out of Detail, and does not prepare or hydrate images', async (t) => {
  let hydrated = 0;
  const h = await harness(t, {
    hydrateStampImages: async () => { hydrated++; },
    prepareStampImagesForSave: async () => { throw new Error('Unexpected image preparation'); }
  });
  await seedEdit(h, { ownerId: 'owner-nina', imageRefs: editReferences() }); await h.cancel.emit('click');
  const before = structuredClone(h.records[0]); const reads = hydrated;
  const tile = h.gallery.querySelector('article');
  const heart = tile.querySelector('.stamp-set-favorite');
  await heart.emit('click');
  await tile.emit('click', { target: heart });
  assert.equal(setDetail(h).open, undefined);
  assert.deepEqual(h.records[0], { ...before, favorite: false });
  assert.equal(hydrated, reads);
  assert.equal(h.document.activeElement, h.gallery.querySelector('.stamp-set-favorite'));
  assert.equal(h.document.activeElement.getAttribute('aria-pressed'), 'false');
  await h.gallery.querySelector('article').emit('click');
  assert.equal(setDetail(h).querySelector('.stamp-set-favorite').getAttribute('aria-pressed'), 'false');
});

test('pending Favorite save blocks repeated clicks and Edit/Delete; failure retains state for retry', async (t) => {
  const h = await harness(t);
  await seedEdit(h); await h.cancel.emit('click');
  await h.gallery.querySelector('article').emit('click');
  const detail = setDetail(h); const heart = detail.querySelector('.stamp-set-favorite');
  let release; h.setGate(new Promise((resolve) => { release = resolve; })); h.setFailure(true);
  let alert = ''; window.alert = (message) => { alert = message; };
  const before = structuredClone(h.records);
  const pending = heart.emit('click');
  assert.equal(heart.disabled, true);
  assert.equal(h.gallery.querySelector('.stamp-set-favorite').disabled, true);
  await heart.emit('click');
  await detail.querySelectorAll('button').find((button) => button.textContent === 'Edit Set').emit('click');
  await detail.querySelectorAll('button').find((button) => button.textContent === 'Delete Set').emit('click');
  assert.equal(h.dialog.open, false);
  assert.equal(h.calls(), 1);
  release(); await pending;
  assert.deepEqual(h.records, before);
  assert.equal(heart.disabled, false);
  assert.match(alert, /favorite status could not be saved/);
  h.setFailure(false); await heart.emit('click');
  assert.equal(h.records[0].favorite, false);
  assert.equal(detail.querySelector('.stamp-set-favorite').getAttribute('aria-pressed'), 'false');
  assert.equal(h.gallery.querySelector('.stamp-set-favorite').getAttribute('aria-pressed'), 'false');
});

test('removing Favorite re-applies filters and restores usable focus in Library and Detail', async (t) => {
  const h = await harness(t);
  await seedEdit(h); await h.cancel.emit('click');
  await h.filterControls.favorites.emit('click');
  await h.gallery.querySelector('.stamp-set-favorite').emit('click');
  assert.match(h.gallery.textContent, /No sets match/);
  assert.equal(h.document.activeElement, h.add);
  assert.equal(h.filterControls.favorites.getAttribute('aria-pressed'), 'true');
  await h.filterControls.clear.emit('click');
  await h.gallery.querySelector('.stamp-set-favorite').emit('click');
  await h.filterControls.favorites.emit('click');
  await h.gallery.querySelector('article').emit('click');
  await setDetail(h).querySelector('.stamp-set-favorite').emit('click');
  assert.match(h.gallery.textContent, /No sets match/);
  assert.equal(setDetail(h).open, true);
  assert.equal(h.document.activeElement, setDetail(h).querySelector('.stamp-set-favorite'));
});


test('Set tile metadata follows Paper placement: tag chips, owner/year, and bottom-right Edit', async (t) => {
  const h = await harness(t);
  await seedEdit(h, { ownerId: 'owner-nina' }); await h.cancel.emit('click');
  const tile = h.gallery.querySelector('article');
  const body = tile.querySelector('.card-body');
  assert.equal(body.children[0].className, 'keyword-list');
  assert.equal(body.children[0].textContent, 'Floral');
  assert.equal(body.children[1].className, 'card-meta');
  assert.equal(body.children[1].textContent, 'Nina \u00b7 2022');
  assert.equal(tile.children.at(-1).className, 'card-edit-button');
  assert.equal(tile.children.at(-1).textContent, 'Edit');
  assert.equal(body.querySelector('.pack-color-list'), null);
  await tile.children.at(-1).emit('click');
  assert.equal(h.name.value, 'Original');
});

for (const mode of ['Add', 'Edit']) {
  test(`${mode} uses the Settings Stamp library for multiple selection and preserves inference and presentation order`, async (t) => {
    const previousPicker = globalThis.showOpenFilePicker;
    const previousDirectoryPicker = globalThis.showDirectoryPicker;
    t.after(() => { globalThis.showOpenFilePicker = previousPicker; globalThis.showDirectoryPicker = previousDirectoryPicker; });
    globalThis.showOpenFilePicker = () => {};
    globalThis.showDirectoryPicker = () => {};
    const root = { name: 'Independent Stamp folder' };
    let selections = 0;
    const imageCatalog = initialCatalog();
    imageCatalog.tags.push(...['Stamp', 'Die', 'Mask'].map((name) => ({ id: name.toLowerCase(), name, categoryIds: [] })));
    const h = await harness(t, {
      loadGlobalTagCatalog: async () => structuredClone(imageCatalog),
      loadStampImageDirectory: async () => root,
      hydrateStampImages: async () => {},
      chooseStampImages: async (environment, directory) => {
        assert.equal(environment, globalThis); assert.equal(directory, root); selections++;
        return ['Set Masks.jpg', 'Set Dies Masks.jpg', 'Set.jpg'].map((name) => ({ name, previewSrc: 'data:image/jpeg;base64,YQ==' }));
      }
    });
    if (mode === 'Edit') await seedEdit(h);
    else await h.add.emit('click');
    const button = h.form.querySelectorAll('button').find((button) => button.textContent === 'Add from Stamp & Die Library');
    assert.equal(button.hidden, false);
    const general = h.form.querySelectorAll('button').find((button) => button.textContent === 'Add Images');
    assert.ok(button.parentElement.children.indexOf(button) < button.parentElement.children.indexOf(general));
    assert.match(h.form.textContent, /Independent Stamp folder.*Settings/);
    await button.emit('click');
    assert.equal(selections, 1);
    assert.deepEqual(h.form.querySelector('.stamp-set-draft-images').querySelectorAll('img').map((image) => image.alt),
      ['Set.jpg', 'Set Dies Masks.jpg', 'Set Masks.jpg']);
    for (const id of ['stamp', 'die', 'mask']) assert.equal(h.form.querySelector(`[data-tag-id="${id}"]`).checked, true);
    assert.equal(h.calls(), 0);
    await h.cancel.emit('click');
  });
}

for (const state of ['unsupported', 'unconfigured', 'revoked']) {
  test(`general Add Images remains usable with ${state} library access`, async (t) => {
    const previousPicker = globalThis.showOpenFilePicker;
    t.after(() => { globalThis.showOpenFilePicker = previousPicker; });
    globalThis.showOpenFilePicker = state === 'unsupported' ? undefined : () => {};
    const h = await harness(t, {
      loadStampImageDirectory: async () => state === 'unsupported' ? { name: 'Previously saved' } : null,
      selectStampImageFiles: async (files) => files.map((file) => ({ file, name: file.name, previewSrc: 'data:image/jpeg;base64,YQ==' }))
    });
    await h.add.emit('click');
    const library = h.form.querySelectorAll('button').find((button) => button.textContent === 'Add from Stamp & Die Library');
    assert.equal(library.hidden, true);
    const general = h.form.querySelectorAll('button').find((button) => button.textContent === 'Add Images');
    const input = h.form.querySelector('input[type="file"]');
    let clicks = 0; input.click = () => { clicks++; };
    await general.emit('click'); assert.equal(clicks, 1); assert.equal(general.disabled, false);
    assert.equal(input.multiple, true);
    input.files = [{ name: 'Stamp.jpg' }, { name: 'Dies.jpg' }];
    await input.emit('change');
    assert.equal(h.form.querySelector('.stamp-set-draft-images').querySelectorAll('img').length, 2);
  });
}

test('Settings library changes refresh existing Set display without save, inference, migration or draft loss', async (t) => {
  const previousPicker = globalThis.showOpenFilePicker;
  const previousDirectoryPicker = globalThis.showDirectoryPicker;
  t.after(() => { globalThis.showOpenFilePicker = previousPicker; globalThis.showDirectoryPicker = previousDirectoryPicker; });
  globalThis.showOpenFilePicker = () => {};
  globalThis.showDirectoryPicker = () => {};
  let root = null;
  const h = await harness(t, {
    loadStampImageDirectory: async () => root,
    hydrateStampImages: async () => {},
    prepareStampImagesForSave: () => assert.fail('Settings cannot prepare images')
  });
  await seedEdit(h, { imageRefs: editReferences() });
  const before = structuredClone(h.records);
  h.name.value = 'Unsaved edit';
  for (const name of ['First root', 'Replacement root']) {
    root = { name };
    await h.document.emit('catalog:stamp-image-library-selected');
    assert.equal(h.name.value, 'Unsaved edit');
    assert.match(h.form.textContent, new RegExp(name));
    assert.equal(h.calls(), 0);
    assert.deepEqual(h.records, before);
    assert.equal(h.form.querySelectorAll('[data-tag-id]').length, 2);
  }
});


test('Card relationship opens Stamp Detail with shared Back; ordinary tile opens a fresh session', async (t) => {
  const h = await harness(t);
  await seedEdit(h, { id: 'linked-set' });
  await h.cancel.emit('click');
  let cardVisible = false;
  detailNavigation.register('card', {
    library: 'cards', exists: (id) => id === 'origin-card',
    open: () => { cardVisible = true; }, hide: () => { cardVisible = false; }
  });
  detailNavigation.open('card', 'origin-card');
  const before = structuredClone(h.records);
  await h.document.emit('stamp-die-set:detail-request', { detail: { stampDieSetId: 'linked-set' } });
  const detail = setDetail(h);
  assert.equal(detail.open, true);
  assert.equal(cardVisible, false);
  assert.equal(detail.querySelector('h3').textContent, 'Original');
  assert.equal(window.location.hash, '#stamps-dies');
  const back = detail.querySelector('.card-detail-back');
  assert.equal(back.textContent, '\u2190 Back');
  assert.equal(back.hidden, false);
  assert.deepEqual(h.records, before);
  let stopped = false;
  await back.emit('click', { stopPropagation() { stopped = true; } });
  assert.equal(stopped, true, 'Back must not bubble into the newly opened Detail backdrop handler');
  assert.equal(cardVisible, true);
  assert.equal(detail.open, false);
  await h.gallery.querySelector('article').emit('click');
  assert.equal(back.hidden, true);
  assert.equal(cardVisible, false);
  await detail.close();
  assert.deepEqual(detailNavigation.getState(), { current: null, history: [] });
  await h.document.emit('stamp-die-set:detail-request', { detail: { stampDieSetId: 'missing-set' } });
  assert.equal(detail.open, false);
});


test('Stamp dismissal clears shared history for Escape/backdrop and late native close cannot end a reopened Detail', async (t) => {
  const h = await harness(t);
  await seedEdit(h); await h.cancel.emit('click');
  detailNavigation.register('card', { library: 'cards', exists: () => true, open() {}, hide() {} });
  const detail = setDetail(h);
  for (const mode of ['cancel', 'backdrop', 'close-button']) {
    detailNavigation.open('card', 'A');
    detailNavigation.open('stamp', 'set-existing', { related: true });
    if (mode === 'cancel') await detail.emit('cancel');
    else if (mode === 'backdrop') await detail.emit('click', { target: detail });
    else await detail.querySelector('.card-detail-close').emit('click');
    assert.deepEqual(detailNavigation.getState(), { current: null, history: [] });
    assert.equal(detail.open, false);
    assert.equal(window.location.hash, '#stamps-dies');
  }
  detailNavigation.open('card', 'A');
  detailNavigation.open('stamp', 'set-existing', { related: true });
  detailNavigation.back();
  detailNavigation.open('stamp', 'set-existing', { related: true });
  await detail.emit('close'); // A queued notification from the previous visit.
  assert.equal(detail.open, true);
  assert.deepEqual(detailNavigation.getState(), { current: { type: 'stamp', id: 'set-existing' }, history: [{ type: 'card', id: 'A' }] });
});


const relationshipCard = (id, ids, extra = {}) => ({ id, stampDieSetIds: ids, dateCreated: '2026-09-07',
  size: { width: 4.25, height: 5.5 }, paperPackIds: ['paper-X'], ...extra });

test('Stamp reverse lookup uses exact Set IDs, includes all matches once, and never changes Cards', () => {
  const cards = [relationshipCard('A', ['set-existing']), relationshipCard('B', ['other', 'set-existing', 'set-existing']),
    relationshipCard('unrelated', ['other']), relationshipCard('legacy', undefined),
    relationshipCard('malformed', 'set-existing'), null];
  const before = structuredClone(cards);
  assert.deepEqual(findCardsUsingStampDieSet(cards, 'set-existing').map(card => card.id), ['A', 'B']);
  assert.deepEqual(findCardsUsingStampDieSet(cards, 'set'), []);
  assert.deepEqual(findCardsUsingStampDieSet(cards, 'missing'), []);
  assert.deepEqual(findCardsUsingStampDieSet(null, 'set-existing'), []);
  assert.deepEqual(cards, before);
});

test('Stamp Detail displays multiple Related Cards with existing thumbnail conventions and no unrelated Cards', async (t) => {
  const cards = [relationshipCard('card-A', ['set-existing'], { thumbnailImageSrc: 'data:image/jpeg;base64,YQ==' }),
    relationshipCard('card-B', ['set-existing'], { dateCreated: '2026-09-06' }), relationshipCard('unrelated', [])];
  const before = structuredClone(cards);
  const h = await harness(t, { cards });
  await seedEdit(h); await h.cancel.emit('click');
  await h.gallery.querySelector('article').emit('click');
  const section = setDetail(h).querySelector('.related-cards-section');
  assert.equal(section.querySelector('h4').textContent, 'Related Cards');
  assert.deepEqual(section.querySelectorAll('[data-related-card-id]').map(button => button.dataset.relatedCardId), ['card-A', 'card-B']);
  assert.equal(section.querySelector('img').src, cards[0].thumbnailImageSrc);
  assert.match(section.textContent, /2026-09-07.*2026-09-06/);
  assert.match(section.textContent, /No image yet/);
  assert.doesNotMatch(section.textContent, /card-A|card-B|unrelated/);
  assert.match(section.querySelector('button').getAttribute('aria-label'), /2026-09-07.*4.25 by 5.5/);
  await section.querySelector('img').emit('error');
  assert.equal(section.querySelector('img'), null);
  assert.deepEqual(cards, before);
  assert.equal(h.calls(), 0, 'viewing never saves a Set');
});

test('Related Cards section remains visible when empty and reflects live relationship changes on reopening', async (t) => {
  const cards = [relationshipCard('A', ['other'])];
  const h = await harness(t, { cards });
  await seedEdit(h); await h.cancel.emit('click');
  detailNavigation.open('stamp', 'set-existing');
  const section = () => setDetail(h).querySelector('.related-cards-section');
  assert.match(section().textContent, /Related Cards.*No related Cards yet/);
  assert.equal(section().querySelectorAll('button').length, 0);
  detailNavigation.close();
  cards.splice(0, cards.length, relationshipCard('A', ['set-existing']));
  detailNavigation.open('stamp', 'set-existing');
  assert.equal(section().querySelectorAll('button').length, 1);
  detailNavigation.close();
  cards[0].stampDieSetIds = [];
  detailNavigation.open('stamp', 'set-existing');
  assert.match(section().textContent, /No related Cards yet/);
  assert.deepEqual(cards[0].paperPackIds, ['paper-X']);
});

test('Stamp Related Card click opens the correct Card and Back restores the Set with earlier history intact', async (t) => {
  const cards = [relationshipCard('A', ['set-existing']), relationshipCard('B', ['set-existing'])];
  const h = await harness(t, { cards });
  await seedEdit(h); await h.cancel.emit('click');
  let currentCard = null;
  detailNavigation.register('card', { library: 'cards', exists: id => cards.some(card => card.id === id),
    open: id => { currentCard = id; }, hide: () => { currentCard = null; } });
  detailNavigation.open('card', 'A');
  detailNavigation.open('stamp', 'set-existing', { related: true });
  const detail = setDetail(h);
  const link = detail.querySelector('[data-related-card-id="B"]');
  let stopped = false;
  await detail.querySelector('.stamp-set-detail-body').emit('click', { target: link, stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(currentCard, 'B');
  assert.equal(detail.open, false);
  assert.deepEqual(detailNavigation.getState(), { current: { type: 'card', id: 'B' },
    history: [{ type: 'card', id: 'A' }, { type: 'stamp', id: 'set-existing' }] });
  detailNavigation.back();
  assert.equal(detail.open, true);
  assert.equal(detail.querySelector('h3').textContent, 'Original');
  assert.equal(detail.querySelectorAll('[data-related-card-id]').length, 2);
  assert.deepEqual(detailNavigation.getState().history, [{ type: 'card', id: 'A' }]);
  await detail.querySelector('.card-detail-back').emit('click', { stopPropagation() {} });
  assert.equal(currentCard, 'A');
  assert.deepEqual(cards.map(card => card.stampDieSetIds), [['set-existing'], ['set-existing']]);
});


async function selectRelatedCard(h, id) {
  const search = h.form.querySelector('input[aria-label="Search Cards by date, size, or tags"]');
  search.value = '2026';
  await search.emit('input');
  const button = h.form.querySelector(`[data-add-related-card="${id}"]`);
  assert.ok(button, `Card ${id} is offered`);
  await button.parent.parent.emit('click', { target: button });
}
async function removeRelatedCard(h, id) {
  const button = h.form.querySelector(`[data-remove-related-card="${id}"]`);
  assert.ok(button);
  await button.parent.parent.emit('click', { target: button });
}

test('Stamp Library shows compact related Cards, omits unused Set section, and opens Card with Set return context', async (t) => {
  const cards = [relationshipCard('A', ['set-existing']), relationshipCard('B', ['set-existing'])];
  const h = await harness(t, { cards });
  await seedEdit(h); await h.cancel.emit('click');
  const section = h.gallery.querySelector('.stamp-library-related-cards');
  assert.deepEqual(section.querySelectorAll('[data-related-card-id]').map(el => el.dataset.relatedCardId), ['A', 'B']);
  let selected;
  detailNavigation.register('card', { library: 'cards', exists: id => cards.some(card => card.id === id), open: id => { selected = id; }, hide() {} });
  const button = section.querySelector('[data-related-card-id="B"]');
  await section.emit('click', { target: button, stopPropagation() {} });
  assert.equal(selected, 'B');
  assert.deepEqual(detailNavigation.getState().history, [{ type: 'stamp', id: 'set-existing' }]);
  detailNavigation.back();
  assert.equal(setDetail(h).open, true);
  cards.splice(0, cards.length);
  await h.document.emit('catalog:cards-updated');
  assert.equal(h.gallery.querySelector('.stamp-library-related-cards'), null);
});

test('Stamp Edit populates Cards, no-op save sends no Card writes, and explicit changes affect only this Set', async (t) => {
  const cards = [relationshipCard('A', ['set-existing', 'missing-set']), relationshipCard('B', ['other-set'])];
  const h = await harness(t, { cards });
  await seedEdit(h);
  assert.equal(h.form.querySelectorAll('[data-remove-related-card]').length, 1);
  const before = structuredClone(cards);
  await h.form.emit('submit');
  assert.deepEqual(h.saveOptions.at(-1).cardRelationshipChanges, { add: [], remove: [] });
  assert.deepEqual(cards, before);
  await h.gallery.querySelector('button[aria-label="Edit Original"]').emit('click');
  await selectRelatedCard(h, 'B');
  await removeRelatedCard(h, 'A');
  assert.deepEqual(cards, before, 'draft changes cannot write through before Save');
  await h.form.emit('submit');
  assert.deepEqual(h.saveOptions.at(-1).cardRelationshipChanges, { add: ['B'], remove: ['A'] });
  assert.deepEqual(cards.map(card => card.stampDieSetIds), [['missing-set'], ['other-set', 'set-existing']]);
  assert.deepEqual(cards.map(card => card.paperPackIds), before.map(card => card.paperPackIds));
  assert.equal('cardIds' in h.records[0], false);
});

test('Stamp Add selects multiple Cards, prevents duplicate selection, and failed save/cancel cannot change Cards', async (t) => {
  const cards = [relationshipCard('A', ['missing-set']), relationshipCard('B', [])];
  const before = structuredClone(cards);
  const h = await harness(t, { cards });
  await h.add.emit('click'); h.name.value = 'New Set';
  await selectRelatedCard(h, 'A'); await selectRelatedCard(h, 'B');
  assert.equal(h.form.querySelectorAll('[data-remove-related-card]').length, 2);
  const search = h.form.querySelector('input[aria-label="Search Cards by date, size, or tags"]');
  search.value = '2026'; await search.emit('input');
  assert.equal(h.form.querySelectorAll('[data-add-related-card]').length, 0);
  h.setFailure(true); await h.form.emit('submit');
  assert.equal(h.records.length, 0); assert.deepEqual(cards, before);
  assert.equal(h.dialog.open, true);
  h.setFailure(false); await h.form.emit('submit');
  const id = h.records[0].id;
  assert.deepEqual(cards.map(card => card.stampDieSetIds), [['missing-set', id], [id]]);
  assert.deepEqual(h.saveOptions.at(-1).cardRelationshipChanges, { add: ['A', 'B'], remove: [] });
  assert.equal('cardIds' in h.records[0], false);
  await h.add.emit('click'); await selectRelatedCard(h, 'A'); await h.cancel.emit('click');
  assert.deepEqual(cards.map(card => card.stampDieSetIds), [['missing-set', id], [id]]);
});

test('removing then reselecting an existing Card leaves its relationship unchanged', async (t) => {
  const cards = [relationshipCard('A', ['set-existing', 'missing'])];
  const h = await harness(t, { cards });
  await seedEdit(h); await removeRelatedCard(h, 'A'); await selectRelatedCard(h, 'A');
  await h.form.emit('submit');
  assert.deepEqual(h.saveOptions.at(-1).cardRelationshipChanges, { add: [], remove: [] });
  assert.deepEqual(cards[0].stampDieSetIds, ['set-existing', 'missing']);
});


test('Stamp form header Close discards the draft like Cancel and allows a fresh Add', async (t) => {
  const h = await harness(t);
  await h.headerAdd.emit('click');
  const close = h.dialog.querySelector('header').querySelector('.card-add-close');
  assert.equal(close.type, 'button');
  assert.equal(close.textContent, String.fromCodePoint(215));
  assert.equal(close.getAttribute('aria-label'), 'Close Stamp & Die Set form');
  h.name.value = 'Unsaved draft';
  await close.emit('click');
  assert.equal(h.dialog.open, false);
  assert.equal(h.records.length, 0);
  assert.equal(h.calls(), 0);
  assert.equal(h.document.activeElement, h.add);
  await h.headerAdd.emit('click');
  assert.equal(h.dialog.open, true);
  assert.equal(h.name.value, '');
});
