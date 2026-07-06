import {
  addPatternImageFiles,
  choosePatternImagesFromLibrary,
  createPatternSlots,
  getImageEntriesFromPatterns
} from "./images.js";
import { addCatalogSchemaVersion } from "./schema.js";

export function initializeAddDspWorkflow(colorsById, paperPacks = []) {
  const panel = document.querySelector("[data-add-dsp-panel]");
  const form = document.querySelector("[data-add-dsp-form]");
  const message = document.querySelector("[data-add-dsp-message]");
  const title = document.querySelector("[data-add-dsp-title]");
  const summary = document.querySelector("[data-add-dsp-summary]");
  const submitButton = document.querySelector("[data-add-dsp-submit]");
  const openButtons = [...document.querySelectorAll("[data-add-dsp-open]")];
  const closeButtons = [...document.querySelectorAll("[data-add-dsp-close]")];
  const imageInputs = [...document.querySelectorAll("[data-pattern-image-input]")];
  const folderInputs = [...document.querySelectorAll("[data-pattern-folder-input]")];
  const libraryPickerButton = document.querySelector("[data-pattern-library-picker]");
  const imagePreviewList = document.querySelector("[data-image-preview-list]");
  const imagePreviewCount = document.querySelector("[data-image-preview-count]");
  const selectedImages = [];
  const formState = {
    editingPaperPack: null
  };

  if (!panel || !form) {
    return;
  }

  message?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-add-missing-color]");

    if (!button) {
      return;
    }

    panel.hidden = true;

    document.dispatchEvent(
      new CustomEvent("color:add-request", {
        detail: {
          colorName: button.dataset.addMissingColor,
          source: "add-dsp"
        }
      })
    );
  });

  document.addEventListener("color:saved", (event) => {
    if (event.detail?.source === "add-dsp") {
      panel.hidden = false;
      renderFormMessage(message, `${event.detail.color.name} was added. You can continue saving this DSP.`, "success");
    }
  });

  document.addEventListener("color:add-cancelled", (event) => {
    if (event.detail?.source === "add-dsp") {
      panel.hidden = false;
    }
  });

  for (const button of openButtons) {
    button.addEventListener("click", () =>
      openAddDspPanel(panel, form, selectedImages, imagePreviewList, imagePreviewCount, {
        title,
        summary,
        submitButton,
        formState
      })
    );
  }

  for (const button of closeButtons) {
    button.addEventListener("click", () =>
      closeAddDspPanel(panel, form, message, selectedImages, imagePreviewList, imagePreviewCount, {
        title,
        summary,
        submitButton,
        formState
      })
    );
  }

  for (const input of imageInputs) {
    input.addEventListener("change", async () => {
      await addImagesFromInput([...input.files], selectedImages, message);
      input.value = "";
      renderImagePreviews(selectedImages, imagePreviewList, imagePreviewCount);
    });
  }

  for (const input of folderInputs) {
    input.addEventListener("change", async () => {
      const files = [...input.files].sort((a, b) =>
        (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name)
      );

      await addImagesFromInput(files, selectedImages, message);
      input.value = "";
      renderImagePreviews(selectedImages, imagePreviewList, imagePreviewCount);
    });
  }

  libraryPickerButton?.addEventListener("click", async () => {
    const result = await choosePatternImagesFromLibrary();

    if (!result.ok) {
      renderFormMessage(message, result.message, "error");
      return;
    }

    selectedImages.push(...result.images);
    renderImagePreviews(selectedImages, imagePreviewList, imagePreviewCount);
    renderFormMessage(message, getLibraryImageSelectionMessage(result.images), result.images.length > 0 ? "success" : "");
  });

  if (imagePreviewList) {
    imagePreviewList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-image-action]");

      if (!button) {
        return;
      }

      updateSelectedImageOrder(selectedImages, button.dataset.imageAction, Number(button.dataset.imageIndex));
      renderImagePreviews(selectedImages, imagePreviewList, imagePreviewCount);
    });

    imagePreviewList.addEventListener("change", async (event) => {
      const input = event.target.closest("[data-image-replace-input]");

      if (!input) {
        return;
      }

      await replaceSelectedImageFile([...input.files], selectedImages, Number(input.dataset.imageIndex), message);
      input.value = "";
      renderImagePreviews(selectedImages, imagePreviewList, imagePreviewCount);
    });
  }

  document.addEventListener("paper-pack:edit-request", (event) => {
    const paperPack = event.detail?.paperPack;

    if (!paperPack) {
      return;
    }

    openEditDspPanel(panel, form, paperPack, colorsById, selectedImages, imagePreviewList, imagePreviewCount, {
      title,
      summary,
      submitButton,
      formState
    });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const result = buildPaperPackFromForm(
      new FormData(form),
      colorsById,
      selectedImages,
      formState.editingPaperPack
    );

    if (!result.ok) {
      if (result.code === "missing-colors") {
        renderMissingColorMessage(message, result.missing);
      } else {
        renderFormMessage(message, result.message, "error");
      }

      return;
    }

    const duplicateResult = validatePaperPackDuplicate(result.paperPack, paperPacks, formState.editingPaperPack);

    if (!duplicateResult.ok) {
      renderFormMessage(message, duplicateResult.message, "error");
      return;
    }

    if (duplicateResult.requiresConfirmation && !window.confirm(duplicateResult.message)) {
      renderFormMessage(message, "Save cancelled. No catalog changes were made.", "");
      return;
    }

    const saveDetail = {
      paperPack: result.paperPack,
      mode: formState.editingPaperPack ? "edit" : "add"
    };

    document.dispatchEvent(
      new CustomEvent("paper-pack:save", {
        detail: saveDetail
      })
    );

    renderFormMessage(message, `${result.paperPack.name} was saved.`, "success");
    form.reset();
    closeAddDspPanel(panel, form, message, selectedImages, imagePreviewList, imagePreviewCount, {
      title,
      summary,
      submitButton,
      formState
    });
    window.location.hash = "library";

    saveDetail.saveComplete?.then((saveResult) => {
      if (!saveResult.ok) {
        window.alert(saveResult.message);
        return;
      }

      if (saveResult.warning) {
        window.alert(saveResult.warning);
      }
    });
  });
}

