import { loadCatalogSetting, saveCatalogSetting, saveColor, savePaperPack } from "./storage.js";
import { getPatternImageFile, getPatternImageSource } from "./images.js";
import {
  BACKUP_SCHEMA_VERSION,
  CATALOG_SCHEMA_VERSION,
  addCatalogSchemaVersion,
  getCatalogSchemaVersion
} from "./schema.js";

const IMAGE_LIBRARY_SETTING_ID = "imageLibrary";
const LAST_BACKUP_EXPORT_SETTING_ID = "lastBackupExportedAt";
const LAST_BACKUP_IMPORT_SETTING_ID = "lastBackupImportedAt";

export function initializeCatalogBackup({ paperPacks, colorsById, onRestore }) {
  const exportButton = document.querySelector("[data-export-catalog]");
  const exportIpadButton = document.querySelector("[data-export-ipad-catalog]");
  const importInput = document.querySelector("[data-import-catalog]");
  const message = document.querySelector("[data-backup-message]");

  if (exportButton) {
    exportButton.addEventListener("click", async () => {
      try {
        const backup = await createCatalogBackup({
          paperPacks,
          colorsById
        });

        downloadJsonBackup(backup);
        await saveCatalogSetting(LAST_BACKUP_EXPORT_SETTING_ID, backup.exportedAt);
        document.dispatchEvent(new CustomEvent("catalog:backup-exported"));
        renderBackupMessage(message, formatExportSummary(backup), "success");
      } catch (error) {
        renderBackupMessage(message, "The catalog backup could not be created.", "error");
      }
    });
  }

  if (exportIpadButton) {
    exportIpadButton.addEventListener("click", async () => {
      exportIpadButton.disabled = true;
      renderBackupMessage(message, "Creating iPad backup with compressed images...", "");

      try {
        const backup = await createIpadCatalogBackup({
          paperPacks,
          colorsById
        });

        downloadJsonBackup(backup, "ipad-backup");
        await saveCatalogSetting(LAST_BACKUP_EXPORT_SETTING_ID, backup.exportedAt);
        document.dispatchEvent(new CustomEvent("catalog:backup-exported"));
        renderBackupMessage(message, formatIpadExportSummary(backup), backup.imageStorage.missingImages > 0 ? "error" : "success");
      } catch (error) {
        renderBackupMessage(message, "The iPad backup could not be created.", "error");
      } finally {
        exportIpadButton.disabled = false;
      }
    });
  }

  if (importInput) {
    importInput.addEventListener("change", async () => {
      const [backupFile] = importInput.files || [];

      if (!backupFile) {
        return;
      }

      try {
        const backup = await readBackupFile(backupFile);
        const overwriteSummary = summarizeBackupOverwrites(backup, paperPacks, colorsById);

        if (overwriteSummary.requiresConfirmation && !window.confirm(overwriteSummary.message)) {
          renderBackupMessage(message, "Import cancelled. No catalog changes were made.", "");
          return;
        }

        const restoreSummary = await restoreCatalogBackup({
          backup,
          paperPacks,
          colorsById
        });

        renderRestoreSummary(message, restoreSummary);

        if (restoreSummary.errors.length === 0) {
          await saveCatalogSetting(LAST_BACKUP_IMPORT_SETTING_ID, new Date().toISOString());
          document.dispatchEvent(new CustomEvent("catalog:backup-imported"));
        }

        onRestore?.();
      } catch (error) {
        renderRestoreSummary(message, {
          packsImported: 0,
          colorsImported: 0,
          imagesImported: 0,
          folderImageReferencesImported: 0,
          notes: [],
          warnings: [],
          errors: ["The backup file could not be imported."]
        });
      } finally {
        importInput.value = "";
      }
    });
  }
}

