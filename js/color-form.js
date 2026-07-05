import { saveColor } from "./storage.js";

const FAMILY_OPTIONS = [
  "in-color",
  "neutrals",
  "brights",
  "subtles",
  "regals",
  "basics",
  "retired",
  "unknown"
];

const COLOR_FAMILY_OPTIONS = [
  "red",
  "orange",
  "yellow",
  "yellow-green",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "brown",
  "neutral",
  "gray",
  "white",
  "black"
];

export function initializeAddColorWorkflow(colorsById) {
  const panel = document.querySelector("[data-add-color-panel]");
  const form = document.querySelector("[data-add-color-form]");
  const message = document.querySelector("[data-add-color-message]");
  const title = document.querySelector("[data-add-color-title]");
  const summary = document.querySelector("[data-add-color-summary]");
  const idPreview = document.querySelector("[data-color-id-preview]");
  const swatchPreview = document.querySelector("[data-color-swatch-preview]");
  const openButtons = [...document.querySelectorAll("[data-add-color-open]")];
  const closeButtons = [...document.querySelectorAll("[data-add-color-close]")];
  const formState = {
    source: "settings"
  };

  if (!panel || !form) {
    return;
  }

  for (const button of openButtons) {
    button.addEventListener("click", () => {
      openColorPanel(panel, form, message, idPreview, swatchPreview, title, summary, formState);
    });
  }

  for (const button of closeButtons) {
    button.addEventListener("click", () => {
      closeColorPanel(panel, form, message, idPreview, swatchPreview, formState);
    });
  }

  document.addEventListener("color:add-request", (event) => {
    openColorPanel(panel, form, message, idPreview, swatchPreview, title, summary, formState, {
      name: event.detail?.colorName || "",
      source: event.detail?.source || "settings"
    });
  });

  form.addEventListener("input", () => {
    updateColorPreview(form, idPreview, swatchPreview);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const result = buildColorFromForm(new FormData(form), colorsById);

    if (!result.ok) {
      renderColorMessage(message, result.message, "error");
      return;
    }

    saveColor(result.color)
      .then(() => {
        colorsById[result.color.id] = result.color;
        document.dispatchEvent(
          new CustomEvent("color:saved", {
            detail: {
              color: result.color,
              source: formState.source
            }
          })
        );
        closeColorPanel(panel, form, message, idPreview, swatchPreview, formState);
      })
      .catch(() => {
        renderColorMessage(message, "The color could not be saved in this browser.", "error");
      });
  });
}

function openColorPanel(panel, form, message, idPreview, swatchPreview, title, summary, formState, options = {}) {
  form.reset();
  formState.source = options.source || "settings";
  renderColorMessage(message, "", "");

  if (title) {
    title.textContent = "Add Color";
  }

  if (summary) {
    summary.textContent =
      formState.source === "add-dsp"
        ? "Add this missing color, then continue saving the paper pack."
        : "Add an official color for paper pack metadata.";
  }

  if (options.name) {
    form.elements.name.value = options.name;
  }

  form.elements.family.value = "unknown";
  form.elements.colorFamily.value = "neutral";
  form.elements.status.value = "active";
  form.elements.productCardstock.value = "";
  form.elements.productInk.value = "";
  form.elements.productDsp.value = "";
  form.elements.productMarker.value = "";
  form.elements.productBlend.value = "";

  updateColorPreview(form, idPreview, swatchPreview);
  panel.hidden = false;
  panel.querySelector("input, select, textarea, button")?.focus();
}

function closeColorPanel(panel, form, message, idPreview, swatchPreview, formState) {
  panel.hidden = true;
  form.reset();
  formState.source = "settings";
  renderColorMessage(message, "", "");
  updateColorPreview(form, idPreview, swatchPreview);
}

function buildColorFromForm(formData, colorsById) {
  const name = cleanText(formData.get("name"));
  const id = createId(name);
  const hex = normalizeHex(formData.get("hex"));
  const family = cleanText(formData.get("family"));
  const colorFamily = cleanText(formData.get("colorFamily"));
  const status = cleanText(formData.get("status"));

  if (!name || !id || !hex || !family || !colorFamily || !status) {
    return {
      ok: false,
      message: "Name, HEX, collection, color family, and status are required."
    };
  }

  if (!FAMILY_OPTIONS.includes(family) || !COLOR_FAMILY_OPTIONS.includes(colorFamily)) {
    return {
      ok: false,
      message: "Choose a valid collection and color family."
    };
  }

  if (colorsById[id]) {
    return {
      ok: false,
      message: `${colorsById[id].name} already exists in the color catalog.`
    };
  }

  return {
    ok: true,
    color: {
      id,
      name,
      hex,
      rgb: hexToRgb(hex),
      family,
      colorFamily,
      collectionYears: cleanText(formData.get("collectionYears")),
      status,
      aliases: parseList(formData.get("aliases")),
      products: {
        cardstock: parseOptionalBoolean(formData.get("productCardstock")),
        ink: parseOptionalBoolean(formData.get("productInk")),
        dsp: parseOptionalBoolean(formData.get("productDsp")),
        marker: parseOptionalBoolean(formData.get("productMarker")),
        blend: parseOptionalBoolean(formData.get("productBlend"))
      }
    }
  };
}

function updateColorPreview(form, idPreview, swatchPreview) {
  const id = createId(form?.elements.name?.value || "");
  const hex = normalizeHex(form?.elements.hex?.value || "");

  if (idPreview) {
    idPreview.textContent = id ? `Color ID: ${id}` : "Color ID will be generated from the name.";
  }

  if (swatchPreview) {
    swatchPreview.style.backgroundColor = hex || "transparent";
    swatchPreview.textContent = hex || "Preview";
  }
}

function normalizeHex(value) {
  const hex = cleanText(value).toUpperCase();
  const fullHex = hex.startsWith("#") ? hex : `#${hex}`;

  return /^#[0-9A-F]{6}$/.test(fullHex) ? fullHex : "";
}

function hexToRgb(hex) {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
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

function createId(name) {
  return cleanText(name)
    .toLowerCase()
    .replace(/\s+/g, "-")
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

function renderColorMessage(message, text, tone) {
  if (!message) {
    return;
  }

  message.textContent = text;
  message.dataset.tone = tone;
}
