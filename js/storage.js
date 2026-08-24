import { addCatalogSchemaVersion } from "./schema.js";
import { uniqueTags } from "./tag-utils.js";
import { buildOwnerRegistry, isOwner, migratePaperPackOwners, serializePaperPackOwner } from "./owners.js";

const DATABASE_NAME = "card-supply-catalog";
const DATABASE_VERSION = 5;
const PAPER_PACKS_STORE = "paperPacks";
const DELETED_PAPER_PACK_IDS_STORE = "deletedPaperPackIds";
const COLORS_STORE = "colors";
const SETTINGS_STORE = "settings";
const CARDS_STORE = "cards";
const OWNERS_STORE = "owners";
export const PAPER_TAG_VOCABULARY_SETTING_ID = "paperTagVocabulary";
export const CARD_TAG_VOCABULARY_SETTING_ID = "cardTagVocabulary";
const LEGACY_PAPER_PACKS_STORAGE_KEY = "card-supply-catalog.paperPacks";
const LEGACY_DELETED_PAPER_PACK_IDS_STORAGE_KEY = "card-supply-catalog.deletedPaperPackIds";
const LEGACY_MIGRATION_STORAGE_KEY = "card-supply-catalog.indexedDbMigrationComplete";
const KEYWORD_REPLACEMENTS = new Map([
  ["background", ""],
  ["cartoon", "Illustration"],
  ["mammals", "Land Animals"],
  ["ocean", "Water"],
  ["ocean animals", "Water Animals"],
  ["winged creatures", "Flying Animals"]
]);

let databasePromise;
let legacyMigrationAttempted = false;

export async function loadSavedPaperPacks() {
  const database = await openCatalogDatabase();
  await migrateLegacyLocalStorage(database);
  const paperPacks = await getAllFromStore(database, PAPER_PACKS_STORE);

  return paperPacks.filter(isCompatiblePaperPack).map(normalizePaperPackForRuntime);
}

export async function loadOwners() {
  const database = await openCatalogDatabase();
  return (await getAllFromStore(database, OWNERS_STORE)).filter(isOwner);
}

export async function saveOwner(owner) {
  if (!isOwner(owner)) throw new Error("Invalid owner record.");
  const database = await openCatalogDatabase();
  await writeTransaction(database, [OWNERS_STORE], (transaction) => transaction.objectStore(OWNERS_STORE).put(owner));
}

export async function migrateCatalogOwnership(basePaperPacks = [], savedPaperPacks = [], seedOwners = []) {
  const database = await openCatalogDatabase();
  const existingOwners = (await getAllFromStore(database, OWNERS_STORE)).filter(isOwner);
  const owners = buildOwnerRegistry([...seedOwners, ...existingOwners], [...basePaperPacks, ...savedPaperPacks]);
  const migratedBasePacks = migratePaperPackOwners(basePaperPacks, owners);
  const migratedSavedPacks = migratePaperPackOwners(savedPaperPacks, owners);

  await writeTransaction(database, [OWNERS_STORE, PAPER_PACKS_STORE], (transaction) => {
    const ownerStore = transaction.objectStore(OWNERS_STORE);
    const paperPackStore = transaction.objectStore(PAPER_PACKS_STORE);
    owners.forEach((owner) => ownerStore.put(owner));
    migratedSavedPacks.forEach((paperPack) => paperPackStore.put(normalizePaperPackForStorage(paperPack)));
  });

  return { owners, basePaperPacks: migratedBasePacks, savedPaperPacks: migratedSavedPacks };
}

export async function loadSavedPaperPack(paperPackId) {
  const database = await openCatalogDatabase();
  await migrateLegacyLocalStorage(database);
  const paperPack = await getFromStore(database, PAPER_PACKS_STORE, paperPackId);

  return isCompatiblePaperPack(paperPack) ? normalizePaperPackForRuntime(paperPack) : null;
}

export async function savePaperPack(paperPack) {
  const database = await openCatalogDatabase();
  await migrateLegacyLocalStorage(database);

  await writeTransaction(database, [PAPER_PACKS_STORE, DELETED_PAPER_PACK_IDS_STORE], (transaction) => {
    transaction.objectStore(PAPER_PACKS_STORE).put(normalizePaperPackForStorage(paperPack));
    transaction.objectStore(DELETED_PAPER_PACK_IDS_STORE).delete(paperPack.id);
  });
}

