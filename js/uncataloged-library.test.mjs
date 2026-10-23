import test from 'node:test';
import assert from 'node:assert/strict';
import { findStampImagesForExistingSets, findUncatalogedCardImages, findUncatalogedStampItems, groupStampImageEntries, isCardImagePathCataloged, openUncatalogedItemAddWorkflow, scanImageTree } from './uncataloged-library.js';
import { scanUncatalogedCardImages } from './card-images.js';
import { loadStampImagesByRelativePaths, scanUncatalogedStampItems } from './stamp-die-images.js';

function directory(entries = []) {
  return { kind: 'directory', async *entries() { for (const entry of entries) yield entry; } };
}
function imageFile(name) { return [name, { kind: 'file' }]; }
function subDirectory(name, entries) { return [name, directory(entries)]; }

test('Stamp & Die discovery groups folders and existing flat Set image naming conventions', () => {
  const candidates = groupStampImageEntries([
    { name: 'Rose stamps.jpg', path: 'Rose stamps.jpg' },
    { name: 'Rose dies.png', path: 'Rose dies.png' },
    { name: '01.jpg', path: 'Garden Set/01.jpg' },
    { name: '02.jpg', path: 'Garden Set/02.jpg' }
  ]);
  const uncataloged = findUncatalogedStampItems(candidates, [{ id: 'set-123', name: 'Rose' }]);
  assert.deepEqual(uncataloged.map(item => [item.name, item.imageCount]), [['Garden Set', 2]]);
});

test('Stamp & Die discovery treats standalone and and ampersand as the same catalog name', () => {
  const item = { id: 'uncataloged-id', name: 'Blooms & Bliss', imagePaths: ['Blooms & Bliss/01.jpg'] };
  assert.deepEqual(findUncatalogedStampItems([item], [{ id: 'other-id', name: ' Blooms   AND   Bliss ' }]), []);
  const matched = findStampImagesForExistingSets([item], [{ id: 'set-1', name: ' Blooms   AND   Bliss ' }]);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].matchedSet.id, 'set-1');
  assert.deepEqual(findUncatalogedStampItems([item], [{ id: 'other-id', name: 'Blooms And Joy' }]), [item]);
});

test('Stamp & Die discovery excludes image paths already associated with any Set', () => {
  const item = { id: 'birds', name: 'Birds', imagePaths: ['Birds/one.jpg', 'Birds/two.jpg'] };
  const results = findStampImagesForExistingSets([item], [{ id: 'set-birds', name: 'Birds', imageRefs: [
    { imageLibrary: 'stamp-die-images', imagePath: 'Birds/one.jpg' }
  ] }]);
  assert.deepEqual(results[0].imagePaths, ['Birds/two.jpg']);
  assert.equal(results[0].imageCount, 1);
});

test('Stamp & Die discovery excludes cataloged items, handles empty sources, and reports a missing source', async () => {
  const result = await scanUncatalogedStampItems([{ name: 'Rose' }], {
    loadDirectory: async () => directory([imageFile('rose-stamps.jpg')])
  });
  assert.equal(result.items[0].matchedSet.name, 'Rose');
  assert.deepEqual(await scanUncatalogedStampItems([], { loadDirectory: async () => directory([]) }), { ok: true, items: [] });
  const missing = await scanUncatalogedStampItems([], { loadDirectory: async () => null });
  assert.equal(missing.ok, false);
  assert.match(missing.message, /Stamp & Die image folder/);
});

test('Stamp & Die discovery excludes groups whose source images are already referenced', () => {
  const items = [{ name: 'Other Name', imagePaths: ['sets/one.jpg', 'sets/two.jpg'] }];
  const sets = [{ name: 'Cataloged Under Another Name', imageRefs: [
    { imagePath: 'SETS/ONE.JPG', imageLibrary: 'stamp-die-images' }
  ] }];
  assert.deepEqual(findUncatalogedStampItems(items, sets), []);
});