function openAddDspPanel(panel, form, selectedImages, imagePreviewList, imagePreviewCount, controls) {
  resetAddDspForm(form, selectedImages, imagePreviewList, imagePreviewCount, controls);
  panel.hidden = false;
  panel.querySelector("input, select, textarea, button")?.focus();
}

function openEditDspPanel(panel, form, paperPack, colorsById, selectedImages, imagePreviewList, imagePreviewCount, controls) {
  resetAddDspForm(form, selectedImages, imagePreviewList, imagePreviewCount, controls);
  controls.formState.editingPaperPack = paperPack;
  controls.title.textContent = "Edit DSP";
  controls.summary.textContent = "Update this Designer Series Paper pack.";
  controls.submitButton.textContent = "Save Changes";

  fillPaperPackForm(form, paperPack, colorsById);
  selectedImages.push(...getImageEntriesFromPatterns(paperPack.patterns));
  renderImagePreviews(selectedImages, imagePreviewList, imagePreviewCount);

  panel.hidden = false;
  panel.querySelector("input, select, textarea, button")?.focus();
}

function closeAddDspPanel(panel, form, message, selectedImages, imagePreviewList, imagePreviewCount, controls) {
  panel.hidden = true;
  resetAddDspForm(form, selectedImages, imagePreviewList, imagePreviewCount, controls);
  renderFormMessage(message, "", "");
}

function resetAddDspForm(form, selectedImages, imagePreviewList, imagePreviewCount, controls) {
  form?.reset();
  selectedImages.splice(0, selectedImages.length);
  renderImagePreviews(selectedImages, imagePreviewList, imagePreviewCount);
  controls.formState.editingPaperPack = null;
  controls.title.textContent = "Add DSP";
  controls.summary.textContent = "Save a new Designer Series Paper pack to this catalog.";
  controls.submitButton.textContent = "Save Paper Pack";
}

function buildPaperPackFromForm(formData, colorsById, selectedImages = [], editingPaperPack = null) {
  const name = cleanText(formData.get("name"));
  const owner = cleanText(formData.get("owner"));
  const releaseYear = Number.parseInt(formData.get("releaseYear"), 10);
  const patternCount = Number.parseInt(formData.get("patternCount"), 10);
  const colorResult = resolveColorIds(parseList(formData.get("colors")), colorsById);
  const keywords = formData.getAll("keywords").map(cleanText).filter(Boolean);

  if (!name || !owner || Number.isNaN(releaseYear) || !Number.isInteger(patternCount) || patternCount < 1) {
    return {
      ok: false,
      message: "Name, owner, release year, and pattern count are required."
    };
  }

  if (colorResult.missing.length > 0) {
    return {
      ok: false,
      code: "missing-colors",
      missing: colorResult.missing,
      message: "One or more colors are missing from the catalog."
    };
  }

  if (colorResult.colorIds.length === 0) {
    return {
      ok: false,
      message: "At least one color is required."
    };
  }

  if (selectedImages.length > patternCount) {
    return {
      ok: false,
      message: "Pattern count must be at least the number of selected images."
    };
  }

  const patterns = createPatternSlots(patternCount, selectedImages, editingPaperPack?.patterns);

  return {
    ok: true,
    paperPack: addCatalogSchemaVersion({
      id: editingPaperPack?.id || createId(name),
      name,
      owner,
      releaseYear,
      patternCount,
      availability: formData.get("availability") || "available",
      refillAvailable: parseOptionalBoolean(formData.get("refillAvailable")),
      keywords,
      colors: colorResult.colorIds,
      patterns
    })
  };
}

