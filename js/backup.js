import {
  loadCatalogSetting,
  loadCardTagVocabulary,
  loadPaperTagVocabulary,
  loadSavedCards,
  loadSavedPaperPack,
  isCard,
  isColor,
  isCompatiblePaperPack,
  restoreCatalogRecords,
  saveCatalogSetting
} from "./storage.js";
import { buildOwnerRegistry, isOwner, migratePaperPackOwners, serializePaperPackOwner } from "./owners.js";
import {
  buildEffectiveCardTagVocabulary,
  buildEffectivePaperTagVocabulary
} from "./tag-utils.js";
import { getCardDetailImageSource, hydrateCardImageSources } from "./card-images.js";
import { createImportPlan } from "./import-mode.js";
import {
  clearPaperPackImageObjectUrls,
  getPatternImageFile,
  getPatternImageSource,
  reconnectPaperPackImagesToExistingFolder
} from "./images.js";
import {
  BACKUP_SCHEMA_VERSION,
  CATALOG_SCHEMA_VERSION,
  addCatalogSchemaVersion,
  getCatalogSchemaVersion
} from "./schema.js";

const IMAGE_LIBRARY_SETTING_ID = "imageLibrary";
const CARD_IMAGE_LIBRARY_SETTING_ID = "cardImageLibrary";
const LAST_BACKUP_EXPORT_SETTING_ID = "lastBackupExportedAt";
const LAST_BACKUP_IMPORT_SETTING_ID = "lastBackupImportedAt";
const APP_VERSION = "2026.08.22-low-memory-diagnostic";
const IMPORT_DIAGNOSTIC_QUERY_PARAMETER = "importDiagnostics";
const IMPORT_DIAGNOSTIC_STORAGE_KEY = "card-supply-catalog.import-diagnostic";
const SUPPORTED_EMBEDDED_IMAGE_PREFIX_PATTERN = /^data:image\/(jpeg|png|webp|gif);base64,/i;
const MAX_SAFE_IPAD_IMPORT_BYTES = 96 * 1024 * 1024;
export const IPAD_BACKUP_COMPRESSION = Object.freeze({
  format: "image/jpeg",
  maxDimension: 400,
  quality: 0.55
});

