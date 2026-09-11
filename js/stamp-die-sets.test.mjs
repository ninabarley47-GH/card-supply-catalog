import { CATALOG_SCHEMA_VERSION } from './schema.js';
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
  assert.equal(record.schemaVersion, CATALOG_SCHEMA_VERSION);
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
  const groups = ['library', 'cards', 'stamps-dies'].map((id) => ({ dataset: { sidebarControls: id } }));
  const stampAddButton = { hidden: false };
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  let onHashChange;
  globalThis.document = {
    addEventListener() {},
    querySelectorAll: (selector) => ({ '[data-screen]': screens, '[data-nav-link]': links, '[data-sidebar-controls]': groups })[selector],
    getElementById: (id) => id === "add-stamp-set" ? stampAddButton : screens.find((screen) => screen.id === id)
  };
  globalThis.window = { location: { hash: '#stamps-dies' }, addEventListener: (_, callback) => { onHashChange = callback; } };
  try {
    initializeScreenNavigation();
    assert.equal(stampAddButton.hidden, false);
    for (const id of ['stamps-dies', 'library', 'cards', 'color-library', 'settings', 'stamps-dies']) {
      window.location.hash = `#${id}`;
      onHashChange();
      assert.equal(stampAddButton.hidden, false);
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
  let failCommit = false;
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
        openCursor: () => {
          const target = new EventTarget();
          const ids = [...stores.get(name).keys()];
          let index = 0;
          const next = () => queueMicrotask(() => {
            const id = ids[index++];
            target.result = id === undefined ? null : {
              value: structuredClone(stores.get(name).get(id)),
              update: record => stores.get(name).set(id, structuredClone(record)),
              continue: next
            };
            target.dispatchEvent(new Event('success'));
          });
          next();
          return target;
        },
        put: (record) => stores.get(name).set(record.id, structuredClone(record)),
        delete: (id) => stores.get(name).delete(id)
      });
      target.abort = () => {
        aborted = true;
        stores.clear();
        for (const [key, value] of snapshot) stores.set(key, value);
        target.dispatchEvent(new Event('abort'));
      };
      if (mode === 'readwrite') setTimeout(() => {
        if (failCommit) { failCommit = false; target.error = new Error('Simulated failed commit'); target.abort(); }
        else if (!aborted) target.dispatchEvent(new Event('complete'));
      });
      return target;
    }
  };
  return { stores, added, failNextCommit: () => { failCommit = true; }, indexedDB: { open(name, version) {
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
    const record = createStampDieSetRecord({ name: 'Garden', dateCreated: '2026-09-05', releaseYear: 2024, favorite: true, tagIds: ['stable-one'] }, catalog);
    await firstSession.saveStampDieSet(record);
    // A fresh module instance has no cached database or global tag state.
    const nextSession = await import('./storage.js?phase2a-reload');
    assert.deepEqual(await nextSession.loadSavedStampDieSets(), [record]);
    assert.deepEqual(record.imageRefs, []);
    assert.deepEqual(record.tagIds, ['stable-one']);
    assert.equal(record.favorite, true);
  } finally { globalThis.window = previousWindow; }
});


test('Release Year validates the Paper year range while legacy creation dates remain metadata', () => {
  for (const releaseYear of [1990, 2024, 2100]) {
    assert.equal(normalizeStampDieSet({ ...setRecord(), releaseYear }, catalog).releaseYear, releaseYear);
  }
  for (const releaseYear of [1989, 2101, 2024.5, '2024', null]) {
    assert.throws(() => normalizeStampDieSet({ ...setRecord(), releaseYear }, catalog));
  }
  const legacy = { ...setRecord(), schemaVersion: 3 };
  const normalized = normalizeStampDieSet(legacy, catalog);
  assert.equal('releaseYear' in normalized, false);
  assert.equal(normalized.dateCreated, legacy.dateCreated);
  assert.equal(normalized.id, legacy.id);
  assert.deepEqual(normalized.tagIds, legacy.tagIds);
});


