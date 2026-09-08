import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardLibraryMetadata, createCardStampNameLookup, appendCardStampDieRelationships, createAddCardView, openAddCardView, openEditCardView, createCardRecord } from './cards.js';

// Minimal DOM harness follows the existing Stamp form tests.
class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.className = '';
    this.ownText = '';
  }
  set textContent(value) { this.ownText = value; this.children = []; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(''); }
  get options() { return this.children; }
  get parentElement() { return this.parent; }
  get childElementCount() { return this.children.length; }
  append(...children) { for (let child of children) { if (typeof child === 'string') child = Object.assign(new Element('text'), { textContent: child }); child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.ownText = ''; this.append(...children); }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  async emit(type, values = {}) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...values };
    for (const listener of this.listeners[type] || []) await listener(event);
    return event;
  }
  dispatchEvent(event) { return this.emit(event.type, { target: event.target || this, detail: event.detail }); }
  remove() { this.parent.children = this.parent.children.filter((child) => child !== this); }
  get classList() { return { toggle() {} }; }
  matches(selector) {
    for (const match of selector.matchAll(/:not\(([^)]+)\)/g)) if (this.matches(match[1])) return false;
    selector = selector.replace(/:not\([^)]+\)/g, '');
    if (selector.includes(':checked') && !this.checked) return false;
    selector = selector.replace(/:checked/g, '');
    const tag = selector.match(/^[a-z][a-z0-9]*/);
    if (tag && this.tagName !== tag[0]) return false;
    const className = selector.match(/\.([\w-]+)/);
    if (className && !this.className.split(' ').includes(className[1])) return false;
    for (const match of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      const key = match[1];
      const value = key.startsWith('data-')
        ? this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())]
        : this[key] ?? this.attributes[key];
      if (value === undefined || (match[2] !== undefined && value !== match[2])) return false;
    }
    return true;
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector); }
  focus() { globalThis.document.activeElement = this; }
  setCustomValidity(value) { this.validationMessage = value; }
  reportValidity() { return this.querySelectorAll('input').every((input) => !input.validationMessage && (!input.required || input.value !== '')); }
  reset() { for (const input of this.querySelectorAll('input')) { input.value = ''; input.checked = false; } }
  showModal() { this.open = true; }
  close() { this.open = false; return this.emit('close'); }
}

const sets = [{ id: 'set-a', name: 'Garden Flowers' }, { id: 'set-b', name: 'Garden Leaves' }];
const card = () => ({ id: 'card-a', dateCreated: '2026-09-07', status: 'available',
  size: { width: 4.25, height: 5.5 }, tagIds: [], paperPackIds: ['paper-a', 'missing-paper'],
  stampDieSetIds: ['set-a', 'missing-set'], stampSets: ['Legacy text'], colorIds: [], favorite: false });

function harness(t, loader = async () => structuredClone(sets)) {
  const previous = { document: globalThis.document, window: globalThis.window, Option: globalThis.Option };
  t.after(() => Object.assign(globalThis, previous));
  const doc = new Element('document');
  doc.createElement = (name) => new Element(name);
  doc.createTextNode = (text) => Object.assign(new Element('text'), { textContent: text });
  globalThis.document = doc;
  globalThis.window = {};
  globalThis.Option = function(text, value) { return Object.assign(new Element('option'), { textContent: text, value }); };
  const view = createAddCardView({ tagCatalog: { schemaVersion: 1, tags: [], categories: [] }, loadStampDieSets: loader });
  return view;
}
async function search(view, query) {
  view.stampDiePicker.search.value = query;
  await view.stampDiePicker.search.emit('input');
  return view.stampDiePicker.results.querySelectorAll('button');
}
async function select(view, id) {
  const button = (await search(view, 'garden')).find(button => button.dataset.addStampDieSet === id);
  assert.ok(button);
  await view.stampDiePicker.results.emit('click', { target: button });
  return button;
}

