import { addTag, findMatchingTags, getTagKey, normalizeTagName, removeTag, uniqueTags } from './tag-utils.js';

export function getTagPickerChoices(vocabulary, selected, query) {
  const normalizedQuery = normalizeTagName(query);
  const selectedKeys = new Set(uniqueTags(selected).map(getTagKey));
  const matches = findMatchingTags(vocabulary, normalizedQuery)
    .filter((tag) => !selectedKeys.has(getTagKey(tag)))
    .map((tag) => ({ type: 'existing', tag }));
  const hasExactMatch = uniqueTags(vocabulary).some((tag) => getTagKey(tag) === getTagKey(normalizedQuery));
  return [...matches, ...normalizedQuery && !hasExactMatch ? [{ type: 'create', tag: normalizedQuery }] : []];
}

export function getNextTagPickerIndex(currentIndex, choiceCount, direction) {
  if (choiceCount === 0) return -1;
  if (currentIndex < 0) return direction > 0 ? 0 : choiceCount - 1;
  return (currentIndex + direction + choiceCount) % choiceCount;
}

export function createTagPickerState({ vocabulary = [], selected = [] } = {}) {
  let availableTags = uniqueTags(vocabulary);
  let selectedTags = uniqueTags(selected);
  return {
    getVocabulary: () => [...availableTags],
    setVocabulary: (values) => { availableTags = uniqueTags(values); },
    getSelected: () => [...selectedTags],
    setSelected: (values) => { selectedTags = uniqueTags(values); },
    getChoices: (query) => getTagPickerChoices(availableTags, selectedTags, query),
    select(value) {
      const canonical = availableTags.find((tag) => getTagKey(tag) === getTagKey(value));
      selectedTags = addTag(selectedTags, canonical || value);
    },
    remove(value) { selectedTags = removeTag(selectedTags, value); },
    addToVocabulary(value) {
      availableTags = addTag(availableTags, value);
      return availableTags.find((tag) => getTagKey(tag) === getTagKey(value));
    }
  };
}

let nextPickerId = 0;

export function createTagPicker({ label = 'Tags', inputLabel, placeholder = 'Search tags', vocabulary = [], selected = [], onCreateTag = async (tag) => tag } = {}) {
  const state = createTagPickerState({ vocabulary, selected });
  const id = `tag-picker-${++nextPickerId}`;
  const section = document.createElement('section');
  section.className = 'tag-picker';
  const heading = document.createElement('h4');
  heading.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', inputLabel || `Search or create ${label}`);
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', `${id}-results`);
  input.setAttribute('aria-expanded', 'false');
  const results = document.createElement('ul');
  results.id = `${id}-results`;
  results.className = 'tag-picker-results';
  results.setAttribute('role', 'listbox');
  results.hidden = true;
  const status = document.createElement('p');
  status.className = 'tag-picker-status';
  status.setAttribute('aria-live', 'polite');
  const selectedList = document.createElement('ul');
  selectedList.className = 'tag-picker-selected';
  selectedList.setAttribute('aria-label', `Selected ${label}`);
  section.append(heading, input, results, status, selectedList);
  let choices = [];
  let activeIndex = -1;
  let creating = false;

  function renderSelected() {
    selectedList.replaceChildren();
    for (const tag of state.getSelected()) {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = tag;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.removeTag = getTagKey(tag);
      remove.setAttribute('aria-label', `Remove ${tag}`);
      remove.textContent = String.fromCodePoint(215);
      item.append(name, remove);
      selectedList.append(item);
    }
  }

  function renderChoices() {
    choices = state.getChoices(input.value);
    if (activeIndex >= choices.length) activeIndex = choices.length - 1;
    results.replaceChildren();
    choices.forEach((choice, index) => {
      const item = document.createElement('li');
      item.id = `${id}-option-${index}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === activeIndex));
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.choiceIndex = String(index);
      button.textContent = choice.type === 'create' ? `Create "${choice.tag}"` : choice.tag;
      item.append(button);
      results.append(item);
    });
    results.hidden = choices.length === 0;
    input.setAttribute('aria-expanded', String(choices.length > 0));
    if (activeIndex >= 0) input.setAttribute('aria-activedescendant', `${id}-option-${activeIndex}`);
    else input.removeAttribute('aria-activedescendant');
  }

  async function choose(index) {
    const choice = choices[index];
    if (!choice || creating) return;
    try {
      creating = true;
      status.textContent = '';
      let tag = choice.tag;
      if (choice.type === 'create') {
        tag = normalizeTagName(await onCreateTag(tag)) || tag;
        state.addToVocabulary(tag);
      }
      state.select(tag);
      input.value = '';
      activeIndex = -1;
      renderSelected();
      renderChoices();
      input.focus();
    } catch {
      status.textContent = 'The tag could not be created.';
    } finally {
      creating = false;
    }
  }

  input.addEventListener('input', () => { activeIndex = -1; renderChoices(); });
  input.addEventListener('focus', renderChoices);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      activeIndex = getNextTagPickerIndex(activeIndex, choices.length, step);
      renderChoices();
    } else if (event.key === 'Enter' && choices.length) {
      event.preventDefault();
      void choose(activeIndex >= 0 ? activeIndex : 0);
    } else if (event.key === 'Escape') {
      input.value = '';
      activeIndex = -1;
      renderChoices();
    } else if (event.key === 'Backspace' && !input.value && state.getSelected().length) {
      state.remove(state.getSelected().at(-1));
      renderSelected();
      renderChoices();
    }
  });
  results.addEventListener('mousedown', (event) => event.preventDefault());
  results.addEventListener('click', (event) => {
    const button = event.target.closest('[data-choice-index]');
    if (button) void choose(Number(button.dataset.choiceIndex));
  });
  selectedList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-tag]');
    if (!button) return;
    state.remove(button.dataset.removeTag);
    renderSelected();
    renderChoices();
    input.focus();
  });
  renderSelected();

  return {
    element: section,
    getSelected: state.getSelected,
    setSelected(values) { state.setSelected(values); renderSelected(); renderChoices(); },
    setVocabulary(values) { state.setVocabulary(values); renderChoices(); },
    reset() {
      input.value = '';
      status.textContent = '';
      activeIndex = -1;
      state.setSelected([]);
      renderSelected();
      renderChoices();
    }
  };
}
