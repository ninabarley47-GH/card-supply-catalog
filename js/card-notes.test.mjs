import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isCard, normalizeCardForRuntime, normalizeCardNotes } from './storage.js';
import { createCardRecord, createCardNotesSection, filterAndSortCards } from './cards.js';
import { createCatalogBackupSnapshot, createIpadCatalogBackup, restoreCatalogBackup, validateBackup } from './backup.js';

const card = (notes) => ({ id: 'card-notes', dateCreated: '2026-09-07', size: { width: 4, height: 6 },
  tagIds: [], tags: [], stampSets: [], paperPackIds: [], colorIds: [], favorite: true, ...(notes === undefined ? {} : { notes }) });
const tagCatalog = { schemaVersion: 1, tags: [], categories: [] };
const multiline = 'First paragraph\nSecond line\n\nLast paragraph';
const snapshot = (record) => createCatalogBackupSnapshot({ paperPacks: [], colorsById: {}, cards: [record], tagCatalog });

test('Notes normalizes legacy, null and multiline values without mutating original Cards', () => {
  for (const value of [undefined, null, '', ' \n ']) {
    const record = card(value); const before = structuredClone(record);
    assert.equal(isCard(record), true);
    assert.equal(normalizeCardForRuntime(record, tagCatalog).notes, '');
    assert.deepEqual(record, before);
  }
  assert.equal(normalizeCardNotes(`  ${multiline}\n `), multiline);
  assert.equal(normalizeCardNotes('x'.repeat(100000)).length, 100000);
  for (const value of [1, false, {}, []]) {
    assert.equal(isCard(card(value)), false);
    assert.throws(() => normalizeCardForRuntime(card(value), tagCatalog), /Notes must be a string/);
    const backup = snapshot(card('valid')); backup.cards[0].notes = value;
    assert.equal(validateBackup(backup).ok, false);
  }
});

test('shared Add/Edit record path saves, changes and clears multiline Notes', () => {
  const view = { existingCard: null, notes: { value: ` ${multiline} ` }, status: { value: 'sent' },
    dateCreated: { value: '2026-09-07' }, sizePreset: { value: 'custom' }, width: { value: 4 }, height: { value: 6 },
    tagPicker: { getSelectedTags: () => [] }, stampSets: [], paperPackIds: [], favorite: { checked: true } };
  const added = createCardRecord(view);
  assert.equal(added.notes, multiline);
  view.existingCard = { ...added, ownerId: 'owner-1' }; view.notes.value = 'Changed\nNotes';
  const edited = createCardRecord(view);
  assert.equal(edited.notes, 'Changed\nNotes'); assert.equal(edited.id, added.id);
  assert.equal(edited.ownerId, 'owner-1'); assert.equal(edited.status, 'sent');
  view.existingCard = edited; view.notes.value = '';
  assert.equal(createCardRecord(view).notes, '');
});

test('Detail Notes uses plain text and omits empty sections', (t) => {
  const previous = globalThis.document;
  t.after(() => { globalThis.document = previous; });
  globalThis.document = { createElement: (tag) => ({ tag, children: [], append(...nodes) { this.children.push(...nodes); } }) };
  for (const value of [undefined, null, '', '\n  ']) assert.equal(createCardNotesSection(value), null);
  const text = `${multiline}\n<script>alert(1)</script> **plain**`;
  const section = createCardNotesSection(text);
  assert.equal(section.children[0].textContent, 'Notes');
  assert.equal(section.children[1].textContent, text);
  assert.equal(section.children[1].innerHTML, undefined);
});

test('Notes textarea is shared, populated/reset, and absent from tile and search rendering', async () => {
  const source = await readFile(new URL('./cards.js', import.meta.url), 'utf8');
  assert.match(source, /createElement\('textarea'\)/);
  assert.match(source, /createAddCardField\('Notes', notes\)/);
  assert.match(source, /addCardView.notes.value = normalizeCardNotes\(card.notes\)/);
  assert.match(source, /addCardView.notes.value = ''/);
  assert.match(source, /createCardNotesSection\(card.notes\)/);
  assert.doesNotMatch(source.slice(source.indexOf('function createCardTile('), source.indexOf('function createCardDetailView(')), /\bnotes\b/i);
  assert.deepEqual(filterAndSortCards([card('unique-notes-only')], { query: 'unique-notes-only', tagCatalog }), []);
  assert.equal(filterAndSortCards([card('unique-notes-only')], { query: '2026-09-07', tagCatalog }).length, 1);
  const css = await readFile(new URL('../css/cards.css', import.meta.url), 'utf8');
  assert.match(css, /\.card-detail-notes p\s*\{\s*white-space: pre-wrap/);
  assert.match(css, /\.card-detail-notes\s*\{[^}]*overflow-wrap: anywhere/);
});

for (const notes of [undefined, '', multiline]) {
  test(`standard and iPad backup/restore preserve Notes (${notes === undefined ? 'legacy' : notes ? 'multiline' : 'empty'})`, async () => {
    const standard = snapshot(card(notes));
    const ipad = await createIpadCatalogBackup({ paperPacks: [], colorsById: {}, services: {
      loadSavedCards: async () => [card(notes)], loadSavedStampDieSets: async () => [],
      loadGlobalTagCatalog: async () => tagCatalog, hydrateCardImageSources: async () => {} } });
    if (notes === undefined) { delete standard.cards[0].notes; standard.catalogSchemaVersion = 6; standard.cards[0].schemaVersion = 6; }
    for (const backup of [standard, ipad]) {
      assert.equal(validateBackup(backup).ok, true);
      let restored;
      const result = await restoreCatalogBackup({ backup: JSON.parse(JSON.stringify(backup)), paperPacks: [], colorsById: {}, owners: [], services: {
        loadGlobalTagCatalog: async () => tagCatalog, loadSavedCards: async () => [], loadSavedStampDieRecordsForRestore: async () => [],
        restoreCatalogRecords: async (records) => { restored = records.cards; }, dispatchCardsRestored() {}, dispatchStampSetsRestored() {}, dispatchCatalogRestored() {} } });
      assert.deepEqual(result.errors, []);
      assert.equal(restored[0].notes, notes || '');
      for (const key of ['id', 'dateCreated', 'size', 'favorite', 'paperPackIds', 'colorIds', 'tagIds']) assert.deepEqual(restored[0][key], card(notes)[key]);
    }
  });
}
