import {
  GLOBAL_TAG_CATALOG_SCHEMA_VERSION,
  createEmptyGlobalTagCatalog,
  migrateLegacyTagData,
  validateGlobalTagCatalog,
  validateItemTagAssignments
} from "./global-tag-catalog.js";

export const GLOBAL_TAG_CATALOG_SETTING_ID = "globalTagCatalog";
export const GLOBAL_TAG_MIGRATION_SETTING_ID = "globalTagMigrationVersion";
export const GLOBAL_TAG_MIGRATION_VERSION = 1;

export async function migrateGlobalTagPersistence({ readState, commitMigration }) {
  const state = await readState();
  if (state.migrationVersion === GLOBAL_TAG_MIGRATION_VERSION && !state.globalTagCatalog) {
    throw new TypeError("The global tag migration marker exists without a catalog.");
  }
  const existingCatalog = state.globalTagCatalog ?? createEmptyGlobalTagCatalog();
  const catalogValidation = validateGlobalTagCatalog(existingCatalog);
  if (!catalogValidation.ok) throw new TypeError("The persisted global tag catalog is invalid.");

  if (state.migrationVersion === GLOBAL_TAG_MIGRATION_VERSION) {
    return { migrated: false, catalog: cloneCatalog(existingCatalog), fuzzyDuplicateCandidates: [] };
  }

  const result = migrateLegacyTagData({
    catalog: existingCatalog,
    paperVocabulary: state.paperVocabulary || [],
    cardVocabulary: state.cardVocabulary || [],
    paperRecords: state.paperRecords || [],
    cardRecords: state.cardRecords || []
  });
  const paperAssignments = new Map(result.paperAssignments.map((entry) => [entry.recordId, entry.tagIds]));
  const cardAssignments = new Map(result.cardAssignments.map((entry) => [entry.recordId, entry.tagIds]));
  const paperRecords = (state.paperRecords || []).map((record) => toTagIdRecord(record, paperAssignments.get(record.id)));
  const cardRecords = (state.cardRecords || []).map((record) => toTagIdRecord(record, cardAssignments.get(record.id), "tags"));

  for (const record of paperRecords) assertAssignments(result.catalog, "paper", record);
  for (const record of cardRecords) assertAssignments(result.catalog, "card", record);

  await commitMigration({
    globalTagCatalog: result.catalog,
    migrationVersion: GLOBAL_TAG_MIGRATION_VERSION,
    paperRecords,
    cardRecords
  });

  return {
    migrated: true,
    catalog: cloneCatalog(result.catalog),
    fuzzyDuplicateCandidates: result.fuzzyDuplicateCandidates
  };
}

export function hydratePaperTagNames(record, catalog) {
  if (!Array.isArray(record?.tagIds)) return record;
  return { ...record, tagIds: [...record.tagIds], keywords: resolveTagNames(record.tagIds, catalog, "paper") };
}

export function hydrateCardTagNames(record, catalog) {
  if (!Array.isArray(record?.tagIds)) return record;
  return { ...record, tagIds: [...record.tagIds], tags: resolveTagNames(record.tagIds, catalog, "card") };
}

export function dehydratePaperTagNames(record, catalog) {
  return dehydrateTagNames(record, catalog, "paper", "keywords");
}

export function dehydrateCardTagNames(record, catalog) {
  return dehydrateTagNames(record, catalog, "card", "tags");
}

export function isCurrentGlobalTagCatalog(catalog) {
  return catalog?.schemaVersion === GLOBAL_TAG_CATALOG_SCHEMA_VERSION && validateGlobalTagCatalog(catalog).ok;
}

// Upgrade compatibility: a previously cached storage.js may import this while
// the service worker is replacing the application module graph. Current
// runtime code does not use it; legacy data migration still uses the same
// catalog migration implementation directly.
export function mergeLegacyVocabularyIntoGlobalCatalog(catalog, { paperVocabulary = [], cardVocabulary = [] } = {}) {
  return migrateLegacyTagData({ catalog, paperVocabulary, cardVocabulary }).catalog;
}

function toTagIdRecord(record, tagIds = [], legacyField = "keywords") {
  const migrated = { ...record, tagIds: [...tagIds] };
  delete migrated[legacyField];
  return migrated;
}

function assertAssignments(catalog, productType, record) {
  const validation = validateItemTagAssignments({ catalog, productType, tagIds: record.tagIds });
  if (!validation.ok) throw new TypeError(`Migration produced invalid ${productType} tag assignments for "${record.id}".`);
}

function resolveTagNames(tagIds, catalog, productType) {
  const validation = validateItemTagAssignments({ catalog, productType, tagIds });
  if (!validation.ok) throw new TypeError(`Cannot load invalid ${productType} tag assignments.`);
  const tagsById = new Map(catalog.tags.map((tag) => [tag.id, tag.name]));
  return tagIds.map((tagId) => tagsById.get(tagId));
}

function dehydrateTagNames(record, catalog, productType, legacyField) {
  if (!Array.isArray(record?.tagIds)) return record;
  const tagIds = [...new Set(record.tagIds)];
  const validation = validateItemTagAssignments({ catalog, productType, tagIds });
  if (!validation.ok) throw new TypeError(`Cannot persist invalid ${productType} tag assignments.`);
  const persistentRecord = { ...record, tagIds };
  delete persistentRecord[legacyField];
  return persistentRecord;
}

function cloneCatalog(catalog) {
  return {
    schemaVersion: catalog.schemaVersion,
    tags: catalog.tags.map((tag) => ({
      ...tag,
      ...(Array.isArray(tag.appliesTo) ? { appliesTo: [...tag.appliesTo] } : {}),
      categoryIds: [...tag.categoryIds]
    })),
    categories: catalog.categories.map((category) => ({ ...category }))
  };
}
