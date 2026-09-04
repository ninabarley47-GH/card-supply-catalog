import { getGlobalTagNameKey, validateGlobalTagCatalog, validateItemTagAssignments } from './global-tag-catalog.js';

export function getApplicableTagPickerModel(catalog, productType) {
  assertCatalog(catalog);
  const applicableTags = sortByName(catalog.tags.filter((tag) => tag.appliesTo.includes(productType)));
  const applicableIds = new Set(applicableTags.map((tag) => tag.id));
  const categories = sortByName(catalog.categories)
    .map((category) => ({ ...category, tags: applicableTags.filter((tag) => tag.categoryIds.includes(category.id)) }))
    .filter((category) => category.tags.length > 0);
  return { applicableTags, uncategorizedTags: applicableTags.filter((tag) => tag.categoryIds.length === 0), categories, applicableIds };
}

export function searchApplicableTags(catalog, productType, query) {
  const normalizedQuery = getGlobalTagNameKey(query);
  if (!normalizedQuery) return [];
  const model = getApplicableTagPickerModel(catalog, productType);
  const categoriesById = new Map(catalog.categories.map((category) => [category.id, category.name]));
  return model.applicableTags
    .filter((tag) => getGlobalTagNameKey(tag.name).includes(normalizedQuery))
    .map((tag) => ({
      id: tag.id,
      name: tag.name,
      categoryNames: sortNames(tag.categoryIds.map((id) => categoriesById.get(id)).filter(Boolean))
    }));
}

export function resolveItemTagIds(record, catalog, productType, legacyField) {
  assertCatalog(catalog);
  if (Array.isArray(record?.tagIds)) {
    const validation = validateItemTagAssignments({ catalog, productType, tagIds: record.tagIds });
    if (!validation.ok) throw new TypeError('The item contains tag assignments that cannot be resolved.');
    return [...record.tagIds];
  }
  const applicableByName = new Map(
    catalog.tags.filter((tag) => tag.appliesTo.includes(productType)).map((tag) => [getGlobalTagNameKey(tag.name), tag.id])
  );
  const names = Array.isArray(record?.[legacyField]) ? record[legacyField] : [];
  const tagIds = names.map((name) => applicableByName.get(getGlobalTagNameKey(name)));
  if (tagIds.some((id) => !id)) throw new TypeError('The item contains tag assignments that cannot be resolved.');
  return [...new Set(tagIds)];
}

export function projectTagNames(catalog, tagIds, productType) {
  const validation = validateItemTagAssignments({ catalog, productType, tagIds });
  if (!validation.ok) throw new TypeError('The selected tag assignments are invalid.');
  const namesById = new Map(catalog.tags.map((tag) => [tag.id, tag.name]));
  return tagIds.map((id) => namesById.get(id));
}

export function createTagPickerState({ catalog, productType, selectedTagIds = [] }) {
  let currentCatalog = catalog;
  let model = getApplicableTagPickerModel(currentCatalog, productType);
  let selectedIds = validateSelected(selectedTagIds, currentCatalog, productType);
  return {
    getCatalog: () => currentCatalog,
    getModel: () => model,
    getSelectedTagIds: () => [...selectedIds],
    getSelectedTags: () => selectedIds.map((id) => currentCatalog.tags.find((tag) => tag.id === id)),
    isSelected: (tagId) => selectedIds.includes(tagId),
    setCatalog(nextCatalog) {
      currentCatalog = nextCatalog;
      model = getApplicableTagPickerModel(currentCatalog, productType);
      selectedIds = validateSelected(selectedIds, currentCatalog, productType);
    },
    setSelectedTagIds(tagIds) { selectedIds = validateSelected(tagIds, currentCatalog, productType); },
    select(tagId) {
      assertApplicableTag(model, tagId);
      if (!selectedIds.includes(tagId)) selectedIds.push(tagId);
    },
    deselect(tagId) { selectedIds = selectedIds.filter((id) => id !== tagId); },
    toggle(tagId, selected) { selected ? this.select(tagId) : this.deselect(tagId); },
    search(query) { return searchApplicableTags(currentCatalog, productType, query); },
    reset() { selectedIds = []; }
  };
}

let nextPickerId = 0;

