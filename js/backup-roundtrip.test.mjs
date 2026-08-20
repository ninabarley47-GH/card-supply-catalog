import test from "node:test";
import assert from "node:assert/strict";
import { createCatalogBackupSnapshot, restoreCatalogBackup } from "./backup.js";

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
  assert.equal(backup.tagVocabularies.paper.includes("Saved Paper Tag"), true);
  assert.equal(backup.tagVocabularies.card.includes("Saved Card Tag"), true);
  assert.equal(backup.tagVocabularies.card.includes("birthday"), true);

  const summary = await restoreCatalogBackup({
    backup: JSON.parse(JSON.stringify(backup)),
    paperPacks,
    colorsById,
    services: {
      loadSavedCards: async () => [],
      loadPaperTagVocabulary: async () => [],
      loadCardTagVocabulary: async () => [],
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
  assert.deepEqual(persistedCalls[0].tagVocabularies, backup.tagVocabularies);
  assert.equal(paperPacks[0].id, paperPack.id);
  assert.equal(colorsById[color.id].name, color.name);
  assert.equal(cardsRestoredEvents, 1);
});

test("legacy backup without tag vocabularies reconstructs them from records and the Paper seed", async () => {
  const { color, paperPack, card } = createCatalogRecords();
  paperPack.keywords = ["Legacy Paper Assignment"];
  card.tags = ["Legacy Card Assignment"];
  const backup = createCatalogBackupSnapshot({
    paperPacks: [paperPack],
    colorsById: { [color.id]: color },
    cards: [card]
  });
  delete backup.tagVocabularies;
  const persistedCalls = [];

  const summary = await restoreCatalogBackup({
    backup,
    paperPacks: [],
    colorsById: {},
    services: {
      loadSavedCards: async () => [],
      loadPaperTagVocabulary: async () => [],
      loadCardTagVocabulary: async () => [],
      preparePaperPack: async (record) => ({ paperPack: record }),
      restoreCatalogRecords: async (records) => persistedCalls.push(records),
      dispatchCardsRestored: () => {}
    }
  });

  assert.deepEqual(summary.errors, []);
  assert.equal(persistedCalls[0].tagVocabularies.paper.includes("Illustration"), true);
  assert.equal(persistedCalls[0].tagVocabularies.paper.includes("Legacy Paper Assignment"), true);
  assert.deepEqual(persistedCalls[0].tagVocabularies.card, ["Legacy Card Assignment"]);
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
      loadPaperTagVocabulary: async () => null,
      loadCardTagVocabulary: async () => [],
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
      loadPaperTagVocabulary: async () => { storageCalls += 1; return []; },
      loadCardTagVocabulary: async () => { storageCalls += 1; return []; },
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
      loadPaperTagVocabulary: async () => [],
      loadCardTagVocabulary: async () => [],
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
