import { addCatalogSchemaVersion } from './schema.js';
import { validateItemTagAssignments } from './global-tag-catalog.js';

// References are metadata only. This module never reads or writes image files.
export function normalizeStampDieSet(record, catalog) {
  if (!record || typeof record.id !== 'string' || !record.id.trim() ||
      typeof record.name !== 'string' || !record.name.trim() ||
      typeof record.favorite !== 'boolean' ||
      !isCalendarDate(record.dateCreated) || !Array.isArray(record.imageRefs)) {
    throw new TypeError('Invalid Stamp & Die Set record.');
  }
  if (record.releaseYear !== undefined &&
      (!Number.isInteger(record.releaseYear) || record.releaseYear < 1990 || record.releaseYear > 2100)) {
    throw new TypeError('Release Year must be a whole year between 1990 and 2100.');
  }
  if (!validateItemTagAssignments({ catalog, productType: 'stamp', tagIds: record.tagIds }).ok) {
    throw new TypeError('Invalid Stamp & Die Set tagIds.');
  }
  return addCatalogSchemaVersion({
    id: record.id,
    name: record.name.trim(),
    imageRefs: record.imageRefs.map(normalizeImageReference),
    tagIds: [...record.tagIds],
    favorite: record.favorite,
    dateCreated: record.dateCreated,
    ...(record.releaseYear === undefined ? {} : { releaseYear: record.releaseYear })
  });
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeImageReference(reference) {
  if (!reference || typeof reference !== 'object') throw new TypeError('Invalid image reference.');
  const result = {};
  for (const field of ['imagePath', 'thumbnailImagePath']) {
    if (reference[field] === undefined) continue;
    if (!isRelativeImagePath(reference[field])) throw new TypeError(`Invalid ${field}.`);
    result[field] = reference[field];
  }
  for (const field of ['imageSrc', 'thumbnailImageSrc']) {
    if (reference[field] === undefined) continue;
    if (typeof reference[field] !== 'string' || !/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(reference[field])) {
      throw new TypeError(`Invalid persistent ${field}.`);
    }
    result[field] = reference[field];
  }
  if (!result.imagePath && !result.imageSrc) throw new TypeError('An image path or embedded image is required.');
  for (const field of ['imageName', 'imageLibrary']) {
    if (reference[field] === undefined) continue;
    if (typeof reference[field] !== 'string' || !reference[field].trim()) throw new TypeError(`Invalid ${field}.`);
    result[field] = reference[field];
  }
  if (reference.imageStorageStrategy !== undefined) {
    if (!['local-folder', 'embedded-indexed-db'].includes(reference.imageStorageStrategy)) throw new TypeError('Invalid image storage strategy.');
    if (reference.imageStorageStrategy === 'local-folder' && !result.imagePath) throw new TypeError('Folder images require a path.');
    if (reference.imageStorageStrategy === 'embedded-indexed-db' && !result.imageSrc) throw new TypeError('Embedded images require image data.');
    result.imageStorageStrategy = reference.imageStorageStrategy;
  }
  // Runtime previews, object URLs, and File/handle objects are intentionally omitted.
  return result;
}

function isRelativeImagePath(path) {
  return typeof path === 'string' && Boolean(path.trim()) && !/[\\:]/.test(path) &&
    path.split('/').every((part) => part && part !== '.' && part !== '..');
}
