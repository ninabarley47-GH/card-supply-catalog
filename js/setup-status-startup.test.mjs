import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { renderSetupStatus, checkAllImageLibraries } from './settings.js';

class Element {
  children = []; dataset = {}; textContent = '';
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
}

test('Settings startup defers Paper health scans until Setup Status opens; explicit checks still work', async t => {
  const previous = { document: globalThis.document, window: globalThis.window };
  t.after(() => Object.assign(globalThis, previous));
  const section = { open: false, addEventListener(type, callback) { this[type] = callback; } };
  const container = new Element();
  container.closest = () => section;
  const events = {};
  globalThis.document = { createElement: () => new Element(), querySelector: () => container,
    addEventListener: (name, callback) => { events[name] = callback; } };
  globalThis.window = { showDirectoryPicker() {} };
  let scans = 0, missing = 0;
  const packs = [{ patterns: [{ imagePath: 'Pack/original.jpg' }] }];
  const check = async current => {
    assert.equal(current, packs);
    scans++;
    return { ok: true, summary: { folderName: 'Paper', packsChecked: 1, folderImages: 1,
      imagesFound: 1 - missing, imagesMissing: missing, missingImages: [], embeddedImages: 0 } };
  };
  const services = {
    loadCatalogSetting: async id => id === 'imageLibrary'
      ? { directoryHandle: { name: 'Paper', queryPermission: async () => 'granted' } } : null,
    loadSavedCards: async () => [], loadSavedStampDieSets: async () => [], checkImageLibraryHealth: check
  };
  const pending = [];
  const context = vm.createContext({ document, renderSetupStatus: (...args) => {
    const result = renderSetupStatus(...args, services); pending.push(result); return result;
  } });
  const source = await readFile(new URL('./settings.js', import.meta.url), 'utf8');
  // Run the actual Settings entry point, isolating unrelated Settings controls.
  for (const name of ['initializeSettingsQuickLinks', 'initializeOwnerSettings', 'initializeImageLibrarySettings',
    'initializeCardImageLibrarySettings', 'initializeStampImageLibrarySettings', 'initializeExportLibrarySettings',
    'initializeBulkOwnerSettings', 'initializeTagSettings']) context[name] = () => {};
  vm.runInContext(source.slice(source.indexOf('export function initializeSettings('),
    source.indexOf('export function initializeSettingsQuickLinks(')).replace('export ', '') +
    source.slice(source.indexOf('function initializeSetupStatus('), source.indexOf('async function initializeImageLibrarySettings(')), context);
  context.initializeSettings({ paperPacks: packs });
  await Promise.all(pending);
  assert.equal(scans, 0, 'collapsed Settings startup must not scan Paper originals');
  events['catalog:backup-exported']();
  await Promise.all(pending);
  assert.equal(scans, 0, 'background status updates must also remain lightweight');
  section.open = true;
  section.toggle();
  await Promise.all(pending);
  assert.equal(scans, 1);
  assert.equal(container.children[3].children[0].children[1].textContent, 'Paper: 1 folder image reference found.');
  missing = 1;
  section.toggle();
  await Promise.all(pending);
  assert.equal(scans, 2);
  assert.match(container.children[3].children[0].children[1].textContent, /1 of 1.*need attention/);

  section.open = false;
  const button = {};
  const emptyHealth = async () => ({ ok: true, summary: { folderImages: 0, imagesMissing: 0, missingImages: [] } });
  await checkAllImageLibraries({ button, paperPacks: packs, paperStatus: new Element(), paperHealth: new Element(),
    cardStatus: new Element(), cardHealth: new Element(), stampStatus: new Element(), stampHealth: new Element() },
  { ...services, checkCardImageLibraryHealth: emptyHealth, checkStampImageLibraryHealth: emptyHealth });
  assert.equal(scans, 3, 'explicit Check Image Libraries scans even with Setup Status closed');
  assert.equal(button.disabled, false);
});
