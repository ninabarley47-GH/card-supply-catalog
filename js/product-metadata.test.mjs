import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePaperPackForRuntime, normalizeCardForRuntime } from './storage.js';
import { normalizeStampDieSet } from './stamp-die-sets.js';
import { buildPaperPackFromForm } from './add-dsp.js';
import { createCardRecord } from './cards.js';
import { createStampDieSetRecord } from './stamp-die-library.js';

const catalog = { schemaVersion: 1, tags: [], categories: [] };
const metadata = { brand: 'Stampin\' Up!', purchasedFrom: 'Scrapbooking.com' };
const paper = (values = {}) => ({ id: 'paper-1', name: 'Paper', ownerId: 'owner-1', releaseYear: 2026,
  patternCount: 1, colors: ['red'], tagIds: [], patterns: [], ...values });
const card = (values = {}) => ({ id: 'card-1', dateCreated: '2026-10-19', size: { width: 4, height: 6 },
  tags: [], stampSets: [], paperPackIds: [], colorIds: [], favorite: false, ...values });
const set = (values = {}) => ({ id: 'set-1', name: 'Garden', dateCreated: '2026-10-19', imageRefs: [],
  tagIds: [], favorite: false, ...values });

test('Paper, Card, and Stamp & Die normalization preserve short Brand and Purchased From metadata', () => {
  assert.deepEqual(normalizePaperPackForRuntime(paper(metadata), catalog).brand, metadata.brand);
  assert.deepEqual(normalizeCardForRuntime(card(metadata), catalog).purchasedFrom, metadata.purchasedFrom);
  assert.deepEqual(normalizeStampDieSet(set(metadata), catalog).brand, metadata.brand);
  for (const normalize of [
    value => normalizePaperPackForRuntime(paper(value), catalog),
    value => normalizeCardForRuntime(card(value), catalog),
    value => normalizeStampDieSet(set(value), catalog)
  ]) {
    assert.equal(normalize({ brand: '  Stampin\' Up!  ', purchasedFrom: '  Amazon  ' }).brand, metadata.brand);
    assert.equal(normalize({ brand: '  Stampin\' Up!  ', purchasedFrom: '  Amazon  ' }).purchasedFrom, 'Amazon');
    assert.equal('brand' in normalize({ brand: null, purchasedFrom: undefined }), false);
    assert.equal(normalize({ brand: '', purchasedFrom: '' }).brand, '');
    assert.equal(normalize({ brand: 'b'.repeat(100), purchasedFrom: 'p'.repeat(100) }).purchasedFrom.length, 100);
    assert.throws(() => normalize({ brand: 'b'.repeat(101) }), /100 characters or fewer/);
    assert.throws(() => normalize({ purchasedFrom: 42 }), /Purchased From must be a string/);
  }
});

test('existing edit record builders retain Brand and Purchased From when those fields are not in the UI', () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({ name: 'Edited Paper', owner: 'Nina', releaseYear: '2026', patternCount: '1', colors: 'red', availability: 'available', refillAvailable: '' })) form.set(key, value);
  const existingPaper = paper({ ...metadata, owner: 'Nina', keywords: [] });
  const paperResult = buildPaperPackFromForm(form, { red: { id: 'red', name: 'Red' } }, [], existingPaper);
  assert.deepEqual({ brand: paperResult.paperPack.brand, purchasedFrom: paperResult.paperPack.purchasedFrom }, metadata);

  const existingCard = card(metadata);
  const cardResult = createCardRecord({ existingCard, notes: { value: '' }, status: { value: 'available' },
    dateCreated: { value: existingCard.dateCreated }, sizePreset: { value: 'custom' }, width: { value: 4 }, height: { value: 6 },
    tagPicker: { getSelectedTags: () => [] }, stampSets: [], paperPackIds: [], favorite: { checked: false } });
  assert.deepEqual({ brand: cardResult.brand, purchasedFrom: cardResult.purchasedFrom }, metadata);

  const setResult = createStampDieSetRecord(set(metadata), catalog);
  assert.deepEqual({ brand: setResult.brand, purchasedFrom: setResult.purchasedFrom }, metadata);
});
