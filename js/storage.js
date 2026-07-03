const PAPER_PACKS_STORAGE_KEY = "card-supply-catalog.paperPacks";
const DELETED_PAPER_PACK_IDS_STORAGE_KEY = "card-supply-catalog.deletedPaperPackIds";

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
  const deletedPaperPackIds = loadDeletedPaperPackIds().filter(
    (paperPackId) => paperPackId !== paperPack.id
  );
  const nextPaperPacks = [paperPack, ...savedPaperPacks];

  window.localStorage.setItem(PAPER_PACKS_STORAGE_KEY, JSON.stringify(nextPaperPacks, null, 2));
  window.localStorage.setItem(
    DELETED_PAPER_PACK_IDS_STORAGE_KEY,
    JSON.stringify(deletedPaperPackIds, null, 2)
  );

  return nextPaperPacks;
}

export function deletePaperPack(paperPackId) {
  const savedPaperPacks = loadSavedPaperPacks().filter((paperPack) => paperPack.id !== paperPackId);
  const deletedPaperPackIds = new Set(loadDeletedPaperPackIds());
  deletedPaperPackIds.add(paperPackId);

  window.localStorage.setItem(PAPER_PACKS_STORAGE_KEY, JSON.stringify(savedPaperPacks, null, 2));
  window.localStorage.setItem(
    DELETED_PAPER_PACK_IDS_STORAGE_KEY,
    JSON.stringify([...deletedPaperPackIds], null, 2)
  );
}

export function mergePaperPacks(basePaperPacks, savedPaperPacks) {
  const savedPaperPackIds = new Set(savedPaperPacks.map((paperPack) => paperPack.id));
  const deletedPaperPackIds = new Set(loadDeletedPaperPackIds());

  return [
    ...savedPaperPacks.filter((paperPack) => !deletedPaperPackIds.has(paperPack.id)),
    ...basePaperPacks.filter(
      (paperPack) => !savedPaperPackIds.has(paperPack.id) && !deletedPaperPackIds.has(paperPack.id)
    )
  ];
}

function loadDeletedPaperPackIds() {
  try {
    const rawPaperPackIds = window.localStorage.getItem(DELETED_PAPER_PACK_IDS_STORAGE_KEY);

    if (!rawPaperPackIds) {
      return [];
    }

    const paperPackIds = JSON.parse(rawPaperPackIds);

    return Array.isArray(paperPackIds)
      ? paperPackIds.filter((paperPackId) => typeof paperPackId === "string")
      : [];
  } catch (error) {
    return [];
  }
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
