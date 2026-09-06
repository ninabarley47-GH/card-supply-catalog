import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getRelevantTagFilterOptions, renderGlobalTagFilter, readGlobalTagFilter, synchronizeGlobalTagFilterChange, matchesGlobalTagFilters } from './global-tag-filter.js';
import { createTagPickerState } from './tag-picker.js';

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
    const tag = selector.match(/^[a-z]+/);
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


const catalog = {
  schemaVersion: 1,
  categories: [{ id: 'messages', name: 'Messages' }, { id: 'celebrations', name: 'Celebrations' }, { id: 'empty', name: 'Empty' }],
  tags: [
    { id: 'birthday', name: 'Birthday', categoryIds: ['messages', 'celebrations'], appliesTo: ['paper'] },
    { id: 'sympathy', name: 'Sympathy', categoryIds: ['messages'] },
    { id: 'thanks', name: 'Thank You', categoryIds: ['messages'] },
    { id: 'foliage', name: 'Foliage', categoryIds: [] },
    { id: 'winter', name: 'Winter', categoryIds: [] },
    { id: 'unused', name: 'Unused', categoryIds: ['empty'] }
  ]
};
const paper = [{ tagIds: ['birthday', 'sympathy', 'winter'] }];
const cards = [{ tagIds: ['birthday', 'foliage'] }];
const stamps = [{ tagIds: ['sympathy'] }];
const choices = (items, taxonomy = catalog) => getRelevantTagFilterOptions(items, taxonomy);
const tagIds = (options) => [...new Set([...options.tags, ...options.categories.flatMap((category) => category.tags)].map((tag) => tag.id))].sort();

for (const [product, items, expected] of [
  ['Paper', paper, ['birthday', 'sympathy', 'winter']],
  ['Card', cards, ['birthday', 'foliage']],
  ['Stamp', stamps, ['sympathy']]
]) test(`${product} relevance uses only that Library's canonical assignments`, () => {
  assert.deepEqual(tagIds(choices(items)), expected);
  assert.deepEqual(tagIds(choices(items.map((item) => ({ ...item, tags: ['Unused'], keywords: ['Unused'] })))), expected);
});

test('categorized tags appear only in relevant categories, including multiple memberships', () => {
  const model = choices(paper);
  assert.deepEqual(model.tags.map((tag) => tag.id), ['winter']);
  assert.deepEqual(model.categories.map((category) => category.id), ['celebrations', 'messages']);
  assert.deepEqual(model.categories.find((category) => category.id === 'messages').tags.map((tag) => tag.id), ['birthday', 'sympathy']);
  assert.equal(model.categories.filter((category) => category.tags.some((tag) => tag.id === 'birthday')).length, 2);
});

test('partially relevant categories omit unused children; unused standalone tags and empty categories are hidden', () => {
  const model = choices(cards);
  assert.deepEqual(model.tags.map((tag) => tag.id), ['foliage']);
  assert.deepEqual(model.categories.find((category) => category.id === 'messages').tags.map((tag) => tag.id), ['birthday']);
  assert.equal(model.categories.some((category) => category.id === 'empty'), false);
  assert.deepEqual(choices([]), { tags: [], categories: [] });
});

for (const productType of ['paper', 'card', 'stamp']) {
  for (const mode of ['Add', 'Edit']) test(`${productType} ${mode} picker still permits every unused global tag`, () => {
    choices([]);
    const picker = createTagPickerState({ catalog, productType, selectedTagIds: mode === 'Edit' ? ['birthday'] : [] });
    for (const entry of catalog.tags) {
      assert.ok(picker.getModel().applicableIds.has(entry.id));
      picker.select(entry.id);
    }
    assert.equal(picker.getSelectedTagIds().length, catalog.tags.length);
  });
}

function renderer(t, items = paper) {
  const previous = globalThis.document;
  t.after(() => { globalThis.document = previous; });
  globalThis.document = { createElement: (name) => new Element(name) };
  const container = new Element('fieldset');
  const draw = (records = items, taxonomy = catalog) => renderGlobalTagFilter(container, taxonomy, {
    inputPrefix: 'test', optionsDataAttribute: 'testOptions', items: records
  });
  draw();
  const individual = (id) => container.querySelector(`input[name="test-tags"][data-global-tag-id="${id}"]`);
  const category = (id) => container.querySelector(`input[data-filter-category-id="${id}"]`);
  const member = (id, parent = 'messages') => container.querySelector(`input[data-filter-category-member="${parent}"][data-global-tag-id="${id}"]`);
  const select = (input) => { input.checked = true; synchronizeGlobalTagFilterChange(input, container); };
  return { container, draw, individual, category, member, select };
}

test('rendered controls do not duplicate categorized tags at top level', (t) => {
  const h = renderer(t);
  assert.equal(h.individual('birthday'), null);
  assert.equal(h.individual('sympathy'), null);
  assert.ok(h.member('birthday'));
  assert.ok(h.member('sympathy'));
  assert.ok(h.member('birthday', 'celebrations'));
  assert.equal(h.member('thanks'), null);
  assert.ok(h.individual('winter'));
});

