import { checkImageLibraryHealth, migratePaperPackImagesToLocalFolder } from "./images.js";
import { loadCatalogSetting, saveCatalogSetting, savePaperPack } from "./storage.js";

const IMAGE_LIBRARY_SETTING_ID = "imageLibrary";

export function initializeSettings(options = {}) {
  initializeImageLibrarySettings(options);
}

async function initializeImageLibrarySettings({ paperPacks = [], onImagesMigrated } = {}) {
  const chooseButton = document.querySelector("[data-choose-image-library]");
  const checkButton = document.querySelector("[data-check-image-library]");
  const migrateButton = document.querySelector("[data-migrate-image-library]");
  const status = document.querySelector("[data-image-library-status]");
  const health = document.querySelector("[data-image-library-health]");

  if (!chooseButton || !status) {
    return;
  }

  if (!isDirectoryPickerSupported()) {
    chooseButton.disabled = true;
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
      renderImageLibraryHealth(health, null);
    } catch (error) {
      if (error?.name === "AbortError") {
        renderImageLibraryStatus(status, "Image folder selection was cancelled.", "");
        return;
      }

      renderImageLibraryStatus(status, getFolderSelectionErrorMessage(error), "error");
    }
  });

  checkButton?.addEventListener("click", async () => {
    checkButton.disabled = true;
    renderImageLibraryStatus(status, "Checking image library references...", "");

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
      checkButton.disabled = false;
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
