import { generateImageThumbnail } from './thumbnails.js';

const LOCAL_FOLDER_IMAGE_STORAGE_STRATEGY = 'local-folder';
const EMBEDDED_IMAGE_STORAGE_STRATEGY = 'embedded-indexed-db';

export async function prepareFolderBackedImage(record, selectedImage, rootDirectory, { imageLibrary, thumbnail = generateImageThumbnail } = {}) {
  const recordWithoutImage = removeStoredImageFields(record);
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
    await writeFile(directory, thumbnailName, await thumbnail(selectedImage.file));
  }

  return {
    ...recordWithoutImage,
    imageName,
    imagePath,
    thumbnailImagePath: thumbnailPath,
    imageLibrary,
    imageStorageStrategy: LOCAL_FOLDER_IMAGE_STORAGE_STRATEGY
  };
}

export async function prepareEmbeddedImage(record, imageFile, { thumbnail = generateImageThumbnail, encode = blobToDataUrl, allowMissingThumbnail = false } = {}) {
  const recordWithoutImage = removeStoredImageFields(record);
  let thumbnailBlob;
  try { thumbnailBlob = await thumbnail(imageFile); }
  catch (error) { if (!allowMissingThumbnail) throw error; }

  return {
    ...recordWithoutImage,
    imageName: imageFile.name,
    imageSrc: await encode(imageFile),
    ...(thumbnailBlob ? { thumbnailImageSrc: await encode(thumbnailBlob) } : {}),
    imageStorageStrategy: EMBEDDED_IMAGE_STORAGE_STRATEGY
  };
}

export function removeStoredImageFields(record) {
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
    ...recordWithoutImage
  } = record;

  return recordWithoutImage;
}

// Runtime-only state: never persisted with catalog records.
const imageLoads = new WeakMap();

export async function hydrateImageReference(record, rootDirectory, options = {}) {
  clearImageReferenceObjectUrls(record);
  const state = {
    loadOriginal: options.loadOriginal || (() => getFileFromRelativePath(rootDirectory, record.imagePath)),
    pending: null, active: true, urls: new Set(), originalSrc: ''
  };
  imageLoads.set(record, state);
  if (!options.preferThumbnail) await ensureImageReferenceOriginal(record);
  try {
    const thumbnailPath = record.thumbnailImagePath || createThumbnailImageFileName(record.imagePath);
    const file = await (options.loadThumbnail
      ? options.loadThumbnail() : getFileFromRelativePath(rootDirectory, thumbnailPath));
    if (!state.active || imageLoads.get(record) !== state) return;
    if (file.size > 0) setImageUrl(record, 'imageThumbnailSrc', file, options.enumerableThumbnail !== false);
  } catch { /* Missing thumbnails retain the original fallback. */ }
  if (imageLoads.get(record) === state && options.preferThumbnail &&
      !record.imageThumbnailSrc && !record.thumbnailImageSrc) await ensureImageReferenceOriginal(record);
}

function setImageUrl(record, property, file, enumerable = true) {
  Object.defineProperty(record, property, {
    configurable: true, writable: true, enumerable, value: URL.createObjectURL(file)
  });
  imageLoads.get(record)?.urls.add(record[property]);
}

export function inheritImageReferenceState(source, target) {
  const state = imageLoads.get(source);
  if (state) imageLoads.set(target, state);
}

export async function ensureImageReferenceOriginal(record) {
  if (!record || typeof record !== 'object') return '';
  const state = imageLoads.get(record);
  if (state && !state.active) return '';
  if (record.imagePreviewSrc || record.imageSrc) return record.imagePreviewSrc || record.imageSrc;
  if (state?.originalSrc) return record.imagePreviewSrc = state.originalSrc;
  if (!state) return '';
  if (!state.pending) {
    state.pending = (async () => {
      try {
        const file = await state.loadOriginal();
        // A refreshed/released record must not acquire a late URL.
        if (!state.active || imageLoads.get(record) !== state) return '';
        setImageUrl(record, 'imagePreviewSrc', file);
        state.originalSrc = record.imagePreviewSrc;
        return state.originalSrc;
      } catch { return ''; }
      finally { state.pending = null; }
    })();
  }
  const source = await state.pending;
  if (!state.active || imageLoads.get(record) !== state) return '';
  if (source) record.imagePreviewSrc = source;
  return source;
}

