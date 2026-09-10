import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSetupStatus } from './settings.js';
import { STAMP_IMAGE_LIBRARY_MARKER } from './stamp-die-images.js';

class Element {
  children = []; dataset = {}; textContent = '';
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}
const folder = (name, permission = 'granted') => ({ directoryHandle: {
  name, queryPermission: async () => permission,
  requestPermission() { assert.fail('Setup Status must not request permission'); },
  getFileHandle() { assert.fail('Stamp/Card status must not add a file scan'); }
} });
const stampRef = path => ({ imageLibrary: STAMP_IMAGE_LIBRARY_MARKER, imagePath: path });

function harness(t, { packs = [], cards = [], sets = [], settings = {}, health, supported = true } = {}) {
  const original = { document: globalThis.document, window: globalThis.window };
  t.after(() => Object.assign(globalThis, original));
  globalThis.document = { createElement: () => new Element() };
  globalThis.window = supported ? { showDirectoryPicker() { assert.fail('must not choose a folder'); } } : {};
  const container = new Element();
  const services = {
    loadCatalogSetting: async id => settings[id] || null,
    loadSavedCards: async () => cards,
    loadSavedStampDieSets: async () => sets,
    checkImageLibraryHealth: async () => health || { summary: {
      folderImages: 0, imagesMissing: 0, missingImages: []
    } }
  };
  return { cards, sets, render: async () => {
    await renderSetupStatus(container, packs, services);
    return container.children.map(item => ({
      title: item.children[0].children[0].textContent,
      lines: item.children[0].children.slice(1).map(line => line.textContent),
      badge: item.children[1].textContent, tone: item.dataset.status,
      childCount: item.children.length
    }));
  } };
}

test('Setup Status has four grouped containers, all catalog counts, and one badge each', async t => {
  const h = harness(t, { packs: [{}, {}], sets: [{}], cards: [{}, {}, {}],
    settings: { lastBackupExportedAt: '2026-09-01T12:00:00Z' } });
  const rows = await h.render();
  assert.deepEqual(rows.map(row => row.title), ['Catalog data', 'Catalog backup', 'Image folders', 'Image references']);
  assert.deepEqual(rows[0].lines, ['Paper Packs: 2', 'Stamp & Die Sets: 1', 'Cards: 3']);
  assert.equal(rows[0].badge, 'Ready');
  assert.equal(rows[1].badge, 'Exported'); assert.match(rows[1].lines[0], /^Last export: /);
  for (const row of rows) assert.equal(row.childCount, 2, 'one content block and one badge');
  for (const row of rows.slice(2)) {
    assert.equal(row.lines.length, 3);
    assert.match(row.lines[0], /^Paper: /); assert.match(row.lines[1], /^Stamps & Dies: /); assert.match(row.lines[2], /^Cards: /);
  }
  h.sets.push({}); h.cards.push({});
  assert.deepEqual((await h.render())[0].lines, ['Paper Packs: 2', 'Stamp & Die Sets: 2', 'Cards: 4']);
});

for (const kind of ['empty', 'cards', 'sets']) test(`Catalog data handles ${kind} catalogs without requiring Paper`, async t => {
  const rows = await harness(t, { [kind]: [{}] }).render();
  assert.equal(rows[0].badge, kind === 'empty' ? 'Needs data' : 'Ready');
});

for (const state of ['granted', 'prompt', 'denied', 'missing', 'unsupported']) {
  test(`Image folders aggregate ${state} Stamp folder without hiding its individual status`, async t => {
    const settings = { imageLibrary: folder('Paper'), cardImageLibrary: folder('Cards') };
    if (state !== 'missing') settings.stampDieImageLibrary = folder('Stamps', state === 'unsupported' ? 'granted' : state);
    const rows = await harness(t, { settings, supported: state !== 'unsupported' }).render();
    assert.equal(rows[2].badge, state === 'granted' ? 'Ready' : state === 'missing' ? 'Optional' : state === 'unsupported' ? 'Unsupported' : 'Reconnect');
    assert.match(rows[2].lines[1], state === 'granted' ? /Selected folder: Stamps/ : state === 'missing' ? /No Stamp & Die image folder selected/ : state === 'unsupported' ? /does not support/ : /Reconnect may be needed/);
  });
}

test('Stamp references count marked paths across Sets, excluding embedded images and other libraries', async t => {
  const rows = await harness(t, { sets: [
    { imageRefs: [stampRef('one.jpg'), stampRef('two.jpg'), { imageSrc: 'data:image/jpeg;base64,a' }] },
    { imageRefs: [stampRef('three.jpg'), stampRef(''), { imageLibrary: 'card-images', imagePath: 'card.jpg' }] }, {}
  ], settings: { stampDieImageLibrary: folder('Stamps') } }).render();
  assert.equal(rows[3].lines[1], 'Stamps & Dies: 3 folder-backed Stamp & Die image references connected.');
  assert.equal(rows[3].badge, 'OK');
});

for (const state of ['missing', 'denied', 'prompt']) test(`Stamp reference status identifies ${state} connection`, async t => {
  const rows = await harness(t, { sets: [{ imageRefs: [stampRef('one.jpg')] }],
    settings: state === 'missing' ? {} : { stampDieImageLibrary: folder('Stamps', state) }
  }).render();
  assert.equal(rows[3].badge, 'Reconnect'); assert.equal(rows[3].tone, 'attention');
  assert.match(rows[3].lines[1], state === 'missing' ? /1 Stamp & Die image reference need a Stamp & Die image folder connection/ : /Reconnect the Stamp & Die image folder/);
});

test('embedded-only Stamp images truthfully report no folder-backed references', async t => {
  const rows = await harness(t, { sets: [{ imageRefs: [{ imageSrc: 'data:image/jpeg;base64,a' }] }] }).render();
  assert.equal(rows[3].lines[1], 'Stamps & Dies: No folder-backed Stamp & Die image references found yet.');
});

test('grouped references retain Paper missing-image and Card connection information', async t => {
  const rows = await harness(t, { packs: [{ patterns: [{ imagePath: 'paper.jpg' }] }], cards: [{ imagePath: 'card.jpg' }],
    settings: { imageLibrary: folder('Paper'), cardImageLibrary: folder('Cards') },
    health: { summary: { folderImages: 1, imagesMissing: 1, missingImages: [] } }
  }).render();
  assert.equal(rows[3].badge, 'Check needed'); assert.equal(rows[3].tone, 'attention');
  assert.match(rows[3].lines[0], /1 of 1 folder image reference need attention/);
  assert.match(rows[3].lines[2], /1 folder-backed Card image reference connected/);
});

test('unchecked Paper references keep the overall verification state', async t => {
  const rows = await harness(t, { packs: [{ patterns: [{ imagePath: 'paper.jpg' }] }] }).render();
  assert.equal(rows[3].badge, 'Verify'); assert.equal(rows[3].tone, 'neutral');
  assert.match(rows[3].lines[0], /need an image folder connection/);
  assert.equal(rows[1].badge, 'Reminder');
});
