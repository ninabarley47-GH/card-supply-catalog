import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const [paper, cards, stamps, css, html] = await Promise.all(['js/library.js', 'js/cards.js', 'js/stamp-die-library.js', 'css/cards.css', 'index.html'].map(file => readFile(new URL('../' + file, import.meta.url), 'utf8')));
for (const favorite of [true, false]) test(`Paper header Favorite saves from ${favorite} using existing persistence`, async () => {
  let saved, renders = 0, focused = false;
  const context = vm.createContext({ savePaperPack: async pack => { saved = pack; },
    replacePaperPack: (packs, pack) => packs.splice(0, 1, pack), CSS: { escape: id => id }, window: { alert() {} } });
  vm.runInContext(paper.slice(paper.indexOf('async function togglePaperPackFavorite('), paper.indexOf('function clearRecentlyAddedStatus(')), context);
  const original = { id: 'pack', favorite, patterns: ['keep'], owner: 'Owner' }; const packs = [original];
  const button = {};
  await context.togglePaperPackFavorite('pack', packs, button, () => renders++, { querySelector: () => ({ focus() { focused = true; } }) });
  assert.equal(saved.favorite, !favorite); assert.equal(packs[0], saved);
  assert.equal(saved.patterns, original.patterns); assert.equal(saved.owner, original.owner);
  assert.equal(original.favorite, favorite); assert.equal(renders, 1); assert.equal(focused, true);
});
test('Paper Favorite pending write blocks repeats and failure retains existing value', async () => {
  let reject, calls = 0;
  const context = vm.createContext({ savePaperPack: () => { calls++; return new Promise((_, fail) => { reject = fail; }); }, window: { alert() {} } });
  vm.runInContext(paper.slice(paper.indexOf('async function togglePaperPackFavorite('), paper.indexOf('function clearRecentlyAddedStatus(')), context);
  const packs = [{ id: 'pack', favorite: false }], button = {};
  const pending = context.togglePaperPackFavorite('pack', packs, button, () => assert.fail('must not render'), {});
  await context.togglePaperPackFavorite('pack', packs, button, () => {}, {});
  assert.equal(calls, 1); reject(new Error('save failed')); await pending;
  assert.equal(packs[0].favorite, false); assert.equal(button.disabled, false);
});
test('all Detail hearts sit beside titles and use the existing shared visual treatment', () => {
  assert.match(html, /class="card-title-row detail-title-row" data-detail-title-row/);
  assert.match(paper, /replaceChildren\(detailTitle, createPaperPackFavoriteButton\(paperPack\)\)/);
  assert.match(paper, /button.replaceWith\(createPaperPackFavoriteButton\(pack\)\)/);
  assert.match(cards, /titleRow.replaceChildren\(detailView.title, createCardFavoriteButton\(card\)\)/);
  assert.match(stamps, /detail.titleRow.replaceChildren\(detail.title, favorite\)/);
  assert.match(css, /\.stamp-set-detail-title-row,\s*\.detail-title-row \{ padding: 0; align-items: center; \}/);
});
test('Stamp Detail is a full-height right-edge panel and Detail Edit actions are neutral', () => {
  const panel = css.match(/\.stamp-set-detail \{([^}]+)\}/)[1];
  for (const text of ['position: fixed', 'inset: 0 0 0 auto', 'height: 100dvh', 'margin: 0', 'border-radius: 0']) assert.ok(panel.includes(text));
  const actions = cards.slice(cards.indexOf('function createCardDetailActions('), cards.indexOf('function deleteSelectedCard('));
  assert.match(actions, /edit.className = 'button'/);
  assert.match(actions, /heading.textContent = 'Actions'/);
  assert.match(actions, /row.append\(edit, deleteButton\)/);
  assert.match(stamps, /edit.className = 'button'/);
});
