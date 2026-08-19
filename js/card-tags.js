import { loadCardTagVocabulary, saveCardTagVocabulary } from './storage.js';
import { addTag, buildEffectiveCardTagVocabulary, getTagKey, normalizeTagName } from './tag-utils.js';

export function createCardTagVocabularyStore({ loadVocabulary = loadCardTagVocabulary, saveVocabulary = saveCardTagVocabulary } = {}) {
  return createTagVocabularyStore({ loadVocabulary, saveVocabulary, buildVocabulary: buildEffectiveCardTagVocabulary });
}

export function createTagVocabularyStore({ loadVocabulary, saveVocabulary, buildVocabulary }) {
  let persistedVocabulary = [];
  return {
    async load(records = []) {
      persistedVocabulary = await loadVocabulary();
      return buildVocabulary(persistedVocabulary, records);
    },
    async create(value) {
      const tag = normalizeTagName(value);
      const existing = persistedVocabulary.find((candidate) => getTagKey(candidate) === getTagKey(tag));
      if (existing) return existing;
      const nextVocabulary = addTag(persistedVocabulary, tag);
      await saveVocabulary(nextVocabulary);
      persistedVocabulary = nextVocabulary;
      return tag;
    }
  };
}
