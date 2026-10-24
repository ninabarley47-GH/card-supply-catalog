import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseStampImages, selectStampImageFiles, prepareStampImagesForSave,
  removeDraftStampImage, clearDraftStampImages, hydrateStampImages,
  getStampDetailImageSource, STAMP_IMAGE_LIBRARY_MARKER
} from './stamp-die-images.js';
import {
  prepareFolderBackedImage, prepareEmbeddedImage, writeFile,
  hydrateImageReference, clearImageReferenceObjectUrls
} from './image-references.js';
import { normalizeImageReference } from './stamp-die-sets.js';
import { inferStampDieImageTags, reconcileStampDieImageTags, orderStampDieImages } from './stamp-die-image-tags.js';

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

const catalog = () => ({ schemaVersion: 2, tags: [
  { id: 'manual', name: 'Floral', type: 'theme', categoryIds: [] },
  { id: 'stamp-id', name: 'Stamp', type: 'tool', filenameTerms: [], unmatchedFilenameFallback: true, categoryIds: ['supplies'] },
  { id: 'die-id', name: 'Die', type: 'tool', filenameTerms: ['die'], categoryIds: ['supplies'] },
  { id: 'punch-id', name: 'Punch', type: 'tool', filenameTerms: ['punch'], categoryIds: ['supplies'] },
  { id: 'mask-id', name: 'Mask', type: 'tool', filenameTerms: ['mask'], categoryIds: ['supplies'] }
], categories: [{ id: 'supplies', name: 'Supplies' }] });

