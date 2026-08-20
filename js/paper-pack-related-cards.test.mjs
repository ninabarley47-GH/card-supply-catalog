import assert from "node:assert/strict";
import test from "node:test";

import { applyPaperPackDetailCardSourceState, findCardsUsingPaperPack } from "./library.js";
import {
  applyCardDetailSourceState,
  resolvePaperPackDisplayNames,
  resolvePaperPackReferences
} from "./cards.js";

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

test("Card Detail resolves one paper-pack ID to its display name", () => {
  assert.deepEqual(
    resolvePaperPackDisplayNames(["beautiful-gallery"], [
      { id: "beautiful-gallery", name: "Beautiful Gallery" }
    ]),
    ["Beautiful Gallery"]
  );
});

test("Card Detail resolves all paper-pack IDs and retains an unresolved ID as a fallback", () => {
  assert.deepEqual(
    resolvePaperPackDisplayNames(["pack-a", "missing-pack", "pack-b"], [
      { id: "pack-a", name: "Paper Pack A" },
      { id: "pack-b", name: "Paper Pack B" }
    ]),
    ["Paper Pack A", "missing-pack", "Paper Pack B"]
  );
});

test("Card Detail paper-pack references retain IDs and only mark existing packs as resolved", () => {
  assert.deepEqual(
    resolvePaperPackReferences(["pack-a", "missing-pack", "pack-b"], [
      { id: "pack-a", name: "Paper Pack A" },
      { id: "pack-b", name: "Paper Pack B" }
    ]),
    [
      { id: "pack-a", label: "Paper Pack A", resolved: true },
      { id: "missing-pack", label: "missing-pack", resolved: false },
      { id: "pack-b", label: "Paper Pack B", resolved: true }
    ]
  );
});

test("Paper Pack Detail stores and clears its transient Card return context", () => {
  const panel = { dataset: {} };
  const back = { hidden: true };

  applyPaperPackDetailCardSourceState(panel, back, "card-1", "pack-a");
  assert.equal(panel.dataset.sourceCardId, "card-1");
  assert.equal(panel.dataset.sourceCardPaperPackId, "pack-a");
  assert.equal(back.hidden, false);

  applyPaperPackDetailCardSourceState(panel, back);
  assert.equal("sourceCardId" in panel.dataset, false);
  assert.equal("sourceCardPaperPackId" in panel.dataset, false);
  assert.equal(back.hidden, true);
});
