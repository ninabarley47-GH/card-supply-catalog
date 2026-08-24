import test from 'node:test';
import assert from 'node:assert/strict';

import { selectNewCardOwnerId } from './cards.js';
import { NEW_OWNER_VALUE, resolveOwnerPicker } from './owner-picker.js';

const owners = [
  { id: 'owner-nina', name: 'Nina' },
  { id: 'owner-amanda', name: 'Amanda' }
];

test('Add Card prefers the valid device Default Owner', () => {
  assert.equal(selectNewCardOwnerId('owner-nina', 'owner-amanda', owners), 'owner-nina');
});

test('Add Card falls back to the last used owner', () => {
  assert.equal(selectNewCardOwnerId('', 'owner-amanda', owners), 'owner-amanda');
  assert.equal(selectNewCardOwnerId('owner-missing', 'owner-amanda', owners), 'owner-amanda');
});

test('Add Card leaves owner unselected when neither owner exists', () => {
  assert.equal(selectNewCardOwnerId('', '', owners), '');
  assert.equal(selectNewCardOwnerId('owner-missing', 'owner-also-missing', owners), '');
});

test('shared owner picker resolves existing owners and creates stable new owner records', () => {
  assert.deepEqual(resolveOwnerPicker({ value: 'owner-amanda' }, { value: '' }, owners), owners[1]);
  const newOwner = resolveOwnerPicker({ value: NEW_OWNER_VALUE }, { value: 'Jordan' }, owners);
  assert.equal(newOwner.name, 'Jordan');
  assert.match(newOwner.id, /^owner-jordan-/);
});
