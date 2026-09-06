import { normalizeFilterText } from './search.js';
import { refreshOwnerFilter } from './owner-picker.js';
import {
  matchesGlobalTagFilters, getGlobalTagSearchNames, renderGlobalTagFilter,
  readGlobalTagFilter, synchronizeGlobalTagFilterChange, clearGlobalTagFilter
} from './global-tag-filter.js';

export function filterStampDieSets(records, filters, catalog, owners = []) {
  const query = normalizeFilterText(filters.query);
  const ownerNames = new Map(owners.map((owner) => [owner.id, owner.name]));
  return records.filter((record) => {
    if (filters.ownerId && record.ownerId !== filters.ownerId) return false;
    if (filters.favoritesOnly && !record.favorite) return false;
    if (filters.releaseYear && String(record.releaseYear) !== String(filters.releaseYear)) return false;
    if (!matchesGlobalTagFilters(record.tagIds, filters.selectedTags, catalog)) return false;
    if (!query) return true;
    const text = [record.name, record.releaseYear, ownerNames.get(record.ownerId),
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
  const clear = document.querySelector('[data-set-library-clear]');
  const clearTags = document.querySelector('[data-set-library-clear-tags]');
  const toggle = document.querySelector('[data-set-library-toggle-tags]');

  function read() {
    return {
      query: search?.value || '', ownerId: owner?.value || '', releaseYear: year?.value || '',
      favoritesOnly: favorite?.getAttribute('aria-pressed') === 'true',
      selectedTags: readGlobalTagFilter(tags)
    };
  }

  function updateControls() {
    const state = read();
    const hasTags = state.selectedTags.individualTagIds.length || state.selectedTags.categories.length;
    if (clear) clear.hidden = !(state.query.trim() || state.ownerId || state.releaseYear || state.favoritesOnly || hasTags);
    if (clearTags) clearTags.hidden = !hasTags;
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
  clear?.addEventListener('click', () => {
    if (search) search.value = '';
    if (owner) owner.value = '';
    if (year) year.value = '';
    favorite?.setAttribute('aria-pressed', 'false');
    clearGlobalTagFilter(tags);
    change();
    search?.focus();
  });
  clearTags?.addEventListener('click', () => { clearGlobalTagFilter(tags); change(); });
  toggle?.addEventListener('click', () => {
    const options = tags?.querySelector('[data-global-tag-filter-options]');
    if (!options) return;
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    options.hidden = expanded;
  });
  form?.addEventListener('submit', (event) => event.preventDefault());

  return {
    read,
    refreshOwners() { refreshOwnerFilter(owner, owners); updateControls(); },
    refreshCatalog(catalog) {
      renderGlobalTagFilter(tags, catalog, { inputPrefix: 'set-library', optionsDataAttribute: 'setTagFilterOptions' });
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
