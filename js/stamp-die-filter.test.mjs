import test from 'node:test';
import assert from 'node:assert/strict';
import { filterStampDieSets } from './stamp-die-filter.js';

const owners = [{ id: 'n', name: 'Nina' }, { id: 'a', name: 'Amanda' }, { id: 'old', name: 'Retired Owner', archived: true }];
const catalog = {
  schemaVersion: 2,
  tags: [
    { id: 's', name: 'Stamp', type: 'tool', filenameTerms: [], categoryIds: ['tools'], appliesTo: ['paper'] },
    { id: 'd', name: 'Die', type: 'tool', filenameTerms: ['die'], categoryIds: ['tools'], appliesTo: ['card'] },
    { id: 'm', name: 'Mask', type: 'tool', filenameTerms: ['mask'], categoryIds: [] },
    { id: 'f', name: 'Floral', type: 'theme', categoryIds: ['nature'] },
    { id: 'b', name: 'Botanical', type: 'theme', categoryIds: ['nature'] },
    { id: 't', name: 'Texture', type: 'tool', filenameTerms: [], categoryIds: [] },
    { id: 'x', name: 'Christmas', type: 'theme', categoryIds: ['holidays'] }
  ],
  categories: [{ id: 'tools', name: 'Tools' }, { id: 'nature', name: 'Nature' }, { id: 'holidays', name: 'Holidays' }]
};
const records = [
  { id: 'one', name: 'Pine Boughs', releaseYear: 2026, ownerId: 'n', favorite: true, tagIds: ['s', 'd', 'b'], brand: 'Northwoods Craft', imageRefs: [{ imagePath: 'secret-file.jpg' }] },
  { id: 'two', name: 'Summer Flowers', releaseYear: 2025, ownerId: 'a', favorite: false, tagIds: ['s', 'f', 'x'], purchasedFrom: 'Paper Loft' },
  { id: 'three', name: 'Pine Mask', releaseYear: 2026, ownerId: 'n', favorite: false, tagIds: ['m', 'f'] },
  { id: 'four', name: 'Old Set', ownerId: 'old', favorite: true, tagIds: ['d', 'b'] }
];
const ids = (filters = {}, tags = catalog, registry = owners) => filterStampDieSets(records, filters, tags, registry).map((record) => record.id);
const tag = (...individualTagIds) => ({ individualTagIds, categories: [] });
const category = (categoryId, memberTagIds = []) => ({ individualTagIds: [], categories: [{ categoryId, memberTagIds }] });

for (const [query, expected] of [
  ['Pine Boughs', ['one']], ['pInE', ['one', 'three']], ['  pine   boughs  ', ['one']],
  ['pine-boughs', ['one']], ['2026', ['one', 'three']], ['NINA', ['one', 'three']],
  ['Floral', ['two', 'three']], ['Retired Owner', ['four']], ['missing', []],
  ['CRAFT', ['one']], ['paper loft', ['two']],
  ['secret-file', []], ['one', []], ['tools', []]
]) test(`Set search: ${query}`, () => assert.deepEqual(ids({ query }), expected));

for (const [label, filters, expected] of [
  ['owner ID', { ownerId: 'n' }, ['one', 'three']],
  ['other owner', { ownerId: 'a' }, ['two']],
  ['owner name is not identity', { ownerId: 'Nina' }, []],
  ['Stamp', { selectedTags: tag('s') }, ['one', 'two']],
  ['Die', { selectedTags: tag('d') }, ['one', 'four']],
  ['Mask', { selectedTags: tag('m') }, ['three']],
  ['explicit tags AND', { selectedTags: tag('s', 'd') }, ['one']],
  ['display tag name is not identity', { selectedTags: tag('Stamp') }, []],
  ['category ID is not an assignment', { selectedTags: tag('tools') }, []],
  ['tool-only category is ignored', { selectedTags: category('tools') }, []],
  ['category children OR', { selectedTags: category('nature') }, ['one', 'two', 'three', 'four']],
  ['category refinement', { selectedTags: category('nature', ['f']) }, ['two', 'three']],
  ['categories AND', { selectedTags: { individualTagIds: [], categories: [...category('nature').categories, ...category('holidays').categories] } }, ['two']],
  ['favorites', { favoritesOnly: true }, ['one', 'four']],
  ['release year', { releaseYear: '2025' }, ['two']],
  ['absent year', { releaseYear: 2024 }, []],
  ['search + tag', { query: 'pine', selectedTags: tag('d') }, ['one']],
  ['search + owner', { query: 'pine', ownerId: 'a' }, []],
  ['owner + favorite', { ownerId: 'n', favoritesOnly: true }, ['one']],
  ['year + tag', { releaseYear: 2026, selectedTags: tag('m') }, ['three']],
  ['category + owner', { selectedTags: category('nature'), ownerId: 'a' }, ['two']],
  ['all constraints', { query: 'pine', selectedTags: tag('d'), ownerId: 'n', favoritesOnly: true }, ['one']]
]) test(`Set filtering: ${label}`, () => assert.deepEqual(ids(filters), expected));