test('Add Card uses a separate adjacent named selector and saves zero or multiple unique Set IDs', async (t) => {
  const view = harness(t);
  await openAddCardView(view);
  const sections = view.stampDiePicker.section.parent.children;
  assert.equal(sections.indexOf(view.stampDiePicker.section), sections.findIndex(el => el.querySelector('h4')?.textContent === 'Paper Packs Used') + 1);
  assert.equal(view.stampDiePicker.section.querySelector('h4').textContent, 'Stamps & Dies Used');
  assert.deepEqual(createCardRecord(view).stampDieSetIds, []);
  assert.equal(view.stampDiePicker.results.childElementCount, 0);
  assert.deepEqual((await search(view, '  GARDEN  ')).map(el => el.textContent), ['Garden Flowers', 'Garden Leaves']);
  assert.equal((await search(view, 'set-a')).length, 0, 'search uses names, not IDs');
  const first = await select(view, 'set-a');
  await view.stampDiePicker.results.emit('click', { target: first });
  assert.deepEqual(createCardRecord(view).stampDieSetIds, ['set-a']);
  assert.equal((await search(view, 'garden')).length, 1);
  await select(view, 'set-b');
  const saved = createCardRecord(view);
  assert.deepEqual(saved.stampDieSetIds, ['set-a', 'set-b']);
  assert.deepEqual(saved.paperPackIds, []);
  assert.match(view.stampDiePicker.selected.textContent, /Garden Flowers.*Garden Leaves/);
  assert.doesNotMatch(view.stampDiePicker.section.textContent, /set-a|set-b/);
  const remove = view.stampDiePicker.selected.querySelector('[data-remove-stamp-die-set="set-a"]');
  await view.stampDiePicker.selected.emit('click', { target: remove });
  assert.deepEqual(createCardRecord(view).stampDieSetIds, ['set-b']);
});

test('Edit loads current names, preserves missing IDs, and adds/removes references independently of Paper and legacy text', async (t) => {
  const view = harness(t);
  const existing = card(); const before = structuredClone(existing);
  await openEditCardView(view, existing);
  assert.match(view.stampDiePicker.selected.textContent, /Garden Flowers/);
  assert.doesNotMatch(view.stampDiePicker.section.textContent, /missing-set|set-a/);
  assert.deepEqual(createCardRecord(view).stampDieSetIds, existing.stampDieSetIds);
  await select(view, 'set-b');
  const remove = view.stampDiePicker.selected.querySelector('[data-remove-stamp-die-set="set-a"]');
  assert.equal(remove.getAttribute('aria-label'), 'Remove Garden Flowers');
  await view.stampDiePicker.selected.emit('click', { target: remove });
  const saved = createCardRecord(view);
  assert.deepEqual(saved.stampDieSetIds, ['missing-set', 'set-b']);
  assert.deepEqual(saved.paperPackIds, existing.paperPackIds);
  assert.deepEqual(saved.stampSets, existing.stampSets);
  assert.equal(saved.id, existing.id);
  assert.deepEqual(existing, before, 'draft edits do not mutate persisted Card');
  await openAddCardView(view);
  assert.deepEqual(createCardRecord(view).stampDieSetIds, []);
  assert.equal(view.stampDiePicker.selected.childElementCount, 0);
});

test('legacy Cards open with no selected Sets; reopening refreshes Set names', async (t) => {
  let current = structuredClone(sets);
  const view = harness(t, async () => current);
  const legacy = card(); delete legacy.stampDieSetIds;
  await openEditCardView(view, legacy);
  assert.deepEqual(createCardRecord(view).stampDieSetIds, []);
  current = [{ id: 'set-a', name: 'Renamed Flowers' }];
  await openEditCardView(view, card());
  assert.match(view.stampDiePicker.selected.textContent, /Renamed Flowers/);
  assert.doesNotMatch(view.stampDiePicker.selected.textContent, /Garden Flowers/);
});

test('failed Set load and save before loading finishes preserve saved relationships', async (t) => {
  const view = harness(t, async () => { throw new Error('Unavailable'); });
  await openEditCardView(view, card());
  assert.match(view.stampDiePicker.status.textContent, /could not be loaded/);
  assert.deepEqual(createCardRecord(view).stampDieSetIds, card().stampDieSetIds);
  let resolve;
  view.loadStampDieSets = () => new Promise(done => { resolve = done; });
  const pending = openEditCardView(view, card());
  assert.deepEqual(createCardRecord(view).stampDieSetIds, card().stampDieSetIds);
  view.loadStampDieSets = async () => [{ id: 'set-b', name: 'Current Set' }];
  await openAddCardView(view);
  resolve(sets);
  await pending;
  assert.deepEqual(view.availableStampDieSets, [{ id: 'set-b', name: 'Current Set' }]);
  assert.deepEqual(createCardRecord(view).stampDieSetIds, []);
});


