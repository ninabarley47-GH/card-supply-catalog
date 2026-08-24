import test from 'node:test';
import assert from 'node:assert/strict';

import { CATALOG_SCHEMA_VERSION } from './schema.js';
import { isCard, normalizeCardForRuntime } from './storage.js';
import { createCatalogBackupSnapshot } from './backup.js';

function createCard(overrides = {}) {
  return {
    id: 'card-one',
    dateCreated: '2026-08-24',
    size: { width: 4.25, height: 5.5 },
    tags: [],
    stampSets: [],
    paperPackIds: [],
    colorIds: [],
    favorite: false,
    ...overrides
  };
}

test('legacy Cards without status migrate to available', () => {
  const legacyCard = createCard();
  assert.equal(isCard(legacyCard), true);
  assert.equal(normalizeCardForRuntime(legacyCard).status, 'available');
});

test('Card status preserves sent and rejects unknown persisted values', () => {
  assert.equal(normalizeCardForRuntime(createCard({ status: 'sent' })).status, 'sent');
  assert.equal(isCard(createCard({ status: 'other' })), false);
});

test('Card backups explicitly include normalized status and current catalog schema', () => {
  const backup = createCatalogBackupSnapshot({ paperPacks: [], colorsById: {}, cards: [createCard()] });
  assert.equal(backup.cards[0].status, 'available');
  assert.equal(backup.cards[0].schemaVersion, CATALOG_SCHEMA_VERSION);
  assert.equal(backup.catalogSchemaVersion, CATALOG_SCHEMA_VERSION);
});
