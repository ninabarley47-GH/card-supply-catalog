import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyGlobalTagCatalog,
  createMigratedTagId,
  findFuzzyDuplicateCandidates,
  getGlobalTagNameKey,
  migrateLegacyTagData,
  migrateGlobalTagCatalogSchema,
  normalizeGlobalTagName,
  normalizeLegacyPaperTagName,
  validateGlobalTagCatalog,
  validateItemTagAssignments
} from "./global-tag-catalog.js";

function catalogWith(overrides = {}) {
  return { ...createEmptyGlobalTagCatalog(), ...overrides };
}

function tag(overrides = {}) {
  return { id: "tag-one", name: "One", appliesTo: ["paper"], type: "theme", categoryIds: [], ...overrides };
}

test("normalizes tag names and comparison keys", () => {
  assert.equal(normalizeGlobalTagName("  Fun\t Fold \n"), "Fun Fold");
  assert.equal(getGlobalTagNameKey(" FUN  fold "), "fun fold");
});

test("schema 1 classification migration applies approved defaults without changing identity or relationships", () => {
  const source = {
    schemaVersion: 1,
    categories: [{ id: "cat-tools", name: "Supplies" }],
    tags: ["Stamp", "Die", "Punch", "Mask", "Texture", "Floral"].map((name) => ({
      id: `stable-${name}`, name, categoryIds: ["cat-tools"]
    }))
  };
  const upgraded = migrateGlobalTagCatalogSchema(source);
  assert.equal(upgraded.schemaVersion, 2);
  assert.deepEqual(upgraded.tags.map(({ id, name, type }) => [id, name, type]), source.tags.map((tag) => [tag.id, tag.name, ["Stamp", "Die", "Punch", "Mask", "Texture"].includes(tag.name) ? "tool" : "theme"]));
  assert.deepEqual(upgraded.tags.find(({ name }) => name === "Die").filenameTerms, ["die"]);
  assert.deepEqual(upgraded.tags.find(({ name }) => name === "Punch").filenameTerms, ["punch"]);
  assert.deepEqual(upgraded.tags.find(({ name }) => name === "Mask").filenameTerms, ["mask"]);
  assert.deepEqual(upgraded.tags.find(({ name }) => name === "Texture").filenameTerms, []);
  assert.equal(upgraded.tags.find(({ name }) => name === "Stamp").unmatchedFilenameFallback, true);
  assert.equal("filenameTerms" in upgraded.tags.find(({ name }) => name === "Floral"), false);
  assert.deepEqual(upgraded.categories, source.categories);
  assert.deepEqual(upgraded.tags.map(({ categoryIds }) => categoryIds), source.tags.map(({ categoryIds }) => categoryIds));
  assert.equal(source.schemaVersion, 1);
  assert.deepEqual(migrateGlobalTagCatalogSchema(upgraded), upgraded);
});

test("schema migration does not seed missing built-in Tool Tags and rejects invalid or future schemas", () => {
  const source = { schemaVersion: 1, categories: [], tags: [{ id: "floral", name: "Floral", categoryIds: [] }] };
  const upgraded = migrateGlobalTagCatalogSchema(source);
  assert.deepEqual(upgraded.tags.map(({ id }) => id), ["floral"]);
  assert.equal(upgraded.tags[0].type, "theme");
  assert.throws(() => migrateGlobalTagCatalogSchema({ ...source, tags: [{ id: "bad", name: "X", categoryIds: ["missing"] }] }), /schema 1/);
  assert.throws(() => migrateGlobalTagCatalogSchema({ ...source, schemaVersion: 99 }), /Unsupported/);
});

test("schema 2 backfills only missing Stamp Tool fallback while preserving catalog relationships", () => {
  const source = {
    schemaVersion: 2,
    categories: [{ id: "cat", name: "Nature" }],
    tags: [
      { id: "stamp-missing", name: "  STAMP  ", type: "tool", filenameTerms: ["custom stamp"], categoryIds: ["cat"], appliesTo: ["stamp"] },
      { id: "die", name: "Die", type: "tool", filenameTerms: ["die"], categoryIds: ["cat"] }
    ]
  };
  const normalized = migrateGlobalTagCatalogSchema(source);
  assert.equal(normalized.tags[0].unmatchedFilenameFallback, true);
  assert.equal("unmatchedFilenameFallback" in normalized.tags[1], false);
  assert.deepEqual(normalized.tags.map(({ id, categoryIds, filenameTerms }) => ({ id, categoryIds, filenameTerms })),
    source.tags.map(({ id, categoryIds, filenameTerms }) => ({ id, categoryIds, filenameTerms })));
  assert.deepEqual(source.tags[0].unmatchedFilenameFallback, undefined);
  assert.deepEqual(normalized.categories, source.categories);
  for (const [productType, tagIds] of [["paper", ["stamp-missing"]], ["card", ["die"]], ["stamp", ["stamp-missing", "die"]]]) {
    assert.equal(validateItemTagAssignments({ catalog: normalized, productType, tagIds }).ok, true);
  }
  assert.deepEqual(migrateGlobalTagCatalogSchema(normalized), normalized);

  const themeStamp = { schemaVersion: 2, categories: [], tags: [
    { id: "theme-stamp", name: "Stamp", type: "theme", categoryIds: [] }
  ] };
  assert.deepEqual(migrateGlobalTagCatalogSchema(themeStamp), themeStamp);
  const explicitFalse = { schemaVersion: 2, categories: [], tags: [
    { id: "stamp-false", name: "Stamp", type: "tool", filenameTerms: [], categoryIds: [], unmatchedFilenameFallback: false }
  ] };
  assert.deepEqual(migrateGlobalTagCatalogSchema(explicitFalse), explicitFalse);
});

