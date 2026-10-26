import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyGlobalTagCatalog, createMigratedTagId, migrateGlobalTagCatalogSchema } from "./global-tag-catalog.js";
import { reconcileBackupTagData } from "./tag-backup-reconciliation.js";

const tag = (id, name, appliesTo = ["paper"], categoryIds = []) => ({ id, name, appliesTo, type: "theme", categoryIds });
const category = (id, name) => ({ id, name });
const catalog = (tags = [], categories = []) => ({ schemaVersion: 1, tags, categories });
const modern = (tagCatalog, paperPacks = [], cards = []) => ({ tagCatalog, paperPacks, cards });
const paper = (id, tagIds) => ({ id, tagIds });
const card = (id, tagIds) => ({ id, tagIds });
const modernCatalog = (tags = [], categories = []) => ({ schemaVersion: 2, tags, categories });
const toolTag = (id, name, filenameTerms = [], extra = {}) => ({ id, name, type: "tool", filenameTerms, categoryIds: [], ...extra });

function assertConfigurationConflict(result, setting, matchBy) {
  assert.equal(result.ok, false);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].type, "tag-configuration");
  assert.equal(result.conflicts[0].matchBy, matchBy);
  assert.ok(result.conflicts[0].differences.some((difference) => difference.setting === setting));
  assert.match(result.conflicts[0].message, /Tag configuration conflict/);
  assert.equal("catalog" in result, false);
  assert.equal("paperPacks" in result, false);
}

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

test("modern backup blocks a type conflict matched by stable ID without mutating either input", () => {
  const local = modernCatalog([toolTag("shared", "Embossing", ["emboss"])]);
  const backup = modern(modernCatalog([{ id: "shared", name: "Embossing", type: "theme", categoryIds: [] }]), [paper("p", ["shared"])]);
  const before = structuredClone({ local, backup });
  const result = reconcileBackupTagData({ localCatalog: local, backup });
  assertConfigurationConflict(result, "type", "id");
  assert.deepEqual({ local, backup }, before);
  assert.match(result.conflicts[0].message, /type \(local: tool; backup: theme\)/);
});

test("modern backup blocks a filenameTerms conflict matched by normalized name", () => {
  const local = modernCatalog([toolTag("local", "Embossing", ["emboss", "powder"])]);
  const backup = modern(modernCatalog([toolTag("remote", " embossing ", ["emboss", "heat"])]), [], [card("c", ["remote"])]);
  const before = structuredClone({ local, backup });
  const result = reconcileBackupTagData({ localCatalog: local, backup });
  assertConfigurationConflict(result, "filenameTerms", "normalized-name");
  assert.deepEqual({ local, backup }, before);
  assert.match(result.conflicts[0].message, /filenameTerms \(local: \[emboss, powder\]; backup: \[emboss, heat\]\)/);
});

test("modern backup blocks fallback presence/value conflicts matched by stable ID", () => {
  const local = modernCatalog([toolTag("shared", "Special Tool", [])]);
  const backup = modern(modernCatalog([toolTag("shared", "Special Tool", [], { unmatchedFilenameFallback: false })]));
  const result = reconcileBackupTagData({ localCatalog: local, backup });
  assertConfigurationConflict(result, "unmatchedFilenameFallback", "id");
  assert.match(result.conflicts[0].message, /unmatchedFilenameFallback \(local: not set; backup: false\)/);
});

