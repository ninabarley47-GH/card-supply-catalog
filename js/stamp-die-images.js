import { loadCatalogSetting, saveCatalogSetting } from './storage.js';
import { supportsOpenFilePicker, supportsDirectoryPicker } from './browser-capabilities.js';
import { createCardImageFromFile, clearSelectedCardImage, getCardLibraryImageSource } from './card-images.js';
import {
  prepareFolderBackedImage, prepareEmbeddedImage, hasDirectoryPermission,
  hydrateImageReference, clearImageReferenceObjectUrls
} from './image-references.js';

export const STAMP_IMAGE_LIBRARY_SETTING_ID = 'stampDieImageLibrary';
export const STAMP_IMAGE_LIBRARY_MARKER = 'stamp-die-images';

export async function loadStampImageDirectory(mode = 'read', requestPermission = false) {
  const setting = await loadCatalogSetting(STAMP_IMAGE_LIBRARY_SETTING_ID);
  const handle = setting?.directoryHandle;
  return await hasDirectoryPermission(handle, mode, requestPermission) ? handle : null;
}

export async function chooseStampImageDirectory(environment = globalThis) {
  if (!supportsDirectoryPicker(environment)) return null;
  const directoryHandle = await environment.showDirectoryPicker({ id: 'csc-stamp-images', mode: 'readwrite' });
  await saveCatalogSetting(STAMP_IMAGE_LIBRARY_SETTING_ID, { directoryHandle });
  return directoryHandle;
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

export function removeDraftStampImage(images, index) {
  const next = [...images];
  const [removed] = next.splice(index, 1);
  clearSelectedCardImage(removed);
  return next;
}

export function clearDraftStampImages(images) {
  images.forEach(clearSelectedCardImage);
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

export async function hydrateStampImages(records, services = {}) {
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
    if (directories.get(settingId)) await hydrate(ref, directories.get(settingId));
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