export async function savePaperPacks(paperPacks) {
  const database = await openCatalogDatabase();
  await migrateLegacyLocalStorage(database);

  await writeTransaction(database, [PAPER_PACKS_STORE, DELETED_PAPER_PACK_IDS_STORE], (transaction) => {
    const paperPackStore = transaction.objectStore(PAPER_PACKS_STORE);
    const deletedPaperPackIdStore = transaction.objectStore(DELETED_PAPER_PACK_IDS_STORE);

    for (const paperPack of paperPacks) {
      paperPackStore.put(normalizePaperPackForStorage(paperPack));
      deletedPaperPackIdStore.delete(paperPack.id);
    }
  });
}

export async function loadSavedColors() {
  const database = await openCatalogDatabase();
  await migrateLegacyLocalStorage(database);
  const colors = await getAllFromStore(database, COLORS_STORE);

  return colors.filter(isColor);
}

export async function saveColor(color) {
  const database = await openCatalogDatabase();
  await migrateLegacyLocalStorage(database);

  await writeTransaction(database, [COLORS_STORE], (transaction) => {
    transaction.objectStore(COLORS_STORE).put(color);
  });
}

export async function loadSavedCards() {
  const database = await openCatalogDatabase();
  await migrateLegacyLocalStorage(database);
  const cards = await getAllFromStore(database, CARDS_STORE);

  return cards.filter(isCard).map(normalizeCardForRuntime);
}

export async function saveCard(card) {
  const database = await openCatalogDatabase();
  await migrateLegacyLocalStorage(database);

  await writeTransaction(database, [CARDS_STORE], (transaction) => {
    transaction.objectStore(CARDS_STORE).put(addCatalogSchemaVersion(normalizeCardForRuntime(card)));
  });
}

export async function deleteTagEverywhere({ kind, records = [], vocabulary = [] }) {
  const database = await openCatalogDatabase();
  await migrateLegacyLocalStorage(database);

  if (kind === "paper") {
    await writeTransaction(database, [PAPER_PACKS_STORE, DELETED_PAPER_PACK_IDS_STORE, SETTINGS_STORE], (transaction) => {
      const paperPackStore = transaction.objectStore(PAPER_PACKS_STORE);
      const deletedPaperPackIdStore = transaction.objectStore(DELETED_PAPER_PACK_IDS_STORE);

      for (const paperPack of records) {
        paperPackStore.put(normalizePaperPackForStorage(paperPack));
        deletedPaperPackIdStore.delete(paperPack.id);
      }

      transaction.objectStore(SETTINGS_STORE).put({
        id: PAPER_TAG_VOCABULARY_SETTING_ID,
        value: uniqueTags(vocabulary)
      });
    });
    return;
  }

  if (kind === "card") {
    await writeTransaction(database, [CARDS_STORE, SETTINGS_STORE], (transaction) => {
      const cardStore = transaction.objectStore(CARDS_STORE);

      for (const card of records) {
        cardStore.put(addCatalogSchemaVersion(normalizeCardForRuntime(card)));
      }

      transaction.objectStore(SETTINGS_STORE).put({
        id: CARD_TAG_VOCABULARY_SETTING_ID,
        value: uniqueTags(vocabulary)
      });
    });
    return;
  }

  throw new Error(`Unsupported tag vocabulary kind: ${kind}`);
}

export async function restoreCatalogRecords({ paperPacks = [], colors = [], cards = [], owners = [], tagVocabularies = null }) {
  const database = await openCatalogDatabase();
  await migrateLegacyLocalStorage(database);

  await writeTransaction(
    database,
    [PAPER_PACKS_STORE, DELETED_PAPER_PACK_IDS_STORE, COLORS_STORE, CARDS_STORE, OWNERS_STORE, SETTINGS_STORE],
    (transaction) => {
      const paperPackStore = transaction.objectStore(PAPER_PACKS_STORE);
      const deletedPaperPackIdStore = transaction.objectStore(DELETED_PAPER_PACK_IDS_STORE);
      const colorStore = transaction.objectStore(COLORS_STORE);
      const cardStore = transaction.objectStore(CARDS_STORE);
      const settingsStore = transaction.objectStore(SETTINGS_STORE);
      const ownerStore = transaction.objectStore(OWNERS_STORE);

      owners.forEach((owner) => ownerStore.put(owner));

      for (const paperPack of paperPacks) {
        paperPackStore.put(normalizePaperPackForStorage(paperPack));
        deletedPaperPackIdStore.delete(paperPack.id);
      }

      for (const color of colors) {
        colorStore.put(color);
      }

      for (const card of cards) {
        cardStore.put(addCatalogSchemaVersion(normalizeCardForRuntime(card)));
      }

      if (tagVocabularies) {
        settingsStore.put({ id: PAPER_TAG_VOCABULARY_SETTING_ID, value: tagVocabularies.paper || [] });
        settingsStore.put({ id: CARD_TAG_VOCABULARY_SETTING_ID, value: tagVocabularies.card || [] });
      }
    }
  );
}

