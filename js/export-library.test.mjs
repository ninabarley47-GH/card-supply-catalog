import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chooseExportDirectory, loadWritableExportDirectory, saveExportFile, createExportFileName } from './export-library.js';
import { initializeExportLibrarySettings } from './settings.js';
import { createCatalogBackup, saveJsonBackup, downloadImportDiagnosticReport } from './backup.js';
import { chooseCoverSheetDestination, saveCoverSheet } from './cover-sheet.js';

const clock = { loadCatalogSetting: async () => null, now: () => new Date('2026-09-07T12:34:56.789Z') };
function folder(initial = {}, failure = '') {
  const files = new Map(Object.entries(initial));
  const writes = [];
  return { files, writes, name: 'Exports', queryPermission: async () => 'granted',
    getFileHandle: async (name, options) => {
      if (failure === 'lookup') throw new DOMException('Denied', 'NotAllowedError');
      if (!files.has(name)) {
        if (!options?.create) throw new DOMException('Missing', 'NotFoundError');
        files.set(name, '');
      }
      return { createWritable: async () => {
        if (failure === 'open') throw new Error('Disconnected');
        assert.equal(files.get(name), '', 'existing files must not be overwritten');
        writes.push(name);
        return { write: async (blob) => {
          if (failure === 'write') throw new Error('Disk full');
          files.set(name, await blob.text());
        }, close: async () => { if (failure === 'close') throw new Error('Close failed'); } };
      } };
    },
    removeEntry: () => assert.fail('no cleanup'),
    getDirectoryHandle: () => assert.fail('no subfolder creation'),
    entries: () => assert.fail('no directory scan') };
}
class Element {
  dataset = {}; disabled = false; listeners = {}; textContent = '';
  addEventListener(type, handler) { this.listeners[type] = handler; }
  async click() { if (!this.disabled) await this.listeners.click?.(); }
}
function settingsHarness(t, environment) {
  const previous = globalThis.document;
  t.after(() => { globalThis.document = previous; });
  const choose = new Element(), reconnect = new Element(), status = new Element();
  const elements = { '[data-choose-export-library]': choose, '[data-reconnect-export-library]': reconnect, '[data-export-library-status]': status };
  globalThis.document = { querySelector: (selector) => elements[selector] || null };
  const settings = new Map(['imageLibrary', 'cardImageLibrary', 'stampDieImageLibrary'].map((id) => [id, { marker: id }]));
  return { choose, reconnect, status, settings, services: { environment,
    loadCatalogSetting: async (id) => settings.get(id), saveCatalogSetting: async (id, value) => settings.set(id, value) } };
}

test('Settings chooses, persists, reloads and reconnects an independent Export Library', async (t) => {
  let directory = folder();
  const h = settingsHarness(t, { showDirectoryPicker: async (options) => {
    assert.deepEqual(options, { id: 'csc-export-library', mode: 'readwrite' }); return directory;
  } });
  const before = [...h.settings];
  await initializeExportLibrarySettings(h.services);
  assert.match(h.status.textContent, /No Export Library.*normal browser download/);
  await h.choose.click();
  const saved = h.settings.get('exportLibrary');
  assert.equal(saved.directoryHandle, directory); assert.equal(saved.strategy, 'local-folder');
  assert.ok(Number.isFinite(Date.parse(saved.selectedAt)));
  await initializeExportLibrarySettings(h.services);
  assert.match(h.status.textContent, /Export folder ready: Exports/);
  directory = { ...folder(), name: 'Other exports' };
  await h.reconnect.click();
  assert.equal(h.settings.get('exportLibrary').directoryHandle, directory);
  assert.deepEqual([...h.settings].filter(([id]) => id !== 'exportLibrary'), before);
});

test('unsupported Settings disables only folder controls and explains download fallback', async (t) => {
  const h = settingsHarness(t, {});
  await initializeExportLibrarySettings(h.services);
  assert.equal(h.choose.disabled, true); assert.equal(h.reconnect.disabled, true);
  assert.match(h.status.textContent, /not supported.*normal browser download/);
  assert.equal(await chooseExportDirectory({}, h.services), null);
  assert.equal(h.settings.has('exportLibrary'), false);
});

