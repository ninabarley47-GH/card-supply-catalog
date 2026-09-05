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
