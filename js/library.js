import { initializeAddDspWorkflow } from "./add-dsp.js";
import { initializeCatalogBackup } from "./backup.js";
import { initializeAddColorWorkflow } from "./color-form.js";
import { createCoverSheetForPack } from "./cover-sheet.js";
import {
  getUncatalogedPackDiscoveryAvailability,
  getPaperLibraryImageSource,
  getPatternImageSource,
  hydratePaperPackImageSources,
  preparePaperPackImagesForSave,
  scanImageLibraryPaperPackFolders
} from "./images.js";
import { initializeSettings } from "./settings.js";
import { getCardLibraryImageSource } from "./card-images.js";
import { isActiveOwner } from "./owners.js";
import { resolveItemTagIds } from "./tag-picker.js";
import {
  clearGlobalTagFilter,
  getGlobalTagSearchNames,
  matchesGlobalTagFilters,
  matchesHolidayFilter,
  readGlobalTagFilter,
  renderGlobalTagFilter,
  resolveHolidayFilterIdentity,
  synchronizeGlobalTagFilterChange
} from "./global-tag-filter.js";
import {
  deletePaperPack,
  loadSavedColors,
  loadSavedPaperPacks,
  migrateCatalogOwnership,
  mergeColors,
  mergePaperPacks,
  loadCatalogSetting,
  loadGlobalTagCatalog,
  saveCatalogSetting,
  savePaperPack
} from "./storage.js";

const IGNORED_UNCATALOGED_PACK_FOLDERS_SETTING_ID = "ignoredUncatalogedPaperPackFolders";
const LIBRARY_PATTERN_PREVIEW_LIMIT = 12;
const expandedLibraryPaperPacks = new Set();
const collapsedLibraryPaperPacks = new Set();
let areAllLibraryPatternsExpanded = false;
let cardsForPaperPackDetails = [];

export function setCardsForPaperPackDetails(cards) {
  cardsForPaperPackDetails = Array.isArray(cards) ? cards : [];
}

export function findCardsUsingPaperPack(cards, paperPackId) {
  return (cards || []).filter((card) => card?.paperPackIds?.includes(paperPackId));
}

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

const COLOR_COLLECTION_ORDER = [
  "in-color",
  "neutrals",
  "brights",
  "subtles",
  "regals",
  "basics",
  "legacy"
];

