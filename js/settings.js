import { checkImageLibraryHealth, migratePaperPackImagesToLocalFolder } from "./images.js";
import { loadCatalogSetting, saveCatalogSetting, savePaperPack } from "./storage.js";

const IMAGE_LIBRARY_SETTING_ID = "imageLibrary";
const LAST_BACKUP_EXPORT_SETTING_ID = "lastBackupExportedAt";
const LAST_BACKUP_IMPORT_SETTING_ID = "lastBackupImportedAt";

export function initializeSettings(options = {}) {
  initializeSetupStatus(options);
  initializeImageLibrarySettings(options);
}

function initializeSetupStatus({ paperPacks = [] } = {}) {
  const container = document.querySelector("[data-setup-status]");

  if (!container) {
    return;
  }

  renderSetupStatus(container, paperPacks);

  document.addEventListener("catalog:backup-exported", () => renderSetupStatus(container, paperPacks));
  document.addEventListener("catalog:backup-imported", () => renderSetupStatus(container, paperPacks));
}

async function initializeImageLibrarySettings({ paperPacks = [], onImageLibrarySelected, onImagesMigrated } = {}) {
  const chooseButton = document.querySelector("[data-choose-image-library]");
  const reconnectButton = document.querySelector("[data-reconnect-image-library]");
  const checkButton = document.querySelector("[data-check-image-library]");
  const migrateButton = document.querySelector("[data-migrate-image-library]");
  const status = document.querySelector("[data-image-library-status]");
  const health = document.querySelector("[data-image-library-health]");

  if (!chooseButton || !status) {
    return;
  }

  if (!isDirectoryPickerSupported()) {
    chooseButton.disabled = true;
    if (reconnectButton) {
      reconnectButton.disabled = true;
    }
    if (checkButton) {
      checkButton.disabled = true;
    }
    if (migrateButton) {
      migrateButton.disabled = true;
    }
    renderImageLibraryStatus(
      status,
      "Image folder selection is not supported in this browser. IndexedDB will remain the fallback for now.",
      "error"
    );
    return;
  }

  await renderSavedImageLibraryStatus(status);

  chooseButton.addEventListener("click", async () => {
    await selectImageLibraryFolder({
      paperPacks,
      status,
      health,
      onImageLibrarySelected,
      successPrefix: "Image folder selected"
    });
  });

  reconnectButton?.addEventListener("click", async () => {
    const selected = await selectImageLibraryFolder({
      paperPacks,
      status,
      health,
      onImageLibrarySelected,
      successPrefix: "Image folder reconnected"
    });

    if (selected) {
      await checkImageLibraryReferences({
        button: reconnectButton,
        health,
        paperPacks,
        status,
        checkingMessage: "Checking image library after reconnect..."
      });
      renderSetupStatus(document.querySelector("[data-setup-status]"), paperPacks);
    }
  });

  checkButton?.addEventListener("click", async () => {
    await checkImageLibraryReferences({
      button: checkButton,
      health,
      paperPacks,
      status,
      checkingMessage: "Checking image library references..."
    });
    renderSetupStatus(document.querySelector("[data-setup-status]"), paperPacks);
  });

  migrateButton?.addEventListener("click", async () => {
    migrateButton.disabled = true;
    renderImageLibraryStatus(status, "Migrating embedded images into the selected folder...", "");

    try {
      const summary = await migrateEmbeddedImages(paperPacks);

      onImagesMigrated?.();
      renderImageLibraryStatus(status, formatMigrationSummary(summary), summary.errors.length > 0 ? "error" : "success");
      renderSetupStatus(document.querySelector("[data-setup-status]"), paperPacks);
    } catch (error) {
      renderImageLibraryStatus(status, "Existing images could not be migrated.", "error");
    } finally {
      migrateButton.disabled = false;
    }
  });
}

async function selectImageLibraryFolder({ paperPacks = [], status, health, onImageLibrarySelected, successPrefix }) {
  try {
    const directoryHandle = await window.showDirectoryPicker({
      id: "csc-image-library",
      mode: "readwrite"
    });

    await saveCatalogSetting(IMAGE_LIBRARY_SETTING_ID, {
      strategy: "local-folder",
      directoryHandle,
      selectedAt: new Date().toISOString()
    });

    await onImageLibrarySelected?.();
    renderImageLibraryStatus(status, getSelectedImageLibraryMessage(directoryHandle, successPrefix), "success");
    renderImageLibraryHealth(health, null);
    renderSetupStatus(document.querySelector("[data-setup-status]"), paperPacks);

    return true;
  } catch (error) {
    if (error?.name === "AbortError") {
      renderImageLibraryStatus(status, "Image folder selection was cancelled.", "");
      return false;
    }

    renderImageLibraryStatus(status, getFolderSelectionErrorMessage(error), "error");
    return false;
  }
}

