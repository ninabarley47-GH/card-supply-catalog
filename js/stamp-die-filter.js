import { normalizeFilterText } from './search.js';
import { refreshOwnerFilter } from './owner-picker.js';
import {
  matchesGlobalTagFilters, getGlobalTagSearchNames, renderGlobalTagFilter,
  readGlobalTagFilter, synchronizeGlobalTagFilterChange, clearGlobalTagFilter
} from './global-tag-filter.js';
import { getStampDieToolTypeTags } from './stamp-die-tags.js';

const renderedToolTypeOptions = new WeakMap();

export function filterStampDieSets(records, filters, catalog, owners = []) {
  const query = normalizeFilterText(filters.query);
  const ownerNames = new Map(owners.map((owner) => [owner.id, owner.name]));
  return records.filter((record) => {
    if (filters.ownerId && record.ownerId !== filters.ownerId) return false;
    if (filters.favoritesOnly && !record.favorite) return false;
    if (filters.releaseYear && String(record.releaseYear) !== String(filters.releaseYear)) return false;
    if (!matchesGlobalTagFilters(record.tagIds, { individualTagIds: filters.selectedToolTypeTagIds || [], categories: [] }, catalog)) return false;
    if (!matchesGlobalTagFilters(record.tagIds, filters.selectedTags, catalog)) return false;
    if (!query) return true;
    const text = [record.name, record.releaseYear, ownerNames.get(record.ownerId), record.brand, record.purchasedFrom,
      ...getGlobalTagSearchNames(record.tagIds, catalog)].join(' ');
    return normalizeFilterText(text).includes(query);
  });
}

// Controls only read in-memory state; record/image loading belongs to the Library.
export function initializeStampDieFilters(owners, onChange) {
  const form = document.querySelector('[data-set-library-filter-form]');
  const search = document.querySelector('[data-set-library-search]');
  const owner = document.querySelector('[data-set-library-owner]');
  const year = document.querySelector('[data-set-library-year]');
  const favorite = document.querySelector('[data-set-library-favorites]');
  const tags = document.querySelector('[data-set-library-tag-filters]');
  const toolTypes = document.querySelector('[data-set-library-tool-type-filters]');
  const clearToolTypes = document.querySelector('[data-set-library-clear-tool-types]');
  const toggleToolTypes = document.querySelector('[data-set-library-toggle-tool-types]');
  const toolTypeOptions = document.querySelector('[data-set-library-tool-type-options]');
  const clear = document.querySelector('[data-set-library-clear]');
  const clearTags = document.querySelector('[data-set-library-clear-tags]');
  const toggle = document.querySelector('[data-set-library-toggle-tags]');

  function read() {
    return {
      query: search?.value || '', ownerId: owner?.value || '', releaseYear: year?.value || '',
      favoritesOnly: favorite?.getAttribute('aria-pressed') === 'true',
      selectedToolTypeTagIds: [...(toolTypes?.querySelectorAll('input[data-stamp-tool-type-id]:checked') || [])].map((input) => input.dataset.stampToolTypeId),
      selectedTags: readGlobalTagFilter(tags)
    };
  }

  function updateControls() {
    const state = read();
    const hasTags = state.selectedTags.individualTagIds.length || state.selectedTags.categories.length;
    const hasToolTypes = state.selectedToolTypeTagIds.length > 0;
    if (clear) clear.hidden = !(state.query.trim() || state.ownerId || state.releaseYear || state.favoritesOnly || hasTags || hasToolTypes);
    if (clearTags) clearTags.hidden = !hasTags;
    if (clearToolTypes) clearToolTypes.hidden = !hasToolTypes;
    const icon = favorite?.querySelector('.card-library-favorites-icon');
    if (icon) icon.textContent = state.favoritesOnly ? '\u2665' : '\u2661';
    for (const control of [owner, year]) {
      control?.closest('.card-library-quick-filter')?.classList.toggle('is-active', Boolean(control.value));
    }
  }

  function change() { updateControls(); onChange(); }
  search?.addEventListener('input', change);
  owner?.addEventListener('change', change);
  year?.addEventListener('change', change);
  favorite?.addEventListener('click', () => {
    favorite.setAttribute('aria-pressed', String(!read().favoritesOnly));
    change();
  });
  tags?.addEventListener('change', (event) => {
    synchronizeGlobalTagFilterChange(event.target, tags);
    change();
  });
  toolTypes?.addEventListener('change', change);
  clear?.addEventListener('click', () => {
    if (search) search.value = '';
    if (owner) owner.value = '';
    if (year) year.value = '';
    favorite?.setAttribute('aria-pressed', 'false');
    clearGlobalTagFilter(tags);
    clearStampDieToolTypeFilter(toolTypes);
    change();
    search?.focus();
  });
  clearTags?.addEventListener('click', () => { clearGlobalTagFilter(tags); change(); });
  clearToolTypes?.addEventListener('click', () => { clearStampDieToolTypeFilter(toolTypes); change(); });
  toggle?.addEventListener('click', () => {
    const options = tags?.querySelector('[data-global-tag-filter-options]');
    if (!options) return;
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    options.hidden = expanded;
  });
  toggleToolTypes?.addEventListener('click', () => {
    if (!toolTypeOptions) return;
    const expanded = toggleToolTypes.getAttribute('aria-expanded') === 'true';
    toggleToolTypes.setAttribute('aria-expanded', String(!expanded));
    toolTypeOptions.hidden = expanded;
  });
  form?.addEventListener('submit', (event) => event.preventDefault());

  return {
    read,
    refreshOwners() { refreshOwnerFilter(owner, owners); updateControls(); },
    refreshCatalog(catalog, items) {
      renderGlobalTagFilter(tags, catalog, { inputPrefix: 'set-library', optionsDataAttribute: 'setTagFilterOptions', items });
      renderStampDieToolTypeFilter(toolTypes, catalog);
      updateControls();
    },
    refreshYears(records) {
      if (!year) return;
      const selected = year.value;
      const years = new Set(records.map((record) => record.releaseYear).filter(Number.isInteger));
      // Keep the selected constraint if an edit/delete removes its last matching Set.
      if (selected) years.add(Number(selected));
      year.replaceChildren(new Option('All', ''),
        ...[...years].sort((a, b) => b - a).map((value) => new Option(String(value), String(value))));
      year.value = selected;
      updateControls();
    }
  };
}

