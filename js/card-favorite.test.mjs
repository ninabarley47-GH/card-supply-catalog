import { inheritImageReferenceState } from './image-references.js';
﻿import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('./cards.js', import.meta.url), 'utf8');
function setup(saveCard = async () => {}) {
  const context = vm.createContext({ inheritImageReferenceState, saveCard, CSS: { escape: value => value }, window: { alert() {} },
    document: { createElement: () => ({ dataset: {}, setAttribute(key, value) { this[key] = value; } }), querySelector: () => null } });
  vm.runInContext(source.slice(source.indexOf('function createCardFavoriteButton('), source.indexOf('function findCard(')), context);
  return context;
}
for (const favorite of [false, true]) test(`Card heart displays and persists toggle from ${favorite}`, async () => {
  let saved;
  const ctx = setup(async card => { saved = card; });
  const card = { id: 'card-1', favorite, paperPackIds: ['paper'], stampDieSetIds: ['set'], notes: 'Keep' };
  const cards = [card];
  const button = ctx.createCardFavoriteButton(card);
  assert.equal(button.className, 'card-library-favorite');
  assert.equal(button.textContent, '\u2665');
  assert.equal(button['aria-pressed'], String(favorite));
  assert.equal(button.dataset.favorite, String(favorite));
  let renders = 0, focused = false;
  await ctx.toggleCardFavorite(card, cards, button, () => renders++, { querySelector: () => ({ focus() { focused = true; } }) });
  assert.equal(saved.favorite, !favorite);
  assert.equal(cards[0], saved);
  assert.equal(card.favorite, favorite);
  assert.equal(saved.paperPackIds, card.paperPackIds);
  assert.equal(saved.stampDieSetIds, card.stampDieSetIds);
  assert.equal(saved.notes, card.notes);
  assert.equal(renders, 1);
  assert.equal(focused, true);
});
test('pending Card Favorite prevents duplicate writes; failed save retains state and permits retry', async () => {
  let reject, calls = 0, renders = 0;
  const ctx = setup(() => { calls++; return new Promise((_, fail) => { reject = fail; }); });
  const card = { id: 'one', favorite: false }; const cards = [card];
  const button = ctx.createCardFavoriteButton(card);
  const pending = ctx.toggleCardFavorite(card, cards, button, () => renders++);
  await ctx.toggleCardFavorite(card, cards, button, () => renders++);
  assert.equal(calls, 1); assert.equal(button.disabled, true);
  reject(new Error('failed')); await pending;
  assert.equal(cards[0], card); assert.equal(card.favorite, false);
  assert.equal(button.disabled, false); assert.equal(renders, 0);
});
test('Card Detail uses the same heart and save handler without moving other metadata', () => {
  assert.match(source, /detailView.titleRow.replaceChildren\(detailView.title, createCardFavoriteButton\(card\)\)/);
  assert.doesNotMatch(source, /appendFact\(facts, 'Favorite'/);
  const handler = source.slice(source.indexOf("detailView.panel.addEventListener('click'"), source.indexOf("const stampDieLink ="));
  assert.match(handler, /await toggleCardFavorite/);
  assert.match(handler, /renderCurrent\(\)/);
  assert.match(handler, /favoriteButton.replaceWith\(createCardFavoriteButton/);
  assert.match(handler, /detailView.panel/);
});
