import test from 'node:test';
import assert from 'node:assert/strict';
import { createDetailNavigation, detailNavigation } from './detail-navigation.js';
import { initializeScreenNavigation, initializeDetailPanel } from './library.js';

function harness(limit = 20) {
  const visible = new Set(), notices = [], screens = [], backs = {};
  const records = { card: new Set(['A', 'B']), paper: new Set(['X', 'Z']), stamp: new Set(['Y']) };
  const nav = createDetailNavigation({ limit, notify: text => notices.push(text), showLibrary: id => screens.push(id) });
  for (const type of Object.keys(records)) nav.register(type, {
    library: type, exists: id => records[type].has(id),
    open: id => { assert.equal(visible.size, 0, 'previous Detail closes before next opens'); visible.add(`${type}:${id}`); },
    hide: () => { for (const key of visible) if (key.startsWith(type + ':')) visible.delete(key); nav.close(type); },
    setBack: shown => { backs[type] = shown; }
  });
  return { nav, visible, notices, records, backs, screens };
}
const item = (type, id) => ({ type, id });

test('Library opens start fresh, including another tile of the same type', () => {
  const h = harness();
  h.nav.open('card', 'A');
  assert.equal(h.backs.card, false);
  h.nav.open('paper', 'X', { related: true });
  assert.equal(h.backs.paper, true);
  h.nav.open('paper', 'Z');
  assert.deepEqual(h.nav.getState(), { current: item('paper', 'Z'), history: [] });
  assert.equal(h.backs.paper, false);
});

for (const [type, id] of [['paper', 'X'], ['stamp', 'Y']]) {
  test(`Card to ${type} and Back restores Card; repeated paths are independent`, () => {
    const h = harness(); h.nav.open('card', 'A');
    for (let i = 0; i < 2; i++) {
      h.nav.open(type, id, { related: true });
      assert.deepEqual(h.nav.getState().history, [item('card', 'A')]);
      assert.equal(h.nav.back(), true);
      assert.deepEqual(h.nav.getState(), { current: item('card', 'A'), history: [] });
      assert.deepEqual([...h.visible], ['card:A']);
    }
  });
}

test('multi-step Card A / Stamp Y / Card B / Paper Z unwinds one Detail at a time', () => {
  const h = harness(); h.nav.open('card', 'A');
  for (const [type, id] of [['stamp', 'Y'], ['card', 'B'], ['paper', 'Z']]) h.nav.open(type, id, { related: true });
  for (const [type, id] of [['card', 'B'], ['stamp', 'Y'], ['card', 'A']]) {
    assert.equal(h.nav.back(), true);
    assert.deepEqual(h.nav.getState().current, item(type, id));
    assert.deepEqual([...h.visible], [`${type}:${id}`]);
  }
  assert.equal(h.nav.back(), false);
  assert.equal(h.backs.card, false);
});

test('Paper to Card to Back returns to Paper and coordinating Paper links push history', () => {
  const h = harness(); h.nav.open('paper', 'X');
  h.nav.open('card', 'A', { related: true }); h.nav.back();
  assert.deepEqual(h.nav.getState().current, item('paper', 'X'));
  h.nav.open('paper', 'Z', { related: true }); h.nav.back();
  assert.deepEqual(h.nav.getState(), { current: item('paper', 'X'), history: [] });
});

for (const action of ['close', 'mainLibrary']) test(`${action} clears session without navigating away from the displayed Library`, () => {
  const h = harness(); h.nav.open('card', 'A'); h.nav.open('stamp', 'Y', { related: true });
  h.nav[action]();
  assert.deepEqual(h.nav.getState(), { current: null, history: [] });
  assert.equal(h.visible.size, 0);
  assert.equal(h.screens.at(-1), 'stamp');
  assert.ok(Object.values(h.backs).every(value => !value));
});

test('deleted history targets are skipped with a notice; exhausted history retains current Detail', () => {
  const h = harness(); h.nav.open('card', 'A'); h.nav.open('stamp', 'Y', { related: true }); h.nav.open('paper', 'Z', { related: true });
  h.records.stamp.delete('Y'); h.nav.back();
  assert.deepEqual(h.nav.getState().current, item('card', 'A'));
  assert.equal(h.notices.length, 1);
  h.nav.open('paper', 'X', { related: true }); h.records.card.delete('A');
  assert.equal(h.nav.back(), false);
  assert.deepEqual(h.nav.getState(), { current: item('paper', 'X'), history: [] });
  assert.equal(h.backs.paper, false); assert.equal(h.notices.length, 2);
});

test('missing forward targets and self-links leave current Detail and history unchanged', () => {
  const h = harness(); h.nav.open('card', 'A'); h.nav.open('paper', 'X', { related: true });
  const before = h.nav.getState(); const screens = [...h.screens];
  assert.equal(h.nav.open('stamp', 'missing', { related: true }), false);
  assert.equal(h.nav.open('unknown', 'missing', { related: true }), false);
  h.nav.open('paper', 'X', { related: true });
  assert.deepEqual(h.nav.getState(), before); assert.deepEqual(h.screens, screens);
  assert.deepEqual([...h.visible], ['paper:X']);
});