// Detail upgrades in place; a broken thumbnail can request its original on demand.
export function bindImageReference(image, record, { fullQuality = false, onUnavailable = () => {} } = {}) {
  const failed = new Set();
  const attempted = new Set();
  const state = imageLoads.get(record);
  const use = source => {
    if (state && (!state.active || imageLoads.get(record) !== state)) return false;
    if (source && !failed.has(source) && !attempted.has(source)) {
      attempted.add(source); image.src = source; return true;
    }
    return false;
  };
  image.addEventListener('error', () => {
    failed.add(image.src);
    const original = record.imagePreviewSrc || record.imageSrc;
    const thumbnail = record.imageThumbnailSrc || record.thumbnailImageSrc;
    if (original) {
      if (!use(original) && !use(thumbnail)) onUnavailable();
    } else {
      ensureImageReferenceOriginal(record).then(source => {
        if (!use(source) && !use(thumbnail)) onUnavailable();
      });
    }
  });
  if (fullQuality && !record.imagePreviewSrc && !record.imageSrc) {
    ensureImageReferenceOriginal(record).then(source => { if (source) use(source); });
  }
}

export function clearImageReferenceObjectUrls(record) {
  const state = imageLoads.get(record);
  if (state) state.active = false;
  const urls = new Set(state?.urls);
  imageLoads.delete(record);
  for (const property of ['imagePreviewSrc', 'imageThumbnailSrc']) {
    if (record[property]?.startsWith('blob:')) {
      urls.add(record[property]);
    }

    delete record[property];
  }
  urls.forEach(url => URL.revokeObjectURL(url));
}

export async function hasDirectoryPermission(directoryHandle, mode, requestPermission = true) {
  if (!directoryHandle?.queryPermission) {
    return false;
  }

  try {
    const permission = { mode };

    if ((await directoryHandle.queryPermission(permission)) === 'granted') {
      return true;
    }

    return requestPermission && directoryHandle.requestPermission &&
      (await directoryHandle.requestPermission(permission)) === 'granted';
  } catch (error) {
    return false;
  }
}

export async function getFileFromRelativePath(rootDirectory, imagePath) {
  const pathParts = String(imagePath || '').split('/').filter(Boolean);
  const fileName = pathParts.pop();
  let directory = rootDirectory;

  for (const directoryName of pathParts) {
    directory = await directory.getDirectoryHandle(directoryName);
  }

  return await (await directory.getFileHandle(fileName)).getFile();
}

export async function getDirectoryFromRelativePath(rootDirectory, imagePath) {
  const pathParts = String(imagePath || '').split('/').filter(Boolean);
  pathParts.pop();
  let directory = rootDirectory;

  for (const directoryName of pathParts) {
    directory = await directory.getDirectoryHandle(directoryName);
  }

  return { directory, directoryPath: pathParts.join('/') };
}

export async function writeFile(directory, fileName, contents) {
  if (await fileExists(directory, fileName)) throw new Error('An existing image file must not be overwritten.');
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();

  await writable.write(contents);
  await writable.close();
}

export async function fileExists(directory, fileName) {
  try {
    await directory.getFileHandle(fileName);
    return true;
  } catch (error) {
    if (error?.name === 'NotFoundError') return false;
    throw error;
  }
}

export async function createAvailableImageFileName(directory, requestedName) {
  const normalizedName = String(requestedName || 'record-image.jpg');

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

export function createThumbnailImageFileName(imageName) {
  return `${imageName.replace(/\.[^.]+$/, '')}.thumb.jpg`;
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}