const COLOR_COLLECTION_LABELS = {
  "in-color": "In Color",
  neutrals: "Neutrals",
  brights: "Brights",
  subtles: "Subtles",
  regals: "Regals",
  basics: "Basics",
  legacy: "Legacy"
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

export async function initializeLibraryShell() {
  initializeScreenNavigation();

  const paperPackLibrary = document.querySelector("[data-paper-pack-library]");
  const colorLibrary = document.querySelector("[data-color-library]");

  if (!paperPackLibrary && !colorLibrary) {
    return { paperPacks: [], colorsById: {}, owners: [] };
  }

  try {
    const [colorsById, ownership, tagCatalog] = await Promise.all([loadColors(), loadPaperPacks(), loadGlobalTagCatalog()]);
    const { paperPacks, owners } = ownership;
    ensureCanonicalPaperTagIds(paperPacks, tagCatalog);
    const colors = Object.values(colorsById);
    initializeAddColorWorkflow(colorsById);
    initializeAddDspWorkflow(colorsById, paperPacks, owners);
    const refreshUncatalogedPackFinder = await initializeUncatalogedPackFinder(paperPacks);

    if (paperPackLibrary) {
      renderPaperPackLibrary(paperPackLibrary, paperPacks, colorsById);
      const librarySearch = initializeLibrarySearch(paperPackLibrary, paperPacks, colorsById, owners, tagCatalog);
      initializePatternExpansionControls(librarySearch.renderCurrent);
      initializeDetailPanel(paperPackLibrary, paperPacks, colorsById, librarySearch.renderCurrent);
      initializePaperPackSaves(paperPackLibrary, paperPacks, colorsById, librarySearch.renderCurrent);
      initializeSettings({
        paperPacks,
        owners,
        onImageLibrarySelected: async () => {
          await hydratePaperPackImageSources(paperPacks);
          librarySearch.renderCurrent();
          await refreshUncatalogedPackFinder?.();
        },
        onImagesMigrated: () => {
          hydratePaperPackImageSources(paperPacks).then(librarySearch.renderCurrent);
        },
        onPaperPacksUpdated: () => {
          librarySearch.renderCurrent();
        }
      });
      initializeCatalogBackup({
        paperPacks,
        owners,
        colorsById,
        onRestore: async () => {
          await hydratePaperPackImageSources(paperPacks);
          librarySearch.renderCurrent();

          if (colorLibrary) {
            renderColorReference(colorLibrary, Object.values(colorsById));
          }
        }
      });
    }

    if (colorLibrary) {
      initializeColorReferenceControls(colorLibrary, colors);
      document.addEventListener("color:saved", () => {
        renderColorReference(colorLibrary, Object.values(colorsById));
      });
    }

    return { paperPacks, colorsById, owners };
  } catch (error) {
    if (paperPackLibrary) {
      renderError(paperPackLibrary, "Paper packs could not be loaded.");
    }

    if (colorLibrary) {
      renderError(colorLibrary, "Colors could not be loaded.");
    }

    return { paperPacks: [], colorsById: {}, owners: [] };
  }
}

function ensureCanonicalPaperTagIds(paperPacks, tagCatalog) {
  for (const paperPack of paperPacks) {
    if (!Array.isArray(paperPack.tagIds)) {
      paperPack.tagIds = resolveItemTagIds(paperPack, tagCatalog, "paper", "keywords");
    }
  }
}

function initializePatternExpansionControls(renderCurrentLibrary) {
  const expandAllButton = document.querySelector("[data-expand-all-patterns]");

  updateExpandAllPatternsButton(expandAllButton);
  expandAllButton?.addEventListener("click", () => {
    areAllLibraryPatternsExpanded = !areAllLibraryPatternsExpanded;
    expandedLibraryPaperPacks.clear();
    collapsedLibraryPaperPacks.clear();
    updateExpandAllPatternsButton(expandAllButton);
    renderCurrentLibrary();
  });
}

function updateExpandAllPatternsButton(button) {
  if (!button) {
    return;
  }

  button.textContent = areAllLibraryPatternsExpanded ? "Show 12 Patterns" : "Show All Patterns";
  button.setAttribute("aria-pressed", `${areAllLibraryPatternsExpanded}`);
}

async function initializeUncatalogedPackFinder(paperPacks) {
  const findButton = document.querySelector("[data-find-uncataloged-packs]");
  const availabilityMessage = document.querySelector("[data-find-uncataloged-packs-availability]");
  const panel = document.querySelector("[data-uncataloged-packs]");
  const closeButton = document.querySelector("[data-close-uncataloged-packs]");
  const message = document.querySelector("[data-uncataloged-packs-message]");
  const showIgnoredControl = document.querySelector("[data-show-ignored-uncataloged-packs]");
  const list = document.querySelector("[data-uncataloged-pack-list]");

  if (!findButton || !panel || !message || !list) {
    return;
  }

  const refreshAvailability = async () => {
    const availability = await getUncatalogedPackDiscoveryAvailability(window);
    const presentation = getUncatalogedPackControlPresentation(availability);
    findButton.hidden = presentation.hidden;
    findButton.disabled = presentation.disabled;
    findButton.title = presentation.message;

    if (availabilityMessage) {
      availabilityMessage.hidden = !presentation.message || presentation.hidden;
      availabilityMessage.textContent = presentation.message;
    }
  };

  await refreshAvailability();

  let scannedFolders = [];
  let ignoredFolderIds = new Set();
  let currentFolders = [];

  function refreshResults() {
    const candidateFolders = getUncatalogedImageFolderCandidates(scannedFolders, paperPacks);
    const availableFolders = candidateFolders.filter((folder) => !ignoredFolderIds.has(folder.id));
    const ignoredFolders = candidateFolders
      .filter((folder) => ignoredFolderIds.has(folder.id))
      .map((folder) => ({ ...folder, ignored: true }));

    currentFolders = showIgnoredControl?.checked
      ? [...availableFolders, ...ignoredFolders]
      : availableFolders;
    renderUncatalogedPackFolders(list, currentFolders);
    message.textContent = getUncatalogedPackScanMessage(availableFolders.length, ignoredFolders.length, showIgnoredControl?.checked);
    message.dataset.tone = availableFolders.length > 0 ? "success" : "";
  }

  findButton.addEventListener("click", async () => {
    panel.hidden = false;
    list.replaceChildren();
    message.textContent = "Scanning the image library...";
    message.dataset.tone = "";
    findButton.disabled = true;

    try {
      const [result, savedIgnoredFolderIds] = await Promise.all([
        scanImageLibraryPaperPackFolders(),
        loadIgnoredUncatalogedPackFolderIds()
      ]);

      if (!result.ok) {
        scannedFolders = [];
        currentFolders = [];
        message.textContent = result.message;
        message.dataset.tone = "error";
        return;
      }

      scannedFolders = result.folders;
      ignoredFolderIds = savedIgnoredFolderIds;
      refreshResults();
    } catch (error) {
      scannedFolders = [];
      currentFolders = [];
      message.textContent = "The image library could not be checked for uncataloged packs.";
      message.dataset.tone = "error";
    } finally {
      await refreshAvailability();
    }
  });

  closeButton?.addEventListener("click", () => {
    panel.hidden = true;
    findButton.focus();
  });

  showIgnoredControl?.addEventListener("change", refreshResults);

  list.addEventListener("click", async (event) => {
    const addButton = event.target.closest("[data-add-uncataloged-pack]");
    const ignoreButton = event.target.closest("[data-ignore-uncataloged-pack]");
    const restoreButton = event.target.closest("[data-restore-uncataloged-pack]");
    const folderId =
      addButton?.dataset.addUncatalogedPack ||
      ignoreButton?.dataset.ignoreUncatalogedPack ||
      restoreButton?.dataset.restoreUncatalogedPack;
    const folder = currentFolders.find((candidate) => candidate.id === folderId);

    if (!folder) {
      return;
    }

    if (addButton) {
      panel.hidden = true;
      document.dispatchEvent(
        new CustomEvent("paper-pack:add-from-library", {
          detail: {
            paperPackName: folder.paperPackName
          }
        })
      );
      return;
    }

    const wasIgnored = ignoredFolderIds.has(folder.id);

    try {
      if (restoreButton) {
        ignoredFolderIds.delete(folder.id);
      } else {
        ignoredFolderIds.add(folder.id);
      }

      await saveCatalogSetting(IGNORED_UNCATALOGED_PACK_FOLDERS_SETTING_ID, [...ignoredFolderIds]);
      refreshResults();
    } catch (error) {
      if (wasIgnored) {
        ignoredFolderIds.add(folder.id);
      } else {
        ignoredFolderIds.delete(folder.id);
      }

      message.textContent = `${folder.paperPackName} could not be ${restoreButton ? "restored" : "ignored"} permanently.`;
      message.dataset.tone = "error";
    }
  });

  return refreshAvailability;
}

export function getUncatalogedPackControlPresentation(availability) {
  if (availability?.reason === "unsupported") {
    return { hidden: true, disabled: true, message: "" };
  }

  if (!availability?.available) {
    return {
      hidden: false,
      disabled: true,
      message: "Connect or reconnect a Paper image folder in Settings."
    };
  }

  return { hidden: false, disabled: false, message: "" };
}

function getUncatalogedImageFolderCandidates(folders, paperPacks) {
  const catalogKeys = new Set(
    paperPacks.flatMap((paperPack) => [normalizeFilterText(paperPack.id), normalizeFilterText(paperPack.name)])
  );

  return folders.filter(
    (folder) =>
      !catalogKeys.has(normalizeFilterText(folder.id)) &&
      !catalogKeys.has(normalizeFilterText(folder.paperPackName))
  );
}

async function loadIgnoredUncatalogedPackFolderIds() {
  const savedFolderIds = await loadCatalogSetting(IGNORED_UNCATALOGED_PACK_FOLDERS_SETTING_ID);
  return new Set(Array.isArray(savedFolderIds) ? savedFolderIds.filter((folderId) => typeof folderId === "string") : []);
}

function renderUncatalogedPackFolders(list, folders) {
  list.replaceChildren(...folders.map(createUncatalogedPackFolderItem));
}

function createUncatalogedPackFolderItem(folder) {
  const item = document.createElement("li");
  const details = document.createElement("div");
  const name = document.createElement("strong");
  const count = document.createElement("span");
  const actions = document.createElement("div");
  const addButton = document.createElement("button");
  const ignoreButton = document.createElement("button");

  item.className = folder.ignored ? "uncataloged-pack-item uncataloged-pack-item-ignored" : "uncataloged-pack-item";
  details.className = "uncataloged-pack-details";
  name.textContent = folder.paperPackName;
  count.textContent = `${folder.imageCount} image${folder.imageCount === 1 ? "" : "s"}${folder.ignored ? " · Ignored" : ""}`;
  actions.className = "uncataloged-pack-actions";
  if (folder.ignored) {
    ignoreButton.className = "button";
    ignoreButton.type = "button";
    ignoreButton.dataset.restoreUncatalogedPack = folder.id;
    ignoreButton.textContent = "Restore";
  } else {
    addButton.className = "button button-primary";
    addButton.type = "button";
    addButton.dataset.addUncatalogedPack = folder.id;
    addButton.textContent = "Add to Paper Library";
    ignoreButton.className = "button";
    ignoreButton.type = "button";
    ignoreButton.dataset.ignoreUncatalogedPack = folder.id;
    ignoreButton.textContent = "Ignore";
  }

  details.append(name, count);
  actions.append(...(folder.ignored ? [ignoreButton] : [addButton, ignoreButton]));
  item.append(details, actions);
  return item;
}

function getUncatalogedPackScanMessage(folderCount, ignoredCount = 0, showingIgnored = false) {
  const availableMessage = folderCount === 0
    ? "Every image folder is already cataloged or ignored."
    : `${folderCount} uncataloged paper pack${folderCount === 1 ? "" : "s"} found.`;

  if (!showingIgnored) {
    return availableMessage;
  }

  return `${availableMessage} ${ignoredCount} ignored folder${ignoredCount === 1 ? "" : "s"}.`;
}

function initializeScreenNavigation() {
  const screens = [...document.querySelectorAll("[data-screen]")];
  const navLinks = [...document.querySelectorAll("[data-nav-link]")];
  const sidebarControlGroups = [...document.querySelectorAll("[data-sidebar-controls]")];

  if (screens.length === 0) {
    return;
  }

  function showCurrentScreen() {
    const requestedTargetId = window.location.hash.slice(1) || "library";
    const requestedTarget = document.getElementById(requestedTargetId);
    const activeScreen = requestedTarget?.matches("[data-screen]")
      ? requestedTarget
      : requestedTarget?.closest("[data-screen]") || screens[0];

    for (const screen of screens) {
      screen.hidden = screen !== activeScreen;
    }

    for (const controlGroup of sidebarControlGroups) {
      controlGroup.hidden = controlGroup.dataset.sidebarControls !== activeScreen.id;
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

    if (requestedTarget && requestedTarget !== activeScreen) {
      window.requestAnimationFrame(() => requestedTarget.scrollIntoView());
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
  const seedOwners = data.owners || [];
  const savedPaperPacks = await loadSavedPaperPacks();
  const ownership = await migrateCatalogOwnership(basePaperPacks, savedPaperPacks, seedOwners);
  const paperPacks = await mergePaperPacks(ownership.basePaperPacks, ownership.savedPaperPacks);

  return { paperPacks: await hydratePaperPackImageSources(paperPacks), owners: ownership.owners };
}

function initializeLibrarySearch(paperPackLibrary, paperPacks, colorsById, owners = [], initialTagCatalog) {
  const form = document.querySelector("[data-library-search-form]");
  const input = document.querySelector("[data-library-search-input]");
  const favoritesButton = document.querySelector("[data-library-favorites]");
  const ownerFilter = document.querySelector("[data-library-owner]");
  const holidayFilter = document.querySelector("[data-library-holiday]");
  const clearAllButton = document.querySelector("[data-library-clear-all]");
  const clearTagsButton = document.querySelector("[data-library-clear-tags]");
  const clearColorsButton = document.querySelector("[data-library-clear-colors]");
  const sortControl = document.querySelector("[data-library-sort]");
  const tagFilter = document.querySelector("[data-library-tag-filters]");
  const colorFilter = document.querySelector("[data-library-color-filters]");
  let tagCatalog = initialTagCatalog;

  function renderCurrent() {
    const filterState = getLibraryFilterState(
      input,
      tagFilter,
      colorFilter,
      favoritesButton,
      ownerFilter,
      holidayFilter
    );
    const filteredPaperPacks = applyPaperPackFilters(paperPacks, filterState, colorsById, tagCatalog);
    const hasActiveFilters = hasActivePaperPackFilters(filterState);

    refreshLibraryColorFilters(
      colorFilter,
      getLibraryColorFilterOptions(paperPacks, filteredPaperPacks, filterState.selectedColors, colorsById)
    );

    renderPaperPackLibrary(paperPackLibrary, filteredPaperPacks, colorsById, {
      query: filterState.query,
      selectedTags: filterState.selectedTags,
      selectedColors: filterState.selectedColors,
      hasActiveFilters,
      totalCount: paperPacks.length,
      sortOrder: sortControl?.value || "recently-added"
    });

    if (clearAllButton) {
      clearAllButton.hidden = !hasActiveFilters;
    }

    if (clearTagsButton) {
      clearTagsButton.hidden = !hasGlobalTagFilterSelection(filterState.selectedTags);
    }

    if (clearColorsButton) {
      clearColorsButton.hidden = filterState.selectedColors.length === 0;
    }

    updatePaperQuickFilterStates({ favoritesButton, ownerFilter, holidayFilter });
  }

  if (!form || !input) {
    return {
      renderCurrent: () => renderPaperPackLibrary(paperPackLibrary, paperPacks, colorsById)
    };
  }

  renderGlobalTagFilter(tagFilter, tagCatalog, { inputPrefix: "library", optionsDataAttribute: "libraryFilterOptions" });
  refreshLibraryColorFilters(colorFilter, getAvailableColors(paperPacks, colorsById));
  refreshPaperOwnerFilter(ownerFilter, owners);
  initializeLibraryColorTypeahead(colorFilter, renderCurrent);
  input.addEventListener("input", renderCurrent);
  favoritesButton?.addEventListener("click", () => {
    favoritesButton.setAttribute(
      "aria-pressed",
      String(favoritesButton.getAttribute("aria-pressed") !== "true")
    );
    renderCurrent();
  });
  ownerFilter?.addEventListener("change", renderCurrent);
  holidayFilter?.addEventListener("change", renderCurrent);
  clearAllButton?.addEventListener("click", () => {
    input.value = "";
    favoritesButton?.setAttribute("aria-pressed", "false");
    if (ownerFilter) ownerFilter.value = "";
    if (holidayFilter) holidayFilter.value = "";
    clearGlobalTagFilter(tagFilter);
    clearSelectedLibraryColors(colorFilter);
    renderCurrent();
    input.focus();
  });
  clearTagsButton?.addEventListener("click", () => {
    clearGlobalTagFilter(tagFilter);
    renderCurrent();
  });
  clearColorsButton?.addEventListener("click", () => {
    clearSelectedLibraryColors(colorFilter);
    renderCurrent();
  });
  form.querySelectorAll("[data-library-toggle-filter]").forEach((toggle) => {
    toggle.addEventListener("click", () => toggleFilterSection(toggle));
  });
  tagFilter?.addEventListener("change", (event) => {
    synchronizeGlobalTagFilterChange(event.target, tagFilter);
    renderCurrent();
  });
  sortControl?.addEventListener("change", renderCurrent);
  document.addEventListener("catalog:owners-updated", () => {
    refreshPaperOwnerFilter(ownerFilter, owners);
    renderCurrent();
  });
  document.addEventListener("catalog:global-tags-updated", async () => {
    tagCatalog = await loadGlobalTagCatalog();
    renderGlobalTagFilter(tagFilter, tagCatalog, { inputPrefix: "library", optionsDataAttribute: "libraryFilterOptions" });
    renderCurrent();
  });
  form.addEventListener("submit", (event) => event.preventDefault());

  return {
    renderCurrent
  };
}

function getLibraryFilterState(input, tagFilter, colorFilter, favoritesButton, ownerFilter, holidayFilter) {
  return {
    query: input?.value || "",
    favoritesOnly: favoritesButton?.getAttribute("aria-pressed") === "true",
    ownerId: ownerFilter?.value || "",
    holiday: holidayFilter?.value || "",
    selectedTags: readGlobalTagFilter(tagFilter),
    selectedColors: getSelectedLibraryColors(colorFilter)
  };
}

function hasActivePaperPackFilters(filterState) {
  return Boolean(
    filterState.query.trim() ||
    filterState.favoritesOnly ||
    filterState.ownerId ||
    filterState.holiday ||
    filterState.selectedTags.individualTagIds.length > 0 ||
    filterState.selectedTags.categories.length > 0 ||
    filterState.selectedColors.length > 0
  );
}

function refreshPaperOwnerFilter(select, owners = []) {
  if (!select) {
    return;
  }

  const selectedOwnerId = select.value;
  select.replaceChildren(
    new Option("All", ""),
    ...owners
      .filter(isActiveOwner)
      .slice()
      .sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: "base" }))
      .map((owner) => new Option(owner.name, owner.id))
  );
  select.value = [...select.options].some((option) => option.value === selectedOwnerId)
    ? selectedOwnerId
    : "";
}

function updatePaperQuickFilterStates({ favoritesButton, ownerFilter, holidayFilter }) {
  const favoritesOnly = favoritesButton?.getAttribute("aria-pressed") === "true";
  const favoritesIcon = favoritesButton?.querySelector(".card-library-favorites-icon");

  if (favoritesIcon) {
    favoritesIcon.textContent = favoritesOnly ? "♥" : "♡";
  }

  for (const control of [ownerFilter, holidayFilter]) {
    control?.closest(".card-library-quick-filter")?.classList.toggle("is-active", Boolean(control.value));
  }
}

function applyPaperPackFilters(paperPacks, filterState, colorsById, tagCatalog) {
  return paperPacks.filter((paperPack) =>
    matchesPaperPackFilters(paperPack, filterState, colorsById, tagCatalog)
  );
}

function refreshLibraryColorFilters(container, colors) {
  if (!container) {
    return;
  }

  container.libraryColorOptions = [...colors].sort(compareColorNames);
  renderSelectedLibraryColors(container);
  renderLibraryColorMatches(container);
}

function initializeLibraryColorTypeahead(container, renderCurrent) {
  const searchInput = container?.querySelector("[data-library-color-search]");
  const results = container?.querySelector("[data-library-color-results]");

  if (!container || !searchInput || !results) {
    return;
  }

  searchInput.addEventListener("input", () => renderLibraryColorMatches(container, true));
  searchInput.addEventListener("focus", () => renderLibraryColorMatches(container, true));
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      results.hidden = true;
      searchInput.blur();
    }
  });
  container.addEventListener("focusout", (event) => {
    if (!container.contains(event.relatedTarget)) {
      results.hidden = true;
    }
  });
  container.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-library-color]");

    if (removeButton) {
      removeSelectedLibraryColor(container, removeButton.dataset.removeLibraryColor);
      renderCurrent();
      searchInput.focus();
    }
  });
  container.addEventListener("change", (event) => {
    const option = event.target.closest("[data-library-color-option]");

    if (!option || !event.target.checked) {
      return;
    }

    addSelectedLibraryColor(container, option.dataset.libraryColorOption);
    searchInput.value = "";
    renderCurrent();
    searchInput.focus();
  });
}

