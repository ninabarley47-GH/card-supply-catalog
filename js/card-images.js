import {
  prepareFolderBackedImage, prepareEmbeddedImage as prepareEmbeddedCardImage,
  hydrateImageReference as hydrateCardImageSource, hasDirectoryPermission,
  getFileFromRelativePath, getDirectoryFromRelativePath, createThumbnailImageFileName
} from './image-references.js';
import { loadCatalogSetting } from './storage.js';
import { generateImageThumbnail } from './thumbnails.js';
import { isUsableThumbnailFile, runTasksWithConcurrency } from './images.js';
import { supportsOpenFilePicker, supportsOrdinaryImageFileFallback } from './browser-capabilities.js';

const IMAGE_LIBRARY_SETTING_ID = 'imageLibrary';
const CARD_IMAGE_LIBRARY_SETTING_ID = 'cardImageLibrary';
const CARD_IMAGE_LIBRARY_MARKER = 'card-images';
const THUMBNAIL_GENERATION_CONCURRENCY = 4;
const SUPPORTED_CARD_IMAGE_FILE_PATTERN = /\.(?:jpe?g|png|webp|gif)$/i;
const SUPPORTED_CARD_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
]);

export function getCardImageSelectionMode(environment = globalThis) {
  if (supportsOpenFilePicker(environment)) return 'open-file-picker';
  if (supportsOrdinaryImageFileFallback(environment)) return 'standard-file-input';
  return 'unavailable';
}

export function createCardImageFromFile(file, environment = globalThis) {
  if (!file || (!SUPPORTED_CARD_IMAGE_MIME_TYPES.has(file.type) && !SUPPORTED_CARD_IMAGE_FILE_PATTERN.test(file.name || ''))) {
    return Promise.resolve({ ok: false, image: null, message: 'Choose a supported Card image file.' });
  }

  return new Promise((resolve) => {
    const reader = new environment.FileReader();
    reader.addEventListener('load', () => resolve({
      ok: true,
      image: {
        file,
        name: file.name,
        imagePath: '',
        previewSrc: reader.result,
        imageSelectionStrategy: 'standard-file-input'
      },
      message: ''
    }));
    reader.addEventListener('error', () => resolve({
      ok: false,
      image: null,
      message: 'The Card image could not be selected.'
    }));
    reader.readAsDataURL(file);
  });
}

export function getReferencedCardImagePaths(cards = []) {
  return new Set(getReferencedCardImageEntries(cards).keys());
}

export async function generateMissingCardImageThumbnails(cards = []) {
  const rootDirectory = await getDirectoryHandle(CARD_IMAGE_LIBRARY_SETTING_ID, 'readwrite');
  const summary = {
    imagesScanned: 0,
    thumbnailsCreated: 0,
    thumbnailsRepaired: 0,
    thumbnailsSkipped: 0,
    errors: []
  };

  if (!rootDirectory) {
    return { ok: false, summary };
  }

  const jobs = [];

  for (const imagePath of getReferencedCardImageEntries(cards).values()) {
    summary.imagesScanned += 1;
    jobs.push(async () => {
      try {
        const { directory } = await getDirectoryFromRelativePath(rootDirectory, imagePath);
        const imageName = String(imagePath).replace(/\\/g, '/').split('/').filter(Boolean).pop();
        const thumbnailName = createThumbnailImageFileName(imageName);
        let existingThumbnailHandle = null;

        try {
          existingThumbnailHandle = await directory.getFileHandle(thumbnailName);
        } catch (error) {
          // Missing thumbnails are created below.
        }

        if (existingThumbnailHandle && await isUsableThumbnailFile(existingThumbnailHandle)) {
          summary.thumbnailsSkipped += 1;
          return;
        }

        const sourceImage = await (await directory.getFileHandle(imageName)).getFile();
        await repairCardThumbnail(directory, thumbnailName, await generateImageThumbnail(sourceImage));

        if (existingThumbnailHandle) {
          summary.thumbnailsRepaired += 1;
        } else {
          summary.thumbnailsCreated += 1;
        }
      } catch (error) {
        summary.errors.push(imagePath);
      }
    });
  }

  await runTasksWithConcurrency(jobs, THUMBNAIL_GENERATION_CONCURRENCY);
  return { ok: true, summary };
}

export async function checkCardImageLibraryHealth(cards = []) {
  const directoryHandle = await getDirectoryHandle(CARD_IMAGE_LIBRARY_SETTING_ID, 'read');
  const summary = {
    folderName: directoryHandle?.name || '',
    cardsChecked: cards.length,
    folderImages: 0,
    imagesFound: 0,
    imagesMissing: 0,
    embeddedImages: 0,
    missingImages: []
  };

  for (const card of cards) {
    if (card?.imageLibrary === CARD_IMAGE_LIBRARY_MARKER && card.imagePath) {
      summary.folderImages += 1;

      if (!directoryHandle) {
        summary.imagesMissing += 1;
        summary.missingImages.push(createMissingCardImageEntry(card));
        continue;
      }

      try {
        await getFileFromRelativePath(directoryHandle, card.imagePath);
        summary.imagesFound += 1;
      } catch (error) {
        summary.imagesMissing += 1;
        summary.missingImages.push(createMissingCardImageEntry(card));
      }
    } else if (card?.imageSrc) {
      summary.embeddedImages += 1;
    }
  }

  return {
    ok: Boolean(directoryHandle) || summary.folderImages === 0,
    needsFolder: !directoryHandle && summary.folderImages > 0,
    summary
  };
}