async function renderSetupStatus(container, paperPacks = []) {
  if (!container) {
    return;
  }

  const [imageLibrary, lastBackupExportedAt, lastBackupImportedAt] = await Promise.all([
    loadCatalogSetting(IMAGE_LIBRARY_SETTING_ID),
    loadCatalogSetting(LAST_BACKUP_EXPORT_SETTING_ID),
    loadCatalogSetting(LAST_BACKUP_IMPORT_SETTING_ID)
  ]);
  const directoryHandle = imageLibrary?.directoryHandle;
  const folderPermission = directoryHandle ? await getDirectoryPermissionState(directoryHandle) : "";
  const imageHealth =
    directoryHandle && folderPermission === "granted" ? await checkImageLibraryHealth(paperPacks).catch(() => null) : null;
  const folderImages = imageHealth?.summary.folderImages ?? countFolderImageReferences(paperPacks);
  const missingImages = imageHealth?.summary.imagesMissing ?? 0;
  const imageReferencesChecked = Boolean(imageHealth);

  container.replaceChildren(
    createSetupStatusItem({
      title: "Catalog data",
      detail: paperPacks.length > 0 ? `${paperPacks.length} paper pack${paperPacks.length === 1 ? "" : "s"} loaded.` : "No paper packs are loaded yet.",
      badge: paperPacks.length > 0 ? "Ready" : "Needs data",
      status: paperPacks.length > 0 ? "ready" : "attention"
    }),
    createSetupStatusItem({
      title: "Catalog backup",
      detail: getBackupStatusDetail(lastBackupExportedAt, lastBackupImportedAt),
      badge: lastBackupExportedAt ? "Exported" : "Reminder",
      status: lastBackupExportedAt ? "ready" : "neutral"
    }),
    createSetupStatusItem({
      title: "Image folder",
      detail: getImageFolderStatusDetail(directoryHandle, folderPermission),
      badge: getImageFolderStatusBadge(directoryHandle, folderPermission),
      status: getImageFolderStatusTone(directoryHandle, folderPermission)
    }),
    createSetupStatusItem({
      title: "Image references",
      detail: getImageReferenceStatusDetail(folderImages, missingImages, imageReferencesChecked, Boolean(directoryHandle)),
      badge: getImageReferenceStatusBadge(folderImages, missingImages, imageReferencesChecked),
      status: getImageReferenceStatusTone(missingImages, imageReferencesChecked)
    })
  );
}

function createSetupStatusItem({ title, detail, badge, status }) {
  const item = document.createElement("div");
  const text = document.createElement("div");
  const titleElement = document.createElement("strong");
  const detailElement = document.createElement("span");
  const badgeElement = document.createElement("span");

  item.className = "setup-status-item";
  item.dataset.status = status;
  titleElement.textContent = title;
  detailElement.textContent = detail;
  badgeElement.className = "setup-status-badge";
  badgeElement.textContent = badge;
  text.append(titleElement, detailElement);
  item.append(text, badgeElement);

  return item;
}

function getBackupStatusDetail(lastBackupExportedAt, lastBackupImportedAt) {
  if (lastBackupExportedAt) {
    return `Last export: ${formatDateTime(lastBackupExportedAt)}.`;
  }

  if (lastBackupImportedAt) {
    return `Last import: ${formatDateTime(lastBackupImportedAt)}. Export a fresh backup after making changes.`;
  }

  return "Export a backup after setup or after cataloging several packs.";
}

function getImageFolderStatusDetail(directoryHandle, permissionState) {
  if (!isDirectoryPickerSupported()) {
    return "This browser does not support choosing an image library folder.";
  }

  if (!directoryHandle) {
    return "No image folder selected. Images will use fallback browser storage.";
  }

  if (permissionState === "granted") {
    return `Selected folder: ${directoryHandle.name}.`;
  }

  return `Saved folder: ${directoryHandle.name}. Reconnect may be needed before images can be read.`;
}