test('stack is bounded, contains only type/ID, and does not expose mutable internal state', () => {
  const h = harness(2); h.nav.open('card', 'A');
  h.nav.open('stamp', 'Y', { related: true }); h.nav.open('card', 'B', { related: true }); h.nav.open('paper', 'Z', { related: true, context: { name: 'not history' } });
  const state = h.nav.getState();
  assert.deepEqual(state.history, [item('stamp', 'Y'), item('card', 'B')]);
  state.history[0].id = 'wrong'; state.current.id = 'wrong';
  assert.equal(h.nav.getState().history[0].id, 'Y');
  assert.equal(h.nav.getState().current.id, 'Z');
});

function browserHarness(t) {
  const previous = { window: globalThis.window, document: globalThis.document };
  t.after(() => { detailNavigation.close(); Object.assign(globalThis, previous); });
  const events = {}, windowEvents = {};
  const screens = ['library', 'cards', 'stamps-dies'].map(id => ({ id, matches: () => true }));
  globalThis.document = {
    querySelectorAll: selector => selector === '[data-screen]' ? screens : [],
    getElementById: id => screens.find(screen => screen.id === id),
    addEventListener: (type, listener) => { (events[type] ||= []).push(listener); },
    dispatchEvent: event => { for (const listener of events[event.type] || []) listener(event); }
  };
  const replacements = [];
  globalThis.window = { location: { hash: '#cards' }, alert() {},
    history: { replaceState: (_state, _title, hash) => { replacements.push(hash); window.location.hash = hash; }, pushState: () => assert.fail('no browser history entries') },
    addEventListener: (type, listener) => { windowEvents[type] = listener; }
  };
  initializeScreenNavigation();
  return { events, windowEvents, replacements, screens };
}

test('actual main-Library handler clears same-Library clicks; internal screen changes preserve history', t => {
  const h = browserHarness(t);
  let visible;
  for (const [type, library] of [['card', 'cards'], ['paper', 'library']]) detailNavigation.register(type, {
    library, exists: () => true, open: () => { visible = type; }, hide: () => { visible = null; }
  });
  detailNavigation.open('card', 'A'); detailNavigation.open('paper', 'X', { related: true });
  assert.equal(detailNavigation.getState().history.length, 1);
  assert.deepEqual(h.screens.filter(screen => !screen.hidden).map(screen => screen.id), ['library']);
  for (const listener of h.events.click) listener({ target: { closest: () => ({ hash: '#library' }) } });
  assert.equal(visible, null); assert.equal(detailNavigation.getState().history.length, 0);
  detailNavigation.open('card', 'A'); detailNavigation.open('paper', 'X', { related: true });
  window.location.hash = '#stamps-dies'; h.windowEvents.hashchange();
  assert.deepEqual(detailNavigation.getState(), { current: null, history: [] });
});

test('actual Paper coordinating and Related Card click handlers use shared transitions', t => {
  browserHarness(t);
  const nodes = {};
  for (const selector of ['[data-detail-panel]', '[data-detail-title]', '[data-detail-body]', '[data-detail-close]', '[data-detail-back]']) {
    nodes[selector] = { listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
  }
  document.querySelector = selector => nodes[selector];
  const library = { addEventListener() {} };
  initializeDetailPanel(library, [{ id: 'X' }, { id: 'Z' }], { blue: { id: 'blue' } }, () => {});
  let receivedContext;
  for (const [type, targetLibrary] of [['paper', 'library'], ['card', 'cards']]) detailNavigation.register(type, {
    library: targetLibrary, exists: () => true, open: (_id, context) => { receivedContext = context; }, hide() {}
  });
  detailNavigation.open('paper', 'X');
  nodes['[data-detail-body]'].listeners.click({ stopPropagation() {}, target: {
    closest: selector => selector === '[data-coordinate-pack]' ? { dataset: { coordinatePack: 'Z', coordinateColor: 'blue' } } : null
  } });
  assert.deepEqual(detailNavigation.getState(), { current: item('paper', 'Z'), history: [item('paper', 'X')] });
  assert.deepEqual(receivedContext, { coordinatingColor: { id: 'blue' } });
  nodes['[data-detail-back]'].listeners.click({ stopPropagation() {} });
  assert.deepEqual(detailNavigation.getState().current, item('paper', 'X'));
  nodes['[data-detail-body]'].listeners.click({ stopPropagation() {}, target: {
    closest: selector => selector === '[data-related-card-id]' ? { dataset: { relatedCardId: 'A' } } : null
  } });
  assert.deepEqual(detailNavigation.getState(), { current: item('card', 'A'), history: [item('paper', 'X')] });
});
