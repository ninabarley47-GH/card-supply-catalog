import test from 'node:test';
import assert from 'node:assert/strict';
import { createTagPickerState, getNextTagPickerIndex, getTagPickerChoices } from './tag-picker.js';

test('searches with whitespace-normalized, case-insensitive matching', () => {
  assert.deepEqual(getTagPickerChoices(['Fun Fold', 'Birthday'], [], '  FUN   fold '), [
    { type: 'existing', tag: 'Fun Fold' }
  ]);
});

test('offers Create only when no exact normalized vocabulary match exists', () => {
  assert.deepEqual(getTagPickerChoices(['Fun Fold'], [], ' fun   fold '), [{ type: 'existing', tag: 'Fun Fold' }]);
  assert.deepEqual(getTagPickerChoices(['Fun Fold'], [], 'New Tag').at(-1), { type: 'create', tag: 'New Tag' });
});

test('selects and removes tags without case-insensitive duplicates', () => {
  const picker = createTagPickerState({ vocabulary: ['Birthday'], selected: ['Floral'] });
  picker.select(' birthday ');
  picker.select('BIRTHDAY');
  assert.deepEqual(picker.getSelected(), ['Floral', 'Birthday']);
  picker.remove(' FLORAL ');
  assert.deepEqual(picker.getSelected(), ['Birthday']);
});

test('new tags are immediately available in the same picker state', () => {
  const picker = createTagPickerState();
  picker.addToVocabulary('  New   Technique ');
  picker.select('new technique');
  assert.deepEqual(picker.getVocabulary(), ['New Technique']);
  assert.deepEqual(picker.getSelected(), ['New Technique']);
});

test('keyboard navigation wraps through available choices', () => {
  assert.equal(getNextTagPickerIndex(-1, 3, 1), 0);
  assert.equal(getNextTagPickerIndex(-1, 3, -1), 2);
  assert.equal(getNextTagPickerIndex(2, 3, 1), 0);
  assert.equal(getNextTagPickerIndex(0, 3, -1), 2);
  assert.equal(getNextTagPickerIndex(0, 0, 1), -1);
});
