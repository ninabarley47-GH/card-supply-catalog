import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyGlobalTagCatalog, createMigratedTagId } from "./global-tag-catalog.js";
import { reconcileBackupTagData } from "./tag-backup-reconciliation.js";

const tag = (id, name, appliesTo = ["paper"], categoryIds = []) => ({ id, name, appliesTo, categoryIds });
const category = (id, name) => ({ id, name });
const catalog = (tags = [], categories = []) => ({ schemaVersion: 1, tags, categories });
const modern = (tagCatalog, paperPacks = [], cards = []) => ({ tagCatalog, paperPacks, cards });
const paper = (id, tagIds) => ({ id, tagIds });
const card = (id, tagIds) => ({ id, tagIds });

test("same stable ID keeps the local name and unions applicability and categories", () => {
  const local = catalog([tag("tag-1", "Local name", ["paper"], ["cat-local"])], [category("cat-local", "Local")]);
  const imported = catalog([tag("tag-1", "Imported name", ["card"], ["cat-import"])], [category("cat-import", "Imported")]);
  const result = reconcileBackupTagData({ localCatalog: local, backup: modern(imported, [], [card("c", ["tag-1"])]) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.catalog.tags[0], tag("tag-1", "Local name", ["paper", "card"], ["cat-local", "cat-import"]));
  assert.deepEqual(result.cards[0].tagIds, ["tag-1"]);
  assert.deepEqual(result.report.localNamesRetained, [{ id: "tag-1", localName: "Local name", importedName: "Imported name" }]);
});

test("different IDs with the same normalized name remap to the local tag and category IDs", () => {
  const local = catalog([tag("local-tag", "Birthday", ["paper"], ["local-cat"])], [category("local-cat", "Celebrations")]);
  const imported = catalog([tag("remote-tag", " birthday ", ["card"], ["remote-cat"])], [category("remote-cat", " celebrations ")]);
  const result = reconcileBackupTagData({ localCatalog: local, backup: modern(imported, [], [card("c", ["remote-tag"])]) });
  assert.equal(result.catalog.tags.length, 1);
  assert.equal(result.catalog.categories.length, 1);
  assert.deepEqual(result.cards[0].tagIds, ["local-tag"]);
  assert.equal(result.report.tagIdsRemapped, 1);
  assert.equal(result.report.categoryIdsRemapped, 1);
});

test("an empty local catalog preserves imported stable IDs", () => {
  const result = reconcileBackupTagData({
    localCatalog: createEmptyGlobalTagCatalog(),
    backup: modern(catalog([tag("remote", "Floral")]), [paper("p", ["remote"])])
  });
  assert.equal(result.catalog.tags[0].id, "remote");
  assert.deepEqual(result.paperPacks[0].tagIds, ["remote"]);
});

test("legacy exact names consolidate and infer Paper/Card applicability", () => {
  const local = catalog([tag("local", "Holiday", ["paper"])]);
  const result = reconcileBackupTagData({
    localCatalog: local,
    backup: { tagVocabularies: { paper: [], card: [" holiday "] }, paperPacks: [], cards: [{ id: "c", tags: ["HOLIDAY"] }] }
  });
  assert.equal(result.ok, true);
  assert.equal(result.catalog.tags.length, 1);
  assert.deepEqual(result.catalog.tags[0].appliesTo, ["paper", "card"]);
  assert.deepEqual(result.cards[0].tagIds, ["local"]);
  assert.equal(result.report.legacyConversions, 1);
});

test("legacy backups without vocabularies reconstruct tags from assignments and retire Background", () => {
  const result = reconcileBackupTagData({
    localCatalog: createEmptyGlobalTagCatalog(),
    backup: { paperPacks: [{ id: "p", keywords: ["Background", "Floral"] }], cards: [{ id: "c", tags: ["Thanks"] }] }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.catalog.tags.map((entry) => entry.name).sort(), ["Floral", "Thanks"]);
  assert.equal(result.paperPacks[0].tagIds.length, 1);
});

test("fuzzy-only legacy matches require review and do not produce writable records", () => {
  const result = reconcileBackupTagData({
    localCatalog: catalog([tag("local", "Birthday")]),
    backup: { paperPacks: [{ id: "p", keywords: ["Birthdays"] }], cards: [] }
  });
  assert.equal(result.ok, false);
  assert.equal(result.conflicts[0].type, "legacy-fuzzy-match");
  assert.equal("catalog" in result, false);
});

test("a deterministic legacy ID occupied by a renamed local tag requires review", () => {
  const result = reconcileBackupTagData({
    localCatalog: catalog([tag(createMigratedTagId("Holiday"), "Festive")]),
    backup: { paperPacks: [{ id: "p", keywords: ["Holiday"] }], cards: [] }
  });
  assert.equal(result.ok, false);
  assert.equal(result.conflicts[0].type, "legacy-id-ambiguity");
});

test("legacy exact-name precedence wins over an unrelated deterministic-ID occupant", () => {
  const hashId = createMigratedTagId("Holiday");
  const result = reconcileBackupTagData({
    localCatalog: catalog([tag(hashId, "Festive"), tag("current-holiday", "Holiday")]),
    backup: { paperPacks: [{ id: "p", keywords: ["Holiday"] }], cards: [] }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.paperPacks[0].tagIds, ["current-holiday"]);
  assert.equal(result.catalog.tags.length, 2);
});

test("unknown category and item tag references are rejected before reconciliation", () => {
  assert.throws(() => reconcileBackupTagData({
    localCatalog: createEmptyGlobalTagCatalog(),
    backup: modern(catalog([tag("t", "Tag", ["paper"], ["missing"])]) )
  }), /catalog is invalid/);
  assert.throws(() => reconcileBackupTagData({
    localCatalog: createEmptyGlobalTagCatalog(),
    backup: modern(catalog(), [paper("p", ["missing"])])
  }), /unknown tag/);
});

test("wrong-product assignments and mixed records are rejected", () => {
  assert.throws(() => reconcileBackupTagData({
    localCatalog: createEmptyGlobalTagCatalog(),
    backup: modern(catalog([tag("t", "Paper only")]), [], [card("c", ["t"])])
  }), /invalid tag assignments/);
  assert.throws(() => reconcileBackupTagData({
    localCatalog: createEmptyGlobalTagCatalog(),
    backup: modern(catalog(), [{ id: "p", tagIds: [], keywords: [] }])
  }), /mixed/);
});

test("reconciliation does not mutate local/imported catalogs or image fields", () => {
  const local = catalog([tag("local", "Floral")]);
  const imported = modern(catalog([tag("remote", "Floral")]), [{ id: "p", tagIds: ["remote"], patterns: [{ imagePath: "shared/a.jpg", imageSrc: "data:image/png;base64,AA" }] }]);
  const before = JSON.stringify({ local, imported });
  const result = reconcileBackupTagData({ localCatalog: local, backup: imported });
  assert.equal(JSON.stringify({ local, imported }), before);
  assert.deepEqual(result.paperPacks[0].patterns, imported.paperPacks[0].patterns);
});
