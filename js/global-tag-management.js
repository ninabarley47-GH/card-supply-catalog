import {
  findFuzzyDuplicateCandidates,
  getGlobalTagNameKey,
  normalizeGlobalTagName,
  validateGlobalTagCatalog
} from "./global-tag-catalog.js";

export function getGlobalTagUsage(catalog, { paperRecords = [], cardRecords = [], stampRecords = [] } = {}) {
  const usage = new Map(catalog.tags.map((tag) => [tag.id, { paper: 0, card: 0, stamp: 0 }]));
  const idsByName = new Map(catalog.tags.map((tag) => [getGlobalTagNameKey(tag.name), tag.id]));
  for (const [productType, records] of [["paper", paperRecords], ["card", cardRecords], ["stamp", stampRecords]]) {
    for (const record of records) {
      const legacyNames = productType === "paper" ? record.keywords : productType === "card" ? record.tags : [];
      const recordTagIds = Array.isArray(record.tagIds)
        ? record.tagIds
        : (legacyNames || []).map((name) => idsByName.get(getGlobalTagNameKey(name))).filter(Boolean);
      for (const tagId of new Set(recordTagIds)) {
        if (usage.has(tagId)) usage.get(tagId)[productType] += 1;
      }
    }
  }
  return usage;
}

export function addGlobalTag(catalog, { name, allowFuzzy = false, idFactory = createOpaqueTagId }) {
  assertCatalog(catalog);
  const normalizedName = normalizeGlobalTagName(name);
  if (!normalizedName) return { ok: false, reason: "invalid-name" };
  const exact = catalog.tags.find((tag) => getGlobalTagNameKey(tag.name) === getGlobalTagNameKey(normalizedName));
  if (exact) return { ok: false, reason: "duplicate", existingTag: exact };
  const fuzzyCandidates = findFuzzyDuplicateCandidates([normalizedName, ...catalog.tags.map((tag) => tag.name)])
    .filter((candidate) => candidate.firstName === normalizedName || candidate.secondName === normalizedName)
    .map((candidate) => candidate.firstName === normalizedName ? candidate.secondName : candidate.firstName);
  if (fuzzyCandidates.length && !allowFuzzy) return { ok: false, reason: "fuzzy", fuzzyCandidates };
  const tag = { id: idFactory(), name: normalizedName, categoryIds: [] };
  const nextCatalog = cloneCatalog(catalog);
  nextCatalog.tags.push(tag);
  assertCatalog(nextCatalog);
  return { ok: true, catalog: nextCatalog, tag, fuzzyCandidates };
}

export function addGlobalCategory(catalog, { name, allowFuzzy = false, idFactory = createOpaqueCategoryId }) {
  assertCatalog(catalog);
  const normalizedName = normalizeGlobalTagName(name);
  if (!normalizedName) return { ok: false, reason: "invalid-name" };
  const exact = catalog.categories.find((category) => getGlobalTagNameKey(category.name) === getGlobalTagNameKey(normalizedName));
  if (exact) return { ok: false, reason: "duplicate", existingCategory: exact };
  const fuzzyCandidates = findFuzzyDuplicateCandidates([normalizedName, ...catalog.categories.map((category) => category.name)])
    .filter((candidate) => candidate.firstName === normalizedName || candidate.secondName === normalizedName)
    .map((candidate) => candidate.firstName === normalizedName ? candidate.secondName : candidate.firstName);
  if (fuzzyCandidates.length && !allowFuzzy) return { ok: false, reason: "fuzzy", fuzzyCandidates };
  const category = { id: idFactory(), name: normalizedName };
  const nextCatalog = cloneCatalog(catalog);
  nextCatalog.categories.push(category);
  assertCatalog(nextCatalog);
  return { ok: true, catalog: nextCatalog, category, fuzzyCandidates };
}

export function editGlobalCategory(catalog, categoryId, { name, allowFuzzy = false }) {
  assertCatalog(catalog);
  const current = catalog.categories.find((category) => category.id === categoryId);
  if (!current) return { ok: false, reason: "not-found" };
  const normalizedName = normalizeGlobalTagName(name);
  if (!normalizedName) return { ok: false, reason: "invalid-name" };
  const duplicate = catalog.categories.find((category) => category.id !== categoryId && getGlobalTagNameKey(category.name) === getGlobalTagNameKey(normalizedName));
  if (duplicate) return { ok: false, reason: "duplicate", existingCategory: duplicate };
  const fuzzyCandidates = findFuzzyDuplicateCandidates([
    normalizedName,
    ...catalog.categories.filter((category) => category.id !== categoryId).map((category) => category.name)
  ])
    .filter((candidate) => candidate.firstName === normalizedName || candidate.secondName === normalizedName)
    .map((candidate) => candidate.firstName === normalizedName ? candidate.secondName : candidate.firstName);
  if (fuzzyCandidates.length && !allowFuzzy) return { ok: false, reason: "fuzzy", fuzzyCandidates };
  const nextCatalog = cloneCatalog(catalog);
  const category = nextCatalog.categories.find((entry) => entry.id === categoryId);
  category.name = normalizedName;
  assertCatalog(nextCatalog);
  return { ok: true, catalog: nextCatalog, category, fuzzyCandidates };
}

