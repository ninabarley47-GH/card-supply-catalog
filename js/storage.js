const DATABASE_NAME = "card-supply-catalog";
const DATABASE_VERSION = 3;
const CATALOG_SCHEMA_VERSION = 1;
const PAPER_PACKS_STORE = "paperPacks";
const DELETED_PAPER_PACK_IDS_STORE = "deletedPaperPackIds";
const COLORS_STORE = "colors";
const SETTINGS_STORE = "settings";
const LEGACY_PAPER_PACKS_STORAGE_KEY = "card-supply-catalog.paperPacks";
const LEGACY_DELETED_PAPER_PACK_IDS_STORAGE_KEY = "card-supply-catalog.deletedPaperPackIds";
const LEGACY_MIGRATION_STORAGE_KEY = "card-supply-catalog.indexedDbMigrationComplete";
const KEYWORD_REPLACEMENTS = new Map([
  ["background", ""],
  ["mammals", "Land Animals"],
  ["ocean", "Water"],
  ["winged creatures", "Flying Animals"]
]);

let databasePromise;
let legacyMigrationAttempted = false;

export async function loadSavedPaperPacks() {
  const database = await openCatalogDatabase();
  await migrateLegacyLocalStorage(database);
  const paperPacks = await getAllFromStore(database, PAPER_PACKS_STORE);

  return paperPacks.filter(isPaperPack).map(normalizePaperPackKeywords);
}

export async function savePaperPack(paperPack) {
  const database = await openCatalogDatabase();
  await migrateLegacyLocalStorage(database);

  await writeTransaction(database, [PAPER_PACKS_STORE, DELETED_PAPER_PACK_IDS_STORE], (transaction) => {
    transaction.objectStore(PAPER_PACKS_STORE).put(normalizePaperPackForStorage(paperPack));
    transaction.objectStore(DELETED_PAPER_PACK_IDS_STORE).delete(paperPack.id);
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
  const normalizedSavedPaperPacks = savedPaperPacks.map(normalizePaperPackKeywords);
  const normalizedBasePaperPacks = basePaperPacks.map(normalizePaperPackKeywords);
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
    .filter(isPaperPack)
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
      paperPackStore.put(paperPack);
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
  return {
    ...normalizePaperPackKeywords(paperPack),
    schemaVersion: CATALOG_SCHEMA_VERSION
  };
}
function normalizePaperPackKeywords(paperPack) {
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

    writeCallback(transaction);
  });
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

function isColor(color) {
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