function renderLibraryColorMatches(container, showResults = false) {
  const searchInput = container?.querySelector("[data-library-color-search]");
  const results = container?.querySelector("[data-library-color-results]");

  if (!searchInput || !results) {
    return;
  }

  const selectedColors = getSelectedLibraryColors(container);
  const matches = filterLibraryColorOptions(
    container.libraryColorOptions || [],
    searchInput.value,
    selectedColors
  );

  results.replaceChildren(...matches.map(createLibraryColorMatch));
  results.hidden = !showResults || matches.length === 0;
}

export function filterLibraryColorOptions(colors, query = "", selectedColors = []) {
  const normalizedQuery = normalizeFilterText(query);
  const selectedColorIds = new Set(selectedColors);

  return colors
    .filter((color) => !selectedColorIds.has(color.id))
    .filter((color) => !normalizedQuery || normalizeFilterText(color.name).includes(normalizedQuery))
    .sort(compareColorNames);
}

function createLibraryColorMatch(color) {
  const label = document.createElement("label");
  label.className = "library-color-option";
  label.dataset.libraryColorOption = color.id;

  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = "library-color-suggestions";
  input.value = color.id;

  const marker = document.createElement("span");
  const name = document.createElement("span");
  name.textContent = color.name;

  marker.append(createLibraryColorSwatch(color), name);
  label.append(input, marker);
  return label;
}

function renderSelectedLibraryColors(container) {
  const selectedContainer = container?.querySelector("[data-library-color-selected]");

  if (!selectedContainer) {
    return;
  }

  const selectedColorIds = getSelectedLibraryColors(container);
  const colorsById = new Map((container.libraryColorOptions || []).map((color) => [color.id, color]));
  const selectedColors = selectedColorIds.map((colorId) => colorsById.get(colorId)).filter(Boolean);

  selectedContainer.replaceChildren(...selectedColors.map(createSelectedLibraryColor));
}

function createSelectedLibraryColor(color) {
  const chip = document.createElement("span");
  chip.className = "library-color-chip";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = "library-colors";
  input.value = color.id;
  input.checked = true;
  input.hidden = true;

  const name = document.createElement("span");
  name.textContent = color.name;

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.dataset.removeLibraryColor = color.id;
  removeButton.setAttribute("aria-label", `Remove ${color.name}`);
  removeButton.textContent = "×";

  chip.append(input, createLibraryColorSwatch(color), name, removeButton);
  return chip;
}

function createLibraryColorSwatch(color) {
  const swatch = document.createElement("span");
  swatch.className = "pack-color-dot";
  swatch.style.backgroundColor = color.hex;
  swatch.setAttribute("aria-hidden", "true");
  return swatch;
}

