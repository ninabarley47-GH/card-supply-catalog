import { loadCatalogSetting, saveColor, savePaperPack } from "./storage.js";

const BACKUP_SCHEMA_VERSION = 1;
const IMAGE_LIBRARY_SETTING_ID = "imageLibrary";

export function initializeCatalogBackup({ paperPacks, colorsById, onRestore }) {
  const exportButton = document.querySelector("[data-export-catalog]");
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
        renderBackupMessage(message, "Catalog backup downloaded.", "success");
      } catch (error) {
        renderBackupMessage(message, "The catalog backup could not be created.", "error");
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
        const restoreSummary = await restoreCatalogBackup({
          backup,
          paperPacks,
          colorsById
        });

        renderRestoreSummary(message, restoreSummary);
        onRestore?.();
      } catch (error) {
        renderRestoreSummary(message, {
          packsImported: 0,
          colorsImported: 0,
          imagesImported: 0,
          warnings: [],
          errors: ["The backup file could not be imported."]
        });
      } finally {
        importInput.value = "";
      }
    });
  }
}

async function createCatalogBackup({ paperPacks, colorsById }) {
  const imageLibrary = await loadCatalogSetting(IMAGE_LIBRARY_SETTING_ID);

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    app: "card-supply-catalog",
    exportedAt: new Date().toISOString(),
    imageStorage: {
      strategy: "embedded-indexed-db",
      configuredLibrary: createSerializableImageLibrarySetting(imageLibrary),
      note: "Prototype backup includes embedded image data when present. Future backups should support local image folder references."
    },
    colors: sortObjectByKey(colorsById),
    paperPacks: paperPacks.map(createSerializablePaperPack)
  };
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

function downloadJsonBackup(backup) {
  const backupJson = JSON.stringify(backup, null, 2);
  const blob = new Blob([backupJson], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `card-supply-catalog-backup-${formatDateStamp(new Date())}.json`;
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
    warnings: [],
    errors: []
  };

  const validation = validateBackup(backup);

  if (!validation.ok) {
    summary.errors.push(validation.message);
    return summary;
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
      await savePaperPack(paperPack);
      upsertPaperPack(paperPacks, paperPack);
      summary.packsImported += 1;
      summary.imagesImported += countEmbeddedPatternImages(paperPack);
    } catch (error) {
      summary.errors.push(`Paper pack could not be imported: ${paperPack?.name || paperPack?.id || "Unknown pack"}`);
    }
  }

  if (backup.imageStorage?.configuredLibrary) {
    summary.warnings.push("Image library folder permission is not restored by backup import. Choose the folder again if needed.");
  }

  if (summary.errors.length === 0 && summary.warnings.length === 0) {
    summary.warnings.push("Import completed. Re-export and compare with the original backup as the verification checklist describes.");
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

function sortObjectByKey(valueByKey) {
  return Object.fromEntries(
    Object.entries(valueByKey)
      .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
      .map(([key, value]) => [key, cloneJsonSafe(value)])
  );
}

function createSerializablePaperPack(paperPack) {
  return {
    ...cloneJsonSafe(paperPack),
    patterns: (paperPack.patterns || []).map(createSerializablePattern)
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
    createSummaryItem("Images imported", summary.imagesImported)
  );

  const warnings = createSummaryList("Warnings", summary.warnings);
  const errors = createSummaryList("Errors", summary.errors);

  message.replaceChildren(title, counts, warnings, errors);
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