function validatePaperPackDuplicate(paperPack, paperPacks, editingPaperPack = null) {
  const normalizedName = normalizeLookupValue(paperPack.name);
  const existingById = paperPacks.find((existingPack) => existingPack.id === paperPack.id);
  const existingByName = paperPacks.find(
    (existingPack) => normalizeLookupValue(existingPack.name) === normalizedName
  );
  const isEditingSamePack = editingPaperPack && existingById?.id === editingPaperPack.id;
  const nameBelongsToSamePack = editingPaperPack && existingByName?.id === editingPaperPack.id;

  if (existingById && !isEditingSamePack) {
    return {
      ok: false,
      requiresConfirmation: false,
      message: `A paper pack with the ID "${paperPack.id}" already exists. Change the DSP name before saving.`
    };
  }

  if (existingByName && !nameBelongsToSamePack) {
    return {
      ok: false,
      requiresConfirmation: false,
      message: `A paper pack named "${paperPack.name}" already exists. Use a unique DSP name before saving.`
    };
  }

  if (editingPaperPack && paperPack.name !== editingPaperPack.name) {
    return {
      ok: true,
      requiresConfirmation: true,
      message: `Save changes to "${editingPaperPack.name}" as "${paperPack.name}"? This updates the existing catalog record.`
    };
  }

  return {
    ok: true,
    requiresConfirmation: false,
    message: ""
  };
}
function fillPaperPackForm(form, paperPack, colorsById) {
  form.elements.name.value = paperPack.name || "";
  form.elements.owner.value = paperPack.owner || "";
  form.elements.releaseYear.value = paperPack.releaseYear || "";
  form.elements.patternCount.value = paperPack.patternCount || 1;
  form.elements.availability.value = paperPack.availability || "available";
  form.elements.refillAvailable.value = formatOptionalBoolean(paperPack.refillAvailable);
  form.elements.colors.value = (paperPack.colors || [])
    .map((colorId) => colorsById[colorId]?.name || colorId)
    .join(", ");

  const keywords = new Set(paperPack.keywords || []);

  for (const keywordInput of form.querySelectorAll('input[name="keywords"]')) {
    keywordInput.checked = keywords.has(keywordInput.value);
  }
}

async function addSelectedImageFiles(files, selectedImages) {
  const imageEntries = await addPatternImageFiles(files);

  selectedImages.push(...imageEntries);
}

async function addImagesFromInput(files, selectedImages, message) {
  try {
    await addSelectedImageFiles(files, selectedImages);
    renderFormMessage(message, "", "");
  } catch (error) {
    renderFormMessage(message, "One or more images could not be loaded.", "error");
  }
}

function updateSelectedImageOrder(selectedImages, action, index) {
  if (!Number.isInteger(index) || index < 0 || index >= selectedImages.length) {
    return;
  }

  if (action === "remove") {
    selectedImages.splice(index, 1);
    return;
  }

  if (action === "move-up" && index > 0) {
    [selectedImages[index - 1], selectedImages[index]] = [selectedImages[index], selectedImages[index - 1]];
    return;
  }

  if (action === "move-down" && index < selectedImages.length - 1) {
    [selectedImages[index], selectedImages[index + 1]] = [selectedImages[index + 1], selectedImages[index]];
  }
}

async function replaceSelectedImageFile(files, selectedImages, index, message) {
  if (!Number.isInteger(index) || index < 0 || index >= selectedImages.length || files.length === 0) {
    return;
  }

  try {
    const [replacement] = await addPatternImageFiles(files);

    if (!replacement) {
      renderFormMessage(message, "Choose an image file to replace this pattern.", "error");
      return;
    }

    selectedImages.splice(index, 1, replacement);
    renderFormMessage(message, "Pattern image replaced. Save changes to update the catalog.", "success");
  } catch (error) {
    renderFormMessage(message, "The replacement image could not be loaded.", "error");
  }
}
function renderImagePreviews(selectedImages, imagePreviewList, imagePreviewCount) {
  if (!imagePreviewList) {
    return;
  }

  imagePreviewList.replaceChildren(
    ...selectedImages.map((image, index) => {
      const item = document.createElement("li");
      item.className = "image-preview-item";

      const preview = createImagePreviewMedia(image, index);

      const details = document.createElement("div");
      details.className = "image-preview-details";

      const name = document.createElement("span");
      name.className = "image-preview-name";
      name.textContent = image.name;

      const storage = document.createElement("span");
      storage.className = "image-preview-storage";
      storage.textContent = getImageStorageLabel(image);

      details.append(name, storage);

      const controls = document.createElement("div");
      controls.className = "image-preview-controls";

      const moveUp = createImageActionButton("move-up", index, "Up", index === 0);
      const moveDown = createImageActionButton("move-down", index, "Down", index === selectedImages.length - 1);
      const replace = createImageReplaceControl(index, image.missing);
      const remove = createImageActionButton("remove", index, "Remove", false);

      controls.append(moveUp, moveDown, replace, remove);
      item.append(preview, details, controls);

      return item;
    })
  );

  if (imagePreviewCount) {
    imagePreviewCount.textContent =
      selectedImages.length === 0
        ? "No pattern images selected."
        : `${selectedImages.length} pattern image${selectedImages.length === 1 ? "" : "s"} selected.`;
  }
}

