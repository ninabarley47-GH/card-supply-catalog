import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCardImageFromFile,
  getCardImageSelectionMode,
  prepareCardImageForSave
} from './card-images.js';
import { normalizeCardForRuntime } from './storage.js';

const baseCard = {
  id: 'card-1',
  ownerId: 'owner-1',
  status: 'available',
  dateCreated: '2026-08-25',
  size: { preset: 'a2-portrait', width: 4.25, height: 5.5 },
  tags: [],
  stampSets: [],
  paperPackIds: [],
  colorIds: [],
  favorite: false
};

function createFallbackEnvironment(result = 'data:image/jpeg;base64,preview') {
  return {
    document: { createElement() {} },
    FileReader: class FileReader {
      addEventListener(type, listener) {
        this[type] = listener;
      }

      readAsDataURL() {
        this.result = result;
        this.load();
      }
    }
  };
}

function createEmbeddedServices() {
  return {
    getDirectoryHandle: async () => null,
    prepareEmbeddedCardImage: async (card, file) => ({
      ...card,
      imageName: file.name,
      imageSrc: `data:${file.type};base64,full`,
      thumbnailImageSrc: `data:${file.type};base64,thumbnail`,
      imageStorageStrategy: 'embedded-indexed-db'
    })
  };
}

test('folder-capable browsers retain the existing open-file picker path', () => {
  const environment = {
    ...createFallbackEnvironment(),
    showOpenFilePicker() {}
  };

  assert.equal(getCardImageSelectionMode(environment), 'open-file-picker');
});

test('unsupported picker browsers expose the standard file-input path', () => {
  assert.equal(getCardImageSelectionMode(createFallbackEnvironment()), 'standard-file-input');
  assert.equal(getCardImageSelectionMode({}), 'unavailable');
});

test('standard file selection creates the existing Card preview state', async () => {
  const file = { name: 'new-card.jpg', type: 'image/jpeg' };
  const result = await createCardImageFromFile(file, createFallbackEnvironment());

  assert.equal(result.ok, true);
  assert.equal(result.image.file, file);
  assert.equal(result.image.previewSrc, 'data:image/jpeg;base64,preview');
  assert.equal(result.image.imageSelectionStrategy, 'standard-file-input');
});

test('standard file selection rejects image types outside the existing Card picker list', async () => {
  const file = { name: 'vector.svg', type: 'image/svg+xml' };
  const result = await createCardImageFromFile(file, createFallbackEnvironment());

  assert.equal(result.ok, false);
  assert.equal(result.image, null);
});

test('Add Card fallback image saves without a Card folder', async () => {
  const file = { name: 'added-card.jpg', type: 'image/jpeg' };
  const result = await prepareCardImageForSave(baseCard, { file }, createEmbeddedServices());

  assert.equal(result.usedFallback, true);
  assert.equal(result.card.imageName, file.name);
  assert.equal(result.card.imageStorageStrategy, 'embedded-indexed-db');
  assert.match(result.card.imageSrc, /^data:image\/jpeg;base64,/);
});

test('Edit Card fallback image replaces the persisted embedded image', async () => {
  const existingCard = {
    ...baseCard,
    imageName: 'old-card.jpg',
    imageSrc: 'data:image/jpeg;base64,old',
    thumbnailImageSrc: 'data:image/jpeg;base64,old-thumbnail'
  };
  const file = { name: 'replacement.png', type: 'image/png' };
  const result = await prepareCardImageForSave(existingCard, { file }, createEmbeddedServices());

  assert.equal(result.card.id, existingCard.id);
  assert.equal(result.card.imageName, 'replacement.png');
  assert.equal(result.card.imageSrc, 'data:image/png;base64,full');
});

test('embedded fallback image fields survive persisted-data reload normalization', async () => {
  const file = { name: 'persistent-card.webp', type: 'image/webp' };
  const saved = await prepareCardImageForSave(baseCard, { file }, createEmbeddedServices());
  const reloaded = normalizeCardForRuntime(JSON.parse(JSON.stringify(saved.card)));

  assert.equal(reloaded.imageName, file.name);
  assert.equal(reloaded.imageSrc, 'data:image/webp;base64,full');
  assert.equal(reloaded.thumbnailImageSrc, 'data:image/webp;base64,thumbnail');
  assert.equal(reloaded.imageStorageStrategy, 'embedded-indexed-db');
});

test('folder-capable save keeps the existing folder preparation path', async () => {
  const directoryHandle = { name: 'Cards' };
  const file = { name: 'folder-card.gif', type: 'image/gif' };
  let embeddedCalled = false;
  const result = await prepareCardImageForSave(baseCard, { file, imagePath: 'folder-card.gif' }, {
    getDirectoryHandle: async () => directoryHandle,
    prepareFolderBackedCardImage: async (card) => ({
      ...card,
      imageName: file.name,
      imagePath: file.name,
      imageStorageStrategy: 'local-folder'
    }),
    prepareEmbeddedCardImage: async () => {
      embeddedCalled = true;
      return baseCard;
    }
  });

  assert.equal(result.usedFallback, false);
  assert.equal(result.card.imageStorageStrategy, 'local-folder');
  assert.equal(embeddedCalled, false);
});
