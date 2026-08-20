import { loadCatalogSetting } from './storage.js';
import { generateImageThumbnail } from './thumbnails.js';
import { isUsableThumbnailFile, runTasksWithConcurrency } from './images.js';

const IMAGE_LIBRARY_SETTING_ID = 'imageLibrary';
const CARD_IMAGE_LIBRARY_SETTING_ID = 'cardImageLibrary';
const CARD_IMAGE_LIBRARY_MARKER = 'card-images';
const LOCAL_FOLDER_IMAGE_STORAGE_STRATEGY = 'local-folder';
const EMBEDDED_IMAGE_STORAGE_STRATEGY = 'embedded-indexed-db';
const THUMBNAIL_GENERATION_CONCURRENCY = 4;

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
        await writeFile(directory, thumbnailName, await generateImageThumbnail(sourceImage));

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
  if (!("showOpenFilePicker" in window)) {
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

export async function prepareCardImageForSave(card, selectedImage) {
  if (!selectedImage?.file) {
    return { card, usedFallback: false };
  }

  const directoryHandle = await getDirectoryHandle(CARD_IMAGE_LIBRARY_SETTING_ID, 'readwrite');

  if (!directoryHandle) {
    return {
      card: await prepareEmbeddedCardImage(card, selectedImage.file),
      usedFallback: true
    };
  }

  try {
    return {
      card: await prepareFolderBackedCardImage(card, selectedImage, directoryHandle),
      usedFallback: false
    };
  } catch (error) {
    return {
      card: await prepareEmbeddedCardImage(card, selectedImage.file),
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

async function prepareFolderBackedCardImage(card, selectedImage, rootDirectory) {
  const cardWithoutImage = removeStoredCardImageFields(card);
  const imageName = selectedImage.imagePath
    ? selectedImage.file.name
    : await createAvailableImageFileName(rootDirectory, selectedImage.file.name);
  const thumbnailName = createThumbnailImageFileName(imageName);
  const { directory, directoryPath } = selectedImage.imagePath
    ? await getDirectoryFromRelativePath(rootDirectory, selectedImage.imagePath)
    : { directory: rootDirectory, directoryPath: '' };
  const imagePath = selectedImage.imagePath || imageName;
  const thumbnailPath = directoryPath ? `${directoryPath}/${thumbnailName}` : thumbnailName;

  if (!selectedImage.imagePath) {
    await writeFile(directory, imageName, selectedImage.file);
  }

  if (!(await fileExists(directory, thumbnailName))) {
    await writeFile(directory, thumbnailName, await generateImageThumbnail(selectedImage.file));
  }

  return {
    ...cardWithoutImage,
    imageName,
    imagePath,
    thumbnailImagePath: thumbnailPath,
    imageLibrary: CARD_IMAGE_LIBRARY_MARKER,
    imageStorageStrategy: LOCAL_FOLDER_IMAGE_STORAGE_STRATEGY
  };
}

async function prepareEmbeddedCardImage(card, imageFile) {
  const cardWithoutImage = removeStoredCardImageFields(card);
  const thumbnail = await generateImageThumbnail(imageFile);

  return {
    ...cardWithoutImage,
    imageName: imageFile.name,
    imageSrc: await blobToDataUrl(imageFile),
    thumbnailImageSrc: await blobToDataUrl(thumbnail),
    imageStorageStrategy: EMBEDDED_IMAGE_STORAGE_STRATEGY
  };
}

function removeStoredCardImageFields(card) {
  const {
    imageName,
    imagePath,
    thumbnailImagePath,
    imageLibrary,
    imageStorageStrategy,
    imageSrc,
    thumbnailImageSrc,
    imagePreviewSrc,
    imageThumbnailSrc,
    ...cardWithoutImage
  } = card;

  return cardWithoutImage;
}

async function hydrateCardImageSource(card, rootDirectory) {
  clearCardImageObjectUrls(card);

  try {
    const imageFile = await getFileFromRelativePath(rootDirectory, card.imagePath);
    card.imagePreviewSrc = URL.createObjectURL(imageFile);
  } catch (error) {
    // The no-image placeholder remains visible when the original cannot be read.
  }

  try {
    const thumbnailFile = await getFileFromRelativePath(rootDirectory, card.thumbnailImagePath);
    card.imageThumbnailSrc = URL.createObjectURL(thumbnailFile);
  } catch (error) {
    // The full-resolution image remains the display fallback.
  }
}

function clearCardImageObjectUrls(card) {
  for (const property of ['imagePreviewSrc', 'imageThumbnailSrc']) {
    if (card[property]?.startsWith('blob:')) {
      URL.revokeObjectURL(card[property]);
    }

    delete card[property];
  }
}

async function getDirectoryHandle(settingId, mode) {
  const imageLibrary = await loadCatalogSetting(settingId);
  const directoryHandle = imageLibrary?.directoryHandle;

  if (!directoryHandle || !(await hasDirectoryPermission(directoryHandle, mode))) {
    return null;
  }

  return directoryHandle;
}

async function hasDirectoryPermission(directoryHandle, mode) {
  if (!directoryHandle?.queryPermission) {
    return false;
  }

  try {
    const permission = { mode };

    if ((await directoryHandle.queryPermission(permission)) === 'granted') {
      return true;
    }

    return directoryHandle.requestPermission &&
      (await directoryHandle.requestPermission(permission)) === 'granted';
  } catch (error) {
    return false;
  }
}

async function getFileFromRelativePath(rootDirectory, imagePath) {
  const pathParts = String(imagePath || '').split('/').filter(Boolean);
  const fileName = pathParts.pop();
  let directory = rootDirectory;

  for (const directoryName of pathParts) {
    directory = await directory.getDirectoryHandle(directoryName);
  }

  return await (await directory.getFileHandle(fileName)).getFile();
}

async function getDirectoryFromRelativePath(rootDirectory, imagePath) {
  const pathParts = String(imagePath || '').split('/').filter(Boolean);
  pathParts.pop();
  let directory = rootDirectory;

  for (const directoryName of pathParts) {
    directory = await directory.getDirectoryHandle(directoryName);
  }

  return { directory, directoryPath: pathParts.join('/') };
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

async function writeFile(directory, fileName, contents) {
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();

  await writable.write(contents);
  await writable.close();
}

async function fileExists(directory, fileName) {
  try {
    await directory.getFileHandle(fileName);
    return true;
  } catch (error) {
    return false;
  }
}

async function createAvailableImageFileName(directory, requestedName) {
  const normalizedName = String(requestedName || 'card-image.jpg');

  if (!(await fileExists(directory, normalizedName)) &&
      !(await fileExists(directory, createThumbnailImageFileName(normalizedName)))) {
    return normalizedName;
  }

  const extensionMatch = normalizedName.match(/(\.[^.]+)$/);
  const extension = extensionMatch?.[1] || '';
  const baseName = extension ? normalizedName.slice(0, -extension.length) : normalizedName;
  let suffix = 2;
  let candidateName = `${baseName}-${suffix}${extension}`;

  while (await fileExists(directory, candidateName) ||
         await fileExists(directory, createThumbnailImageFileName(candidateName))) {
    suffix += 1;
    candidateName = `${baseName}-${suffix}${extension}`;
  }

  return candidateName;
}

function createThumbnailImageFileName(imageName) {
  return `${imageName.replace(/\.[^.]+$/, '')}.thumb.jpg`;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}
