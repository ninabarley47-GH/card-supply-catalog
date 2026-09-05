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

export async function hydrateImageReference(record, rootDirectory) {
  clearImageReferenceObjectUrls(record);

  try {
    const imageFile = await getFileFromRelativePath(rootDirectory, record.imagePath);
    record.imagePreviewSrc = URL.createObjectURL(imageFile);
  } catch (error) {
    // The no-image placeholder remains visible when the original cannot be read.
  }

  try {
    const thumbnailFile = await getFileFromRelativePath(rootDirectory, record.thumbnailImagePath);
    record.imageThumbnailSrc = URL.createObjectURL(thumbnailFile);
  } catch (error) {
    // The full-resolution image remains the display fallback.
  }
}

export function clearImageReferenceObjectUrls(record) {
  for (const property of ['imagePreviewSrc', 'imageThumbnailSrc']) {
    if (record[property]?.startsWith('blob:')) {
      URL.revokeObjectURL(record[property]);
    }

    delete record[property];
  }
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