test('Add and Edit expose only the lookup Stamp selector while preserving legacy saved metadata', async (t) => {
  const view = harness(t);
  for (const open of [() => openAddCardView(view), () => openEditCardView(view, card())]) {
    await open();
    assert.deepEqual(view.form.querySelectorAll('h4').map(el => el.textContent).filter(label => /stamp|dies/i.test(label)), ['Stamps & Dies Used']);
    assert.equal(view.form.querySelectorAll('input').filter(el => el.getAttribute('aria-label') === 'Add stamp sets').length, 0);
    assert.equal(view.form.querySelectorAll('input').filter(el => el.getAttribute('aria-label') === 'Search stamp & die sets by name').length, 1);
    await select(view, 'set-b');
    assert.ok(createCardRecord(view).stampDieSetIds.includes('set-b'));
  }
  const saved = createCardRecord(view);
  assert.deepEqual(saved.stampSets, card().stampSets);
  assert.deepEqual(saved.paperPackIds, card().paperPackIds);
  assert.deepEqual(saved.stampDieSetIds, ['set-a', 'missing-set', 'set-b']);
});


test('Card Detail shows clickable current Set names and nonclickable missing placeholders without mutating IDs', async (t) => {
  harness(t);
  const metadata = new Element('dl');
  const existing = card(); existing.stampDieSetIds.push('set-b', 'another-missing');
  const before = structuredClone(existing);
  await appendCardStampDieRelationships(metadata, existing, async () => sets);
  assert.deepEqual(metadata.querySelectorAll('button').map(el => [el.textContent, el.dataset.cardDetailStampDieSet]),
    [['Garden Flowers', 'set-a'], ['Garden Leaves', 'set-b']]);
  assert.equal(metadata.querySelector('button').getAttribute('aria-label'), 'Open Garden Flowers');
  assert.equal(metadata.textContent.match(/Missing Stamp & Die Set/g).length, 2);
  assert.doesNotMatch(metadata.textContent, /set-a|set-b|missing-set|another-missing/);
  assert.deepEqual(existing, before);
});

test('Card Detail omits empty Stamp relationships and distinguishes failed reads from missing Sets', async (t) => {
  harness(t);
  for (const ids of [undefined, []]) {
    const metadata = new Element('dl');
    await appendCardStampDieRelationships(metadata, { stampDieSetIds: ids }, () => assert.fail('no read needed'));
    assert.equal(metadata.childElementCount, 0);
  }
  const metadata = new Element('dl');
  const existing = card();
  await appendCardStampDieRelationships(metadata, existing, async () => { throw new Error('Offline storage'); });
  assert.match(metadata.textContent, /could not be loaded/);
  assert.doesNotMatch(metadata.textContent, /Missing Stamp/);
  assert.equal(metadata.querySelectorAll('button').length, 0);
  assert.deepEqual(existing, card());
});


test('Card Library displays ID-based and legacy Stamp names without duplicate labels or relationship changes', t => {
  harness(t);
  const paperNames = new Map([['paper-a', 'Paper A']]);
  const names = new Map([['set-a', 'Garden Flowers'], ['set-b', 'Garden Leaves']]);
  for (const [overrides, expected] of [
    [{ stampDieSetIds: ['set-a', 'set-b'], stampSets: [] }, 'Garden Flowers, Garden Leaves'],
    [{ stampDieSetIds: [], stampSets: ['Peaceful View'] }, 'Peaceful View'],
    [{ stampDieSetIds: ['set-a', 'set-a'], stampSets: [' garden flowers ', 'Legacy Name'] }, 'Garden Flowers, Legacy Name']
  ]) {
    const record = { ...card(), ...overrides }; const before = structuredClone(record);
    const metadata = createCardLibraryMetadata(record, paperNames, names);
    const stampRow = metadata.children.find(row => row.querySelector('dt').textContent === 'Stamp Sets');
    assert.equal(stampRow.querySelector('dd').textContent, expected);
    assert.equal(metadata.children[0].querySelector('dd').textContent, 'Paper A');
    assert.deepEqual(record, before);
    assert.doesNotMatch(metadata.textContent, /set-a|set-b/);
  }
});

