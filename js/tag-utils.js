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

// Comparison-only normalization for product names. Keep the original value for
// display and persistence; this only canonicalizes standalone "and" / "&".
export function getProductNameKey(value) {
  return getTagKey(value).replace(/(^|\s)(?:and|&)(?=\s|$)/g, "$1and");
}
