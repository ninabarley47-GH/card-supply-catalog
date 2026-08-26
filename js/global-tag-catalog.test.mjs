import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyGlobalTagCatalog,
  createMigratedTagId,
  findFuzzyDuplicateCandidates,
  getGlobalTagNameKey,
  migrateLegacyTagData,
  normalizeGlobalTagName,
  normalizeLegacyPaperTagName,
  validateGlobalTagCatalog,
  validateItemTagAssignments
} from "./global-tag-catalog.js";

function catalogWith(overrides = {}) {
  return { ...createEmptyGlobalTagCatalog(), ...overrides };
}

function tag(overrides = {}) {
  return { id: "tag-one", name: "One", appliesTo: ["paper"], categoryIds: [], ...overrides };
}

test("normalizes tag names and comparison keys", () => {
  assert.equal(normalizeGlobalTagName("  Fun\t Fold \n"), "Fun Fold");
  assert.equal(getGlobalTagNameKey(" FUN  fold "), "fun fold");
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
    appliesTo: ["paper", "card"], categoryIds: []
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

test("rejects invalid, empty, and duplicate applicability", () => {
  for (const appliesTo of [[], ["ink"], ["paper", "paper"]]) {
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

test("validates item applicability and valid tag assignments", () => {
  const catalog = catalogWith({ tags: [tag({ appliesTo: ["paper", "card"] })] });
  assert.equal(validateItemTagAssignments({ catalog, productType: "card", tagIds: ["tag-one"] }).ok, true);
  assert.equal(validateItemTagAssignments({ catalog, productType: "stamp", tagIds: ["tag-one"] }).ok, false);
});
