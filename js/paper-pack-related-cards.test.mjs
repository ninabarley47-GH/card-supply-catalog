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

// Exercise the existing renderer with a small DOM and controlled image sources.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('./library.js', import.meta.url), 'utf8');
function relatedRenderer() {
  const context = vm.createContext({ findCardsUsingPaperPack, getCardLibraryImageSource: card => card.image,
    document: { createElement(tag) { return { tag, children: [], dataset: {}, attributes: {}, listeners: {},
      append(...nodes) { this.children.push(...nodes); },
      replaceChildren(...nodes) { this.children = nodes; },
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(type, callback, options) { this.listeners[type] = { callback, options }; }
    }; } } });
  vm.runInContext(source.slice(source.indexOf('function createRelatedCardsSection('), source.indexOf('function createPatternViewer(')), context);
  return context.createRelatedCardsSection;
}
test('Paper related Cards show identifying captions and accessible labels with Stamp thumbnail classes', () => {
  const records = [
    { id: 'one', paperPackIds: ['paper'], dateCreated: '2026-09-01', size: { width: 4.25, height: 5.5 }, image: 'one.jpg' },
    { id: 'two', paperPackIds: ['paper'], dateCreated: '2026-09-02', size: { width: 6, height: 4 }, image: null },
    { id: 'other', paperPackIds: ['other'] }
  ];
  const before = structuredClone(records);
  const section = relatedRenderer()({ id: 'paper' }, records);
  assert.equal(section.children[0].textContent, 'Cards Using This Paper');
  const grid = section.children[1]; assert.equal(grid.className, 'related-cards-grid');
  assert.equal(grid.children.length, 2);
  for (const [index, card] of records.slice(0, 2).entries()) {
    const button = grid.children[index];
    assert.equal(button.className, 'related-card-link');
    assert.equal(button.dataset.relatedCardId, card.id);
    assert.equal(button.attributes['aria-label'], `Open Card created ${card.dateCreated}, ${card.size.width} by ${card.size.height} inches`);
    assert.equal(button.children[1].textContent, `${card.dateCreated} \u00b7 ${card.size.width} \u00d7 ${card.size.height} inches`);
  }
  const image = grid.children[0].children[0];
  assert.equal(image.alt, 'Card created 2026-09-01, 4.25 by 5.5 inches');
  assert.equal(image.className, 'related-card-thumbnail');
  const missing = grid.children[1].children[0];
  assert.equal(missing.textContent, 'No image yet');
  assert.equal(missing.className, 'related-card-thumbnail related-card-thumbnail-missing');
  const caption = grid.children[0].children[1];
  assert.equal(image.listeners.error.options.once, true);
  image.listeners.error.callback();
  assert.equal(grid.children[0].children[0].textContent, 'No image yet');
  assert.equal(grid.children[0].children[1], caption);
  assert.equal(grid.children[0].dataset.relatedCardId, 'one');
  assert.deepEqual(records, before);
});
test('Paper Detail still omits the related section when no Cards use the Pack', () => {
  assert.equal(relatedRenderer()({ id: 'unused' }, cards), null);
});