function summarizeBackupOverwrites(backup, paperPacks, colorsById) {
  const importedPaperPacks = Array.isArray(backup?.paperPacks) ? backup.paperPacks : [];
  const importedColors = backup?.colors && typeof backup.colors === "object" ? Object.values(backup.colors) : [];
  const existingPackIds = new Set(paperPacks.map((paperPack) => paperPack.id));
  const existingColorIds = new Set(Object.keys(colorsById));
  const packOverwriteCount = importedPaperPacks.filter((paperPack) => existingPackIds.has(paperPack?.id)).length;
  const colorOverwriteCount = importedColors.filter((color) => existingColorIds.has(color?.id)).length;
  const overwriteParts = [];

  if (packOverwriteCount > 0) {
    overwriteParts.push(`${packOverwriteCount} paper pack${packOverwriteCount === 1 ? "" : "s"}`);
  }

  if (colorOverwriteCount > 0) {
    overwriteParts.push(`${colorOverwriteCount} color${colorOverwriteCount === 1 ? "" : "s"}`);
  }

  if (overwriteParts.length === 0) {
    return {
      requiresConfirmation: false,
      message: ""
    };
  }

  return {
    requiresConfirmation: true,
    message: `This backup will overwrite ${overwriteParts.join(" and ")} already in the catalog. Continue with import?`
  };
}
async function createCatalogBackup({ paperPacks, colorsById }) {
  const imageLibrary = await loadCatalogSetting(IMAGE_LIBRARY_SETTING_ID);
  const imageSummary = summarizeImageStorage(paperPacks);

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    catalogSchemaVersion: CATALOG_SCHEMA_VERSION,
    app: "card-supply-catalog",
    exportedAt: new Date().toISOString(),
    imageStorage: {
      strategy: imageSummary.folderImageReferences > 0 ? "local-folder-with-fallback" : "embedded-indexed-db",
      configuredLibrary: createSerializableImageLibrarySetting(imageLibrary),
      embeddedImages: imageSummary.embeddedImages,
      folderImageReferences: imageSummary.folderImageReferences,
      note:
        "Backup stores folder-backed images as relative imagePath references. Back up or share the image folder separately, then reconnect it after import."
    },
    colors: sortObjectByKey(colorsById),
    paperPacks: paperPacks.map(createSerializablePaperPack)
  };
}

async function createIpadCatalogBackup({ paperPacks, colorsById }) {
  const compressedPaperPacks = [];
  const imageSummary = {
    embeddedImages: 0,
    compressedImages: 0,
    missingImages: 0,
    folderImageReferences: 0
  };

  for (const paperPack of paperPacks) {
    const result = await createSerializablePaperPackWithCompressedImages(paperPack);

    compressedPaperPacks.push(result.paperPack);
    imageSummary.embeddedImages += result.embeddedImages;
    imageSummary.compressedImages += result.compressedImages;
    imageSummary.missingImages += result.missingImages;
    imageSummary.folderImageReferences += result.folderImageReferences;
  }

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    catalogSchemaVersion: CATALOG_SCHEMA_VERSION,
    app: "card-supply-catalog",
    backupProfile: "ipad-embedded-images",
    exportedAt: new Date().toISOString(),
    imageStorage: {
      strategy: "embedded-compressed-images",
      embeddedImages: imageSummary.embeddedImages,
      compressedImages: imageSummary.compressedImages,
      missingImages: imageSummary.missingImages,
      folderImageReferences: imageSummary.folderImageReferences,
      compression: {
        format: "image/jpeg",
        maxDimension: 900,
        quality: 0.72
      },
      note:
        "This iPad backup embeds compressed images directly in the JSON file so folder access is not required after import."
    },
    colors: sortObjectByKey(colorsById),
    paperPacks: compressedPaperPacks
  };
}

function summarizeImageStorage(paperPacks) {
  return paperPacks.reduce(
    (summary, paperPack) => {
      summary.embeddedImages += countEmbeddedPatternImages(paperPack);
      summary.folderImageReferences += countFolderImageReferences(paperPack);
      return summary;
    },
    {
      embeddedImages: 0,
      folderImageReferences: 0
    }
  );
}

function formatExportSummary(backup) {
  const folderImageReferences = backup.imageStorage?.folderImageReferences || 0;

  if (folderImageReferences === 0) {
    return "Catalog backup downloaded.";
  }

  return `Catalog backup downloaded. ${folderImageReferences} folder image reference${folderImageReferences === 1 ? "" : "s"} included; back up or share the image folder separately.`;
}

function formatIpadExportSummary(backup) {
  const compressedImages = backup.imageStorage?.compressedImages || 0;
  const missingImages = backup.imageStorage?.missingImages || 0;

  if (missingImages > 0) {
    return `iPad backup downloaded with ${compressedImages} embedded image${compressedImages === 1 ? "" : "s"}. ${missingImages} image${missingImages === 1 ? "" : "s"} could not be embedded.`;
  }

  return `iPad backup downloaded with ${compressedImages} embedded image${compressedImages === 1 ? "" : "s"}.`;
}

function createSerializableImageLibrarySetting(imageLibrary) {
  if (!imageLibrary) {
    return null;
  }

  return {
    strategy: imageLibrary.strategy || "local-folder",
    folderName: imageLibrary.directoryHandle?.name || "",
    selectedAt: imageLibrary.selectedAt || ""
  };
}

