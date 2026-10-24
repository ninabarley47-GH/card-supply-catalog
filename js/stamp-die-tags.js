import { getTagKey } from './tag-utils.js';

export const STAMP_DIE_TOOL_TYPE_NAMES = Object.freeze(['Stamp', 'Die', 'Punch', 'Texture', 'Mask']);
const TOOL_TYPE_NAMES = new Set(STAMP_DIE_TOOL_TYPE_NAMES.map(getTagKey));

function getPresentationType(tag) {
  // Stamp Set tool types are a fixed part of this library's vocabulary; every
  // other assigned tag is presented as a theme.
  return TOOL_TYPE_NAMES.has(getTagKey(tag?.name || '')) ? 'tool' : 'theme';
}

export function getStampDieTagType(tag) {
  return getPresentationType(tag);
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
