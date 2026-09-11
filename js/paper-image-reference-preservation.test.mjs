import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaperPackFromForm } from './add-dsp.js';
import { createEmptyGlobalTagCatalog } from './global-tag-catalog.js';
import { getImageEntriesFromPatterns, hydratePaperPackImageSources, preparePaperPackImagesForSave,
  getPatternImageSource, clearPaperPackImageObjectUrls } from './images.js';
import { savePaperPack } from './storage.js';

// Exercise real storage normalization across a structured-clone boundary. The
// directory handle is supplied separately because native handles are cloneable,
// while this test's object containing mock methods is not.
function databaseHarness(directoryHandle, catalog) {
  const stores = new Map(['paperPacks', 'deletedPaperPackIds', 'cards', 'settings'].map(name => [name, new Map()]));
  stores.get('settings').set('globalTagCatalog', { id: 'globalTagCatalog', value: catalog });
  stores.get('settings').set('globalTagMigrationVersion', { id: 'globalTagMigrationVersion', value: 1 });
  const request = result => {
    const target = new EventTarget();
    target.result = result;
    queueMicrotask(() => target.dispatchEvent(new Event('success')));
    return target;
  };
  const database = {
    transaction(names, mode) {
      const transaction = new EventTarget();
      transaction.objectStore = name => ({
        get: id => request(name === 'settings' && id === 'imageLibrary'
          ? { id, value: { directoryHandle } } : structuredClone(stores.get(name).get(id))),
        getAll: () => request(structuredClone([...stores.get(name).values()])),
        put: record => stores.get(name).set(record.id, structuredClone(record)),
        delete: id => stores.get(name).delete(id)
      });
      if (mode === 'readwrite') setTimeout(() => transaction.dispatchEvent(new Event('complete')));
      return transaction;
    }
  };
  return { stores, indexedDB: { open: () => request(database) } };
}

test('metadata-only Paper edits preserve hydrated folder images through save and reload', async t => {
  const catalog = createEmptyGlobalTagCatalog();
  const original = new Blob(['original image bytes'], { type: 'image/jpeg' });
  const reads = [];
  const permissions = [];
  let writeState;
  const directory = {
    queryPermission: async ({ mode }) => {
      permissions.push(mode);
      if (mode === 'read') return 'granted';
      if (writeState === 'unavailable') throw new Error('Write permission unavailable');
      return writeState;
    },
    requestPermission: async ({ mode }) => {
      assert.equal(mode, 'readwrite');
      return 'denied';
    },
    getDirectoryHandle: async (name, options) => {
      assert.equal(name, 'Pack');
      assert.ok(!options?.create, 'must not create image folders');
      return directory;
    },
    getFileHandle: async (name, options) => {
      assert.ok(!options?.create, 'must not create or rewrite image files');
      assert.ok(['original.jpg', 'original.thumb.jpg'].includes(name));
      return { getFile: async () => {
        reads.push(name);
        return name === 'original.jpg' ? original : new Blob(['thumbnail']);
      } };
    }
  };
  const harness = databaseHarness(directory, catalog);
  const previousWindow = globalThis.window;
  globalThis.window = { indexedDB: harness.indexedDB, localStorage: { getItem: () => 'true' } };
  t.after(() => { globalThis.window = previousWindow; });

  for (const state of ['denied', 'unavailable', 'granted']) await t.test(state, async () => {
    writeState = state;
    reads.length = permissions.length = 0;
    const pack = {
      id: `pack-${state}`, name: 'Pack', ownerId: 'owner-nina', releaseYear: 2026,
      patternCount: 1, colors: ['red'], tagIds: [],
      patterns: [{ id: 'pattern-1', imageName: 'original.jpg', imagePath: 'Pack/original.jpg', imageStorageStrategy: 'local-folder' }]
    };
    let reloaded;
    try {
      await hydratePaperPackImageSources([pack]);
      assert.match(getPatternImageSource(pack.patterns[0]), /^blob:/);
      assert.ok(permissions.includes('read'));
      const form = new FormData();
      for (const [key, value] of Object.entries({ name: 'Edited Pack', ownerId: 'owner-nina',
        releaseYear: '2026', patternCount: '1', colors: 'red', availability: 'available', refillAvailable: '' })) form.set(key, value);
      const edit = buildPaperPackFromForm(form, { red: { id: 'red', name: 'Red' } },
        getImageEntriesFromPatterns(pack.patterns), pack, [], [{ id: 'owner-nina', name: 'Nina' }], catalog);
      assert.equal(edit.ok, true);
      const prepared = await preparePaperPackImagesForSave(edit.paperPack);
      assert.ok(permissions.includes('readwrite'));
      await savePaperPack(prepared.paperPack);
      const stored = harness.stores.get('paperPacks').get(pack.id);
      assert.equal(stored.patterns[0].imagePath, 'Pack/original.jpg');
      assert.equal(stored.patterns[0].imageStorageStrategy, 'local-folder');
      assert.ok(!JSON.stringify(stored).includes('blob:'), 'no runtime object URL may be persisted');
      clearPaperPackImageObjectUrls(pack);
      // A new storage module has no cached catalog/database state or preview URLs.
      const nextSession = await import(`./storage.js?paper-reference-reload-${state}`);
      reloaded = await nextSession.loadSavedPaperPack(pack.id);
      assert.equal(reloaded.name, 'Edited Pack');
      assert.equal(reloaded.patterns[0].imagePath, 'Pack/original.jpg');
      reads.length = 0;
      await hydratePaperPackImageSources([reloaded]);
      assert.ok(reads.includes('original.jpg'));
      assert.equal(await (await fetch(getPatternImageSource(reloaded.patterns[0]))).text(), await original.text());
    } finally {
      clearPaperPackImageObjectUrls(pack);
      if (reloaded) clearPaperPackImageObjectUrls(reloaded);
    }
  });
});
