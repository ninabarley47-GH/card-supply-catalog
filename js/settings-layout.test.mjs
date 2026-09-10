import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { initializeSettingsQuickLinks } from './settings.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const sections = [...html.matchAll(/<details class="settings-subsection[^\"]*" id="([^\"]+)"([^>]*)>([\s\S]*?)(?=\n            <details class="settings-subsection|\n          <\/section>)/g)];
const ids = ['owner-settings', 'global-tags-settings', 'library-folders-settings', 'catalog-maintenance-settings', 'catalog-backup-settings', 'setup-status-settings'];

test('six independent native disclosures start with only Owners expanded', () => {
  assert.deepEqual(sections.map(section => section[1]), ids);
  sections.forEach((section, index) => {
    assert.equal(/\bopen\b/.test(section[2]), index === 0);
    assert.doesNotMatch(section[2], /\bname=/, 'sections can stay open independently');
    assert.match(section[3], /^\s*<summary class="settings-summary">/);
    assert.match(section[3], /class="settings-body" role="region" aria-labelledby=/);
  });
});

for (const id of ids) {
  test(`Quick Link opens ${id} before focusing and scrolling, including repeated navigation`, () => {
    assert.match(html, new RegExp(`href="#${id}"`));
    const calls = [];
    const section = { open: false, querySelector: () => ({ focus(options) {
      assert.equal(section.open, true); assert.equal(options.preventScroll, true); calls.push('focus');
    } }), scrollIntoView() { assert.equal(section.open, true); calls.push('scroll'); } };
    let activate;
    const link = { getAttribute: () => `#${id}`, addEventListener: (_, handler) => { activate = handler; } };
    initializeSettingsQuickLinks({ querySelectorAll: () => [link], querySelector: selector => {
      assert.equal(selector, `#${id}`); return section;
    } });
    for (const open of [false, true, false]) {
      section.open = open;
      activate({ preventDefault() { calls.push('prevent'); } });
      assert.equal(section.open, true);
    }
    assert.deepEqual(calls, Array(3).fill(['prevent', 'focus', 'scroll']).flat());
    section.open = false;
    activate({ ctrlKey: true, preventDefault() { assert.fail('modified links retain browser behavior'); } });
    assert.equal(section.open, false);
  });
}

test('Library Folders keeps all four independent control/status groups and image-only health action', () => {
  const folders = sections.find(section => section[1] === 'library-folders-settings')[3];
  for (const key of ['image-library', 'stamp-image-library', 'card-image-library', 'export-library']) {
    assert.match(folders, new RegExp(`data-choose-${key}`));
    assert.match(folders, new RegExp(`data-reconnect-${key}`));
    assert.match(folders, new RegExp(`data-${key}-status aria-live="polite"`));
  }
  assert.equal((folders.match(/class="image-library-group"/g) || []).length, 4);
  assert.match(folders, /data-check-image-libraries/);
  assert.doesNotMatch(folders, /data-export-library-health/);
  assert.match(folders, /independently of your three image libraries/);
});

test('bulk owner form and feedback live in Owners, maintenance keeps image operations', () => {
  const owners = sections[0][3], maintenance = sections[3][3];
  for (const key of ['form', 'input', 'submit', 'message']) assert.match(owners, new RegExp(`data-bulk-owner-${key}`));
  assert.doesNotMatch(maintenance, /data-bulk-owner/);
  for (const key of ['repair-image-library', 'generate-missing-thumbnails', 'generate-missing-card-thumbnails', 'migrate-image-library']) assert.match(maintenance, new RegExp(`data-${key}`));
});

test('relocated owner action preserves confirmation, stable registry matching and Paper Pack updates', async () => {
  const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');
  const start = source.indexOf('function initializeBulkOwnerSettings(');
  const end = source.indexOf('\nfunction ', source.indexOf('function renderBulkOwnerMessage(', start) + 1);
  let submit, saved, refreshed = 0, confirmed = false;
  const input = { value: '  Nina  ', focus() {} }, button = {}, message = { dataset: {} };
  const nodes = { 'form': { addEventListener: (_, handler) => { submit = handler; } }, input, submit: button, message };
  const context = vm.createContext({ document: { querySelector: selector => nodes[selector.match(/data-bulk-owner-(\w+)/)[1]] },
    window: { confirm: () => confirmed }, getOwnerNameKey: name => name.trim().toLowerCase(),
    saveOwner: () => assert.fail('existing owner should be reused'),
    savePaperPacks: async packs => { saved = packs; } });
  vm.runInContext(source.slice(start, end), context);
  const owners = [{ id: 'nina', name: 'Nina' }], packs = [{ id: 'pack', ownerId: 'other', owner: 'Other' }];
  context.initializeBulkOwnerSettings({ owners, paperPacks: packs, onPaperPacksUpdated: () => refreshed++ });
  await submit({ preventDefault() {} });
  assert.equal(saved, undefined); assert.equal(packs[0].ownerId, 'other');
  confirmed = true;
  await submit({ preventDefault() {} });
  assert.equal(saved[0].ownerId, 'nina'); assert.equal(packs[0].owner, 'Nina');
  assert.equal(owners.length, 1); assert.equal(refreshed, 1); assert.equal(input.value, ''); assert.equal(button.disabled, false);
});
