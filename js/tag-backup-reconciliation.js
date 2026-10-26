import {
  createEmptyGlobalTagCatalog,
  findFuzzyDuplicateCandidates,
  getGlobalTagNameKey,
  migrateLegacyTagData,
  migrateGlobalTagCatalogSchema,
  validateGlobalTagCatalog,
  validateItemTagAssignments
} from "./global-tag-catalog.js";

export function reconcileBackupTagData({ localCatalog = createEmptyGlobalTagCatalog(), backup, overwriteExisting = false }) {
  if ([1, 2].includes(localCatalog?.schemaVersion)) localCatalog = migrateGlobalTagCatalogSchema(localCatalog);
  if ([1, 2].includes(backup?.tagCatalog?.schemaVersion)) {
    backup = { ...backup, tagCatalog: migrateGlobalTagCatalogSchema(backup.tagCatalog) };
  }
  assertCatalog(localCatalog, "local");
  if (backup?.tagCatalog && overwriteExisting) return replaceModern(localCatalog, backup);
  return backup?.tagCatalog
    ? reconcileModern(localCatalog, backup)
    : reconcileLegacy(localCatalog, backup);
}

function replaceModern(localCatalog, backup) {
  assertCatalog(backup.tagCatalog, "imported");
  assertRecordShape(backup.paperPacks || [], "keywords");
  assertRecordShape(backup.cards || [], "tags");
  assertRecordShape(backup.stampDieSets || [], "tags");
  const catalog = cloneCatalog(backup.tagCatalog);
  const byId = new Map(catalog.tags.map(tag => [tag.id, tag]));
  const byName = new Map(catalog.tags.map(tag => [getGlobalTagNameKey(tag.name), tag]));
  // Retained local products keep stable identities first, then exact-name matches.
  // A missing target explicitly removes that assignment; source records are untouched.
  const retainedTagIdMap = new Map(localCatalog.tags.map(tag => [
    tag.id, (byId.get(tag.id) || byName.get(getGlobalTagNameKey(tag.name)))?.id || null
  ]));
  const report = { ...createReport(), replaced: true,
    tagsRemoved: [...retainedTagIdMap.values()].filter(id => id === null).length,
    categoriesRemoved: localCatalog.categories.filter(category => !catalog.categories.some(
      target => target.id === category.id || getGlobalTagNameKey(target.name) === getGlobalTagNameKey(category.name)
    )).length
  };
  const result = finish(catalog, backup, new Map(catalog.tags.map(tag => [tag.id, tag.id])), report);
  return { ...result, retainedTagIdMap };
}

export function remapRetainedRecordTags(record, tagIdMap) {
  if (!Array.isArray(record.tagIds)) return record;
  const tagIds = [...new Set(record.tagIds.map(id => tagIdMap.get(id)).filter(Boolean))];
  if (tagIds.length === record.tagIds.length && tagIds.every((id, index) => id === record.tagIds[index])) return record;
  const next = { ...record, tagIds };
  delete next.keywords;
  delete next.tags;
  return next;
}

