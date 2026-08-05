import {
  loadCatalogSetting,
  loadSavedPaperPack,
  saveCatalogSetting,
  saveColor,
  savePaperPack
} from "./storage.js";
import { clearPaperPackImageObjectUrls, getPatternImageFile, getPatternImageSource } from "./images.js";
import {
  BACKUP_SCHEMA_VERSION,
  CATALOG_SCHEMA_VERSION,
  addCatalogSchemaVersion,
  getCatalogSchemaVersion
} from "./schema.js";

const IMAGE_LIBRARY_SETTING_ID = "imageLibrary";
const LAST_BACKUP_EXPORT_SETTING_ID = "lastBackupExportedAt";
const LAST_BACKUP_IMPORT_SETTING_ID = "lastBackupImportedAt";
const APP_VERSION = "2026.08.03-import-diagnostic";
const IMPORT_DIAGNOSTIC_QUERY_PARAMETER = "importDiagnostics";
const SUPPORTED_EMBEDDED_IMAGE_PREFIX_PATTERN = /^data:image\/(jpeg|png|webp|gif);base64,/i;

export function initializeCatalogBackup({ paperPacks, colorsById, onRestore }) {
  const exportButton = document.querySelector("[data-export-catalog]");
  const exportIpadButton = document.querySelector("[data-export-ipad-catalog]");
  const importInput = document.querySelector("[data-import-catalog]");
  const diagnosticImportInput = document.querySelector("[data-import-catalog-diagnostic]");
  const downloadDiagnosticButton = document.querySelector("[data-download-import-diagnostic]");
  const message = document.querySelector("[data-backup-message]");
  let latestDiagnosticReport = null;

  if (exportButton) {
    exportButton.addEventListener("click", async () => {
      try {
        const backupDirectory = await getWritableBackupDirectoryHandle();
        const backup = await createCatalogBackup({
          paperPacks,
          colorsById
        });

        const saveResult = await saveJsonBackup(backup, "backup", backupDirectory);
        await saveCatalogSetting(LAST_BACKUP_EXPORT_SETTING_ID, backup.exportedAt);
        document.dispatchEvent(new CustomEvent("catalog:backup-exported"));
        renderBackupMessage(message, formatExportSummary(backup, saveResult), "success");
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
        const backupDirectory = await getWritableBackupDirectoryHandle();
        const backup = await createIpadCatalogBackup({
          paperPacks,
          colorsById
        });

        const saveResult = await saveJsonBackup(backup, "ipad-backup", backupDirectory);
        await saveCatalogSetting(LAST_BACKUP_EXPORT_SETTING_ID, backup.exportedAt);
        document.dispatchEvent(new CustomEvent("catalog:backup-exported"));
        renderBackupMessage(message, formatIpadExportSummary(backup, saveResult), backup.imageStorage.missingImages > 0 ? "error" : "success");
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

        await onRestore?.();
        restoreSummary.postRestoreVerification = await verifyPostRestoreCatalog(backup.paperPacks, paperPacks);
        reportPostRestoreVerification(restoreSummary.postRestoreVerification);
        renderRestoreSummary(message, restoreSummary);

        if (restoreSummary.errors.length === 0) {
          await saveCatalogSetting(LAST_BACKUP_IMPORT_SETTING_ID, new Date().toISOString());
          document.dispatchEvent(new CustomEvent("catalog:backup-imported"));
        }

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

  if (diagnosticImportInput) {
    diagnosticImportInput.addEventListener("change", async () => {
      const [backupFile] = diagnosticImportInput.files || [];
      if (!backupFile) return;

      latestDiagnosticReport = null;
      if (downloadDiagnosticButton) downloadDiagnosticButton.disabled = true;
      renderBackupMessage(message, "Running import diagnostic. This may take several minutes...", "");

      try {
        const backup = await readBackupFile(backupFile);
        const overwriteSummary = summarizeBackupOverwrites(backup, paperPacks, colorsById);
        if (overwriteSummary.requiresConfirmation && !window.confirm(overwriteSummary.message)) {
          renderBackupMessage(message, "Import diagnostic cancelled. No catalog changes were made.", "");
          return;
        }

        const restoreSummary = await restoreCatalogBackup({
          backup,
          paperPacks,
          colorsById,
          diagnosticContext: {
            backupFileName: backupFile.name,
            backupFileSize: backupFile.size
          }
        });
        latestDiagnosticReport = restoreSummary.diagnosticReport;
        if (downloadDiagnosticButton) downloadDiagnosticButton.disabled = !latestDiagnosticReport;
        await onRestore?.();
        restoreSummary.postRestoreVerification = await verifyPostRestoreCatalog(backup.paperPacks, paperPacks);
        if (latestDiagnosticReport) {
          latestDiagnosticReport.postRestoreVerification = restoreSummary.postRestoreVerification;
        }
        reportPostRestoreVerification(restoreSummary.postRestoreVerification);
        renderBackupMessage(
          message,
          "Import diagnostic completed. Please download the report and send it to the app developer.",
          latestDiagnosticReport ? "success" : "error"
        );
      } catch (error) {
        latestDiagnosticReport = await createFailedDiagnosticReport(backupFile, error);
        if (downloadDiagnosticButton) downloadDiagnosticButton.disabled = false;
        renderBackupMessage(message, "Import diagnostic completed with an error. Please download the report and send it to the app developer.", "error");
      } finally {
        diagnosticImportInput.value = "";
      }
    });
  }

  downloadDiagnosticButton?.addEventListener("click", () => {
    if (latestDiagnosticReport) downloadImportDiagnosticReport(latestDiagnosticReport);
  });
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

function formatExportSummary(backup, saveResult) {
  const folderImageReferences = backup.imageStorage?.folderImageReferences || 0;
  const savedMessage = formatBackupSaveDestination(saveResult, "Catalog backup");

  if (folderImageReferences === 0) {
    return savedMessage;
  }

  return `${savedMessage} ${folderImageReferences} folder image reference${folderImageReferences === 1 ? "" : "s"} included; back up or share the image folder separately.`;
}

function formatIpadExportSummary(backup, saveResult) {
  const compressedImages = backup.imageStorage?.compressedImages || 0;
  const missingImages = backup.imageStorage?.missingImages || 0;
  const savedMessage = formatBackupSaveDestination(saveResult, "iPad backup");

  if (missingImages > 0) {
    return `${savedMessage} ${compressedImages} embedded image${compressedImages === 1 ? "" : "s"} included. ${missingImages} image${missingImages === 1 ? "" : "s"} could not be embedded.`;
  }

  return `${savedMessage} ${compressedImages} embedded image${compressedImages === 1 ? "" : "s"} included.`;
}

function formatBackupSaveDestination(saveResult, backupLabel) {
  return saveResult?.savedToFolder
    ? `${backupLabel} saved to ${saveResult.folderName}.`
    : `${backupLabel} downloaded.`;
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

async function saveJsonBackup(backup, label = "backup", directoryHandle = null) {
  const backupJson = JSON.stringify(backup, null, 2);
  const blob = new Blob([backupJson], { type: "application/json" });
  const fileName = `card-supply-catalog-${label}-${formatDateStamp(new Date())}.json`;

  if (directoryHandle) {
    try {
      const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      return {
        savedToFolder: true,
        folderName: directoryHandle.name || "the selected folder",
        fileName
      };
    } catch (error) {
      // Fall back to a browser download if the selected folder cannot be written.
    }
  }

  downloadJsonBackup(blob, fileName);
  return {
    savedToFolder: false,
    folderName: "",
    fileName
  };
}

function downloadJsonBackup(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();

  URL.revokeObjectURL(url);
}

async function getWritableBackupDirectoryHandle() {
  const imageLibrary = await loadCatalogSetting(IMAGE_LIBRARY_SETTING_ID);
  const directoryHandle = imageLibrary?.directoryHandle;

  if (!directoryHandle) {
    return null;
  }

  if (!directoryHandle.queryPermission) {
    return directoryHandle;
  }

  try {
    const permission = { mode: "readwrite" };

    if ((await directoryHandle.queryPermission(permission)) === "granted") {
      return directoryHandle;
    }

    if (directoryHandle.requestPermission && (await directoryHandle.requestPermission(permission)) === "granted") {
      return directoryHandle;
    }
  } catch (error) {
    // A download will be used when saved-folder permission is unavailable.
  }

  return null;
}

async function readBackupFile(backupFile) {
  return JSON.parse(await backupFile.text());
}

async function restoreCatalogBackup({ backup, paperPacks, colorsById, diagnosticContext = null }) {
  const summary = {
    packsImported: 0,
    colorsImported: 0,
    imagesImported: 0,
    folderImageReferencesImported: 0,
    notes: [],
    warnings: [],
    errors: []
  };
  const importedColorsById = backup?.colors || {};
  const importedPaperPacks = backup?.paperPacks || [];
  const importDiagnostic = await createImportDiagnostic(
    Array.isArray(importedPaperPacks) ? importedPaperPacks : [],
    diagnosticContext
  );

  const validation = validateBackup(backup);

  if (!validation.ok) {
    summary.errors.push(validation.message);
    summary.diagnosticReport = await reportImportDiagnostic(importDiagnostic);
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

  for (const color of Object.values(importedColorsById)) {
    try {
      await saveColor(color);
      colorsById[color.id] = color;
      summary.colorsImported += 1;
    } catch (error) {
      logImportError("Color write failed", error, { colorId: color?.id });
      summary.errors.push(`Color could not be imported: ${color?.name || color?.id || "Unknown color"}`);
    }
  }

  for (const paperPack of importedPaperPacks) {
    try {
      const versionedPaperPack = addCatalogSchemaVersion(paperPack);

      await savePaperPack(versionedPaperPack);
      await verifySavedPaperPackImages(importDiagnostic, versionedPaperPack);
      upsertPaperPack(paperPacks, versionedPaperPack);
      summary.packsImported += 1;
      summary.imagesImported += countEmbeddedPatternImages(versionedPaperPack);
      summary.folderImageReferencesImported += countFolderImageReferences(versionedPaperPack);
    } catch (error) {
      recordPaperPackStorageFailure(importDiagnostic, paperPack, error);
      logImportError("Paper-pack write failed", error, {
        paperPackId: paperPack?.id,
        embeddedImageCount: countEmbeddedPatternImages(paperPack)
      });
      summary.errors.push(`Paper pack could not be imported: ${paperPack?.name || paperPack?.id || "Unknown pack"}`);
    }
  }

  summary.diagnosticReport = await reportImportDiagnostic(importDiagnostic);

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

async function createImportDiagnostic(paperPacks, diagnosticContext = null) {
  if (!diagnosticContext && !isImportDiagnosticEnabled()) {
    return null;
  }

  const diagnostic = {
    reportVersion: 1,
    startedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    environment: {
      userAgent: navigator.userAgent,
      browser: getBrowserDescription(navigator.userAgent),
      operatingSystem: getOperatingSystemDescription(navigator.userAgent),
      origin: window.location.origin,
      pageUrl: window.location.href,
      standalone: isStandaloneDisplayMode(),
      serviceWorkerVersion: await getServiceWorkerVersion()
    },
    backup: {
      fileName: diagnosticContext?.backupFileName || "not recorded",
      fileSize: diagnosticContext?.backupFileSize ?? null,
      paperPackCount: paperPacks.length,
      embeddedImageCount: paperPacks.reduce((count, paperPack) => count + countEmbeddedPatternImages(paperPack), 0)
    },
    images: [],
    storageErrors: [],
    quotaBefore: await getStorageQuotaDiagnostic(),
    quotaAfter: null
  };

  for (const paperPack of paperPacks) {
    for (const [patternIndex, pattern] of (paperPack.patterns || []).entries()) {
      if (!pattern || typeof pattern !== "object" || typeof pattern.imageSrc !== "string") {
        continue;
      }

      const entry = createImportDiagnosticEntry(paperPack, pattern, patternIndex);
      const match = pattern.imageSrc.match(SUPPORTED_EMBEDDED_IMAGE_PREFIX_PATTERN);
      entry.supportedPrefix = Boolean(match);

      if (!match) {
        entry.failures.push("Unsupported or malformed data:image/...;base64, value.");
      } else {
        try {
          entry.decodedByteLength = window.atob(pattern.imageSrc.slice(match[0].length)).length;
          entry.base64Decoded = entry.decodedByteLength > 0;
          if (!entry.base64Decoded) entry.failures.push("Base64 decoded to an empty value.");
        } catch (error) {
          entry.failures.push(`Base64 decode failed: ${formatDiagnosticError(error)}`);
        }

        try {
          const image = await loadDiagnosticImage(pattern.imageSrc);
          entry.renderedBeforeStorage = true;
          entry.renderWidth = image.naturalWidth;
          entry.renderHeight = image.naturalHeight;
        } catch (error) {
          entry.failures.push(`Browser image render failed: ${formatDiagnosticError(error)}`);
        }
      }

      diagnostic.images.push(entry);
    }
  }

  return diagnostic;
}

function createImportDiagnosticEntry(paperPack, pattern, patternIndex) {
  return {
    paperPackId: paperPack.id || "",
    paperPackName: paperPack.name || "",
    patternId: pattern.id || `pattern-${patternIndex + 1}`,
    patternIndex,
    imageName: pattern.imageName || "",
    imageSrcLength: pattern.imageSrc.length,
    supportedPrefix: false,
    base64Decoded: false,
    decodedByteLength: 0,
    renderedBeforeStorage: false,
    renderWidth: 0,
    renderHeight: 0,
    indexedDbWriteSucceeded: false,
    savedImageSrcLength: null,
    matchedAfterReadBack: false,
    renderedAfterReadBack: false,
    storedRenderWidth: 0,
    storedRenderHeight: 0,
    failures: []
  };
}

async function verifySavedPaperPackImages(diagnostic, paperPack) {
  if (!diagnostic) return;

  try {
    const savedPaperPack = await loadSavedPaperPack(paperPack.id);
    for (const entry of diagnostic.images.filter((image) => image.paperPackId === paperPack.id)) {
      const savedImageSrc = savedPaperPack?.patterns?.[entry.patternIndex]?.imageSrc;
      entry.indexedDbWriteSucceeded = true;
      entry.savedImageSrcLength = typeof savedImageSrc === "string" ? savedImageSrc.length : null;
      entry.matchedAfterReadBack = entry.savedImageSrcLength === entry.imageSrcLength;
      if (!entry.matchedAfterReadBack) {
        entry.failures.push(`IndexedDB read-back length mismatch: expected ${entry.imageSrcLength}, received ${entry.savedImageSrcLength ?? "missing"}.`);
      }

      if (typeof savedImageSrc === "string") {
        try {
          const storedImage = await loadDiagnosticImage(savedImageSrc);
          entry.renderedAfterReadBack = true;
          entry.storedRenderWidth = storedImage.naturalWidth;
          entry.storedRenderHeight = storedImage.naturalHeight;
        } catch (error) {
          entry.failures.push(`Stored image render failed: ${formatDiagnosticError(error)}`);
        }
      }
    }
  } catch (error) {
    recordPaperPackStorageFailure(diagnostic, paperPack, error, "IndexedDB read-back failed");
  }
}

function recordPaperPackStorageFailure(diagnostic, paperPack, error, operation = "IndexedDB write failed") {
  if (!diagnostic) return;

  const storageError = {
    paperPackId: paperPack?.id || "",
    operation,
    errorName: error?.name || "Error",
    errorMessage: error?.message || String(error)
  };
  diagnostic.storageErrors.push(storageError);

  for (const entry of diagnostic.images.filter((image) => image.paperPackId === paperPack?.id)) {
    entry.failures.push(`${operation}: ${storageError.errorName}: ${storageError.errorMessage}`);
  }
}

async function reportImportDiagnostic(diagnostic) {
  if (!diagnostic) return null;

  diagnostic.quotaAfter = await getStorageQuotaDiagnostic();
  diagnostic.completedAt = new Date().toISOString();
  const summary = {
    imagesReceived: diagnostic.images.length,
    base64StringsDecoded: diagnostic.images.filter((image) => image.base64Decoded).length,
    imagesRenderedBeforeStorage: diagnostic.images.filter((image) => image.renderedBeforeStorage).length,
    imagesMatchedAfterIndexedDbReadBack: diagnostic.images.filter((image) => image.matchedAfterReadBack).length,
    failures: diagnostic.images.reduce((count, image) => count + image.failures.length, 0) +
      diagnostic.storageErrors.filter(
        (error) => !diagnostic.images.some((image) => image.paperPackId === error.paperPackId)
      ).length
  };

  console.group("[Backup import diagnostic] Embedded image import report");
  console.info("Environment", diagnostic.environment);
  console.info(
    `${summary.imagesReceived} images received\n` +
    `${summary.base64StringsDecoded} base64 strings decoded\n` +
    `${summary.imagesRenderedBeforeStorage} images rendered before storage\n` +
    `${summary.imagesMatchedAfterIndexedDbReadBack} images matched after IndexedDB read-back\n` +
    `${summary.failures} failures`
  );
  console.table(diagnostic.images);
  if (diagnostic.storageErrors.length > 0) console.error("IndexedDB errors", diagnostic.storageErrors);
  console.info("Storage quota", { before: diagnostic.quotaBefore, after: diagnostic.quotaAfter });
  console.groupEnd();
  diagnostic.summary = summary;

  return diagnostic;
}

function isImportDiagnosticEnabled() {
  return new URLSearchParams(window.location.search).get(IMPORT_DIAGNOSTIC_QUERY_PARAMETER) === "1";
}

function isStandaloneDisplayMode() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function loadDiagnosticImage(imageSrc) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("The image element emitted an error event.")), { once: true });
    image.src = imageSrc;
  });
}

async function getServiceWorkerVersion() {
  const controller = navigator.serviceWorker?.controller;
  if (!controller) return "uncontrolled";

  return await new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeoutId = window.setTimeout(() => resolve("unknown-or-legacy"), 1500);
    channel.port1.addEventListener("message", (event) => {
      window.clearTimeout(timeoutId);
      resolve(event.data?.version || "unknown");
    }, { once: true });
    channel.port1.start();
    try {
      controller.postMessage({ type: "catalog:get-service-worker-version" }, [channel.port2]);
    } catch (error) {
      window.clearTimeout(timeoutId);
      resolve(`unavailable: ${formatDiagnosticError(error)}`);
    }
  });
}

function formatDiagnosticError(error) {
  return `${error?.name || "Error"}: ${error?.message || String(error)}`;
}

function getBrowserDescription(userAgent) {
  const value = String(userAgent || "");
  const candidates = [
    ["Microsoft Edge", /Edg\/([\d.]+)/],
    ["Google Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
    ["Mozilla Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari\//]
  ];

  for (const [name, pattern] of candidates) {
    const match = value.match(pattern);
    if (match) return `${name} ${match[1]}`;
  }

  return "Unknown browser";
}

function getOperatingSystemDescription(userAgent) {
  const value = String(userAgent || "");
  const mac = value.match(/Mac OS X ([\d_]+)/);
  const ios = value.match(/(?:CPU (?:iPhone )?OS|iPad; CPU OS) ([\d_]+)/);
  const windows = value.match(/Windows NT ([\d.]+)/);

  if (ios) return `iOS/iPadOS ${ios[1].replaceAll("_", ".")}`;
  if (mac) return `macOS ${mac[1].replaceAll("_", ".")}`;
  if (windows) return `Windows NT ${windows[1]}`;
  if (/Android/.test(value)) return value.match(/Android ([\d.]+)/)?.[0] || "Android";
  if (/Linux/.test(value)) return "Linux";
  return "Unknown operating system";
}

async function createFailedDiagnosticReport(backupFile, error) {
  return {
    reportVersion: 1,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    environment: {
      userAgent: navigator.userAgent,
      browser: getBrowserDescription(navigator.userAgent),
      operatingSystem: getOperatingSystemDescription(navigator.userAgent),
      origin: window.location.origin,
      pageUrl: window.location.href,
      standalone: isStandaloneDisplayMode(),
      serviceWorkerVersion: await getServiceWorkerVersion()
    },
    backup: {
      fileName: backupFile?.name || "unknown",
      fileSize: backupFile?.size ?? null,
      paperPackCount: null,
      embeddedImageCount: null
    },
    quotaBefore: await getStorageQuotaDiagnostic(),
    quotaAfter: await getStorageQuotaDiagnostic(),
    images: [],
    storageErrors: [],
    fatalError: {
      errorName: error?.name || "Error",
      errorMessage: error?.message || String(error)
    },
    summary: {
      imagesReceived: 0,
      base64StringsDecoded: 0,
      imagesRenderedBeforeStorage: 0,
      imagesMatchedAfterIndexedDbReadBack: 0,
      failures: 1
    }
  };
}

function downloadImportDiagnosticReport(report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  downloadJsonBackup(blob, `card-supply-catalog-import-diagnostic-${formatDateStamp(new Date())}.json`);
}

async function getStorageQuotaDiagnostic() {
  if (!navigator.storage?.estimate) {
    return null;
  }

  try {
    const estimate = await navigator.storage.estimate();

    return {
      usage: estimate.usage,
      quota: estimate.quota,
      available: Number.isFinite(estimate.quota) && Number.isFinite(estimate.usage)
        ? estimate.quota - estimate.usage
        : null
    };
  } catch (error) {
    return {
      errorName: error?.name || "Error",
      errorMessage: error?.message || String(error)
    };
  }
}

function logImportError(message, error, details = {}) {
  console.error(`[Backup import diagnostic] ${message}`, {
    ...details,
    errorName: error?.name || "Error",
    errorMessage: error?.message || String(error),
    error
  });
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

  clearPaperPackImageObjectUrls(paperPacks[existingIndex]);
  paperPacks.splice(existingIndex, 1, paperPack);
}

async function verifyPostRestoreCatalog(importedPaperPacks, rendererCatalog) {
  const importedPaperPack = importedPaperPacks.find((paperPack) =>
    rendererCatalog.some((catalogPaperPack) => catalogPaperPack.id === paperPack?.id)
  );

  if (!importedPaperPack) return null;

  const indexedDbPaperPack = await loadSavedPaperPack(importedPaperPack.id);
  const rendererPaperPack = rendererCatalog.find((paperPack) => paperPack.id === importedPaperPack.id);

  const sources = [
    summarizePostRestorePaperPack("Imported object", importedPaperPack),
    summarizePostRestorePaperPack("IndexedDB read-back", indexedDbPaperPack),
    summarizePostRestorePaperPack("Library renderer catalog", rendererPaperPack)
  ];
  const importedSummary = sources[0];

  return {
    paperPackId: importedPaperPack.id,
    paperPackName: importedPaperPack.name,
    sources: sources.map((source) => ({
      ...source,
      matchesImported:
        source.patternCount === importedSummary.patternCount &&
        source.imageSrcLengths.join(",") === importedSummary.imageSrcLengths.join(",")
    }))
  };
}

function summarizePostRestorePaperPack(source, paperPack) {
  return {
    source,
    patternCount: paperPack?.patterns?.length ?? null,
    imageSrcLengths: (paperPack?.patterns || []).map((pattern) =>
      typeof pattern?.imageSrc === "string" ? pattern.imageSrc.length : null
    )
  };
}

function reportPostRestoreVerification(verification) {
  if (!verification) return;

  console.group(`[Post-restore verification] ${verification.paperPackName || verification.paperPackId}`);
  console.table(
    verification.sources.map(({ source, patternCount, imageSrcLengths, matchesImported }) => ({
      source,
      patternCount,
      imageSrcLengths: imageSrcLengths.join(", "),
      matchesImported
    }))
  );
  console.groupEnd();
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