test('image references and inferred ordinary tags commit together and survive reload', async () => {
  const harness = databaseHarness();
  const previousWindow = globalThis.window;
  globalThis.window = { indexedDB: harness.indexedDB, localStorage: { getItem: () => 'true' } };
  try {
    const { inferStampDieImageTags } = await import('./stamp-die-image-tags.js');
    const storage = await import('./storage.js?image-set-save');
    const inferred = inferStampDieImageTags(catalog, ['stable-one'], ['stamp.jpg', 'die.jpg', 'mask.jpg']);
    const refs = [
      { imageName: 'stamp.jpg', imagePath: 'stamp.jpg', imageLibrary: 'stamp-die-images', thumbnailImagePath: 'stamp.thumb.jpg', imageStorageStrategy: 'local-folder' },
      { imageName: 'die.jpg', imageSrc: 'data:image/jpeg;base64,ZnVsbA==', thumbnailImageSrc: 'data:image/jpeg;base64,dGh1bWI=', imageStorageStrategy: 'embedded-indexed-db' }
    ];
    const record = { ...setRecord(), imageRefs: refs, tagIds: inferred.tagIds };
    await storage.saveStampDieSet(record, { inferredTags: inferred.inferredTags });
    const nextSession = await import('./storage.js?image-set-reload');
    const [reloaded] = await nextSession.loadSavedStampDieSets();
    assert.deepEqual(reloaded.imageRefs, refs);
    assert.deepEqual(reloaded.tagIds, inferred.tagIds);
    const savedCatalog = await nextSession.loadGlobalTagCatalog();
    assert.equal(savedCatalog.tags.length, 4);
    assert.ok(savedCatalog.tags.some((tag) => tag.name === 'Stamp'));
    assert.ok(savedCatalog.tags.some((tag) => tag.name === 'Die'));
    assert.ok(savedCatalog.tags.some((tag) => tag.name === 'Mask'));
  } finally { globalThis.window = previousWindow; }
});

test('failed Set transaction leaves both image references and inferred global tags unpersisted', async () => {
  const harness = databaseHarness();
  const previousWindow = globalThis.window;
  globalThis.window = { indexedDB: harness.indexedDB, localStorage: { getItem: () => 'true' } };
  try {
    const { inferStampDieImageTags } = await import('./stamp-die-image-tags.js');
    const storage = await import('./storage.js?image-set-abort');
    await storage.loadSavedStampDieSets();
    const before = structuredClone(harness.stores);
    const inferred = inferStampDieImageTags(catalog, [], ['stamp.jpg']);
    harness.failNextCommit();
    await assert.rejects(storage.saveStampDieSet({ ...setRecord(), tagIds: inferred.tagIds, imageRefs: [{ imageSrc: 'data:image/jpeg;base64,ZnVsbA==' }] }, { inferredTags: inferred.inferredTags }));
    assert.deepEqual(harness.stores, before);
    assert.deepEqual(await storage.loadGlobalTagCatalog(), catalog);
  } finally { globalThis.window = previousWindow; }
});

test('Edit replaces the same stored ID and preserves mixed image fields on reload without disturbing other stores', async () => {
  const harness = databaseHarness();
  const previousWindow = globalThis.window;
  globalThis.window = { indexedDB: harness.indexedDB, localStorage: { getItem: () => 'true' } };
  try {
    const storage = await import('./storage.js?edit-roundtrip');
    await storage.saveStampDieSet(setRecord());
    const before = structuredClone(harness.stores);
    const edited = { ...setRecord(), name: 'Renamed', releaseYear: 2025, favorite: false, imageRefs: [
      { imagePath: 'Stamp.jpg', thumbnailImagePath: 'Stamp.thumb.jpg', imageLibrary: 'stamp-die-images', imageStorageStrategy: 'local-folder' },
      { imageSrc: 'data:image/jpeg;base64,YQ==', thumbnailImageSrc: 'data:image/jpeg;base64,Yg==', imageStorageStrategy: 'embedded-indexed-db' }
    ] };
    await storage.saveStampDieSet(edited);
    const reloaded = await import('./storage.js?edit-roundtrip-reload');
    assert.deepEqual(await reloaded.loadSavedStampDieSets(), [normalizeStampDieSet(edited, catalog)]);
    for (const [name, records] of before) if (name !== 'stampDieSets') assert.deepEqual(harness.stores.get(name), records);
    harness.failNextCommit();
    await assert.rejects(storage.saveStampDieSet({ ...edited, name: 'Failed', imageRefs: [] }));
    assert.deepEqual(await reloaded.loadSavedStampDieSets(), [normalizeStampDieSet(edited, catalog)]);
  } finally { globalThis.window = previousWindow; }
});

test('Delete removes only the Set store record; failed commit preserves references and all other stores', async () => {
  const h = databaseHarness();
  const previous = globalThis.window;
  globalThis.window = { indexedDB: h.indexedDB, localStorage: { getItem: () => 'true' } };
  try {
    const storage = await import('./storage.js?set-delete');
    await storage.saveStampDieSet(setRecord());
    await storage.saveStampDieSet({ ...setRecord(), id: 'keep' });
    const before = structuredClone(h.stores);
    h.failNextCommit();
    await assert.rejects(storage.deleteStampDieSet(setRecord().id));
    assert.deepEqual(h.stores, before);
    await storage.deleteStampDieSet(setRecord().id);
    assert.deepEqual((await storage.loadSavedStampDieSets()).map((record) => record.id), ['keep']);
    for (const [name, records] of before) if (name !== 'stampDieSets') assert.deepEqual(h.stores.get(name), records);
  } finally { globalThis.window = previous; }
});