function addSelectedLibraryColor(container, colorId) {
  const selectedContainer = container?.querySelector("[data-library-color-selected]");
  const color = (container?.libraryColorOptions || []).find((option) => option.id === colorId);

  if (!selectedContainer || !color || getSelectedLibraryColors(container).includes(colorId)) {
    return;
  }

  selectedContainer.append(createSelectedLibraryColor(color));
}

function removeSelectedLibraryColor(container, colorId) {
  const input = [...(container?.querySelectorAll('input[name="library-colors"]') || [])]
    .find((candidate) => candidate.value === colorId);
  input?.closest(".library-color-chip")?.remove();
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

function getLibraryColorFilterOptions(paperPacks, filteredPaperPacks, selectedColors, colorsById) {
  if ((selectedColors || []).length === 0) {
    return getAvailableColors(paperPacks, colorsById);
  }

  const selectedColorIds = new Set(selectedColors);
  const filteredColors = getAvailableColors(filteredPaperPacks, colorsById);
  const selectedColorOptions = [];
  const remainingColorOptions = [];

  for (const selectedColorId of selectedColors) {
    const selectedColor = colorsById[selectedColorId];

    if (selectedColor) {
      selectedColorOptions.push(selectedColor);
    }
  }

  for (const color of filteredColors) {
    if (!selectedColorIds.has(color.id)) {
      remainingColorOptions.push(color);
    }
  }

  return [
    ...selectedColorOptions.sort(compareColorNames),
    ...remainingColorOptions.sort(compareColorNames)
  ];
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

export function matchesPaperPackFilters(paperPack, filterState, colorsById, tagCatalog) {
  const normalizedQuery = normalizeFilterText(filterState.query);
  const selectedColors = filterState.selectedColors || [];
  const tagNames = getGlobalTagSearchNames(paperPack.tagIds || [], tagCatalog);
  const matchesSelectedTags = matchesGlobalTagFilters(paperPack.tagIds || [], filterState.selectedTags, tagCatalog);
  const matchesSelectedColors =
    selectedColors.length === 0 ||
    selectedColors.some((colorId) => (paperPack.colors || []).includes(colorId));

  if (filterState.favoritesOnly && !paperPack.favorite) {
    return false;
  }

  if (filterState.ownerId && paperPack.ownerId !== filterState.ownerId) {
    return false;
  }

  if (!matchesHolidayFilter(
    paperPack.tagIds || [],
    filterState.holiday,
    resolveHolidayFilterIdentity(tagCatalog),
    tagCatalog
  )) {
    return false;
  }

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
    ...tagNames,
    ...getSearchableColorText(paperPack, colorsById)
  ]
    .join(" ")
    .split(/\s+/)
    .map(normalizeFilterText)
    .join(" ");

  return searchableText.includes(normalizedQuery);
}

function hasGlobalTagFilterSelection(selection = {}) {
  return (selection.individualTagIds || []).length > 0 || (selection.categories || []).length > 0;
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
  const sortOrder = options.sortOrder || "recently-added";
  const availablePaperPacks = sortPaperPacks(
    paperPacks.filter((paperPack) => normalizeAvailability(paperPack.availability) === "available"),
    sortOrder
  );
  const notBoughtPaperPacks = sortPaperPacks(
    paperPacks.filter((paperPack) => normalizeAvailability(paperPack.availability) === "not-bought"),
    sortOrder
  );
  const usedUpPaperPacks = sortPaperPacks(paperPacks.filter(isPaperPackUsedUp), sortOrder);

  updateLibraryResultCount({
    availableCount: availablePaperPacks.length,
    totalCount: options.totalCount ?? paperPacks.length,
    usedUpCount: usedUpPaperPacks.length,
    notBoughtCount: notBoughtPaperPacks.length
  });

  if (paperPacks.length === 0) {
    renderEmptyPaperPackLibrary(
      container,
      options.query,
      options.selectedTags || [],
      options.selectedColors || [],
      options.totalCount,
      options.hasActiveFilters
    );
    return;
  }

  const sections = [];

  if (availablePaperPacks.length > 0) {
    sections.push(createPaperPackGridSection(availablePaperPacks, colorsById));
  } else {
    sections.push(createAvailablePaperPackEmptyMessage(options));
  }

  if (usedUpPaperPacks.length > 0) {
    sections.push(createInactivePaperPackSection(usedUpPaperPacks, colorsById, "Used Up"));
  }

  if (notBoughtPaperPacks.length > 0) {
    sections.push(createInactivePaperPackSection(notBoughtPaperPacks, colorsById, "Not Bought"));
  }

  container.replaceChildren(...sections);
}

function updateLibraryResultCount({ availableCount, totalCount, usedUpCount, notBoughtCount }) {
  const resultCount = document.querySelector("[data-library-result-count]");

  if (!resultCount) {
    return;
  }

  const visibleLabel = `${availableCount}`;
  const totalLabel = `${totalCount}`;
  const packLabel = totalCount === 1 ? "pack" : "packs";
  const usedUpLabel =
    usedUpCount > 0 ? ` ${usedUpCount} used-up ${usedUpCount === 1 ? "pack is" : "packs are"} collapsed below.` : "";
  const notBoughtLabel =
    notBoughtCount > 0 ? ` ${notBoughtCount} not-bought ${notBoughtCount === 1 ? "pack is" : "packs are"} collapsed below.` : "";

  resultCount.textContent = `Showing ${visibleLabel} available of ${totalLabel} ${packLabel}.${usedUpLabel}${notBoughtLabel}`;
}

function createPaperPackGridSection(paperPacks, colorsById) {
  const section = document.createElement("div");

  section.className = "library-pack-section library-pack-grid";
  section.append(...paperPacks.map((paperPack) => createPaperPackCard(paperPack, colorsById)));

  return section;
}

function createAvailablePaperPackEmptyMessage(options = {}) {
  const message = document.createElement("p");
  const hasFilters =
    options.query || hasGlobalTagFilterSelection(options.selectedTags) || (options.selectedColors || []).length > 0;

  message.className = "loading-message library-pack-section";
  message.textContent = hasFilters
    ? "No available paper packs match the current filters."
    : "No available paper packs to display.";

  return message;
}

function createInactivePaperPackSection(paperPacks, colorsById, label) {
  const section = document.createElement("details");
  const summary = document.createElement("summary");
  const title = document.createElement("span");
  const hint = document.createElement("span");
  const grid = document.createElement("div");

  section.className = "used-up-pack-section library-pack-section";
  summary.className = "used-up-pack-summary";
  title.textContent = `${label} (${paperPacks.length})`;
  hint.textContent = "Hidden below available packs";
  grid.className = "library-pack-grid used-up-pack-grid";
  grid.append(...paperPacks.map((paperPack) => createPaperPackCard(paperPack, colorsById)));
  summary.append(title, hint);
  section.append(summary, grid);

  return section;
}

export function sortPaperPacks(paperPacks, sortOrder = "recently-added") {
  if (sortOrder === "recently-added") {
    return [...paperPacks].sort((firstPack, secondPack) => {
      const recentComparison =
        Number(isRecentlyAddedPaperPack(secondPack)) - Number(isRecentlyAddedPaperPack(firstPack));

      return recentComparison || compareTextValues(firstPack.name, secondPack.name);
    });
  }

  if (sortOrder === "favorite-desc") {
    return [...paperPacks].sort((firstPack, secondPack) =>
      Number(Boolean(secondPack.favorite)) - Number(Boolean(firstPack.favorite)) ||
      compareTextValues(firstPack.name, secondPack.name)
    );
  }

  const [field, direction] = String(sortOrder).split("-");
  const multiplier = direction === "desc" ? -1 : 1;

  return [...paperPacks].sort((firstPack, secondPack) => {
    let comparison = 0;

    if (field === "release") {
      comparison = compareReleaseYears(firstPack.releaseYear, secondPack.releaseYear, multiplier);
    } else {
      const firstValue = field === "owner" ? firstPack.owner : firstPack.name;
      const secondValue = field === "owner" ? secondPack.owner : secondPack.name;
      comparison = compareTextValues(firstValue, secondValue) * multiplier;
    }

    return comparison || compareTextValues(firstPack.name, secondPack.name);
  });
}

function compareReleaseYears(firstYear, secondYear, multiplier) {
  const firstValue = Number(firstYear);
  const secondValue = Number(secondYear);
  const firstIsValid = Number.isFinite(firstValue);
  const secondIsValid = Number.isFinite(secondValue);

  if (firstIsValid && secondIsValid) {
    return (firstValue - secondValue) * multiplier;
  }

  if (firstIsValid !== secondIsValid) {
    return firstIsValid ? -1 : 1;
  }

  return 0;
}

function compareTextValues(firstValue, secondValue) {
  return String(firstValue || "").localeCompare(String(secondValue || ""), undefined, {
    sensitivity: "base"
  });
}

function renderEmptyPaperPackLibrary(
  container,
  query,
  selectedTags = {},
  selectedColors = [],
  totalCount = 0,
  hasActiveFilters = false
) {
  const message = document.createElement("p");
  const hasFilters = hasActiveFilters || query || hasGlobalTagFilterSelection(selectedTags) || selectedColors.length > 0;

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

    const candidatePack = mode === "edit" ? paperPack : ensureUniquePaperPackId(paperPack, paperPacks);
    const packToSave = mode === "add" ? { ...candidatePack, recentlyAdded: true } : candidatePack;
    const existingIndex = paperPacks.findIndex((existingPack) => existingPack.id === packToSave.id);

    if (existingIndex === -1) {
      paperPacks.unshift(packToSave);
    } else {
      paperPacks.splice(existingIndex, 1, packToSave);
    }

    renderCurrentLibrary();

    event.detail.saveComplete = preparePaperPackImagesForSave(packToSave)
      .then(async (saveResult) => {
        const preparedPack = saveResult.paperPack;

        await savePaperPack(preparedPack);
        await hydratePaperPackImageSources([preparedPack]);
        replacePaperPack(paperPacks, preparedPack);
        renderCurrentLibrary();
        document.dispatchEvent(new CustomEvent("catalog:paper-pack-saved"));

        return {
          warning: saveResult.warning
        };
      })
      .then((saveResult) => ({
        ok: true,
        warning: saveResult.warning
      }))
      .catch(() => ({
        ok: false,
        displayed: true,
        message:
          "The paper pack is visible for this session, but the browser could not save it permanently. The selected images may be too large for the browser database."
      }));
  });
}