for (const [filename, expected] of [['die.jpg', 'die-id'], ['DIES.JPG', 'die-id'], ['Punch.jpg', 'punch-id'], ['PUNCH.JPG', 'punch-id'], ['Stamp.jpg', 'stamp-id']]) {
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

test('missing Tool Tags are reported and never created during inference', () => {
  const original = { schemaVersion: 2, tags: [], categories: [] };
  const inferred = inferStampDieImageTags(original, [], ['stamp.jpg', 'die.jpg']);
  assert.equal(original.tags.length, 0);
  assert.deepEqual(inferred.tagIds, []);
  assert.equal(inferred.warnings.length, 2);
  const removedManually = reconcileStampDieImageTags({ tagIds: [] }, original, inferred.inferredTags);
  assert.equal(removedManually.catalog.tags.length, 0);
  assert.deepEqual(removedManually.record.tagIds, []);
  const saved = reconcileStampDieImageTags({ tagIds: ['manual', 'manual'] }, original, []);
  assert.deepEqual(saved.record.tagIds, ['manual']);
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
  ['Frosted Pines Punch.jpg', 'punch-id'],
  ['Frosted Pines PUNCHES.jpg', 'punch-id'],
  ['Frosted Pines Masks.jpg', 'mask-id'],
  ['Frosted Pines MASK.JPG', 'mask-id'],
  ['Frosted Pines mAsKs.jpg', 'mask-id'],
  ['Frosted Pines Dies Masks.jpg', null],
  ['Frosted Pines MASKS dIeS.jpg', null]
]) {
  test(`filename inference: ${filename} ${expected ? `selects ${expected}` : 'reports ambiguity'}`, () => {
    const result = inferStampDieImageTags(catalog(), ['manual'], [filename]);
    assert.deepEqual(result.tagIds, expected ? ['manual', expected] : ['manual']);
    if (!expected) assert.match(result.warnings[0], /matches multiple Tool Tags/);
    assert.equal(result.tagIds.includes('supplies'), false);
  });
}

test('mixed Stamp/Die/Punch/Mask inference preserves all existing and manual tags', () => {
  const mixed = inferStampDieImageTags(catalog(), ['manual'], ['Frosted Pines.jpg', 'Frosted Pines Dies.jpg', 'Frosted Pines Punch.jpg', 'Frosted Pines Masks.jpg']);
  assert.deepEqual(mixed.tagIds, ['manual', 'stamp-id', 'die-id', 'punch-id', 'mask-id']);
  assert.deepEqual(inferStampDieImageTags(mixed.catalog, mixed.tagIds, ['another stamp.jpg']).tagIds, mixed.tagIds);
  assert.deepEqual(inferStampDieImageTags(mixed.catalog, mixed.tagIds, []).tagIds, mixed.tagIds);
});

test('missing Mask is reported without creating a global tag', () => {
  const original = { schemaVersion: 2, tags: [], categories: [] };
  const inferred = inferStampDieImageTags(original, [], ['Frosted Pines Masks.jpg']);
  assert.deepEqual(original.tags, []);
  assert.deepEqual(inferred.tagIds, []);
  assert.match(inferred.warnings[0], /Mask/);
  const saved = reconcileStampDieImageTags({ tagIds: inferred.tagIds }, original, inferred.inferredTags);
  assert.deepEqual(saved.catalog.tags, []);
  assert.deepEqual(saved.record.tagIds, []);
});

test('terms are case and separator insensitive, respect word boundaries, and support singular/plural', () => {
  const configured = catalog();
  const result = inferStampDieImageTags(configured, [], ['set_dIeS-v2.jpg', 'the-diesel-engine.jpg']);
  assert.deepEqual(result.tagIds, ['die-id', 'stamp-id']);
  assert.equal(result.catalog, configured);
  const pluralConfigured = structuredClone(configured);
  pluralConfigured.tags.find((tag) => tag.id === 'die-id').filenameTerms = ['DIES'];
  assert.deepEqual(inferStampDieImageTags(pluralConfigured, [], ['die tool.jpg']).tagIds, ['die-id']);
});

test('one set can infer multiple tools across separate filenames without duplicate IDs', () => {
  const result = inferStampDieImageTags(catalog(), ['manual', 'die-id'], ['Die set.jpg', 'Masks set.jpg', 'Punches set.jpg']);
  assert.deepEqual(result.tagIds, ['manual', 'die-id', 'mask-id', 'punch-id']);
});

test('custom filename terms select renamed Tool Tags while Theme Tags remain inactive', () => {
  const source = catalog();
  source.tags.find((tag) => tag.id === 'die-id').name = 'Cutting Tool';
  const result = inferStampDieImageTags(source, [], ['Dies.jpg']);
  assert.deepEqual(result.tagIds, ['die-id']);
  const themeOnly = { schemaVersion: 2, tags: [{ id: 'theme-die', name: 'Die', type: 'theme', categoryIds: [] }], categories: [] };
  const ignoredTheme = inferStampDieImageTags(themeOnly, [], ['Dies.jpg']);
  assert.deepEqual(ignoredTheme.tagIds, []);
  assert.match(ignoredTheme.warnings[0], /Die/);
});

test('Stamp fallback applies only to unmatched names and missing Stamp is reported', () => {
  const source = catalog();
  assert.deepEqual(inferStampDieImageTags(source, [], ['Unknown design.jpg']).tagIds, ['stamp-id']);
  source.tags.find((tag) => tag.id === 'stamp-id').name = 'Unmatched Design Tool';
  assert.deepEqual(inferStampDieImageTags(source, [], ['Another unknown design.jpg']).tagIds, ['stamp-id']);

  const unrelatedTool = { schemaVersion: 2, tags: [
    { id: 'tool', name: 'Other Tool', type: 'tool', filenameTerms: [], categoryIds: [] }
  ], categories: [] };
  const noFallback = inferStampDieImageTags(unrelatedTool, [], ['Unknown design.jpg']);
  assert.deepEqual(noFallback.tagIds, []);
  assert.match(noFallback.warnings[0], /no Stamp Tool Tag/);

  source.tags = source.tags.filter((tag) => tag.id !== 'stamp-id');
  const result = inferStampDieImageTags(source, [], ['Unknown design.jpg']);
  assert.deepEqual(result.tagIds, []);
  assert.match(result.warnings[0], /no Stamp Tool Tag/);
});

test('presentation sorting is stable within Stamp, Die, Punch and Mask and never mutates stored input', () => {
  const names = ['Mask 1.jpg', 'DIE MASK 1.jpg', 'Punch 1.jpg', 'Stamp 1.jpg', 'Mask 2.jpg', 'Die 2.jpg', 'PUNCH 2.jpg', 'Stamp 2.jpg'];
  const refs = names.map((imageName) => ({ imageName }));
  assert.deepEqual(orderStampDieImages(refs).map((image) => image.imageName), ['Stamp 1.jpg', 'Stamp 2.jpg', 'DIE MASK 1.jpg', 'Die 2.jpg', 'Punch 1.jpg', 'PUNCH 2.jpg', 'Mask 1.jpg', 'Mask 2.jpg']);
  assert.deepEqual(refs.map((image) => image.imageName), names);
});

test('existing Edit references bypass all image writes; removing a reference leaves shared files unchanged', async () => {
  const library = directoryHarness({ 'Die.jpg': 'original', 'Die.thumb.jpg': 'thumbnail' });
  const refs = [
    { imageName: 'Die.jpg', imagePath: 'Die.jpg', thumbnailImagePath: 'Die.thumb.jpg', imageLibrary: 'stamp-die-images', imageStorageStrategy: 'local-folder' },
    { imageName: 'Stamp.jpg', imageSrc: 'data:image/jpeg;base64,YQ==', thumbnailImageSrc: 'data:image/jpeg;base64,Yg==', imageStorageStrategy: 'embedded-indexed-db' }
  ];
  const draft = refs.map((existingReference) => ({ existingReference }));
  const services = { loadDirectory: async () => library.directory,
    prepareFolder: async () => assert.fail('Existing file must not be prepared'),
    prepareEmbedded: async () => assert.fail('Existing image must not be encoded') };
  assert.deepEqual((await prepareStampImagesForSave(draft, services)).imageRefs, refs);
  const remaining = removeDraftStampImage(draft, 0);
  assert.deepEqual((await prepareStampImagesForSave(remaining, services)).imageRefs, [refs[1]]);
  clearDraftStampImages(remaining);
  assert.deepEqual(library.writes, []);
  assert.equal(await library.files.get('Die.jpg').text(), 'original');
  assert.equal(await library.files.get('Die.thumb.jpg').text(), 'thumbnail');
});

test('Detail reuses full-image resolution after folder hydration and falls back to embedded/thumbnail sources', async () => {
  const h = directoryHarness({ 'Stamp.jpg': 'original', 'Stamp.thumb.jpg': 'thumbnail' });
  const ref = { imagePath: 'Stamp.jpg', thumbnailImagePath: 'Stamp.thumb.jpg', imageLibrary: 'stamp-die-images' };
  await hydrateStampImages([{ imageRefs: [ref] }], { loadDirectory: async () => h.directory });
  try {
    assert.equal(getStampDetailImageSource(ref), ref.imagePreviewSrc);
    assert.match(getStampDetailImageSource(ref), /^blob:/);
    assert.deepEqual(h.writes, []);
    assert.equal(getStampDetailImageSource({ imageSrc: 'full', thumbnailImageSrc: 'thumb' }), 'full');
    assert.equal(getStampDetailImageSource({ thumbnailImageSrc: 'thumb' }), 'thumb');
    assert.equal(getStampDetailImageSource({ imagePath: 'unresolved.jpg' }), '');
  } finally { clearImageReferenceObjectUrls(ref); }
});

test('automatic Set folder lookup reuses Paper matching, excludes thumbnails, and preserves original handles', async () => {
  const names = ['Garden MaSk.jpg', 'Garden DIES.jpg', 'Garden.jpg', 'Garden.thumb.jpg', 'notes.txt'];
  const handles = names.map(name => ({ kind: 'file', name, relativePath: ['Garden Set', name], getFile: async () => file(name) }));
  const child = { kind: 'directory', async *entries() { for (const handle of handles) yield [handle.name, handle]; } };
  const root = { async getDirectoryHandle() { throw new DOMException('Missing', 'NotFoundError'); },
    async *entries() { yield ['Unrelated', { kind: 'directory' }]; yield ['Garden Set', child]; } };
  const { loadStampImagesForSetName } = await import('./stamp-die-images.js');
  const images = await loadStampImagesForSetName('garden-set', { ...environment(), showDirectoryPicker() {} }, {
    loadDirectory: async (mode, request) => { assert.equal(mode, 'read'); assert.equal(request, true); return root; }
  });
  assert.equal(images.length, 3);
  const ordered = orderStampDieImages(images);
  assert.deepEqual(ordered.map(image => image.name), ['Garden.jpg', 'Garden DIES.jpg', 'Garden MaSk.jpg']);
  for (const image of images) {
    assert.equal(image.fileHandle, handles.find(handle => handle.name === image.name));
    assert.ok(image.file instanceof File);
    assert.ok(image.previewSrc);
  }
  const inferred = inferStampDieImageTags(catalog(), [], images.map(image => image.name));
  assert.deepEqual(inferred.tagIds, ['die-id', 'mask-id', 'stamp-id']);
  assert.deepEqual(await loadStampImagesForSetName('Missing', { ...environment(), showDirectoryPicker() {} }, { loadDirectory: async () => root }), []);
});

test('automatic Set lookup skips unsupported browsers before accessing a saved folder', async () => {
  const { loadStampImagesForSetName } = await import('./stamp-die-images.js');
  assert.deepEqual(await loadStampImagesForSetName('Garden', environment(), {
    loadDirectory: async () => { assert.fail('Unsupported browser must not access a folder'); }
  }), []);
  assert.deepEqual(await loadStampImagesForSetName('Garden', { showDirectoryPicker() {} }, { loadDirectory: async () => null }), []);
});

test('automatic lookup finds Set-named originals stored directly in the connected library', async () => {
  const names = ['Frosted Pines.jpg', 'Frosted Pines DIES.JPG', 'Frosted Pines MaSk.png',
    'Frosted Pines.thumb.jpg', 'Frosted Pines DIES.thumb.jpg', 'Frosted Pines Extra.jpg', 'Other Pines.jpg'];
  const handles = names.map(name => ({ kind: 'file', name, relativePath: [name], getFile: async () => file(name) }));
  const directory = {
    async getDirectoryHandle() { throw new DOMException('Missing', 'NotFoundError'); },
    async *entries() { for (const handle of handles) yield [handle.name, handle]; }
  };
  const { loadStampImagesForSetName } = await import('./stamp-die-images.js');
  const images = await loadStampImagesForSetName('Frosted Pines', { ...environment(), showDirectoryPicker() {} }, { loadDirectory: async () => directory });
  assert.deepEqual(orderStampDieImages(images).map(image => image.name), ['Frosted Pines.jpg', 'Frosted Pines DIES.JPG', 'Frosted Pines MaSk.png']);
  assert.ok(images.every(image => image.fileHandle === handles.find(handle => handle.name === image.name)));
});