test("schema 2 rejects duplicate normalized filename terms across Tool Tags", () => {
  const catalog = catalogWith({ tags: [
    tag({ id: "one", name: "One", type: "tool", filenameTerms: ["die"] }),
    tag({ id: "two", name: "Two", type: "tool", filenameTerms: [" DIE "] })
  ] });
  assert.equal(validateGlobalTagCatalog(catalog).ok, false);
});

test("creates deterministic migrated IDs from exact normalized names", () => {
  assert.equal(createMigratedTagId(" Birthday "), createMigratedTagId("BIRTHDAY"));
  assert.match(createMigratedTagId("Birthday"), /^tag-[0-9a-f]{16}$/);
  assert.notEqual(createMigratedTagId("Birthday"), createMigratedTagId("Birthdays"));

  const forward = migrateLegacyTagData({ paperVocabulary: ["Birthday", "Floral"] });
  const reversed = migrateLegacyTagData({ paperVocabulary: ["Floral", "Birthday"] });
  const idsByName = (result) => Object.fromEntries(result.catalog.tags.map(({ id, name }) => [name, id]));
  assert.deepEqual(idsByName(forward), idsByName(reversed));
});

test("handles an occupied hash ID deterministically without merging different names", () => {
  const base = createMigratedTagId("Birthday");
  const occupied = new Map([[base, "another-name"]]);
  const first = createMigratedTagId("Birthday", occupied);
  const second = createMigratedTagId(" birthday ", occupied);
  assert.notEqual(first, base);
  assert.equal(first, second);
});

test("consolidates exact Paper and Card duplicates and unions applicability", () => {
  const result = migrateLegacyTagData({
    paperVocabulary: ["Holiday"],
    cardVocabulary: [" holiday "]
  });
  assert.deepEqual(result.catalog.tags, [{
    id: createMigratedTagId("Holiday"), name: "Holiday",
    appliesTo: ["paper", "card"], type: "theme", categoryIds: []
  }]);
});

test("keeps near-duplicates separate and reports them without merging", () => {
  const result = migrateLegacyTagData({ paperVocabulary: ["Birthday"], cardVocabulary: ["Birthdays"] });
  assert.equal(result.catalog.tags.length, 2);
  assert.deepEqual(result.fuzzyDuplicateCandidates, [{
    firstName: "Birthday", secondName: "Birthdays", reason: "singular-plural"
  }]);
  assert.equal(findFuzzyDuplicateCandidates(["Anniversary", "Aniversary"]).length, 1);
});

test("accepts tags with zero, one, or multiple category relationships", () => {
  const catalog = catalogWith({
    categories: [{ id: "cat-a", name: "A" }, { id: "cat-b", name: "B" }],
    tags: [
      tag(),
      tag({ id: "tag-two", name: "Two", categoryIds: ["cat-a"] }),
      tag({ id: "tag-three", name: "Three", categoryIds: ["cat-a", "cat-b"] })
    ]
  });
  assert.equal(validateGlobalTagCatalog(catalog).ok, true);
});

test("rejects invalid category references and self-reference", () => {
  const unknown = validateGlobalTagCatalog(catalogWith({ tags: [tag({ categoryIds: ["missing"] })] }));
  assert.equal(unknown.ok, false);
  assert.match(unknown.errors[0].message, /Unknown category ID/);

  const self = validateGlobalTagCatalog(catalogWith({ tags: [tag({ categoryIds: ["tag-one"] })] }));
  assert.equal(self.ok, false);
  assert.match(self.errors[0].message, /itself/);
});

