import { getTagKey, normalizeTagName } from "./tag-utils.js";

export const GLOBAL_TAG_CATALOG_SCHEMA_VERSION = 1;
export const TAG_PRODUCT_TYPES = Object.freeze(["paper", "card", "stamp"]);

const LEGACY_PAPER_TAG_REPLACEMENTS = new Map([
  ["background", ""],
  ["cartoon", "Illustration"],
  ["mammals", "Land Animals"],
  ["ocean", "Water"],
  ["ocean animals", "Water Animals"],
  ["winged creatures", "Flying Animals"]
]);

export function createEmptyGlobalTagCatalog() {
  return {
    schemaVersion: GLOBAL_TAG_CATALOG_SCHEMA_VERSION,
    tags: [],
    categories: []
  };
}

export function normalizeGlobalTagName(value) {
  return normalizeTagName(value);
}

export function getGlobalTagNameKey(value) {
  return getTagKey(value);
}

export function normalizeLegacyPaperTagName(value) {
  const name = normalizeGlobalTagName(value);
  const replacement = LEGACY_PAPER_TAG_REPLACEMENTS.get(getGlobalTagNameKey(name));
  return replacement === undefined ? name : replacement;
}

// Both hash components are derived solely from the normalized name. There is no
// slug or source-order component, so independent migrations produce the same ID.
export function createMigratedTagId(value, occupiedIds = new Map()) {
  const key = getGlobalTagNameKey(value);
  if (!key) throw new TypeError("A migrated tag ID requires a non-empty normalized name.");

  const baseId = `tag-${stableHash(key)}${stableHash(`global-tag\u0000${key}`)}`;
  const occupant = getOccupiedNameKey(occupiedIds, baseId);
  if (!occupant || occupant === key) return baseId;

  // This path handles a pre-existing catalog that deliberately or accidentally
  // occupies the computed ID. Every fallback remains derived from this name.
  for (let attempt = 1; ; attempt += 1) {
    const candidate = `${baseId}-${stableHash(`collision\u0000${key}\u0000${attempt}`)}`;
    const candidateOccupant = getOccupiedNameKey(occupiedIds, candidate);
    if (!candidateOccupant || candidateOccupant === key) return candidate;
  }
}

export function validateGlobalTagCatalog(catalog) {
  const errors = [];
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    return invalid("catalog", "The global tag catalog must be an object.");
  }
  if (catalog.schemaVersion !== GLOBAL_TAG_CATALOG_SCHEMA_VERSION) {
    errors.push(error("schemaVersion", `Expected schema version ${GLOBAL_TAG_CATALOG_SCHEMA_VERSION}.`));
  }
  if (!Array.isArray(catalog.tags)) errors.push(error("tags", "Tags must be an array."));
  if (!Array.isArray(catalog.categories)) errors.push(error("categories", "Categories must be an array."));
  if (errors.length) return { ok: false, errors };

  const tagIds = new Set();
  const categoryIds = new Set();
  const tagNames = new Set();
  const categoryNames = new Set();

  catalog.categories.forEach((category, index) => {
    const path = `categories[${index}]`;
    if (!isEntity(category)) {
      errors.push(error(path, "Category must have a non-empty ID and name."));
      return;
    }
    addUnique(categoryIds, category.id, `${path}.id`, "category ID", errors);
    addUnique(categoryNames, getGlobalTagNameKey(category.name), `${path}.name`, "normalized category name", errors);
    if (["categoryIds", "parentCategoryId", "parentCategoryIds", "tagIds"].some((field) => field in category)) {
      errors.push(error(path, "Categories cannot contain category or tag relationships."));
    }
  });

  catalog.tags.forEach((tag, index) => {
    const path = `tags[${index}]`;
    if (!isEntity(tag)) {
      errors.push(error(path, "Tag must have a non-empty ID and name."));
      return;
    }
    addUnique(tagIds, tag.id, `${path}.id`, "tag ID", errors);
    addUnique(tagNames, getGlobalTagNameKey(tag.name), `${path}.name`, "normalized tag name", errors);
    // appliesTo is deprecated compatibility metadata. Existing catalogs and
    // backups may retain it, but new tags do not need to write it.
    if ("appliesTo" in tag && (!Array.isArray(tag.appliesTo) ||
        new Set(tag.appliesTo).size !== tag.appliesTo.length ||
        tag.appliesTo.some((type) => !TAG_PRODUCT_TYPES.includes(type)))) {
      errors.push(error(`${path}.appliesTo`, "Deprecated applicability metadata must contain unique supported product types."));
    }
    if (!Array.isArray(tag.categoryIds) || new Set(tag.categoryIds).size !== tag.categoryIds.length) {
      errors.push(error(`${path}.categoryIds`, "Category relationships must be a unique ID array."));
    }
  });

  for (const id of tagIds) {
    if (categoryIds.has(id)) errors.push(error("ids", `ID "${id}" cannot identify both a tag and a category.`));
  }
  catalog.tags.forEach((tag, index) => {
    if (!Array.isArray(tag?.categoryIds)) return;
    tag.categoryIds.forEach((categoryId) => {
      if (categoryId === tag.id) {
        errors.push(error(`tags[${index}].categoryIds`, "A tag cannot reference itself as a category."));
      } else if (!categoryIds.has(categoryId)) {
        errors.push(error(`tags[${index}].categoryIds`, `Unknown category ID "${categoryId}".`));
      }
    });
  });
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

