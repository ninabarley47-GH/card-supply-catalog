import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeStampDieSet } from './stamp-die-sets.js';
import { initializeScreenNavigation } from './library.js';

const catalog = {
  schemaVersion: 1,
  tags: [{ id: 'stable-one', name: 'Floral', appliesTo: ['paper'], categoryIds: ['flowers'] }],
  categories: [{ id: 'flowers', name: 'Flowers' }]
};
const setRecord = () => ({
  id: 'set-one', name: 'Garden', imageRefs: [{ imagePath: 'Garden/stamps.jpg' }, { imagePath: 'Garden/dies.jpg' }],
  tagIds: ['stable-one'], favorite: false, dateCreated: '2026-09-05'
});

test('set metadata supports multiple images without persisting runtime image sources', () => {
  const input = setRecord();
  input.imageRefs[0].imagePreviewSrc = 'blob:temporary';
  const record = normalizeStampDieSet(input, catalog);
  assert.deepEqual(record.imageRefs, setRecord().imageRefs);
  assert.notEqual(record.imageRefs[0], input.imageRefs[0]);
  assert.equal(record.schemaVersion, 3);
  assert.equal(normalizeStampDieSet({ ...input, imageRefs: [] }, catalog).imageRefs.length, 0);
  assert.throws(() => normalizeStampDieSet({ ...input, name: ' ' }, catalog));
  assert.throws(() => normalizeStampDieSet({ ...input, dateCreated: '2026-02-30' }, catalog));
  for (const imagePath of ['../outside.jpg', '/absolute.jpg', 'blob:temporary']) {
    assert.throws(() => normalizeStampDieSet({ ...input, imageRefs: [{ imagePath }] }, catalog));
  }
});

test('set assignments use global IDs across renames and ignore deprecated applicability', () => {
  const input = setRecord();
  const renamed = structuredClone(catalog);
  renamed.tags[0].name = 'Botanical';
  assert.deepEqual(normalizeStampDieSet(input, renamed).tagIds, ['stable-one']);
  for (const tagIds of [['Floral'], ['flowers'], ['missing'], ['stable-one', 'stable-one']]) {
    assert.throws(() => normalizeStampDieSet({ ...input, tagIds }, catalog));
  }
  assert.equal('tags' in normalizeStampDieSet({ ...input, tags: ['Wrong'] }, catalog), false);
});

test('existing hash navigation opens Stamps & Dies and returns to Paper and Cards', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const screens = [...html.matchAll(/<section[^>]*id="([^"]+)"[^>]*data-screen[^>]*>/g)].map((match) => ({
    id: match[1], hidden: false, matches: (selector) => selector === '[data-screen]'
  }));
  const links = [...html.matchAll(/<a[^>]*href="(#[^"]+)"[^>]*data-nav-link[^>]*>/g)].map((match) => ({
    hash: match[1], attributes: {}, classList: { toggle() {} },
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; }
  }));
  const groups = ['library', 'cards'].map((id) => ({ dataset: { sidebarControls: id } }));
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  let onHashChange;
  globalThis.document = {
    querySelectorAll: (selector) => ({ '[data-screen]': screens, '[data-nav-link]': links, '[data-sidebar-controls]': groups })[selector],
    getElementById: (id) => screens.find((screen) => screen.id === id)
  };
  globalThis.window = { location: { hash: '#stamps-dies' }, addEventListener: (_, callback) => { onHashChange = callback; } };
  try {
    initializeScreenNavigation();
    for (const id of ['stamps-dies', 'library', 'cards', 'color-library', 'settings', 'stamps-dies']) {
      window.location.hash = `#${id}`;
      onHashChange();
      assert.deepEqual(screens.filter((screen) => !screen.hidden).map((screen) => screen.id), [id]);
      assert.deepEqual(links.filter((link) => link.attributes['aria-current'] === 'page').map((link) => link.hash), [`#${id}`]);
      assert.ok(groups.every((group) => group.hidden === (group.dataset.sidebarControls !== id)));
    }
  } finally { globalThis.window = oldWindow; globalThis.document = oldDocument; }
});

