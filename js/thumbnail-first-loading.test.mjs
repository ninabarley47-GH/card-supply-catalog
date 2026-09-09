import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hydrateImageReference, ensureImageReferenceOriginal, clearImageReferenceObjectUrls, inheritImageReferenceState, bindImageReference } from './image-references.js';
import { hydratePaperPackImageSources, getPaperLibraryImageSource, getPatternImageSource } from './images.js';
import { hydrateCardImageSources, getCardLibraryImageSource, getCardDetailImageSource } from './card-images.js';
import { hydrateStampImages, getStampLibraryImageSource, getStampDetailImageSource } from './stamp-die-images.js';

function folder(thumbnail = 'thumb') {
  const reads = [];
  const directory = { getFileHandle: async name => ({ getFile: async () => {
    reads.push(name);
    if (name === 'original.thumb.jpg' && thumbnail === null) throw new Error('Missing');
    return new Blob([name === 'original.thumb.jpg' ? thumbnail : 'original'], { type: 'image/jpeg' });
  } }) };
  return { directory, reads };
}
const pipelines = [
  ['Paper', (record, directory, options) => hydratePaperPackImageSources([{ patterns: [record] }], options,
    { getReadableImageLibraryDirectoryHandle: async () => directory }), getPaperLibraryImageSource, getPatternImageSource],
  ['Card', (record, directory, options) => hydrateCardImageSources([record], options,
    { getDirectoryHandle: async () => directory }), getCardLibraryImageSource, getCardDetailImageSource],
  ['Stamp', (record, directory, options) => hydrateStampImages([{ imageRefs: [record] }],
    { loadDirectory: async () => directory }, options), getStampLibraryImageSource, getStampDetailImageSource]
];
for (const [kind, hydrate, librarySource, detailSource] of pipelines) {
  test(`${kind} Library opens only the thumbnail, then Detail/Edit obtains one original on demand`, async () => {
    const h = folder(); const record = { imagePath: 'original.jpg', imageLibrary: kind === 'Card' ? 'card-images' : 'stamp-die-images' };
    try {
      await hydrate(record, h.directory, { preferThumbnail: true });
      assert.deepEqual(h.reads, ['original.thumb.jpg']);
      assert.equal(record.imagePreviewSrc, undefined);
      const thumbnail = librarySource(record); assert.match(thumbnail, /^blob:/);
      if (kind === 'Paper') assert.equal(Object.keys(record).includes('imageThumbnailSrc'), false);
      const [detail, edit] = await Promise.all([ensureImageReferenceOriginal(record), ensureImageReferenceOriginal(record)]);
      assert.equal(detail, edit); assert.equal(detailSource(record), detail);
      assert.notEqual(detail, thumbnail); assert.equal(librarySource(record), thumbnail);
      await ensureImageReferenceOriginal(record);
      assert.deepEqual(h.reads, ['original.thumb.jpg', 'original.jpg']);
    } finally { clearImageReferenceObjectUrls(record); }
  });
  for (const thumbnail of [null, '']) test(`${kind} missing/empty thumbnail (${thumbnail}) falls back to original`, async () => {
    const h = folder(thumbnail); const record = { imagePath: 'original.jpg', imageLibrary: kind === 'Card' ? 'card-images' : 'stamp-die-images' };
    try {
      await hydrate(record, h.directory, { preferThumbnail: true });
      assert.deepEqual(h.reads, ['original.thumb.jpg', 'original.jpg']);
      assert.equal(librarySource(record), record.imagePreviewSrc); assert.match(record.imagePreviewSrc, /^blob:/);
    } finally { clearImageReferenceObjectUrls(record); }
  });
  test(`${kind} full hydration remains available for existing original-requiring operations`, async () => {
    const h = folder(); const record = { imagePath: 'original.jpg', imageLibrary: kind === 'Card' ? 'card-images' : 'stamp-die-images' };
    try { await hydrate(record, h.directory, {}); assert.ok(h.reads.includes('original.jpg')); assert.ok(record.imagePreviewSrc); }
    finally { clearImageReferenceObjectUrls(record); }
  });
  test(`${kind} disconnected/unsupported library does no file reads and preserves embedded fallback`, async () => {
    const record = { imagePath: 'original.jpg', imageLibrary: kind === 'Card' ? 'card-images' : 'stamp-die-images', imageSrc: 'data:image/jpeg;base64,YQ==', thumbnailImageSrc: 'data:image/jpeg;base64,Yg==' };
    await hydrate(record, null, { preferThumbnail: true });
    assert.equal(await ensureImageReferenceOriginal(record), record.imageSrc);
    assert.equal(record.imagePreviewSrc, undefined);
  });
}

