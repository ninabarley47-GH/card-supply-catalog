import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseStampImages, selectStampImageFiles, prepareStampImagesForSave,
  removeDraftStampImage, clearDraftStampImages, hydrateStampImages,
  STAMP_IMAGE_LIBRARY_MARKER
} from './stamp-die-images.js';
import {
  prepareFolderBackedImage, prepareEmbeddedImage, writeFile,
  hydrateImageReference, clearImageReferenceObjectUrls
} from './image-references.js';
import { normalizeImageReference } from './stamp-die-sets.js';
import { inferStampDieImageTags, reconcileStampDieImageTags } from './stamp-die-image-tags.js';

const file = (name, contents = name) => new File([contents], name, { type: 'image/jpeg' });
const thumbnail = async () => new Blob(['thumbnail'], { type: 'image/jpeg' });
const encode = async (blob) => `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
const embedded = (record, image, options) => prepareEmbeddedImage(record, image, { ...options, thumbnail, encode });
const folder = (record, image, directory, options) => prepareFolderBackedImage(record, image, directory, { ...options, thumbnail });
const selected = (name) => ({ file: file(name), name, previewSrc: 'data:image/jpeg;base64,cHJldmlldw==' });

function directoryHarness(initial = {}) {
  const files = new Map(Object.entries(initial).map(([name, content]) => [name, file(name, content)]));
  const writes = [];
  const directory = {
    name: 'Sets',
    queryPermission: async () => 'granted',
    resolve: async (handle) => handle.relativePath || null,
    async getFileHandle(name, options = {}) {
      if (!files.has(name)) {
        if (!options.create) throw new DOMException('Missing', 'NotFoundError');
        files.set(name, file(name, ''));
      }
      return {
        kind: 'file', name,
        getFile: async () => files.get(name),
        createWritable: async () => {
          writes.push(name);
          let contents;
          return { write: async (data) => { contents = data; }, close: async () => { files.set(name, contents); } };
        }
      };
    },
    async getDirectoryHandle() { throw new DOMException('Missing', 'NotFoundError'); }
  };
  return { directory, files, writes };
}

function environment(handles = []) {
  return {
    document: { createElement() {} },
    FileReader: class {
      listeners = {};
      addEventListener(type, handler) { this.listeners[type] = handler; }
      readAsDataURL() { this.result = 'data:image/jpeg;base64,cHJldmlldw=='; this.listeners.load(); }
    },
    async showOpenFilePicker(options) { assert.equal(options.multiple, true); return handles; }
  };
}

test('native multiple selection and standard file input retain user-provided order', async () => {
  const handles = ['z-stamp.jpg', 'a-DIES.jpg'].map((name) => ({ getFile: async () => file(name) }));
  const images = await chooseStampImages(environment(handles));
  assert.deepEqual(images.map((image) => image.name), ['z-stamp.jpg', 'a-DIES.jpg']);
  assert.equal(images[0].fileHandle, handles[0]);
  const fallback = await selectStampImageFiles([file('second.jpg'), file('first.jpg')], environment());
  assert.deepEqual(fallback.map((image) => image.name), ['second.jpg', 'first.jpg']);
  await assert.rejects(selectStampImageFiles([new File(['svg'], 'bad.svg', { type: 'image/svg+xml' })], environment()));
});

test('native picker cancellation produces no selection or persistence', async () => {
  const env = environment();
  env.showOpenFilePicker = async () => { throw new DOMException('Canceled', 'AbortError'); };
  await assert.rejects(chooseStampImages(env), { name: 'AbortError' });
});

test('folder save references existing originals and thumbnails without writing to either', async () => {
  const h = directoryHarness({ 'stamp.jpg': 'original', 'stamp.thumb.jpg': 'existing thumb' });
  const image = { ...selected('stamp.jpg'), fileHandle: { relativePath: ['stamp.jpg'] } };
  const result = await prepareStampImagesForSave([image], { loadDirectory: async () => h.directory, prepareFolder: folder });
  assert.deepEqual(result.imageRefs, [{ imageName: 'stamp.jpg', imagePath: 'stamp.jpg', thumbnailImagePath: 'stamp.thumb.jpg', imageLibrary: STAMP_IMAGE_LIBRARY_MARKER, imageStorageStrategy: 'local-folder' }]);
  assert.deepEqual(h.writes, []);
  assert.equal(await h.files.get('stamp.jpg').text(), 'original');
  assert.equal(await h.files.get('stamp.thumb.jpg').text(), 'existing thumb');
});

test('folder copies and thumbnails use new names, retain image order, and reuse prepared files on retry', async () => {
  const h = directoryHarness({ 'stamp.jpg': 'shared original', 'stamp.thumb.jpg': 'shared thumbnail' });
  const images = [selected('stamp.jpg'), selected('die.jpg'), selected('stamp.jpg')];
  const services = { loadDirectory: async () => h.directory, prepareFolder: folder };
  const result = await prepareStampImagesForSave(images, services);
  assert.deepEqual(result.imageRefs.map((ref) => ref.imagePath), ['stamp-2.jpg', 'die.jpg', 'stamp-3.jpg']);
  assert.equal(await h.files.get('stamp.jpg').text(), 'shared original');
  assert.equal(await h.files.get('stamp.thumb.jpg').text(), 'shared thumbnail');
  assert.deepEqual(h.writes, ['stamp-2.jpg', 'stamp-2.thumb.jpg', 'die.jpg', 'die.thumb.jpg', 'stamp-3.jpg', 'stamp-3.thumb.jpg']);
  const writeCount = h.writes.length;
  assert.deepEqual(await prepareStampImagesForSave(images, services), result);
  assert.equal(h.writes.length, writeCount);
  await assert.rejects(writeFile(h.directory, 'stamp.jpg', file('stamp.jpg', 'replacement')));
  assert.equal(await h.files.get('stamp.jpg').text(), 'shared original');
});

test('existing original with no thumbnail creates only a new thumbnail', async () => {
  const h = directoryHarness({ 'die.jpg': 'original' });
  await prepareStampImagesForSave([{ ...selected('die.jpg'), fileHandle: { relativePath: ['die.jpg'] } }], { loadDirectory: async () => h.directory, prepareFolder: folder });
  assert.deepEqual(h.writes, ['die.thumb.jpg']);
});

test('missing folder, denied permission, and folder write errors use embedded originals and thumbnails', async () => {
  for (const mode of ['missing', 'denied', 'write-error']) {
    const h = directoryHarness({ 'shared.jpg': 'keep' });
    const result = await prepareStampImagesForSave([selected('stamp.jpg'), selected('die.jpg')], {
      loadDirectory: async () => { if (mode === 'denied') throw new Error('Permission denied'); return mode === 'missing' ? null : h.directory; },
      prepareFolder: async () => { throw new Error('Write denied'); },
      prepareEmbedded: embedded
    });
    assert.equal(result.usedFallback, true);
    assert.deepEqual(result.imageRefs.map((ref) => ref.imageName), ['stamp.jpg', 'die.jpg']);
    for (const ref of result.imageRefs) {
      assert.match(ref.imageSrc, /^data:image\/jpeg;base64,/);
      assert.match(ref.thumbnailImageSrc, /^data:image\/jpeg;base64,/);
      assert.equal(ref.imageStorageStrategy, 'embedded-indexed-db');
      assert.deepEqual(normalizeImageReference(ref), ref);
    }
    assert.equal(await h.files.get('shared.jpg').text(), 'keep');
  }
});

test('thumbnail-unavailable browsers retain the embedded original', async () => {
  const result = await prepareEmbeddedImage({}, file('stamp.jpg'), {
    allowMissingThumbnail: true, encode, thumbnail: async () => { throw new Error('Bitmap unavailable'); }
  });
  assert.match(result.imageSrc, /^data:image\/jpeg/);
  assert.equal('thumbnailImageSrc' in result, false);
});

test('reference normalization preserves ordered folder/embedded metadata and omits transient state', async () => {
  const folderRef = { imagePath: 'Set/stamp.jpg', imageName: 'stamp.jpg', imageLibrary: STAMP_IMAGE_LIBRARY_MARKER, thumbnailImagePath: 'Set/stamp.thumb.jpg', imageStorageStrategy: 'local-folder' };
  const embeddedRef = await embedded({}, file('die.jpg'));
  const refs = [folderRef, embeddedRef].map((ref) => normalizeImageReference({ ...ref, imagePreviewSrc: 'blob:temporary', imageThumbnailSrc: 'blob:thumb', file: file('unused.jpg'), fileHandle: {} }));
  assert.deepEqual(refs, [folderRef, embeddedRef]);
  assert.throws(() => normalizeImageReference({ imageSrc: 'blob:temporary' }));
  assert.throws(() => normalizeImageReference({ ...folderRef, thumbnailImagePath: '../other.jpg' }));
});

test('empty image selection remains valid and never requests a folder', async () => {
  assert.deepEqual(await prepareStampImagesForSave([], { loadDirectory: () => { throw new Error('Should not load'); } }), { imageRefs: [], usedFallback: false });
});

test('removing and clearing draft images only releases preview URLs and never writes user files', () => {
  const h = directoryHarness({ 'shared.jpg': 'original' });
  const images = [selected('stamp.jpg'), selected('die.jpg')];
  const remaining = removeDraftStampImage(images, 0);
  assert.equal(images.length, 2);
  assert.equal(remaining[0].name, 'die.jpg');
  clearDraftStampImages(remaining);
  assert.deepEqual(h.writes, []);
});

test('folder hydration provides transient thumbnail/full sources and releases them on refresh', async () => {
  const h = directoryHarness({ 'stamp.jpg': 'full', 'stamp.thumb.jpg': 'thumb' });
  const reference = { imagePath: 'stamp.jpg', thumbnailImagePath: 'stamp.thumb.jpg', imageLibrary: STAMP_IMAGE_LIBRARY_MARKER };
  await hydrateStampImages([{ imageRefs: [reference] }], { loadDirectory: async () => h.directory, hydrate: hydrateImageReference });
  assert.match(reference.imagePreviewSrc, /^blob:/);
  assert.match(reference.imageThumbnailSrc, /^blob:/);
  const stored = normalizeImageReference(reference);
  assert.equal('imagePreviewSrc' in stored, false);
  clearImageReferenceObjectUrls(reference);
  assert.equal('imageThumbnailSrc' in reference, false);
  assert.deepEqual(h.writes, []);
});

const catalog = () => ({ schemaVersion: 1, tags: [
  { id: 'manual', name: 'Floral', categoryIds: [] },
  { id: 'stamp-id', name: 'Stamp', categoryIds: ['supplies'], appliesTo: ['paper'] },
  { id: 'die-id', name: 'Die', categoryIds: ['supplies'], appliesTo: ['card'] },
  { id: 'mask-id', name: 'Mask', categoryIds: ['supplies'], appliesTo: ['paper'] }
], categories: [{ id: 'supplies', name: 'Supplies' }] });

for (const [filename, expected] of [['die.jpg', 'die-id'], ['DIES.JPG', 'die-id'], ['Stamp.jpg', 'stamp-id']]) {
  test(`filename ${filename} adds the ordinary ${expected} global tag`, () => {
    assert.deepEqual(inferStampDieImageTags(catalog(), ['manual'], [filename]).tagIds, ['manual', expected]);
  });
}

test('mixed inference adds both tags, preserves manual/existing assignments, and never assigns categories', () => {
  const result = inferStampDieImageTags(catalog(), ['manual', 'stamp-id'], ['die.jpg', 'stamp.jpg']);
  assert.deepEqual(result.tagIds, ['manual', 'stamp-id', 'die-id']);
  assert.equal(result.tagIds.includes('supplies'), false);
  assert.deepEqual(inferStampDieImageTags(result.catalog, result.tagIds, []).tagIds, result.tagIds);
});

test('missing Stamp/Die tags stay in memory until selected assignments are reconciled for save', () => {
  const original = { schemaVersion: 1, tags: [], categories: [] };
  const inferred = inferStampDieImageTags(original, [], ['stamp.jpg', 'die.jpg']);
  assert.equal(original.tags.length, 0);
  const removedManually = reconcileStampDieImageTags({ tagIds: [] }, original, inferred.inferredTags);
  assert.equal(removedManually.catalog.tags.length, 0);
  assert.deepEqual(removedManually.record.tagIds, []);
  const current = { ...original, tags: [{ id: 'existing-stamp', name: 'Stamp', categoryIds: [] }] };
  const saved = reconcileStampDieImageTags({ tagIds: inferred.tagIds }, current, inferred.inferredTags);
  assert.equal(saved.catalog.tags.length, 2);
  assert.equal(saved.record.tagIds[0], 'existing-stamp');
  assert.equal(saved.catalog.tags.find((tag) => tag.id === saved.record.tagIds[1]).name, 'Die');
});

test('Cards continue using the shared folder implementation with the Card library marker', async () => {
  const { prepareCardImageForSave } = await import('./card-images.js');
  const h = directoryHarness({ 'card.jpg': 'original', 'card.thumb.jpg': 'thumb' });
  const saved = await prepareCardImageForSave({ id: 'card-one' }, { file: file('card.jpg'), imagePath: 'card.jpg' }, { getDirectoryHandle: async () => h.directory });
  assert.equal(saved.card.imageLibrary, 'card-images');
  assert.equal(saved.card.id, 'card-one');
  assert.equal(saved.usedFallback, false);
  assert.deepEqual(h.writes, []);
});

test('filename inference rejects category IDs rather than carrying them into Set assignments', () => {
  assert.throws(() => inferStampDieImageTags(catalog(), ['supplies'], ['stamp.jpg']));
});


test('retry recognizes a cloned directory handle loaded from IndexedDB', async () => {
  const h = directoryHarness();
  const images = [selected('stamp.jpg')];
  const services = { loadDirectory: async () => ({ ...h.directory, isSameEntry: async () => true }), prepareFolder: folder };
  const first = await prepareStampImagesForSave(images, services);
  const writes = h.writes.length;
  assert.deepEqual(await prepareStampImagesForSave(images, services), first);
  assert.equal(h.writes.length, writes);
});


for (const [filename, expected] of [
  ['Frosted Pines.jpg', 'stamp-id'],
  ['Frosted Pines Dies.jpg', 'die-id'],
  ['Frosted Pines Masks.jpg', 'mask-id'],
  ['Frosted Pines MASK.JPG', 'mask-id'],
  ['Frosted Pines mAsKs.jpg', 'mask-id'],
  ['Frosted Pines Dies Masks.jpg', 'die-id'],
  ['Frosted Pines MASKS dIeS.jpg', 'die-id']
]) {
  test(`Die-first inference: ${filename} selects only ${expected}`, () => {
    const result = inferStampDieImageTags(catalog(), ['manual'], [filename]);
    assert.deepEqual(result.tagIds, ['manual', expected]);
    assert.equal(result.tagIds.includes('supplies'), false);
  });
}

test('mixed Stamp/Die/Mask inference preserves all existing and manual tags', () => {
  const mixed = inferStampDieImageTags(catalog(), ['manual'], ['Frosted Pines.jpg', 'Frosted Pines Dies.jpg', 'Frosted Pines Masks.jpg']);
  assert.deepEqual(mixed.tagIds, ['manual', 'stamp-id', 'die-id', 'mask-id']);
  assert.deepEqual(inferStampDieImageTags(mixed.catalog, mixed.tagIds, ['another stamp.jpg']).tagIds, mixed.tagIds);
  assert.deepEqual(inferStampDieImageTags(mixed.catalog, mixed.tagIds, []).tagIds, mixed.tagIds);
});

test('missing Mask is an ordinary draft global tag; reconciliation respects manual removal and existing identity', () => {
  const original = { schemaVersion: 1, tags: [], categories: [] };
  const inferred = inferStampDieImageTags(original, [], ['Frosted Pines Masks.jpg']);
  assert.deepEqual(original.tags, []);
  assert.equal(inferred.catalog.tags[0].name, 'Mask');
  const saved = reconcileStampDieImageTags({ tagIds: inferred.tagIds }, original, inferred.inferredTags);
  assert.equal(saved.catalog.tags[0].name, 'Mask');
  assert.deepEqual(saved.record.tagIds, inferred.tagIds);
  const removed = reconcileStampDieImageTags({ tagIds: [] }, original, inferred.inferredTags);
  assert.deepEqual(removed.catalog.tags, []);
  assert.deepEqual(removed.record.tagIds, []);
  const current = { ...original, tags: [{ id: 'existing-mask', name: 'Mask', categoryIds: [] }] };
  const reconciled = reconcileStampDieImageTags({ tagIds: inferred.tagIds }, current, inferred.inferredTags);
  assert.deepEqual(reconciled.record.tagIds, ['existing-mask']);
  assert.equal(reconciled.catalog.tags.length, 1);
});
