import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the offline app shell includes the complete global tag module graph', async () => {
  const serviceWorker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  for (const moduleName of ['global-tag-filter', 'global-tag-catalog', 'global-tag-management', 'global-tag-persistence']) {
    assert.match(serviceWorker, new RegExp(`"\\.\\/js\\/${moduleName}\\.js"`));
  }
});
