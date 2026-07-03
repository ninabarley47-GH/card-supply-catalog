export function initializeAddDspWorkflow(colorsById) {
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
  const imagePreviewList = document.querySelector("[data-image-preview-list]");
  const imagePreviewCount = document.querySelector("[data-image-preview-count]");
  const selectedImages = [];
  const formState = {
    editingPaperPack: null
  };

  if (!panel || !form) {
    return;
  }

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

  if (imagePreviewList) {
    imagePreviewList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-image-action]");

      if (!button) {
        return;
      }

      updateSelectedImageOrder(selectedImages, button.dataset.imageAction, Number(button.dataset.imageIndex));
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
      renderFormMessage(message, result.message, "error");
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
      message: `Unknown color: ${colorResult.missing.join(", ")}`
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
    paperPack: {
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
    }
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

  for (const option of form.elements.keywords.options) {
    option.selected = keywords.has(option.value) || keywords.has(option.textContent);
  }
}

async function addSelectedImageFiles(files, selectedImages) {
  const imageFiles = files.filter((file) => file.type.startsWith("image/"));
  const imageEntries = await Promise.all(imageFiles.map(readImageFile));

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

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      resolve({
        id: createId(file.name.replace(/\.[^.]+$/, "")) || `image-${Date.now()}`,
        name: file.name,
        src: reader.result
      });
    });

    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
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

function renderImagePreviews(selectedImages, imagePreviewList, imagePreviewCount) {
  if (!imagePreviewList) {
    return;
  }

  imagePreviewList.replaceChildren(
    ...selectedImages.map((image, index) => {
      const item = document.createElement("li");
      item.className = "image-preview-item";

      const preview = document.createElement("img");
      preview.src = image.src;
      preview.alt = image.name;

      const name = document.createElement("span");
      name.className = "image-preview-name";
      name.textContent = image.name;

      const controls = document.createElement("div");
      controls.className = "image-preview-controls";

      const moveUp = createImageActionButton("move-up", index, "Up", index === 0);
      const moveDown = createImageActionButton("move-down", index, "Down", index === selectedImages.length - 1);
      const remove = createImageActionButton("remove", index, "Remove", false);

      controls.append(moveUp, moveDown, remove);
      item.append(preview, name, controls);

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

function createPatternSlots(patternCount, selectedImages = [], existingPatterns = []) {
  return Array.from({ length: patternCount }, (_, index) => {
    const selectedImage = selectedImages[index];

    if (selectedImage) {
      return {
        id: `pattern-${index + 1}`,
        imageName: selectedImage.name,
        imageSrc: selectedImage.src
      };
    }

    const existingPattern = existingPatterns[index];

    if (existingPattern && (typeof existingPattern !== "object" || !existingPattern.imageSrc)) {
      return existingPattern;
    }

    return `pattern-${index + 1}`;
  });
}

function getImageEntriesFromPatterns(patterns = []) {
  return patterns
    .filter((pattern) => pattern && typeof pattern === "object" && pattern.imageSrc)
    .map((pattern) => ({
      id: pattern.id,
      name: pattern.imageName || pattern.id || "Pattern image",
      src: pattern.imageSrc
    }));
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
