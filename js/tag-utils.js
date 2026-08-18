export const PAPER_TAG_SEED = Object.freeze([
  "Illustration",
  "Floral",
  "Foliage",
  "Scenery",
  "Water",
  "Words",
  "Water Animals",
  "Land Animals",
  "Flying Animals",
  "Hobbies",
  "Food",
  "Masculine",
  "Specialty",
  "Textures",
  "Holiday",
  "Geometric"
]);

export function normalizeTagName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function getTagKey(value) {
  return normalizeTagName(value).toLocaleLowerCase();
}

export function uniqueTags(values = []) {
  const tags = [];
  const seenKeys = new Set();

  for (const value of values || []) {
    const tag = normalizeTagName(value);
    const key = getTagKey(tag);

    if (!key || seenKeys.has(key)) {
      continue;
    }

    tags.push(tag);
    seenKeys.add(key);
  }

  return tags;
}

export function mergeTagVocabularies(...sources) {
  return uniqueTags(sources.flatMap((source) => Array.isArray(source) ? source : []));
}

export function addTag(values, value) {
  return mergeTagVocabularies(values, [value]);
}

export function removeTag(values, value) {
  const keyToRemove = getTagKey(value);
  return uniqueTags(values).filter((tag) => getTagKey(tag) !== keyToRemove);
}

export function findMatchingTags(values, query) {
  const queryKey = getTagKey(query);
  const tags = uniqueTags(values);

  if (!queryKey) {
    return tags;
  }

  return tags.filter((tag) => getTagKey(tag).includes(queryKey));
}

export function buildEffectivePaperTagVocabulary(persistedVocabulary = [], paperPacks = []) {
  return mergeTagVocabularies(
    persistedVocabulary,
    PAPER_TAG_SEED,
    paperPacks.flatMap((paperPack) => paperPack?.keywords || [])
  );
}

export function buildEffectiveCardTagVocabulary(persistedVocabulary = [], cards = []) {
  return mergeTagVocabularies(
    persistedVocabulary,
    cards.flatMap((card) => card?.tags || [])
  );
}