function replacePaperPack(paperPacks, paperPack) {
  const existingIndex = paperPacks.findIndex((existingPack) => existingPack.id === paperPack.id);

  if (existingIndex !== -1) {
    paperPacks.splice(existingIndex, 1, paperPack);
  }
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
  card.className = isPaperPackUsedUp(paperPack) ? "dsp-card dsp-card-used-up" : "dsp-card";
  card.dataset.paperPackCard = "";
  card.dataset.packId = paperPack.id;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Open ${paperPack.name}`);

  const patterns = paperPack.patterns || [];
  const isExpanded = areAllLibraryPatternsExpanded
    ? !collapsedLibraryPaperPacks.has(paperPack.id)
    : expandedLibraryPaperPacks.has(paperPack.id);
  const visiblePatterns = isExpanded ? patterns : patterns.slice(0, LIBRARY_PATTERN_PREVIEW_LIMIT);
  const patternGrid = createPatternGrid(
    { ...paperPack, patterns: visiblePatterns },
    { preferThumbnail: true }
  );
  const contextBar = createCardContextBar(paperPack);
  const cardBody = document.createElement("div");
  cardBody.className = "card-body";

  const titleRow = document.createElement("div");
  titleRow.className = "card-title-row";

  const title = document.createElement("h4");
  title.textContent = paperPack.name;
  const favorite = createPaperPackFavoriteButton(paperPack);
  titleRow.append(title, favorite);

  const keywords = createKeywordList(paperPack);
  const colorList = createPackColorList(paperPack, colorsById);
  const availability = createAvailabilityIndicator(paperPack);
  const meta = document.createElement("p");
  const releaseYear = String(paperPack.releaseYear || "").trim();
  meta.className = "card-meta";
  meta.textContent = [paperPack.owner, releaseYear].filter(Boolean).join(" · ");
  const editButton = createEditPaperPackButton(paperPack);

  cardBody.append(colorList, keywords, availability, meta);

  if (contextBar) {
    card.append(contextBar);
  }

  card.append(titleRow, patternGrid);

  if (patterns.length > LIBRARY_PATTERN_PREVIEW_LIMIT) {
    const patternToggle = document.createElement("button");
    const hiddenPatternCount = patterns.length - LIBRARY_PATTERN_PREVIEW_LIMIT;

    patternToggle.className = "pattern-expand-button";
    patternToggle.type = "button";
    patternToggle.dataset.togglePackPatterns = paperPack.id;
    patternToggle.setAttribute("aria-expanded", `${isExpanded}`);
    patternToggle.textContent = isExpanded ? "Show less" : `+ See ${hiddenPatternCount} more`;
    card.append(patternToggle);
  }

  card.append(cardBody, editButton);

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

function createPaperPackFavoriteButton(paperPack) {
  const favorite = document.createElement("button");
  favorite.className = "paper-pack-favorite";
  favorite.type = "button";
  favorite.dataset.togglePackFavorite = paperPack.id;
  favorite.dataset.favorite = String(Boolean(paperPack.favorite));
  favorite.setAttribute("aria-label", paperPack.favorite ? "Remove paper pack from favorites" : "Add paper pack to favorites");
  favorite.setAttribute("aria-pressed", String(Boolean(paperPack.favorite)));
  favorite.title = paperPack.favorite ? "Remove from favorites" : "Add to favorites";
  favorite.textContent = "\u2665";
  return favorite;
}

function createCardContextBar(paperPack) {
  const context = getCardContext(paperPack);

  if (!context) {
    return null;
  }

  const contextBar = document.createElement("div");
  contextBar.className = "card-context-bar";

  const label = document.createElement("span");
  label.textContent = context.label;

  const clearButton = document.createElement("button");
  clearButton.className = "card-context-clear";
  clearButton.type = "button";
  clearButton.dataset.clearRecentlyAdded = paperPack.id;
  clearButton.textContent = "×";
  clearButton.setAttribute("aria-label", `Clear Recently Added status for ${paperPack.name}`);
  clearButton.title = "Clear Recently Added status";

  contextBar.append(label, clearButton);

  return contextBar;
}

function getCardContext(paperPack) {
  if (isRecentlyAddedPaperPack(paperPack)) {
    return {
      label: "Recently Added"
    };
  }

  return null;
}

function isRecentlyAddedPaperPack(paperPack) {
  return paperPack.recentlyAdded === true;
}

function initializeDetailPanel(paperPackLibrary, paperPacks, colorsById, renderCurrentLibrary) {
  const detailPanel = document.querySelector("[data-detail-panel]");
  const detailTitle = document.querySelector("[data-detail-title]");
  const detailBody = document.querySelector("[data-detail-body]");
  const detailClose = document.querySelector("[data-detail-close]");
  const detailBack = document.querySelector("[data-detail-back]");

  if (!detailPanel || !detailTitle || !detailBody) {
    return;
  }

  paperPackLibrary.addEventListener("click", (event) => {
    const favoriteButton = event.target.closest("[data-toggle-pack-favorite]");

    if (favoriteButton) {
      event.preventDefault();
      event.stopPropagation();
      togglePaperPackFavorite(
        favoriteButton.dataset.togglePackFavorite,
        paperPacks,
        favoriteButton,
        renderCurrentLibrary
      );
      return;
    }

    const patternToggle = event.target.closest("[data-toggle-pack-patterns]");

    if (patternToggle) {
      event.preventDefault();
      event.stopPropagation();

      const paperPackId = patternToggle.dataset.togglePackPatterns;

      const isCurrentlyExpanded = areAllLibraryPatternsExpanded
        ? !collapsedLibraryPaperPacks.has(paperPackId)
        : expandedLibraryPaperPacks.has(paperPackId);

      if (areAllLibraryPatternsExpanded) {
        if (isCurrentlyExpanded) {
          collapsedLibraryPaperPacks.add(paperPackId);
        } else {
          collapsedLibraryPaperPacks.delete(paperPackId);
        }
      } else if (isCurrentlyExpanded) {
        expandedLibraryPaperPacks.delete(paperPackId);
      } else {
        expandedLibraryPaperPacks.add(paperPackId);
      }

      renderCurrentLibrary();
      paperPackLibrary
        .querySelector(`[data-toggle-pack-patterns="${CSS.escape(paperPackId)}"]`)
        ?.focus();
      return;
    }

    const markUsedUpButton = event.target.closest("[data-mark-used-up]");

    if (markUsedUpButton) {
      event.preventDefault();
      event.stopPropagation();
      markPaperPackUsedUp(markUsedUpButton.dataset.markUsedUp, paperPacks, renderCurrentLibrary);
      return;
    }

    const clearRecentlyAddedButton = event.target.closest("[data-clear-recently-added]");

    if (clearRecentlyAddedButton) {
      event.preventDefault();
      event.stopPropagation();
      clearRecentlyAddedStatus(
        clearRecentlyAddedButton.dataset.clearRecentlyAdded,
        paperPacks,
        renderCurrentLibrary
      );
      return;
    }

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

    if (
      !card ||
      event.target.closest(
        "[data-edit-pack], [data-clear-recently-added], [data-mark-used-up], [data-toggle-pack-patterns], [data-toggle-pack-favorite]"
      )
    ) {
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

    const relatedCard = event.target.closest("[data-related-card-id]");

    if (relatedCard) {
      document.dispatchEvent(
        new CustomEvent("card:detail-request", {
          detail: {
            cardId: relatedCard.dataset.relatedCardId,
            sourcePaperPackId: detailPanel.dataset.selectedPackId,
            sourceElement: relatedCard
          }
        })
      );
      return;
    }

    const patternPreviewButton = event.target.closest("[data-detail-pattern-preview]");

    if (patternPreviewButton) {
      const selectedPack = paperPacks.find((pack) => pack.id === detailPanel.dataset.selectedPackId);
      const patternIndex = Number(patternPreviewButton.dataset.detailPatternPreview);

      if (selectedPack && Number.isInteger(patternIndex)) {
        openPatternPreview(detailBody, selectedPack, patternIndex);
      }

      return;
    }

    if (event.target.closest("[data-pattern-viewer-close]")) {
      closePatternPreview(detailBody);
      return;
    }

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

  detailBack?.addEventListener("click", (event) => {
    event.stopPropagation();
    const cardId = detailPanel.dataset.sourceCardId;

    if (!cardId) {
      return;
    }

    const sourcePaperPackId = detailPanel.dataset.sourceCardPaperPackId;
    document.dispatchEvent(
      new CustomEvent("card:detail-request", {
        detail: { cardId, sourcePaperPackId }
      })
    );
  });

  document.addEventListener("paper-pack:detail-request", (event) => {
    const paperPack = paperPacks.find((pack) => pack.id === event.detail?.paperPackId);

    if (paperPack) {
      window.location.hash = "library";
      openDetailPanel(detailPanel, detailTitle, detailBody, paperPack, paperPacks, colorsById, null, {
        cardId: event.detail?.sourceCardId,
        sourcePaperPackId: event.detail?.sourcePaperPackId
      });
    }
  });

  document.addEventListener("click", (event) => {
    if (detailPanel.hidden || detailPanel.contains(event.target)) {
      return;
    }

    closeDetailPanel(detailPanel);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !detailPanel.hidden) {
      const patternViewer = detailBody.querySelector("[data-pattern-viewer]");

      if (patternViewer && !patternViewer.hidden) {
        closePatternPreview(detailBody);
        return;
      }

      closeDetailPanel(detailPanel);
    }
  });
}

async function togglePaperPackFavorite(paperPackId, paperPacks, button, renderCurrentLibrary) {
  const paperPack = paperPacks.find((pack) => pack.id === paperPackId);

  if (!paperPack) {
    return;
  }

  const updatedPaperPack = {
    ...paperPack,
    favorite: !paperPack.favorite,
    updatedAt: new Date().toISOString()
  };
  button.disabled = true;

  try {
    await savePaperPack(updatedPaperPack);
    replacePaperPack(paperPacks, updatedPaperPack);
    renderCurrentLibrary();
    document.querySelector(`[data-toggle-pack-favorite="${CSS.escape(paperPackId)}"]`)?.focus();
  } catch (error) {
    button.disabled = false;
    window.alert("The paper pack favorite status could not be saved.");
  }
}

function clearRecentlyAddedStatus(paperPackId, paperPacks, renderCurrentLibrary) {
  const paperPack = paperPacks.find((pack) => pack.id === paperPackId);

  if (!paperPack || !isRecentlyAddedPaperPack(paperPack)) {
    return;
  }

  const updatedPaperPack = {
    ...paperPack,
    recentlyAdded: false
  };

  replacePaperPack(paperPacks, updatedPaperPack);
  renderCurrentLibrary();

  savePaperPack(updatedPaperPack).catch(() => {
    window.alert("The Recently Added status was cleared for this session, but the change could not be saved permanently.");
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
  coordinatingColor = null,
  cardReturn = null
) {
  detailPanel.hidden = false;
  detailPanel.dataset.selectedPackId = paperPack.id;
  applyPaperPackDetailCardSourceState(
    detailPanel,
    detailPanel.querySelector("[data-detail-back]"),
    cardReturn?.cardId,
    cardReturn?.sourcePaperPackId
  );
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
  applyPaperPackDetailCardSourceState(
    detailPanel,
    detailPanel.querySelector("[data-detail-back]")
  );
}

export function applyPaperPackDetailCardSourceState(
  detailPanel,
  backControl,
  sourceCardId = "",
  sourcePaperPackId = ""
) {
  if (sourceCardId) {
    detailPanel.dataset.sourceCardId = sourceCardId;
  } else {
    delete detailPanel.dataset.sourceCardId;
  }

  if (sourcePaperPackId) {
    detailPanel.dataset.sourceCardPaperPackId = sourcePaperPackId;
  } else {
    delete detailPanel.dataset.sourceCardPaperPackId;
  }

  if (backControl) {
    backControl.hidden = !sourceCardId;
  }
}

function createDetailContent(paperPack, paperPacks, colorsById) {
  const content = document.createElement("div");
  content.className = "detail-content";

  const preview = createPatternGrid(paperPack, {
    interactive: true,
    paperPackName: paperPack.name
  });
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

  const relatedCardsSection = createRelatedCardsSection(paperPack, cardsForPaperPackDetails);

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
  metadata.append(colorSection, tagSection, createDetailMeta(paperPack));

  if (relatedCardsSection) {
    metadata.append(relatedCardsSection);
  }

  metadata.append(coordinationSection, createDetailActions(paperPack));
  content.append(preview, metadata, createPatternViewer());

  return content;
}

function createRelatedCardsSection(paperPack, cards) {
  const relatedCards = findCardsUsingPaperPack(cards, paperPack.id);

  if (relatedCards.length === 0) {
    return null;
  }

  const section = document.createElement("section");
  section.className = "detail-section related-cards-section";

  const heading = document.createElement("h4");
  heading.textContent = "Cards Using This Paper";

  const grid = document.createElement("div");
  grid.className = "related-cards-grid";

  for (const card of relatedCards) {
    const imageSource = getCardLibraryImageSource(card);
    const button = document.createElement("button");
    button.className = "related-card-link";
    button.type = "button";
    button.dataset.relatedCardId = card.id;
    button.setAttribute("aria-label", "Open card details");

    if (!imageSource) {
      const placeholder = document.createElement("div");
      placeholder.className = "related-card-thumbnail related-card-thumbnail-missing";
      placeholder.textContent = "No image yet";
      button.append(placeholder);
      grid.append(button);
      continue;
    }

    const image = document.createElement("img");
    image.className = "related-card-thumbnail";
    image.src = imageSource;
    image.alt = "Handmade card using this paper";
    image.decoding = "async";
    button.append(image);
    grid.append(button);
  }

  section.append(heading, grid);
  return section;
}

function createPatternViewer() {
  const viewer = document.createElement("div");
  const backdrop = document.createElement("button");
  const dialog = document.createElement("div");
  const header = document.createElement("div");
  const title = document.createElement("h4");
  const closeButton = document.createElement("button");
  const imageFrame = document.createElement("div");

  viewer.className = "pattern-viewer";
  viewer.dataset.patternViewer = "";
  viewer.hidden = true;
  backdrop.className = "pattern-viewer-backdrop";
  backdrop.type = "button";
  backdrop.dataset.patternViewerClose = "";
  backdrop.setAttribute("aria-label", "Close pattern preview");
  dialog.className = "pattern-viewer-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "pattern-viewer-title");
  header.className = "pattern-viewer-header";
  title.id = "pattern-viewer-title";
  title.dataset.patternViewerTitle = "";
  closeButton.className = "detail-close";
  closeButton.type = "button";
  closeButton.dataset.patternViewerClose = "";
  closeButton.setAttribute("aria-label", "Close pattern preview");
  closeButton.textContent = "\u00d7";
  imageFrame.className = "pattern-viewer-image";
  imageFrame.dataset.patternViewerImage = "";

  header.append(title, closeButton);
  dialog.append(header, imageFrame);
  viewer.append(backdrop, dialog);

  return viewer;
}

function openPatternPreview(detailBody, paperPack, patternIndex) {
  const viewer = detailBody.querySelector("[data-pattern-viewer]");
  const title = viewer?.querySelector("[data-pattern-viewer-title]");
  const imageFrame = viewer?.querySelector("[data-pattern-viewer-image]");
  const patternEntry = paperPack.patterns?.[patternIndex];

  if (!viewer || !title || !imageFrame || patternEntry === undefined) {
    return;
  }

  title.textContent = getPatternPreviewTitle(paperPack, patternEntry, patternIndex);
  imageFrame.replaceChildren(createEnlargedPatternPreview(patternEntry, patternIndex));
  viewer.hidden = false;
  viewer.querySelector("[data-pattern-viewer-close]")?.focus();
}

function closePatternPreview(detailBody) {
  const viewer = detailBody.querySelector("[data-pattern-viewer]");

  if (!viewer) {
    return;
  }

  viewer.hidden = true;
  viewer.querySelector("[data-pattern-viewer-image]")?.replaceChildren();
}

function createEnlargedPatternPreview(patternEntry, index) {
  const patternObject = patternEntry && typeof patternEntry === "object" ? patternEntry : null;
  const imageSrc = getPatternImageSource(patternEntry);

  if (imageSrc) {
    const image = document.createElement("img");

    image.src = imageSrc;
    image.alt = patternObject?.imageName || `Pattern ${index + 1}`;

    return image;
  }

  const pattern = document.createElement("span");

  pattern.className = getPatternPreviewClassName(patternEntry, "pattern-viewer-placeholder");
  pattern.setAttribute("aria-label", `No image available for pattern ${index + 1}`);

  return pattern;
}

function getPatternPreviewTitle(paperPack, patternEntry, index) {
  const patternObject = patternEntry && typeof patternEntry === "object" ? patternEntry : null;

  return patternObject?.imageName || `${paperPack.name} pattern ${index + 1}`;
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

  deletePaperPack(selectedPack.id).catch(() => {
    window.alert("The paper pack was removed from this session, but the browser could not save the deletion permanently.");
  });

  const selectedPackIndex = paperPacks.findIndex((paperPack) => paperPack.id === selectedPack.id);

  if (selectedPackIndex !== -1) {
    paperPacks.splice(selectedPackIndex, 1);
  }

  renderCurrentLibrary();
  closeDetailPanel(detailPanel);
}

function createAvailabilityIndicator(paperPack) {
  const control = document.createElement("div");
  const indicator = document.createElement("p");
  const normalizedAvailability = normalizeAvailability(paperPack.availability);

  control.className = "availability-control";
  indicator.className = `availability-indicator availability-${normalizedAvailability}`;
  indicator.textContent = formatAvailabilityLabel(normalizedAvailability);
  control.append(indicator);

  if (normalizedAvailability === "available") {
    const markUsedUpButton = document.createElement("button");
    markUsedUpButton.className = "availability-clear";
    markUsedUpButton.type = "button";
    markUsedUpButton.dataset.markUsedUp = paperPack.id;
    markUsedUpButton.textContent = "\u00d7";
    markUsedUpButton.setAttribute("aria-label", `Mark ${paperPack.name} as used up`);
    markUsedUpButton.title = "Mark as used up";
    control.append(markUsedUpButton);
  }

  return control;
}

function markPaperPackUsedUp(paperPackId, paperPacks, renderCurrentLibrary) {
  const paperPack = paperPacks.find((pack) => pack.id === paperPackId);

  if (!paperPack || isPaperPackUsedUp(paperPack)) {
    return;
  }

  const updatedPaperPack = {
    ...paperPack,
    availability: "used-up"
  };

  replacePaperPack(paperPacks, updatedPaperPack);
  renderCurrentLibrary();

  savePaperPack(updatedPaperPack).catch(() => {
    replacePaperPack(paperPacks, paperPack);
    renderCurrentLibrary();
    window.alert(`${paperPack.name} could not be marked as used up.`);
  });
}

function normalizeAvailability(availability) {
  return ["not-bought", "used-up"].includes(availability) ? availability : "available";
}

function isPaperPackUsedUp(paperPack) {
  return normalizeAvailability(paperPack.availability) === "used-up";
}

function formatAvailabilityLabel(availability) {
  const labels = { available: "Available", "not-bought": "Not Bought", "used-up": "Used Up" };
  return labels[normalizeAvailability(availability)];
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

function createPatternGrid(paperPack, options = {}) {
  const patternGrid = document.createElement("div");
  patternGrid.className = "pattern-grid";
  patternGrid.setAttribute("aria-label", `All sample patterns for ${paperPack.name}`);

  const patterns = paperPack.patterns || [];

  patternGrid.append(...patterns.map((patternEntry, index) => createPatternPreview(patternEntry, index, options)));

  return patternGrid;
}

function createPatternPreview(patternEntry, index, options = {}) {
  const pattern = options.interactive ? document.createElement("button") : document.createElement("span");
  const patternObject = patternEntry && typeof patternEntry === "object" ? patternEntry : null;
  const imageSrc = options.preferThumbnail
    ? getPaperLibraryImageSource(patternEntry)
    : getPatternImageSource(patternEntry);
  const imageName = patternObject?.imageName || "";

  if (options.interactive) {
    pattern.type = "button";
    pattern.dataset.detailPatternPreview = `${index}`;
    pattern.setAttribute(
      "aria-label",
      `View larger ${imageName || `${options.paperPackName || "paper pack"} pattern ${index + 1}`}`
    );
  }

  if (imageSrc) {
    const image = document.createElement("img");
    image.src = imageSrc;
    image.alt = imageName || `Pattern ${index + 1}`;

    pattern.className = getPatternPreviewClassName(patternEntry, "pattern-image", options.interactive);
    pattern.append(image);

    return pattern;
  }

  pattern.className = getPatternPreviewClassName(patternEntry, "pattern-placeholder", options.interactive);

  if (!options.interactive) {
    pattern.setAttribute("aria-label", `No image available for pattern ${index + 1}`);
  }

  return pattern;
}

function getPatternPreviewClassName(patternEntry, baseClassName, isInteractive = false) {
  const patternClass = typeof patternEntry === "string" ? PATTERN_CLASS_MAP[patternEntry] : "";
  const interactiveClass = isInteractive ? " pattern-preview-button" : "";

  return `pattern ${baseClassName}${patternClass ? ` ${patternClass}` : ""}${interactiveClass}`;
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

function initializeColorReferenceControls(container, colors) {
  const modeControl = document.querySelector("[data-color-reference-mode]");
  const valueControl = document.querySelector("[data-color-reference-value]");
  const getCurrentColors = () => container.colorReferenceColors || colors;

  renderColorReference(container, colors);

  modeControl?.addEventListener("change", () => {
    if (valueControl) {
      clearSelectedOptions(valueControl);
    }

    renderColorReference(container, getCurrentColors());
  });
  valueControl?.addEventListener("change", () => renderColorReference(container, getCurrentColors()));

  container.addEventListener("click", (event) => {
    const colorButton = event.target.closest("[data-color-detail]");

    if (!colorButton) {
      return;
    }

    const color = getCurrentColors().find((candidateColor) => candidateColor.id === colorButton.dataset.colorDetail);

    if (color) {
      openColorDetail(container, color);
    }
  });

  container.addEventListener("click", (event) => {
    if (event.target.closest("[data-color-detail-close]")) {
      closeColorDetail(container);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeColorDetail(container);
    }
  });
}

function renderColorReference(container, colors) {
  const modeControl = document.querySelector("[data-color-reference-mode]");
  const valueControl = document.querySelector("[data-color-reference-value]");
  const summary = document.querySelector("[data-color-reference-summary]");
  const groupMode = getColorReferenceGroupMode(modeControl?.value);
  const selectedGroups = getValidColorReferenceGroupValues(
    colors,
    groupMode,
    getSelectedOptionValues(valueControl)
  );
  const filteredColors = getColorReferenceFilteredColors(colors, groupMode, selectedGroups);

  container.colorReferenceColors = colors;
  refreshColorReferenceGroupOptions(valueControl, colors, groupMode, selectedGroups);
  renderColorLibrary(container, filteredColors, { groupMode });

  if (summary) {
    summary.textContent = getColorReferenceSummary(filteredColors, colors, groupMode, selectedGroups);
  }
}

function renderColorLibrary(container, colors, options = {}) {
  const groupMode = getColorReferenceGroupMode(options.groupMode);

  container.replaceChildren(
    ...groupColors(colors, groupMode).map(([groupValue, groupColorsForSection]) =>
      createColorFamilyGroup(groupValue, groupColorsForSection, groupMode)
    ),
    createColorDetailViewer()
  );
}

function groupColors(colors, groupMode = "color-family") {
  const sortedColors = [...colors].sort(
    groupMode === "collection" ? compareColorsByCollection : compareColors
  );
  const groups = new Map();

  for (const color of sortedColors) {
    const groupValue = getColorReferenceGroupValue(color, groupMode);

    if (!groups.has(groupValue)) {
      groups.set(groupValue, []);
    }

    groups.get(groupValue).push(color);
  }

  return [...groups.entries()].sort(
    groupMode === "collection" ? compareColorCollections : compareColorFamilies
  );
}

function getColorReferenceGroupMode(value) {
  return value === "collection" ? "collection" : "color-family";
}

function getColorReferenceGroupValue(color, groupMode) {
  if (groupMode === "collection") {
    return color.family || "legacy";
  }

  return color.colorFamily || "neutral";
}

function getValidColorReferenceGroupValues(colors, groupMode, selectedGroups) {
  if (!selectedGroups.length) {
    return [];
  }

  const availableGroups = new Set(
    groupColors(colors, groupMode).map(([groupValue]) => groupValue)
  );

  return selectedGroups.filter((selectedGroup) => availableGroups.has(selectedGroup));
}

function refreshColorReferenceGroupOptions(valueControl, colors, groupMode, selectedGroups) {
  if (!valueControl) {
    return;
  }

  const selectedGroupSet = new Set(selectedGroups);
  const options = groupColors(colors, groupMode).map(([groupValue]) => ({
    value: groupValue,
    label: getColorReferenceGroupLabel(groupValue, groupMode)
  }));

  valueControl.replaceChildren(...options.map(({ value, label }) => createColorReferenceOption(value, label)));

  for (const option of valueControl.options) {
    option.selected = selectedGroupSet.has(option.value);
  }
}

function createColorReferenceOption(value, label) {
  const option = document.createElement("option");

  option.value = value;
  option.textContent = label;

  return option;
}

function getColorReferenceFilteredColors(colors, groupMode, selectedGroups) {
  if (!selectedGroups.length) {
    return colors;
  }

  const selectedGroupSet = new Set(selectedGroups);

  return colors.filter((color) => selectedGroupSet.has(getColorReferenceGroupValue(color, groupMode)));
}

function getColorReferenceSummary(filteredColors, colors, groupMode, selectedGroups) {
  const colorLabel = filteredColors.length === 1 ? "color" : "colors";

  if (!selectedGroups.length) {
    const groupLabel = groupMode === "collection" ? "collections" : "color families";

    return `${filteredColors.length} ${colorLabel} across ${groupColors(colors, groupMode).length} ${groupLabel}.`;
  }

  return `${filteredColors.length} ${colorLabel} in ${formatSelectedColorReferenceGroups(selectedGroups, groupMode)}.`;
}

function compareColors(firstColor, secondColor) {
  const familyComparison =
    getColorFamilyRank(firstColor.colorFamily) - getColorFamilyRank(secondColor.colorFamily);

  if (familyComparison !== 0) {
    return familyComparison;
  }

  return firstColor.name.localeCompare(secondColor.name);
}

function compareColorsByCollection(firstColor, secondColor) {
  const collectionComparison =
    getColorCollectionRank(firstColor.family) - getColorCollectionRank(secondColor.family);

  if (collectionComparison !== 0) {
    return collectionComparison;
  }

  return compareColorNames(firstColor, secondColor);
}

function compareColorNames(firstColor, secondColor) {
  return firstColor.name.localeCompare(secondColor.name, undefined, {
    sensitivity: "base"
  });
}

function compareColorFamilies([firstFamily], [secondFamily]) {
  return getColorFamilyRank(firstFamily) - getColorFamilyRank(secondFamily);
}

function compareColorCollections([firstCollection], [secondCollection]) {
  return getColorCollectionRank(firstCollection) - getColorCollectionRank(secondCollection);
}

function getColorFamilyRank(colorFamily) {
  const rank = COLOR_FAMILY_ORDER.indexOf(colorFamily);

  return rank === -1 ? COLOR_FAMILY_ORDER.length : rank;
}

function getColorCollectionRank(collection) {
  const rank = COLOR_COLLECTION_ORDER.indexOf(collection);

  return rank === -1 ? COLOR_COLLECTION_ORDER.length : rank;
}

function createColorFamilyGroup(groupValue, colors, groupMode = "color-family") {
  const section = document.createElement("section");
  const headingId = `${groupMode}-${groupValue}-colors-title`;

  section.className = "color-family-group";
  section.setAttribute("aria-labelledby", headingId);

  const heading = document.createElement("h4");
  heading.id = headingId;
  heading.textContent = getColorReferenceGroupLabel(groupValue, groupMode);

  const markerGrid = document.createElement("div");
  markerGrid.className = "color-marker-grid";

  markerGrid.append(...colors.map(createColorMarker));
  section.append(heading, markerGrid);

  return section;
}

function getColorReferenceGroupLabel(groupValue, groupMode = "color-family") {
  if (groupMode === "collection") {
    return COLOR_COLLECTION_LABELS[groupValue] || formatColorFamily(groupValue);
  }

  return COLOR_FAMILY_LABELS[groupValue] || formatColorFamily(groupValue);
}

function formatSelectedColorReferenceGroups(selectedGroups, groupMode = "color-family") {
  return selectedGroups
    .map((groupValue) => getColorReferenceGroupLabel(groupValue, groupMode))
    .join(", ");
}

function getSelectedOptionValues(selectControl) {
  if (!selectControl) {
    return [];
  }

  return [...selectControl.selectedOptions].map((option) => option.value).filter(Boolean);
}

function clearSelectedOptions(selectControl) {
  if (!selectControl) {
    return;
  }

  for (const option of selectControl.options) {
    option.selected = false;
  }
}

function createColorMarker(color) {
  const marker = document.createElement("button");
  marker.className = "color-marker";
  marker.type = "button";
  marker.dataset.colorId = color.id;
  marker.dataset.colorDetail = color.id;
  marker.title = `${color.name} ${color.hex}`;
  marker.setAttribute("aria-label", `View details for ${color.name}`);

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

function createColorDetailViewer() {
  const viewer = document.createElement("div");
  const backdrop = document.createElement("button");
  const dialog = document.createElement("div");
  const header = document.createElement("div");
  const title = document.createElement("h4");
  const closeButton = document.createElement("button");
  const body = document.createElement("div");

  viewer.className = "color-detail-viewer";
  viewer.dataset.colorDetailViewer = "";
  viewer.hidden = true;
  backdrop.className = "pattern-viewer-backdrop";
  backdrop.type = "button";
  backdrop.dataset.colorDetailClose = "";
  backdrop.setAttribute("aria-label", "Close color details");
  dialog.className = "color-detail-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "color-detail-title");
  header.className = "pattern-viewer-header";
  title.id = "color-detail-title";
  title.dataset.colorDetailTitle = "";
  closeButton.className = "detail-close";
  closeButton.type = "button";
  closeButton.dataset.colorDetailClose = "";
  closeButton.setAttribute("aria-label", "Close color details");
  closeButton.textContent = "\u00d7";
  body.className = "color-detail-body";
  body.dataset.colorDetailBody = "";

  header.append(title, closeButton);
  dialog.append(header, body);
  viewer.append(backdrop, dialog);

  return viewer;
}

function openColorDetail(container, color) {
  const viewer = container.querySelector("[data-color-detail-viewer]");
  const title = viewer?.querySelector("[data-color-detail-title]");
  const body = viewer?.querySelector("[data-color-detail-body]");

  if (!viewer || !title || !body) {
    return;
  }

  title.textContent = color.name;
  body.replaceChildren(createColorDetailContent(color));
  viewer.hidden = false;
  viewer.querySelector("[data-color-detail-close]")?.focus();
}

function closeColorDetail(container) {
  const viewer = container.querySelector("[data-color-detail-viewer]");

  if (!viewer) {
    return;
  }

  viewer.hidden = true;
  viewer.querySelector("[data-color-detail-body]")?.replaceChildren();
}

function createColorDetailContent(color) {
  const content = document.createElement("div");
  const swatch = document.createElement("span");
  const metadata = document.createElement("dl");

  content.className = "color-detail-content";
  swatch.className = "color-detail-swatch";
  swatch.style.backgroundColor = color.hex;
  swatch.setAttribute("aria-label", `${color.name} swatch`);
  metadata.className = "color-detail-list";

  metadata.append(
    createColorDetailItem("Color ID", color.id),
    createColorDetailItem("HEX", color.hex),
    createColorDetailItem("RGB", formatRgbValue(color.rgb)),
    createColorDetailItem("Collection", getColorReferenceGroupLabel(color.family || "legacy", "collection")),
    createColorDetailItem("Color Family", getColorReferenceGroupLabel(color.colorFamily || "neutral")),
    createColorDetailItem("Collection Years", color.collectionYears || "Not specified"),
    createColorDetailItem("Status", formatColorStatus(color.status)),
    createColorDetailItem("Aliases", (color.aliases || []).join(", ") || "None"),
    createColorDetailItem("Cardstock", formatMetadataValue(color.products?.cardstock)),
    createColorDetailItem("Ink", formatMetadataValue(color.products?.ink)),
    createColorDetailItem("DSP", formatMetadataValue(color.products?.dsp)),
    createColorDetailItem("Marker", formatMetadataValue(color.products?.marker)),
    createColorDetailItem("Blend", formatMetadataValue(color.products?.blend))
  );

  content.append(swatch, metadata);

  return content;
}

function createColorDetailItem(label, value) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");

  term.textContent = label;
  description.textContent = value;
  wrapper.append(term, description);

  return wrapper;
}

function formatRgbValue(rgb) {
  return Array.isArray(rgb) && rgb.length === 3 ? rgb.join(", ") : "Not specified";
}

function formatColorStatus(status) {
  return status ? formatColorFamily(status) : "Unknown";
}

function formatMetadataValue(value) {
  if (value === null || value === undefined || value === "") {
    return "Not specified";
  }

  if (value === true) {
    return "Available";
  }

  if (value === false) {
    return "Not available";
  }

  return `${value}`;
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
