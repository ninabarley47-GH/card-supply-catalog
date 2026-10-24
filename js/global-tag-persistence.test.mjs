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
  migrateGlobalTagPersistence,
  migrateGlobalTagCatalogSchemaInTransaction
} from "./global-tag-persistence.js";
import { migrateGlobalTagCatalogSchema } from "./global-tag-catalog.js";

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

test("runtime display projections remain ID-authoritative across renames and saves", () => {
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
  assert.equal(Object.keys(renamedPaper).includes("tagIds"), true);
  assert.equal(JSON.stringify(renamedCard).includes("tagIds"), true);
  assert.equal(renamedCatalog.tags.length, 1);
  assert.equal(renamedCatalog.tags[0].id, "tag-stable");
  assert.deepEqual(
    dehydratePaperTagNames({ id: "new-paper", keywords: ["Winged Creatures"], tagIds: [] }, renamedCatalog),
    { id: "new-paper", tagIds: [] }
  );
});

test("near-duplicates remain separate and are only reported", async () => {
  const harness = createHarness(legacyState({ paperVocabulary: ["Birthday"], cardVocabulary: ["Birthdays"] }));
  const result = await migrateGlobalTagPersistence(harness);
  assert.equal(result.catalog.tags.length, 2);
  assert.equal(result.fuzzyDuplicateCandidates.length, 1);
});

test("cached storage modules retain the side-effect-free legacy merge export during upgrades", () => {
  const catalog = { schemaVersion: 1, tags: [], categories: [] };
  const merged = mergeLegacyVocabularyIntoGlobalCatalog(catalog, { paperVocabulary: ["Floral"] });
  assert.equal(merged.tags[0].name, "Floral");
  assert.deepEqual(catalog, { schemaVersion: 1, tags: [], categories: [] });
});

function catalogTransactionHarness(catalog) {
  let stored = { id: "globalTagCatalog", value: structuredClone(catalog) };
  let failNext = false;
  let putCount = 0;
  const database = {
    transaction(storeNames, mode) {
      assert.deepEqual(storeNames, ["settings"]);
      assert.equal(mode, "readwrite");
      const transaction = new EventTarget();
      const before = structuredClone(stored);
      let aborted = false;
      transaction.objectStore = () => ({
        get: (id) => {
          assert.equal(id, "globalTagCatalog");
          const request = new EventTarget();
          queueMicrotask(() => {
            request.result = structuredClone(stored);
            request.dispatchEvent(new Event("success"));
          });
          return request;
        },
        put: (record) => { putCount += 1; stored = structuredClone(record); }
      });
      transaction.abort = () => {
        if (aborted) return;
        aborted = true;
        stored = before;
        transaction.error = new Error("simulated transaction abort");
        transaction.dispatchEvent(new Event("abort"));
      };
      setTimeout(() => {
        if (failNext) { failNext = false; transaction.abort(); }
        else if (!aborted) transaction.dispatchEvent(new Event("complete"));
      });
      return transaction;
    }
  };
  return {
    database,
    read: () => structuredClone(stored.value),
    writeFromOtherTab: (nextCatalog) => { stored = { id: "globalTagCatalog", value: structuredClone(nextCatalog) }; },
    failNextCommit: () => { failNext = true; },
    putCount: () => putCount
  };
}

const migrateCatalogInHarness = (harness) => migrateGlobalTagCatalogSchemaInTransaction({
  database: harness.database, storeName: "settings", settingId: "globalTagCatalog"
});

test("catalog schema migration reads and upgrades schema 1 atomically while preserving IDs and categories", async () => {
  const original = { schemaVersion: 1, categories: [{ id: "cat", name: "Nature" }], tags: [
    { id: "die", name: "Die", categoryIds: ["cat"] }, { id: "floral", name: "Floral", categoryIds: ["cat"] }
  ] };
  const harness = catalogTransactionHarness(original);
  const result = await migrateCatalogInHarness(harness);
  assert.equal(result.migrated, true);
  assert.equal(result.catalog.schemaVersion, 2);
  assert.deepEqual(result.catalog.tags.map(({ id, categoryIds }) => [id, categoryIds]), [["die", ["cat"]], ["floral", ["cat"]]]);
  assert.deepEqual(harness.read(), result.catalog);
  assert.equal(harness.putCount(), 1);
});

test("a second migration uses the current schema 2 catalog and performs no rewrite", async () => {
  const schema2 = migrateGlobalTagCatalogSchema({ schemaVersion: 1, tags: [{ id: "die", name: "Die", categoryIds: [] }], categories: [] });
  const harness = catalogTransactionHarness(schema2);
  const result = await migrateCatalogInHarness(harness);
  assert.equal(result.migrated, false);
  assert.deepEqual(harness.read(), schema2);
  assert.equal(harness.putCount(), 0);
});

test("a stale schema 1 snapshot cannot overwrite a newer schema 2 classification", async () => {
  const staleSchema1 = { schemaVersion: 1, tags: [{ id: "stable", name: "Die", categoryIds: [] }], categories: [] };
  const currentSchema2 = { schemaVersion: 2, tags: [{ id: "stable", name: "Die", type: "theme", categoryIds: [] }], categories: [] };
  const harness = catalogTransactionHarness(staleSchema1);
  harness.writeFromOtherTab(currentSchema2);
  const result = await migrateCatalogInHarness(harness);
  assert.equal(result.migrated, false);
  assert.deepEqual(harness.read(), currentSchema2);
  assert.equal(harness.read().tags[0].type, "theme");
  assert.equal(harness.putCount(), 0);
});

test("an aborted migration leaves the catalog unchanged and a subsequent retry succeeds", async () => {
  const original = { schemaVersion: 1, tags: [{ id: "die", name: "Die", categoryIds: [] }], categories: [] };
  const harness = catalogTransactionHarness(original);
  harness.failNextCommit();
  await assert.rejects(() => migrateCatalogInHarness(harness), /simulated transaction abort/);
  assert.deepEqual(harness.read(), original);
  assert.equal((await migrateCatalogInHarness(harness)).migrated, true);
});
