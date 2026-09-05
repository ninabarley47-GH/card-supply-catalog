import { CATALOG_SCHEMA_VERSION } from './schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeStampDieLibrary, createStampDieSetRecord } from './stamp-die-library.js';
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
  dispatchEvent(event) { return this.emit(event.type, { target: event.target || this }); }
  matches(selector) {
    const tag = selector.match(/^[a-z]+/);
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
  const previous = { document: globalThis.document, window: globalThis.window };
  t.after(() => Object.assign(globalThis, previous));
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
  globalThis.document = document;
  globalThis.window = { location: { hash: '#stamps-dies' } };
  const records = [];
  let catalog = initialCatalog();
  let failure = false;
  let commitGate;
  let calls = 0;
  await initializeStampDieLibrary({
    ...otherCatalogServices,
    loadGlobalTagCatalog: async () => structuredClone(catalog),
    loadSavedStampDieSets: async () => structuredClone(records),
    saveStampDieSet: async (record) => {
      calls += 1;
      if (commitGate) await commitGate;
      if (failure) throw new Error('Storage unavailable');
      records.push(structuredClone(record));
    }
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
  return { document, add, gallery, status, dialog, form, name, year, favorite, cancel, records, select,
    calls: () => calls, setFailure: (value) => { failure = value; }, setGate: (value) => { commitGate = value; },
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
  assert.deepEqual(record, { schemaVersion: CATALOG_SCHEMA_VERSION, id: record.id, name: 'Garden', dateCreated: getLocalDateValue(), releaseYear: 2024, favorite: true, tagIds: ['stable-paper', 'stable-card'], imageRefs: [] });
  assert.equal(h.dialog.open, false);
  assert.equal(saves, 1);
  assert.match(h.gallery.textContent, /No image.*Garden.*2024.*Favorite.*Floral.*Birthday/);
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
  assert.equal((await h.dialog.emit('cancel')).defaultPrevented, true);
  assert.equal(h.dialog.open, true);
  assert.equal(h.calls(), 2);
  release();
  await saving;
  assert.equal(h.records.length, 1);
});

test('record creation rejects malformed dates/category assignments and always starts without images', () => {
  const input = { name: 'Garden', dateCreated: '2026-09-01', favorite: false, tagIds: [] };
  assert.throws(() => createStampDieSetRecord({ ...input, dateCreated: '2026-02-30' }, initialCatalog()));
  assert.throws(() => createStampDieSetRecord({ ...input, tagIds: ['nature'] }, initialCatalog()));
  assert.deepEqual(createStampDieSetRecord({ ...input, imageRefs: [{ imagePath: 'ignored.jpg' }] }, initialCatalog()).imageRefs, []);
});

test('Add Set is wired into the application and offline shell without any image API', async () => {
  const [app, shell, html, source, settings] = await Promise.all(['app.js', '../sw.js', '../index.html', 'stamp-die-library.js', 'settings.js'].map((file) => readFile(new URL(file, import.meta.url), 'utf8')));
  assert.match(app, /await initializeStampDieLibrary\(\)/);
  assert.match(shell, /\.\/js\/stamp-die-library\.js/);
  assert.match(shell, /\.\/js\/ui\.js/);
  assert.match(html, /data-add-set>Add Set/);
  assert.match(settings, /catalog:stamp-die-set-saved/);
  assert.doesNotMatch(source, /showOpenFilePicker|showDirectoryPicker|FileReader|createObjectURL|type = 'file'|card-images|\.\/images/);
});


test('Library does not present an older creation date as a release year', async (t) => {
  const h = await harness(t);
  h.records.push(createStampDieSetRecord({ name: 'Older Set', dateCreated: '2020-05-01', favorite: false, tagIds: [] }, initialCatalog()));
  await h.document.emit('catalog:global-tags-updated');
  assert.match(h.gallery.textContent, /Release year not recorded/);
  assert.doesNotMatch(h.gallery.textContent, /2020/);
});
