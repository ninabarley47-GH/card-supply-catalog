import { validateItemTagAssignments, getGlobalTagNameKey } from './global-tag-catalog.js';

const BUILT_IN_TOOL_CUES = Object.freeze({
  stamp: ['stamp'],
  die: ['die'],
  punch: ['punch'],
  mask: ['mask'],
  texture: ['texture']
});

export function getStampDieImageType(filename) {
  return /die/i.test(filename) ? 'Die' : /punch/i.test(filename) ? 'Punch' : /mask/i.test(filename) ? 'Mask' : 'Stamp';
}

// Stable presentation ordering; classification is derived, never persisted.
export function orderStampDieImages(images) {
  const rank = { Stamp: 0, Die: 1, Punch: 2, Mask: 3, Texture: 4 };
  return [...images].sort((a, b) => rank[getStampDieImageType(a.name || a.imageName || a.imagePath?.split('/').pop() || '')]
    - rank[getStampDieImageType(b.name || b.imageName || b.imagePath?.split('/').pop() || '')]);
}

// Runs only for newly selected filenames, never for save, removal, or reload.
// Inference only assigns existing Tool Tag IDs; it never creates catalog entries.
export function inferStampDieImageTags(catalog, tagIds, filenames) {
  if (!validateItemTagAssignments({ catalog, productType: 'stamp', tagIds }).ok) throw new TypeError('Invalid image inference assignments.');
  const selected = new Set(tagIds);
  const warnings = [];
  const matchedTags = new Map();
  for (const filename of new Set(filenames)) {
    const result = matchToolFilename(catalog, filename);
    if (result.missingBuiltIns.length) {
      warnings.push(`${filename}: missing Tool Tag configuration for ${result.missingBuiltIns.join(', ')}.`);
      continue;
    }
    if (result.matches.length > 1) {
      warnings.push(`${filename}: matches multiple Tool Tags (${result.matches.map((tag) => tag.name).join(', ')}); no tag was assigned.`);
      continue;
    }
    if (result.matches.length === 1) {
      selected.add(result.matches[0].id);
      matchedTags.set(result.matches[0].id, result.matches[0]);
      continue;
    }
    const stampFallback = catalog.tags.find((tag) => tag.type === 'tool' && tag.unmatchedFilenameFallback === true);
    if (result.recognizedBuiltIns.some((name) => name !== 'stamp') || (result.recognizedBuiltIns.includes('stamp') && !stampFallback)) {
      warnings.push(`${filename}: no configured Tool Tag matches this filename.`);
      continue;
    }
    if (stampFallback) { selected.add(stampFallback.id); matchedTags.set(stampFallback.id, stampFallback); }
    else warnings.push(`${filename}: no Stamp Tool Tag is configured, so no tag was assigned.`);
  }
  return { catalog, tagIds: [...selected], inferredTags: [], matchedTags: [...matchedTags.values()], warnings };
}

function matchToolFilename(catalog, filename) {
  const words = tokenize(filename);
  const matches = [];
  for (const tag of catalog.tags.filter((entry) => entry.type === 'tool')) {
    if ((tag.filenameTerms || []).some((term) => containsTerm(words, term))) matches.push(tag);
  }
  const recognizedBuiltIns = Object.entries(BUILT_IN_TOOL_CUES)
    .filter(([, terms]) => terms.some((term) => containsTerm(words, term)))
    .map(([name]) => name);
  const missingBuiltIns = recognizedBuiltIns.filter((name) => {
    const configuredNameTag = catalog.tags.find((tag) => tag.type === 'tool' && getGlobalTagNameKey(tag.name) === name);
    const configuredCueMatch = matches.some((tag) => tag.filenameTerms.some((term) =>
      termsForBuiltInCue(name).some((cue) => containsTerm(tokenize(term), cue))));
    const stampFallback = name === 'stamp' && catalog.tags.some((tag) => tag.type === 'tool' && tag.unmatchedFilenameFallback === true);
    return !configuredNameTag && !configuredCueMatch && !stampFallback;
  }).map(capitalize);
  return { matches, recognizedBuiltIns, missingBuiltIns };
}

function termsForBuiltInCue(name) {
  return BUILT_IN_TOOL_CUES[name] || [];
}

function containsTerm(words, term) {
  const termWords = tokenize(term);
  if (!termWords.length) return false;
  const last = termWords.at(-1);
  const variants = new Set([last, ...pluralVariants(last), ...singularVariants(last)]);
  for (let start = 0; start <= words.length - termWords.length; start += 1) {
    if (termWords.slice(0, -1).every((word, offset) => words[start + offset] === word) &&
        variants.has(words[start + termWords.length - 1])) return true;
  }
  return false;
}

function tokenize(value) {
  const normalized = String(value || '').normalize('NFKC').toLocaleLowerCase();
  return normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function pluralVariants(word) {
  if (word.endsWith('ss')) return [`${word}es`];
  if (word.endsWith('s')) return [];
  if (/[sxz]$|ch$|sh$/.test(word)) return [`${word}es`];
  if (/[^aeiou]y$/.test(word)) return [`${word.slice(0, -1)}ies`];
  return [`${word}s`];
}

function singularVariants(word) {
  if (word === 'dies') return ['die'];
  if (word.endsWith('sses') && word.length > 4) return [word.slice(0, -2)];
  if (word.endsWith('ies') && word.length > 3) return [word.slice(0, -3) + 'y'];
  if (/(ches|shes|xes|zes)$/.test(word) && word.length > 2) return [word.slice(0, -2)];
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 2) return [word.slice(0, -1)];
  return [];
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Pending draft compatibility: retain assigned IDs only when they still exist
// in the current catalog. Never recreate a Tool Tag during reconciliation.
export function reconcileStampDieImageTags(record, catalog, inferredTags = []) {
  const pendingIds = new Set(inferredTags.map((tag) => tag.id));
  const currentIds = new Set(catalog.tags.map((tag) => tag.id));
  return { catalog, record: { ...record, tagIds: [...new Set(record.tagIds || [])].filter((id) => !pendingIds.has(id) || currentIds.has(id)) } };
}
