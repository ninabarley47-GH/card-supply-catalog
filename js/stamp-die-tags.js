import { getTagKey } from './tag-utils.js';

const TOOL_TYPE_NAMES = new Set(['stamp', 'die', 'punch', 'texture', 'mask']);

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
