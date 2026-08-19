import { loadCardTagVocabulary, saveCardTagVocabulary } from './storage.js';
import { addTag, buildEffectiveCardTagVocabulary, getTagKey, normalizeTagName } from './tag-utils.js';

export function createCardTagVocabularyStore({ loadVocabulary = loadCardTagVocabulary, saveVocabulary = saveCardTagVocabulary } = {}) {
  return createTagVocabularyStore({ loadVocabulary, saveVocabulary, buildVocabulary: buildEffectiveCardTagVocabulary });
}

export function createTagVocabularyStore({ loadVocabulary, saveVocabulary, buildVocabulary, onVocabularyChanged = () => {} }) {
  let persistedVocabulary = [];
  return {
    async load(records = []) {
      persistedVocabulary = await loadVocabulary();
      return buildVocabulary(persistedVocabulary, records);
    },
    async create(value) {
      const tag = normalizeTagName(value);
      const currentVocabulary = Array.isArray(persistedVocabulary)
        ? persistedVocabulary
        : buildVocabulary(persistedVocabulary, []);
      const existing = currentVocabulary.find((candidate) => getTagKey(candidate) === getTagKey(tag));
      if (existing) return existing;
      const nextVocabulary = addTag(currentVocabulary, tag);
      await saveVocabulary(nextVocabulary);
      persistedVocabulary = nextVocabulary;
      onVocabularyChanged(nextVocabulary);
      return tag;
    }
  };
}