export function validateItemTagAssignments({ catalog, productType, tagIds }) {
  const catalogValidation = validateGlobalTagCatalog(catalog);
  if (!catalogValidation.ok) return catalogValidation;
  if (!TAG_PRODUCT_TYPES.includes(productType)) return invalid("productType", "Unsupported product type.");
  if (!Array.isArray(tagIds) || new Set(tagIds).size !== tagIds.length) {
    return invalid("tagIds", "Item tag assignments must be a unique ID array.");
  }

  const tagsById = new Map(catalog.tags.map((tag) => [tag.id, tag]));
  const categoryIds = new Set(catalog.categories.map((category) => category.id));
  const errors = [];
  tagIds.forEach((tagId, index) => {
    if (categoryIds.has(tagId)) {
      errors.push(error(`tagIds[${index}]`, "Categories cannot be assigned to catalog items."));
      return;
    }
    if (!tagsById.has(tagId)) errors.push(error(`tagIds[${index}]`, `Unknown tag ID "${tagId}".`));
  });
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

export function findFuzzyDuplicateCandidates(names) {
  const unique = new Map();
  for (const value of names || []) {
    const name = normalizeGlobalTagName(value);
    const key = getGlobalTagNameKey(name);
    if (key && !unique.has(key)) unique.set(key, name);
  }
  const entries = [...unique.entries()].sort(([a], [b]) => a.localeCompare(b));
  const candidates = [];
  for (let firstIndex = 0; firstIndex < entries.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < entries.length; secondIndex += 1) {
      const [firstKey, firstName] = entries[firstIndex];
      const [secondKey, secondName] = entries[secondIndex];
      const reason = getFuzzyReason(firstKey, secondKey);
      if (reason) candidates.push({ firstName, secondName, reason });
    }
  }
  return candidates;
}

