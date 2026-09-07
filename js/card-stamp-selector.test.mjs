import test from 'node:test';
import assert from 'node:assert/strict';
import { createAddCardView, openAddCardView, openEditCardView, createCardRecord } from './cards.js';

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
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
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