test("matching modern Tool Tag configurations reconcile as before", () => {
  const local = modernCatalog([toolTag("local", "Embossing", ["heat", "powder"], { unmatchedFilenameFallback: false, categoryIds: ["local-cat"] })], [category("local-cat", "Tools")]);
  const backup = modern(modernCatalog([toolTag("remote", " embossing ", ["heat", "powder"], { unmatchedFilenameFallback: false, categoryIds: ["remote-cat"] })], [category("remote-cat", " tools ")]), [], [card("c", ["remote"])]);
  const result = reconcileBackupTagData({ localCatalog: local, backup });
  assert.equal(result.ok, true);
  assert.deepEqual(result.cards[0].tagIds, ["local"]);
  assert.deepEqual(result.catalog.tags[0].categoryIds, ["local-cat"]);
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

test("schema 1 backup catalogs upgrade in memory and preserve assignments and category relationships", () => {
  const legacyCatalog = { schemaVersion: 1,
    categories: [{ id: "c", name: "Nature" }],
    tags: [{ id: "die-stable", name: "Die", categoryIds: ["c"] },
      { id: "floral-stable", name: "Floral", categoryIds: ["c"] }] };
  const backup = { tagCatalog: legacyCatalog,
    paperPacks: [{ id: "p", tagIds: ["die-stable", "floral-stable"] }],
    cards: [{ id: "card", tagIds: ["floral-stable"] }],
    stampDieSets: [{ id: "set", tagIds: ["die-stable"] }] };
  const before = structuredClone(backup);
  const result = reconcileBackupTagData({ localCatalog: createEmptyGlobalTagCatalog(), backup });
  assert.equal(result.ok, true);
  assert.equal(result.catalog.schemaVersion, 2);
  assert.equal(result.catalog.tags.find((tag) => tag.id === "die-stable").type, "tool");
  assert.deepEqual(result.catalog.tags.map((tag) => tag.categoryIds), [["c"], ["c"]]);
  assert.deepEqual(result.paperPacks[0].tagIds, ["die-stable", "floral-stable"]);
  assert.deepEqual(result.cards[0].tagIds, ["floral-stable"]);
  assert.deepEqual(result.stampDieSets[0].tagIds, ["die-stable"]);
  assert.deepEqual(backup, before);
});

test("schema 2 backup normalization backfills only absent Stamp fallback and preserves data", () => {
  const imported = {
    schemaVersion: 2,
    categories: [{ id: "cat", name: "Nature" }],
    tags: [
      { id: "stamp", name: "Stamp", type: "tool", filenameTerms: ["rubber stamp"], categoryIds: ["cat"] },
      { id: "stamp-false", name: "Stamp (manual)", type: "tool", filenameTerms: [], categoryIds: [], unmatchedFilenameFallback: false },
      { id: "theme", name: "Floral", type: "theme", categoryIds: ["cat"] }
    ]
  };
  const backup = modern(imported, [paper("p", ["stamp"])], [card("c", ["theme"]) ]);
  const before = structuredClone(backup);
  const result = reconcileBackupTagData({ localCatalog: createEmptyGlobalTagCatalog(), backup });
  assert.equal(result.ok, true);
  assert.equal(result.catalog.tags.find(({ id }) => id === "stamp").unmatchedFilenameFallback, true);
  assert.equal(result.catalog.tags.find(({ id }) => id === "stamp-false").unmatchedFilenameFallback, false);
  assert.equal("unmatchedFilenameFallback" in result.catalog.tags.find(({ id }) => id === "theme"), false);
  assert.deepEqual(result.catalog.tags.map(({ id, categoryIds, filenameTerms }) => ({ id, categoryIds, filenameTerms })),
    before.tagCatalog.tags.map(({ id, categoryIds, filenameTerms }) => ({ id, categoryIds, filenameTerms })));
  assert.deepEqual(result.paperPacks[0].tagIds, ["stamp"]);
  assert.deepEqual(result.cards[0].tagIds, ["theme"]);
  assert.deepEqual(backup, before);
});

test("cross-product assignments are accepted while mixed records are rejected", () => {
  const result = reconcileBackupTagData({
    localCatalog: createEmptyGlobalTagCatalog(),
    backup: modern(catalog([tag("t", "Paper only")]), [], [card("c", ["t"])])
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.cards[0].tagIds, ["t"]);
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

test('replacement uses the complete backup taxonomy and maps retained local identities without mutation', () => {
  const local = catalog([
    tag('same', 'Old name', ['paper'], ['old-cat']), tag('alias', 'Shared'), tag('deleted', 'Deleted')
  ], [category('old-cat', 'Old category'), category('removed-cat', 'Removed category')]);
  const incoming = catalog([tag('same', 'Renamed', ['paper'], []), tag('remote', 'Shared')], [category('old-cat', 'Renamed category')]);
  const backup = modern(incoming, [paper('p', ['same'])], [card('c', ['remote'])]);
  const before = structuredClone({ local, backup });
  const result = reconcileBackupTagData({ localCatalog: local, backup, overwriteExisting: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.catalog, migrateGlobalTagCatalogSchema(incoming));
  assert.deepEqual([...result.retainedTagIdMap], [['same', 'same'], ['alias', 'remote'], ['deleted', null]]);
  assert.equal(result.report.tagsRemoved, 1);
  assert.equal(result.report.categoriesRemoved, 1);
  assert.deepEqual(result.paperPacks[0].tagIds, ['same']);
  assert.deepEqual(result.cards[0].tagIds, ['remote']);
  assert.deepEqual({ local, backup }, before);
});

test('empty modern replacement removes the taxonomy; legacy replacement remains a merge', () => {
  const local = catalog([tag('local', 'Floral')], [category('cat', 'Nature')]);
  const modernResult = reconcileBackupTagData({ localCatalog: local, backup: modern(catalog()), overwriteExisting: true });
  assert.deepEqual(modernResult.catalog, migrateGlobalTagCatalogSchema(catalog()));
  assert.equal(modernResult.retainedTagIdMap.get('local'), null);
  const legacy = reconcileBackupTagData({ localCatalog: local, backup: { paperPacks: [], cards: [] }, overwriteExisting: true });
  assert.deepEqual(legacy.catalog, migrateGlobalTagCatalogSchema(local));
  assert.equal(legacy.retainedTagIdMap, undefined);
});

test('replacement rejects invalid assignments and categories before producing a writable result', () => {
  assert.throws(() => reconcileBackupTagData({ backup: modern(catalog(), [paper('p', ['missing'])]), overwriteExisting: true }), /unknown tag/);
  assert.throws(() => reconcileBackupTagData({ backup: modern(catalog([tag('t', 'Tag', ['paper'], ['missing'])])), overwriteExisting: true }), /catalog is invalid/);
});