test('renames change searchable display names while IDs and records stay intact', () => {
  const before = structuredClone(records);
  const renamedOwners = owners.map((owner) => ({ ...owner, name: owner.id === 'n' ? 'New Nina' : owner.name }));
  const renamedTags = structuredClone(catalog); renamedTags.tags[1].name = 'Cutting';
  assert.deepEqual(ids({ ownerId: 'n', query: 'New Nina' }, catalog, renamedOwners), ['one', 'three']);
  assert.deepEqual(ids({ selectedTags: tag('d'), query: 'Cutting' }, renamedTags), ['one', 'four']);
  assert.deepEqual(records, before);
});

test('search uses current tag names while Tool filtering uses tag IDs independently of names', () => {
  const typedCatalog = { schemaVersion: 2, categories: [], tags: [
    { id: 'renamed-tool', name: 'Embossing', type: 'tool', filenameTerms: [], categoryIds: [] },
    { id: 'theme-die', name: 'Die', type: 'theme', categoryIds: [] }
  ] };
  const typedRecords = [
    { id: 'tool-set', name: 'Set', tagIds: ['renamed-tool'] },
    { id: 'theme-set', name: 'Die Set', tagIds: ['theme-die'] }
  ];
  assert.deepEqual(filterStampDieSets(typedRecords, { query: 'Embossing' }, typedCatalog).map((record) => record.id), ['tool-set']);
  assert.deepEqual(filterStampDieSets(typedRecords, { query: 'Die' }, typedCatalog).map((record) => record.id), ['theme-set']);
  assert.deepEqual(filterStampDieSets(typedRecords, { selectedToolTypeTagIds: ['renamed-tool'] }, typedCatalog).map((record) => record.id), ['tool-set']);
  // The dedicated filter remains ID-based; the UI keeps this Theme ID out of its Tool options.
  assert.deepEqual(filterStampDieSets(typedRecords, { selectedToolTypeTagIds: ['theme-die'] }, typedCatalog).map((record) => record.id), ['theme-set']);
});

test('dedicated tool-type IDs combine with theme tags using AND semantics', () => {
  const withChristmas = [
    { id: 'die-christmas', name: 'Die Christmas', favorite: false, tagIds: ['d', 'x'] },
    { id: 'stamp-christmas', name: 'Stamp Christmas', favorite: false, tagIds: ['s', 'x'] },
    { id: 'christmas-only', name: 'Christmas Only', favorite: false, tagIds: ['x'] }
  ];
  assert.deepEqual(filterStampDieSets(withChristmas, {}, catalog).map((record) => record.id), ['die-christmas', 'stamp-christmas', 'christmas-only']);
  assert.deepEqual(filterStampDieSets(withChristmas, { selectedTags: tag('x') }, catalog).map((record) => record.id), ['die-christmas', 'stamp-christmas', 'christmas-only']);
  assert.deepEqual(filterStampDieSets(withChristmas, { selectedToolTypeTagIds: ['d'] }, catalog).map((record) => record.id), ['die-christmas']);
  assert.deepEqual(filterStampDieSets(withChristmas, { selectedToolTypeTagIds: ['d'], selectedTags: tag('x') }, catalog).map((record) => record.id), ['die-christmas']);
  assert.deepEqual(filterStampDieSets(withChristmas, { selectedToolTypeTagIds: ['m'] }, catalog).map((record) => record.id), []);
});

test('filtering is read-only and does not access images or creation dates', () => {
  const freeze = (value) => { Object.freeze(value); Object.values(value).filter((entry) => entry && typeof entry === 'object').forEach(freeze); return value; };
  const readonly = freeze(structuredClone(records));
  const guarded = readonly.map(({ imageRefs, ...record }) => Object.defineProperties(record, {
    imageRefs: { get() { throw new Error('Images accessed'); } },
    dateCreated: { get() { throw new Error('Creation date accessed'); } }
  }));
  assert.equal(filterStampDieSets(guarded, { query: 'pine', favoritesOnly: true }, freeze(structuredClone(catalog)), freeze(structuredClone(owners))).length, 1);
  assert.deepEqual(readonly, records);
});