function getImageFolderStatusBadge(directoryHandle, permissionState) {
  if (!isDirectoryPickerSupported()) {
    return "Unsupported";
  }

  if (!directoryHandle) {
    return "Optional";
  }

  return permissionState === "granted" ? "Ready" : "Reconnect";
}

function getImageFolderStatusTone(directoryHandle, permissionState) {
  if (!isDirectoryPickerSupported()) {
    return "attention";
  }

  if (!directoryHandle) {
    return "neutral";
  }

  return permissionState === "granted" ? "ready" : "attention";
}

function getImageReferenceStatusDetail(folderImages, missingImages, wasChecked, hasDirectoryHandle) {
  if (folderImages === 0) {
    return "No folder-backed image references found yet.";
  }

  if (!wasChecked) {
    return hasDirectoryHandle
      ? `Reconnect or check the image folder to verify ${folderImages} folder image reference${folderImages === 1 ? "" : "s"}.`
      : `${folderImages} folder image reference${folderImages === 1 ? "" : "s"} need an image folder connection.`;
  }

  if (missingImages > 0) {
    return `${missingImages} of ${folderImages} folder image reference${folderImages === 1 ? "" : "s"} need attention.`;
  }

  return `${folderImages} folder image reference${folderImages === 1 ? "" : "s"} found.`;
}

function getImageReferenceStatusBadge(folderImages, missingImages, wasChecked) {
  if (folderImages === 0) {
    return "OK";
  }

  if (!wasChecked) {
    return "Verify";
  }

  return missingImages > 0 ? "Check needed" : "OK";
}

function getImageReferenceStatusTone(missingImages, wasChecked) {
  if (!wasChecked) {
    return "neutral";
  }

  return missingImages > 0 ? "attention" : "ready";
}

function countFolderImageReferences(paperPacks) {
  return paperPacks.reduce(
    (total, paperPack) =>
      total +
      (paperPack.patterns || []).filter((pattern) => pattern && typeof pattern === "object" && pattern.imagePath).length,
    0
  );
}

function formatDateTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