test("rejects duplicate IDs and duplicate normalized names", () => {
  const result = validateGlobalTagCatalog(catalogWith({
    tags: [tag(), tag({ name: " Two " })],
    categories: [{ id: "cat", name: "Group" }, { id: "cat", name: " group " }]
  }));
  assert.equal(result.ok, false);
  assert.equal(result.errors.some(({ message }) => message.includes("Duplicate tag ID")), true);
  assert.equal(result.errors.some(({ message }) => message.includes("normalized category name")), true);
});

test("accepts omitted deprecated applicability and validates it when retained", () => {
  const { appliesTo, ...universalTag } = tag();
  assert.equal(validateGlobalTagCatalog(catalogWith({ tags: [universalTag] })).ok, true);
  assert.equal(validateGlobalTagCatalog(catalogWith({ tags: [tag({ appliesTo: [] })] })).ok, true);
  for (const appliesTo of [["ink"], ["paper", "paper"]]) {
    assert.equal(validateGlobalTagCatalog(catalogWith({ tags: [tag({ appliesTo })] })).ok, false);
  }
});

test("rejects categories as item assignments", () => {
  const catalog = catalogWith({ categories: [{ id: "cat-a", name: "A" }], tags: [tag()] });
  const result = validateItemTagAssignments({ catalog, productType: "paper", tagIds: ["cat-a"] });
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /Categories cannot be assigned/);
});

test("enforces one-generation categories and prevents category/tag identity overlap", () => {
  const nested = validateGlobalTagCatalog(catalogWith({
    categories: [{ id: "cat-a", name: "A", parentCategoryId: "cat-b" }]
  }));
  assert.equal(nested.ok, false);
  assert.match(nested.errors[0].message, /cannot contain category or tag relationships/);

  const overlap = validateGlobalTagCatalog(catalogWith({
    categories: [{ id: "tag-one", name: "Category" }], tags: [tag()]
  }));
  assert.equal(overlap.ok, false);
  assert.equal(overlap.errors.some(({ message }) => message.includes("both a tag and a category")), true);
});

test("legacy migration is repeatable and idempotent against its own catalog", () => {
  const input = {
    paperVocabulary: ["Floral"], cardVocabulary: ["Birthday"],
    paperRecords: [{ id: "paper-1", keywords: ["Floral"] }],
    cardRecords: [{ id: "card-1", tags: ["Birthday"] }]
  };
  const first = migrateLegacyTagData(input);
  const repeated = migrateLegacyTagData(input);
  const withExistingCatalog = migrateLegacyTagData({ ...input, catalog: first.catalog });
  assert.deepEqual(first, repeated);
  assert.deepEqual(withExistingCatalog, first);
});

test("applies established legacy Paper keyword replacements", () => {
  assert.equal(normalizeLegacyPaperTagName(" cartoon "), "Illustration");
  assert.equal(normalizeLegacyPaperTagName("Winged Creatures"), "Flying Animals");
  assert.equal(normalizeLegacyPaperTagName("Background"), "");
  const result = migrateLegacyTagData({ paperVocabulary: ["cartoon", "Background", "Ocean Animals"] });
  assert.deepEqual(result.catalog.tags.map(({ name }) => name).sort(), ["Illustration", "Water Animals"]);
});

test("preserves every distinct Paper and Card assignment after approved legacy normalization", () => {
  const result = migrateLegacyTagData({
    paperRecords: [
      { id: "paper-1", keywords: ["Floral", "Holiday"] },
      { id: "paper-2", keywords: ["Water", "Floral", "Background"] }
    ],
    cardRecords: [
      { id: "card-1", tags: ["Holiday", "Birthday"] },
      { id: "card-2", tags: ["Thank You"] }
    ]
  });
  const namesById = new Map(result.catalog.tags.map((entry) => [entry.id, entry.name]));
  assert.deepEqual(result.paperAssignments.map(({ tagIds }) => tagIds.map((id) => namesById.get(id))), [
    ["Floral", "Holiday"], ["Water", "Floral"]
  ]);
  assert.deepEqual(result.cardAssignments.map(({ tagIds }) => tagIds.map((id) => namesById.get(id))), [
    ["Holiday", "Birthday"], ["Thank You"]
  ]);
  assert.deepEqual(result.catalog.tags.find(({ name }) => name === "Holiday").appliesTo, ["paper", "card"]);
  assert.equal(result.catalog.tags.some(({ name }) => name === "Background"), false);
});

test("every global tag is valid for Paper, Card, and Stamp assignments", () => {
  const catalog = catalogWith({ tags: [tag({ appliesTo: ["card"] })] });
  for (const productType of ["paper", "card", "stamp"]) {
    assert.equal(validateItemTagAssignments({ catalog, productType, tagIds: ["tag-one"] }).ok, true);
  }
});