function reconcileModern(localCatalog, backup) {
  assertCatalog(backup.tagCatalog, "imported");
  assertRecordShape(backup.paperPacks || [], "keywords");
  assertRecordShape(backup.cards || [], "tags");
  assertRecordShape(backup.stampDieSets || [], "tags");
  const catalog = cloneCatalog(localCatalog);
  const report = createReport();
  const categoryIdMap = new Map();
  const localCategoriesById = new Map(catalog.categories.map((entry) => [entry.id, entry]));
  const localCategoriesByName = new Map(catalog.categories.map((entry) => [getGlobalTagNameKey(entry.name), entry]));

  for (const imported of backup.tagCatalog.categories) {
    const byId = localCategoriesById.get(imported.id);
    const byName = localCategoriesByName.get(getGlobalTagNameKey(imported.name));
    const target = byId || byName;
    if (target) {
      categoryIdMap.set(imported.id, target.id);
      if (!byId) report.categoryIdsRemapped += 1;
    } else {
      const added = { ...imported };
      catalog.categories.push(added);
      localCategoriesById.set(added.id, added);
      localCategoriesByName.set(getGlobalTagNameKey(added.name), added);
      categoryIdMap.set(imported.id, imported.id);
      report.categoriesAdded += 1;
    }
  }

  const tagIdMap = new Map();
  const localTagsById = new Map(catalog.tags.map((entry) => [entry.id, entry]));
  const localTagsByName = new Map(catalog.tags.map((entry) => [getGlobalTagNameKey(entry.name), entry]));
  const configurationConflicts = [];
  for (const imported of backup.tagCatalog.tags) {
    const remappedCategories = imported.categoryIds.map((id) => categoryIdMap.get(id));
    if (remappedCategories.some((id) => !id)) throw new TypeError("Imported tag references an unknown category.");
    const byId = localTagsById.get(imported.id);
    const byName = localTagsByName.get(getGlobalTagNameKey(imported.name));
    const target = byId || byName;
    if (target) {
      const differences = getTagConfigurationDifferences(target, imported);
      if (differences.length) {
        configurationConflicts.push({
          type: "tag-configuration",
          matchBy: byId ? "id" : "normalized-name",
          tagId: target.id,
          localName: target.name,
          importedName: imported.name,
          differences,
          message: formatTagConfigurationConflict(target, imported, byId ? "ID" : "normalized name", differences)
        });
        continue;
      }
      tagIdMap.set(imported.id, target.id);
      if (byId && getGlobalTagNameKey(byId.name) !== getGlobalTagNameKey(imported.name)) {
        report.localNamesRetained.push({ id: byId.id, localName: byId.name, importedName: imported.name });
      }
      if (!byId) { report.tagIdsRemapped += 1; report.exactNamesConsolidated += 1; }
      if (Array.isArray(imported.appliesTo)) {
        if (!Array.isArray(target.appliesTo)) target.appliesTo = [];
        report.applicabilityAdded += unionInto(target.appliesTo, imported.appliesTo);
      }
      report.categoryRelationshipsAdded += unionInto(target.categoryIds, remappedCategories);
    } else {
      const added = {
        ...imported,
        ...(Array.isArray(imported.appliesTo) ? { appliesTo: [...imported.appliesTo] } : {}),
        categoryIds: remappedCategories
      };
      catalog.tags.push(added);
      localTagsById.set(added.id, added);
      localTagsByName.set(getGlobalTagNameKey(added.name), added);
      tagIdMap.set(imported.id, imported.id);
      report.tagsAdded += 1;
    }
  }
  if (configurationConflicts.length) return { ok: false, conflicts: configurationConflicts, report };
  return finish(catalog, backup, tagIdMap, report);
}

function getTagConfigurationDifferences(local, imported) {
  return ["type", "filenameTerms", "unmatchedFilenameFallback"].flatMap((setting) => {
    const localPresent = Object.hasOwn(local, setting);
    const importedPresent = Object.hasOwn(imported, setting);
    const localValue = local[setting];
    const importedValue = imported[setting];
    const equalValue = Array.isArray(localValue) && Array.isArray(importedValue)
      ? localValue.length === importedValue.length && localValue.every((value, index) => value === importedValue[index])
      : Object.is(localValue, importedValue);
    if (localPresent === importedPresent && equalValue) return [];
    return [{ setting, localPresent, localValue, importedPresent, importedValue }];
  });
}

function formatTagConfigurationConflict(local, imported, matchDescription, differences) {
  const settings = differences.map(({ setting, localPresent, localValue, importedPresent, importedValue }) =>
    `${setting} (local: ${formatConfigValue(localPresent, localValue)}; backup: ${formatConfigValue(importedPresent, importedValue)})`
  ).join(", ");
  return `Tag configuration conflict for “${imported.name}” (matched by ${matchDescription}): ${settings}. Nothing was imported.`;
}

function formatConfigValue(present, value) {
  if (!present) return "not set";
  return Array.isArray(value) ? `[${value.join(", ")}]` : String(value);
}

