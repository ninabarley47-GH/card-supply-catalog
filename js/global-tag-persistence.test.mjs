import test from "node:test";
import assert from "node:assert/strict";
import { createMigratedTagId } from "./global-tag-catalog.js";
import {
  GLOBAL_TAG_MIGRATION_VERSION,
  dehydrateCardTagNames,
  dehydratePaperTagNames,
  hydrateCardTagNames,
  hydratePaperTagNames,
  mergeLegacyVocabularyIntoGlobalCatalog,
  migrateGlobalTagPersistence
} from "./global-tag-persistence.js";

function legacyState(overrides = {}) {
  return {
    globalTagCatalog: null,
    migrationVersion: null,
    paperVocabulary: [],
    cardVocabulary: [],
    paperRecords: [],
    cardRecords: [],
    ...overrides
  };
}

function createHarness(initialState, { failCommit = false } = {}) {
  let state = structuredClone(initialState);
  let commits = 0;
  return {
    readState: async () => structuredClone(state),
    commitMigration: async (changes) => {
      commits += 1;
      if (failCommit) throw new Error("simulated transaction abort");
      state = { ...state, ...structuredClone(changes) };
    },
    snapshot: () => structuredClone(state),
    commitCount: () => commits
  };
}

test("migrates Paper-only legacy assignments and deterministic IDs", async () => {
  const harness = createHarness(legacyState({
    paperVocabulary: ["Floral"],
    paperRecords: [{ id: "paper-1", keywords: ["Floral"] }]
  }));
  const result = await migrateGlobalTagPersistence(harness);
  assert.equal(result.catalog.tags[0].id, createMigratedTagId("Floral"));
  assert.deepEqual(result.catalog.tags[0].appliesTo, ["paper"]);
  assert.deepEqual(harness.snapshot().paperRecords[0], { id: "paper-1", tagIds: [createMigratedTagId("Floral")] });
});

test("migrates Card-only legacy assignments", async () => {
  const harness = createHarness(legacyState({
    cardVocabulary: ["Birthday"], cardRecords: [{ id: "card-1", tags: ["Birthday"] }]
  }));
  await migrateGlobalTagPersistence(harness);
  assert.deepEqual(harness.snapshot().cardRecords[0], { id: "card-1", tagIds: [createMigratedTagId("Birthday")] });
});

test("consolidates shared exact names and unions applicability", async () => {
  const harness = createHarness(legacyState({ paperVocabulary: ["Holiday"], cardVocabulary: [" holiday "] }));
  const result = await migrateGlobalTagPersistence(harness);
  assert.equal(result.catalog.tags.length, 1);
  assert.deepEqual(result.catalog.tags[0].appliesTo, ["paper", "card"]);
});

test("preserves all assignments after approved normalization and retires Background", async () => {
  const harness = createHarness(legacyState({
    paperRecords: [{ id: "p", keywords: ["cartoon", "Background", "Ocean"] }],
    cardRecords: [{ id: "c", tags: ["Birthday", "Thanks"] }]
  }));
  const result = await migrateGlobalTagPersistence(harness);
  const namesById = new Map(result.catalog.tags.map((tag) => [tag.id, tag.name]));
  assert.deepEqual(harness.snapshot().paperRecords[0].tagIds.map((id) => namesById.get(id)), ["Illustration", "Water"]);
  assert.deepEqual(harness.snapshot().cardRecords[0].tagIds.map((id) => namesById.get(id)), ["Birthday", "Thanks"]);
  assert.equal(result.catalog.tags.some((tag) => tag.name === "Background"), false);
});

test("commits catalog, records, and migration marker atomically on success", async () => {
  const harness = createHarness(legacyState({ paperVocabulary: ["Floral"] }));
  await migrateGlobalTagPersistence(harness);
  assert.equal(harness.commitCount(), 1);
  assert.equal(harness.snapshot().migrationVersion, GLOBAL_TAG_MIGRATION_VERSION);
  assert.equal(harness.snapshot().globalTagCatalog.tags.length, 1);
});

test("failed atomic commit leaves records, catalog, and marker unchanged", async () => {
  const initial = legacyState({
    paperVocabulary: ["Floral"], paperRecords: [{ id: "p", keywords: ["Floral"] }]
  });
  const harness = createHarness(initial, { failCommit: true });
  await assert.rejects(() => migrateGlobalTagPersistence(harness), /simulated transaction abort/);
  assert.deepEqual(harness.snapshot(), initial);
  assert.equal(harness.snapshot().migrationVersion, null);
  assert.equal(harness.snapshot().globalTagCatalog, null);
});

test("repeat startup is idempotent and does not rewrite migrated data", async () => {
  const harness = createHarness(legacyState({ paperVocabulary: ["Floral"] }));
  const first = await migrateGlobalTagPersistence(harness);
  const firstSnapshot = harness.snapshot();
  const second = await migrateGlobalTagPersistence(harness);
  assert.equal(first.migrated, true);
  assert.equal(second.migrated, false);
  assert.equal(harness.commitCount(), 1);
  assert.deepEqual(harness.snapshot(), firstSnapshot);
});

