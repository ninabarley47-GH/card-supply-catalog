import { validateItemTagAssignments } from './global-tag-catalog.js';
import { addGlobalTag } from './global-tag-management.js';
import { getTagKey } from './tag-utils.js';

// Runs only for newly selected filenames, never for save, removal, or reload.
export function inferStampDieImageTags(catalog, tagIds, filenames) {
  if (!validateItemTagAssignments({ catalog, productType: 'stamp', tagIds }).ok) throw new TypeError('Invalid image inference assignments.');
  let nextCatalog = catalog;
  const selected = new Set(tagIds);
  const inferredTags = [];
  for (const name of new Set(filenames.map((filename) => /mask/i.test(filename) ? 'Mask' : /die/i.test(filename) ? 'Die' : 'Stamp'))) {
    let tag = nextCatalog.tags.find((entry) => getTagKey(entry.name) === getTagKey(name));
    if (!tag) {
      const added = addGlobalTag(nextCatalog, { name, allowFuzzy: true });
      if (!added.ok) throw new TypeError('The inferred tag could not be created.');
      nextCatalog = added.catalog;
      tag = added.tag;
    }
    selected.add(tag.id);
    inferredTags.push(tag);
  }
  return { catalog: nextCatalog, tagIds: [...selected], inferredTags };
}

// Reconcile only selected, not-yet-persisted inference tags into the current catalog.
// A manual removal stays removed. A concurrent exact-name creation reuses its ID.
export function reconcileStampDieImageTags(record, catalog, inferredTags = []) {
  let nextCatalog = catalog;
  const remaps = new Map();
  for (const tag of inferredTags) {
    if (!record.tagIds.includes(tag.id) || nextCatalog.tags.some((entry) => entry.id === tag.id)) continue;
    if (!['stamp', 'die', 'mask'].includes(getTagKey(tag.name))) throw new TypeError('Invalid image inference tag.');
    let current = nextCatalog.tags.find((entry) => getTagKey(entry.name) === getTagKey(tag.name));
    if (!current) {
      const added = addGlobalTag(nextCatalog, { name: tag.name, allowFuzzy: true, idFactory: () => tag.id });
      if (!added.ok) throw new TypeError('The inferred tag could not be saved.');
      nextCatalog = added.catalog;
      current = added.tag;
    }
    remaps.set(tag.id, current.id);
  }
  return { catalog: nextCatalog, record: { ...record, tagIds: [...new Set(record.tagIds.map((id) => remaps.get(id) || id))] } };
}