async function checkImageLibraryReferences({ button, health, paperPacks, status, checkingMessage }) {
  if (button) {
    button.disabled = true;
  }

  renderImageLibraryStatus(status, checkingMessage, "");

  try {
    const result = await checkImageLibraryHealth(paperPacks);

    renderImageLibraryStatus(
      status,
      formatHealthStatus(result),
      result.summary.imagesMissing > 0 || result.needsFolder ? "error" : "success"
    );
    renderImageLibraryHealth(health, result.summary);
  } catch (error) {
    renderImageLibraryStatus(status, "Image library references could not be checked.", "error");
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

function formatHealthStatus(result) {
  const { summary } = result;

  if (result.needsFolder) {
    return "Image folder permission is needed before folder-backed images can be checked.";
  }

  if (summary.folderImages === 0) {
    return "No folder-backed images found yet. Current images are still using fallback storage or placeholders.";
  }

  if (summary.imagesMissing > 0) {
    return `${summary.imagesFound} of ${summary.folderImages} folder image${summary.folderImages === 1 ? "" : "s"} found.`;
  }

  return `${summary.imagesFound} folder image${summary.imagesFound === 1 ? "" : "s"} found. No missing folder images.`;
}

function renderImageLibraryHealth(container, summary) {
  if (!container) {
    return;
  }

  if (!summary) {
    container.replaceChildren();
    return;
  }

  const overview = document.createElement("ul");
  overview.className = "image-library-health-list";

  overview.append(
    createHealthItem("Packs checked", summary.packsChecked),
    createHealthItem("Folder images", summary.folderImages),
    createHealthItem("Images found", summary.imagesFound),
    createHealthItem("Missing images", summary.imagesMissing),
    createHealthItem("Fallback images", summary.embeddedImages)
  );

  const children = [overview];

  if (summary.missingImages.length > 0) {
    const missing = document.createElement("div");
    missing.className = "image-library-missing";

    const title = document.createElement("p");
    title.textContent = "Missing references";

    const list = document.createElement("ul");
    list.className = "image-library-missing-list";

    for (const missingImage of summary.missingImages.slice(0, 5)) {
      const item = document.createElement("li");
      item.textContent = `${missingImage.packName}: ${missingImage.imagePath || missingImage.patternName}`;
      list.append(item);
    }

    if (summary.missingImages.length > 5) {
      const item = document.createElement("li");
      item.textContent = `${summary.missingImages.length - 5} more missing image reference${summary.missingImages.length - 5 === 1 ? "" : "s"}.`;
      list.append(item);
    }

    missing.append(title, list);
    children.push(missing);
  }

  container.replaceChildren(...children);
}

function createHealthItem(label, value) {
  const item = document.createElement("li");
  const labelElement = document.createElement("span");
  const valueElement = document.createElement("strong");

  labelElement.textContent = label;
  valueElement.textContent = value;
  item.append(labelElement, valueElement);

  return item;
}

async function migrateEmbeddedImages(paperPacks) {
  const summary = {
    packsMigrated: 0,
    imagesMigrated: 0,
    warnings: [],
    errors: []
  };

  for (const paperPack of paperPacks) {
    if (!hasEmbeddedImages(paperPack)) {
      continue;
    }

    const result = await migratePaperPackImagesToLocalFolder(paperPack);

    if (!result.ok) {
      summary.warnings.push(result.warning);
      break;
    }

    await savePaperPack(result.paperPack);
    replacePaperPack(paperPacks, result.paperPack);
    summary.packsMigrated += 1;
    summary.imagesMigrated += result.imagesMigrated;
  }

  return summary;
}

function hasEmbeddedImages(paperPack) {
  return (paperPack.patterns || []).some((pattern) => pattern && typeof pattern === "object" && pattern.imageSrc);
}

function replacePaperPack(paperPacks, paperPack) {
  const existingIndex = paperPacks.findIndex((existingPack) => existingPack.id === paperPack.id);

  if (existingIndex !== -1) {
    paperPacks.splice(existingIndex, 1, paperPack);
  }
}

function formatMigrationSummary(summary) {
  const parts = [
    `${summary.imagesMigrated} image${summary.imagesMigrated === 1 ? "" : "s"} migrated`,
    `${summary.packsMigrated} pack${summary.packsMigrated === 1 ? "" : "s"} updated`
  ];

  if (summary.warnings.length > 0) {
    parts.push(`Warning: ${summary.warnings[0]}`);
  }

  if (summary.errors.length > 0) {
    parts.push(`Error: ${summary.errors[0]}`);
  }

  return parts.join(". ");
}

async function renderSavedImageLibraryStatus(status) {
  const savedImageLibrary = await loadCatalogSetting(IMAGE_LIBRARY_SETTING_ID);
  const directoryHandle = savedImageLibrary?.directoryHandle;

  if (!directoryHandle) {
    renderImageLibraryStatus(status, "No image folder selected yet. Current images still use the prototype storage.", "");
    return;
  }

  const permissionState = await getDirectoryPermissionState(directoryHandle);

  if (permissionState === "granted") {
    renderImageLibraryStatus(
      status,
      getSelectedImageLibraryMessage(directoryHandle),
      "success"
    );
    return;
  }

  renderImageLibraryStatus(
    status,
    `Image folder saved: ${directoryHandle.name}. Permission may need to be granted again before use.`,
    ""
  );
}

function getFolderSelectionErrorMessage(error) {
  if (error?.name === "SecurityError") {
    return "The browser blocked folder selection. Try again from the Settings button.";
  }

  if (error?.name === "NotAllowedError") {
    return "Folder permission was not granted. Choose the folder again and allow access.";
  }

  return `The image folder could not be selected${error?.name ? ` (${error.name})` : ""}.`;
}

function getSelectedImageLibraryMessage(directoryHandle, prefix = "Image folder selected") {
  return `${prefix}: ${directoryHandle.name}. Full local paths are hidden by the browser, but DSP images can be read from this folder.`;
}

function isDirectoryPickerSupported() {
  return "showDirectoryPicker" in window;
}

async function getDirectoryPermissionState(directoryHandle) {
  if (!directoryHandle?.queryPermission) {
    return "unknown";
  }

  try {
    return await directoryHandle.queryPermission({ mode: "readwrite" });
  } catch (error) {
    return "unknown";
  }
}

function renderImageLibraryStatus(status, text, tone) {
  status.textContent = text;
  status.dataset.tone = tone;
}