test("already-migrated catalog preserves IDs, names, applicability, and categories without writing", async () => {
  const catalog = {
    schemaVersion: 1,
    tags: [{ id: "tag-stable", name: "Birds", appliesTo: ["paper"], categoryIds: ["category-animals"] }],
    categories: [{ id: "category-animals", name: "Animals" }]
  };
  const harness = createHarness(legacyState({ globalTagCatalog: catalog, migrationVersion: 1 }));
  const result = await migrateGlobalTagPersistence(harness);
  assert.equal(result.migrated, false);
  assert.deepEqual(result.catalog, catalog);
  assert.equal(harness.commitCount(), 0);
});

test("transition loaders accept legacy and tagIds Paper records", () => {
  const catalog = { schemaVersion: 1, tags: [{ id: "tag-f", name: "Floral", appliesTo: ["paper"], categoryIds: [] }], categories: [] };
  const legacy = { id: "legacy", keywords: ["Floral"] };
  assert.equal(hydratePaperTagNames(legacy, catalog), legacy);
  assert.deepEqual(hydratePaperTagNames({ id: "new", tagIds: ["tag-f"] }, catalog).keywords, ["Floral"]);
});

test("transition loaders accept legacy and tagIds Card records", () => {
  const catalog = { schemaVersion: 1, tags: [{ id: "tag-b", name: "Birthday", appliesTo: ["card"], categoryIds: [] }], categories: [] };
  const legacy = { id: "legacy", tags: ["Birthday"] };
  assert.equal(hydrateCardTagNames(legacy, catalog), legacy);
  assert.deepEqual(hydrateCardTagNames({ id: "new", tagIds: ["tag-b"] }, catalog).tags, ["Birthday"]);
});

test("transition adapter is lossless across display-name changes and unchanged saves", () => {
  const originalCatalog = {
    schemaVersion: 1,
    tags: [{ id: "tag-stable", name: "Birds", appliesTo: ["paper", "card"], categoryIds: [] }],
    categories: []
  };
  const renamedCatalog = {
    ...originalCatalog,
    tags: [{ ...originalCatalog.tags[0], name: "Winged Creatures" }]
  };
  const storedPaper = { id: "paper", tagIds: ["tag-stable"] };
  const storedCard = { id: "card", tagIds: ["tag-stable"] };
  assert.deepEqual(hydratePaperTagNames(storedPaper, originalCatalog).keywords, ["Birds"]);
  const renamedPaper = hydratePaperTagNames(storedPaper, renamedCatalog);
  const renamedCard = hydrateCardTagNames(storedCard, renamedCatalog);
  assert.deepEqual(renamedPaper.keywords, ["Winged Creatures"]);
  assert.deepEqual(renamedCard.tags, ["Winged Creatures"]);
  assert.deepEqual(dehydratePaperTagNames(renamedPaper, renamedCatalog), storedPaper);
  assert.deepEqual(dehydrateCardTagNames(renamedCard, renamedCatalog), storedCard);
  assert.equal(Object.keys(renamedPaper).includes("tagIds"), false);
  assert.equal(JSON.stringify(renamedCard).includes("tagIds"), false);
  assert.equal(renamedCatalog.tags.length, 1);
  assert.equal(renamedCatalog.tags[0].id, "tag-stable");
  assert.deepEqual(
    dehydratePaperTagNames({ id: "new-paper", keywords: ["Winged Creatures"], tagIds: [] }, renamedCatalog),
    { id: "new-paper", tagIds: ["tag-stable"] }
  );
});

test("near-duplicates remain separate and are only reported", async () => {
  const harness = createHarness(legacyState({ paperVocabulary: ["Birthday"], cardVocabulary: ["Birthdays"] }));
  const result = await migrateGlobalTagPersistence(harness);
  assert.equal(result.catalog.tags.length, 2);
  assert.equal(result.fuzzyDuplicateCandidates.length, 1);
});

test("transitional vocabulary writes add exact tags without duplicating tags or changing categories", () => {
  const catalog = {
    schemaVersion: 1,
    tags: [{ id: "tag-floral", name: "Floral", appliesTo: ["paper"], categoryIds: ["category-style"] }],
    categories: [{ id: "category-style", name: "Style" }]
  };
  const merged = mergeLegacyVocabularyIntoGlobalCatalog(catalog, {
    paperVocabulary: [" floral ", "Geometric"]
  });
  assert.equal(merged.tags.filter((tag) => tag.name === "Floral").length, 1);
  assert.equal(merged.tags.some((tag) => tag.name === "Geometric"), true);
  assert.deepEqual(merged.categories, catalog.categories);
  assert.deepEqual(merged.tags.find((tag) => tag.id === "tag-floral").categoryIds, ["category-style"]);
});