test('loading discovered Stamp images reads original files and retains their source handles', async () => {
  const sourceFile = { name: 'Birds and Butterflies Stamps.jpg', contents: 'original bytes' };
  const sourceHandle = { getFile: async () => sourceFile };
  const subfolder = { getFileHandle: async name => {
    assert.equal(name, sourceFile.name);
    return sourceHandle;
  } };
  const root = { getDirectoryHandle: async name => {
    assert.equal(name, 'Birds and Butterflies');
    return subfolder;
  } };
  const loaded = await loadStampImagesByRelativePaths(['Birds and Butterflies/Birds and Butterflies Stamps.jpg'], {}, {
    loadDirectory: async mode => { assert.equal(mode, 'read'); return root; },
    selectStampImageFiles: async files => files.map(file => ({ file, name: file.name }))
  });
  assert.equal(loaded[0].fileHandle, sourceHandle);
  assert.equal(loaded[0].file, sourceFile);
  assert.equal(sourceFile.contents, 'original bytes');
});

test('Card discovery matches exact relative image paths, independent of filename/title similarity', () => {
  const uncataloged = findUncatalogedCardImages([
    { name: 'front.jpg', path: '2025/front.jpg' },
    { name: 'front.jpg', path: '2026/front.jpg' }
  ], [{ name: 'Rose', imageLibrary: 'card-images', imagePath: '2025/FRONT.jpg' }]);
  assert.deepEqual(uncataloged.map(entry => entry.path), ['2026/front.jpg']);
  assert.equal(isCardImagePathCataloged([{ imageLibrary: 'card-images', imagePath: '2025/front.jpg' }], '2025/FRONT.JPG'), true);
});

test('Card discovery handles empty and missing sources and excludes cataloged paths', async () => {
  const result = await scanUncatalogedCardImages([
    { imageLibrary: 'card-images', imagePath: 'sets/card-1.png' }
  ], { loadDirectory: async () => directory([
    subDirectory('sets', [imageFile('card-1.png'), imageFile('card-1.thumb.jpg'), imageFile('card-2.png'), imageFile('card-2.thumb.jpg')])
  ]) });
  assert.deepEqual(result.items.map(item => item.path), ['sets/card-2.png']);
  assert.deepEqual(await scanUncatalogedCardImages([], { loadDirectory: async () => directory([]) }), { ok: true, items: [] });
  const missing = await scanUncatalogedCardImages([], { loadDirectory: async () => null });
  assert.equal(missing.ok, false);
  assert.match(missing.message, /Card image folder/);
});

test('all discovery scans ignore generated thumbnail files', async () => {
  const files = await scanImageTree(directory([
    imageFile('full.jpg'), imageFile('full.thumb.jpg'), imageFile('full.thumb.jpeg'), imageFile('full.thumb.JPG')
  ]));
  assert.deepEqual(files.map(file => file.name), ['full.jpg']);
  const stamp = await scanUncatalogedStampItems([], {
    loadDirectory: async () => directory([imageFile('Sample stamps.jpg'), imageFile('Sample stamps.thumb.jpg')])
  });
  assert.deepEqual(stamp.items.map(item => item.name), ['Sample']);
});

test('uncataloged Add actions close results and open the existing product Add button', async () => {
  const panel = { hidden: false };
  const order = [];
  await openUncatalogedItemAddWorkflow({ click: () => order.push('existing Add workflow') }, panel, () => order.push('selected item prepared'));
  assert.equal(panel.hidden, true);
  assert.deepEqual(order, ['selected item prepared', 'existing Add workflow']);
});

test('uncataloged Add action rechecks current catalog state before opening the Add form', async () => {
  const panel = { hidden: false };
  let opened = 0;
  await openUncatalogedItemAddWorkflow({ click: () => opened++ }, panel, async () => false);
  assert.equal(panel.hidden, true);
  assert.equal(opened, 0);
});
