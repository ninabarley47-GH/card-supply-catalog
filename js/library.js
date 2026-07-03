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

    if (paperPackLibrary) {
      renderPaperPackLibrary(paperPackLibrary, paperPacks, colorsById);
      initializeDetailPanel(paperPackLibrary, paperPacks, colorsById);
    }

    if (colorLibrary) {
      renderColorLibrary(colorLibrary, colors);
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

  return response.json();
}

async function loadPaperPacks() {
  const response = await fetch("data/paper-packs.json");

  if (!response.ok) {
    throw new Error("Unable to load paper-packs.json");
  }

  const data = await response.json();

  return data.paperPacks || [];
}

function renderPaperPackLibrary(container, paperPacks, colorsById) {
  if (paperPacks.length === 0) {
    renderError(container, "No paper packs to display yet.");
    return;
  }

  container.replaceChildren(
    ...paperPacks.map((paperPack) => createPaperPackCard(paperPack, colorsById))
  );
}

function createPaperPackCard(paperPack, colorsById) {
  const card = document.createElement("a");
  card.className = "dsp-card";
  card.href = `#${paperPack.id}`;
  card.dataset.paperPackCard = "";
  card.dataset.packId = paperPack.id;
  card.setAttribute("aria-label", `Open ${paperPack.name}`);

  const patternGrid = createPatternGrid(paperPack);
  const cardBody = document.createElement("div");
  cardBody.className = "card-body";

  const titleRow = document.createElement("div");
  titleRow.className = "card-title-row";

  const title = document.createElement("h4");
  title.textContent = paperPack.name;
  titleRow.append(title);

  if (paperPack.availability === "used-up") {
    const badge = document.createElement("span");
    badge.className = "availability used-up";
    badge.textContent = "Used Up";
    titleRow.append(badge);
  }

  const keywords = createKeywordList(paperPack);
  const colorList = createPackColorList(paperPack, colorsById);
  const meta = document.createElement("p");
  meta.className = "card-meta";
  meta.textContent = `${paperPack.owner} - ${paperPack.releaseYear} Release - ${paperPack.patternCount} patterns`;

  cardBody.append(titleRow, colorList, keywords, meta);
  card.append(patternGrid, cardBody);

  return card;
}

function initializeDetailPanel(paperPackLibrary, paperPacks, colorsById) {
  const detailPanel = document.querySelector("[data-detail-panel]");
  const detailTitle = document.querySelector("[data-detail-title]");
  const detailBody = document.querySelector("[data-detail-body]");
  const detailClose = document.querySelector("[data-detail-close]");

  if (!detailPanel || !detailTitle || !detailBody) {
    return;
  }

  paperPackLibrary.addEventListener("click", (event) => {
    const card = event.target.closest("[data-paper-pack-card]");

    if (!card) {
      return;
    }

    event.preventDefault();

    const paperPack = paperPacks.find((pack) => pack.id === card.dataset.packId);

    if (paperPack) {
      openDetailPanel(detailPanel, detailTitle, detailBody, paperPack, paperPacks, colorsById);
    }
  });

  detailBody.addEventListener("click", (event) => {
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

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !detailPanel.hidden) {
      closeDetailPanel(detailPanel);
    }
  });
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
  metadata.append(colorSection, tagSection, createDetailMeta(paperPack), coordinationSection);
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
    createDetailMetaItem("Release", `${paperPack.releaseYear}`),
    createDetailMetaItem("Patterns", `${paperPack.patternCount}`)
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

  card.append(preview, title, meta);

  return card;
}

function createPatternGrid(paperPack) {
  const patternGrid = document.createElement("div");
  patternGrid.className = "pattern-grid";
  patternGrid.setAttribute("aria-label", `All sample patterns for ${paperPack.name}`);

  const patterns = paperPack.patterns || [];

  patternGrid.append(
    ...patterns.map((patternName) => {
      const pattern = document.createElement("span");
      const patternClass = PATTERN_CLASS_MAP[patternName] || "pattern-linen";

      pattern.className = `pattern ${patternClass}`;
      pattern.setAttribute("aria-hidden", "true");

      return pattern;
    })
  );

  return patternGrid;
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