export function createTagPicker({ label = 'Tags', productType, catalog, selectedTagIds = [], onSelectionChange = () => {} }) {
  const state = createTagPickerState({ catalog, productType, selectedTagIds });
  const id = `global-tag-picker-${++nextPickerId}`;
  const section = document.createElement('section');
  section.className = 'tag-picker global-tag-picker';
  const heading = document.createElement('h4');
  heading.textContent = label;
  const selectedHeading = document.createElement('h5');
  selectedHeading.textContent = 'Selected Tags';
  const selectedList = document.createElement('ul');
  selectedList.className = 'tag-picker-selected';
  selectedList.setAttribute('aria-label', `Selected ${label}`);
  const searchLabel = document.createElement('label');
  searchLabel.className = 'tag-picker-search-label';
  searchLabel.textContent = 'Find a tag';
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Search tags';
  input.setAttribute('aria-controls', `${id}-search-results`);
  searchLabel.append(input);
  const searchResults = document.createElement('div');
  searchResults.id = `${id}-search-results`;
  searchResults.className = 'global-tag-picker-search-results';
  searchResults.setAttribute('aria-live', 'polite');
  const taxonomy = document.createElement('div');
  taxonomy.className = 'global-tag-picker-taxonomy';
  section.append(heading, selectedHeading, selectedList, searchLabel, searchResults, taxonomy);

  function notify() { onSelectionChange(state.getSelectedTagIds()); }

  function createTagOption(tag, context = '') {
    const option = document.createElement('label');
    option.className = 'global-tag-picker-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.tagId = tag.id;
    checkbox.checked = state.isSelected(tag.id);
    const text = document.createElement('span');
    text.append(Object.assign(document.createElement('strong'), { textContent: tag.name }));
    if (context) text.append(Object.assign(document.createElement('small'), { textContent: context }));
    option.append(checkbox, text);
    return option;
  }

  function renderSelected() {
    selectedList.replaceChildren(...state.getSelectedTags().map((tag) => {
      const item = document.createElement('li');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.removeTagId = tag.id;
      remove.setAttribute('aria-label', `Remove ${tag.name}`);
      remove.textContent = `${tag.name} ×`;
      item.append(remove);
      return item;
    }));
    selectedHeading.hidden = selectedList.childElementCount === 0;
    selectedList.hidden = selectedList.childElementCount === 0;
  }

  function renderTaxonomy() {
    const model = state.getModel();
    const children = [];
    if (model.uncategorizedTags.length) {
      const group = document.createElement('fieldset');
      group.className = 'global-tag-picker-uncategorized';
      group.append(Object.assign(document.createElement('legend'), { textContent: 'Uncategorized' }));
      group.append(...model.uncategorizedTags.map((tag) => createTagOption(tag)));
      children.push(group);
    }
    for (const category of model.categories) {
      const details = document.createElement('details');
      details.className = 'global-tag-picker-category';
      details.dataset.categoryId = category.id;
      details.append(Object.assign(document.createElement('summary'), { textContent: `${category.name} (${category.tags.length})` }));
      const options = document.createElement('div');
      options.append(...category.tags.map((tag) => createTagOption(tag)));
      details.append(options);
      children.push(details);
    }
    taxonomy.replaceChildren(...children);
  }

  function renderSearch() {
    const query = input.value.trim();
    if (!query) { searchResults.replaceChildren(); searchResults.hidden = true; return; }
    const matches = state.search(query);
    if (!matches.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No matching tags. New tags can be added in Settings.';
      searchResults.replaceChildren(empty);
    } else {
      searchResults.replaceChildren(...matches.map((match) => createTagOption(
        match,
        match.categoryNames.length ? match.categoryNames.join(' · ') : 'Uncategorized'
      )));
    }
    searchResults.hidden = false;
  }

  function syncSelectionViews() {
    section.querySelectorAll('[data-tag-id]').forEach((checkbox) => {
      checkbox.checked = state.isSelected(checkbox.dataset.tagId);
    });
    renderSelected();
    notify();
  }

  section.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-tag-id]');
    if (!checkbox) return;
    state.toggle(checkbox.dataset.tagId, checkbox.checked);
    syncSelectionViews();
  });
  selectedList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-tag-id]');
    if (!button) return;
    state.deselect(button.dataset.removeTagId);
    syncSelectionViews();
    input.focus();
  });
  input.addEventListener('input', renderSearch);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { input.value = ''; renderSearch(); }
  });

  renderSelected();
  renderTaxonomy();
  renderSearch();

  return {
    element: section,
    getSelectedTagIds: state.getSelectedTagIds,
    getSelectedTags: state.getSelectedTags,
    setSelectedTagIds(tagIds) { state.setSelectedTagIds(tagIds); renderTaxonomy(); renderSearch(); renderSelected(); },
    setCatalog(nextCatalog) { state.setCatalog(nextCatalog); renderTaxonomy(); renderSearch(); renderSelected(); },
    reset() { input.value = ''; state.reset(); renderTaxonomy(); renderSearch(); renderSelected(); }
  };
}

function validateSelected(tagIds, catalog, productType) {
  const uniqueIds = [...new Set(Array.isArray(tagIds) ? tagIds : [])];
  const validation = validateItemTagAssignments({ catalog, productType, tagIds: uniqueIds });
  if (!validation.ok) throw new TypeError('The selected tag assignments are invalid.');
  return uniqueIds;
}

function assertApplicableTag(model, tagId) {
  if (!model.applicableIds.has(tagId)) throw new TypeError('Only applicable tags can be selected.');
}

function assertCatalog(catalog) {
  if (!validateGlobalTagCatalog(catalog).ok) throw new TypeError('The global tag catalog is invalid.');
}

function sortByName(entries) {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

function sortNames(names) {
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}
