import { loadCatalogSetting, saveCatalogSetting } from './storage.js';
import { supportsOpenFilePicker, supportsDirectoryPicker } from './browser-capabilities.js';
import { createCardImageFromFile, clearSelectedCardImage, getCardLibraryImageSource, getCardDetailImageSource } from './card-images.js';
import { findPaperPackImageDirectory, isSupportedImageFileName } from './images.js';
import { getTagKey } from './tag-utils.js';
import {
  prepareFolderBackedImage, prepareEmbeddedImage, hasDirectoryPermission,
  hydrateImageReference, clearImageReferenceObjectUrls, getFileFromRelativePath
} from './image-references.js';

export const STAMP_IMAGE_LIBRARY_SETTING_ID = 'stampDieImageLibrary';
export const STAMP_IMAGE_LIBRARY_MARKER = 'stamp-die-images';

export async function loadStampImageDirectory(mode = 'read', requestPermission = false, services = {}) {
  const setting = await (services.loadCatalogSetting || loadCatalogSetting)(STAMP_IMAGE_LIBRARY_SETTING_ID);
  const handle = setting?.directoryHandle;
  return await hasDirectoryPermission(handle, mode, requestPermission) ? handle : null;
}

export async function chooseStampImageDirectory(environment = globalThis, services = {}) {
  if (!supportsDirectoryPicker(environment)) return null;
  const directoryHandle = await environment.showDirectoryPicker({ id: 'csc-stamp-images', mode: 'readwrite' });
  await (services.saveCatalogSetting || saveCatalogSetting)(STAMP_IMAGE_LIBRARY_SETTING_ID, {
    strategy: 'local-folder', directoryHandle, selectedAt: new Date().toISOString()
  });
  return directoryHandle;
}

export async function checkStampImageLibraryHealth(records = [], services = {}) {
  const directory = await (services.loadDirectory || loadStampImageDirectory)('read', true);
  const summary = {
    folderName: directory?.name || '', setsChecked: records.length,
    folderImages: 0, imagesFound: 0, imagesMissing: 0, embeddedImages: 0, missingImages: []
  };
  for (const record of records) {
    for (const ref of record.imageRefs || []) {
      if (ref.imageLibrary === STAMP_IMAGE_LIBRARY_MARKER && ref.imagePath) {
        summary.folderImages++;
        try {
          if (!directory) throw new Error('Folder permission needed');
          await getFileFromRelativePath(directory, ref.imagePath);
          summary.imagesFound++;
        } catch {
          summary.imagesMissing++;
          summary.missingImages.push({ setLabel: record.name || 'Untitled Set', imagePath: ref.imagePath });
        }
      } else if (ref.imageSrc) summary.embeddedImages++;
    }
  }
  return { ok: Boolean(directory) || summary.folderImages === 0,
    needsFolder: !directory && summary.folderImages > 0, summary };
}

export async function selectStampImageFiles(files, environment = globalThis) {
  const selected = [];
  try {
    for (const file of files) {
      const result = await createCardImageFromFile(file, environment);
      if (!result.ok) throw new TypeError(`Could not select "${file.name}". Choose JPEG, PNG, WebP, or GIF images.`);
      selected.push(result.image);
    }
    return selected;
  } catch (error) {
    selected.forEach(clearSelectedCardImage);
    throw error;
  }
}