function createMissingCardImageEntry(card) {
  return {
    cardId: card.id,
    cardLabel: card.dateCreated ? `Card created ${card.dateCreated}` : card.id || 'Untitled Card',
    imagePath: card.imagePath
  };
}

function getReferencedCardImageEntries(cards) {
  const entries = new Map();

  for (const card of cards) {
    if (card?.imageLibrary !== CARD_IMAGE_LIBRARY_MARKER || !card.imagePath) {
      continue;
    }

    const normalizedPath = normalizeImagePath(card.imagePath);

    if (normalizedPath && !entries.has(normalizedPath)) {
      entries.set(normalizedPath, card.imagePath);
    }
  }

  return entries;
}

function normalizeImagePath(imagePath) {
  return String(imagePath || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/')
    .toLocaleLowerCase();
}

export async function chooseCardImageFromLibrary() {
  if (!supportsOpenFilePicker(window)) {
    return { ok: false, image: null, message: 'Choosing Card library images is not supported in this browser.' };
  }

  const directoryHandle = await getDirectoryHandle(CARD_IMAGE_LIBRARY_SETTING_ID, 'readwrite');

  if (!directoryHandle) {
    return { ok: false, image: null, message: 'Choose or reconnect the Card image folder first.' };
  }

  try {
    const [fileHandle] = await window.showOpenFilePicker({
      id: 'csc-card-image',
      multiple: false,
      startIn: directoryHandle,
      types: [{
        description: 'Card images',
        accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.gif'] }
      }]
    });
    const imagePath = await findRelativePathForFileHandle(directoryHandle, fileHandle);

    const file = await fileHandle.getFile();
    return {
      ok: true,
      image: { file, name: file.name, imagePath, previewSrc: URL.createObjectURL(file) },
      message: imagePath ? '' : 'This image will be copied into the Card image folder when the Card is saved.'
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { ok: true, image: null, message: '' };
    }

    return { ok: false, image: null, message: 'The Card image could not be selected.' };
  }
}

export function clearSelectedCardImage(selectedImage) {
  if (selectedImage?.previewSrc?.startsWith('blob:')) {
    URL.revokeObjectURL(selectedImage.previewSrc);
  }
}

export async function prepareCardImageForSave(card, selectedImage, services = {}) {
  if (!selectedImage?.file) {
    return { card, usedFallback: false };
  }

  const loadDirectoryHandle = services.getDirectoryHandle || getDirectoryHandle;
  const prepareEmbeddedImage = services.prepareEmbeddedCardImage || prepareEmbeddedCardImage;
  const prepareFolderImage = services.prepareFolderBackedCardImage || prepareFolderBackedCardImage;
  const directoryHandle = await loadDirectoryHandle(CARD_IMAGE_LIBRARY_SETTING_ID, 'readwrite');

  if (!directoryHandle) {
    return {
      card: await prepareEmbeddedImage(card, selectedImage.file),
      usedFallback: true
    };
  }

  try {
    return {
      card: await prepareFolderImage(card, selectedImage, directoryHandle),
      usedFallback: false
    };
  } catch (error) {
    return {
      card: await prepareEmbeddedImage(card, selectedImage.file),
      usedFallback: true
    };
  }
}

export async function hydrateCardImageSources(cards) {
  const folderBackedCards = cards.filter((card) => card.imagePath);

  if (folderBackedCards.length === 0) {
    return;
  }

  const [cardDirectoryHandle, legacyPaperDirectoryHandle] = await Promise.all([
    getDirectoryHandle(CARD_IMAGE_LIBRARY_SETTING_ID, 'read'),
    getDirectoryHandle(IMAGE_LIBRARY_SETTING_ID, 'read')
  ]);

  await Promise.all(folderBackedCards.map((card) => {
    const directoryHandle = card.imageLibrary === CARD_IMAGE_LIBRARY_MARKER
      ? cardDirectoryHandle
      : legacyPaperDirectoryHandle;

    return directoryHandle ? hydrateCardImageSource(card, directoryHandle) : null;
  }));
}

export function getCardLibraryImageSource(card) {
  return card.imageThumbnailSrc || card.thumbnailImageSrc || card.imagePreviewSrc || card.imageSrc || '';
}

export function getCardDetailImageSource(card) {
  return card.imagePreviewSrc || card.imageSrc || getCardLibraryImageSource(card);
}

async function getDirectoryHandle(settingId, mode) {
  const imageLibrary = await loadCatalogSetting(settingId);
  const directoryHandle = imageLibrary?.directoryHandle;

  if (!directoryHandle || !(await hasDirectoryPermission(directoryHandle, mode))) {
    return null;
  }

  return directoryHandle;
}

async function findRelativePathForFileHandle(directoryHandle, targetFileHandle, pathPrefix = '') {
  if (!directoryHandle.entries) {
    return '';
  }

  for await (const [entryName, entryHandle] of directoryHandle.entries()) {
    const entryPath = pathPrefix ? `${pathPrefix}/${entryName}` : entryName;

    if (entryHandle.kind === 'file' && entryHandle.isSameEntry && await entryHandle.isSameEntry(targetFileHandle)) {
      return entryPath;
    }

    if (entryHandle.kind === 'directory') {
      const nestedPath = await findRelativePathForFileHandle(entryHandle, targetFileHandle, entryPath);

      if (nestedPath) {
        return nestedPath;
      }
    }
  }

  return '';
}


async function prepareFolderBackedCardImage(card, selectedImage, directory) {
  return prepareFolderBackedImage(card, selectedImage, directory, { imageLibrary: CARD_IMAGE_LIBRARY_MARKER });
}

async function repairCardThumbnail(directory, name, contents) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(contents);
  await writable.close();
}