test('cleanup invalidates an in-flight original without creating a late URL', async t => {
  const h = folder(); const record = { imagePath: 'original.jpg' }; let release;
  const created = []; const revoked = [];
  t.mock.method(URL, 'createObjectURL', () => { const url = `blob:test-${created.length}`; created.push(url); return url; });
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  await hydrateImageReference(record, h.directory, { preferThumbnail: true, loadOriginal: () => new Promise(resolve => { release = resolve; }) });
  const pending = ensureImageReferenceOriginal(record);
  clearImageReferenceObjectUrls(record);
  release(new Blob(['original']));
  assert.equal(await pending, '');
  assert.equal(record.imagePreviewSrc, undefined);
  assert.equal(created.length, 1); assert.deepEqual(revoked, created);
});

test('metadata replacement preserves pending reads and cleanup releases both URLs once', async t => {
  const h = folder(); const record = { imagePath: 'original.jpg' }; let release;
  const revoked = []; t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  await hydrateImageReference(record, h.directory, { preferThumbnail: true, loadOriginal: () => new Promise(resolve => { release = resolve; }) });
  const pending = ensureImageReferenceOriginal(record);
  const updated = { ...record, favorite: true }; inheritImageReferenceState(record, updated);
  const next = ensureImageReferenceOriginal(updated);
  release(new Blob(['original']));
  assert.equal(await pending, await next);
  assert.equal(updated.imagePreviewSrc, record.imagePreviewSrc);
  clearImageReferenceObjectUrls(updated);
  assert.equal(revoked.length, 2); assert.equal(new Set(revoked).size, 2);
  assert.equal(await ensureImageReferenceOriginal(record), '');
});

function imageNode(src) {
  return { src, handlers: {}, addEventListener(name, handler) { this.handlers[name] = handler; } };
}
test('thumbnail display error loads the original lazily; a second failure does not loop', async () => {
  const h = folder(); const record = { imagePath: 'original.jpg' }; let missing = false;
  try {
    await hydrateImageReference(record, h.directory, { preferThumbnail: true });
    const image = imageNode(record.imageThumbnailSrc);
    bindImageReference(image, record, { onUnavailable: () => { missing = true; } });
    image.handlers.error(); await ensureImageReferenceOriginal(record); await Promise.resolve();
    assert.equal(image.src, record.imagePreviewSrc);
    assert.deepEqual(h.reads, ['original.thumb.jpg', 'original.jpg']);
    image.handlers.error(); assert.equal(missing, true);
  } finally { clearImageReferenceObjectUrls(record); }
});
test('Detail binding upgrades a displayed thumbnail without revoking it', async () => {
  const h = folder(); const record = { imagePath: 'original.jpg' };
  try {
    await hydrateImageReference(record, h.directory, { preferThumbnail: true });
    const thumbnail = record.imageThumbnailSrc; const image = imageNode(thumbnail);
    bindImageReference(image, record, { fullQuality: true });
    await ensureImageReferenceOriginal(record); await Promise.resolve();
    assert.equal(image.src, record.imagePreviewSrc);
    assert.equal(record.imageThumbnailSrc, thumbnail);
    assert.equal(await (await fetch(thumbnail)).text(), 'thumb');
  } finally { clearImageReferenceObjectUrls(record); }
});

