import test from "node:test";
import assert from "node:assert/strict";
import { createCatalogBackupSnapshot, createIpadCatalogBackup, restoreCatalogBackup } from "./backup.js";
import { migrateLegacyTagData } from "./global-tag-catalog.js";

function createCatalogRecords() {
  const color = {
    id: "roundtrip-blue",
    name: "Round-trip Blue",
    hex: "#123456",
    rgb: [18, 52, 86],
    family: "unknown",
    colorFamily: "blue",
    status: "unknown",
    aliases: [],
    products: {}
  };
  const paperPack = {
    id: "roundtrip-pack",
    name: "Round-trip Pack",
    owner: "Tester",
    releaseYear: 2026,
    patternCount: 1,
    colors: [color.id],
    keywords: [],
    patterns: [{ id: "pattern-1", imagePath: "Packs/roundtrip.jpg" }]
  };
  const card = {
    id: "roundtrip-card",
    dateCreated: "2026-08-18",
    size: { width: 4.25, height: 5.5 },
    tags: ["birthday"],
    paperPackIds: [paperPack.id],
    colorIds: [color.id],
    favorite: true,
    imagePath: "Cards/roundtrip.jpg",
    thumbnailImagePath: "Cards/thumbnails/roundtrip.jpg",
    imagePreviewSrc: "blob:transient-preview"
  };

  return { color, paperPack, card };
}

test("backup and restore round-trip includes Cards and their persistent image references", async () => {
  const { color, paperPack, card } = createCatalogRecords();
  const backup = createCatalogBackupSnapshot({
    paperPacks: [paperPack],
    colorsById: { [color.id]: color },
    cards: [card],
    tagVocabularies: {
      paper: ["Saved Paper Tag"],
      card: ["Saved Card Tag"]
    }
  });
  const persistedCalls = [];
  let cardsRestoredEvents = 0;
  const paperPacks = [];
  const colorsById = {};

  assert.equal(backup.cards.length, 1);
  assert.equal(backup.cards[0].id, card.id);
  assert.equal(backup.cards[0].imagePath, card.imagePath);
  assert.equal(backup.cards[0].thumbnailImagePath, card.thumbnailImagePath);
  assert.equal("imagePreviewSrc" in backup.cards[0], false);
  assert.equal(backup.imageStorage.folderImageReferences, 2);
  assert.equal(backup.tagCatalog.tags.some((tag) => tag.name === "Saved Paper Tag"), true);
  assert.equal(backup.tagCatalog.tags.some((tag) => tag.name === "Saved Card Tag"), true);
  assert.equal(backup.tagCatalog.tags.some((tag) => tag.name === "birthday"), true);
  assert.equal("tags" in backup.cards[0], false);
  assert.equal(Array.isArray(backup.cards[0].tagIds), true);

  const summary = await restoreCatalogBackup({
    backup: JSON.parse(JSON.stringify(backup)),
    paperPacks,
    colorsById,
    services: {
      loadSavedCards: async () => [],
      preparePaperPack: async (record) => ({ paperPack: record }),
      restoreCatalogRecords: async (records) => persistedCalls.push(records),
      dispatchCardsRestored: () => { cardsRestoredEvents += 1; }
    }
  });

  assert.deepEqual(summary.errors, []);
  assert.equal(summary.packsImported, 1);
  assert.equal(summary.colorsImported, 1);
  assert.equal(summary.cardsImported, 1);
  assert.equal(persistedCalls.length, 1);
  assert.deepEqual(persistedCalls[0].cards, backup.cards);
  assert.deepEqual(persistedCalls[0].tagCatalog, backup.tagCatalog);
  assert.equal(paperPacks[0].id, paperPack.id);
  assert.equal(colorsById[color.id].name, color.name);
  assert.equal(cardsRestoredEvents, 1);
});

test("compact iPad backup round-trip carries the global catalog and tagIds", async () => {
  const { color, paperPack, card } = createCatalogRecords();
  const migrated = migrateLegacyTagData({ paperRecords: [paperPack], cardRecords: [card] });
  const backup = await createIpadCatalogBackup({
    paperPacks: [paperPack], colorsById: { [color.id]: color },
    services: {
      loadSavedCards: async () => [card], loadGlobalTagCatalog: async () => migrated.catalog,
      loadSavedStampDieSets: async () => [],
      hydrateCardImageSources: async () => {}
    }
  });
  const writes = [];
  const summary = await restoreCatalogBackup({
    backup, paperPacks: [], colorsById: {},
    services: {
      loadGlobalTagCatalog: async () => ({ schemaVersion: 1, tags: [], categories: [] }),
      loadSavedCards: async () => [], preparePaperPack: async (record) => ({ paperPack: record }),
      restoreCatalogRecords: async (records) => writes.push(records), dispatchCardsRestored: () => {}
    }
  });
  assert.deepEqual(summary.errors, []);
  assert.equal(backup.backupProfile, "ipad-compact-embedded-images-v2");
  assert.equal("tagVocabularies" in backup, false);
  assert.equal(Array.isArray(backup.paperPacks[0].tagIds), true);
  assert.equal(Array.isArray(backup.cards[0].tagIds), true);
  assert.deepEqual(writes[0].tagCatalog, backup.tagCatalog);
});

