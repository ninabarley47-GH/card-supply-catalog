import { loadCatalogSetting, saveCatalogSetting } from "./storage.js";

const IMAGE_LIBRARY_SETTING_ID = "imageLibrary";

export function initializeSettings() {
  initializeImageLibrarySettings();
}

async function initializeImageLibrarySettings() {
  const chooseButton = document.querySelector("[data-choose-image-library]");
  const status = document.querySelector("[data-image-library-status]");

  if (!chooseButton || !status) {
    return;
  }

  if (!isDirectoryPickerSupported()) {
    chooseButton.disabled = true;
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