test('Set owner IDs persist without names and legacy sets remain readable', () => {
  const record = normalizeStampDieSet({ ...setRecord(), ownerId: 'owner-nina', owner: 'Old name' }, catalog);
  assert.equal(record.ownerId, 'owner-nina');
  assert.equal('owner' in record, false);
  assert.equal('ownerId' in normalizeStampDieSet(setRecord(), catalog), false);
  for (const ownerId of [null, 1, '', '  ']) {
    assert.throws(() => normalizeStampDieSet({ ...setRecord(), ownerId }, catalog));
  }
});

test('Set and new owner commit atomically and survive reload', async () => {
  const h = databaseHarness();
  const previous = globalThis.window;
  globalThis.window = { indexedDB: h.indexedDB, localStorage: { getItem: () => 'true' } };
  try {
    const storage = await import('./storage.js?set-owner-atomic');
    await storage.loadSavedStampDieSets();
    const owner = { id: 'owner-jordan', name: 'Jordan' };
    const record = { ...setRecord(), ownerId: owner.id };
    h.failNextCommit();
    await assert.rejects(storage.saveStampDieSet(record, { owner }));
    assert.equal(h.stores.get('owners').has(owner.id), false);
    assert.deepEqual(await storage.loadSavedStampDieSets(), []);
    await storage.saveStampDieSet(record, { owner });
    const reloaded = await import('./storage.js?set-owner-reload');
    assert.equal((await reloaded.loadSavedStampDieSets())[0].ownerId, owner.id);
    assert.deepEqual(h.stores.get('owners').get(owner.id), owner);
  } finally { globalThis.window = previous; }
});

for (const failCommit of [false, true]) {
  test(`backup restore writes all catalog stores atomically (commit failure=${failCommit}) and preserves local handles`, async (t) => {
    const h = databaseHarness();
    const previousWindow = globalThis.window;
    t.after(() => { globalThis.window = previousWindow; });
    globalThis.window = { indexedDB: h.indexedDB, localStorage: { getItem: () => 'true' } };
    const storage = await import(`./storage.js?backup-atomic-${failCommit}`);
    await storage.loadSavedStampDieRecordsForRestore();
    for (const id of ['imageLibrary', 'cardImageLibrary', 'stampDieImageLibrary', 'exportLibrary']) {
      h.stores.get('settings').set(id, { id, value: { directoryHandle: { name: `Local ${id}` }, selectedAt: 'local' } });
    }
    const before = structuredClone(h.stores);
    const records = {
      paperPacks: [{ id: 'restored-paper', name: 'Paper', ownerId: 'restored-owner', releaseYear: 2024,
        patternCount: 0, colors: [], tagIds: ['stable-one'], patterns: [] }],
      cards: [{ id: 'restored-card', dateCreated: '2026-09-05', size: { width: 4, height: 6 }, tagIds: ['stable-one'],
        paperPackIds: [], colorIds: [], favorite: false }],
      colors: [{ id: 'restored-color', name: 'Blue' }],
      owners: [{ id: 'restored-owner', name: 'Tester' }], tagCatalog: catalog,
      stampDieSets: [{ ...setRecord(), ownerId: 'restored-owner', favorite: true }]
    };
    if (failCommit) {
      h.failNextCommit();
      await assert.rejects(storage.restoreCatalogRecords(records));
      assert.deepEqual(h.stores, before, 'Paper/Card/Set/color/owner/tag/settings writes must all roll back');
    } else {
      await storage.restoreCatalogRecords(records);
      assert.deepEqual(await storage.loadSavedStampDieRecordsForRestore(), [normalizeStampDieSet(records.stampDieSets[0], catalog)]);
      assert.ok(h.stores.get('paperPacks').has('restored-paper'));
      assert.ok(h.stores.get('cards').has('restored-card'));
      assert.ok(h.stores.get('colors').has('restored-color'));
      assert.ok(h.stores.get('owners').has('restored-owner'));
      assert.deepEqual(h.stores.get('settings').get('globalTagCatalog').value, catalog);
      for (const id of ['imageLibrary', 'cardImageLibrary', 'stampDieImageLibrary', 'exportLibrary']) {
        assert.deepEqual(h.stores.get('settings').get(id), before.get('settings').get(id));
      }
      // Older backups pass no Sets: even replacement mode must not clear local Sets.
      await storage.restoreCatalogRecords({ owners: records.owners, tagCatalog: catalog });
      assert.equal((await storage.loadSavedStampDieRecordsForRestore()).length, 1);
    }
  });
}

test('atomic restore rejects invalid Set data and unknown owners before touching IndexedDB', async () => {
  const storage = await import('./storage.js?invalid-stamp-restore');
  await assert.rejects(storage.restoreCatalogRecords({ tagCatalog: catalog,
    stampDieSets: [{ ...setRecord(), imageRefs: [{ imagePath: '../bad.jpg' }] }] }), /Invalid imagePath/);
  await assert.rejects(storage.restoreCatalogRecords({ tagCatalog: catalog,
    stampDieSets: [{ ...setRecord(), ownerId: 'unknown' }] }), /unknown owner/);
});

