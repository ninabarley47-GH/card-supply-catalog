import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createGlobalTagFilterModel,
  getGlobalTagSearchNames,
  matchesGlobalTagFilters,
  matchesHolidayFilter,
  resolveHolidayFilterIdentity
} from './global-tag-filter.js';
import { matchesPaperPackFilters } from './library.js';
import { filterAndSortCards } from './cards.js';

const catalog = {
  schemaVersion: 1,
  categories: [
    { id: 'animals', name: 'Animals' },
    { id: 'celebrations', name: 'Celebrations' },
    { id: 'messages', name: 'Messages' }
  ],
  tags: [
    { id: 'floral', name: 'Floral', appliesTo: ['card'], categoryIds: [] },
    { id: 'specialty', name: 'Specialty', appliesTo: ['paper'], categoryIds: [] },
    { id: 'flying', name: 'Flying Animals', appliesTo: ['stamp'], categoryIds: ['animals'] },
    { id: 'land', name: 'Land Animals', categoryIds: ['animals'] },
    { id: 'birthday', name: 'Birthday', categoryIds: ['celebrations', 'messages'] },
    { id: 'holiday', name: 'Holiday', categoryIds: [] }
  ]
};

const none = { individualTagIds: [], categories: [] };

test('individual stable tag IDs use AND semantics for Paper and Card', () => {
  const filters = { individualTagIds: ['floral', 'specialty'], categories: [] };
  assert.equal(matchesGlobalTagFilters(['floral', 'specialty'], filters, catalog), true);
  assert.equal(matchesGlobalTagFilters(['floral'], filters, catalog), false);
  assert.equal(matchesPaperPackFilters(
    { id: 'paper', name: 'Pack', owner: 'Nina', colors: [], tagIds: ['floral', 'specialty'] },
    { query: '', selectedTags: filters, selectedColors: [] }, {}, catalog
  ), true);
  assert.deepEqual(filterAndSortCards(
    [{ id: 'card', tagIds: ['floral', 'specialty'], stampSets: [], paperPackIds: [], dateCreated: '2026-01-01' }],
    { selectedTags: filters, tagCatalog: catalog }
  ).map((card) => card.id), ['card']);
});

test('a category matches any member and excludes nonmembers', () => {
  const filters = { individualTagIds: [], categories: [{ categoryId: 'animals', memberTagIds: [] }] };
  assert.equal(matchesGlobalTagFilters(['flying'], filters, catalog), true);
  assert.equal(matchesGlobalTagFilters(['land'], filters, catalog), true);
  assert.equal(matchesGlobalTagFilters(['floral'], filters, catalog), false);
});

test('category and individual filters use AND-between semantics', () => {
  const filters = { individualTagIds: ['floral'], categories: [{ categoryId: 'animals', memberTagIds: [] }] };
  assert.equal(matchesGlobalTagFilters(['floral', 'land'], filters, catalog), true);
  assert.equal(matchesGlobalTagFilters(['land'], filters, catalog), false);
});

test('multiple narrowed category members use OR as a category refinement', () => {
  const filters = { individualTagIds: ['floral'], categories: [{ categoryId: 'animals', memberTagIds: ['flying', 'land'] }] };
  assert.equal(matchesGlobalTagFilters(['floral', 'flying'], filters, catalog), true);
  assert.equal(matchesGlobalTagFilters(['floral', 'land'], filters, catalog), true);
  assert.equal(matchesGlobalTagFilters(['floral', 'birthday'], filters, catalog), false);
});

test('a multi-category tag remains one stable matching entity', () => {
  const celebration = { individualTagIds: [], categories: [{ categoryId: 'celebrations', memberTagIds: [] }] };
  const messages = { individualTagIds: [], categories: [{ categoryId: 'messages', memberTagIds: [] }] };
  assert.equal(matchesGlobalTagFilters(['birthday'], celebration, catalog), true);
  assert.equal(matchesGlobalTagFilters(['birthday'], messages, catalog), true);
  assert.deepEqual(getGlobalTagSearchNames(['birthday', 'birthday'], catalog), ['Birthday']);
});

test('deprecated appliesTo metadata never limits global filter options', () => {
  assert.deepEqual(createGlobalTagFilterModel(catalog).tags.map((tag) => tag.id), ['birthday', 'floral', 'flying', 'holiday', 'land', 'specialty']);
});

test('Paper and Card search resolve tag display names from canonical IDs', () => {
  const paper = { id: 'paper', name: 'Plain Pack', owner: 'Nina', colors: [], tagIds: ['birthday'] };
  assert.equal(matchesPaperPackFilters(paper, { query: 'birthday', selectedTags: none, selectedColors: [] }, {}, catalog), true);
  const cards = [{ id: 'card', tagIds: ['birthday'], stampSets: [], paperPackIds: [], dateCreated: '2026-01-01' }];
  assert.deepEqual(filterAndSortCards(cards, { query: 'birthday', selectedTags: none, tagCatalog: catalog }).map((card) => card.id), ['card']);
});

test('renaming a tag changes search text without changing filter identity', () => {
  const renamed = { ...catalog, tags: catalog.tags.map((tag) => tag.id === 'birthday' ? { ...tag, name: 'Birthdays' } : tag) };
  assert.equal(matchesGlobalTagFilters(['birthday'], { individualTagIds: ['birthday'], categories: [] }, renamed), true);
  assert.deepEqual(getGlobalTagSearchNames(['birthday'], renamed), ['Birthdays']);
});

test('existing non-tag Paper and Card search values remain searchable', () => {
  const paper = { id: 'paper', name: 'Meadow Pack', owner: 'Nina', releaseYear: 2025, colors: [], tagIds: [] };
  assert.equal(matchesPaperPackFilters(paper, { query: 'meadow', selectedTags: none, selectedColors: [] }, {}, catalog), true);
  const cards = [{ id: 'card', tagIds: [], stampSets: ['Sweet Blooms'], paperPackIds: ['pack'], dateCreated: '2026-01-01' }];
  assert.deepEqual(filterAndSortCards(cards, { query: 'blooms', selectedTags: none, tagCatalog: catalog }).map((card) => card.id), ['card']);
});

test('Holiday filtering resolves identity once and matches canonical IDs', () => {
  const identity = resolveHolidayFilterIdentity(catalog);
  assert.deepEqual(identity, { tagId: 'holiday', categoryId: '' });
  assert.equal(matchesHolidayFilter(['holiday'], 'only', identity, catalog), true);
  assert.equal(matchesHolidayFilter(['birthday'], 'exclude', identity, catalog), true);
});

test('migrated filter and search code does not read runtime tag-name projections or image APIs', async () => {
  const library = await readFile(new URL('./library.js', import.meta.url), 'utf8');
  const cards = await readFile(new URL('./cards.js', import.meta.url), 'utf8');
  const shared = await readFile(new URL('./global-tag-filter.js', import.meta.url), 'utf8');
  const paperFilter = library.slice(library.indexOf('export function matchesPaperPackFilters'), library.indexOf('function getSearchableColorText'));
  const cardFilter = cards.slice(cards.indexOf('export function filterAndSortCards'), cards.indexOf('function refreshCardOwnerFilter'));
  assert.doesNotMatch(paperFilter, /keywords/);
  assert.doesNotMatch(cardFilter, /card\.tags|tags \|\|/);
  assert.doesNotMatch(shared, /image|directory|folder/i);
});