// Small request/transaction harness exercises the real storage upgrade and APIs.
function databaseHarness() {
  const stores = new Map(['paperPacks', 'cards', 'colors', 'owners', 'deletedPaperPackIds', 'settings'].map((name) => [name, new Map([[name, { id: name, sentinel: 'preserve' }]])]));
  stores.get('settings').set('globalTagCatalog', { id: 'globalTagCatalog', value: structuredClone(catalog) });
  stores.get('settings').set('globalTagMigrationVersion', { id: 'globalTagMigrationVersion', value: 1 });
  const added = [];
  const request = (result) => {
    const target = new EventTarget();
    target.result = structuredClone(result);
    queueMicrotask(() => target.dispatchEvent(new Event('success')));
    return target;
  };
  const database = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore(name, options) {
      assert.equal(options.keyPath, 'id');
      assert.equal(stores.has(name), false);
      added.push(name);
      stores.set(name, new Map());
    },
    transaction(names, mode) {
      const target = new EventTarget();
      const snapshot = structuredClone(stores);
      let aborted = false;
      target.objectStore = (name) => ({
        get: (id) => request(stores.get(name).get(id)),
        getAll: () => request([...stores.get(name).values()]),
        put: (record) => stores.get(name).set(record.id, structuredClone(record)),
        delete: (id) => stores.get(name).delete(id)
      });
      target.abort = () => {
        aborted = true;
        stores.clear();
        for (const [key, value] of snapshot) stores.set(key, value);
        target.dispatchEvent(new Event('abort'));
      };
      if (mode === 'readwrite') queueMicrotask(() => { if (!aborted) target.dispatchEvent(new Event('complete')); });
      return target;
    }
  };
  return { stores, added, indexedDB: { open(name, version) {
    assert.equal(name, 'card-supply-catalog');
    assert.equal(version, 6);
    const target = new EventTarget();
    target.result = database;
    queueMicrotask(() => {
      target.dispatchEvent(new Event('upgradeneeded'));
      target.dispatchEvent(new Event('success'));
    });
    return target;
  } } };
}

test('database upgrade preserves all existing stores and set saves round-trip canonical metadata', async () => {
  const harness = databaseHarness();
  const before = structuredClone(harness.stores);
  const oldWindow = globalThis.window;
  globalThis.window = { indexedDB: harness.indexedDB, localStorage: { getItem: () => 'true' } };
  try {
    const storage = await import('./storage.js?stamp-die-storage-test');
    assert.deepEqual(await storage.loadSavedStampDieSets(), []);
    assert.deepEqual(harness.added, ['stampDieSets']);
    for (const [name, records] of before) assert.deepEqual(harness.stores.get(name), records);
    await storage.saveStampDieSet(setRecord());
    assert.deepEqual(await storage.loadSavedStampDieSets(), [normalizeStampDieSet(setRecord(), catalog)]);
    await assert.rejects(storage.saveStampDieSet({ ...setRecord(), tagIds: ['flowers'] }));
    for (const [name, records] of before) assert.deepEqual(harness.stores.get(name), records);
    const withoutTags = { ...catalog, tags: [] };
    await assert.rejects(storage.saveGlobalTagCatalog(withoutTags));
    const result = await storage.deleteGlobalTagEverywhere('stable-one');
    assert.equal(result.stampCount, 1);
    assert.deepEqual((await storage.loadSavedStampDieSets())[0].tagIds, []);
    assert.deepEqual((await storage.loadSavedStampDieSets())[0].imageRefs, setRecord().imageRefs);
  } finally { globalThis.window = oldWindow; }
});

test('Phase 2A canonical creation survives storage reload with empty imageRefs', async () => {
  const harness = databaseHarness();
  const previousWindow = globalThis.window;
  globalThis.window = { indexedDB: harness.indexedDB, localStorage: { getItem: () => 'true' } };
  try {
    const { createStampDieSetRecord } = await import('./stamp-die-library.js');
    const firstSession = await import('./storage.js?phase2a-save');
    const record = createStampDieSetRecord({ name: 'Garden', dateCreated: '2026-09-05', favorite: true, tagIds: ['stable-one'] }, catalog);
    await firstSession.saveStampDieSet(record);
    // A fresh module instance has no cached database or global tag state.
    const nextSession = await import('./storage.js?phase2a-reload');
    assert.deepEqual(await nextSession.loadSavedStampDieSets(), [record]);
    assert.deepEqual(record.imageRefs, []);
    assert.deepEqual(record.tagIds, ['stable-one']);
    assert.equal(record.favorite, true);
  } finally { globalThis.window = previousWindow; }
});