test('Export Library configuration persists through a fresh storage session', async (t) => {
  const h = databaseHarness(); const previousWindow = globalThis.window;
  t.after(() => { globalThis.window = previousWindow; });
  globalThis.window = { indexedDB: h.indexedDB, localStorage: { getItem: () => 'true' } };
  const storage = await import('./storage.js?export-library-save');
  const configuration = { strategy: 'local-folder', directoryHandle: { name: 'Exports' }, selectedAt: '2026-09-07T00:00:00Z' };
  await storage.saveCatalogSetting('exportLibrary', configuration);
  const fresh = await import('./storage.js?export-library-reload');
  assert.deepEqual(await fresh.loadCatalogSetting('exportLibrary'), configuration);
});

test('Card Notes survives storage reload, editing and clearing without rewriting legacy Cards on load', async (t) => {
  const h = databaseHarness(); const previousWindow = globalThis.window;
  t.after(() => { globalThis.window = previousWindow; });
  globalThis.window = { indexedDB: h.indexedDB, localStorage: { getItem: () => 'true' } };
  const storage = await import('./storage.js?card-notes-save');
  await storage.loadSavedStampDieSets();
  const legacy = { id: 'notes-card', dateCreated: '2026-09-07', size: { width: 4, height: 6 },
    tagIds: ['stable-one'], paperPackIds: [], colorIds: [], favorite: false };
  h.stores.get('cards').set(legacy.id, structuredClone(legacy));
  assert.equal((await storage.loadSavedCards()).find(c => c.id === legacy.id).notes, '');
  assert.deepEqual(h.stores.get('cards').get(legacy.id), legacy);
  for (const notes of ['  First\n\nSecond  ', 'Changed\nText', '']) {
    await storage.saveCard({ ...legacy, notes });
    const fresh = await import(`./storage.js?card-notes-reload-${encodeURIComponent(notes)}`);
    assert.equal((await fresh.loadSavedCards()).find(c => c.id === legacy.id).notes, notes.trim());
    assert.equal(h.stores.get('cards').get(legacy.id).notes, notes.trim());
  }
});

test('Card Stamp references normalize through real storage APIs without rewriting on load; Set deletion preserves Cards', async (t) => {
  const h = databaseHarness(); const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  globalThis.window = { indexedDB: h.indexedDB, localStorage: { getItem: () => 'true' } };
  const storage = await import('./storage.js?card-stamp-persistence');
  await storage.saveStampDieSet(setRecord());
  const base = { id: 'relationship-card', dateCreated: '2026-09-07', size: { width: 4, height: 6 },
    tagIds: [], paperPackIds: ['paper-one', 'paper-one'], colorIds: [], favorite: false };
  const cases = [
    [undefined, []], [null, []], ['bad', []], [{ bad: true }, []],
    [[setRecord().id, null, '', 42, {}, setRecord().id, 'missing-set'], [setRecord().id, 'missing-set']]
  ];
  for (const [value, expected] of cases) {
    const raw = { ...base, ...(value === undefined ? {} : { stampDieSetIds: value }) };
    h.stores.get('cards').set(base.id, structuredClone(raw));
    const before = structuredClone(h.stores);
    const loaded = (await storage.loadSavedCards()).find(card => card.id === base.id);
    assert.ok(loaded, 'malformed optional references cannot exclude the Card');
    assert.deepEqual(loaded.stampDieSetIds, expected);
    assert.deepEqual(loaded.paperPackIds, base.paperPackIds);
    assert.deepEqual(h.stores, before, 'loading does not rewrite stored records');
    await storage.restoreCatalogRecords({ cards: [raw], tagCatalog: catalog });
    assert.deepEqual(h.stores.get('cards').get(base.id).stampDieSetIds, expected);
    assert.equal(h.stores.get('cards').get(base.id).schemaVersion, 8);
    await storage.saveCard(raw);
    assert.deepEqual((await storage.loadSavedCards()).find(card => card.id === base.id).stampDieSetIds, expected);
  }
  const beforeDelete = structuredClone(h.stores);
  h.failNextCommit();
  await assert.rejects(storage.deleteStampDieSet(setRecord().id));
  assert.deepEqual(h.stores, beforeDelete);
  await storage.deleteStampDieSet(setRecord().id);
  const expected = structuredClone(beforeDelete);
  expected.get('stampDieSets').delete(setRecord().id);
  assert.deepEqual(h.stores, expected, 'only the selected Set record is removed, including no library-setting changes');
  assert.deepEqual((await storage.loadSavedCards()).find(card => card.id === base.id).stampDieSetIds, [setRecord().id, 'missing-set']);
});


