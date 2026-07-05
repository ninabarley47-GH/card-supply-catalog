import { initializeAddDspWorkflow } from "./add-dsp.js";
import { initializeAddColorWorkflow } from "./color-form.js";
import { createCoverSheetForPack } from "./cover-sheet.js";
import { deletePaperPackImages, getPatternImageSource, preparePaperPackImagesForSave } from "./images.js";
import {
  deletePaperPack,
  loadSavedColors,
  loadSavedPaperPacks,
  mergeColors,
  mergePaperPacks,
  savePaperPack
} from "./storage.js";

const COLOR_FAMILY_ORDER = [
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

const COLOR_FAMILY_LABELS = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  "yellow-green": "Yellow-Green",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
  brown: "Brown",
  neutral: "Neutral",
  gray: "Gray",
  white: "White",
  black: "Black"
};

const PATTERN_CLASS_MAP = {
  confetti: "pattern-confetti",
  dots: "pattern-dots",
  floral: "pattern-floral",
  honey: "pattern-honey",
  linen: "pattern-linen",
  meadow: "pattern-meadow",
  moss: "pattern-moss",
  navy: "pattern-navy",
  rose: "pattern-rose",
  sage: "pattern-sage",
  speckle: "pattern-speckle",
  sprig: "pattern-sprig",
  sky: "pattern-sky",
  stripe: "pattern-stripe"
};

const PATTERN_CLASS_SEQUENCE = Object.values(PATTERN_CLASS_MAP);

const DEFAULT_CATALOG_SESSION_PACK_IDS = ["velvet-meadow", "sunlit-market"];
const CATALOG_SESSION_STORAGE_KEY = "card-supply-catalog.latestCatalogSessionPackIds";
const LATEST_CATALOG_SESSION_PACK_IDS = new Set(loadCatalogSessionPackIds());
let hasUserCatalogSession = hasSavedCatalogSession();

export async function initializeLibraryShell() {
  initializeScreenNavigation();

  const paperPackLibrary = document.querySelector("[data-paper-pack-library]");
  const colorLibrary = document.querySelector("[data-color-library]");

  if (!paperPackLibrary && !colorLibrary) {
    return;
  }

  try {
    const [colorsById, paperPacks] = await Promise.all([loadColors(), loadPaperPacks()]);
    const colors = Object.values(colorsById);
    initializeAddColorWorkflow(colorsById);
    initializeAddDspWorkflow(colorsById);

    if (paperPackLibrary) {
      renderPaperPackLibrary(paperPackLibrary, paperPacks, colorsById);
      const librarySearch = initializeLibrarySearch(paperPackLibrary, paperPacks, colorsById);
      initializeDetailPanel(paperPackLibrary, paperPacks, colorsById, librarySearch.renderCurrent);
      initializePaperPackSaves(paperPackLibrary, paperPacks, colorsById, librarySearch.renderCurrent);
    }

    if (colorLibrary) {
      renderColorLibrary(colorLibrary, colors);
      document.addEventListener("color:saved", () => {
        renderColorLibrary(colorLibrary, Object.values(colorsById));
      });
    }
  } catch (error) {
    if (paperPackLibrary) {
      renderError(paperPackLibrary, "Paper packs could not be loaded.");
    }

    if (colorLibrary) {
      renderError(colorLibrary, "Colors could not be loaded.");
    }
  }
}

function initializeScreenNavigation() {
  const screens = [...document.querySelectorAll("[data-screen]")];
  const navLinks = [...document.querySelectorAll("[data-nav-link]")];

  if (screens.length === 0) {
    return;
  }

  function showCurrentScreen() {
    const requestedScreenId = window.location.hash.slice(1) || "library";
    const activeScreen = screens.find((screen) => screen.id === requestedScreenId) || screens[0];

    for (const screen of screens) {
      screen.hidden = screen !== activeScreen;
    }

    for (const link of navLinks) {
      const isActive = link.hash === `#${activeScreen.id}`;
      link.classList.toggle("nav-link-active", isActive);

      if (isActive) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    }
  }

  showCurrentScreen();
  window.addEventListener("hashchange", showCurrentScreen);
}

async function loadColors() {
  const response = await fetch("data/colors.json");

  if (!response.ok) {
    throw new Error("Unable to load colors.json");
  }

  const baseColorsById = await response.json();
  const savedColors = await loadSavedColors();

  return mergeColors(baseColorsById, savedColors);
}

async function loadPaperPacks() {
  const response = await fetch("data/paper-packs.json");

  if (!response.ok) {
    throw new Error("Unable to load paper-packs.json");
  }

  const data = await response.json();
  const basePaperPacks = data.paperPacks || [];
  const savedPaperPacks = await loadSavedPaperPacks();

  return await mergePaperPacks(basePaperPacks, savedPaperPacks);
}

