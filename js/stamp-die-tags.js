import { getTagKey } from './tag-utils.js';

export const STAMP_DIE_TOOL_TYPE_NAMES = Object.freeze(['Stamp', 'Die', 'Punch', 'Texture', 'Mask']);
const TOOL_TYPE_NAMES = new Set(STAMP_DIE_TOOL_TYPE_NAMES.map(getTagKey));

function getCategoryType(tag, catalog) {
  const categoriesById = new Map((catalog?.categories || []).map((category) => [category.id, category]));
  const names = (tag?.categoryIds || []).map((id) => getTagKey(categoriesById.get(id)?.name || ''));
  if (names.some((name) => ['tool', 'tools', 'tool type', 'tool types'].includes(name))) return 'tool';
  if (names.some((name) => name === 'theme' || name === 'themes')) return 'theme';
  return null;
}

export function getStampDieTagCategory(tag, catalog) {
  return getCategoryType(tag, catalog);
}

export function getStampDieToolTypeTags(catalog) {
  return (catalog?.tags || []).filter((tag) => TOOL_TYPE_NAMES.has(getTagKey(tag.name)));
}

// Tag IDs remain the source of truth; type is a presentation convention based on the current name.
export function partitionStampDieTagIds(tagIds = [], catalog) {
  const tagsById = new Map((catalog?.tags || []).map((tag) => [tag.id, tag]));
  const toolTypeTagIds = [];
  const themeTagIds = [];
  for (const id of tagIds || []) {
    const tag = tagsById.get(id);
    (tag && TOOL_TYPE_NAMES.has(getTagKey(tag.name)) ? toolTypeTagIds : themeTagIds).push(id);
  }
  return { toolTypeTagIds, themeTagIds };
}