function downloadJsonBackup(backup, label = "backup") {
  const backupJson = JSON.stringify(backup, null, 2);
  const blob = new Blob([backupJson], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `card-supply-catalog-${label}-${formatDateStamp(new Date())}.json`;
  link.click();

  URL.revokeObjectURL(url);
}

async function readBackupFile(backupFile) {
  return JSON.parse(await backupFile.text());
}

async function restoreCatalogBackup({ backup, paperPacks, colorsById }) {
  const summary = {
    packsImported: 0,
    colorsImported: 0,
    imagesImported: 0,
    folderImageReferencesImported: 0,
    notes: [],
    warnings: [],
    errors: []
  };

  const validation = validateBackup(backup);

  if (!validation.ok) {
    summary.errors.push(validation.message);
    return summary;
  }

  if (backup.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    summary.warnings.push(
      `Imported backup schema version ${backup.schemaVersion || "unknown"}; current schema version is ${BACKUP_SCHEMA_VERSION}.`
    );
  }

  const catalogSchemaVersion = getCatalogSchemaVersion(backup);

  if (catalogSchemaVersion !== CATALOG_SCHEMA_VERSION) {
    summary.warnings.push(
      `Imported catalog schema version ${catalogSchemaVersion || "unknown"}; current catalog schema version is ${CATALOG_SCHEMA_VERSION}.`
    );
  }

  const importedColorsById = backup.colors || {};
  const importedPaperPacks = backup.paperPacks || [];

  for (const color of Object.values(importedColorsById)) {
    try {
      await saveColor(color);
      colorsById[color.id] = color;
      summary.colorsImported += 1;
    } catch (error) {
      summary.errors.push(`Color could not be imported: ${color?.name || color?.id || "Unknown color"}`);
    }
  }

  for (const paperPack of importedPaperPacks) {
    try {
      const versionedPaperPack = addCatalogSchemaVersion(paperPack);

      await savePaperPack(versionedPaperPack);
      upsertPaperPack(paperPacks, versionedPaperPack);
      summary.packsImported += 1;
      summary.imagesImported += countEmbeddedPatternImages(versionedPaperPack);
      summary.folderImageReferencesImported += countFolderImageReferences(versionedPaperPack);
    } catch (error) {
      summary.errors.push(`Paper pack could not be imported: ${paperPack?.name || paperPack?.id || "Unknown pack"}`);
    }
  }

  if (summary.folderImageReferencesImported > 0 || backup.imageStorage?.configuredLibrary) {
    summary.warnings.push(
      "Folder-backed image files are not inside the backup JSON. Choose or reconnect the image folder after import."
    );
  }

  if (summary.errors.length === 0 && summary.warnings.length === 0) {
    summary.notes.push("Import completed. Re-export and compare with the original backup as the verification checklist describes.");
  }

  return summary;
}

function validateBackup(backup) {
  if (!backup || backup.app !== "card-supply-catalog") {
    return {
      ok: false,
      message: "This does not look like a Card Supply Catalog backup."
    };
  }

  if (!backup.colors || typeof backup.colors !== "object" || !Array.isArray(backup.paperPacks)) {
    return {
      ok: false,
      message: "The backup is missing colors or paper packs."
    };
  }

  return {
    ok: true,
    message: ""
  };
}

function upsertPaperPack(paperPacks, paperPack) {
  const existingIndex = paperPacks.findIndex((existingPack) => existingPack.id === paperPack.id);

  if (existingIndex === -1) {
    paperPacks.unshift(paperPack);
    return;
  }

  paperPacks.splice(existingIndex, 1, paperPack);
}

function countEmbeddedPatternImages(paperPack) {
  return (paperPack.patterns || []).filter((pattern) => pattern && typeof pattern === "object" && pattern.imageSrc)
    .length;
}

function countFolderImageReferences(paperPack) {
  return (paperPack.patterns || []).filter((pattern) => pattern && typeof pattern === "object" && pattern.imagePath)
    .length;
}

function sortObjectByKey(valueByKey) {
  return Object.fromEntries(
    Object.entries(valueByKey)
      .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
      .map(([key, value]) => [key, cloneJsonSafe(value)])
  );
}

function createSerializablePaperPack(paperPack) {
  return addCatalogSchemaVersion({
    ...cloneJsonSafe(paperPack),
    patterns: (paperPack.patterns || []).map(createSerializablePattern)
  });
}

async function createSerializablePaperPackWithCompressedImages(paperPack) {
  const summary = {
    embeddedImages: 0,
    compressedImages: 0,
    missingImages: 0,
    folderImageReferences: 0
  };
  const patterns = [];

  for (const patternEntry of paperPack.patterns || []) {
    const pattern = await createCompressedSerializablePattern(patternEntry);

    if (pattern && typeof pattern === "object" && pattern.imageSrc) {
      summary.embeddedImages += 1;
      summary.compressedImages += pattern.imageStorageStrategy === "embedded-compressed-image" ? 1 : 0;
    }

    if (pattern && typeof pattern === "object" && pattern.imagePath) {
      summary.folderImageReferences += 1;
      summary.missingImages += 1;
    }

    patterns.push(pattern);
  }

  return {
    paperPack: addCatalogSchemaVersion({
      ...cloneJsonSafe(paperPack),
      imageStorageStrategy: "embedded-compressed-images",
      patterns
    }),
    ...summary
  };
}

async function createCompressedSerializablePattern(patternEntry) {
  const patternObject = patternEntry && typeof patternEntry === "object" ? patternEntry : null;

  if (!patternObject) {
    return patternEntry;
  }

  const basePattern = {
    id: patternObject.id,
    imageName: patternObject.imageName
  };
  let compressedImageSrc = "";

  try {
    compressedImageSrc = await getCompressedPatternImageSource(patternEntry);
  } catch (error) {
    compressedImageSrc = "";
  }

  if (!compressedImageSrc) {
    return createSerializablePattern(patternEntry);
  }

  return {
    ...basePattern,
    imageSrc: compressedImageSrc,
    imageStorageStrategy: "embedded-compressed-image"
  };
}

async function getCompressedPatternImageSource(patternEntry) {
  const existingImageSrc = getPatternImageSource(patternEntry);

  if (existingImageSrc) {
    return await compressImageSource(existingImageSrc);
  }

  const imageFile = await getPatternImageFile(patternEntry);

  if (!imageFile) {
    return "";
  }

  const imageUrl = URL.createObjectURL(imageFile);

  try {
    return await compressImageSource(imageUrl);
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function compressImageSource(imageSrc) {
  const image = await loadImageElement(imageSrc);
  const { width, height } = getScaledImageSize(image.naturalWidth || image.width, image.naturalHeight || image.height, 900);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context || width === 0 || height === 0) {
    return "";
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", 0.72);
}

function loadImageElement(imageSrc) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("Image could not be loaded.")));
    image.src = imageSrc;
  });
}