export async function deleteCard(cardId) {
  const database = await openCatalogDatabase();
  await migrateLegacyLocalStorage(database);

  await writeTransaction(database, [CARDS_STORE], (transaction) => {
    transaction.objectStore(CARDS_STORE).delete(cardId);
  });
}

export function mergeColors(baseColorsById, savedColors) {
  return {
    ...baseColorsById,
    ...Object.fromEntries(savedColors.filter(isColor).map((color) => [color.id, color]))
  };
}

export async function loadCatalogSetting(settingId) {
  const database = await openCatalogDatabase();
  await migrateLegacyLocalStorage(database);
  const setting = await getFromStore(database, SETTINGS_STORE, settingId);

  return setting?.value ?? null;
}

export async function saveCatalogSetting(settingId, value) {
  const database = await openCatalogDatabase();
  await migrateLegacyLocalStorage(database);

  await writeTransaction(database, [SETTINGS_STORE], (transaction) => {
    transaction.objectStore(SETTINGS_STORE).put({
      id: settingId,
      value
    });
  });
}

export async function deletePaperPack(paperPackId) {
  const database = await openCatalogDatabase();
  await migrateLegacyLocalStorage(database);

  await writeTransaction(database, [PAPER_PACKS_STORE, DELETED_PAPER_PACK_IDS_STORE], (transaction) => {
    transaction.objectStore(PAPER_PACKS_STORE).delete(paperPackId);
    transaction.objectStore(DELETED_PAPER_PACK_IDS_STORE).put({ id: paperPackId });
  });
}

export async function mergePaperPacks(basePaperPacks, savedPaperPacks) {
  const database = await openCatalogDatabase();
  await migrateLegacyLocalStorage(database);
  const normalizedSavedPaperPacks = savedPaperPacks.map(normalizePaperPackForRuntime);
  const normalizedBasePaperPacks = basePaperPacks.map(normalizePaperPackForRuntime);
  const savedPaperPackIds = new Set(normalizedSavedPaperPacks.map((paperPack) => paperPack.id));
  const deletedPaperPackIds = new Set(
    (await getAllFromStore(database, DELETED_PAPER_PACK_IDS_STORE)).map((entry) => entry.id)
  );

  return [
    ...normalizedSavedPaperPacks.filter((paperPack) => !deletedPaperPackIds.has(paperPack.id)),
    ...normalizedBasePaperPacks.filter(
      (paperPack) => !savedPaperPackIds.has(paperPack.id) && !deletedPaperPackIds.has(paperPack.id)
    )
  ];
}

function openCatalogDatabase() {
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(PAPER_PACKS_STORE)) {
        database.createObjectStore(PAPER_PACKS_STORE, { keyPath: "id" });
      }

      if (!database.objectStoreNames.contains(DELETED_PAPER_PACK_IDS_STORE)) {
        database.createObjectStore(DELETED_PAPER_PACK_IDS_STORE, { keyPath: "id" });
      }

      if (!database.objectStoreNames.contains(COLORS_STORE)) {
        database.createObjectStore(COLORS_STORE, { keyPath: "id" });
      }

      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE, { keyPath: "id" });
      }

      if (!database.objectStoreNames.contains(CARDS_STORE)) {
        database.createObjectStore(CARDS_STORE, { keyPath: "id" });
      }

      if (!database.objectStoreNames.contains(OWNERS_STORE)) {
        database.createObjectStore(OWNERS_STORE, { keyPath: "id" });
      }
    });

    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });

  return databasePromise;
}