async function relationshipStorageHarness(t, suffix) {
  const h = databaseHarness(); const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  globalThis.window = { indexedDB: h.indexedDB, localStorage: { getItem: () => 'true' } };
  globalThis.window.location = { search: '' };
  const storage = await import(`./storage.js?stamp-write-through-${suffix}`);
  await storage.loadSavedStampDieSets();
  const card = (id, ids) => ({ id, dateCreated: '2026-09-07', size: { width: 4, height: 6 },
    tagIds: [], colorIds: [], favorite: false, notes: 'Latest notes', paperPackIds: ['paper-X'],
    stampDieSetIds: ids, imagePath: 'keep.jpg' });
  h.stores.get('cards').set('A', card('A', ['missing-set']));
  h.stores.get('cards').set('B', card('B', ['another-set']));
  return { h, storage };
}

test('Add Set and multiple Card relationship writes commit atomically; Edit changes only the targeted references', async t => {
  const { h, storage } = await relationshipStorageHarness(t, 'success');
  const before = structuredClone(h.stores);
  const updated = await storage.saveStampDieSet(setRecord(), { cardRelationshipChanges: { add: ['A', 'B', 'A'], remove: [] } });
  assert.equal(updated.length, 2);
  assert.deepEqual(h.stores.get('cards').get('A'), { ...before.get('cards').get('A'), stampDieSetIds: ['missing-set', 'set-one'] });
  assert.deepEqual(h.stores.get('cards').get('B').stampDieSetIds, ['another-set', 'set-one']);
  assert.equal('cardIds' in h.stores.get('stampDieSets').get('set-one'), false);
  h.stores.get('cards').get('B').notes = 'Changed elsewhere after Edit opened';
  await storage.saveStampDieSet({ ...setRecord(), name: 'Renamed' }, { cardRelationshipChanges: { add: [], remove: ['B'] } });
  assert.deepEqual(h.stores.get('cards').get('B'), { ...before.get('cards').get('B'), notes: 'Changed elsewhere after Edit opened' });
  assert.deepEqual(h.stores.get('cards').get('A').stampDieSetIds, ['missing-set', 'set-one']);
  for (const name of ['paperPacks', 'colors', 'owners', 'settings']) assert.deepEqual(h.stores.get(name), before.get(name));
});

test('unchanged Stamp selections never rewrite Cards, including concurrent and missing references', async t => {
  const { h, storage } = await relationshipStorageHarness(t, 'unchanged');
  const cards = h.stores.get('cards');
  cards.get('A').stampDieSetIds = ['set-one', 'missing', 'set-one'];
  const before = structuredClone(cards);
  await storage.saveStampDieSet(setRecord(), { cardRelationshipChanges: { add: [], remove: [] } });
  assert.deepEqual(cards, before);
  assert.deepEqual(await storage.saveStampDieSet(setRecord(), { cardRelationshipChanges: { add: ['A'], remove: ['B'] } }), []);
  assert.deepEqual(cards, before, 'already satisfied deltas do not normalize or overwrite unrelated data');
});

for (const failure of ['commit', 'missing-card', 'invalid-set']) test(`Set creation failure (${failure}) leaves no partial Card or Set writes`, async t => {
  const { h, storage } = await relationshipStorageHarness(t, failure);
  const before = structuredClone(h.stores);
  if (failure === 'commit') h.failNextCommit();
  await assert.rejects(storage.saveStampDieSet(failure === 'invalid-set' ? { ...setRecord(), name: '' } : setRecord(), {
    cardRelationshipChanges: { add: failure === 'missing-card' ? ['A', 'missing-card'] : ['A', 'B'], remove: [] }
  }));
  assert.deepEqual(h.stores, before);
});

test('failed Stamp Edit rolls back Set metadata and all relationship deltas', async t => {
  const { h, storage } = await relationshipStorageHarness(t, 'edit-failure');
  await storage.saveStampDieSet(setRecord(), { cardRelationshipChanges: { add: ['A'], remove: [] } });
  const before = structuredClone(h.stores);
  h.failNextCommit();
  await assert.rejects(storage.saveStampDieSet({ ...setRecord(), name: 'Changed' }, { cardRelationshipChanges: { add: ['B'], remove: ['A'] } }));
  assert.deepEqual(h.stores, before);
});

const migrationCard = (id, fields = {}) => ({ id, dateCreated: '2026-09-08', size: { width: 4, height: 6 },
  tagIds: [], paperPackIds: ['keep-paper'], colorIds: [], favorite: true, notes: 'keep notes',
  imagePath: 'Shared/keep.jpg', ...fields });