test("restore planning does not hydrate existing Cards against the pre-reconciliation catalog", async () => {
  const { color, paperPack, card } = createCatalogRecords();
  const backup = createCatalogBackupSnapshot({
    paperPacks: [paperPack], colorsById: { [color.id]: color }, cards: [card]
  });
  let transitionalLoaderCalls = 0;
  const writes = [];
  const summary = await restoreCatalogBackup({
    backup, paperPacks: [], colorsById: {},
    services: {
      loadGlobalTagCatalog: async () => ({ schemaVersion: 1, tags: [], categories: [] }),
      loadSavedCards: async () => { transitionalLoaderCalls += 1; throw new Error("old catalog cannot hydrate imported IDs"); },
      loadSavedCardRecordsForRestore: async () => [],
      preparePaperPack: async (record) => ({ paperPack: record }),
      restoreCatalogRecords: async (records) => writes.push(records), dispatchCardsRestored: () => {}
    }
  });
  assert.deepEqual(summary.errors, []);
  assert.equal(transitionalLoaderCalls, 0);
  assert.equal(writes.length, 1);
});

test("legacy backup without tag vocabularies reconstructs them from records and the Paper seed", async () => {
  const { color, paperPack, card } = createCatalogRecords();
  paperPack.keywords = ["Legacy Paper Assignment"];
  card.tags = ["Legacy Card Assignment"];
  const backup = createCatalogBackupSnapshot({ paperPacks: [paperPack], colorsById: { [color.id]: color }, cards: [card] });
  backup.schemaVersion = 2;
  delete backup.tagCatalog;
  backup.paperPacks[0].keywords = ["Legacy Paper Assignment"];
  delete backup.paperPacks[0].tagIds;
  backup.cards[0].tags = ["Legacy Card Assignment"];
  delete backup.cards[0].tagIds;
  const persistedCalls = [];

  const summary = await restoreCatalogBackup({
    backup,
    paperPacks: [],
    colorsById: {},
    services: {
      loadSavedCards: async () => [],
      preparePaperPack: async (record) => ({ paperPack: record }),
      restoreCatalogRecords: async (records) => persistedCalls.push(records),
      dispatchCardsRestored: () => {}
    }
  });

  assert.deepEqual(summary.errors, []);
  assert.equal(persistedCalls[0].tagCatalog.tags.some((tag) => tag.name === "Legacy Paper Assignment"), true);
  assert.equal(persistedCalls[0].tagCatalog.tags.some((tag) => tag.name === "Legacy Card Assignment"), true);
});

test("restore treats a missing saved Paper tag vocabulary as empty", async () => {
  const { color, paperPack, card } = createCatalogRecords();
  const backup = createCatalogBackupSnapshot({
    paperPacks: [paperPack],
    colorsById: { [color.id]: color },
    cards: [card]
  });
  const persistedCalls = [];

  const summary = await restoreCatalogBackup({
    backup,
    paperPacks: [],
    colorsById: {},
    services: {
      loadSavedCards: async () => [],
      preparePaperPack: async (record) => ({ paperPack: record }),
      restoreCatalogRecords: async (records) => persistedCalls.push(records),
      dispatchCardsRestored: () => {}
    }
  });

  assert.deepEqual(summary.errors, []);
  assert.equal(persistedCalls.length, 1);
});

test("malformed import is rejected before reading or writing catalog storage", async () => {
  const { color, paperPack, card } = createCatalogRecords();
  const backup = createCatalogBackupSnapshot({
    paperPacks: [paperPack],
    colorsById: { [color.id]: color },
    cards: [{ ...card, size: { width: "invalid", height: 5.5 } }]
  });
  let storageCalls = 0;

  const summary = await restoreCatalogBackup({
    backup,
    paperPacks: [],
    colorsById: {},
    services: {
      loadSavedCards: async () => { storageCalls += 1; return []; },
      restoreCatalogRecords: async () => { storageCalls += 1; }
    }
  });

  assert.equal(storageCalls, 0);
  assert.deepEqual(summary.errors, ["Nothing was imported because Card record 1 is invalid."]);
});

