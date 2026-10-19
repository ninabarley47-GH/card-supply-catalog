const MAX_METADATA_TEXT_LENGTH = 100;

export function normalizeOptionalProductMetadata(value, fieldName) {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new TypeError(`${fieldName} must be a string.`);
  const normalized = value.trim();
  if (normalized.length > MAX_METADATA_TEXT_LENGTH) throw new TypeError(`${fieldName} must be 100 characters or fewer.`);
  return normalized;
}

export function normalizeProductMetadata(record) {
  const normalized = { ...record };
  for (const [field, fieldName] of [['brand', 'Brand'], ['purchasedFrom', 'Purchased From']]) {
    const value = normalizeOptionalProductMetadata(record[field], fieldName);
    if (value === undefined) delete normalized[field];
    else normalized[field] = value;
  }
  return normalized;
}

export function isOptionalProductMetadata(value) {
  return value == null || (typeof value === 'string' && value.trim().length <= MAX_METADATA_TEXT_LENGTH);
}