test('explicit startup migration commits only matched Cards, is idempotent, and preserves every other store', async t => {
  const { h, storage } = await relationshipStorageHarness(t, 'legacy-startup');
  await storage.saveStampDieSet(setRecord());
  const matched = migrationCard('legacy', { stampSets: [' garden ', 'Unknown'], stampDieSetIds: ['missing-set'] });
  const unresolved = migrationCard('unresolved', { stampSets: ['No match'] });
  h.stores.get('cards').set(matched.id, matched);
  h.stores.get('cards').set(unresolved.id, unresolved);
  const before = structuredClone(h.stores);
  await storage.loadSavedCards();
  assert.deepEqual(h.stores, before, 'ordinary loading cannot migrate');
  assert.equal(await storage.migrateLegacyCardStampSets(), 1);
  const expected = structuredClone(before);
  expected.get('cards').set('legacy', { ...matched, stampSets: ['Unknown'], stampDieSetIds: ['missing-set', 'set-one'] });
  assert.deepEqual(h.stores, expected);
  assert.equal(await storage.migrateLegacyCardStampSets(), 0);
  assert.deepEqual(h.stores, expected);
  assert.deepEqual((await storage.loadSavedCards()).find(card => card.id === 'legacy').stampDieSetIds, ['missing-set', 'set-one']);
});

test('failed startup migration retains original names and relationships for every Card; retry is safe', async t => {
  const { h, storage } = await relationshipStorageHarness(t, 'legacy-failure');
  await storage.saveStampDieSet(setRecord());
  for (const id of ['one', 'two']) h.stores.get('cards').set(id, migrationCard(id, { stampSets: ['Garden'] }));
  const before = structuredClone(h.stores);
  h.failNextCommit();
  await assert.rejects(storage.migrateLegacyCardStampSets());
  assert.deepEqual(h.stores, before);
  assert.equal(await storage.migrateLegacyCardStampSets(), 2);
  for (const id of ['one', 'two']) {
    assert.deepEqual(h.stores.get('cards').get(id).stampDieSetIds, ['set-one']);
    assert.equal('stampSets' in h.stores.get('cards').get(id), false);
  }
});

test('startup retries unresolved names against current Sets, without selecting an ambiguous match', async t => {
  const { h, storage } = await relationshipStorageHarness(t, 'legacy-ambiguous');
  const card = migrationCard('unresolved', { stampSets: ['Garden'] });
  h.stores.get('cards').set(card.id, card);
  assert.equal(await storage.migrateLegacyCardStampSets(), 0);
  await storage.saveStampDieSet(setRecord());
  await storage.saveStampDieSet({ ...setRecord(), id: 'second', name: ' garden ' });
  assert.equal(await storage.migrateLegacyCardStampSets(), 0);
  assert.deepEqual(h.stores.get('cards').get(card.id), card);
  await storage.saveStampDieSet({ ...setRecord(), id: 'second', name: 'Other name' });
  assert.equal(await storage.migrateLegacyCardStampSets(), 1);
});

for (const overwriteExisting of [false, true]) test(`older-backup import migrates using the final catalog (replace=${overwriteExisting})`, async t => {
  const { h, storage } = await relationshipStorageHarness(t, `legacy-import-${overwriteExisting}`);
  const { createCatalogBackupSnapshot, restoreCatalogBackup } = await import('./backup.js');
  await storage.saveStampDieSet({ ...setRecord(), name: 'Local name' });
  await storage.saveStampDieSet({ ...setRecord(), id: 'local-only', name: 'Local only' });
  const skipped = migrationCard('skip-card', { stampSets: ['Local only'] });
  h.stores.get('cards').set(skipped.id, skipped);
  const backup = createCatalogBackupSnapshot({ paperPacks: [], colorsById: {}, tagCatalog: catalog,
    stampDieSets: [{ ...setRecord(), name: 'Imported name' }],
    cards: [migrationCard('imported', { stampSets: ['Local name', 'Imported name', 'Local only', 'Unknown'] })] });
  const beforeBackup = structuredClone(backup);
  const result = await restoreCatalogBackup({ backup, paperPacks: [], colorsById: {}, overwriteExisting, services: {
    loadGlobalTagCatalog: async () => catalog, loadSavedCardRecordsForRestore: storage.loadSavedCardRecordsForRestore,
    loadSavedStampDieRecordsForRestore: storage.loadSavedStampDieRecordsForRestore, restoreCatalogRecords: storage.restoreCatalogRecords,
    dispatchCardsRestored() {}, dispatchStampSetsRestored() {}, dispatchCatalogRestored() {}
  } });
  assert.deepEqual(result.errors, []);
  const stored = h.stores.get('cards').get('imported');
  assert.deepEqual(stored.stampDieSetIds, ['set-one', 'local-only']);
  assert.deepEqual(stored.stampSets, [overwriteExisting ? 'Local name' : 'Imported name', 'Unknown']);
  assert.deepEqual(h.stores.get('cards').get('skip-card'), skipped);
  assert.deepEqual(stored.paperPackIds, ['keep-paper']);
  assert.deepEqual(backup, beforeBackup);
});

