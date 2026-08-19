import { loadCardTagVocabulary, saveCardTagVocabulary } from './storage.js';
import { addTag, buildEffectiveCardTagVocabulary, getTagKey, normalizeTagName } from './tag-utils.js';

export function createCardTagVocabularyStore({ loadVocabulary = loadCardTagVocabulary, saveVocabulary = saveCardTagVocabulary } = {}) {
  let persistedVocabulary = [];
  return {
    async load(cards = []) {
      persistedVocabulary = await loadVocabulary();
      return buildEffectiveCardTagVocabulary(persistedVocabulary, cards);
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
