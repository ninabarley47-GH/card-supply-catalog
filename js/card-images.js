import { loadCatalogSetting } from './storage.js';
import { generateImageThumbnail } from './thumbnails.js';

const IMAGE_LIBRARY_SETTING_ID = 'imageLibrary';
const CARDS_DIRECTORY_NAME = 'cards';
const LOCAL_FOLDER_IMAGE_STORAGE_STRATEGY = 'local-folder';
const EMBEDDED_IMAGE_STORAGE_STRATEGY = 'embedded-indexed-db';

export async function createSelectedCardImage(file) {
  if (!(file instanceof File) || !file.type.startsWith('image/')) {
    throw new TypeError('Choose a valid image file.');
  }

  return {
    file,
    name: file.name,
    previewSrc: URL.createObjectURL(file)
  };
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

  const directoryHandle = await getWritableImageLibraryDirectoryHandle();

  if (!directoryHandle) {
    return {
      card: await prepareEmbeddedCardImage(card, selectedImage.file),
      usedFallback: true
    };
  }

  try {
    return {
      card: await prepareFolderBackedCardImage(card, selectedImage.file, directoryHandle),
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

  const directoryHandle = await getReadableImageLibraryDirectoryHandle();

  if (!directoryHandle) {
    return;
  }

  await Promise.all(folderBackedCards.map((card) => hydrateCardImageSource(card, directoryHandle)));
}

export function getCardLibraryImageSource(card) {
  return card.imageThumbnailSrc || card.thumbnailImageSrc || card.imagePreviewSrc || card.imageSrc || '';
}

export function getCardDetailImageSource(card) {
  return card.imagePreviewSrc || card.imageSrc || getCardLibraryImageSource(card);
}

async function prepareFolderBackedCardImage(card, imageFile, rootDirectory) {
  const cardsDirectory = await rootDirectory.getDirectoryHandle(CARDS_DIRECTORY_NAME, { create: true });
  const cardDirectory = await cardsDirectory.getDirectoryHandle(card.id, { create: true });
  const imageName = createCardImageFileName(imageFile.name);
  const thumbnailName = createThumbnailImageFileName(imageName);

  await writeFile(cardDirectory, imageName, imageFile);
  await writeFile(cardDirectory, thumbnailName, await generateImageThumbnail(imageFile));

  return {
    ...card,
    imageName,
    imagePath: `${CARDS_DIRECTORY_NAME}/${card.id}/${imageName}`,
    thumbnailImagePath: `${CARDS_DIRECTORY_NAME}/${card.id}/${thumbnailName}`,
    imageStorageStrategy: LOCAL_FOLDER_IMAGE_STORAGE_STRATEGY
  };
}

async function prepareEmbeddedCardImage(card, imageFile) {
  const thumbnail = await generateImageThumbnail(imageFile);

  return {
    ...card,
    imageName: imageFile.name,
    imageSrc: await blobToDataUrl(imageFile),
    thumbnailImageSrc: await blobToDataUrl(thumbnail),
    imageStorageStrategy: EMBEDDED_IMAGE_STORAGE_STRATEGY
  };
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

async function getReadableImageLibraryDirectoryHandle() {
  const imageLibrary = await loadCatalogSetting(IMAGE_LIBRARY_SETTING_ID);
  const directoryHandle = imageLibrary?.directoryHandle;

  if (!directoryHandle || !(await hasDirectoryPermission(directoryHandle, 'read'))) {
    return null;
  }

  return directoryHandle;
}

async function getWritableImageLibraryDirectoryHandle() {
  const imageLibrary = await loadCatalogSetting(IMAGE_LIBRARY_SETTING_ID);
  const directoryHandle = imageLibrary?.directoryHandle;

  if (!directoryHandle || !(await hasDirectoryPermission(directoryHandle, 'readwrite'))) {
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

async function writeFile(directory, fileName, contents) {
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();

  await writable.write(contents);
  await writable.close();
}

function createCardImageFileName(originalName) {
  const extensionMatch = String(originalName || '').match(/\.(jpe?g|png|webp|gif)$/i);
  return `card${extensionMatch ? extensionMatch[0].toLowerCase() : '.jpg'}`;
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