test('pre-Set backup converts legacy singular names using local Sets and round-trips the resulting IDs', async t => {
  const { h, storage } = await relationshipStorageHarness(t, 'legacy-old-backup');
  const { createCatalogBackupSnapshot, restoreCatalogBackup } = await import('./backup.js');
  await storage.saveStampDieSet(setRecord());
  const backup = createCatalogBackupSnapshot({ paperPacks: [], colorsById: {}, tagCatalog: catalog,
    cards: [migrationCard('old', { stampSet: 'Garden' })] });
  delete backup.stampDieSets;
  delete backup.cards[0].stampDieSetIds;
  backup.schemaVersion = 3;
  backup.catalogSchemaVersion = 7;
  const services = { loadGlobalTagCatalog: async () => catalog,
    loadSavedCardRecordsForRestore: storage.loadSavedCardRecordsForRestore,
    loadSavedStampDieRecordsForRestore: storage.loadSavedStampDieRecordsForRestore,
    restoreCatalogRecords: storage.restoreCatalogRecords, dispatchCardsRestored() {}, dispatchStampSetsRestored() {}, dispatchCatalogRestored() {} };
  const result = await restoreCatalogBackup({ backup, paperPacks: [], colorsById: {}, services });
  assert.deepEqual(result.errors, []);
  const restored = h.stores.get('cards').get('old');
  assert.deepEqual(restored.stampDieSetIds, ['set-one']);
  assert.equal('stampSet' in restored, false);
  assert.equal('stampSets' in restored, false);
  const roundTrip = createCatalogBackupSnapshot({ paperPacks: [], colorsById: {}, tagCatalog: catalog, cards: [restored] });
  assert.deepEqual((await restoreCatalogBackup({ backup: roundTrip, paperPacks: [], colorsById: {}, overwriteExisting: true, services })).errors, []);
  assert.deepEqual(h.stores.get('cards').get('old').stampDieSetIds, ['set-one']);
});

test('restore migration failure rolls back names, ID references, and incoming Sets atomically', async t => {
  const { h, storage } = await relationshipStorageHarness(t, 'legacy-restore-failure');
  const before = structuredClone(h.stores);
  h.failNextCommit();
  await assert.rejects(storage.restoreCatalogRecords({ tagCatalog: catalog,
    stampDieSets: [setRecord()], cards: [migrationCard('old', { stampSets: ['Garden'] })] }));
  assert.deepEqual(h.stores, before);
});

test('main Library navigation keeps its labels and targets in Paper, Stamp, Card, Color, Settings order', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const links = [...html.matchAll(/<a[^>]*href="(#[^"]+)"[^>]*data-nav-link>([^<]+)<\/a>/g)];
  assert.deepEqual(links.map(match => match[1]), ['#library', '#stamps-dies', '#cards', '#color-library', '#settings']);
  assert.deepEqual(links.map(match => match[2]), ['Paper Library', 'Stamps &amp; Dies', 'Card Library', 'Color Library', 'Settings']);
});

test('Recently Added survives Set normalization while legacy Sets remain unmarked', () => {
  const original = setRecord();
  assert.equal(normalizeStampDieSet(original, catalog).recentlyAdded, undefined);
  for (const recentlyAdded of [true, false]) {
    const saved = normalizeStampDieSet({ ...original, recentlyAdded }, catalog);
    assert.equal(normalizeStampDieSet(JSON.parse(JSON.stringify(saved)), catalog).recentlyAdded, recentlyAdded);
  }
  assert.equal('recentlyAdded' in original, false);
});