export function initializeCatalogBackup({ paperPacks, colorsById, owners = [], onRestore }) {
  const exportButton = document.querySelector("[data-export-catalog]");
  const exportIpadButton = document.querySelector("[data-export-ipad-catalog]");
  const importInput = document.querySelector("[data-import-catalog]");
  const diagnosticImportInput = document.querySelector("[data-import-catalog-diagnostic]");
  const overwriteExistingInput = document.querySelector("[data-import-overwrite-existing]");
  const downloadDiagnosticButton = document.querySelector("[data-download-import-diagnostic]");
  const diagnosticPanel = document.querySelector("[data-import-diagnostic-panel]");
  const diagnosticOutput = document.querySelector("[data-import-diagnostic-output]");
  const diagnosticSummary = document.querySelector("[data-import-diagnostic-summary]");
  const diagnosticMessage = document.querySelector("[data-import-diagnostic-message]");
  const copyDiagnosticButton = document.querySelector("[data-copy-import-diagnostic]");
  const clearDiagnosticButton = document.querySelector("[data-clear-import-diagnostic]");
  const message = document.querySelector("[data-backup-message]");
  let latestDiagnosticReport = null;
  const runtimeErrors = captureRuntimeErrors();

  const showDiagnosticReport = (report) => {
    if (!report || !diagnosticPanel || !diagnosticOutput) return;
    report.runtimeErrors = [...runtimeErrors];
    diagnosticOutput.value = JSON.stringify(createShareableDiagnosticReport(report), null, 2);
    diagnosticPanel.hidden = false;
    diagnosticSummary.textContent = `${report.summary?.failures || 0} issue${report.summary?.failures === 1 ? "" : "s"}, ${runtimeErrors.length} browser error${runtimeErrors.length === 1 ? "" : "s"}`;
    diagnosticPanel.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  };

  const recoveredDiagnostic = recoverImportDiagnostic();
  if (recoveredDiagnostic) {
    latestDiagnosticReport = recoveredDiagnostic;
    showDiagnosticReport(recoveredDiagnostic);
    if (downloadDiagnosticButton) downloadDiagnosticButton.disabled = false;
    renderBackupMessage(
      message,
      recoveredDiagnostic.interrupted
        ? "The previous diagnostic was interrupted when the browser reloaded. The recovered report is shown below."
        : "The most recent diagnostic report was recovered.",
      recoveredDiagnostic.interrupted ? "error" : "success"
    );
  }

  if (exportButton) {
    exportButton.addEventListener("click", async () => {
      try {
        const backupDirectory = await getWritableBackupDirectoryHandle();
        const backup = await createCatalogBackup({
          paperPacks,
          colorsById,
          owners
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
      renderBackupMessage(message, "Creating compact iPad backup with compressed images...", "");

      try {
        const backupDirectory = await getWritableBackupDirectoryHandle();
        const backup = await createIpadCatalogBackup({
          paperPacks,
          colorsById,
          owners
        });

        const saveResult = await saveJsonBackup(backup, "ipad-backup", backupDirectory);
        await saveCatalogSetting(LAST_BACKUP_EXPORT_SETTING_ID, backup.exportedAt);
        document.dispatchEvent(new CustomEvent("catalog:backup-exported"));
        renderBackupMessage(message, formatIpadExportSummary(backup, saveResult), backup.imageStorage.missingImages > 0 ? "error" : "success");
      } catch (error) {
        renderBackupMessage(message, "The compact iPad backup could not be created.", "error");
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

      if (backupFile.size === 0) {
        renderBackupMessage(
          message,
          "This backup file is empty (0 bytes). Create and transfer the compact iPad backup again. No catalog data was changed.",
          "error"
        );
        importInput.value = "";
        return;
      }

      if (shouldBlockOversizedIpadImport({
        fileSize: backupFile.size,
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        maxTouchPoints: navigator.maxTouchPoints
      })) {
        renderBackupMessage(
          message,
          `This ${(backupFile.size / 1024 / 1024).toFixed(0)} MB backup is too large to import safely on an iPad. Create a new iPad Backup with the latest desktop version, then import that smaller file. No catalog data was changed.`,
          "error"
        );
        importInput.value = "";
        return;
      }

      try {
        const backup = await readBackupFile(backupFile);
        const overwriteExisting = overwriteExistingInput?.checked === true;
        const overwriteSummary = await summarizeBackupOverwrites(backup, paperPacks, colorsById);

        if (overwriteExisting && overwriteSummary.requiresConfirmation && !window.confirm(overwriteSummary.message)) {
          renderBackupMessage(message, "Import cancelled. No catalog changes were made.", "");
          return;
        }

        const restoreSummary = await restoreCatalogBackup({
          backup,
          paperPacks,
          colorsById,
          owners,
          overwriteExisting
        });

        await onRestore?.();
        restoreSummary.postRestoreVerification = await verifyPostRestoreCatalog(
          getImportedPaperPacksForVerification(backup.paperPacks, restoreSummary),
          paperPacks
        );
        reportPostRestoreVerification(restoreSummary.postRestoreVerification);
        renderRestoreSummary(message, restoreSummary);

        if (restoreSummary.errors.length === 0) {
          await saveCatalogSetting(LAST_BACKUP_IMPORT_SETTING_ID, new Date().toISOString());
          document.dispatchEvent(new CustomEvent("catalog:backup-imported"));
        }

      } catch (error) {
        renderRestoreSummary(message, {
          packsImported: 0,
          packsSkipped: 0,
          colorsImported: 0,
          colorsSkipped: 0,
          cardsImported: 0,
          cardsSkipped: 0,
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
      renderBackupMessage(message, "Scanning backup without importing it: 0%", "");
      checkpointImportDiagnostic(createPendingDiagnosticReport(backupFile), "streaming-backup");

      try {
        latestDiagnosticReport = await scanBackupFileLowMemory(backupFile, ({ percent, report }) => {
          renderBackupMessage(message, `Scanning backup without importing it: ${percent}%`, "");
          checkpointImportDiagnostic(report, "streaming-backup");
        });
        if (downloadDiagnosticButton) downloadDiagnosticButton.disabled = !latestDiagnosticReport;
        showDiagnosticReport(latestDiagnosticReport);
        checkpointImportDiagnostic(latestDiagnosticReport, "complete", true);
        renderBackupMessage(
          message,
          "Low-memory scan completed. No catalog data was imported or changed. Copy the debug report below.",
          latestDiagnosticReport?.summary?.failures === 0 ? "success" : "error"
        );
      } catch (error) {
        latestDiagnosticReport = await createFailedDiagnosticReport(backupFile, error);
        showDiagnosticReport(latestDiagnosticReport);
        checkpointImportDiagnostic(latestDiagnosticReport, "failed", true);
        if (downloadDiagnosticButton) downloadDiagnosticButton.disabled = false;
        renderBackupMessage(message, "Import diagnostic completed with an error. Copy the debug report below and send it to the app developer.", "error");
      } finally {
        diagnosticImportInput.value = "";
      }
    });
  }

  downloadDiagnosticButton?.addEventListener("click", () => {
    if (latestDiagnosticReport) downloadImportDiagnosticReport(latestDiagnosticReport);
  });

  copyDiagnosticButton?.addEventListener("click", async () => {
    if (!diagnosticOutput?.value) return;
    try {
      await copyDiagnosticText(diagnosticOutput.value, diagnosticOutput);
      renderBackupMessage(diagnosticMessage, "Debug report copied. Paste it into your message to the developer.", "success");
    } catch (error) {
      diagnosticOutput.focus();
      diagnosticOutput.select();
      renderBackupMessage(diagnosticMessage, "Copy was blocked. The report is selected; use Copy from the iPad menu.", "error");
    }
  });

  clearDiagnosticButton?.addEventListener("click", () => {
    latestDiagnosticReport = null;
    runtimeErrors.length = 0;
    clearImportDiagnosticCheckpoint();
    if (diagnosticOutput) diagnosticOutput.value = "";
    if (diagnosticPanel) diagnosticPanel.hidden = true;
    if (downloadDiagnosticButton) downloadDiagnosticButton.disabled = true;
    renderBackupMessage(diagnosticMessage, "", "");
  });
}

function captureRuntimeErrors() {
  const errors = [];
  const add = (type, error, details = {}) => {
    errors.push({
      at: new Date().toISOString(),
      type,
      errorName: error?.name || "Error",
      errorMessage: error?.message || String(error || details.message || "Unknown error"),
      stack: error?.stack || "",
      ...details
    });
  };

  window.addEventListener("error", (event) => add("error", event.error, {
    message: event.message || "",
    source: event.filename || "",
    line: event.lineno || 0,
    column: event.colno || 0
  }));
  window.addEventListener("unhandledrejection", (event) => add("unhandledrejection", event.reason));
  return errors;
}

function createPendingDiagnosticReport(backupFile) {
  return {
    reportVersion: 2,
    startedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    backup: {
      fileName: backupFile?.name || "unknown",
      fileSize: backupFile?.size ?? null,
      paperPackCount: null,
      embeddedImageCount: null
    },
    images: [],
    storageErrors: [],
    progress: { stage: "streaming-backup", bytesRead: 0, percent: 0, imagesChecked: 0 }
  };
}

export async function scanBackupFileLowMemory(backupFile, onProgress = null) {
  const report = createPendingDiagnosticReport(backupFile);
  report.diagnosticMode = "read-only-streaming-scan";
  report.environment = {
    userAgent: navigator.userAgent,
    browser: getBrowserDescription(navigator.userAgent),
    operatingSystem: getOperatingSystemDescription(navigator.userAgent),
    origin: window.location.origin,
    pageUrl: window.location.href,
    standalone: isStandaloneDisplayMode(),
    serviceWorkerVersion: await getServiceWorkerVersion()
  };
  report.quotaBefore = await getStorageQuotaDiagnostic();
  report.backup.imageStorageStrategy = "not parsed";
  const scanner = createEmbeddedImageStreamScanner();
  const reader = backupFile.stream().getReader();
  const decoder = new TextDecoder();
  const progressInterval = Math.max(1024 * 1024, Math.floor((backupFile.size || 1) / 100));
  let bytesRead = 0;
  let nextProgressAt = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    scanner.push(decoder.decode(value, { stream: true }));

    if (bytesRead >= nextProgressAt) {
      report.images = scanner.getImages();
      report.progress = createStreamProgress(bytesRead, backupFile.size, report.images.length);
      await onProgress?.({ percent: report.progress.percent, report });
      nextProgressAt = bytesRead + progressInterval;
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  }

  scanner.push(decoder.decode());
  scanner.finish();
  report.images = scanner.getImages();
  report.progress = createStreamProgress(bytesRead, backupFile.size, report.images.length);
  report.progress.stage = "complete";
  report.completedAt = new Date().toISOString();
  report.summary = createLowMemoryDiagnosticSummary(report);
  report.backup.embeddedImageCount = report.images.length;
  report.quotaAfter = await getStorageQuotaDiagnostic();
  return report;
}

function createStreamProgress(bytesRead, totalBytes, imagesChecked) {
  return {
    stage: "streaming-backup",
    bytesRead,
    totalBytes,
    percent: totalBytes > 0 ? Math.min(100, Math.floor((bytesRead / totalBytes) * 100)) : 100,
    imagesChecked
  };
}

export function createLowMemoryDiagnosticSummary(report) {
  const malformedImages = report.images.filter((image) => !image.supportedPrefix || image.invalidBase64Characters > 0);
  const emptyBackupFile = report.backup?.fileSize === 0;
  return {
    imagesReceived: report.images.length,
    totalEncodedImageCharacters: report.images.reduce((sum, image) => sum + image.base64CharacterCount, 0),
    estimatedDecodedImageBytes: report.images.reduce((sum, image) => sum + image.estimatedDecodedBytes, 0),
    largestEncodedImageCharacters: report.images.reduce((largest, image) => Math.max(largest, image.base64CharacterCount), 0),
    malformedImages: malformedImages.length,
    emptyBackupFile,
    failures: malformedImages.length + (emptyBackupFile ? 1 : 0),
    catalogChanged: false
  };
}

export function createShareableDiagnosticReport(report) {
  if (report?.diagnosticMode !== "read-only-streaming-scan") return report;
  const images = Array.isArray(report.images) ? report.images : [];
  const malformedImages = images.filter((image) => !image.supportedPrefix || image.invalidBase64Characters > 0);
  const malformedIndexes = new Set(malformedImages.map((image) => image.imageIndex));
  const largestValidImages = images
    .filter((image) => !malformedIndexes.has(image.imageIndex))
    .sort((first, second) => second.estimatedDecodedBytes - first.estimatedDecodedBytes)
    .slice(0, 10);

  return {
    ...report,
    images: undefined,
    imageEvidence: {
      totalImagesScanned: images.length,
      malformedImages,
      largestValidImages,
      omittedSuccessfulImages: Math.max(0, images.length - malformedImages.length - largestValidImages.length)
    }
  };
}

export function createEmbeddedImageStreamScanner() {
  const key = '"imageSrc"';
  const images = [];
  let buffer = "";
  let activeImage = null;

  const consumeValue = (segment) => {
    activeImage.valueLength += segment.length;
    if (!activeImage.commaFound) {
      const prefixLengthBeforeSegment = activeImage.prefix.length;
      const consumedFromSegment = Math.min(segment.length, Math.max(0, 96 - prefixLengthBeforeSegment));
      const combined = activeImage.prefix + segment.slice(0, consumedFromSegment);
      const commaIndex = combined.indexOf(",");
      if (commaIndex >= 0) {
        activeImage.header = combined.slice(0, commaIndex);
        activeImage.prefix = combined.slice(0, commaIndex + 1);
        activeImage.commaFound = true;
        consumeBase64(combined.slice(commaIndex + 1));
        consumeBase64(segment.slice(consumedFromSegment));
      } else {
        activeImage.prefix = combined;
      }
      return;
    }
    consumeBase64(segment);
  };

  const consumeBase64 = (segment) => {
    if (!segment) return;
    activeImage.base64CharacterCount += segment.length;
    activeImage.invalidBase64Characters += countInvalidBase64Characters(segment);
    activeImage.lastBase64Characters = (activeImage.lastBase64Characters + segment).slice(-2);
  };

  const finishImage = () => {
    const padding = activeImage.lastBase64Characters.endsWith("==") ? 2 : activeImage.lastBase64Characters.endsWith("=") ? 1 : 0;
    activeImage.supportedPrefix = /^data:image\/(jpeg|png|webp|gif);base64$/i.test(activeImage.header);
    activeImage.mimeType = activeImage.header.match(/^data:([^;]+)/i)?.[1] || "unknown";
    activeImage.estimatedDecodedBytes = Math.max(0, Math.floor(activeImage.base64CharacterCount * 3 / 4) - padding);
    delete activeImage.header;
    delete activeImage.prefix;
    delete activeImage.commaFound;
    delete activeImage.lastBase64Characters;
    images.push(activeImage);
    activeImage = null;
  };

  return {
    push(text) {
      buffer += text;
      while (buffer.length > 0) {
        if (activeImage) {
          const endIndex = buffer.indexOf('"');
          if (endIndex < 0) {
            consumeValue(buffer);
            buffer = "";
            break;
          }
          consumeValue(buffer.slice(0, endIndex));
          finishImage();
          buffer = buffer.slice(endIndex + 1);
          continue;
        }

        const keyIndex = buffer.indexOf(key);
        if (keyIndex < 0) {
          buffer = buffer.slice(-(key.length - 1));
          break;
        }
        const remainder = buffer.slice(keyIndex + key.length);
        const valueStart = remainder.match(/^\s*:\s*"/);
        if (!valueStart) {
          if (remainder.length < 12) {
            buffer = buffer.slice(keyIndex);
            break;
          }
          buffer = remainder;
          continue;
        }
        activeImage = {
          imageIndex: images.length + 1,
          valueLength: 0,
          mimeType: "unknown",
          supportedPrefix: false,
          base64CharacterCount: 0,
          estimatedDecodedBytes: 0,
          invalidBase64Characters: 0,
          header: "",
          prefix: "",
          commaFound: false,
          lastBase64Characters: ""
        };
        buffer = remainder.slice(valueStart[0].length);
      }
    },
    finish() {
      if (activeImage) {
        consumeValue(buffer);
        activeImage.invalidBase64Characters += 1;
        finishImage();
      }
      buffer = "";
    },
    getImages() {
      return images.map((image) => ({ ...image }));
    }
  };
}

function countInvalidBase64Characters(value) {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const valid = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) || code === 43 || code === 47 || code === 61;
    if (!valid) count += 1;
  }
  return count;
}

function checkpointImportDiagnostic(report, stage, complete = false) {
  if (!report || typeof localStorage === "undefined") return;
  report.progress = {
    ...(report.progress || {}),
    stage,
    updatedAt: new Date().toISOString()
  };
  try {
    const savedReport = createShareableDiagnosticReport(report);
    if (report.diagnosticMode === "read-only-streaming-scan" && !savedReport.summary) {
      savedReport.summary = createLowMemoryDiagnosticSummary(report);
    }
    localStorage.setItem(IMPORT_DIAGNOSTIC_STORAGE_KEY, JSON.stringify({ complete, report: savedReport }));
  } catch (error) {
    // The live report remains available when local storage is unavailable or full.
  }
}

function recoverImportDiagnostic() {
  if (typeof localStorage === "undefined") return null;
  try {
    const saved = JSON.parse(localStorage.getItem(IMPORT_DIAGNOSTIC_STORAGE_KEY) || "null");
    if (!saved?.report) return null;
    if (!saved.complete) {
      saved.report.interrupted = true;
      saved.report.fatalError = saved.report.fatalError || {
        errorName: "BrowserReload",
        errorMessage: "The diagnostic stopped before completion. iPadOS may have reloaded the app because of memory pressure."
      };
      saved.report.completedAt = new Date().toISOString();
      if (saved.report.diagnosticMode === "read-only-streaming-scan") {
        saved.report.summary = saved.report.summary || { failures: 0, catalogChanged: false };
        saved.report.summary.failures += 1;
      } else {
        saved.report.summary = createDiagnosticSummary(saved.report, 1);
      }
    }
    return saved.report;
  } catch (error) {
    return null;
  }
}

function clearImportDiagnosticCheckpoint() {
  try {
    localStorage.removeItem(IMPORT_DIAGNOSTIC_STORAGE_KEY);
  } catch (error) {
    // Nothing else is required when local storage is unavailable.
  }
}

async function copyDiagnosticText(text, textarea) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  textarea.focus();
  textarea.select();
  if (!document.execCommand?.("copy")) throw new Error("Clipboard copy is unavailable.");
}

async function summarizeBackupOverwrites(backup, paperPacks, colorsById) {
  const importedPaperPacks = Array.isArray(backup?.paperPacks) ? backup.paperPacks : [];
  const importedColors = backup?.colors && typeof backup.colors === "object" ? Object.values(backup.colors) : [];
  const importedCards = Array.isArray(backup?.cards) ? backup.cards : [];
  const savedCards = await loadSavedCards();
  const packPlan = createImportPlan(importedPaperPacks, paperPacks, true);
  const colorPlan = createImportPlan(importedColors, Object.values(colorsById), true);
  const cardPlan = createImportPlan(importedCards, savedCards, true);
  const packOverwriteCount = packPlan.matchingCount;
  const colorOverwriteCount = colorPlan.matchingCount;
  const cardOverwriteCount = cardPlan.matchingCount;
  const newPackCount = packPlan.newCount;
  const newColorCount = colorPlan.newCount;
  const newCardCount = cardPlan.newCount;
  const overwriteParts = [];

  if (packOverwriteCount > 0) {
    overwriteParts.push(`${packOverwriteCount} paper pack${packOverwriteCount === 1 ? "" : "s"}`);
  }

  if (colorOverwriteCount > 0) {
    overwriteParts.push(`${colorOverwriteCount} color${colorOverwriteCount === 1 ? "" : "s"}`);
  }

  if (cardOverwriteCount > 0) {
    overwriteParts.push(`${cardOverwriteCount} Card${cardOverwriteCount === 1 ? "" : "s"}`);
  }

  if (overwriteParts.length === 0) {
    return {
      requiresConfirmation: false,
      message: ""
    };
  }

  return {
    requiresConfirmation: true,
    message: [
      "Replace matching catalog entries?",
      "",
      `This will replace ${overwriteParts.join(" and ")} already in the catalog. Only image data and references belonging to matching paper packs and Cards can change; all other catalog images will remain untouched. Files in your selected image folders will not be deleted.`,
      "",
      `The import will also add ${newPackCount} new paper pack${newPackCount === 1 ? "" : "s"}, ${newColorCount} new color${newColorCount === 1 ? "" : "s"}, and ${newCardCount} new Card${newCardCount === 1 ? "" : "s"}.`,
      "",
      "Continue with replacement import?"
    ].join("\n")
  };
}
async function createCatalogBackup({ paperPacks, colorsById, owners = [] }) {
  const [imageLibrary, cardImageLibrary, cards, paperTagVocabulary, cardTagVocabulary] = await Promise.all([
    loadCatalogSetting(IMAGE_LIBRARY_SETTING_ID),
    loadCatalogSetting(CARD_IMAGE_LIBRARY_SETTING_ID),
    loadSavedCards(),
    loadPaperTagVocabulary(),
    loadCardTagVocabulary()
  ]);
  return createCatalogBackupSnapshot({
    paperPacks,
    colorsById,
    cards,
    owners,
    imageLibrary,
    cardImageLibrary,
    tagVocabularies: { paper: paperTagVocabulary, card: cardTagVocabulary }
  });
}

export function createCatalogBackupSnapshot({
  paperPacks,
  colorsById,
  cards = [],
  owners = [],
  imageLibrary = null,
  cardImageLibrary = null,
  tagVocabularies = {}
}) {
  const effectiveOwners = buildOwnerRegistry(owners, paperPacks);
  const ownedPaperPacks = migratePaperPackOwners(paperPacks, effectiveOwners);
  const imageSummary = summarizeImageStorage(ownedPaperPacks, cards);

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    catalogSchemaVersion: CATALOG_SCHEMA_VERSION,
    app: "card-supply-catalog",
    exportedAt: new Date().toISOString(),
    imageStorage: {
      strategy: imageSummary.folderImageReferences > 0 ? "local-folder-with-fallback" : "embedded-indexed-db",
      configuredLibrary: createSerializableImageLibrarySetting(imageLibrary),
      configuredCardLibrary: createSerializableImageLibrarySetting(cardImageLibrary),
      embeddedImages: imageSummary.embeddedImages,
      folderImageReferences: imageSummary.folderImageReferences,
      note:
        "Backup stores folder-backed images as relative imagePath references. Back up or share the Paper and Card image folders separately, then reconnect them after import."
    },
    colors: sortObjectByKey(colorsById),
    owners: effectiveOwners.map(({ id, name }) => ({ id, name })),
    paperPacks: ownedPaperPacks.map(createSerializablePaperPack),
    cards: cards.map(createSerializableCard),
    tagVocabularies: {
      paper: buildEffectivePaperTagVocabulary(tagVocabularies.paper, ownedPaperPacks),
      card: buildEffectiveCardTagVocabulary(tagVocabularies.card, cards)
    }
  };
}

async function createIpadCatalogBackup({ paperPacks, colorsById, owners = [] }) {
  const effectiveOwners = buildOwnerRegistry(owners, paperPacks);
  const ownedPaperPacks = migratePaperPackOwners(paperPacks, effectiveOwners);
  const compressedPaperPacks = [];
  const [cards, paperTagVocabulary, cardTagVocabulary] = await Promise.all([
    loadSavedCards(),
    loadPaperTagVocabulary(),
    loadCardTagVocabulary()
  ]);
  await hydrateCardImageSources(cards);
  const compressedCards = [];
  const imageSummary = {
    embeddedImages: 0,
    compressedImages: 0,
    missingImages: 0,
    folderImageReferences: 0
  };

  for (const paperPack of ownedPaperPacks) {
    const result = await createSerializablePaperPackWithCompressedImages(paperPack);

    compressedPaperPacks.push(result.paperPack);
    imageSummary.embeddedImages += result.embeddedImages;
    imageSummary.compressedImages += result.compressedImages;
    imageSummary.missingImages += result.missingImages;
    imageSummary.folderImageReferences += result.folderImageReferences;
  }

  for (const card of cards) {
    const result = await createSerializableCardWithCompressedImage(card);
    compressedCards.push(result.card);
    imageSummary.embeddedImages += result.embeddedImages;
    imageSummary.compressedImages += result.compressedImages;
    imageSummary.missingImages += result.missingImages;
    imageSummary.folderImageReferences += result.folderImageReferences;
  }

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    catalogSchemaVersion: CATALOG_SCHEMA_VERSION,
    app: "card-supply-catalog",
    backupProfile: "ipad-compact-embedded-images-v2",
    exportedAt: new Date().toISOString(),
    imageStorage: {
      strategy: "embedded-compressed-images",
      embeddedImages: imageSummary.embeddedImages,
      compressedImages: imageSummary.compressedImages,
      missingImages: imageSummary.missingImages,
      folderImageReferences: imageSummary.folderImageReferences,
      compression: {
        ...IPAD_BACKUP_COMPRESSION
      },
      note:
        "This iPad backup embeds compressed images directly in the JSON file so folder access is not required after import."
    },
    colors: sortObjectByKey(colorsById),
    owners: effectiveOwners.map(({ id, name }) => ({ id, name })),
    paperPacks: compressedPaperPacks,
    cards: compressedCards,
    tagVocabularies: {
      paper: buildEffectivePaperTagVocabulary(paperTagVocabulary, ownedPaperPacks),
      card: buildEffectiveCardTagVocabulary(cardTagVocabulary, cards)
    }
  };
}

function summarizeImageStorage(paperPacks, cards = []) {
  const summary = paperPacks.reduce(
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

  for (const card of cards) {
    summary.embeddedImages += card.imageSrc ? 1 : 0;
    summary.folderImageReferences += card.imagePath ? 1 : 0;
  }

  return summary;
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
  const sizeMessage = Number.isFinite(saveResult?.fileSize)
    ? ` File size: ${(saveResult.fileSize / 1024 / 1024).toFixed(1)} MB.`
    : "";
  const savedMessage = `${formatBackupSaveDestination(saveResult, "Compact iPad backup")}${sizeMessage}`;

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
        fileName,
        fileSize: blob.size
      };
    } catch (error) {
      // Fall back to a browser download if the selected folder cannot be written.
    }
  }

  downloadJsonBackup(blob, fileName);
  return {
    savedToFolder: false,
    folderName: "",
    fileName,
    fileSize: blob.size
  };
}

export function shouldBlockOversizedIpadImport({ fileSize, userAgent = "", platform = "", maxTouchPoints = 0 }) {
  const isIpad = /iPad/i.test(userAgent) ||
    (/Macintosh|MacIntel/i.test(`${userAgent} ${platform}`) && maxTouchPoints > 1);
  return isIpad && fileSize > MAX_SAFE_IPAD_IMPORT_BYTES;
}

function downloadJsonBackup(blob, fileName) {
  if (blob.size === 0) {
    throw new Error("The generated backup file is empty.");
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();

  // Safari may still be reading the object URL after the click handler returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
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

export async function restoreCatalogBackup({
  backup,
  paperPacks,
  colorsById,
  owners = [],
  overwriteExisting = false,
  diagnosticContext = null,
  services = {}
}) {
  const summary = {
    packsImported: 0,
    packsSkipped: 0,
    colorsImported: 0,
    colorsSkipped: 0,
    cardsImported: 0,
    cardsSkipped: 0,
    imagesImported: 0,
    folderImageReferencesImported: 0,
    importedPaperPackIds: [],
    notes: [],
    warnings: [],
    errors: []
  };
  const validation = validateBackup(backup);

  if (!validation.ok) {
    summary.errors.push(validation.message);
    return summary;
  }

  const importedColorsById = backup?.colors || {};
  const rawImportedPaperPacks = Array.isArray(backup?.paperPacks) ? backup.paperPacks : [];
  const importedOwners = buildOwnerRegistry(
    [...owners, ...(Array.isArray(backup?.owners) ? backup.owners : [])],
    rawImportedPaperPacks
  );
  const importedPaperPacks = migratePaperPackOwners(rawImportedPaperPacks, importedOwners);
  const importedCards = Array.isArray(backup?.cards) ? backup.cards : [];
  const [savedCards, savedPaperTagVocabulary, savedCardTagVocabulary] = await Promise.all([
    (services.loadSavedCards || loadSavedCards)(),
    (services.loadPaperTagVocabulary || loadPaperTagVocabulary)(),
    (services.loadCardTagVocabulary || loadCardTagVocabulary)()
  ]);
  const existingPaperTagVocabulary = Array.isArray(savedPaperTagVocabulary)
    ? savedPaperTagVocabulary
    : [];
  const existingCardTagVocabulary = Array.isArray(savedCardTagVocabulary)
    ? savedCardTagVocabulary
    : [];
  const colorPlan = createImportPlan(
    importedColorsById ? Object.values(importedColorsById) : [],
    Object.values(colorsById),
    overwriteExisting
  );
  const paperPackPlan = createImportPlan(importedPaperPacks, paperPacks, overwriteExisting);
  const cardPlan = createImportPlan(importedCards, savedCards, overwriteExisting);
  summary.colorsSkipped = colorPlan.skippedCount;
  summary.packsSkipped = paperPackPlan.skippedCount;
  summary.cardsSkipped = cardPlan.skippedCount;
  const importDiagnostic = await createImportDiagnostic(
    paperPackPlan.recordsToImport,
    diagnosticContext
  );
  checkpointImportDiagnostic(importDiagnostic, "preparing-records");

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

  const preparedPaperPacks = [];
  const preparedCards = cardPlan.recordsToImport.map((card) =>
    addCatalogSchemaVersion(createSerializableCard(card))
  );

  for (const paperPack of paperPackPlan.recordsToImport) {
    try {
      const reconnectResult = await (services.preparePaperPack || reconnectPaperPackImagesToExistingFolder)(paperPack);
      preparedPaperPacks.push(addCatalogSchemaVersion(reconnectResult.paperPack));
    } catch (error) {
      logImportError("Paper-pack preparation failed", error, { paperPackId: paperPack?.id });
      summary.errors.push(
        `Nothing was imported because ${paperPack?.name || paperPack?.id || "a paper pack"} could not be prepared.`
      );
      summary.diagnosticReport = await reportImportDiagnostic(importDiagnostic);
      return summary;
    }
  }

  try {
    checkpointImportDiagnostic(importDiagnostic, "saving-to-indexeddb");
    const tagVocabularies = {
      paper: buildEffectivePaperTagVocabulary(
        [...existingPaperTagVocabulary, ...(backup.tagVocabularies?.paper || [])],
        [...paperPacks, ...preparedPaperPacks]
      ),
      card: buildEffectiveCardTagVocabulary(
        [...existingCardTagVocabulary, ...(backup.tagVocabularies?.card || [])],
        [...savedCards, ...preparedCards]
      )
    };

    await (services.restoreCatalogRecords || restoreCatalogRecords)({
      paperPacks: preparedPaperPacks,
      colors: colorPlan.recordsToImport,
      cards: preparedCards,
      owners: importedOwners,
      tagVocabularies
    });
  } catch (error) {
    logImportError("Atomic catalog restore failed", error, {
      paperPackCount: preparedPaperPacks.length,
      colorCount: colorPlan.recordsToImport.length,
      cardCount: preparedCards.length
    });
    summary.errors.push("Nothing was imported because the catalog could not be saved as one complete transaction.");
    summary.diagnosticReport = await reportImportDiagnostic(importDiagnostic);
    return summary;
  }

  for (const color of colorPlan.recordsToImport) {
    colorsById[color.id] = color;
  }

  for (const paperPack of preparedPaperPacks) {
    upsertPaperPack(paperPacks, paperPack);
    await verifySavedPaperPackImages(importDiagnostic, paperPack);
    checkpointImportDiagnostic(importDiagnostic, "verifying-indexeddb");
    summary.importedPaperPackIds.push(paperPack.id);
    summary.imagesImported += countEmbeddedPatternImages(paperPack);
    summary.folderImageReferencesImported += countFolderImageReferences(paperPack);
  }

  owners.splice(0, owners.length, ...importedOwners);

  for (const card of preparedCards) {
    summary.imagesImported += card.imageSrc ? 1 : 0;
    summary.folderImageReferencesImported += card.imagePath ? 1 : 0;
  }

  summary.colorsImported = colorPlan.recordsToImport.length;
  summary.packsImported = preparedPaperPacks.length;
  summary.cardsImported = preparedCards.length;

  if (summary.cardsImported > 0) {
    if (services.dispatchCardsRestored) {
      services.dispatchCardsRestored();
    } else {
      document.dispatchEvent(new CustomEvent("catalog:cards-restored"));
    }
  }

  summary.diagnosticReport = await reportImportDiagnostic(importDiagnostic);

  if (
    summary.folderImageReferencesImported > 0 ||
    backup.imageStorage?.configuredLibrary ||
    backup.imageStorage?.configuredCardLibrary
  ) {
    summary.warnings.push(
      "Folder-backed image files are not inside the backup JSON. Choose or reconnect the Paper and Card image folders after import."
    );
  }

  if (summary.packsSkipped > 0 || summary.colorsSkipped > 0 || summary.cardsSkipped > 0) {
    summary.notes.push("Existing catalog entries were left unchanged.");
  }

  if (summary.errors.length === 0 && summary.warnings.length === 0) {
    summary.notes.push("Import completed. Re-export and compare with the original backup as the verification checklist describes.");
  }

  return summary;
}

function getImportedPaperPacksForVerification(importedPaperPacks, restoreSummary) {
  const importedIds = new Set(restoreSummary.importedPaperPackIds || []);

  return (importedPaperPacks || []).filter((paperPack) => importedIds.has(paperPack?.id));
}

async function createImportDiagnostic(paperPacks, diagnosticContext = null) {
  if (!diagnosticContext && !isImportDiagnosticEnabled()) {
    return null;
  }

  const diagnostic = {
    reportVersion: 2,
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
  checkpointImportDiagnostic(diagnostic, "checking-embedded-images");

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
          entry.decodedByteLength = await decodeBase64LengthInChunks(pattern.imageSrc, match[0].length);
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
      diagnostic.progress.imagesChecked = diagnostic.images.length;
      checkpointImportDiagnostic(diagnostic, "checking-embedded-images");
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
  const summary = createDiagnosticSummary(diagnostic);

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

function createDiagnosticSummary(diagnostic, additionalFailures = 0) {
  return {
    imagesReceived: diagnostic.images.length,
    base64StringsDecoded: diagnostic.images.filter((image) => image.base64Decoded).length,
    imagesRenderedBeforeStorage: diagnostic.images.filter((image) => image.renderedBeforeStorage).length,
    imagesMatchedAfterIndexedDbReadBack: diagnostic.images.filter((image) => image.matchedAfterReadBack).length,
    failures: diagnostic.images.reduce((count, image) => count + image.failures.length, 0) +
      diagnostic.storageErrors.filter(
        (error) => !diagnostic.images.some((image) => image.paperPackId === error.paperPackId)
      ).length + additionalFailures
  };
}

function isImportDiagnosticEnabled() {
  return typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get(IMPORT_DIAGNOSTIC_QUERY_PARAMETER) === "1";
}

function isStandaloneDisplayMode() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function loadDiagnosticImage(imageSrc) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => {
      const result = { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
      image.src = "";
      resolve(result);
    }, { once: true });
    image.addEventListener("error", () => reject(new Error("The image element emitted an error event.")), { once: true });
    image.src = imageSrc;
  });
}

async function decodeBase64LengthInChunks(imageSrc, prefixLength) {
  const chunkSize = 32768;
  let decodedByteLength = 0;

  for (let offset = prefixLength; offset < imageSrc.length; offset += chunkSize) {
    decodedByteLength += window.atob(imageSrc.slice(offset, offset + chunkSize)).length;
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  return decodedByteLength;
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

export function validateBackup(backup) {
  if (!backup || backup.app !== "card-supply-catalog") {
    return {
      ok: false,
      message: "This does not look like a Card Supply Catalog backup."
    };
  }

  if (
    !backup.colors ||
    typeof backup.colors !== "object" ||
    Array.isArray(backup.colors) ||
    !Array.isArray(backup.paperPacks) ||
    (backup.cards !== undefined && !Array.isArray(backup.cards))
  ) {
    return {
      ok: false,
      message: "The backup is missing colors or paper packs."
    };
  }

  if (
    backup.tagVocabularies !== undefined &&
    (
      !backup.tagVocabularies ||
      typeof backup.tagVocabularies !== "object" ||
      Array.isArray(backup.tagVocabularies) ||
      !Array.isArray(backup.tagVocabularies.paper) ||
      !Array.isArray(backup.tagVocabularies.card) ||
      backup.tagVocabularies.paper.some((tag) => typeof tag !== "string") ||
      backup.tagVocabularies.card.some((tag) => typeof tag !== "string")
    )
  ) {
    return {
      ok: false,
      message: "Nothing was imported because the tag vocabularies are invalid."
    };
  }

  if (
    backup.owners !== undefined &&
    (!Array.isArray(backup.owners) || backup.owners.some((owner) => !isOwner(owner)))
  ) {
    return {
      ok: false,
      message: "Nothing was imported because the owner registry is invalid."
    };
  }

  const colors = Object.values(backup.colors);
  const cards = backup.cards || [];
  const recordCollections = [
    { label: "color", records: colors, validator: isColor },
    { label: "paper pack", records: backup.paperPacks, validator: isCompatiblePaperPack },
    { label: "Card", records: cards, validator: isCard }
  ];

  for (const { label, records, validator } of recordCollections) {
    const invalidIndex = records.findIndex((record) => !validator(record));

    if (invalidIndex !== -1) {
      return {
        ok: false,
        message: `Nothing was imported because ${label} record ${invalidIndex + 1} is invalid.`
      };
    }

    const duplicateId = findDuplicateRecordId(records);

    if (duplicateId) {
      return {
        ok: false,
        message: `Nothing was imported because the backup contains duplicate ${label} ID "${duplicateId}".`
      };
    }
  }

  for (const [colorId, color] of Object.entries(backup.colors)) {
    if (color.id !== colorId) {
      return {
        ok: false,
        message: `Nothing was imported because color key "${colorId}" does not match its record ID.`
      };
    }
  }

  const owners = Array.isArray(backup.owners) ? backup.owners : [];
  const duplicateOwnerId = findDuplicateRecordId(owners);
  if (duplicateOwnerId) {
    return { ok: false, message: `Nothing was imported because the backup contains duplicate owner ID "${duplicateOwnerId}".` };
  }
  if (owners.length > 0) {
    const ownerIds = new Set(owners.map((owner) => owner.id));
    const invalidOwnerReference = backup.paperPacks.find((paperPack) => paperPack.ownerId && !ownerIds.has(paperPack.ownerId));
    if (invalidOwnerReference) {
      return { ok: false, message: `Nothing was imported because paper pack "${invalidOwnerReference.id}" references an unknown owner.` };
    }
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
    ...cloneJsonSafe(serializePaperPackOwner(paperPack)),
    patterns: (paperPack.patterns || []).map(createSerializablePattern)
  });
}

function createSerializableCard(card) {
  const {
    selectedImage,
    imagePreviewSrc,
    imageThumbnailSrc,
    ...serializableCard
  } = card || {};

  return addCatalogSchemaVersion(cloneJsonSafe(serializableCard));
}

async function createSerializableCardWithCompressedImage(card) {
  const serializableCard = createSerializableCard(card);
  const imageSource = getCardDetailImageSource(card);
  const hadFolderImage = Boolean(card?.imagePath);
  let compressedImageSrc = "";

  if (imageSource) {
    try {
      compressedImageSrc = await compressImageSource(imageSource);
    } catch (error) {
      compressedImageSrc = "";
    }
  }

  if (!compressedImageSrc) {
    return {
      card: serializableCard,
      embeddedImages: serializableCard.imageSrc ? 1 : 0,
      compressedImages: 0,
      missingImages: hadFolderImage ? 1 : 0,
      folderImageReferences: hadFolderImage ? 1 : 0
    };
  }

  const {
    imagePath,
    thumbnailImagePath,
    imageLibrary,
    thumbnailImageSrc,
    ...cardWithoutFolderImage
  } = serializableCard;

  return {
    card: {
      ...cardWithoutFolderImage,
      imageSrc: compressedImageSrc,
      imageStorageStrategy: "embedded-compressed-image"
    },
    embeddedImages: 1,
    compressedImages: 1,
    missingImages: 0,
    folderImageReferences: hadFolderImage ? 1 : 0
  };
}

function findDuplicateRecordId(records) {
  const seenIds = new Set();

  for (const record of records) {
    if (seenIds.has(record.id)) {
      return record.id;
    }

    seenIds.add(record.id);
  }

  return "";
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
      ...cloneJsonSafe(serializePaperPackOwner(paperPack)),
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
  const { width, height } = getScaledImageSize(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
    IPAD_BACKUP_COMPRESSION.maxDimension
  );
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context || width === 0 || height === 0) {
    return "";
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);
  const compressedImage = canvas.toDataURL(IPAD_BACKUP_COMPRESSION.format, IPAD_BACKUP_COMPRESSION.quality);
  image.src = "";
  canvas.width = 1;
  canvas.height = 1;
  return compressedImage;
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
    createSummaryItem("Existing packs skipped", summary.packsSkipped || 0),
    createSummaryItem("Colors imported", summary.colorsImported),
    createSummaryItem("Existing colors skipped", summary.colorsSkipped || 0),
    createSummaryItem("Cards imported", summary.cardsImported || 0),
    createSummaryItem("Existing Cards skipped", summary.cardsSkipped || 0),
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