test('cancel and failed settings writes retain the previous Export Library', async (t) => {
  const h = settingsHarness(t, { showDirectoryPicker: async () => { throw new DOMException('Cancelled', 'AbortError'); } });
  const prior = { directoryHandle: folder() }; h.settings.set('exportLibrary', prior);
  await initializeExportLibrarySettings(h.services); await h.choose.click();
  assert.match(h.status.textContent, /cancelled/); assert.equal(h.settings.get('exportLibrary'), prior);
  h.services.environment.showDirectoryPicker = async () => folder();
  h.services.saveCatalogSetting = async () => { throw new Error('Storage unavailable'); };
  await h.reconnect.click(); assert.equal(h.status.dataset.tone, 'error'); assert.equal(h.settings.get('exportLibrary'), prior);
});

for (const state of ['unconfigured', 'unsupported', 'denied', 'storage-error', 'permission-error', 'missing-permission-api']) {
  test(`${state} Export Library falls back to downloading the generated backup`, async () => {
    const environment = state === 'unsupported' ? {} : { showDirectoryPicker() {} };
    const handle = folder();
    if (state === 'denied') handle.queryPermission = async () => 'denied';
    if (state === 'permission-error') handle.queryPermission = async () => { throw new Error('Revoked'); };
    if (state === 'missing-permission-api') delete handle.queryPermission;
    const directoryHandle = await loadWritableExportDirectory(environment, { loadCatalogSetting: async (id) => {
      assert.equal(id, 'exportLibrary'); if (state === 'storage-error') throw new Error('No storage');
      return state === 'unconfigured' ? null : { directoryHandle: handle };
    } });
    assert.equal(directoryHandle, null);
    let downloaded;
    const result = await saveJsonBackup({ catalog: 'data' }, 'backup', directoryHandle, { ...clock,
      download: async (blob) => { downloaded = JSON.parse(await blob.text()); } });
    assert.equal(result.savedToFolder, false); assert.deepEqual(downloaded, { catalog: 'data' });
    assert.equal(handle.writes.length, 0);
  });
}

test('permission can be regranted on export using the existing permission helper', async () => {
  const handle = folder(); handle.queryPermission = async () => 'prompt';
  handle.requestPermission = async (options) => { assert.deepEqual(options, { mode: 'readwrite' }); return 'granted'; };
  assert.equal(await loadWritableExportDirectory({ showDirectoryPicker() {} }, {
    loadCatalogSetting: async () => ({ directoryHandle: handle })
  }), handle);
});

test('writable folder receives a complete timestamped backup without changing unrelated files', async () => {
  const directory = folder({ 'unrelated.txt': 'keep me' });
  const result = await saveJsonBackup({ test: true }, 'backup', directory, { ...clock, download: () => assert.fail('should save directly') });
  assert.equal(result.savedToFolder, true); assert.equal(result.folderName, 'Exports');
  assert.equal(result.fileName, 'CSC-backup-2026-09-07T12-34-56Z.json');
  assert.deepEqual(JSON.parse(directory.files.get(result.fileName)), { test: true });
  assert.equal(directory.files.get('unrelated.txt'), 'keep me'); assert.equal(directory.files.size, 2);
});

test('repeated filenames preserve both occupied and empty existing exports with numbered suffixes', async () => {
  const name = createExportFileName('backup', 'json', clock);
  const second = name.replace('.json', '-2.json');
  const directory = folder({ [name]: 'original', [second]: '' });
  const result = await saveJsonBackup({ newer: true }, 'backup', directory, { ...clock, download: () => assert.fail('no fallback') });
  assert.equal(result.fileName, name.replace('.json', '-3.json'));
  assert.equal(directory.files.get(name), 'original'); assert.equal(directory.files.get(second), '');
  assert.deepEqual(directory.writes, [result.fileName]);
});

for (const failure of ['lookup', 'open', 'write', 'close']) {
  test(`${failure} failure downloads the original Blob without destructive cleanup`, async () => {
    const directory = folder({ 'unrelated.txt': 'preserved' }, failure);
    const original = new Blob(['complete export']); let fallback;
    const result = await saveExportFile(original, { directoryHandle: directory }, { ...clock,
      download: (blob) => { fallback = blob; } });
    assert.equal(result.savedToFolder, false); assert.equal(fallback, original);
    assert.equal(directory.files.get('unrelated.txt'), 'preserved');
  });
}

test('concurrent exports in the same second get short collision suffixes without overwriting', async () => {
  const directory = folder();
  const results = await Promise.all([1, 2].map((number) => saveExportFile(new Blob([String(number)]),
    { directoryHandle: directory }, { ...clock, download: () => assert.fail('should save') })));
  assert.equal(results[0].fileName, 'CSC-backup-2026-09-07T12-34-56Z.json');
  assert.equal(results[1].fileName, 'CSC-backup-2026-09-07T12-34-56Z-2.json');
  assert.equal(directory.files.get(results[0].fileName), '1');
  assert.equal(directory.files.get(results[1].fileName), '2');
});

