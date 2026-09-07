import test from 'node:test';
import assert from 'node:assert/strict';
import { isCard, normalizeCardForRuntime } from './storage.js';

const createCard = (overrides = {}) => ({
  id: 'card-one', dateCreated: '2026-09-07',
  size: { width: 4.25, height: 5.5 },
  tags: [], stampSets: ['Legacy name'],
  paperPackIds: ['paper-one', 'paper-one'], colorIds: [], favorite: false,
  ...overrides
});

const cases = [
  ['missing field', {}, []],
  ['empty array', { stampDieSetIds: [] }, []],
  ['one ID', { stampDieSetIds: ['set-one'] }, ['set-one']],
  ['multiple and duplicate IDs', { stampDieSetIds: ['set-two', 'set-one', 'set-two'] }, ['set-two', 'set-one']],
  ...[null, 'set-one', 42, false, { id: 'set-one' }].map((value) =>
    [`malformed value ${JSON.stringify(value)}`, { stampDieSetIds: value }, []]),
  ['mixed array', { stampDieSetIds: ['set-one', null, 1, {}, [], false, '', ' ', ' set-two', 'set-two ', 'set-one', 'missing-set'] },
    ['set-one', 'missing-set']],
  ['only invalid entries', { stampDieSetIds: [null, {}, 0, '', ' '] }, []]
];

for (const [label, overrides, expected] of cases) {
  test(`Card loading retains and normalizes Stamp relationships: ${label}`, () => {
    const card = createCard(overrides);
    const before = structuredClone(card);
    assert.equal(isCard(card), true);
    // Exercise the validation-before-normalization sequence used by loadSavedCards.
    const loaded = [card].filter(isCard).map((record) => normalizeCardForRuntime(record));
    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0].stampDieSetIds, expected);
    assert.equal(isCard(loaded[0]), true);
    assert.deepEqual(loaded[0].paperPackIds, before.paperPackIds);
    assert.deepEqual(loaded[0].stampSets, before.stampSets);
    assert.deepEqual(card, before, 'loading must not mutate the stored record');
    assert.deepEqual(normalizeCardForRuntime(loaded[0]), loaded[0], 'normalization is idempotent');
  });
}

test('malformed Stamp relationships do not weaken unrelated Card validation', () => {
  const invalidFields = [
    { id: 1 }, { dateCreated: null }, { size: null },
    { size: { width: '4', height: 6 } }, { size: { width: 4, height: Infinity } },
    { tags: null }, { paperPackIds: undefined }, { paperPackIds: 'paper-one' },
    { colorIds: null }, { favorite: 'false' }, { notes: 42 },
    { ownerId: {} }, { status: 'unknown' }
  ];
  for (const fields of invalidFields) {
    assert.equal(Boolean(isCard(createCard(fields))), false);
    assert.equal(Boolean(isCard(createCard({ ...fields, stampDieSetIds: { malformed: true } }))), false);
  }
});

test('canonical tag-ID Cards also tolerate malformed Stamp relationships', () => {
  const catalog = { schemaVersion: 1, tags: [], categories: [] };
  const card = createCard({ tags: undefined, tagIds: [], stampDieSetIds: 'invalid' });
  assert.equal(isCard(card), true);
  assert.deepEqual(normalizeCardForRuntime(card, catalog).stampDieSetIds, []);
});
import { createCatalogBackupSnapshot, createCatalogBackup, createIpadCatalogBackup, restoreCatalogBackup, validateBackup } from './backup.js';
import { CATALOG_SCHEMA_VERSION, BACKUP_SCHEMA_VERSION } from './schema.js';

const tagCatalog = { schemaVersion: 1, tags: [], categories: [] };
const snapshot = (card) => createCatalogBackupSnapshot({ paperPacks: [], colorsById: {}, cards: [card], tagCatalog });

async function restore(backup) {
  let written;
  const result = await restoreCatalogBackup({ backup: JSON.parse(JSON.stringify(backup)), paperPacks: [], colorsById: {}, owners: [], services: {
    loadGlobalTagCatalog: async () => tagCatalog, loadSavedCards: async () => [], loadSavedStampDieRecordsForRestore: async () => [],
    restoreCatalogRecords: async (records) => { written = records; },
    dispatchCardsRestored() {}, dispatchStampSetsRestored() {}, dispatchCatalogRestored() {}
  } });
  assert.deepEqual(result.errors, []);
  assert.equal(result.cardsImported, 1);
  return written.cards[0];
}

for (const [label, overrides, expected] of cases) {
  test(`backup import normalizes Stamp relationships and retains Paper references: ${label}`, async () => {
    const source = createCard({ ...overrides, tags: undefined, tagIds: [] });
    const backup = snapshot(source);
    assert.deepEqual(backup.cards[0].stampDieSetIds, expected, 'export normalizes references');
    // Inject raw input after export to test actual malformed/legacy import data.
    if ('stampDieSetIds' in overrides) backup.cards[0].stampDieSetIds = overrides.stampDieSetIds;
    else {
      delete backup.cards[0].stampDieSetIds;
      backup.catalogSchemaVersion = 7;
      backup.cards[0].schemaVersion = 7;
    }
    const before = structuredClone(backup);
    assert.equal(validateBackup(backup).ok, true);
    const card = await restore(backup);
    assert.deepEqual(card.stampDieSetIds, expected);
    assert.deepEqual(card.paperPackIds, source.paperPackIds);
    assert.equal(card.schemaVersion, 8);
    assert.deepEqual(backup, before);
    const again = await restore(snapshot(card));
    assert.deepEqual(again, card, 'second export/import preserves stable IDs and Card fields');
  });
}

test('schema 8 standard and compact exports retain both relationship fields; future schemas are rejected', async () => {
  assert.equal(CATALOG_SCHEMA_VERSION, 8);
  assert.equal(BACKUP_SCHEMA_VERSION, 4);
  const card = createCard({ tags: undefined, tagIds: [], stampDieSetIds: ['set-one', 'set-two'] });
  const services = {
    loadCatalogSetting: async () => null, loadSavedCards: async () => [card],
    loadSavedStampDieSets: async () => [], loadGlobalTagCatalog: async () => tagCatalog,
    hydrateCardImageSources: async () => {}
  };
  for (const exportBackup of [createCatalogBackup, createIpadCatalogBackup]) {
    const backup = await exportBackup({ paperPacks: [], colorsById: {}, services });
    assert.equal(backup.catalogSchemaVersion, 8);
    assert.equal(backup.schemaVersion, 4);
    assert.equal(backup.cards[0].schemaVersion, 8);
    assert.equal(validateBackup(backup).ok, true);
    assert.deepEqual(backup.cards[0].stampDieSetIds, card.stampDieSetIds);
    assert.deepEqual(backup.cards[0].paperPackIds, card.paperPackIds);
    const restored = await restore(backup);
    assert.deepEqual(restored.stampDieSetIds, card.stampDieSetIds);
    assert.deepEqual(restored.paperPackIds, card.paperPackIds);
    backup.catalogSchemaVersion = 9;
    assert.equal(validateBackup(backup).ok, false);
  }
});