async function migrateLegacyLocalStorage(database) {
  if (legacyMigrationAttempted) {
    return;
  }

  if (isLegacyMigrationComplete()) {
    legacyMigrationAttempted = true;
    return;
  }

  const legacyPaperPacks = readLegacyJsonArray(LEGACY_PAPER_PACKS_STORAGE_KEY)
    .filter(isCompatiblePaperPack)
    .map(normalizePaperPackKeywords);
  const legacyDeletedPaperPackIds = readLegacyJsonArray(LEGACY_DELETED_PAPER_PACK_IDS_STORAGE_KEY).filter(
    (paperPackId) => typeof paperPackId === "string"
  );

  if (legacyPaperPacks.length === 0 && legacyDeletedPaperPackIds.length === 0) {
    markLegacyMigrationComplete();
    legacyMigrationAttempted = true;
    return;
  }

  await writeTransaction(database, [PAPER_PACKS_STORE, DELETED_PAPER_PACK_IDS_STORE], (transaction) => {
    const paperPackStore = transaction.objectStore(PAPER_PACKS_STORE);
    const deletedPaperPackIdStore = transaction.objectStore(DELETED_PAPER_PACK_IDS_STORE);

    for (const paperPack of legacyPaperPacks) {
      paperPackStore.put(normalizePaperPackForStorage(paperPack));
    }

    for (const paperPackId of legacyDeletedPaperPackIds) {
      deletedPaperPackIdStore.put({ id: paperPackId });
    }
  });

  markLegacyMigrationComplete();
  legacyMigrationAttempted = true;
}

function isLegacyMigrationComplete() {
  try {
    return window.localStorage.getItem(LEGACY_MIGRATION_STORAGE_KEY) === "true";
  } catch (error) {
    return false;
  }
}

function readLegacyJsonArray(storageKey) {
  try {
    const rawValue = window.localStorage.getItem(storageKey);

    if (!rawValue) {
      return [];
    }

    const value = JSON.parse(rawValue);

    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

function markLegacyMigrationComplete() {
  try {
    window.localStorage.setItem(LEGACY_MIGRATION_STORAGE_KEY, "true");
  } catch (error) {
    // If legacy storage is full, it is still safe to continue using IndexedDB.
  }
}

function normalizePaperPackForStorage(paperPack) {
  return addCatalogSchemaVersion(serializePaperPackOwner(normalizePaperPackForRuntime(paperPack)));
}

function normalizePaperPackForRuntime(paperPack) {
  const normalizedPaperPack = normalizePaperPackKeywords(paperPack);

  return {
    ...normalizedPaperPack,
    patterns: (normalizedPaperPack.patterns || []).map(removeTransientPatternImageFields)
  };
}

function removeTransientPatternImageFields(patternEntry) {
  if (!patternEntry || typeof patternEntry !== "object") {
    return patternEntry;
  }

  const { __imageFile, imagePreviewSrc, ...persistentPattern } = patternEntry;

  if (typeof persistentPattern.imageSrc === "string" && persistentPattern.imageSrc.startsWith("blob:")) {
    delete persistentPattern.imageSrc;
  }

  return persistentPattern;
}

export function normalizePaperPackKeywords(paperPack) {
  const keywords = [];
  const seenKeywords = new Set();

  for (const keyword of paperPack.keywords || []) {
    const normalizedKeyword = normalizeKeyword(keyword);

    if (!normalizedKeyword || seenKeywords.has(normalizedKeyword)) {
      continue;
    }

    seenKeywords.add(normalizedKeyword);
    keywords.push(normalizedKeyword);
  }

  return {
    ...paperPack,
    keywords
  };
}

function normalizeKeyword(keyword) {
  const keywordName = String(keyword || "").trim();
  const replacement = KEYWORD_REPLACEMENTS.get(keywordName.toLowerCase());

  return replacement === undefined ? keywordName : replacement;
}

function getAllFromStore(database, storeName) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();

    request.addEventListener("success", () => resolve(request.result || []));
    request.addEventListener("error", () => reject(request.error));
    transaction.addEventListener("error", () => reject(transaction.error));
  });
}