test("failed atomic restore leaves all in-memory catalog collections unchanged", async () => {
  const { color, paperPack, card } = createCatalogRecords();
  const backup = createCatalogBackupSnapshot({
    paperPacks: [paperPack],
    colorsById: { [color.id]: color },
    cards: [card]
  });
  const paperPacks = [];
  const colorsById = {};
  let atomicWrites = 0;

  const summary = await restoreCatalogBackup({
    backup,
    paperPacks,
    colorsById,
    services: {
      loadSavedCards: async () => [],
      preparePaperPack: async (record) => ({ paperPack: record }),
      restoreCatalogRecords: async () => {
        atomicWrites += 1;
        throw new Error("simulated transaction abort");
      }
    }
  });

  assert.equal(atomicWrites, 1);
  assert.deepEqual(paperPacks, []);
  assert.deepEqual(colorsById, {});
  assert.deepEqual(summary.errors, [
    "Nothing was imported because the catalog could not be saved as one complete transaction."
  ]);
  assert.equal(summary.packsImported, 0);
  assert.equal(summary.colorsImported, 0);
  assert.equal(summary.cardsImported, 0);
});

for (const fail of [false, true]) {
  test(`shared metadata refresh happens only after successful restore (failure=${fail})`, async () => {
    const backup = createCatalogBackupSnapshot({ paperPacks: [], colorsById: {},
      owners: [{ id: 'owner-new', name: 'New Owner' }],
      tagCatalog: { schemaVersion: 1, tags: [{ id: 'tag-new', name: 'New Tag', categoryIds: ['category-new'] }],
        categories: [{ id: 'category-new', name: 'New Category' }] }
    });
    const owners = []; let committed = false; let refreshes = 0;
    const summary = await restoreCatalogBackup({ backup, paperPacks: [], colorsById: {}, owners, services: {
      loadSavedCards: async () => [],
      restoreCatalogRecords: async () => { if (fail) throw new Error('Simulated failure'); committed = true; },
      dispatchCatalogRestored: () => {
        assert.equal(committed, true);
        assert.equal(owners[0].id, 'owner-new');
        refreshes++;
      }
    } });
    assert.equal(refreshes, fail ? 0 : 1);
    assert.equal(summary.errors.length > 0, fail);
    assert.equal(summary.cardsImported, 0);
    assert.equal(summary.setsImported, 0);
  });
}

test('restore broadcasts the shared owner and taxonomy events used by existing views', async (t) => {
  const previous = globalThis.document;
  t.after(() => { globalThis.document = previous; });
  const events = [];
  globalThis.document = { dispatchEvent: (event) => events.push([event.type, event.detail]) };
  const backup = createCatalogBackupSnapshot({ paperPacks: [], colorsById: {} });
  await restoreCatalogBackup({ backup, paperPacks: [], colorsById: {}, services: {
    loadGlobalTagCatalog: async () => ({ schemaVersion: 1, tags: [], categories: [] }),
    loadSavedCards: async () => [], restoreCatalogRecords: async () => {}
  } });
  assert.deepEqual(events, [['catalog:owners-updated', null], ['catalog:global-tags-updated', { source: 'restore' }]]);
});

test('taxonomy-only replacement always requires confirmation explaining deletions on retained products', async () => {
  const { summarizeBackupOverwrites } = await import('./backup.js');
  const backup = createCatalogBackupSnapshot({ paperPacks: [], colorsById: {},
    tagCatalog: { schemaVersion: 1, tags: [], categories: [] } });
  const result = await summarizeBackupOverwrites(backup, [], {}, { loadSavedCards: async () => [] });
  assert.equal(result.requiresConfirmation, true);
  assert.match(result.message, /replace the complete tag and category catalog/);
  assert.match(result.message, /absent from the backup will be removed/);
  assert.match(result.message, /assignments to deleted tags will be cleared/);
  assert.match(result.message, /retained local products/);
});

test('replacement of a legacy backup does not infer tag/category deletions', async () => {
  const local = { schemaVersion: 1, tags: [{ id: 'keep', name: 'Keep', categoryIds: ['cat'] }], categories: [{ id: 'cat', name: 'Category' }] };
  const backup = createCatalogBackupSnapshot({ paperPacks: [], colorsById: {} });
  delete backup.tagCatalog;
  backup.schemaVersion = 2;
  let saved;
  const result = await restoreCatalogBackup({ backup, paperPacks: [], colorsById: {}, overwriteExisting: true,
    services: { loadSavedCards: async () => [], loadGlobalTagCatalog: async () => local,
      restoreCatalogRecords: async records => { saved = records; } }
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(saved.tagCatalog, local);
  assert.equal(saved.retainedTagIdMap, undefined);
  assert.ok(result.notes.some(note => note.includes('deletions were not applied')));
});
