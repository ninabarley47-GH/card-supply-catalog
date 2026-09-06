import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeStampImageLibrarySettings, checkAllImageLibraries } from './settings.js';
import { chooseStampImageDirectory, loadStampImageDirectory, checkStampImageLibraryHealth,
  hydrateStampImages, STAMP_IMAGE_LIBRARY_SETTING_ID } from './stamp-die-images.js';

class Element {
  dataset = {}; children = []; listeners = {}; disabled = false; textContent = '';
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  async click() { if (!this.disabled) await this.listeners.click?.(); }
}
function setup(t, initial = new Map()) {
  const previous = globalThis.document;
  t.after(() => { globalThis.document = previous; });
  const nodes = new Map(['choose-stamp-image-library', 'reconnect-stamp-image-library',
    'stamp-image-library-status', 'stamp-image-library-health'].map((id) => [`[data-${id}]`, new Element()]));
  const events = [];
  globalThis.document = {
    querySelector: (selector) => nodes.get(selector) || null,
    createElement: () => new Element(), dispatchEvent: (event) => events.push(event.type)
  };
  const services = { environment: { showDirectoryPicker: async () => directory('Stamps') },
    loadCatalogSetting: async (id) => initial.get(id), saveCatalogSetting: async (id, value) => initial.set(id, value) };
  return { services, settings: initial, events,
    choose: nodes.get('[data-choose-stamp-image-library]'), reconnect: nodes.get('[data-reconnect-stamp-image-library]'),
    status: nodes.get('[data-stamp-image-library-status]') };
}
function directory(name, permission = 'granted') {
  return { name, queryPermission: async () => permission,
    requestPermission: async () => permission,
    getFileHandle: async (path, options) => {
      assert.equal(options, undefined, 'health reads must never create files');
      if (path === 'missing.jpg') throw new DOMException('Missing', 'NotFoundError');
      return { getFile: async () => new Blob(['image']) };
    },
    removeEntry: () => assert.fail('must never delete'),
    entries: () => assert.fail('must never scan'),
    createWritable: () => assert.fail('must never write') };
}
const folderRef = (imagePath = 'stamp.jpg') => ({ imageLibrary: 'stamp-die-images', imagePath });

test('Settings renders matching choose/reconnect controls and live status for all three libraries', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const prefix of ['', 'card-', 'stamp-']) {
    for (const action of ['choose', 'reconnect']) {
      assert.match(html, new RegExp(`<button class="button" type="button" data-${action}-${prefix}image-library>`));
    }
    assert.match(html, new RegExp(`data-${prefix}image-library-status aria-live="polite"`));
  }
  assert.match(html, /Choose Image Folder for Stamps &amp; Dies/);
});

test('select, reload, and reconnect persist the Stamp handle independently without touching Paper/Card settings', async (t) => {
  const paper = { directoryHandle: directory('Unrelated Paper') };
  const card = { directoryHandle: directory('Different Cards') };
  const h = setup(t, new Map([['imageLibrary', paper], ['cardImageLibrary', card]]));
  let selected = directory('Stamp root');
  h.services.environment.showDirectoryPicker = async (options) => {
    assert.deepEqual(options, { id: 'csc-stamp-images', mode: 'readwrite' }); return selected;
  };
  await initializeStampImageLibrarySettings({}, h.services);
  assert.match(h.status.textContent, /No Stamp & Die image folder selected/);
  await h.choose.click();
  const saved = h.settings.get(STAMP_IMAGE_LIBRARY_SETTING_ID);
  assert.equal(saved.directoryHandle, selected);
  assert.equal(saved.strategy, 'local-folder');
  assert.ok(Number.isFinite(Date.parse(saved.selectedAt)));
  assert.equal(await loadStampImageDirectory('read', false, h.services), selected);
  await initializeStampImageLibrarySettings({}, h.services);
  assert.match(h.status.textContent, /folder ready: Stamp root/);
  selected = directory('Another root');
  await h.reconnect.click();
  assert.equal(h.settings.get(STAMP_IMAGE_LIBRARY_SETTING_ID).directoryHandle, selected);
  assert.equal(h.settings.get('imageLibrary'), paper);
  assert.equal(h.settings.get('cardImageLibrary'), card);
  assert.deepEqual(h.events, ['catalog:stamp-image-library-selected', 'catalog:stamp-image-library-selected']);
});

test('unsupported Settings disables folder controls and retains established IndexedDB messaging', async (t) => {
  const h = setup(t); h.services.environment = {};
  h.services.loadCatalogSetting = () => assert.fail('unsupported folder controls must not access storage');
  await initializeStampImageLibrarySettings({}, h.services);
  assert.equal(h.choose.disabled, true); assert.equal(h.reconnect.disabled, true);
  assert.match(h.status.textContent, /not supported.*IndexedDB will remain the fallback/);
  assert.equal(await chooseStampImageDirectory({}, h.services), null);
  assert.equal(h.settings.size, 0);
});

for (const permission of ['denied', 'prompt']) {
  test(`saved ${permission} permission reports reconnect and passive loading never requests access`, async (t) => {
    const handle = directory('Saved', permission);
    handle.requestPermission = () => assert.fail('passive loads cannot prompt');
    const h = setup(t, new Map([[STAMP_IMAGE_LIBRARY_SETTING_ID, { directoryHandle: handle }]]));
    await initializeStampImageLibrarySettings({}, h.services);
    assert.match(h.status.textContent, /Saved.*Reconnect may be needed/);
    assert.equal(await loadStampImageDirectory('read', false, h.services), null);
  });
}