function initializeLibrarySearch(paperPackLibrary, paperPacks, colorsById) {
  const form = document.querySelector("[data-library-search-form]");
  const input = document.querySelector("[data-library-search-input]");
  const clearAllButton = document.querySelector("[data-library-clear-all]");
  const clearTagsButton = document.querySelector("[data-library-clear-tags]");
  const clearColorsButton = document.querySelector("[data-library-clear-colors]");
  const tagFilter = document.querySelector("[data-library-tag-filters]");
  const colorFilter = document.querySelector("[data-library-color-filters]");

  function renderCurrent() {
    refreshLibraryColorFilters(colorFilter, getAvailableColors(paperPacks, colorsById));
    const filterState = getLibraryFilterState(input, tagFilter, colorFilter);
    const filteredPaperPacks = applyPaperPackFilters(paperPacks, filterState, colorsById);

    renderPaperPackLibrary(paperPackLibrary, filteredPaperPacks, colorsById, {
      query: filterState.query,
      selectedTags: filterState.selectedTags,
      selectedColors: filterState.selectedColors,
      totalCount: paperPacks.length
    });

    if (clearAllButton) {
      clearAllButton.hidden =
        filterState.query.length === 0 &&
        filterState.selectedTags.length === 0 &&
        filterState.selectedColors.length === 0;
    }

    if (clearTagsButton) {
      clearTagsButton.hidden = filterState.selectedTags.length === 0;
    }

    if (clearColorsButton) {
      clearColorsButton.hidden = filterState.selectedColors.length === 0;
    }
  }

  if (!form || !input) {
    return {
      renderCurrent: () => renderPaperPackLibrary(paperPackLibrary, paperPacks, colorsById)
    };
  }

  renderLibraryTagFilters(tagFilter, getAvailableTags(paperPacks));
  refreshLibraryColorFilters(colorFilter, getAvailableColors(paperPacks, colorsById));
  input.addEventListener("input", renderCurrent);
  clearAllButton?.addEventListener("click", () => {
    input.value = "";
    clearSelectedLibraryTags(tagFilter);
    clearSelectedLibraryColors(colorFilter);
    renderCurrent();
    input.focus();
  });
  clearTagsButton?.addEventListener("click", () => {
    clearSelectedLibraryTags(tagFilter);
    renderCurrent();
  });
  clearColorsButton?.addEventListener("click", () => {
    clearSelectedLibraryColors(colorFilter);
    renderCurrent();
  });
  form.querySelectorAll("[data-library-toggle-filter]").forEach((toggle) => {
    toggle.addEventListener("click", () => toggleFilterSection(toggle));
  });
  tagFilter?.addEventListener("change", renderCurrent);
  colorFilter?.addEventListener("change", renderCurrent);
  form.addEventListener("submit", (event) => event.preventDefault());

  return {
    renderCurrent
  };
}

function getLibraryFilterState(input, tagFilter, colorFilter) {
  return {
    query: input?.value || "",
    selectedTags: getSelectedLibraryTags(tagFilter),
    selectedColors: getSelectedLibraryColors(colorFilter)
  };
}

function applyPaperPackFilters(paperPacks, filterState, colorsById) {
  return paperPacks.filter((paperPack) =>
    matchesPaperPackFilters(paperPack, filterState, colorsById)
  );
}

function renderLibraryTagFilters(container, tags) {
  if (!container || tags.length === 0) {
    return;
  }

  const options = document.createElement("div");
  options.className = "keyword-picker-options library-tag-filter-options";
  options.dataset.libraryFilterOptions = "";

  options.append(
    ...tags.map((tag) => {
      const label = document.createElement("label");
      label.className = "keyword-option library-tag-option";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "library-tags";
      input.value = tag;

      const text = document.createElement("span");
      text.textContent = tag;

      label.append(input, text);

      return label;
    })
  );

  container.append(options);
}

function renderLibraryColorFilters(container, colors) {
  if (!container || colors.length === 0) {
    return;
  }

  const options = document.createElement("div");
  options.className = "library-color-filter-options";
  options.dataset.libraryFilterOptions = "";

  options.append(...colors.map(createLibraryColorOption));
  container.append(options);
}

function refreshLibraryColorFilters(container, colors) {
  if (!container) {
    return;
  }

  const selectedColors = new Set(getSelectedLibraryColors(container));
  const existingOptions = container.querySelector("[data-library-filter-options]");
  const optionsWereHidden = existingOptions?.hidden || false;

  existingOptions?.remove();
  renderLibraryColorFilters(container, colors);

  const refreshedOptions = container.querySelector("[data-library-filter-options]");

  if (refreshedOptions) {
    refreshedOptions.hidden = optionsWereHidden;
  }

  for (const input of container.querySelectorAll('input[name="library-colors"]')) {
    input.checked = selectedColors.has(input.value);
  }
}

function toggleFilterSection(toggle) {
  const filterSection = toggle.closest("fieldset");
  const filterOptions = filterSection?.querySelector("[data-library-filter-options]");

  if (!filterOptions) {
    return;
  }

  const isExpanded = toggle.getAttribute("aria-expanded") === "true";

  toggle.setAttribute("aria-expanded", `${!isExpanded}`);
  filterOptions.hidden = isExpanded;
}

