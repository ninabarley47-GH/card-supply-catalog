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

export async function initializeLibraryShell() {
  const colorLibrary = document.querySelector("[data-color-library]");

  if (!colorLibrary) {
    return;
  }

  try {
    const colors = await loadColors();
    renderColorLibrary(colorLibrary, colors);
  } catch (error) {
    renderColorError(colorLibrary);
  }
}

async function loadColors() {
  const response = await fetch("data/colors.json");

  if (!response.ok) {
    throw new Error("Unable to load colors.json");
  }

  const colorsById = await response.json();

  return Object.values(colorsById);
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

function renderColorError(container) {
  const message = document.createElement("p");
  message.className = "loading-message";
  message.textContent = "Colors could not be loaded.";

  container.replaceChildren(message);
}
