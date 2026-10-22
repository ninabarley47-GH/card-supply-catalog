import test from 'node:test';
import assert from 'node:assert/strict';
import { getUncatalogedImageFolderCandidates } from './library.js';

test('Paper Find Uncataloged matches catalog names with equivalent and and ampersand spellings', () => {
  const candidates = getUncatalogedImageFolderCandidates([
    { id: 'blooms-bliss', paperPackName: 'Blooms & Bliss' },
    { id: 'other', paperPackName: 'Blooms Bliss' }
  ], [{ id: 'blooms-and-bliss', name: ' Blooms   AND   Bliss ' }]);
  assert.deepEqual(candidates.map(folder => folder.paperPackName), ['Blooms Bliss']);
});
