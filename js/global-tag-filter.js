import { getGlobalTagNameKey, validateGlobalTagCatalog } from './global-tag-catalog.js';

export function createGlobalTagFilterModel(catalog) {
  assertCatalog(catalog);
  const tags = sortByName(catalog.tags);
  const categories = sortByName(catalog.categories)
    .map((category) => ({
      ...category,
      tags: tags.filter((tag) => tag.categoryIds.includes(category.id))
    }))
    .filter((category) => category.tags.length > 0);
  return { tags, categories };
}

export function matchesGlobalTagFilters(itemTagIds = [], filters = {}, catalog) {
  assertCatalog(catalog);
  const assigned = new Set(itemTagIds || []);
  const individualTagIds = [...new Set(filters.individualTagIds || [])];
  const globalTagIds = new Set(catalog.tags.map((tag) => tag.id));
  if (individualTagIds.some((tagId) => !globalTagIds.has(tagId))) return false;
  if (!individualTagIds.every((tagId) => assigned.has(tagId))) return false;

  const categoriesById = new Map(createGlobalTagFilterModel(catalog).categories.map((category) => [category.id, category]));
  return (filters.categories || []).every((selection) => {
    const category = categoriesById.get(selection.categoryId);
    if (!category) return false;
    const memberIds = new Set(category.tags.map((tag) => tag.id));
    const requestedIds = [...new Set(selection.memberTagIds || [])];
    const eligibleIds = requestedIds.length ? requestedIds.filter((tagId) => memberIds.has(tagId)) : [...memberIds];
    return eligibleIds.some((tagId) => assigned.has(tagId));
  });
}

export function getGlobalTagSearchNames(itemTagIds = [], catalog) {
  assertCatalog(catalog);
  const namesById = new Map(catalog.tags.map((tag) => [tag.id, tag.name]));
  return [...new Set(itemTagIds || [])].map((tagId) => namesById.get(tagId)).filter(Boolean);
}

export function resolveHolidayFilterIdentity(catalog) {
  assertCatalog(catalog);
  const holidayTag = catalog.tags.find((tag) => getGlobalTagNameKey(tag.name) === 'holiday');
  const holidayCategory = catalog.categories.find((category) => ['holiday', 'holidays'].includes(getGlobalTagNameKey(category.name)));
  return holidayTag
    ? { tagId: holidayTag.id, categoryId: '' }
    : { tagId: '', categoryId: holidayCategory?.id || '' };
}

export function matchesHolidayFilter(itemTagIds = [], mode = '', identity = {}, catalog) {
  if (!mode) return true;
  const constraints = {
    individualTagIds: identity.tagId ? [identity.tagId] : [],
    categories: identity.categoryId ? [{ categoryId: identity.categoryId, memberTagIds: [] }] : []
  };
  const hasIdentity = constraints.individualTagIds.length || constraints.categories.length;
  const hasHoliday = Boolean(hasIdentity) && matchesGlobalTagFilters(itemTagIds, constraints, catalog);
  return mode === 'exclude' ? !hasHoliday : hasHoliday;
}

export function renderGlobalTagFilter(container, catalog, { inputPrefix, optionsDataAttribute }) {
  if (!container) return;
  const previous = readGlobalTagFilter(container);
  const existing = container.querySelector('[data-global-tag-filter-options]');
  const hidden = existing?.hidden || false;
  const model = createGlobalTagFilterModel(catalog);
  const options = document.createElement('div');
  options.className = 'global-library-tag-filter';
  options.dataset.globalTagFilterOptions = '';
  options.dataset[optionsDataAttribute] = '';
  options.hidden = hidden;

  options.append(createHeading('All Tags'));
  const tags = document.createElement('div');
  tags.className = 'keyword-picker-options library-tag-filter-options';
  tags.append(...model.tags.map((tag) => createOption(tag, `${inputPrefix}-tags`, previous.individualTagIds.includes(tag.id))));
  options.append(tags);

  if (model.categories.length) options.append(createHeading('Categories'));
  for (const category of model.categories) {
    const selection = previous.categories.find((entry) => entry.categoryId === category.id);
    const details = document.createElement('details');
    details.className = 'library-tag-category';
    const summary = document.createElement('summary');
    summary.textContent = `${category.name} (${category.tags.length})`;
    const members = document.createElement('div');
    members.className = 'library-tag-category-members';
    const categoryOption = createOption(
      { id: category.id, name: `Any ${category.name} tag` },
      `${inputPrefix}-categories`,
      Boolean(selection)
    );
    categoryOption.querySelector('input').dataset.filterCategoryId = category.id;
    members.append(categoryOption);
    for (const tag of category.tags) {
      const option = createOption(tag, `${inputPrefix}-category-members`, selection?.memberTagIds.includes(tag.id));
      option.querySelector('input').dataset.filterCategoryMember = category.id;
      members.append(option);
    }
    details.append(summary, members);
    options.append(details);
  }
  existing?.remove();
  container.append(options);
}

export function readGlobalTagFilter(container) {
  if (!container) return { individualTagIds: [], categories: [] };
  const individualTagIds = checkedValues(container, 'input[data-global-tag-id]:checked:not([data-filter-category-member]):not([data-filter-category-id])');
  const categoryIds = checkedValues(container, 'input[data-filter-category-id]:checked');
  const categories = categoryIds.map((categoryId) => ({
    categoryId,
    memberTagIds: checkedValues(container, `input[data-filter-category-member="${categoryId}"]:checked`)
  }));
  return { individualTagIds, categories };
}

export function synchronizeGlobalTagFilterChange(target, container) {
  if (!target?.matches?.('input')) return;
  const memberCategoryId = target.dataset.filterCategoryMember;
  if (memberCategoryId && target.checked) {
    const category = container.querySelector(`input[data-filter-category-id="${memberCategoryId}"]`);
    if (category) category.checked = true;
  }
  const categoryId = target.dataset.filterCategoryId;
  if (categoryId && !target.checked) {
    for (const member of container.querySelectorAll(`input[data-filter-category-member="${categoryId}"]`)) member.checked = false;
  }
}

export function clearGlobalTagFilter(container) {
  for (const input of container?.querySelectorAll('input[data-global-tag-id]:checked') || []) input.checked = false;
}

function createHeading(text) {
  const heading = document.createElement('h4');
  heading.textContent = text;
  return heading;
}

function createOption(tag, name, checked = false) {
  const label = document.createElement('label');
  label.className = 'keyword-option library-tag-option';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = name;
  input.value = tag.id;
  input.dataset.globalTagId = tag.id;
  input.checked = checked;
  const text = document.createElement('span');
  text.textContent = tag.name;
  label.append(input, text);
  return label;
}

function checkedValues(container, selector) {
  return [...container.querySelectorAll(selector)].map((input) => input.value);
}

function sortByName(values) {
  return [...values].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

function assertCatalog(catalog) {
  if (!validateGlobalTagCatalog(catalog).ok) throw new TypeError('The global tag catalog is invalid.');
}
