export function normalizeFilterText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
}