function reconcileLegacy(localCatalog, backup) {
  assertLegacyRecordShape(backup.paperPacks || [], "keywords");
  assertLegacyRecordShape(backup.cards || [], "tags");
  const migrated = migrateLegacyTagData({
    paperVocabulary: backup.tagVocabularies?.paper || [],
    cardVocabulary: backup.tagVocabularies?.card || [],
    paperRecords: backup.paperPacks || [],
    cardRecords: backup.cards || []
  });
  const localById = new Map(localCatalog.tags.map((tag) => [tag.id, tag]));
  const localByName = new Map(localCatalog.tags.map((tag) => [getGlobalTagNameKey(tag.name), tag]));
  const conflicts = [];
  for (const imported of migrated.catalog.tags) {
    if (localByName.has(getGlobalTagNameKey(imported.name))) continue;
    const sameId = localById.get(imported.id);
    if (sameId) {
      conflicts.push({ type: "legacy-id-ambiguity", legacyName: imported.name, localTag: sameId });
      continue;
    }
    const fuzzy = findFuzzyDuplicateCandidates([imported.name, ...localCatalog.tags.map((tag) => tag.name)])
      .filter((candidate) => candidate.firstName === imported.name || candidate.secondName === imported.name);
    if (fuzzy.length) conflicts.push({ type: "legacy-fuzzy-match", legacyName: imported.name, candidates: fuzzy });
  }
  if (conflicts.length) return { ok: false, conflicts, report: { ...createReport(), legacyConversions: 1 } };
  const exactIdMap = new Map(migrated.catalog.tags.map((entry) => [
    entry.id,
    localByName.get(getGlobalTagNameKey(entry.name))?.id || entry.id
  ]));
  const legacyExactMatches = migrated.catalog.tags.filter((entry) => localByName.has(getGlobalTagNameKey(entry.name))).length;
  const legacyIdRemaps = migrated.catalog.tags.filter((entry) => exactIdMap.get(entry.id) !== entry.id).length;
  const syntheticBackup = {
    ...backup,
    tagCatalog: {
      ...migrated.catalog,
      tags: migrated.catalog.tags.map((entry) => ({ ...entry, id: exactIdMap.get(entry.id) }))
    },
    paperPacks: remapLegacyAssignments(backup.paperPacks || [], migrated.paperAssignments, "keywords", exactIdMap),
    cards: remapLegacyAssignments(backup.cards || [], migrated.cardAssignments, "tags", exactIdMap)
  };
  const result = reconcileModern(localCatalog, syntheticBackup);
  result.report.legacyConversions = 1;
  result.report.exactNamesConsolidated += legacyExactMatches;
  result.report.tagIdsRemapped += legacyIdRemaps;
  return result;
}

function finish(catalog, backup, tagIdMap, report) {
  assertCatalog(catalog, "reconciled");
  const paperPacks = remapRecords(backup.paperPacks || [], tagIdMap, "paper", catalog);
  const cards = remapRecords(backup.cards || [], tagIdMap, "card", catalog);
  const stampDieSets = remapRecords(backup.stampDieSets || [], tagIdMap, "stamp", catalog);
  return { ok: true, conflicts: [], catalog, paperPacks, cards, stampDieSets, report };
}

function remapRecords(records, tagIdMap, productType, catalog) {
  return records.map((record) => {
    const tagIds = (record.tagIds || []).map((id) => tagIdMap.get(id));
    if (tagIds.some((id) => !id)) throw new TypeError("Imported item references an unknown tag.");
    const normalized = { ...record, tagIds: [...new Set(tagIds)] };
    delete normalized.keywords;
    delete normalized.tags;
    const validation = validateItemTagAssignments({ catalog, productType, tagIds: normalized.tagIds });
    if (!validation.ok) throw new TypeError(`Imported ${productType} record has invalid tag assignments.`);
    return normalized;
  });
}

function applyAssignments(records, assignments, legacyField) {
  const byId = new Map(assignments.map((entry) => [entry.recordId, entry.tagIds]));
  return records.map((record) => { const next = { ...record, tagIds: byId.get(record.id) || [] }; delete next[legacyField]; return next; });
}

function remapLegacyAssignments(records, assignments, legacyField, idMap) {
  return applyAssignments(records, assignments, legacyField).map((record) => ({
    ...record,
    tagIds: record.tagIds.map((id) => idMap.get(id) || id)
  }));
}

function assertRecordShape(records, legacyField) {
  if (records.some((record) => !Array.isArray(record.tagIds) || legacyField in record)) throw new TypeError("Modern backup contains mixed or missing tag assignments.");
}

function assertLegacyRecordShape(records, legacyField) {
  if (records.some((record) => "tagIds" in record || !Array.isArray(record[legacyField]))) throw new TypeError("Legacy backup contains mixed or missing tag assignments.");
}

function assertCatalog(catalog, label) {
  if (!validateGlobalTagCatalog(catalog).ok) throw new TypeError(`The ${label} tag catalog is invalid.`);
}

function unionInto(target, values) {
  let added = 0;
  for (const value of values) if (!target.includes(value)) { target.push(value); added += 1; }
  return added;
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

function createReport() {
  return { tagsAdded: 0, categoriesAdded: 0, exactNamesConsolidated: 0, tagIdsRemapped: 0, categoryIdsRemapped: 0, localNamesRetained: [], applicabilityAdded: 0, categoryRelationshipsAdded: 0, legacyConversions: 0 };
}
