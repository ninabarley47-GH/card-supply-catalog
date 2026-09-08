import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('all three libraries retain matching loading-message markup until records render', async () => {
  const [html, cards, sets] = await Promise.all([read('../index.html'), read('./cards.js'), read('./stamp-die-library.js')]);
  for (const [attribute, text] of [['data-paper-pack-library', 'Loading paper packs...'], ['data-card-library', 'Loading cards...'], ['data-set-library', 'Loading stamps &amp; dies...']]) {
    const region = html.slice(html.indexOf(attribute + ' aria-live'));
    assert.ok(region.slice(0, 150).includes(`<p class="loading-message">${text}</p>`));
  }
  const initial = cards.slice(cards.indexOf('const renderCurrent'), cards.indexOf('const reloadCards'));
  assert.doesNotMatch(initial, /\n  renderCurrent\(\);/);
  assert.ok(cards.indexOf('await hydrateCardImageSources(savedCards)') < cards.indexOf('    renderCurrent();', cards.indexOf('const reloadCards')));
  assert.ok(sets.indexOf('await storage.hydrateStampImages(records)') < sets.indexOf('renderStampDieLibrary(gallery, records'));
});

test('module grids stretch per row without fixed/global row heights; Paper retains native grid defaults', async () => {
  const [css, shared, html] = await Promise.all([read('../css/cards.css'), read('../css/styles.css'), read('../index.html')]);
  assert.match(css, /\.card-library-grid\s*\{[^}]*align-items: stretch;/);
  assert.match(css, /\.card-library-tile\s*\{[^}]*align-self: stretch;/);
  assert.match(html, /class="card-library-grid" data-set-library/);
  for (const selector of ['dsp-grid', 'library-pack-grid']) {
    const block = shared.match(new RegExp('\\.' + selector + '\\s*\\{([^}]*)}'))[1];
    assert.match(block, /display: grid/);
    assert.doesNotMatch(block, /align-items: start|grid-auto-rows:|height:/);
  }
  assert.doesNotMatch(css.match(/\.card-library-grid\s*\{([^}]*)}/)[1], /grid-auto-rows:|height:/);
});

test('Card and Set hearts share Paper styling and direct toggle controls', async () => {
  const [css, cards, sets] = await Promise.all([read('../css/styles.css'), read('./cards.js'), read('./stamp-die-library.js')]);
  assert.match(css, /\.paper-pack-favorite,\s*\.card-library-favorite,\s*\.stamp-set-favorite\s*\{/);
  assert.match(css, /\.stamp-set-favorite\[data-favorite="true"\]\s*\{\s*color: #9b5364/);
  assert.match(cards, /titleRow.append\(tagList, favorite\)/);
  assert.doesNotMatch(cards, /image.append\(favorite\)/);
  assert.match(cards, /favorite.dataset.toggleCardFavorite = card.id/);
  assert.match(sets, /button.className = 'stamp-set-favorite'/);
});

test('Set deletion has a catalog-only transaction with no image helper or recursive deletion calls', async () => {
  const source = await read('./storage.js');
  const body = source.slice(source.indexOf('export async function deleteStampDieSet'), source.indexOf('export async function loadSavedCards'));
  assert.match(body, /writeTransaction\(database, \[STAMP_DIE_SETS_STORE\]/);
  assert.match(body, /objectStore\(STAMP_DIE_SETS_STORE\).delete\(id\)/);
  assert.doesNotMatch(body, /removeEntry|createWritable|image|SETTINGS_STORE|recursive/);
});


test('Stamp Library alone uses Paper column sizing while Cards retain 20rem', async () => {
  const [css, shared] = await Promise.all([read('../css/cards.css'), read('../css/styles.css')]);
  const stamp = css.match(/\[data-set-library\]\s*\{([^}]*)}/)[1].trim();
  const paper = shared.match(/\.library-pack-grid\s*\{([^}]*)}/)[1];
  const card = css.match(/\.card-library-grid\s*\{([^}]*)}/)[1];
  assert.equal(stamp, 'grid-template-columns: repeat(auto-fill, minmax(min(100%, 24rem), 1fr));');
  assert.ok(paper.includes(stamp));
  assert.match(card, /grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 20rem\), 1fr\)\)/);
  assert.match(card, /align-items: stretch/);
});


test('Stamp Library enlarges image boxes responsively without changing fit or image columns', async () => {
  const css = await read('../css/cards.css');
  const override = css.match(/\[data-set-library\] \.stamp-set-images img\s*\{([^}]*)}/)[1].trim();
  assert.equal(override, 'height: min(20rem, 80vw);');
  assert.match(css, /\.stamp-set-images img\s*\{[^}]*width: 100%;[^}]*object-fit: contain;/);
  assert.match(css, /\.stamp-set-images\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.stamp-set-images > :only-child\s*\{ grid-column: 1 \/ -1; \}/);
});
