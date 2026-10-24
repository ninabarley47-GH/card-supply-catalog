import { getTagKey } from './tag-utils.js';

export const STAMP_DIE_TOOL_TYPE_NAMES = Object.freeze(['Stamp', 'Die', 'Punch', 'Mask', 'Texture']);
export function getStampDieTagType(tag) {
  return tag?.type === 'tool' ? 'tool' : 'theme';
}

export function getStampDieToolTypeTags(catalog) {
  return (catalog?.tags || []).filter((tag) => tag?.type === 'tool');
}

// Tag IDs remain the source of truth; catalog type only determines presentation.
export function partitionStampDieTagIds(tagIds = [], catalog) {
  const tagsById = new Map((catalog?.tags || []).map((tag) => [tag.id, tag]));
  const toolTypeTagIds = [];
  const themeTagIds = [];
  for (const id of tagIds || []) {
    const tag = tagsById.get(id);
    (tag && tag.type === 'tool' ? toolTypeTagIds : themeTagIds).push(id);
  }
  const toolTypeOrder = new Map(STAMP_DIE_TOOL_TYPE_NAMES.map((name, index) => [getTagKey(name), index]));
  toolTypeTagIds.sort((leftId, rightId) => {
    const left = tagsById.get(leftId);
    const right = tagsById.get(rightId);
    const leftRank = toolTypeOrder.get(getTagKey(left.name)) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = toolTypeOrder.get(getTagKey(right.name)) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || left.name.localeCompare(right.name) || leftId.localeCompare(rightId);
  });
  return { toolTypeTagIds, themeTagIds };
}