function createImagePreviewMedia(image, index) {
  if (image.src) {
    const preview = document.createElement("img");
    preview.src = image.src;
    preview.alt = image.name;

    return preview;
  }

  const placeholder = document.createElement("span");
  placeholder.className = "image-preview-placeholder";
  placeholder.textContent = `${index + 1}`;
  placeholder.setAttribute("aria-label", `${image.name} is missing`);

  return placeholder;
}

function getImageStorageLabel(image) {
  if (image.missing) {
    return image.imagePath ? `Missing library image: ${image.imagePath}` : "Missing image";
  }

  return image.imagePath ? "Library image" : "Upload fallback";
}

function createImageReplaceControl(index, isMissing = false) {
  const inputId = `dsp-pattern-replace-${index}`;
  const wrapper = document.createElement("span");
  wrapper.className = "image-replace-control";

  const label = document.createElement("label");
  label.className = `image-preview-button${isMissing ? " image-preview-button-urgent" : ""}`;
  label.htmlFor = inputId;
  label.textContent = isMissing ? "Replace Missing" : "Replace";

  const input = document.createElement("input");
  input.id = inputId;
  input.className = "visually-hidden";
  input.type = "file";
  input.accept = "image/*";
  input.dataset.imageReplaceInput = "";
  input.dataset.imageIndex = `${index}`;

  wrapper.append(label, input);

  return wrapper;
}
function getLibraryImageSelectionMessage(images) {
  if (images.length === 0) {
    return "";
  }

  const fallbackCount = images.filter((image) => image.message).length;

  if (fallbackCount > 0) {
    return `${images.length} image${images.length === 1 ? "" : "s"} selected. ${fallbackCount} will be copied on save because they were outside the image library folder.`;
  }

  return `${images.length} library image${images.length === 1 ? "" : "s"} selected.`;
}

function createImageActionButton(action, index, label, disabled) {
  const button = document.createElement("button");
  button.className = "image-preview-button";
  button.type = "button";
  button.textContent = label;
  button.dataset.imageAction = action;
  button.dataset.imageIndex = `${index}`;
  button.disabled = disabled;

  return button;
}

function resolveColorIds(colorInputs, colorsById) {
  const colorsByName = new Map(
    Object.values(colorsById).map((color) => [normalizeLookupValue(color.name), color.id])
  );
  const colorIds = [];
  const missing = [];

  for (const colorInput of colorInputs) {
    const lookupValue = normalizeLookupValue(colorInput);
    const colorId = colorsById[lookupValue] ? lookupValue : colorsByName.get(lookupValue);

    if (!colorId) {
      missing.push(colorInput);
      continue;
    }

    if (!colorIds.includes(colorId)) {
      colorIds.push(colorId);
    }
  }

  return {
    colorIds,
    missing
  };
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map(cleanText)
    .filter(Boolean);
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeLookupValue(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, "-");
}

function createId(name) {
  return normalizeLookupValue(name)
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseOptionalBoolean(value) {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return null;
}

function formatOptionalBoolean(value) {
  if (value === true) {
    return "true";
  }

  if (value === false) {
    return "false";
  }

  return "";
}

function renderFormMessage(message, text, tone) {
  if (!message) {
    return;
  }

  message.textContent = text;
  message.dataset.tone = tone;
}

function renderMissingColorMessage(message, missingColors) {
  if (!message) {
    return;
  }

  const intro = document.createElement("p");
  intro.textContent =
    missingColors.length === 1
      ? `${missingColors[0]} is not in the color catalog yet. Would you like to add it now?`
      : "Some colors are not in the color catalog yet. Would you like to add them now?";

  const actions = document.createElement("div");
  actions.className = "missing-color-actions";

  actions.append(
    ...missingColors.map((colorName) => {
      const button = document.createElement("button");
      button.className = "button";
      button.type = "button";
      button.dataset.addMissingColor = colorName;
      button.textContent = `Add ${colorName}`;

      return button;
    })
  );

  message.replaceChildren(intro, actions);
  message.dataset.tone = "error";
}