test('actual Library initialization opts into thumbnails; Edit and cover-sheet paths request originals', async () => {
  const read = name => readFile(new URL(name, import.meta.url), 'utf8');
  const [paper, cards, stamps, add, cover] = await Promise.all(['library.js', 'cards.js', 'stamp-die-library.js', 'add-dsp.js', 'cover-sheet.js'].map(read));
  assert.match(paper, /await hydratePaperPackImageSources\(paperPacks, \{ preferThumbnail: true \}\)/);
  assert.match(cards, /await hydrateCardImageSources\(savedCards, \{ preferThumbnail: true \}\)/);
  assert.match(stamps, /await storage.hydrateStampImages\(records, \{\}, \{ preferThumbnail: true \}\)/);
  assert.match(cards, /ensureImageReferenceOriginal\(card\)\.then/);
  assert.match(stamps, /await storage.hydrateStampImages\(\[record\]\)/);
  for (const code of [add, cover]) assert.match(code, /\.map\(ensureImageReferenceOriginal\)/);
});

test('cleanup also invalidates a pending thumbnail read', async t => {
  const record = { imagePath: 'original.jpg' }; let release; let created = 0;
  t.mock.method(URL, 'createObjectURL', () => { created++; return 'blob:late'; });
  const pending = hydrateImageReference(record, {}, { preferThumbnail: true, loadThumbnail: () => new Promise(resolve => { release = resolve; }), loadOriginal: () => assert.fail('No late original fallback') });
  clearImageReferenceObjectUrls(record); release(new Blob(['thumbnail'])); await pending;
  assert.equal(created, 0); assert.equal(record.imageThumbnailSrc, undefined);
});

test('relative image URLs cannot cause a fallback retry loop', () => {
  let src = 'https://catalog.test/thumb.jpg'; let attempts = 0; let unavailable = 0;
  const image = imageNode(src);
  Object.defineProperty(image, 'src', { get: () => src, set: value => { src = new URL(value, 'https://catalog.test/').href; attempts++; } });
  bindImageReference(image, { imageSrc: 'original.jpg', thumbnailImageSrc: 'thumb.jpg' }, { onUnavailable: () => unavailable++ });
  for (let i = 0; i < 5; i++) image.handlers.error();
  assert.ok(attempts <= 2); assert.ok(unavailable > 0);
});

test('Paper/Card/Stamp Detail renderers upgrade thumbnail-only records through the shared loader', async () => {
  const vm = await import('node:vm');
  const { orderStampDieImages } = await import('./stamp-die-image-tags.js');
  const sources = await Promise.all(['library.js', 'cards.js', 'stamp-die-library.js'].map(name => readFile(new URL(name, import.meta.url), 'utf8')));
  const node = tag => ({ tag, children: [], dataset: {}, handlers: {}, append(...children) { this.children.push(...children); }, setAttribute() {}, addEventListener(name, fn) { this.handlers[name] = fn; } });
  const context = vm.createContext({ document: { createElement: node }, bindImageReference, getPatternImageSource, getPaperLibraryImageSource,
    getPatternPreviewClassName: () => 'pattern-image', orderStampDieImages, getStampDetailImageSource, getStampLibraryImageSource });
  const extract = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  vm.runInContext(extract(sources[0], 'function createPatternPreview(', 'function getPatternPreviewClassName('), context);
  vm.runInContext(extract(sources[1], 'function createCardImage(', 'function getCardPlaceholderNumber('), context);
  vm.runInContext(extract(sources[2], 'function createSetImageGrid(', 'function createSetDetailView('), context);
  const makers = [
    record => context.createPatternPreview(record, 0, {}).children[0],
    record => context.createCardImage(record, 'card-detail-image', getCardDetailImageSource(record)),
    record => context.createSetImageGrid([record], true).children[0].children[0]
  ];
  for (const make of makers) {
    const h = folder(); const record = { imagePath: 'original.jpg', size: { width: 4, height: 6 } };
    try {
      await hydrateImageReference(record, h.directory, { preferThumbnail: true });
      const image = make(record); assert.equal(image.src, record.imageThumbnailSrc);
      await ensureImageReferenceOriginal(record); await Promise.resolve();
      assert.equal(image.src, record.imagePreviewSrc);
      assert.deepEqual(h.reads, ['original.thumb.jpg', 'original.jpg']);
    } finally { clearImageReferenceObjectUrls(record); }
  }
});