export function migrateLegacyTagData({
  catalog = createEmptyGlobalTagCatalog(),
  paperVocabulary = [],
  cardVocabulary = [],
  paperRecords = [],
  cardRecords = []
} = {}) {
  const validation = validateGlobalTagCatalog(catalog);
  if (!validation.ok) throw new TypeError("Cannot migrate into an invalid global tag catalog.");

  const tagsByKey = new Map(catalog.tags.map((tag) => [getGlobalTagNameKey(tag.name), cloneTag(tag)]));
  const occupiedIds = new Map(catalog.tags.map((tag) => [tag.id, getGlobalTagNameKey(tag.name)]));
  const ensureTag = (rawName, productType, normalizer = normalizeGlobalTagName) => {
    const name = normalizer(rawName);
    const key = getGlobalTagNameKey(name);
    if (!key) return null;
    let tag = tagsByKey.get(key);
    if (!tag) {
      tag = { id: createMigratedTagId(name, occupiedIds), name, appliesTo: [], categoryIds: [] };
      tagsByKey.set(key, tag);
      occupiedIds.set(tag.id, key);
    }
    if (Array.isArray(tag.appliesTo)) {
      if (!tag.appliesTo.includes(productType)) tag.appliesTo.push(productType);
      tag.appliesTo.sort(compareProductTypes);
    }
    return tag;
  };

  // Allocate all legacy names in normalized lexical order. This makes even the
  // collision fallback independent of vocabulary and record processing order.
  const legacyEntries = [
    ...paperVocabulary.map((name) => ({ name: normalizeLegacyPaperTagName(name), productType: "paper" })),
    ...cardVocabulary.map((name) => ({ name: normalizeGlobalTagName(name), productType: "card" })),
    ...paperRecords.flatMap((record) => (record?.keywords || []).map((name) => ({ name: normalizeLegacyPaperTagName(name), productType: "paper" }))),
    ...cardRecords.flatMap((record) => (record?.tags || []).map((name) => ({ name: normalizeGlobalTagName(name), productType: "card" })))
  ].filter(({ name }) => getGlobalTagNameKey(name)).sort((first, second) =>
    getGlobalTagNameKey(first.name).localeCompare(getGlobalTagNameKey(second.name)) ||
    compareProductTypes(first.productType, second.productType)
  );
  legacyEntries.forEach(({ name, productType }) => ensureTag(name, productType));

  const migratedPaperRecords = paperRecords.map((record) => ({
    recordId: record?.id ?? null,
    tagIds: uniqueIds((record?.keywords || []).map((name) => ensureTag(name, "paper", normalizeLegacyPaperTagName)?.id))
  }));
  const migratedCardRecords = cardRecords.map((record) => ({
    recordId: record?.id ?? null,
    tagIds: uniqueIds((record?.tags || []).map((name) => ensureTag(name, "card")?.id))
  }));
  const tags = [...tagsByKey.values()].sort((a, b) => a.id.localeCompare(b.id));
  const migratedCatalog = {
    schemaVersion: GLOBAL_TAG_CATALOG_SCHEMA_VERSION,
    tags,
    categories: catalog.categories.map((category) => ({ ...category }))
  };
  const migratedValidation = validateGlobalTagCatalog(migratedCatalog);
  if (!migratedValidation.ok) throw new TypeError("Legacy migration produced an invalid global tag catalog.");

  return {
    catalog: migratedCatalog,
    paperAssignments: migratedPaperRecords,
    cardAssignments: migratedCardRecords,
    fuzzyDuplicateCandidates: findFuzzyDuplicateCandidates(tags.map((tag) => tag.name))
  };
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function getOccupiedNameKey(occupiedIds, id) {
  if (occupiedIds instanceof Map) return occupiedIds.get(id);
  if (occupiedIds instanceof Set) return occupiedIds.has(id) ? "__occupied__" : undefined;
  return occupiedIds?.[id];
}

function isEntity(entity) {
  return entity && typeof entity === "object" && !Array.isArray(entity) &&
    typeof entity.id === "string" && entity.id.trim() === entity.id && entity.id.length > 0 &&
    typeof entity.name === "string" && normalizeGlobalTagName(entity.name).length > 0;
}

function addUnique(set, value, path, label, errors) {
  if (set.has(value)) errors.push(error(path, `Duplicate ${label} "${value}".`));
  else set.add(value);
}

function cloneTag(tag) {
  return {
    ...tag,
    ...(Array.isArray(tag.appliesTo) ? { appliesTo: [...tag.appliesTo] } : {}),
    categoryIds: [...tag.categoryIds]
  };
}

function uniqueIds(values) {
  return [...new Set(values.filter(Boolean))];
}

function compareProductTypes(first, second) {
  return TAG_PRODUCT_TYPES.indexOf(first) - TAG_PRODUCT_TYPES.indexOf(second);
}

function singularKey(value) {
  if (value.endsWith("ies") && value.length > 4) return `${value.slice(0, -3)}y`;
  if (value.endsWith("es") && value.length > 4) return value.slice(0, -2);
  if (value.endsWith("s") && !value.endsWith("ss") && value.length > 3) return value.slice(0, -1);
  return value;
}

function getFuzzyReason(first, second) {
  if (singularKey(first) === singularKey(second)) return "singular-plural";
  const longest = Math.max(first.length, second.length);
  const distance = levenshteinDistance(first, second);
  if (longest >= 5 && distance === 1) return "very-close-name";
  if (longest >= 9 && distance === 2) return "very-close-name";
  return "";
}

function levenshteinDistance(first, second) {
  let previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
    const current = [firstIndex];
    for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
      current[secondIndex] = Math.min(
        current[secondIndex - 1] + 1,
        previous[secondIndex] + 1,
        previous[secondIndex - 1] + Number(first[firstIndex - 1] !== second[secondIndex - 1])
      );
    }
    previous = current;
  }
  return previous[second.length];
}

function error(path, message) {
  return { path, message };
}

function invalid(path, message) {
  return { ok: false, errors: [error(path, message)] };
}
