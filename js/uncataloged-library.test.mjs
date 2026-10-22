import test from 'node:test';
import assert from 'node:assert/strict';
import { findUncatalogedCardImages, findUncatalogedStampItems, groupStampImageEntries, isCardImagePathCataloged, openUncatalogedItemAddWorkflow, scanImageTree } from './uncataloged-library.js';
import { scanUncatalogedCardImages } from './card-images.js';
import { scanUncatalogedStampItems } from './stamp-die-images.js';

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

test('Stamp & Die discovery excludes cataloged items, handles empty sources, and reports a missing source', async () => {
  const result = await scanUncatalogedStampItems([{ name: 'Rose' }], {
    loadDirectory: async () => directory([imageFile('rose-stamps.jpg')])
  });
  assert.deepEqual(result.items, []);
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
