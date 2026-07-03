export function initializeAddDspWorkflow(colorsById) {
  const panel = document.querySelector("[data-add-dsp-panel]");
  const form = document.querySelector("[data-add-dsp-form]");
  const message = document.querySelector("[data-add-dsp-message]");
  const openButtons = [...document.querySelectorAll("[data-add-dsp-open]")];
  const closeButtons = [...document.querySelectorAll("[data-add-dsp-close]")];

  if (!panel || !form) {
    return;
  }

  for (const button of openButtons) {
    button.addEventListener("click", () => openAddDspPanel(panel));
  }

  for (const button of closeButtons) {
    button.addEventListener("click", () => closeAddDspPanel(panel, form, message));
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const result = buildPaperPackFromForm(new FormData(form), colorsById);

    if (!result.ok) {
      renderFormMessage(message, result.message, "error");
      return;
    }

    document.dispatchEvent(
      new CustomEvent("paper-pack:add", {
        detail: {
          paperPack: result.paperPack
        }
      })
    );

    renderFormMessage(message, `${result.paperPack.name} was saved.`, "success");
    form.reset();
    closeAddDspPanel(panel, form, message);
    window.location.hash = "library";
  });
}

function openAddDspPanel(panel) {
  panel.hidden = false;
  panel.querySelector("input, select, textarea, button")?.focus();
}

function closeAddDspPanel(panel, form, message) {
  panel.hidden = true;
  form?.reset();
  renderFormMessage(message, "", "");
}

function buildPaperPackFromForm(formData, colorsById) {
  const name = cleanText(formData.get("name"));
  const owner = cleanText(formData.get("owner"));
  const releaseYear = Number.parseInt(formData.get("releaseYear"), 10);
  const patternCount = Number.parseInt(formData.get("patternCount"), 10);
  const patterns = createPatternSlots(patternCount);
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

  return {
    ok: true,
    paperPack: {
      id: createId(name),
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

function createPatternSlots(patternCount) {
  return Array.from({ length: patternCount }, (_, index) => `pattern-${index + 1}`);
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

function renderFormMessage(message, text, tone) {
  if (!message) {
    return;
  }

  message.textContent = text;
  message.dataset.tone = tone;
}
