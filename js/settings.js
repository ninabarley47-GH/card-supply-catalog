import { migratePaperPackImagesToLocalFolder } from "./images.js";
import { loadCatalogSetting, saveCatalogSetting, savePaperPack } from "./storage.js";

const IMAGE_LIBRARY_SETTING_ID = "imageLibrary";

export function initializeSettings(options = {}) {
  initializeImageLibrarySettings(options);
}

async function initializeImageLibrarySettings({ paperPacks = [], onImagesMigrated } = {}) {
  const chooseButton = document.querySelector("[data-choose-image-library]");
  const migrateButton = document.querySelector("[data-migrate-image-library]");
  const status = document.querySelector("[data-image-library-status]");

  if (!chooseButton || !status) {
    return;
  }

  if (!isDirectoryPickerSupported()) {
    chooseButton.disabled = true;
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

      renderImageLibraryStatus(
        status,
        getSelectedImageLibraryMessage(directoryHandle),
        "success"
      );
    } catch (error) {
      if (error?.name === "AbortError") {
        renderImageLibraryStatus(status, "Image folder selection was cancelled.", "");
        return;
      }

      renderImageLibraryStatus(status, getFolderSelectionErrorMessage(error), "error");
    }
  });

  migrateButton?.addEventListener("click", async () => {
    migrateButton.disabled = true;
    renderImageLibraryStatus(status, "Migrating embedded images into the selected folder...", "");

    try {
      const summary = await migrateEmbeddedImages(paperPacks);

      onImagesMigrated?.();
      renderImageLibraryStatus(status, formatMigrationSummary(summary), summary.errors.length > 0 ? "error" : "success");
    } catch (error) {
      renderImageLibraryStatus(status, "Existing images could not be migrated.", "error");
    } finally {
      migrateButton.disabled = false;
    }
  });
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

function getSelectedImageLibraryMessage(directoryHandle) {
  return `Image folder selected: ${directoryHandle.name}. Full local paths are hidden by the browser, but newly saved DSP images will be stored in this folder.`;
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
