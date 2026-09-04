import test from 'node:test';
import assert from 'node:assert/strict';

import { filterAndSortCards } from './cards.js';

const cards = [
  {
    id: 'favorite-holiday', ownerId: 'owner-nina', status: 'available', favorite: true,
    tagIds: ['holiday', 'scenic'], stampSets: ['Winter Woods'], paperPackIds: [], dateCreated: '2026-01-03'
  },
  {
    id: 'sent-floral', ownerId: 'owner-amanda', status: 'sent', favorite: false,
    tagIds: ['floral'], stampSets: ['Sweet Blooms'], paperPackIds: [], dateCreated: '2026-01-02'
  },
  {
    id: 'favorite-birthday', ownerId: 'owner-nina', status: 'available', favorite: true,
    tagIds: ['birthday'], stampSets: ['Party Time'], paperPackIds: [], dateCreated: '2026-01-01'
  }
];

const tagCatalog = {
  schemaVersion: 1,
  categories: [],
  tags: [
    { id: 'holiday', name: 'Holiday', categoryIds: [] },
    { id: 'scenic', name: 'Scenic', categoryIds: [] },
    { id: 'floral', name: 'Floral', categoryIds: [] },
    { id: 'birthday', name: 'Birthday', categoryIds: [] }
  ]
};
const noTags = { individualTagIds: [], categories: [] };
const ids = (options) => filterAndSortCards([...cards], { selectedTags: noTags, tagCatalog, ...options }).map((card) => card.id);

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
  assert.deepEqual(ids({ selectedTags: { individualTagIds: ['scenic'], categories: [] }, ownerId: 'owner-nina' }), ['favorite-holiday']);
});

test('omitting one quick filter leaves other filters active', () => {
  assert.deepEqual(ids({ ownerId: 'owner-nina', status: 'available' }), ['favorite-holiday', 'favorite-birthday']);
  assert.deepEqual(ids({ status: 'available' }), ['favorite-holiday', 'favorite-birthday']);
});
