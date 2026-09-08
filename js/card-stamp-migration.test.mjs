import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateCardStampRelationships } from './storage.js';

const sets = [{ id: 'garden', name: 'Garden Flowers' }, { id: 'view', name: 'Peaceful View' },
  { id: 'ambiguous-a', name: 'Duplicated' }, { id: 'ambiguous-b', name: ' duplicated ' }];
const base = { id: 'card', paperPackIds: ['paper-a'], notes: 'Keep notes', imagePath: 'Keep/image.jpg', schemaVersion: 7 };

test('migration converts only unique names ignoring case and surrounding whitespace, preserving unresolved names verbatim', () => {
  const card = { ...base, stampSets: [' GARDEN FLOWERS ', 'Unknown Set', 'Duplicated', 'Garden  Flowers'] };
  const before = structuredClone(card);
  const result = migrateCardStampRelationships(card, sets);
  assert.deepEqual(result, { ...base, stampSets: ['Unknown Set', 'Duplicated', 'Garden  Flowers'], stampDieSetIds: ['garden'] });
  assert.deepEqual(card, before);
  assert.equal(migrateCardStampRelationships(result, sets), result);
});

test('migration merges with stable and missing IDs, deduplicates, and removes fully converted legacy fields', () => {
  const card = { ...base, stampDieSetIds: ['missing-set', 'view', 'view'],
    stampSets: ['Peaceful View', ' peaceful view ', 'Garden Flowers'], stampSet: 'Garden Flowers' };
  assert.deepEqual(migrateCardStampRelationships(card, sets), { ...base, stampDieSetIds: ['missing-set', 'view', 'garden'] });
});

test('legacy singular stampSet is converted only on a unique match', () => {
  assert.deepEqual(migrateCardStampRelationships({ ...base, stampSet: 'peaceful view' }, sets), { ...base, stampDieSetIds: ['view'] });
  const partial = { ...base, stampSet: 'Unknown', stampSets: ['Peaceful View'] };
  assert.deepEqual(migrateCardStampRelationships(partial, sets), { ...base, stampSet: 'Unknown', stampDieSetIds: ['view'] });
});

test('unresolved or absent names do not rewrite a Card; existing IDs never disambiguate a name', () => {
  for (const extra of [{}, { stampSets: [] }, { stampSets: ['Unknown'] }, { stampSet: 'Duplicated' },
    { stampSets: ['Duplicated'], stampDieSetIds: ['ambiguous-a'] }, { stampSets: [null, 7, {}] }]) {
    const card = { ...base, ...extra };
    assert.equal(migrateCardStampRelationships(card, sets), card);
  }
  const card = { ...base, stampSets: ['Garden Flowers'] };
  assert.equal(migrateCardStampRelationships(card, []), card);
});