function createLibraryColorOption(color) {
  const label = document.createElement("label");
  label.className = "library-color-option";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = "library-colors";
  input.value = color.id;

  const marker = document.createElement("span");

  const swatch = document.createElement("span");
  swatch.className = "pack-color-dot";
  swatch.style.backgroundColor = color.hex;
  swatch.setAttribute("aria-hidden", "true");

  const name = document.createElement("span");
  name.textContent = color.name;

  marker.append(swatch, name);
  label.append(input, marker);

  return label;
}

function getAvailableTags(paperPacks) {
  const tagsByNormalizedName = new Map();

  for (const paperPack of paperPacks) {
    for (const keyword of paperPack.keywords || []) {
      const normalizedKeyword = normalizeFilterText(keyword);

      if (normalizedKeyword && !tagsByNormalizedName.has(normalizedKeyword)) {
        tagsByNormalizedName.set(normalizedKeyword, keyword);
      }
    }
  }

  return [...tagsByNormalizedName.values()].sort((firstTag, secondTag) =>
    firstTag.localeCompare(secondTag)
  );
}

function getAvailableColors(paperPacks, colorsById) {
  const colorsByPackReference = new Map();

  for (const paperPack of paperPacks) {
    for (const colorId of paperPack.colors || []) {
      const color = colorsById[colorId];

      if (color) {
        colorsByPackReference.set(color.id, color);
      }
    }
  }

  return [...colorsByPackReference.values()].sort(compareColors);
}

function getSelectedLibraryTags(container) {
  if (!container) {
    return [];
  }

  return [...container.querySelectorAll('input[name="library-tags"]:checked')].map(
    (input) => input.value
  );
}

function clearSelectedLibraryTags(container) {
  if (!container) {
    return;
  }

  for (const input of container.querySelectorAll('input[name="library-tags"]:checked')) {
    input.checked = false;
  }
}

function getSelectedLibraryColors(container) {
  if (!container) {
    return [];
  }

  return [...container.querySelectorAll('input[name="library-colors"]:checked')].map(
    (input) => input.value
  );
}

function clearSelectedLibraryColors(container) {
  if (!container) {
    return;
  }

  for (const input of container.querySelectorAll('input[name="library-colors"]:checked')) {
    input.checked = false;
  }
}

function matchesPaperPackFilters(paperPack, filterState, colorsById) {
  const normalizedQuery = normalizeFilterText(filterState.query);
  const selectedTags = (filterState.selectedTags || []).map(normalizeFilterText).filter(Boolean);
  const selectedColors = filterState.selectedColors || [];
  const packKeywords = paperPack.keywords || [];
  const normalizedPackKeywords = packKeywords.map(normalizeFilterText);
  const matchesSelectedTags = selectedTags.every((tag) => normalizedPackKeywords.includes(tag));
  const matchesSelectedColors =
    selectedColors.length === 0 ||
    selectedColors.some((colorId) => (paperPack.colors || []).includes(colorId));

  if (!matchesSelectedTags) {
    return false;
  }

  if (!matchesSelectedColors) {
    return false;
  }

  if (!normalizedQuery) {
    return true;
  }

  const searchableText = [
    paperPack.name,
    paperPack.owner,
    paperPack.releaseYear,
    ...packKeywords,
    ...getSearchableColorText(paperPack, colorsById)
  ]
    .join(" ")
    .split(/\s+/)
    .map(normalizeFilterText)
    .join(" ");

  return searchableText.includes(normalizedQuery);
}

function getSearchableColorText(paperPack, colorsById) {
  return (paperPack.colors || []).flatMap((colorId) => {
    const color = colorsById[colorId];

    if (!color) {
      return [];
    }

    const colorFamilyLabel =
      COLOR_FAMILY_LABELS[color.colorFamily] || formatColorFamily(color.colorFamily || "");

    return [
      color.name,
      color.id,
      color.family,
      color.colorFamily,
      colorFamilyLabel,
      ...(color.aliases || [])
    ];
  });
}

function normalizeFilterText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
}

function renderPaperPackLibrary(container, paperPacks, colorsById, options = {}) {
  updateLibraryResultCount(paperPacks.length, options.totalCount ?? paperPacks.length);

  if (paperPacks.length === 0) {
    renderEmptyPaperPackLibrary(
      container,
      options.query,
      options.selectedTags || [],
      options.selectedColors || [],
      options.totalCount
    );
    return;
  }

  container.replaceChildren(
    ...paperPacks.map((paperPack) => createPaperPackCard(paperPack, colorsById))
  );
}

function updateLibraryResultCount(visibleCount, totalCount) {
  const resultCount = document.querySelector("[data-library-result-count]");

  if (!resultCount) {
    return;
  }

  const visibleLabel = `${visibleCount}`;
  const totalLabel = `${totalCount}`;
  const packLabel = totalCount === 1 ? "pack" : "packs";

  resultCount.textContent = `Showing ${visibleLabel} of ${totalLabel} ${packLabel}`;
}

