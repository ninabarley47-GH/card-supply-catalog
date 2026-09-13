import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseCoverSheetDirectory, loadWritableCoverSheetDirectory } from './cover-sheet-folder.js';
import { initializeCoverSheetFolderSettings } from './settings.js';
import { chooseCoverSheetDestination } from './cover-sheet.js';
import { createCatalogBackup } from './backup.js';

function harness(t, environment) {
  const previous = globalThis.document;
  t.after(() => { globalThis.document = previous; });
  const element = () => ({ dataset: {}, addEventListener(type, handler) { this[type] = handler; } });
  const choose = element(), reconnect = element(), status = element();
  globalThis.document = { querySelector: selector => ({
    '[data-choose-cover-sheet-folder]': choose,
    '[data-reconnect-cover-sheet-folder]': reconnect,
    '[data-cover-sheet-folder-status]': status
  })[selector] };
  const settings = new Map([['exportLibrary', { directoryHandle: { name: 'Backups' } }]]);
  const services = { environment, loadCatalogSetting: async id => settings.get(id),
    saveCatalogSetting: async (id, value) => settings.set(id, value) };
  return { choose, reconnect, status, settings, services };
}

test('cover sheet folder can be selected, remembered and reconnected independently of backups', async t => {
  let folder = { name: 'All Cover Sheets', queryPermission: async () => 'granted' };
  const h = harness(t, { showDirectoryPicker: async options => {
    assert.deepEqual(options, { id: 'csc-cover-sheets', mode: 'readwrite' });
    return folder;
  } });
  const backup = h.settings.get('exportLibrary');
  await initializeCoverSheetFolderSettings(h.services);
  assert.match(h.status.textContent, /No Cover Sheet Folder.*Save As/);
  await h.choose.click();
  assert.equal(h.settings.get('coverSheetFolder').directoryHandle, folder);
  await initializeCoverSheetFolderSettings(h.services);
  assert.match(h.status.textContent, /All Cover Sheets/);
  folder = { ...folder, name: 'Other Cover Sheets' };
  await h.reconnect.click();
  assert.equal(h.settings.get('coverSheetFolder').directoryHandle, folder);
  assert.equal(h.settings.get('exportLibrary'), backup);
  assert.equal(await loadWritableCoverSheetDirectory(h.services.environment, h.services), folder);
});

test('cancelled selection retains the saved cover sheet folder', async t => {
  const h = harness(t, { showDirectoryPicker: async () => { throw new DOMException('Cancelled', 'AbortError'); } });
  const prior = { directoryHandle: { name: 'Original', queryPermission: async () => 'granted' } };
  h.settings.set('coverSheetFolder', prior);
  await initializeCoverSheetFolderSettings(h.services);
  await h.choose.click();
  assert.equal(h.settings.get('coverSheetFolder'), prior);
  assert.match(h.status.textContent, /cancelled/);
});

test('unsupported browsers disable folder controls and explain Save As/download fallback', async t => {
  const h = harness(t, {});
  await initializeCoverSheetFolderSettings(h.services);
  assert.equal(h.choose.disabled, true);
  assert.equal(h.reconnect.disabled, true);
  assert.match(h.status.textContent, /not supported.*browser download/);
  assert.equal(await chooseCoverSheetDirectory({}, h.services), null);
});

for (const permission of ['granted', 'prompt', 'denied']) {
  test('cover sheet destination respects its own folder permission: ' + permission, async () => {
    const folder = { name: 'Covers', queryPermission: async () => permission,
      requestPermission: async () => permission === 'prompt' ? 'granted' : 'denied' };
    let pickerCalls = 0;
    const result = await chooseCoverSheetDestination({ name: 'Glow of Harvest' }, {
      showDirectoryPicker() {},
      showSaveFilePicker: async () => { pickerCalls++; return { name: 'chosen.png' }; }
    }, { loadCatalogSetting: async id => { assert.equal(id, 'coverSheetFolder'); return { directoryHandle: folder }; } });
    assert.equal(pickerCalls, permission === 'denied' ? 1 : 0);
    if (permission !== 'denied') assert.equal(result.directoryHandle, folder);
  });
}

test('a configured backup folder is never used when the cover sheet folder is unset', async () => {
  let pickerCalls = 0;
  const result = await chooseCoverSheetDestination({ name: 'Paper' }, {
    showDirectoryPicker() {},
    showSaveFilePicker: async () => { pickerCalls++; return { name: 'paper.png' }; }
  }, { loadCatalogSetting: async id => {
    assert.equal(id, 'coverSheetFolder');
    return null;
  } });
  assert.equal(pickerCalls, 1);
  assert.equal(result.fileHandle.name, 'paper.png');
});

test('folder setting load failure falls back to Save As', async () => {
  const result = await chooseCoverSheetDestination({ name: 'Paper' }, {
    showDirectoryPicker() {}, showSaveFilePicker: async () => ({ name: 'fallback.png' })
  }, { loadCatalogSetting: async () => { throw new Error('Storage unavailable'); } });
  assert.equal(result.fileHandle.name, 'fallback.png');
});

test('cover sheet folder is excluded from catalog backups', async () => {
  const backup = await createCatalogBackup({ paperPacks: [], colorsById: {}, services: {
    loadCatalogSetting: async id => { assert.notEqual(id, 'coverSheetFolder'); return null; },
    loadSavedCards: async () => [], loadSavedStampDieSets: async () => [],
    loadGlobalTagCatalog: async () => ({ schemaVersion: 1, tags: [], categories: [] })
  } });
  assert.doesNotMatch(JSON.stringify(backup), /coverSheetFolder|directoryHandle/);
});
