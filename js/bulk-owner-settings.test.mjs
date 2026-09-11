import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createLegacyOwnerId, getOwnerNameKey } from './owners.js';

const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');
function harness({ confirm = true, existing = false, failure = '' } = {}) {
  const owners = existing ? [{ id: 'owner-existing', name: 'New Owner' }] : [];
  const paperPacks = [{ id: 'one', ownerId: 'old' }, { id: 'two', ownerId: 'old' }];
  const before = structuredClone({ owners, paperPacks });
  const form = { addEventListener(type, handler) { this.submit = handler; } };
  const input = { value: 'New Owner' }, button = {}, message = { dataset: {} };
  const nodes = { '[data-bulk-owner-form]': form, '[data-bulk-owner-input]': input,
    '[data-bulk-owner-submit]': button, '[data-bulk-owner-message]': message };
  const calls = [];
  const context = vm.createContext({
    document: { querySelector: selector => nodes[selector] },
    window: { confirm() { calls.push('confirm'); return confirm; } },
    createLegacyOwnerId, getOwnerNameKey,
    saveOwner: async owner => { calls.push('save-owner'); if (failure === 'owner') throw Error('save failed'); },
    savePaperPacks: async packs => { calls.push('save-packs'); if (failure === 'packs') throw Error('save failed'); },
    refreshOwnerOptions: current => { assert.equal(current, owners); calls.push('refresh-owners'); },
    notifyOwnerRegistryUpdated: () => calls.push('notify-owners')
  });
  vm.runInContext(source.slice(source.indexOf('function initializeBulkOwnerSettings('),
    source.indexOf('function initializeSetupStatus(')), context);
  context.initializeBulkOwnerSettings({ owners, paperPacks, onPaperPacksUpdated: () => calls.push('refresh-packs') });
  return { owners, paperPacks, before, calls, message, button, input,
    submit: () => form.submit({ preventDefault() {} }) };
}

test('new owner + Cancel leaves both the registry and Paper Packs unchanged', async () => {
  const h = harness({ confirm: false });
  await h.submit();
  assert.deepEqual(h.calls, ['confirm']);
  assert.deepEqual({ owners: h.owners, paperPacks: h.paperPacks }, h.before);
  assert.match(h.message.textContent, /cancelled/);
});

test('new owner + Confirm persists and notifies only after confirmation, then updates Paper Packs', async () => {
  const h = harness();
  await h.submit();
  assert.deepEqual(h.calls, ['confirm', 'save-owner', 'refresh-owners', 'notify-owners', 'save-packs', 'refresh-packs']);
  assert.equal(h.owners.length, 1);
  assert.ok(h.paperPacks.every(pack => pack.ownerId === h.owners[0].id && pack.owner === 'New Owner'));
  assert.equal(h.message.dataset.tone, 'success');
  assert.equal(h.button.disabled, false);
});

test('existing owner is reused without rewriting or duplicating its registry entry', async () => {
  const h = harness({ existing: true });
  await h.submit();
  assert.deepEqual(h.calls, ['confirm', 'save-packs', 'refresh-packs']);
  assert.deepEqual(h.owners, h.before.owners);
  assert.ok(h.paperPacks.every(pack => pack.ownerId === 'owner-existing'));
  h.calls.length = 0;
  h.input.value = 'New Owner';
  await h.submit();
  assert.deepEqual(h.calls, []);
  assert.match(h.message.textContent, /already owned/);
});

for (const failure of ['owner', 'packs']) test(`${failure} write failure uses the existing error message and retains Paper Packs`, async () => {
  const h = harness({ failure });
  await h.submit();
  assert.deepEqual(h.paperPacks, h.before.paperPacks);
  assert.equal(h.message.dataset.tone, 'error');
  assert.equal(h.button.disabled, false);
  if (failure === 'owner') {
    assert.deepEqual(h.owners, []);
    assert.deepEqual(h.calls, ['confirm', 'save-owner']);
  }
});