export function renderStampDieToolTypeFilter(container, catalog) {
  if (!container) return;
  const options = container.querySelector('[data-set-library-tool-type-options]');
  const available = getStampDieToolTypeTags(catalog);
  const signature = JSON.stringify(available.map((tag) => [tag.id, tag.name]));
  if (options && renderedToolTypeOptions.get(container) === signature) return;
  const previous = new Set(readStampDieToolTypeFilter(container));
  const wasHidden = options?.hidden || false;
  const list = document.createElement('div');
  list.className = 'keyword-picker-options library-tag-filter-options';
  list.dataset.setLibraryToolTypeOptions = '';
  list.hidden = wasHidden;
  for (const tag of available) {
    const label = document.createElement('label');
    label.className = 'keyword-option library-tag-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'set-library-tool-types';
    input.value = tag.id;
    input.dataset.stampToolTypeId = tag.id;
    input.checked = previous.has(tag.id);
    const text = document.createElement('span');
    text.textContent = tag.name;
    label.append(input, text);
    list.append(label);
  }
  if (options) {
    options.replaceChildren(...list.children);
    options.className = list.className;
    options.hidden = list.hidden;
  }
  renderedToolTypeOptions.set(container, signature);
}

export function readStampDieToolTypeFilter(container) {
  return [...(container?.querySelectorAll('input[data-stamp-tool-type-id]:checked') || [])]
    .map((input) => input.dataset.stampToolTypeId);
}

export function clearStampDieToolTypeFilter(container) {
  for (const input of container?.querySelectorAll('input[data-stamp-tool-type-id]:checked') || []) input.checked = false;
}
