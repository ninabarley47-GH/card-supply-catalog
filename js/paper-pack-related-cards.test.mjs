import assert from "node:assert/strict";
import test from "node:test";

import { findCardsUsingPaperPack, sortPaperPacks } from "./library.js";
import {
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

test("Paper Library favorites-first sorting prioritizes favorites then names", () => {
  const paperPacks = [
    { id: "b", name: "Bravo", favorite: false },
    { id: "c", name: "Charlie", favorite: true },
    { id: "a", name: "Alpha", favorite: true }
  ];

  assert.deepEqual(
    sortPaperPacks(paperPacks, "favorite-desc").map((paperPack) => paperPack.id),
    ["a", "c", "b"]
  );
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