for (const profile of ['standard', 'compact']) for (const failCommit of [false, true]) {
  test(`${profile} replacement restores taxonomy and product updates atomically, including retained-item tag deletions (failure=${failCommit})`, async t => {
    const { createCatalogBackupSnapshot, createIpadCatalogBackup, restoreCatalogBackup } = await import('./backup.js');
    const h = databaseHarness();
    const previous = globalThis.window;
    t.after(() => { globalThis.window = previous; });
    globalThis.window = { indexedDB: h.indexedDB, location: { search: '' }, localStorage: { getItem: () => 'true' } };
    const storage = await import(`./storage.js?taxonomy-${profile}-${failCommit}`);
    await storage.loadSavedStampDieRecordsForRestore();
    const localCatalog = { ...catalog, tags: [...catalog.tags,
      { id: 'deleted', name: 'Deleted', categoryIds: [] }, { id: 'alias', name: 'Shared', categoryIds: [] }] };
    await storage.saveGlobalTagCatalog(localCatalog);
    const assignments = ['stable-one', 'deleted', 'alias'];
    const localPaper = { id: 'local-paper', name: 'Local Paper', ownerId: 'owner', releaseYear: 2024,
      patternCount: 1, colors: [], tagIds: assignments, favorite: true, recentlyAdded: true,
      patterns: [{ imageSrc: 'data:image/jpeg;base64,YQ==', imagePath: 'original.jpg' }] };
    const localCard = { id: 'local-card', dateCreated: '2025-01-01', size: { width: 4, height: 6 },
      tagIds: assignments, paperPackIds: ['local-paper'], colorIds: [], stampDieSetIds: ['set-one'],
      favorite: true, recentlyAdded: true, imageSrc: 'data:image/jpeg;base64,Yg==' };
    const localSet = { ...setRecord(), tagIds: assignments, favorite: true, recentlyAdded: true };
    h.stores.get('paperPacks').set(localPaper.id, structuredClone(localPaper));
    h.stores.get('cards').set(localCard.id, structuredClone(localCard));
    h.stores.get('stampDieSets').set(localSet.id, structuredClone(localSet));
    const matchingCard = { ...localCard, id: 'matching-card', tagIds: ['stable-one'], imageSrc: undefined };
    h.stores.get('cards').set(matchingCard.id, structuredClone(matchingCard));
    const nextCatalog = { schemaVersion: 1,
      tags: [{ id: 'stable-one', name: 'Renamed', categoryIds: [] }, { id: 'remote', name: 'Shared', categoryIds: ['new-category'] }],
      categories: [{ id: 'new-category', name: 'New Category' }] };
    const importedCard = { ...matchingCard, dateCreated: '2026-09-11', favorite: false, stampDieSetIds: [] };
    const exportInput = { paperPacks: [], colorsById: {}, cards: [importedCard], tagCatalog: nextCatalog };
    const backup = profile === 'standard' ? createCatalogBackupSnapshot(exportInput) : await createIpadCatalogBackup({
      ...exportInput, services: { loadSavedCards: async () => [importedCard], loadSavedStampDieSets: async () => [],
        loadGlobalTagCatalog: async () => nextCatalog, hydrateCardImageSources() {}, hydrateStampImages() {} }
    });
    const before = structuredClone(h.stores);
    const seedPaper = { ...localPaper, id: 'seed-only-paper' };
    const runtime = [structuredClone(localPaper), structuredClone(seedPaper)];
    let refreshes = 0;
    if (failCommit) h.failNextCommit();
    const result = await restoreCatalogBackup({ backup, paperPacks: runtime, colorsById: {}, overwriteExisting: true,
      services: { loadGlobalTagCatalog: storage.loadGlobalTagCatalog,
        loadSavedCardRecordsForRestore: storage.loadSavedCardRecordsForRestore,
        restoreCatalogRecords: storage.restoreCatalogRecords,
        dispatchCardsRestored() { refreshes++; }, dispatchCatalogRestored() { refreshes++; } }
    });
    if (failCommit) {
      assert.equal(result.errors.length, 1);
      assert.deepEqual(h.stores, before);
      assert.deepEqual(runtime, [localPaper, seedPaper]);
      assert.deepEqual(await storage.loadGlobalTagCatalog(), localCatalog);
      assert.equal(refreshes, 0);
      assert.equal(result.notes.some(note => note.includes('Tags and categories replaced')), false);
      return;
    }
    assert.deepEqual(result.errors, []);
    const expectedTags = ['stable-one', 'remote'];
    for (const [store, record] of [['paperPacks', localPaper], ['cards', localCard], ['stampDieSets', localSet]]) {
      assert.deepEqual(h.stores.get(store).get(record.id), { ...record, tagIds: expectedTags }, 'only retained tag assignments may change');
    }
    assert.deepEqual(h.stores.get('paperPacks').get('seed-only-paper').tagIds, expectedTags);
    assert.deepEqual(runtime[1].tagIds, expectedTags);
    assert.deepEqual(runtime[0].tagIds, expectedTags);
    assert.deepEqual(runtime[0].keywords, ['Renamed', 'Shared']);
    assert.deepEqual(runtime[0].patterns, localPaper.patterns);
    assert.equal(h.stores.get('cards').get('matching-card').dateCreated, '2026-09-11');
    assert.equal(h.stores.get('cards').get('matching-card').favorite, false);
    assert.deepEqual(h.stores.get('cards').get('matching-card').tagIds, ['stable-one']);
    assert.deepEqual(await storage.loadGlobalTagCatalog(), backup.tagCatalog);
    const reloaded = await import(`./storage.js?taxonomy-reload-${profile}`);
    assert.deepEqual(await reloaded.loadGlobalTagCatalog(), backup.tagCatalog);
    assert.deepEqual((await reloaded.loadSavedPaperPack('seed-only-paper')).tagIds, expectedTags);
    assert.deepEqual((await reloaded.loadSavedStampDieRecordsForRestore())[0].tagIds, expectedTags);
    assert.ok(result.notes.some(note => note.includes('Removed 1 local tags and 1 local categories')));
    assert.equal(result.cardsImported, 1);
    assert.equal(result.packsImported, 0);
    assert.equal(result.setsImported, 0);
    assert.equal(refreshes, 2);
    for (const store of ['owners', 'colors', 'deletedPaperPackIds']) assert.deepEqual(h.stores.get(store), before.get(store));
  });
}