function getScaledImageSize(width, height, maxDimension) {
  if (!width || !height) {
    return {
      width: 0,
      height: 0
    };
  }

  const scale = Math.min(1, maxDimension / Math.max(width, height));

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function createSerializablePattern(patternEntry) {
  const patternObject = patternEntry && typeof patternEntry === "object" ? patternEntry : null;

  if (!patternObject) {
    return patternEntry;
  }

  const { __imageFile, imagePreviewSrc, ...serializablePattern } = patternObject;

  return cloneJsonSafe(serializablePattern);
}

function cloneJsonSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function formatDateStamp(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function renderBackupMessage(message, text, tone) {
  if (!message) {
    return;
  }

  message.textContent = text;
  message.dataset.tone = tone;
}

function renderRestoreSummary(message, summary) {
  if (!message) {
    return;
  }

  const title = document.createElement("strong");
  title.textContent = summary.errors.length > 0 ? "Restore completed with errors" : "Restore summary";

  const counts = document.createElement("ul");
  counts.className = "restore-summary-list";

  counts.append(
    createSummaryItem("Packs imported", summary.packsImported),
    createSummaryItem("Colors imported", summary.colorsImported),
    createSummaryItem("Embedded images imported", summary.imagesImported),
    createSummaryItem("Folder image references imported", summary.folderImageReferencesImported || 0)
  );

  const warnings = createSummaryList("Warnings", summary.warnings);
  const notes = createSummaryList("Notes", summary.notes || []);
  const errors = createSummaryList("Errors", summary.errors);

  message.replaceChildren(title, counts, notes, warnings, errors);
  message.dataset.tone = summary.errors.length > 0 ? "error" : "success";
}

function createSummaryItem(label, value) {
  const item = document.createElement("li");
  item.textContent = value === "" ? label : `${label}: ${value}`;

  return item;
}

function createSummaryList(label, items) {
  const wrapper = document.createElement("div");
  const heading = document.createElement("span");
  const list = document.createElement("ul");

  heading.textContent = `${label}:`;
  list.className = "restore-summary-list";

  if (items.length === 0) {
    list.append(createSummaryItem("None", ""));
  } else {
    list.append(...items.map((item) => createSummaryItem(item, "")));
  }

  wrapper.append(heading, list);

  return wrapper;
}
