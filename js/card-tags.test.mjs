import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardTagVocabularyStore } from './card-tags.js';

test('loads persisted and assigned Card tags into the effective vocabulary', async () => {
  const store = createCardTagVocabularyStore({ loadVocabulary: async () => ['Saved'], saveVocabulary: async () => {} });
  assert.deepEqual(await store.load([{ tags: ['Assigned'] }]), ['Saved', 'Assigned']);
});

test('persists a normalized new Card tag for future Cards', async () => {
  const writes = [];
  const store = createCardTagVocabularyStore({
    loadVocabulary: async () => ['Birthday'],
    saveVocabulary: async (tags) => writes.push(tags)
  });
  await store.load([]);
  assert.equal(await store.create('  Fun   Fold '), 'Fun Fold');
  assert.deepEqual(writes, [['Birthday', 'Fun Fold']]);
  assert.equal(await store.create('fun fold'), 'Fun Fold');
  assert.equal(writes.length, 1);
});
