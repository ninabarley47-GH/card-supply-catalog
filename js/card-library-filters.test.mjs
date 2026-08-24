import test from 'node:test';
import assert from 'node:assert/strict';

import { filterAndSortCards } from './cards.js';

const cards = [
  {
    id: 'favorite-holiday', ownerId: 'owner-nina', status: 'available', favorite: true,
    tags: ['Holiday', 'Scenic'], stampSets: ['Winter Woods'], paperPackIds: [], dateCreated: '2026-01-03'
  },
  {
    id: 'sent-floral', ownerId: 'owner-amanda', status: 'sent', favorite: false,
    tags: ['Floral'], stampSets: ['Sweet Blooms'], paperPackIds: [], dateCreated: '2026-01-02'
  },
  {
    id: 'favorite-birthday', ownerId: 'owner-nina', status: 'available', favorite: true,
    tags: ['Birthday'], stampSets: ['Party Time'], paperPackIds: [], dateCreated: '2026-01-01'
  }
];

const ids = (options) => filterAndSortCards([...cards], options).map((card) => card.id);

test('quick filters work individually', () => {
  assert.deepEqual(ids({ favoritesOnly: true }), ['favorite-holiday', 'favorite-birthday']);
  assert.deepEqual(ids({ ownerId: 'owner-amanda' }), ['sent-floral']);
  assert.deepEqual(ids({ holiday: 'only' }), ['favorite-holiday']);
  assert.deepEqual(ids({ holiday: 'exclude' }), ['sent-floral', 'favorite-birthday']);
  assert.deepEqual(ids({ status: 'sent' }), ['sent-floral']);
});

test('quick filters combine with each other', () => {
  assert.deepEqual(ids({ favoritesOnly: true, ownerId: 'owner-nina', holiday: 'exclude', status: 'available' }), ['favorite-birthday']);
  assert.deepEqual(ids({ ownerId: 'owner-nina', status: 'available' }), ['favorite-holiday', 'favorite-birthday']);
  assert.deepEqual(ids({ holiday: 'only', status: 'available' }), ['favorite-holiday']);
});

test('quick filters combine with existing Search and Tags filters', () => {
  assert.deepEqual(ids({ query: 'winter', status: 'available' }), ['favorite-holiday']);
  assert.deepEqual(ids({ selectedTags: ['Scenic'], ownerId: 'owner-nina' }), ['favorite-holiday']);
});

test('omitting one quick filter leaves other filters active', () => {
  assert.deepEqual(ids({ ownerId: 'owner-nina', status: 'available' }), ['favorite-holiday', 'favorite-birthday']);
  assert.deepEqual(ids({ status: 'available' }), ['favorite-holiday', 'favorite-birthday']);
});
