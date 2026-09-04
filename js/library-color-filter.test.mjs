import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { filterLibraryColorOptions, updateLibraryColorSelection } from './library.js';

const colors = [
  { id: 'mossy-meadow', name: 'Mossy Meadow' },
  { id: 'lost-lagoon', name: 'Lost Lagoon' },
  { id: 'pretty-peacock', name: 'Pretty Peacock' }
];

test('Paper color type-ahead matches partial names and sorts them alphabetically', () => {
  assert.deepEqual(
    filterLibraryColorOptions(colors, 'lo').map((color) => color.name),
    ['Lost Lagoon']
  );

  assert.deepEqual(
    filterLibraryColorOptions(colors, '').map((color) => color.name),
    ['Lost Lagoon', 'Mossy Meadow', 'Pretty Peacock']
  );
});

test('Paper color type-ahead keeps selected colors out of the suggestion list', () => {
  assert.deepEqual(
    filterLibraryColorOptions(colors, '', ['lost-lagoon']).map((color) => color.name),
    ['Mossy Meadow', 'Pretty Peacock']
  );
});

test('selected color IDs persist independently of the rebuilt chip and suggestion views', () => {
  let selected = updateLibraryColorSelection([], 'balmy-blue', true);
  assert.deepEqual(selected, ['balmy-blue']);
  selected = updateLibraryColorSelection(selected, 'night-of-navy', true);
  assert.deepEqual(selected, ['balmy-blue', 'night-of-navy']);
  selected = updateLibraryColorSelection(selected, 'balmy-blue', false);
  assert.deepEqual(selected, ['night-of-navy']);
});

test('color suggestions use direct click buttons instead of hidden checkbox change events', async () => {
  const source = await readFile(new URL('./library.js', import.meta.url), 'utf8');
  const createMatch = source.slice(source.indexOf('function createLibraryColorMatch'), source.indexOf('function renderSelectedLibraryColors'));
  assert.match(createMatch, /document\.createElement\("button"\)/);
  assert.match(createMatch, /button\.type = "button"/);
  assert.doesNotMatch(createMatch, /checkbox|change/);
});