function renderEmptyPaperPackLibrary(
  container,
  query,
  selectedTags = [],
  selectedColors = [],
  totalCount = 0
) {
  const message = document.createElement("p");
  const hasFilters = query || selectedTags.length > 0 || selectedColors.length > 0;

  message.className = "loading-message";

  if (hasFilters && totalCount > 0) {
    message.textContent = query
      ? `No paper packs match "${query}".`
      : "No paper packs match the selected filters.";
  } else {
    message.textContent = "No paper packs to display yet.";
  }

  container.replaceChildren(message);
}

function initializePaperPackSaves(paperPackLibrary, paperPacks, colorsById, renderCurrentLibrary) {
  document.addEventListener("paper-pack:save", (event) => {
    const paperPack = event.detail?.paperPack;
    const mode = event.detail?.mode || "add";

    if (!paperPack) {
      return;
    }

    const packToSave = mode === "edit" ? paperPack : ensureUniquePaperPackId(paperPack, paperPacks);
    const existingIndex = paperPacks.findIndex((existingPack) => existingPack.id === packToSave.id);

    if (existingIndex === -1) {
      paperPacks.unshift(packToSave);

      if (mode === "add") {
        addPackToLatestCatalogSession(packToSave.id);
      }
    } else {
      paperPacks.splice(existingIndex, 1, packToSave);
    }

    renderCurrentLibrary();

    event.detail.saveComplete = preparePaperPackImagesForSave(packToSave)
      .then(savePaperPack)
      .then(() => ({
        ok: true
      }))
      .catch(() => ({
        ok: false,
        displayed: true,
        message:
          "The paper pack is visible for this session, but the browser could not save it permanently. The selected images may be too large for the browser database."
      }));
  });
}

function ensureUniquePaperPackId(paperPack, paperPacks) {
  const existingIds = new Set(paperPacks.map((existingPack) => existingPack.id));

  if (!existingIds.has(paperPack.id)) {
    return paperPack;
  }

  let suffix = 2;
  let id = `${paperPack.id}-${suffix}`;

  while (existingIds.has(id)) {
    suffix += 1;
    id = `${paperPack.id}-${suffix}`;
  }

  return {
    ...paperPack,
    id
  };
}

