import test from "node:test";
import assert from "node:assert/strict";
import {
  PAPER_TAG_SEED,
  buildEffectiveCardTagVocabulary,
  buildEffectivePaperTagVocabulary,
  getTagKey,
  mergeTagVocabularies,
  normalizeTagName,
  uniqueTags
} from "./tag-utils.js";

test("normalizes whitespace while preserving display casing", () => {
  assert.equal(normalizeTagName("  Fun\t  Fold \n"), "Fun Fold");
  assert.equal(getTagKey("  Fun   Fold "), "fun fold");
});

test("prevents case-insensitive duplicates and preserves the first display value", () => {
  assert.deepEqual(uniqueTags(["Birthday", " birthday ", "BIRTHDAY", "Floral"]), ["Birthday", "Floral"]);
});

test("merges vocabularies deterministically in source and item order", () => {
  assert.deepEqual(
    mergeTagVocabularies(["Saved", "Shared"], ["Seed", "shared"], ["Assigned", "saved"]),
    ["Saved", "Shared", "Seed", "Assigned"]
  );
});

test("builds separate Paper and Card vocabularies", () => {
  const paper = buildEffectivePaperTagVocabulary(["Paper Custom"], [{ keywords: ["Pack Assigned"] }]);
  const card = buildEffectiveCardTagVocabulary(["Card Custom"], [{ tags: ["Card Assigned"] }]);

  assert.deepEqual(paper.slice(0, 2), ["Paper Custom", PAPER_TAG_SEED[0]]);
  assert.equal(paper.includes("Pack Assigned"), true);
  assert.equal(paper.includes("Card Custom"), false);
  assert.deepEqual(card, ["Card Custom", "Card Assigned"]);
  assert.equal(card.includes("Paper Custom"), false);
});