function getFromStore(database, storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(key);

    request.addEventListener("success", () => resolve(request.result || null));
    request.addEventListener("error", () => reject(request.error));
    transaction.addEventListener("error", () => reject(transaction.error));
  });
}

function writeTransaction(database, storeNames, writeCallback) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeNames, "readwrite");

    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error));
    transaction.addEventListener("abort", () => reject(transaction.error));

    try {
      writeCallback(transaction);
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

export function loadPaperTagVocabulary() {
  return loadCatalogSetting(PAPER_TAG_VOCABULARY_SETTING_ID).then((value) => value === null ? null : uniqueTags(value));
}

export function savePaperTagVocabulary(tags) {
  return saveCatalogSetting(PAPER_TAG_VOCABULARY_SETTING_ID, uniqueTags(tags));
}

export function loadCardTagVocabulary() {
  return loadCatalogSetting(CARD_TAG_VOCABULARY_SETTING_ID).then((value) => uniqueTags(value));
}

export function saveCardTagVocabulary(tags) {
  return saveCatalogSetting(CARD_TAG_VOCABULARY_SETTING_ID, uniqueTags(tags));
}

export function isPaperPack(paperPack) {
  return (
    paperPack &&
    typeof paperPack.id === "string" &&
    typeof paperPack.name === "string" &&
    typeof paperPack.ownerId === "string" &&
    Number.isInteger(paperPack.releaseYear) &&
    Number.isInteger(paperPack.patternCount) &&
    Array.isArray(paperPack.colors) &&
    Array.isArray(paperPack.keywords) &&
    Array.isArray(paperPack.patterns)
  );
}

export function isColor(color) {
  return (
    color &&
    typeof color.id === "string" &&
    typeof color.name === "string" &&
    typeof color.hex === "string" &&
    Array.isArray(color.rgb) &&
    typeof color.family === "string" &&
    typeof color.colorFamily === "string" &&
    typeof color.status === "string" &&
    Array.isArray(color.aliases) &&
    color.products &&
    typeof color.products === "object"
  );
}

export function isCompatiblePaperPack(paperPack) {
  return isPaperPack(paperPack) || (
    paperPack && typeof paperPack.id === "string" && typeof paperPack.name === "string" &&
    typeof paperPack.owner === "string" && Number.isInteger(paperPack.releaseYear) &&
    Number.isInteger(paperPack.patternCount) && Array.isArray(paperPack.colors) &&
    Array.isArray(paperPack.keywords) && Array.isArray(paperPack.patterns)
  );
}

function normalizeCardForRuntime(card) {
  const { selectedImage, imagePreviewSrc, imageThumbnailSrc, ...persistentCard } = card;
  const { stampSet: legacyStampSet, ...cardWithoutLegacyStampSet } = persistentCard;
  const tags = [];
  const seenTags = new Set();
  const stampSets = [];
  const seenStampSets = new Set();

  for (const tag of persistentCard.tags || []) {
    const normalizedTag = String(tag || "").trim().replace(/\s+/g, " ");
    const tagKey = normalizedTag.toLocaleLowerCase();

    if (normalizedTag && !seenTags.has(tagKey)) {
      tags.push(normalizedTag);
      seenTags.add(tagKey);
    }
  }

  const stampSetCandidates = [
    ...(Array.isArray(persistentCard.stampSets) ? persistentCard.stampSets : []),
    legacyStampSet
  ];

  for (const stampSet of stampSetCandidates) {
    const normalizedStampSet = String(stampSet || "").trim().replace(/\s+/g, " ");
    const stampSetKey = normalizedStampSet.toLocaleLowerCase();

    if (normalizedStampSet && !seenStampSets.has(stampSetKey)) {
      stampSets.push(normalizedStampSet);
      seenStampSets.add(stampSetKey);
    }
  }

  return {
    ...cardWithoutLegacyStampSet,
    tags,
    stampSets
  };
}

export function isCard(card) {
  return (
    card &&
    typeof card.id === "string" &&
    (card.ownerId === undefined || typeof card.ownerId === "string") &&
    typeof card.dateCreated === "string" &&
    card.size &&
    Number.isFinite(card.size.width) &&
    Number.isFinite(card.size.height) &&
    Array.isArray(card.tags) &&
    Array.isArray(card.paperPackIds) &&
    Array.isArray(card.colorIds) &&
    typeof card.favorite === "boolean"
  );
}
