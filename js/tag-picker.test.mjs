import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTagPickerState, getApplicableTagPickerModel, projectTagNames, resolveItemTagIds, searchApplicableTags } from './tag-picker.js';

const tag = (id, name, appliesTo, categoryIds = []) => ({ id, name, appliesTo, categoryIds });
const catalog = {
  schemaVersion: 1,
  categories: [{ id: 'animals', name: 'Animals' }, { id: 'messages', name: 'Messages' }, { id: 'empty', name: 'Empty' }],
  tags: [
    tag('paper-only', 'Background', ['paper']),
    tag('card-only', 'Thanks', ['card'], ['messages']),
    tag('shared', 'Birthday', ['paper', 'card'], ['animals', 'messages']),
    tag('paper-animal', 'Birds', ['paper'], ['animals'])
  ]
};

test('Paper and Card models include only applicable tags and hide empty categories', () => {
  const paper = getApplicableTagPickerModel(catalog, 'paper');
  const card = getApplicableTagPickerModel(catalog, 'card');
  assert.deepEqual(paper.applicableTags.map((entry) => entry.id), ['paper-only', 'paper-animal', 'shared']);
  assert.deepEqual(card.applicableTags.map((entry) => entry.id), ['shared', 'card-only']);
  assert.deepEqual(paper.categories.map((entry) => entry.id), ['animals', 'messages']);
  assert.equal(paper.categories.some((entry) => entry.id === 'empty'), false);
  assert.deepEqual(paper.uncategorizedTags.map((entry) => entry.id), ['paper-only']);
});

test('one ID-authoritative state selects, deduplicates, toggles, and rejects categories', () => {
  const state = createTagPickerState({ catalog, productType: 'paper', selectedTagIds: ['shared'] });
  state.select('shared');
  state.select('paper-only');
  assert.deepEqual(state.getSelectedTagIds(), ['shared', 'paper-only']);
  state.toggle('shared', false);
  assert.deepEqual(state.getSelectedTagIds(), ['paper-only']);
  assert.throws(() => state.select('animals'), /applicable tags/);
  assert.throws(() => state.select('card-only'), /applicable tags/);
});

test('pending picker changes do not mutate the persisted item used to open Edit', () => {
  const persisted = { id: 'paper', tagIds: ['shared'] };
  const state = createTagPickerState({ catalog, productType: 'paper', selectedTagIds: persisted.tagIds });
  state.select('paper-only');
  state.deselect('shared');
  assert.deepEqual(persisted.tagIds, ['shared']);
  assert.deepEqual(state.getSelectedTagIds(), ['paper-only']);
});

test('multi-category tag appears in each category but search returns it once with context', () => {
  const model = getApplicableTagPickerModel(catalog, 'paper');
  assert.equal(model.categories.filter((category) => category.tags.some((entry) => entry.id === 'shared')).length, 2);
  assert.deepEqual(searchApplicableTags(catalog, 'paper', 'birth'), [{ id: 'shared', name: 'Birthday', categoryNames: ['Animals', 'Messages'] }]);
});

test('search finds applicable categorized and uncategorized tags only', () => {
  assert.equal(searchApplicableTags(catalog, 'paper', 'back')[0].id, 'paper-only');
  assert.equal(searchApplicableTags(catalog, 'card', 'thank')[0].id, 'card-only');
  assert.deepEqual(searchApplicableTags(catalog, 'paper', 'thank'), []);
});

test('Edit resolution prefers canonical IDs and uses names only as fallback', () => {
  assert.deepEqual(resolveItemTagIds({ tagIds: ['shared'], keywords: ['Background'] }, catalog, 'paper', 'keywords'), ['shared']);
  assert.deepEqual(resolveItemTagIds({ keywords: ['Background'] }, catalog, 'paper', 'keywords'), ['paper-only']);
  assert.deepEqual(resolveItemTagIds({ tags: ['Thanks'] }, catalog, 'card', 'tags'), ['card-only']);
  assert.throws(() => resolveItemTagIds({ keywords: ['Missing'] }, catalog, 'paper', 'keywords'), /cannot be resolved/);
});

test('canonical IDs project temporary runtime names without becoming name-authoritative', () => {
  assert.deepEqual(projectTagNames(catalog, ['shared', 'paper-only'], 'paper'), ['Birthday', 'Background']);
  assert.throws(() => projectTagNames(catalog, ['animals'], 'paper'), /invalid/);
});

test('picker UI uses collapsed native categories, synchronized ID occurrences, and no creation control', async () => {
  const source = await readFile(new URL('./tag-picker.js', import.meta.url), 'utf8');
  assert.match(source, /document\.createElement\('details'\)/);
  assert.doesNotMatch(source, /details\.open\s*=/);
  assert.match(source, /querySelectorAll\('\[data-tag-id\]'\)/);
  assert.match(source, /No matching tags\. New tags can be added in Settings\./);
  assert.doesNotMatch(source, /onCreateTag|Create "/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /checkbox\.type = 'checkbox'/);
  assert.doesNotMatch(source, /Selected Tags|Find a tag/);
  assert.match(source, /textContent: 'Other Tags'/);
  assert.match(source, /categoriesHeading\.textContent = 'Categories'/);
});

test('Paper and Card forms use the shared ID picker without inline creation or image coupling', async () => {
  const paper = await readFile(new URL('./add-dsp.js', import.meta.url), 'utf8');
  const card = await readFile(new URL('./cards.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../css/styles.css', import.meta.url), 'utf8');
  assert.match(paper, /createTagPicker\(\{ label: "Paper Tags", productType: "paper"/);
  assert.match(card, /productType: 'card'/);
  assert.match(paper, /tagPicker\.getSelectedTagIds\(\)/);
  assert.match(paper, /setSelectedTagIds\(resolveItemTagIds\(paperPack/);
  assert.match(card, /setSelectedTagIds\(resolveItemTagIds\(card/);
  assert.match(card, /tagIds: selectedTags\.map\(\(tag\) => tag\.id\)/);
  assert.doesNotMatch(paper, /onCreateTag|paperTagVocabulary\.create/);
  assert.doesNotMatch(card.slice(card.indexOf('function createAddCardView'), card.indexOf('function openAddCardView')), /onCreateTag/);
  assert.doesNotMatch(await readFile(new URL('./tag-picker.js', import.meta.url), 'utf8'), /images|imagePath|directoryHandle/);
  assert.match(styles, /\.global-tag-picker-option\s*\{[^}]*min-height:\s*2\.75rem;/);
  assert.match(styles, /\.global-tag-picker-uncategorized\s*\{[^}]*repeat\(auto-fit, minmax\(10rem, 1fr\)\)/);
  assert.match(styles, /\.tag-picker-selected\[hidden\]\s*\{\s*display:\s*none;/);
});
