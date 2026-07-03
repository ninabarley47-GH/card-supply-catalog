const PAPER_PACKS_STORAGE_KEY = "card-supply-catalog.paperPacks";

export function loadSavedPaperPacks() {
  try {
    const rawPaperPacks = window.localStorage.getItem(PAPER_PACKS_STORAGE_KEY);

    if (!rawPaperPacks) {
      return [];
    }

    const paperPacks = JSON.parse(rawPaperPacks);

    return Array.isArray(paperPacks) ? paperPacks.filter(isPaperPack) : [];
  } catch (error) {
    return [];
  }
}

export function savePaperPack(paperPack) {
  const savedPaperPacks = loadSavedPaperPacks().filter(
    (savedPaperPack) => savedPaperPack.id !== paperPack.id
  );
  const nextPaperPacks = [paperPack, ...savedPaperPacks];

  window.localStorage.setItem(PAPER_PACKS_STORAGE_KEY, JSON.stringify(nextPaperPacks, null, 2));

  return nextPaperPacks;
}

export function mergePaperPacks(basePaperPacks, savedPaperPacks) {
  const savedPaperPackIds = new Set(savedPaperPacks.map((paperPack) => paperPack.id));

  return [
    ...savedPaperPacks,
    ...basePaperPacks.filter((paperPack) => !savedPaperPackIds.has(paperPack.id))
  ];
}

function isPaperPack(paperPack) {
  return (
    paperPack &&
    typeof paperPack.id === "string" &&
    typeof paperPack.name === "string" &&
    typeof paperPack.owner === "string" &&
    Number.isInteger(paperPack.releaseYear) &&
    Number.isInteger(paperPack.patternCount) &&
    Array.isArray(paperPack.colors) &&
    Array.isArray(paperPack.keywords) &&
    Array.isArray(paperPack.patterns)
  );
}