function createPaperPackCard(paperPack, colorsById) {
  const card = document.createElement("article");
  card.className = "dsp-card";
  card.dataset.paperPackCard = "";
  card.dataset.packId = paperPack.id;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Open ${paperPack.name}`);

  const patternGrid = createPatternGrid(paperPack);
  const contextBar = createCardContextBar(paperPack);
  const cardBody = document.createElement("div");
  cardBody.className = "card-body";

  const titleRow = document.createElement("div");
  titleRow.className = "card-title-row";

  const title = document.createElement("h4");
  title.textContent = paperPack.name;
  titleRow.append(title);

  const keywords = createKeywordList(paperPack);
  const colorList = createPackColorList(paperPack, colorsById);
  const availability = createAvailabilityIndicator(paperPack.availability);
  const meta = document.createElement("p");
  meta.className = "card-meta";
  meta.textContent = paperPack.owner;
  const editButton = createEditPaperPackButton(paperPack);

  cardBody.append(colorList, keywords, availability, meta);

  if (contextBar) {
    card.append(contextBar);
  }

  card.append(titleRow, patternGrid, cardBody, editButton);

  return card;
}

function createEditPaperPackButton(paperPack) {
  const editButton = document.createElement("button");
  editButton.className = "card-edit-button";
  editButton.type = "button";
  editButton.dataset.editPack = paperPack.id;
  editButton.textContent = "Edit";
  editButton.setAttribute("aria-label", `Edit ${paperPack.name}`);

  return editButton;
}

function createCardContextBar(paperPack) {
  const context = getCardContext(paperPack);

  if (!context) {
    return null;
  }

  const contextBar = document.createElement("div");
  contextBar.className = "card-context-bar";
  contextBar.textContent = context.label;

  return contextBar;
}

function getCardContext(paperPack) {
  if (LATEST_CATALOG_SESSION_PACK_IDS.has(paperPack.id)) {
    return {
      label: "Recently Added"
    };
  }

  return null;
}

function addPackToLatestCatalogSession(paperPackId) {
  if (!hasUserCatalogSession) {
    LATEST_CATALOG_SESSION_PACK_IDS.clear();
    hasUserCatalogSession = true;
  }

  LATEST_CATALOG_SESSION_PACK_IDS.add(paperPackId);
  saveCatalogSessionPackIds();
}

function loadCatalogSessionPackIds() {
  try {
    const savedPackIds = JSON.parse(window.sessionStorage.getItem(CATALOG_SESSION_STORAGE_KEY));

    if (Array.isArray(savedPackIds) && savedPackIds.every((packId) => typeof packId === "string")) {
      return savedPackIds;
    }
  } catch (error) {
    // Fall back to the prototype sample context if session storage is unavailable.
  }

  return DEFAULT_CATALOG_SESSION_PACK_IDS;
}

function hasSavedCatalogSession() {
  try {
    return window.sessionStorage.getItem(CATALOG_SESSION_STORAGE_KEY) !== null;
  } catch (error) {
    return false;
  }
}

function saveCatalogSessionPackIds() {
  try {
    window.sessionStorage.setItem(
      CATALOG_SESSION_STORAGE_KEY,
      JSON.stringify([...LATEST_CATALOG_SESSION_PACK_IDS])
    );
  } catch (error) {
    // The in-memory context still works for the current page even if session storage is unavailable.
  }
}

function initializeDetailPanel(paperPackLibrary, paperPacks, colorsById, renderCurrentLibrary) {
  const detailPanel = document.querySelector("[data-detail-panel]");
  const detailTitle = document.querySelector("[data-detail-title]");
  const detailBody = document.querySelector("[data-detail-body]");
  const detailClose = document.querySelector("[data-detail-close]");

  if (!detailPanel || !detailTitle || !detailBody) {
    return;
  }

  paperPackLibrary.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-pack]");

    if (editButton) {
      event.preventDefault();
      event.stopPropagation();
      openPaperPackEditor(editButton.dataset.editPack, paperPacks);
      return;
    }

    const card = event.target.closest("[data-paper-pack-card]");

    if (!card) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const paperPack = paperPacks.find((pack) => pack.id === card.dataset.packId);

    if (paperPack) {
      openDetailPanel(detailPanel, detailTitle, detailBody, paperPack, paperPacks, colorsById);
    }
  });

  paperPackLibrary.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const card = event.target.closest("[data-paper-pack-card]");

    if (!card || event.target.closest("[data-edit-pack]")) {
      return;
    }

    event.preventDefault();

    const paperPack = paperPacks.find((pack) => pack.id === card.dataset.packId);

    if (paperPack) {
      openDetailPanel(detailPanel, detailTitle, detailBody, paperPack, paperPacks, colorsById);
    }
  });

  detailBody.addEventListener("click", (event) => {
    event.stopPropagation();

    const editButton = event.target.closest("[data-edit-pack]");

    if (editButton) {
      const selectedPack = paperPacks.find((pack) => pack.id === detailPanel.dataset.selectedPackId);

      if (selectedPack) {
        requestPaperPackEdit(selectedPack);
        closeDetailPanel(detailPanel);
      }

      return;
    }

    const deleteButton = event.target.closest("[data-delete-pack]");

    if (deleteButton) {
      const selectedPack = paperPacks.find((pack) => pack.id === detailPanel.dataset.selectedPackId);

      if (selectedPack) {
        deleteSelectedPaperPack(selectedPack, paperPacks, renderCurrentLibrary, detailPanel);
      }

      return;
    }

    const coverSheetButton = event.target.closest("[data-create-cover-sheet]");

    if (coverSheetButton) {
      const selectedPack = paperPacks.find((pack) => pack.id === detailPanel.dataset.selectedPackId);

      if (selectedPack) {
        createCoverSheetForPack(selectedPack, colorsById).catch(() => {
          window.alert("The cover sheet could not be created.");
        });
      }

      return;
    }

    const coordinatingPack = event.target.closest("[data-coordinate-pack]");

    if (coordinatingPack) {
      const paperPack = paperPacks.find((pack) => pack.id === coordinatingPack.dataset.coordinatePack);
      const coordinatingColor = colorsById[coordinatingPack.dataset.coordinateColor];

      if (paperPack) {
        openDetailPanel(
          detailPanel,
          detailTitle,
          detailBody,
          paperPack,
          paperPacks,
          colorsById,
          coordinatingColor
        );
      }

      return;
    }

    const colorButton = event.target.closest("[data-coordinate-color]");

    if (!colorButton) {
      return;
    }

    const selectedPack = paperPacks.find((pack) => pack.id === detailPanel.dataset.selectedPackId);
    const color = colorsById[colorButton.dataset.coordinateColor];
    const resultsContainer = detailBody.querySelector("[data-coordination-results]");

    if (!selectedPack || !color || !resultsContainer) {
      return;
    }

    renderCoordinatingPacks(resultsContainer, selectedPack, color, paperPacks);
  });

  detailClose?.addEventListener("click", () => closeDetailPanel(detailPanel));

  document.addEventListener("click", (event) => {
    if (detailPanel.hidden || detailPanel.contains(event.target)) {
      return;
    }

    closeDetailPanel(detailPanel);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !detailPanel.hidden) {
      closeDetailPanel(detailPanel);
    }
  });
}

function openPaperPackEditor(paperPackId, paperPacks) {
  const paperPack = paperPacks.find((pack) => pack.id === paperPackId);

  if (paperPack) {
    requestPaperPackEdit(paperPack);
  }
}

function requestPaperPackEdit(paperPack) {
  document.dispatchEvent(
    new CustomEvent("paper-pack:edit-request", {
      detail: {
        paperPack
      }
    })
  );
}

function openDetailPanel(
  detailPanel,
  detailTitle,
  detailBody,
  paperPack,
  paperPacks,
  colorsById,
  coordinatingColor = null
) {
  detailPanel.hidden = false;
  detailPanel.dataset.selectedPackId = paperPack.id;
  detailTitle.textContent = paperPack.name;
  detailBody.replaceChildren(createDetailContent(paperPack, paperPacks, colorsById));
  detailBody.scrollTop = 0;

  if (coordinatingColor) {
    const resultsContainer = detailBody.querySelector("[data-coordination-results]");

    if (resultsContainer) {
      renderCoordinatingPacks(resultsContainer, paperPack, coordinatingColor, paperPacks);
    }
  }

  detailPanel.querySelector("[data-detail-close]")?.focus();
}

function closeDetailPanel(detailPanel) {
  detailPanel.hidden = true;
  delete detailPanel.dataset.selectedPackId;
}

function createDetailContent(paperPack, paperPacks, colorsById) {
  const content = document.createElement("div");
  content.className = "detail-content";

  const preview = createPatternGrid(paperPack);
  preview.classList.add("detail-pattern-grid");

  const metadata = document.createElement("div");
  metadata.className = "detail-metadata";

  const keywordList = createKeywordList(paperPack);
  keywordList.classList.add("detail-keyword-list");

  const colorSection = document.createElement("section");
  colorSection.className = "detail-section";
  colorSection.setAttribute("aria-labelledby", "detail-colors-title");

  const colorHeading = document.createElement("h4");
  colorHeading.id = "detail-colors-title";
  colorHeading.textContent = "Colors";

  const colorList = createDetailColorList(paperPack, colorsById);
  colorSection.append(colorHeading, colorList);

  const tagSection = document.createElement("section");
  tagSection.className = "detail-section";
  tagSection.setAttribute("aria-labelledby", "detail-tags-title");

  const tagHeading = document.createElement("h4");
  tagHeading.id = "detail-tags-title";
  tagHeading.textContent = "Tags";
  tagSection.append(tagHeading, keywordList);

  const coordinationSection = document.createElement("section");
  coordinationSection.className = "detail-section coordination-section";
  coordinationSection.setAttribute("aria-labelledby", "coordination-title");

  const coordinationHeading = document.createElement("h4");
  coordinationHeading.id = "coordination-title";
  coordinationHeading.textContent = "Similar Packs";

  const coordinationResults = document.createElement("div");
  coordinationResults.className = "coordination-results";
  coordinationResults.dataset.coordinationResults = "";

  const prompt = document.createElement("p");
  prompt.className = "coordination-empty";
  prompt.textContent = "Choose a color above to find other paper packs that coordinate.";
  coordinationResults.append(prompt);

  coordinationSection.append(coordinationHeading, coordinationResults);
  metadata.append(colorSection, tagSection, createDetailMeta(paperPack), coordinationSection, createDetailActions(paperPack));
  content.append(preview, metadata);

  return content;
}

function createDetailColorList(paperPack, colorsById) {
  const colorList = document.createElement("ul");
  colorList.className = "detail-color-list";
  colorList.setAttribute("aria-label", `${paperPack.name} coordinating colors`);

  const packColors = (paperPack.colors || []).map((colorId) => ({
    id: colorId,
    color: colorsById[colorId]
  }));

  packColors.sort(comparePackColorReferences);
  colorList.append(
    ...packColors.map(({ id, color }) =>
      color ? createDetailColorItem(color) : createMissingColorItem(id)
    )
  );

  return colorList;
}

function createDetailColorItem(color) {
  const item = document.createElement("li");

  const button = document.createElement("button");
  button.className = "detail-color-chip";
  button.type = "button";
  button.dataset.coordinateColor = color.id;

  const swatch = document.createElement("span");
  swatch.className = "pack-color-dot";
  swatch.style.backgroundColor = color.hex;
  swatch.setAttribute("aria-hidden", "true");

  const name = document.createElement("span");
  name.className = "pack-color-name";
  name.textContent = color.name;

  button.append(swatch, name);
  item.append(button);

  return item;
}

function createDetailMeta(paperPack) {
  const meta = document.createElement("section");
  meta.className = "detail-section";
  meta.setAttribute("aria-labelledby", "detail-meta-title");

  const heading = document.createElement("h4");
  heading.id = "detail-meta-title";
  heading.textContent = "Pack Info";

  const list = document.createElement("dl");
  list.className = "detail-meta-list";

  list.append(
    createDetailMetaItem("Owner", paperPack.owner),
    createDetailMetaItem("Status", formatAvailabilityLabel(paperPack.availability)),
    createDetailMetaItem("Release", `${paperPack.releaseYear}`)
  );

  meta.append(heading, list);

  return meta;
}

function createDetailMetaItem(label, value) {
  const wrapper = document.createElement("div");

  const term = document.createElement("dt");
  term.textContent = label;

  const description = document.createElement("dd");
  description.textContent = value;

  wrapper.append(term, description);

  return wrapper;
}

function createDetailActions(paperPack) {
  const actions = document.createElement("section");
  actions.className = "detail-section detail-actions";
  actions.setAttribute("aria-labelledby", "detail-actions-title");

  const heading = document.createElement("h4");
  heading.id = "detail-actions-title";
  heading.textContent = "Actions";

  const deleteButton = document.createElement("button");
  deleteButton.className = "button button-danger";
  deleteButton.type = "button";
  deleteButton.dataset.deletePack = paperPack.id;
  deleteButton.textContent = "Delete Paper Pack";

  const buttonRow = document.createElement("div");
  buttonRow.className = "detail-action-row";

  const editButton = document.createElement("button");
  editButton.className = "button";
  editButton.type = "button";
  editButton.dataset.editPack = paperPack.id;
  editButton.textContent = "Edit Paper Pack";

  const coverSheetButton = document.createElement("button");
  coverSheetButton.className = "button";
  coverSheetButton.type = "button";
  coverSheetButton.dataset.createCoverSheet = paperPack.id;
  coverSheetButton.textContent = "Create Cover Sheet";

  buttonRow.append(coverSheetButton, editButton, deleteButton);
  actions.append(heading, buttonRow);

  return actions;
}

function deleteSelectedPaperPack(selectedPack, paperPacks, renderCurrentLibrary, detailPanel) {
  const shouldDelete = window.confirm(`Delete ${selectedPack.name} from the catalog?`);

  if (!shouldDelete) {
    return;
  }

  Promise.all([deletePaperPackImages(selectedPack), deletePaperPack(selectedPack.id)]).catch(() => {
    window.alert("The paper pack was removed from this session, but the browser could not save the deletion permanently.");
  });

  const selectedPackIndex = paperPacks.findIndex((paperPack) => paperPack.id === selectedPack.id);

  if (selectedPackIndex !== -1) {
    paperPacks.splice(selectedPackIndex, 1);
  }

  LATEST_CATALOG_SESSION_PACK_IDS.delete(selectedPack.id);
  renderCurrentLibrary();
  closeDetailPanel(detailPanel);
}

function createAvailabilityIndicator(availability) {
  const indicator = document.createElement("p");
  const normalizedAvailability = normalizeAvailability(availability);

  indicator.className = `availability-indicator availability-${normalizedAvailability}`;
  indicator.textContent = formatAvailabilityLabel(normalizedAvailability);

  return indicator;
}

function normalizeAvailability(availability) {
  return availability === "used-up" ? "used-up" : "available";
}

function formatAvailabilityLabel(availability) {
  return normalizeAvailability(availability) === "used-up" ? "Used Up" : "Available";
}

function renderCoordinatingPacks(container, selectedPack, color, paperPacks) {
  const coordinatingPacks = paperPacks.filter(
    (paperPack) => paperPack.id !== selectedPack.id && paperPack.colors?.includes(color.id)
  );

  const subtitle = document.createElement("p");
  subtitle.className = "coordination-subtitle";
  subtitle.textContent = `Based on ${color.name}`;

  if (coordinatingPacks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "coordination-empty";
    empty.textContent = `No other sample packs use ${color.name} yet.`;
    container.replaceChildren(subtitle, empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "coordination-pack-list";

  list.append(
    ...coordinatingPacks.map((paperPack) => createCoordinatingPackCard(paperPack, color))
  );
  container.replaceChildren(subtitle, list);
}

function createCoordinatingPackCard(paperPack, color) {
  const card = document.createElement("button");
  card.className = "coordination-pack-card";
  card.type = "button";
  card.dataset.coordinatePack = paperPack.id;
  card.dataset.coordinateColor = color.id;
  card.setAttribute("aria-label", `Open ${paperPack.name}`);

  const preview = createPatternGrid({
    ...paperPack,
    patterns: paperPack.patterns?.slice(0, 4) || []
  });
  preview.classList.add("coordination-pattern-grid");

  const title = document.createElement("span");
  title.className = "coordination-pack-title";
  title.textContent = paperPack.name;

  const meta = document.createElement("p");
  meta.textContent = `${paperPack.owner} - ${paperPack.releaseYear} Release`;

  card.append(title, preview, meta);

  return card;
}

function createPatternGrid(paperPack) {
  const patternGrid = document.createElement("div");
  patternGrid.className = "pattern-grid";
  patternGrid.setAttribute("aria-label", `All sample patterns for ${paperPack.name}`);

  const patterns = paperPack.patterns || [];

  patternGrid.append(...patterns.map(createPatternPreview));

  return patternGrid;
}

function createPatternPreview(patternEntry, index) {
  const pattern = document.createElement("span");
  const patternObject = patternEntry && typeof patternEntry === "object" ? patternEntry : null;
  const imageSrc = getPatternImageSource(patternEntry);
  const imageName = patternObject?.imageName || "";

  if (imageSrc) {
    const image = document.createElement("img");
    image.src = imageSrc;
    image.alt = imageName || `Pattern ${index + 1}`;

    pattern.className = "pattern pattern-image";
    pattern.append(image);

    return pattern;
  }

  pattern.className = "pattern pattern-placeholder";
  pattern.setAttribute("aria-label", `No image available for pattern ${index + 1}`);

  return pattern;
}

function createKeywordList(paperPack) {
  const keywordList = document.createElement("ul");
  keywordList.className = "keyword-list";
  keywordList.setAttribute("aria-label", `${paperPack.name} keywords`);

  keywordList.append(
    ...(paperPack.keywords || []).map((keyword) => {
      const item = document.createElement("li");
      item.textContent = keyword;

      return item;
    })
  );

  return keywordList;
}

function createPackColorList(paperPack, colorsById) {
  const colorList = document.createElement("ul");
  colorList.className = "pack-color-list";
  colorList.setAttribute("aria-label", `${paperPack.name} colors`);

  const packColors = (paperPack.colors || []).map((colorId) => ({
    id: colorId,
    color: colorsById[colorId]
  }));

  packColors.sort(comparePackColorReferences);

  colorList.append(
    ...packColors.map(({ id, color }) =>
      color ? createPackColorItem(color) : createMissingColorItem(id)
    )
  );

  return colorList;
}

function comparePackColorReferences(firstReference, secondReference) {
  if (!firstReference.color && !secondReference.color) {
    return firstReference.id.localeCompare(secondReference.id);
  }

  if (!firstReference.color) {
    return 1;
  }

  if (!secondReference.color) {
    return -1;
  }

  return compareColors(firstReference.color, secondReference.color);
}

function createPackColorItem(color) {
  const item = document.createElement("li");
  item.className = "pack-color";
  item.dataset.colorId = color.id;

  const swatch = document.createElement("span");
  swatch.className = "pack-color-dot";
  swatch.style.backgroundColor = color.hex;
  swatch.setAttribute("aria-hidden", "true");

  const name = document.createElement("span");
  name.className = "pack-color-name";
  name.textContent = color.name;

  item.append(swatch, name);

  return item;
}

function createMissingColorItem(colorId) {
  const item = document.createElement("li");
  item.className = "pack-color pack-color-missing";
  item.textContent = `Missing color: ${colorId}`;

  return item;
}

function renderColorLibrary(container, colors) {
  container.replaceChildren(
    ...groupColorsByFamily(colors).map(([colorFamily, familyColors]) =>
      createColorFamilyGroup(colorFamily, familyColors)
    )
  );
}

function groupColorsByFamily(colors) {
  const sortedColors = [...colors].sort(compareColors);
  const groups = new Map();

  for (const color of sortedColors) {
    const colorFamily = color.colorFamily || "neutral";

    if (!groups.has(colorFamily)) {
      groups.set(colorFamily, []);
    }

    groups.get(colorFamily).push(color);
  }

  return [...groups.entries()].sort(compareColorFamilies);
}

function compareColors(firstColor, secondColor) {
  const familyComparison =
    getColorFamilyRank(firstColor.colorFamily) - getColorFamilyRank(secondColor.colorFamily);

  if (familyComparison !== 0) {
    return familyComparison;
  }

  return firstColor.name.localeCompare(secondColor.name);
}

function compareColorFamilies([firstFamily], [secondFamily]) {
  return getColorFamilyRank(firstFamily) - getColorFamilyRank(secondFamily);
}

function getColorFamilyRank(colorFamily) {
  const rank = COLOR_FAMILY_ORDER.indexOf(colorFamily);

  return rank === -1 ? COLOR_FAMILY_ORDER.length : rank;
}

function createColorFamilyGroup(colorFamily, colors) {
  const section = document.createElement("section");
  section.className = "color-family-group";
  section.setAttribute("aria-labelledby", `${colorFamily}-colors-title`);

  const heading = document.createElement("h4");
  heading.id = `${colorFamily}-colors-title`;
  heading.textContent = COLOR_FAMILY_LABELS[colorFamily] || formatColorFamily(colorFamily);

  const markerGrid = document.createElement("div");
  markerGrid.className = "color-marker-grid";

  markerGrid.append(...colors.map(createColorMarker));
  section.append(heading, markerGrid);

  return section;
}

function createColorMarker(color) {
  const marker = document.createElement("article");
  marker.className = "color-marker";
  marker.dataset.colorId = color.id;
  marker.title = `${color.name} ${color.hex}`;

  const swatch = document.createElement("span");
  swatch.className = "color-marker-dot";
  swatch.style.backgroundColor = color.hex;
  swatch.setAttribute("aria-hidden", "true");

  const name = document.createElement("span");
  name.className = "color-marker-name";
  name.textContent = color.name;

  const hex = document.createElement("span");
  hex.className = "color-marker-hex";
  hex.textContent = color.hex;

  marker.append(swatch, name, hex);

  return marker;
}

function formatColorFamily(colorFamily) {
  return colorFamily
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function renderError(container, text) {
  const message = document.createElement("p");
  message.className = "loading-message";
  message.textContent = text;

  container.replaceChildren(message);
}
