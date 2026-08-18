import test from "node:test";
import assert from "node:assert/strict";
import { validateBackup } from "./backup.js";

function createValidBackup() {
  return {
    app: "card-supply-catalog",
    schemaVersion: 1,
    colors: {
      "test-color": {
        id: "test-color",
        name: "Test Color",
        hex: "#123456",
        rgb: [18, 52, 86],
        family: "unknown",
        colorFamily: "blue",
        status: "unknown",
        aliases: [],
        products: {}
      }
    },
    paperPacks: [{
      id: "test-pack",
      name: "Test Pack",
      owner: "Tester",
      releaseYear: 2026,
      patternCount: 1,
      colors: ["test-color"],
      keywords: [],
      patterns: [{ id: "pattern-1" }]
    }],
    cards: [{
      id: "test-card",
      dateCreated: "2026-08-17",
      size: { width: 4.25, height: 5.5 },
      tags: [],
      paperPackIds: ["test-pack"],
      colorIds: ["test-color"],
      favorite: false
    }]
  };
}

test("accepts a complete backup and legacy backups without Cards", () => {
  const backup = createValidBackup();
  assert.equal(validateBackup(backup).ok, true);

  delete backup.cards;
  assert.equal(validateBackup(backup).ok, true);
});

test("accepts optional tag vocabularies and backups without them", () => {
  const backup = createValidBackup();
  backup.tagVocabularies = { paper: ["Floral"], card: ["Birthday"] };
  assert.equal(validateBackup(backup).ok, true);

  delete backup.tagVocabularies;
  assert.equal(validateBackup(backup).ok, true);
});

test("rejects malformed tag vocabularies", () => {
  const backup = createValidBackup();
  backup.tagVocabularies = { paper: ["Floral"], card: "Birthday" };

  assert.deepEqual(validateBackup(backup), {
    ok: false,
    message: "Nothing was imported because the tag vocabularies are invalid."
  });
});

test("rejects an invalid record before restore", () => {
  const backup = createValidBackup();
  backup.cards[0].size.width = "not-a-number";

  assert.deepEqual(validateBackup(backup), {
    ok: false,
    message: "Nothing was imported because Card record 1 is invalid."
  });
});

test("rejects duplicate IDs before restore", () => {
  const backup = createValidBackup();
  backup.paperPacks.push({ ...backup.paperPacks[0] });

  assert.deepEqual(validateBackup(backup), {
    ok: false,
    message: 'Nothing was imported because the backup contains duplicate paper pack ID "test-pack".'
  });
});

test("rejects color keys that do not match record IDs", () => {
  const backup = createValidBackup();
  backup.colors["wrong-key"] = backup.colors["test-color"];
  delete backup.colors["test-color"];

  assert.deepEqual(validateBackup(backup), {
    ok: false,
    message: 'Nothing was imported because color key "wrong-key" does not match its record ID.'
  });
});
