import assert from "node:assert/strict";
import test from "node:test";

import { findCardsUsingPaperPack } from "./library.js";
import { applyCardDetailSourceState } from "./cards.js";

const cards = [
  { id: "one", paperPackIds: ["pack-a"] },
  { id: "two", paperPackIds: ["pack-b", "pack-c"] },
  { id: "three", paperPackIds: ["pack-c"] }
];

test("finds no cards for an unused paper pack", () => {
  assert.deepEqual(findCardsUsingPaperPack(cards, "unused"), []);
});

test("finds exactly one card by paper-pack ID", () => {
  assert.deepEqual(findCardsUsingPaperPack(cards, "pack-a").map((card) => card.id), ["one"]);
});

test("finds all cards using a paper pack", () => {
  assert.deepEqual(findCardsUsingPaperPack(cards, "pack-c").map((card) => card.id), ["two", "three"]);
});

test("a card with multiple paper packs matches each pack", () => {
  assert.deepEqual(findCardsUsingPaperPack(cards, "pack-b").map((card) => card.id), ["two"]);
  assert.deepEqual(findCardsUsingPaperPack(cards, "pack-c").map((card) => card.id), ["two", "three"]);
});

test("Card Detail preserves and clears its source paper-pack ID in transient UI state", () => {
  const overlay = { dataset: {} };
  const back = { hidden: true, textContent: "" };

  applyCardDetailSourceState(overlay, "pack-a", back, "Paper Pack A");
  assert.equal(overlay.dataset.sourcePaperPackId, "pack-a");
  assert.equal(back.hidden, false);
  assert.equal(back.textContent, "← Back to Paper Pack A");

  applyCardDetailSourceState(overlay, "pack-b", back, "Paper Pack B");
  assert.equal(overlay.dataset.sourcePaperPackId, "pack-b");
  assert.equal(back.textContent, "← Back to Paper Pack B");

  applyCardDetailSourceState(overlay, "", back);
  assert.equal("sourcePaperPackId" in overlay.dataset, false);
  assert.equal(back.hidden, true);
  assert.equal(back.textContent, "");
});
