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
  if (!validateItemTagAssignments({ catalog, productType: 'stamp', tagIds: record.tagIds }).ok) {
    throw new TypeError('Invalid Stamp & Die Set tagIds.');
  }
  return addCatalogSchemaVersion({
    id: record.id,
    name: record.name.trim(),
    imageRefs: record.imageRefs.map(normalizeImageReference),
    tagIds: [...record.tagIds],
    favorite: record.favorite,
    dateCreated: record.dateCreated
  });
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeImageReference(reference) {
  if (!reference || typeof reference.imagePath !== 'string' ||
      !reference.imagePath.trim() || /[\\:]/.test(reference.imagePath) ||
      reference.imagePath.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError('Image references require a relative imagePath.');
  }
  const result = { imagePath: reference.imagePath };
  for (const field of ['imageName', 'imageLibrary']) {
    if (reference[field] === undefined) continue;
    if (typeof reference[field] !== 'string' || !reference[field].trim()) {
      throw new TypeError(`Invalid image reference ${field}.`);
    }
    result[field] = reference[field];
  }
  return result;
}