test('Card Library distinguishes missing Sets from failed lookup and omits empty Stamp metadata', t => {
  harness(t);
  const record = { ...card(), stampSets: [] };
  const missing = createCardLibraryMetadata(record, new Map(), new Map([['set-a', 'Flowers']]));
  assert.match(missing.textContent, /Flowers, Missing Stamp & Die Set/);
  assert.doesNotMatch(missing.textContent, /missing-set/);
  const unavailable = createCardLibraryMetadata(record, new Map(), null);
  assert.match(unavailable.textContent, /names unavailable/);
  assert.doesNotMatch(unavailable.textContent, /Missing Stamp/);
  for (const ids of [undefined, []]) {
    const empty = createCardLibraryMetadata({ ...record, stampDieSetIds: ids }, new Map(), new Map());
    assert.doesNotMatch(empty.textContent, /Stamp Sets/);
  }
});

test('Library name lookup refreshes on Set changes and restore; failed or late reads do not show incorrect names', async () => {
  let records = [{ id: 'set-a', name: 'Original' }];
  let reads = 0, renders = 0;
  const listeners = {};
  let loader = async () => records;
  const lookup = createCardStampNameLookup(() => renders++, () => { reads++; return loader(); }, {
    addEventListener: (name, listener) => { listeners[name] = listener; }
  });
  await lookup.refresh(false);
  assert.equal(renders, 0);
  assert.equal(lookup.getNames().get('set-a'), 'Original');
  records = [{ id: 'set-a', name: 'Renamed' }, { id: 'set-b', name: 'Added' }];
  await listeners['catalog:stamp-die-set-saved']();
  assert.equal(lookup.getNames().get('set-a'), 'Renamed');
  assert.equal(lookup.getNames().get('set-b'), 'Added');
  records = [];
  await listeners['catalog:stamp-die-set-saved']();
  assert.equal(lookup.getNames().has('set-a'), false);
  records = [{ id: 'set-a', name: 'Restored' }];
  await listeners['catalog:stamp-sets-restored']();
  assert.equal(lookup.getNames().get('set-a'), 'Restored');
  loader = async () => { throw new Error('Unavailable'); };
  await lookup.refresh();
  assert.equal(lookup.getNames(), null);
  let resolve;
  loader = () => new Promise(done => { resolve = done; });
  const pending = lookup.refresh();
  loader = async () => [{ id: 'set-a', name: 'Newest' }];
  await lookup.refresh();
  resolve([{ id: 'set-a', name: 'Old result' }]); await pending;
  assert.equal(lookup.getNames().get('set-a'), 'Newest');
  assert.equal(reads, 7);
  assert.equal(renders, 5);
});

async function reviewAction(view, selector) {
  const button = view.legacyStampReview.querySelector(selector);
  assert.ok(button);
  await view.legacyStampReview.emit('click', { target: button });
}

test('legacy review appears only for unresolved names and adds no second Stamp lookup', async t => {
  const view = harness(t);
  await openAddCardView(view);
  assert.equal(view.legacyStampReview.childElementCount, 0);
  await openEditCardView(view, { ...card(), stampSets: [] });
  assert.equal(view.legacyStampReview.childElementCount, 0);
  await openEditCardView(view, card());
  assert.match(view.legacyStampReview.textContent, /Unresolved Stamp Set names.*Legacy text.*Find Set.*Discard name/);
  assert.equal(view.form.querySelectorAll('input').filter(el => el.getAttribute('aria-label') === 'Search stamp & die sets by name').length, 1);
  assert.deepEqual(createCardRecord(view).stampSets, ['Legacy text']);
});

test('manual linking uses the existing lookup, preserves other legacy names and IDs, and allows already-selected Sets', async t => {
  const view = harness(t);
  const existing = { ...card(), stampSets: ['Old garden name', 'Leave for later'] };
  const before = structuredClone(existing);
  await openEditCardView(view, existing);
  await reviewAction(view, '[data-resolve-legacy-stamp="Old garden name"]');
  assert.equal(view.stampDiePicker.search.value, 'Old garden name');
  assert.match(view.stampDiePicker.status.textContent, /No matches/);
  await search(view, 'Garden');
  const result = view.stampDiePicker.results.querySelector('[data-add-stamp-die-set="set-a"]');
  assert.ok(result, 'already-selected Sets must be available for resolving legacy names');
  await view.stampDiePicker.results.emit('click', { target: result });
  const saved = createCardRecord(view);
  assert.deepEqual(saved.stampSets, ['Leave for later']);
  assert.deepEqual(saved.stampDieSetIds, ['set-a', 'missing-set']);
  assert.deepEqual(saved.paperPackIds, before.paperPackIds);
  assert.equal(view.resolvingLegacyStampName, null);
  assert.deepEqual(existing, before, 'only the draft changes before Save');
});