test('backup contents never load or serialize the Export Library setting', async () => {
  const loaded = [];
  const backup = await createCatalogBackup({ paperPacks: [], colorsById: {}, services: {
    loadCatalogSetting: async (id) => { loaded.push(id); assert.notEqual(id, 'exportLibrary'); return null; },
    loadSavedCards: async () => [], loadSavedStampDieSets: async () => [],
    loadGlobalTagCatalog: async () => ({ schemaVersion: 1, tags: [], categories: [] })
  } });
  assert.deepEqual(loaded, ['imageLibrary', 'cardImageLibrary', 'stampDieImageLibrary']);
  assert.doesNotMatch(JSON.stringify(backup), /exportLibrary|directoryHandle/);
});

test('diagnostic export retains full report contents rather than the summarized shareable report', async () => {
  const report = { diagnosticMode: 'read-only-streaming-scan', images: Array.from({ length: 20 }, (_, imageIndex) => ({ imageIndex })) };
  let saved;
  await downloadImportDiagnosticReport(report, { ...clock, loadWritableExportDirectory: async () => null,
    download: async (blob) => { saved = JSON.parse(await blob.text()); } });
  assert.deepEqual(saved, report);
});

test('cover sheets use Export Library directly without opening Save As', async () => {
  const root = folder();
  const destination = await chooseCoverSheetDestination({ name: 'Paper' }, { showSaveFilePicker: () => assert.fail('no picker') }, {
    loadWritableExportDirectory: async () => root
  });
  const result = await saveCoverSheet(new Blob(['png']), { name: 'Paper' }, destination, clock);
  assert.equal(result.savedToFolder, true); assert.match(result.fileName, /paper-cover-sheet-.*\.png$/);
});

test('cover sheet Save As, cancellation and file-input-free download fallback remain available', async () => {
  const noFolder = { loadWritableExportDirectory: async () => null };
  const handle = {};
  const destination = await chooseCoverSheetDestination({ name: 'Paper' }, {
    showSaveFilePicker: async (options) => { assert.equal(options.suggestedName, 'paper-cover-sheet.png'); return handle; }
  }, noFolder);
  assert.equal(destination.fileHandle, handle);
  assert.equal(await chooseCoverSheetDestination({ name: 'Paper' }, {
    showSaveFilePicker: async () => { throw new DOMException('Cancel', 'AbortError'); }
  }, noFolder), false);
  const fallback = await chooseCoverSheetDestination({ name: 'Paper' }, {}, noFolder);
  let downloaded = false;
  await saveCoverSheet(new Blob(['png']), { name: 'Paper' }, fallback, { download: () => { downloaded = true; } });
  assert.equal(downloaded, true);
});

test('Export Library is in the offline shell and outside Check Image Libraries', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const settings = await readFile(new URL('./settings.js', import.meta.url), 'utf8');
  const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(html, /Export Library Folder/); assert.match(sw, /"\.\/js\/export-library\.js"/);
  const checks = settings.slice(settings.indexOf('export async function checkAllImageLibraries'), settings.indexOf('function formatHealthStatus'));
  assert.doesNotMatch(checks, /exportLibrary|Export Library|loadWritableExportDirectory/);
});

test('export prefixes the configured default Owner name, not another catalog Owner', async () => {
  let downloaded;
  const result = await saveExportFile(new Blob(['backup']), {}, { ...clock,
    loadCatalogSetting: async (id) => { assert.equal(id, 'defaultOwnerId'); return 'owner-nina'; },
    loadOwners: async () => [{ id: 'other', name: 'Amanda' }, { id: 'owner-nina', name: 'Nina Barley' }],
    download: (_blob, name) => { downloaded = name; }
  });
  assert.equal(downloaded, 'Nina-Barley-CSC-backup-2026-09-07T12-34-56Z.json');
  assert.equal(result.fileName, downloaded);
});

test('Owner prefix is filename-safe and a missing/stale Default Owner still permits export', async () => {
  const name = createExportFileName('backup', 'json', { ...clock, ownerName: ' Nina / Amanda: ' });
  assert.match(name, /^Nina---Amanda-CSC-backup-/);
  for (const loadCatalogSetting of [async () => null, async () => 'missing', async () => { throw new Error('Unavailable'); }]) {
    const result = await saveExportFile(new Blob(['backup']), {}, { ...clock, loadCatalogSetting,
      loadOwners: async () => [], download: () => {} });
    assert.match(result.fileName, /^CSC-backup-/);
  }
});