test('unchanged usage keeps DOM, selections, and expanded categories despite narrowing results', (t) => {
  const h = renderer(t);
  const details = h.container.querySelector('details[data-filter-category="messages"]'); details.open = true;
  const options = h.container.querySelector('[data-global-tag-filter-options]');
  h.select(h.individual('winter')); h.select(h.member('birthday'));
  const before = readGlobalTagFilter(h.container);
  assert.equal(matchesGlobalTagFilters(['sympathy'], before, catalog), false);
  h.draw(paper);
  assert.equal(h.container.querySelector('[data-global-tag-filter-options]'), options);
  assert.equal(details.open, true);
  assert.deepEqual(readGlobalTagFilter(h.container), before);
  assert.ok(h.member('sympathy'));
});

test('renames update labels while preserving canonical selection and expansion without record writes', (t) => {
  const h = renderer(t);
  h.select(h.member('birthday'));
  h.container.querySelector('details[data-filter-category="messages"]').open = true;
  h.container.querySelector('[data-global-tag-filter-options]').hidden = true;
  const before = structuredClone(paper);
  const renamed = structuredClone(catalog);
  renamed.tags[0].name = 'Birthdays'; renamed.categories[0].name = 'Greetings';
  h.draw(paper, renamed);
  assert.match(h.container.textContent, /Birthdays/); assert.match(h.container.textContent, /Greetings/);
  assert.equal(h.member('birthday').checked, true);
  assert.equal(h.container.querySelector('details[data-filter-category="messages"]').open, true);
  assert.equal(h.container.querySelector('[data-global-tag-filter-options]').hidden, true);
  assert.deepEqual(paper, before);
});

test('genuinely lost standalone and category selections clear instead of becoming hidden filters', (t) => {
  const h = renderer(t);
  h.select(h.individual('winter')); h.select(h.category('messages'));
  h.draw([]);
  assert.deepEqual(readGlobalTagFilter(h.container), { individualTagIds: [], categories: [] });
});

test('losing the last selected category child clears the constraint rather than broadening it', (t) => {
  const h = renderer(t);
  h.select(h.member('birthday'));
  h.draw([{ tagIds: ['sympathy'] }]);
  assert.ok(h.category('messages'));
  assert.equal(h.category('messages').checked, false);
  assert.deepEqual(readGlobalTagFilter(h.container).categories, []);
});

test('remaining selected children survive usage changes and keep OR refinement', (t) => {
  const h = renderer(t);
  h.select(h.member('birthday')); h.select(h.member('sympathy'));
  h.draw([{ tagIds: ['sympathy'] }]);
  assert.deepEqual(readGlobalTagFilter(h.container).categories, [{ categoryId: 'messages', memberTagIds: ['sympathy'] }]);
});

test('categorizing an active standalone tag clears its old constraint without converting AND into OR', (t) => {
  const h = renderer(t);
  h.select(h.individual('winter'));
  const revised = structuredClone(catalog); revised.tags.find((tag) => tag.id === 'winter').categoryIds = ['messages'];
  h.draw(paper, revised);
  assert.equal(h.individual('winter'), null);
  assert.ok(h.member('winter'));
  assert.deepEqual(readGlobalTagFilter(h.container), { individualTagIds: [], categories: [] });
});

test('option calculation and rendering leave frozen records, tags, and memberships untouched', (t) => {
  const freeze = (object) => { Object.freeze(object); Object.values(object).filter((value) => value && typeof value === 'object').forEach(freeze); return object; };
  const frozenCatalog = freeze(structuredClone(catalog));
  const frozenRecords = freeze(structuredClone(paper));
  const h = renderer(t);
  h.draw(frozenRecords, frozenCatalog);
  assert.deepEqual(frozenCatalog, catalog); assert.deepEqual(frozenRecords, paper);
});

test('all Library integrations supply their complete collection before evaluating filters', async () => {
  const [paperSource, cardSource, stampSource] = await Promise.all(['library.js', 'cards.js', 'stamp-die-library.js'].map((name) => readFile(new URL(name, import.meta.url), 'utf8')));
  assert.match(paperSource, /items: paperPacks/);
  assert.match(cardSource, /items: cards/);
  assert.match(stampSource, /filters\.refreshCatalog\(libraryCatalog, displayedRecords\)/);
  assert.ok(paperSource.indexOf('items: paperPacks') < paperSource.indexOf('const filterState = getLibraryFilterState'));
  assert.ok(cardSource.indexOf('items: cards') < cardSource.indexOf('const selectedTags = readGlobalTagFilter'));
  assert.ok(stampSource.indexOf('filters.refreshCatalog(libraryCatalog, displayedRecords)') < stampSource.indexOf('const visible = filterStampDieSets'));
});