test('ambiguous names require an explicit choice with Set metadata and save the chosen stable ID', async t => {
  const ambiguous = [{ id: 'first', name: 'Garden', releaseYear: 2024 }, { id: 'second', name: 'Garden', releaseYear: 2026 }];
  const view = harness(t, async () => ambiguous);
  const existing = { ...card(), stampSets: ['Garden'], stampDieSetIds: ['missing-set'] };
  await openEditCardView(view, existing);
  await reviewAction(view, '[data-resolve-legacy-stamp="Garden"]');
  const results = view.stampDiePicker.results.querySelectorAll('button');
  assert.equal(results.length, 2);
  assert.match(results[0].textContent, /Garden.*2024/);
  assert.match(results[1].textContent, /Garden.*2026/);
  assert.deepEqual(createCardRecord(view).stampSets, ['Garden'], 'displaying candidates cannot convert a name');
  await view.stampDiePicker.results.emit('click', { target: results[1] });
  assert.deepEqual(createCardRecord(view).stampDieSetIds, ['missing-set', 'second']);
  assert.deepEqual(createCardRecord(view).stampSets, []);
  assert.equal(view.legacyStampReview.childElementCount, 0);
});

test('cancel linking, saving an unfinished lookup, and reopening leave unresolved names intact', async t => {
  const view = harness(t);
  const existing = card();
  await openEditCardView(view, existing);
  await reviewAction(view, '[data-resolve-legacy-stamp="Legacy text"]');
  assert.deepEqual(createCardRecord(view).stampSets, existing.stampSets);
  await reviewAction(view, '[data-cancel-legacy-stamp]');
  assert.equal(view.resolvingLegacyStampName, null);
  assert.deepEqual(createCardRecord(view).stampDieSetIds, existing.stampDieSetIds);
  await reviewAction(view, '[data-resolve-legacy-stamp="Legacy text"]');
  await select(view, 'set-b');
  assert.deepEqual(createCardRecord(view).stampSets, []);
  await openEditCardView(view, existing); // Reopening after abandoning an unsaved draft.
  assert.deepEqual(createCardRecord(view).stampSets, existing.stampSets);
  assert.deepEqual(createCardRecord(view).stampDieSetIds, existing.stampDieSetIds);
  assert.equal(view.resolvingLegacyStampName, null);
});

test('discarding a legacy name is draft-only and never removes any ID-based relationship', async t => {
  const view = harness(t);
  const existing = { ...card(), stampSets: ['Legacy text', 'Keep this'] };
  const before = structuredClone(existing);
  await openEditCardView(view, existing);
  await reviewAction(view, '[data-discard-legacy-stamp="Legacy text"]');
  const saved = createCardRecord(view);
  assert.deepEqual(saved.stampSets, ['Keep this']);
  assert.deepEqual(saved.stampDieSetIds, before.stampDieSetIds);
  assert.deepEqual(saved.paperPackIds, before.paperPackIds);
  assert.deepEqual(existing, before);
});

test('failed Set loading cannot resolve legacy names; stale lookup results cannot resolve another name', async t => {
  const view = harness(t, async () => { throw new Error('Unavailable'); });
  await openEditCardView(view, card());
  assert.equal(view.legacyStampReview.querySelector('[data-resolve-legacy-stamp]').disabled, true);
  assert.deepEqual(createCardRecord(view).stampSets, ['Legacy text']);
  view.loadStampDieSets = async () => sets;
  await openEditCardView(view, { ...card(), stampSets: ['First', 'Second'] });
  await reviewAction(view, '[data-resolve-legacy-stamp="First"]');
  const firstResult = (await search(view, 'Garden'))[0];
  await reviewAction(view, '[data-resolve-legacy-stamp="Second"]');
  await view.stampDiePicker.results.emit('click', { target: firstResult });
  assert.deepEqual(createCardRecord(view).stampSets, ['First', 'Second']);
  view.save.disabled = true;
  await reviewAction(view, '[data-discard-legacy-stamp="Second"]');
  assert.deepEqual(createCardRecord(view).stampSets, ['First', 'Second']);
});
