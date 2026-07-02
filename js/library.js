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
  linen: "pattern-linen",
  meadow: "pattern-meadow",
  speckle: "pattern-speckle",
  sprig: "pattern-sprig",
  stripe: "pattern-stripe"
};

export async function initializeLibraryShell() {
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

  cardBody.append(titleRow, keywords, colorList, meta);
  card.append(patternGrid, cardBody);

  return card;
}

function createPatternGrid(paperPack) {
  const patternGrid = document.createElement("div");
  patternGrid.className = "pattern-grid";
  patternGrid.setAttribute("aria-label", `Sample patterns for ${paperPack.name}`);

  const patterns = paperPack.patterns?.slice(0, 4) || [];

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
