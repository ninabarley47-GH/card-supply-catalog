import test from 'node:test';
import assert from 'node:assert/strict';
import { saveCatalogBackupExport } from './backup.js';
import { renderSetupStatus } from './settings.js';

// Exercise the real settings storage API across a structured-clone boundary,
// rather than passing hand-built metadata directly to the renderer.
function settingsDatabase() {
  const records = new Map();
  const request = result => {
    const target = new EventTarget();
    target.result = structuredClone(result);
    queueMicrotask(() => target.dispatchEvent(new Event('success')));
    return target;
  };
  const database = {
    transaction(name, mode) {
      assert.deepEqual(Array.isArray(name) ? name : [name], ['settings']);
      const transaction = new EventTarget();
      transaction.objectStore = () => ({
        get: id => request(records.get(id)),
        put: record => records.set(record.id, structuredClone(record))
      });
      if (mode === 'readwrite') queueMicrotask(() => transaction.dispatchEvent(new Event('complete')));
      return transaction;
    }
  };
  return { records, indexedDB: { open() {
    const target = new EventTarget(); target.result = database;
    queueMicrotask(() => target.dispatchEvent(new Event('success')));
    return target;
  } } };
}
class Element {
  children = []; dataset = {}; textContent = '';
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}
function exportFolder(name) {
  return { name, getFileHandle: async (_name, options) => {
    if (!options?.create) throw new DOMException('Not found', 'NotFoundError');
    return { createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
  } };
}

test('catalog export destination round-trips through actual storage functions into Setup Status', async t => {
  const original = { window: globalThis.window, document: globalThis.document };
  t.after(() => Object.assign(globalThis, original));
  const database = settingsDatabase();
  globalThis.window = { indexedDB: database.indexedDB, localStorage: { getItem: () => 'true' }, showDirectoryPicker() {} };
  globalThis.document = { createElement: () => new Element() };
  const { saveCatalogSetting, loadCatalogSetting } = await import('./storage.js?backup-destination-integration');
  const services = { saveCatalogSetting, loadCatalogSetting,
    loadSavedCards: async () => [], loadSavedStampDieSets: async () => [], download: async () => {} };
  const backup = { exportedAt: '2026-09-10T20:37:00.000Z' };
  const renderBackup = async () => {
    const container = new Element();
    await renderSetupStatus(container, [], services);
    return container.children[1].children[0].children.map(node => node.textContent);
  };

  for (const label of ['backup', 'ipad-backup']) {
    await t.test(`${label} folder success persists and renders the actual folder name`, async () => {
      await saveCatalogBackupExport(backup, label, exportFolder('All App Backup Files'), services);
      assert.deepEqual(await loadCatalogSetting('lastBackupExportedAt'), {
        exportedAt: backup.exportedAt, destination: { type: 'folder', folderName: 'All App Backup Files' }
      });
      const lines = await renderBackup();
      assert.match(lines[1], /^Last export: /);
      assert.equal(lines[2], 'Saved to: All App Backup Files');
    });
  }
  await t.test('changing the current Export Library does not change persisted export history', async () => {
    const before = await renderBackup();
    await saveCatalogSetting('exportLibrary', { directoryHandle: { name: 'Different Folder' } });
    assert.deepEqual(await renderBackup(), before);
    await saveCatalogSetting('exportLibrary', null);
    assert.deepEqual(await renderBackup(), before);
  });
  for (const name of ['Error', 'AbortError']) {
    await t.test(`${name} preserves the previous stored timestamp and destination`, async () => {
      const before = await loadCatalogSetting('lastBackupExportedAt');
      await assert.rejects(saveCatalogBackupExport({ exportedAt: '2026-09-11T00:00:00Z' }, 'backup', null, {
        ...services, download: async () => { throw new DOMException('Download did not start', name); }
      }), { name });
      assert.deepEqual(await loadCatalogSetting('lastBackupExportedAt'), before);
      assert.equal((await renderBackup())[2], 'Saved to: All App Backup Files');
    });
  }
  await t.test('browser download persists and renders its destination type', async () => {
    await saveCatalogBackupExport(backup, 'backup', null, services);
    assert.equal((await loadCatalogSetting('lastBackupExportedAt')).destination.type, 'browser-download');
    assert.equal((await renderBackup())[2], 'Saved via browser download');
  });
  await t.test('legacy timestamp-only metadata renders without guessing a folder', async () => {
    await saveCatalogSetting('lastBackupExportedAt', backup.exportedAt);
    const lines = await renderBackup();
    assert.equal(lines.length, 2);
    assert.match(lines[1], /^Last export: /);
  });
});