export async function chooseStampImages(environment = globalThis, directory = null) {
  if (!supportsOpenFilePicker(environment)) return null;
  // Invoke the picker before awaiting storage so the user gesture is retained.
  const handles = await environment.showOpenFilePicker({
    id: 'csc-stamp-images', multiple: true,
    ...(directory ? { startIn: directory } : {}),
    types: [{ description: 'Set images', accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.gif'] } }]
  });
  const images = await selectStampImageFiles(await Promise.all(handles.map((handle) => handle.getFile())), environment);
  return images.map((image, index) => ({ ...image, fileHandle: handles[index] }));
}

export async function loadStampImagesForSetName(name, environment = globalThis, services = {}) {
  if (!name.trim() || !supportsDirectoryPicker(environment)) return [];
  // Like Paper's name lookup, this user-triggered read may restore folder permission.
  const directory = await (services.loadDirectory || loadStampImageDirectory)('read', true);
  if (!directory) return [];
  const match = await findPaperPackImageDirectory(directory, name.trim());
  const source = match?.handle || directory;
  if (typeof source.entries !== 'function') return [];
  const nameKey = getTagKey(name);
  const handles = [];
  for await (const [filename, handle] of source.entries()) {
    if (handle.kind !== 'file' || !isSupportedImageFileName(filename)) continue;
    // Sets can use a flat library, as the existing manual save path does.
    // Match the complete Set name, optionally followed by an image type.
    const stem = getTagKey(filename.replace(/\.[^.]+$/, ''));
    const setStem = stem.replace(/[\s_-]+(?:stamps?|dies?|masks?)$/, '');
    if (match || stem === nameKey || setStem === nameKey) handles.push(handle);
  }
  handles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const images = await selectStampImageFiles(await Promise.all(handles.map(handle => handle.getFile())), environment);
  // Keep file handles so the existing save path references originals in this library.
  return images.map((image, index) => ({ ...image, fileHandle: handles[index] }));
}

export function removeDraftStampImage(images, index) {
  const next = [...images];
  const [removed] = next.splice(index, 1);
  clearDraftStampImages(removed ? [removed] : []);
  return next;
}

export function clearDraftStampImages(images) {
  for (const image of images) {
    if (image.existingReference) clearImageReferenceObjectUrls(image.existingReference);
    else clearSelectedCardImage(image);
  }
}

export async function prepareStampImagesForSave(images, services = {}) {
  if (!images.length) return { imageRefs: [], usedFallback: false };
  const loadDirectory = services.loadDirectory || loadStampImageDirectory;
  const folder = services.prepareFolder || prepareFolderBackedImage;
  const embedded = services.prepareEmbedded || prepareEmbeddedImage;
  let directory;
  try { directory = await loadDirectory('readwrite'); } catch { directory = null; }
  const imageRefs = [];
  let usedFallback = false;
  // Sequential writes preserve order and avoid collisions within a selection.
  for (const image of images) {
    // Existing references are catalog metadata, not files to copy or regenerate.
    if (image.existingReference) {
      imageRefs.push(image.existingReference);
      continue;
    }
    if (image.preparedReference && await sameDirectory(image.preparedDirectory, directory)) {
      imageRefs.push(image.preparedReference);
      usedFallback ||= image.preparedReference.imageStorageStrategy === 'embedded-indexed-db';
      continue;
    }
    let reference;
    if (directory) {
      try {
        const relative = image.fileHandle && directory.resolve ? await directory.resolve(image.fileHandle) : null;
        reference = await folder({}, { ...image, imagePath: relative?.join('/') || '' }, directory, {
          imageLibrary: STAMP_IMAGE_LIBRARY_MARKER
        });
      } catch { /* Keep the original in IndexedDB if the folder cannot be used. */ }
    }
    if (!reference) {
      reference = await embedded({}, image.file, { allowMissingThumbnail: true });
      usedFallback = true;
    }
    image.preparedReference = reference;
    image.preparedDirectory = directory;
    imageRefs.push(reference);
  }
  return { imageRefs, usedFallback };
}

export async function hydrateStampImages(records, services = {}, options = {}) {
  const loadDirectory = services.loadDirectory || loadStampImageDirectory;
  const hydrate = services.hydrate || hydrateImageReference;
  const references = records.flatMap((record) => record.imageRefs || []);
  if (!references.some((ref) => ref.imagePath)) return;
  const directories = new Map();
  for (const ref of references) {
    if (!ref.imagePath) continue;
    // Explicit library identity only: never accidentally route a Set through Cards.
    const settingId = ref.imageLibrary === STAMP_IMAGE_LIBRARY_MARKER ? STAMP_IMAGE_LIBRARY_SETTING_ID
      : ref.imageLibrary === 'card-images' ? 'cardImageLibrary'
      : !ref.imageLibrary || ref.imageLibrary === 'paper-images' ? 'imageLibrary' : null;
    if (!settingId) continue;
    if (!directories.has(settingId)) {
      let handle = null;
      try {
        if (settingId === STAMP_IMAGE_LIBRARY_SETTING_ID) handle = await loadDirectory('read');
        else {
          const setting = await loadCatalogSetting(settingId);
          if (await hasDirectoryPermission(setting?.directoryHandle, 'read', false)) handle = setting.directoryHandle;
        }
      } catch { /* Missing library leaves embedded data or a placeholder available. */ }
      directories.set(settingId, handle);
    }
    if (directories.get(settingId)) await hydrate(ref, directories.get(settingId), options);
  }
}

export function clearStampImageSources(records) {
  records.flatMap((record) => record.imageRefs || []).forEach(clearImageReferenceObjectUrls);
}

export const getStampLibraryImageSource = getCardLibraryImageSource;

async function sameDirectory(first, second) {
  if (first === second) return true;
  if (!first || !second || !first.isSameEntry) return false;
  try { return await first.isSameEntry(second); } catch { return false; }
}

export const getStampDetailImageSource = getCardDetailImageSource;
