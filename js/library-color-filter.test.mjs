import test from 'node:test';
import assert from 'node:assert/strict';

import { filterLibraryColorOptions } from './library.js';

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