export function removeGlobalCategory(catalog, categoryId) {
  assertCatalog(catalog);
  if (!catalog.categories.some((category) => category.id === categoryId)) return { ok: false, reason: "not-found" };
  const nextCatalog = cloneCatalog(catalog);
  nextCatalog.categories = nextCatalog.categories.filter((category) => category.id !== categoryId);
  nextCatalog.tags.forEach((tag) => { tag.categoryIds = tag.categoryIds.filter((id) => id !== categoryId); });
  assertCatalog(nextCatalog);
  return { ok: true, catalog: nextCatalog };
}

export function addTagToCategory(catalog, tagId, categoryId) {
  assertCatalog(catalog);
  const current = catalog.tags.find((tag) => tag.id === tagId);
  if (!current) return { ok: false, reason: "tag-not-found" };
  if (!catalog.categories.some((category) => category.id === categoryId)) return { ok: false, reason: "category-not-found" };
  if (current.categoryIds.includes(categoryId)) return { ok: false, reason: "duplicate-membership" };
  const nextCatalog = cloneCatalog(catalog);
  const tag = nextCatalog.tags.find((entry) => entry.id === tagId);
  tag.categoryIds.push(categoryId);
  assertCatalog(nextCatalog);
  return { ok: true, catalog: nextCatalog, tag };
}

export function removeTagFromCategory(catalog, tagId, categoryId) {
  assertCatalog(catalog);
  const current = catalog.tags.find((tag) => tag.id === tagId);
  if (!current) return { ok: false, reason: "tag-not-found" };
  if (!catalog.categories.some((category) => category.id === categoryId)) return { ok: false, reason: "category-not-found" };
  if (!current.categoryIds.includes(categoryId)) return { ok: false, reason: "membership-not-found" };
  const nextCatalog = cloneCatalog(catalog);
  const tag = nextCatalog.tags.find((entry) => entry.id === tagId);
  tag.categoryIds = tag.categoryIds.filter((id) => id !== categoryId);
  assertCatalog(nextCatalog);
  return { ok: true, catalog: nextCatalog, tag };
}

export function editGlobalTag(catalog, tagId, { name }) {
  assertCatalog(catalog);
  const current = catalog.tags.find((tag) => tag.id === tagId);
  if (!current) return { ok: false, reason: "not-found" };
  const normalizedName = normalizeGlobalTagName(name);
  if (!normalizedName) return { ok: false, reason: "invalid-name" };
  const duplicate = catalog.tags.find((tag) => tag.id !== tagId && getGlobalTagNameKey(tag.name) === getGlobalTagNameKey(normalizedName));
  if (duplicate) return { ok: false, reason: "duplicate", existingTag: duplicate };
  const nextCatalog = cloneCatalog(catalog);
  const edited = nextCatalog.tags.find((tag) => tag.id === tagId);
  edited.name = normalizedName;
  assertCatalog(nextCatalog);
  return { ok: true, catalog: nextCatalog, tag: edited };
}

export function removeGlobalTag(catalog, tagId, recordGroups = {}) {
  assertCatalog(catalog);
  if (!catalog.tags.some((tag) => tag.id === tagId)) return { ok: false, reason: "not-found" };
  const nextCatalog = cloneCatalog(catalog);
  nextCatalog.tags = nextCatalog.tags.filter((tag) => tag.id !== tagId);
  const paperRecords = removeAssignment(recordGroups.paperRecords || [], tagId);
  const cardRecords = removeAssignment(recordGroups.cardRecords || [], tagId);
  const stampRecords = removeAssignment(recordGroups.stampRecords || [], tagId);
  assertCatalog(nextCatalog);
  return { ok: true, catalog: nextCatalog, paperRecords, cardRecords, stampRecords };
}

export function sortGlobalTags(tags) {
  return [...tags].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

export function sortGlobalCategories(categories) {
  return [...categories].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

function removeAssignment(records, tagId) {
  return records.map((record) => ({ ...record, tagIds: (record.tagIds || []).filter((id) => id !== tagId) }));
}

function createOpaqueTagId() {
  if (globalThis.crypto?.randomUUID) return `tag-${globalThis.crypto.randomUUID()}`;
  return `tag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createOpaqueCategoryId() {
  if (globalThis.crypto?.randomUUID) return `category-${globalThis.crypto.randomUUID()}`;
  return `category-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function assertCatalog(catalog) {
  if (!validateGlobalTagCatalog(catalog).ok) throw new TypeError("The global tag catalog is invalid.");
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