test('cancel and failed persistence keep the prior setting and do not notify image refresh', async (t) => {
  const prior = { directoryHandle: directory('Prior') };
  const h = setup(t, new Map([[STAMP_IMAGE_LIBRARY_SETTING_ID, prior]]));
  await initializeStampImageLibrarySettings({}, h.services);
  h.services.environment.showDirectoryPicker = async () => { throw new DOMException('Cancelled', 'AbortError'); };
  await h.choose.click(); assert.match(h.status.textContent, /cancelled/);
  h.services.environment.showDirectoryPicker = async () => directory('New');
  h.services.saveCatalogSetting = async () => { throw new Error('IndexedDB unavailable'); };
  await h.choose.click(); assert.equal(h.status.dataset.tone, 'error');
  assert.equal(h.settings.get(STAMP_IMAGE_LIBRARY_SETTING_ID), prior); assert.deepEqual(h.events, []);
});

test('unavailable settings storage reports fallback and leaves folder selection available', async (t) => {
  const h = setup(t); h.services.loadCatalogSetting = async () => { throw new Error('IndexedDB unavailable'); };
  await initializeStampImageLibrarySettings({}, h.services);
  assert.match(h.status.textContent, /could not be loaded.*fallback browser storage/);
  assert.equal(h.choose.disabled, false);
});

test('Stamp health checks only its references, reports missing files and embedded images, and never mutates records or files', async () => {
  const records = [{ name: 'Set', imageRefs: [folderRef(), folderRef('missing.jpg'),
    { imageSrc: 'data:image/jpeg;base64,YQ==' }, { imagePath: 'legacy-paper.jpg' }] }];
  const before = structuredClone(records);
  const result = await checkStampImageLibraryHealth(records, { loadDirectory: async () => directory('Stamps') });
  assert.deepEqual(result.summary, { folderName: 'Stamps', setsChecked: 1, folderImages: 2,
    imagesFound: 1, imagesMissing: 1, embeddedImages: 1, missingImages: [{ setLabel: 'Set', imagePath: 'missing.jpg' }] });
  assert.equal(result.needsFolder, false);
  assert.deepEqual(records, before);
});

for (const permission of ['denied', 'prompt', 'unavailable']) {
  test(`Stamp health handles ${permission} folder permissions`, async () => {
    const handle = directory('Stamps', permission);
    if (permission === 'unavailable') handle.queryPermission = async () => { throw new Error('Disconnected'); };
    const services = { loadCatalogSetting: async () => ({ directoryHandle: handle }) };
    const result = await checkStampImageLibraryHealth([{ imageRefs: [folderRef()] }], {
      loadDirectory: (mode, request) => loadStampImageDirectory(mode, request, services)
    });
    assert.equal(result.needsFolder, true); assert.equal(result.summary.imagesMissing, 1);
  });
}

test('empty configured Stamp library reports a folder without importing or creating Sets', async () => {
  const result = await checkStampImageLibraryHealth([], { loadDirectory: async () => directory('Empty') });
  assert.equal(result.ok, true); assert.equal(result.summary.setsChecked, 0);
  assert.equal(result.summary.folderName, 'Empty'); assert.equal(result.summary.folderImages, 0);
});

for (const failed of ['paper', 'card-load', 'stamp']) {
  test(`Check Image Libraries isolates ${failed} failure and renders the other results`, async (t) => {
    setup(t);
    const controls = Object.fromEntries(['button', 'paperStatus', 'paperHealth', 'cardStatus', 'cardHealth', 'stampStatus', 'stampHealth'].map((key) => [key, new Element()]));
    const calls = [];
    const result = { summary: { packsChecked: 1, cardsChecked: 1, setsChecked: 1,
      folderImages: 1, imagesFound: 1, imagesMissing: 0, embeddedImages: 0, missingImages: [] } };
    const check = (kind) => { calls.push(kind); if (failed === kind) throw new Error('Disconnected'); return result; };
    await checkAllImageLibraries({ ...controls, paperPacks: [] }, {
      checkImageLibraryHealth: () => check('paper'),
      loadSavedCards: async () => { if (failed === 'card-load') throw new Error('Storage error'); return []; },
      checkCardImageLibraryHealth: () => check('card'),
      loadSavedStampDieSets: async () => [], checkStampImageLibraryHealth: () => check('stamp')
    });
    assert.equal(controls.button.disabled, false);
    for (const kind of ['paper', 'card', 'stamp']) {
      const isFailure = failed.startsWith(kind);
      assert.match(controls[`${kind}Status`].textContent, isFailure ? /could not be checked/ : /No missing folder images/);
      assert.equal(controls[`${kind}Status`].dataset.tone, isFailure ? 'error' : 'success');
      if (!isFailure) assert.ok(calls.includes(kind));
    }
  });
}

test('selecting a Stamp root lets existing folder refs hydrate while embedded refs stay intact, without record writes', async (t) => {
  const h = setup(t);
  const records = [{ imageRefs: [folderRef(), { imageSrc: 'data:image/jpeg;base64,YQ==' }] }];
  const before = structuredClone(records);
  await chooseStampImageDirectory(h.services.environment, h.services);
  const hydrated = [];
  await hydrateStampImages(records, {
    loadDirectory: (mode) => loadStampImageDirectory(mode, false, h.services),
    hydrate: async (ref, root) => { hydrated.push([ref.imagePath, root.name]); }
  });
  assert.deepEqual(hydrated, [['stamp.jpg', 'Stamps']]);
  assert.deepEqual(records, before);
});
