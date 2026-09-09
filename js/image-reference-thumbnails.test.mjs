import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateImageReference, clearImageReferenceObjectUrls } from './image-references.js';
import { getCardLibraryImageSource, getCardDetailImageSource } from './card-images.js';
import { getStampLibraryImageSource, getStampDetailImageSource } from './stamp-die-images.js';

for (const [kind, librarySource, detailSource] of [['Card', getCardLibraryImageSource, getCardDetailImageSource], ['Stamp', getStampLibraryImageSource, getStampDetailImageSource]]) {
  test(`${kind} legacy reference discovers an existing sibling thumbnail without changing persisted paths`, async () => {
    const reads = [];
    const record = { imagePath: 'nested/original.png' };
    const root = { getDirectoryHandle: async name => { assert.equal(name, 'nested'); return { getFileHandle: async name => {
      reads.push(name); return { getFile: async () => new Blob([name], { type: 'image/jpeg' }) };
    } }; } };
    try {
      await hydrateImageReference(record, root);
      assert.deepEqual(reads, ['original.png', 'original.thumb.jpg']);
      assert.match(librarySource(record), /^blob:/);
      assert.equal(librarySource(record), record.imageThumbnailSrc);
      assert.equal(detailSource(record), record.imagePreviewSrc);
      assert.notEqual(librarySource(record), detailSource(record));
      assert.equal(record.thumbnailImagePath, undefined);
    } finally { clearImageReferenceObjectUrls(record); }
    assert.deepEqual(record, { imagePath: 'nested/original.png' });
  });
}
test('explicit thumbnail paths remain authoritative; absent thumbnails retain original fallback', async () => {
  for (const missing of [false, true]) {
    const record = { imagePath: 'original.jpg', thumbnailImagePath: 'custom.jpg' }; const reads = [];
    const directory = { getFileHandle: async name => {
      reads.push(name); if (name === 'custom.jpg' && missing) throw new Error('Missing');
      return { getFile: async () => new Blob([name], { type: 'image/jpeg' }) };
    } };
    try {
      await hydrateImageReference(record, directory);
      assert.deepEqual(reads, ['original.jpg', 'custom.jpg']);
      assert.equal(getCardLibraryImageSource(record), missing ? record.imagePreviewSrc : record.imageThumbnailSrc);
    } finally { clearImageReferenceObjectUrls(record); }
  }
});
