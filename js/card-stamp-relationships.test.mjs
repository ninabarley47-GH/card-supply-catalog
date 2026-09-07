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
