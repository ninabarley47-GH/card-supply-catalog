import { inheritImageReferenceState } from './image-references.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createCardRecord, filterAndSortCards } from './cards.js';
import { createCardContextBar } from './library.js';
import { normalizeCardForRuntime } from './storage.js';
const source = await readFile(new URL('./cards.js', import.meta.url), 'utf8');
const view = () => ({ existingCard: null, notes: { value: '' }, status: { value: 'available' },
  dateCreated: { value: '2026-09-09' }, sizePreset: { value: 'custom' }, width: { value: 4 }, height: { value: 6 },
  tagPicker: { getSelectedTags: () => [] }, stampSets: [], paperPackIds: [], favorite: { checked: false } });

test('Card Add sets Recently Added; Edit and runtime normalization preserve explicit status without marking legacy Cards', () => {
  const form = view(); const added = createCardRecord(form);
  assert.equal(added.recentlyAdded, true);
  for (const flag of [true, false, undefined]) {
    form.existingCard = { ...added, recentlyAdded: flag };
    const edited = createCardRecord(form);
    assert.equal(edited.recentlyAdded, flag);
    assert.equal(edited.id, added.id);
    assert.equal(normalizeCardForRuntime(edited, { schemaVersion: 1, tags: [], categories: [] }).recentlyAdded, flag);
  }
});

test('Card default sorting promotes explicitly Recently Added Cards and retains explicit date/favorite sorts', () => {
  const cards = [{ id: 'old', dateCreated: '2026-09-09', favorite: true },
    { id: 'recent', dateCreated: '2020-01-01', recentlyAdded: true },
    { id: 'dismissed', dateCreated: '2025-01-01', recentlyAdded: false }];
  const options = { tagCatalog: { schemaVersion: 1, tags: [], categories: [] } };
  assert.deepEqual(filterAndSortCards(cards, options).map(card => card.id), ['recent', 'old', 'dismissed']);
  assert.deepEqual(filterAndSortCards(cards, { ...options, sortOrder: 'date-desc' }).map(card => card.id), ['old', 'dismissed', 'recent']);
  assert.deepEqual(filterAndSortCards(cards, { ...options, sortOrder: 'date-asc' }).map(card => card.id), ['recent', 'dismissed', 'old']);
  assert.deepEqual(filterAndSortCards(cards, { ...options, sortOrder: 'favorite-desc' }).map(card => card.id), ['old', 'dismissed', 'recent']);
  assert.deepEqual(cards.map(card => card.id), ['old', 'recent', 'dismissed']);
});

function node(tag) { return { tag, dataset: {}, children: [], attributes: {},
  setAttribute(key, value) { this.attributes[key] = value; }, append(...children) { this.children.push(...children); } }; }
test('Card tile places the shared banner first and uses an identifying dismissal label', t => {
  const previous = globalThis.document; t.after(() => { globalThis.document = previous; });
  const document = { createElement: node }; globalThis.document = document;
  const context = vm.createContext({ inheritImageReferenceState, document, createCardContextBar,
    applyCardMockupSize() {}, getCardPlaceholderNumber: () => 1, getCardLibraryImageSource: () => '', createCardImage: () => null,
    createMissingCardImageMessage: () => node('missing'), createCardFavoriteButton: () => node('favorite'),
    createCardLibraryMetadata: () => node('metadata'), createCardLibraryActions: () => node('actions') });
  vm.runInContext(source.slice(source.indexOf('function createCardTile('), source.indexOf('function createCardLibraryActions(')), context);
  for (const flag of [true, false, undefined, 'true']) {
    const tile = context.createCardTile({ id: 'one', dateCreated: '2026-09-09', tags: [], recentlyAdded: flag }, 0);
    if (flag === true) {
      assert.equal(tile.children[0].className, 'card-context-bar');
      const [label, button] = tile.children[0].children;
      assert.equal(label.textContent, 'Recently Added');
      assert.equal(button.dataset.clearRecentlyAdded, 'one');
      assert.match(button.attributes['aria-label'], /card created 2026-09-09/);
    } else assert.notEqual(tile.children[0].className, 'card-context-bar');
  }
});

for (const fail of [false, true]) test(`Card dismissal clears only the flag, does not open Detail, and retains session state on save failure=${fail}`, async () => {
  const card = { id: 'one', recentlyAdded: true, imagePath: 'card.jpg', notes: 'Keep', favorite: true, paperPackIds: ['paper'] };
  const cards = [card]; let saved, calls = 0, renders = 0, alert = '', opens = 0;
  const listeners = {};
  const context = vm.createContext({ inheritImageReferenceState, cards, gallery: { addEventListener: (name, listener) => { listeners[name] = listener; } },
    renderCurrent: () => renders++, saveCard: async value => { calls++; saved = value; if (fail) throw new Error('Failed'); },
    window: { alert: message => { alert = message; } }, detailNavigation: { open() { opens++; } } });
  vm.runInContext(source.slice(source.indexOf('async function clearCardRecentlyAddedStatus('), source.indexOf('function createCardFavoriteButton(')), context);
  vm.runInContext(source.slice(source.indexOf("  gallery.addEventListener('click'"), source.indexOf("  gallery.addEventListener('keydown'")), context);
  let stopped = false;
  const event = { target: { closest: selector => selector === '[data-clear-recently-added]' ? { dataset: { clearRecentlyAdded: 'one' } } : null },
    preventDefault() {}, stopPropagation() { stopped = true; } };
  await listeners.click(event); await listeners.click(event);
  assert.deepEqual({ ...saved }, { ...card, recentlyAdded: false });
  assert.equal(cards[0], saved); assert.equal(card.recentlyAdded, true);
  assert.equal(calls, 1); assert.equal(renders, 1); assert.equal(opens, 0); assert.equal(stopped, true);
  assert.equal(Boolean(alert), fail);
  if (fail) assert.match(alert, /cleared for this session/);
});

test('Card dismissal keyboard activation does not open the enclosing Detail tile', () => {
  const handlers = {}; let opens = 0;
  const context = vm.createContext({ inheritImageReferenceState, gallery: { addEventListener: (name, handler) => { handlers[name] = handler; } },
    detailNavigation: { open() { opens++; } } });
  vm.runInContext(source.slice(source.indexOf("  gallery.addEventListener('keydown'"), source.indexOf("  detailView.close.addEventListener")), context);
  for (const key of ['Enter', ' ']) handlers.keydown({ key, target: { closest: selector => selector.includes('[data-clear-recently-added]') ? {} : { dataset: { cardId: 'one' } } }, preventDefault() {} });
  assert.equal(opens, 0);
});
