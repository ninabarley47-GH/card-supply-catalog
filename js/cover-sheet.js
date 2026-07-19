import { getAvailablePatternImages } from "./images.js";

const COVER_SHEET_SIZE = 1800;
const COVER_SHEET_PRINT_DPI = 300;
const OUTER_BORDER = 12;
const INNER_BORDER = 6;
const TITLE_HEIGHT = 300;
const COLOR_RAIL_WIDTH = 440;
const TITLE_FONT = "bold italic 138px Georgia, serif";
const SUBTITLE_FONT = "bold italic 42px Georgia, serif";
const COLOR_FONT = "bold italic 40px Georgia, serif";

export async function createCoverSheetForPack(paperPack, colorsById) {
  const imageEntries = getAvailablePatternImages(paperPack);

  if (imageEntries.length === 0) {
    window.alert("This paper pack does not have any pattern images available for a cover sheet yet.");
    return;
  }

  const fileHandle = await chooseCoverSheetFile(paperPack);

  if (fileHandle === false) {
    return;
  }

  const images = await loadPatternImages(imageEntries);

  if (images.length === 0) {
    window.alert("The available pattern images could not be loaded for this cover sheet.");
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = COVER_SHEET_SIZE;
  canvas.height = COVER_SHEET_SIZE;

  const context = canvas.getContext("2d");
  const colors = getResolvedPackColors(paperPack, colorsById);

  drawCoverSheet(context, paperPack, images, colors);

  const canvasBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

  if (!canvasBlob) {
    window.alert("The cover sheet could not be created.");
    return;
  }

  const blob = await addPngPrintResolution(canvasBlob, COVER_SHEET_PRINT_DPI);
  await saveCoverSheet(blob, paperPack, fileHandle);
}

async function addPngPrintResolution(blob, dpi) {
  const pngBytes = new Uint8Array(await blob.arrayBuffer());
  const pixelsPerMeter = Math.round(dpi / 0.0254);
  const resolutionData = new Uint8Array(9);
  const resolutionView = new DataView(resolutionData.buffer);

  resolutionView.setUint32(0, pixelsPerMeter);
  resolutionView.setUint32(4, pixelsPerMeter);
  resolutionData[8] = 1;

  const resolutionChunk = createPngChunk("pHYs", resolutionData);
  const ihdrChunkEnd = 8 + 4 + 4 + 13 + 4;
  const output = new Uint8Array(pngBytes.length + resolutionChunk.length);

  output.set(pngBytes.subarray(0, ihdrChunkEnd));
  output.set(resolutionChunk, ihdrChunkEnd);
  output.set(pngBytes.subarray(ihdrChunkEnd), ihdrChunkEnd + resolutionChunk.length);

  return new Blob([output], { type: "image/png" });
}

function createPngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  const chunkView = new DataView(chunk.buffer);

  chunkView.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  chunkView.setUint32(8 + data.length, calculatePngCrc(typeBytes, data));

  return chunk;
}

function calculatePngCrc(typeBytes, data) {
  let crc = 0xffffffff;

  for (const byte of [...typeBytes, ...data]) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

async function loadPatternImages(imageEntries) {
  const imageResults = await Promise.allSettled(imageEntries.map(loadPatternImage));

  return imageResults
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
}

function loadPatternImage(imageEntry) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = imageEntry.imageSrc;
  });
}

function getResolvedPackColors(paperPack, colorsById) {
  return (paperPack.colors || [])
    .map((colorId) => colorsById[colorId])
    .filter(Boolean);
}

function drawCoverSheet(context, paperPack, images, colors) {
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, COVER_SHEET_SIZE, COVER_SHEET_SIZE);

  const topX = OUTER_BORDER;
  const topY = OUTER_BORDER;
  const topWidth = COVER_SHEET_SIZE - OUTER_BORDER * 2;
  const topHeight = COVER_SHEET_SIZE - TITLE_HEIGHT - OUTER_BORDER * 2;
  const patternWidth = topWidth - COLOR_RAIL_WIDTH;

  drawPatternGrid(context, images, topX, topY, patternWidth, topHeight);
  drawColorRail(context, colors, topX + patternWidth, topY, COLOR_RAIL_WIDTH, topHeight);
  drawTitlePanel(context, paperPack, OUTER_BORDER, topY + topHeight, topWidth, TITLE_HEIGHT);

  context.strokeStyle = "#000000";
  context.lineWidth = OUTER_BORDER;
  context.strokeRect(OUTER_BORDER / 2, OUTER_BORDER / 2, COVER_SHEET_SIZE - OUTER_BORDER, COVER_SHEET_SIZE - OUTER_BORDER);

  context.lineWidth = INNER_BORDER;
  context.strokeRect(topX, topY, topWidth, topHeight);
  context.beginPath();
  context.moveTo(topX, topY + topHeight);
  context.lineTo(topX + topWidth, topY + topHeight);
  context.moveTo(topX + patternWidth, topY);
  context.lineTo(topX + patternWidth, topY + topHeight);
  context.stroke();
}

function drawPatternGrid(context, images, x, y, width, height) {
  const { columns, rows } = getGridDimensions(images.length, width, height);
  const cellHeight = height / rows;

  for (let row = 0; row < rows; row += 1) {
    const rowStartIndex = row * columns;
    const rowImages = images.slice(rowStartIndex, rowStartIndex + columns);
    const cellWidth = width / rowImages.length;
    const cellY = y + row * cellHeight;

    rowImages.forEach((image, column) => {
      const cellX = x + column * cellWidth;
      drawImageCover(context, image, cellX, cellY, cellWidth, cellHeight);
    });

    context.strokeStyle = "#000000";
    context.lineWidth = INNER_BORDER;

    for (let column = 1; column < rowImages.length; column += 1) {
      const gridX = x + column * cellWidth;
      context.beginPath();
      context.moveTo(gridX, cellY);
      context.lineTo(gridX, cellY + cellHeight);
      context.stroke();
    }
  }

  context.strokeStyle = "#000000";
  context.lineWidth = INNER_BORDER;

  for (let row = 1; row < rows; row += 1) {
    const gridY = y + row * cellHeight;
    context.beginPath();
    context.moveTo(x, gridY);
    context.lineTo(x + width, gridY);
    context.stroke();
  }
}

function getGridDimensions(imageCount, width, height) {
  const targetAspect = width / height;
  let best = {
    columns: imageCount,
    rows: 1,
    score: Number.POSITIVE_INFINITY
  };

  for (let columns = 1; columns <= imageCount; columns += 1) {
    const rows = Math.ceil(imageCount / columns);
    const aspect = columns / rows;
    const emptyCells = columns * rows - imageCount;
    const score = Math.abs(aspect - targetAspect) + emptyCells * 0.15;

    if (score < best.score) {
      best = { columns, rows, score };
    }
  }

  return best;
}

function drawImageCover(context, image, x, y, width, height) {
  const imageAspect = image.naturalWidth / image.naturalHeight;
  const targetAspect = width / height;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;
  let sourceX = 0;
  let sourceY = 0;

  if (imageAspect > targetAspect) {
    sourceWidth = image.naturalHeight * targetAspect;
    sourceX = (image.naturalWidth - sourceWidth) / 2;
  } else {
    sourceHeight = image.naturalWidth / targetAspect;
    sourceY = (image.naturalHeight - sourceHeight) / 2;
  }

  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function drawColorRail(context, colors, x, y, width, height) {
  const swatchCount = Math.max(colors.length, 1);
  const swatchHeight = height / swatchCount;

  if (colors.length === 0) {
    drawColorSwatch(context, { name: "No colors listed", hex: "#ffffff" }, x, y, width, height);
    return;
  }

  colors.forEach((color, index) => {
    drawColorSwatch(context, color, x, y + index * swatchHeight, width, swatchHeight);
  });
}

function drawColorSwatch(context, color, x, y, width, height) {
  context.fillStyle = color.hex;
  context.fillRect(x, y, width, height);

  context.strokeStyle = "#000000";
  context.lineWidth = INNER_BORDER;
  context.strokeRect(x, y, width, height);

  context.fillStyle = getReadableTextColor(color.hex);
  context.font = COLOR_FONT;
  context.textAlign = "center";
  context.textBaseline = "middle";
  fitText(context, color.name, x + width / 2, y + height / 2, width - 42, 40);
}

function drawTitlePanel(context, paperPack, x, y, width, height) {
  context.fillStyle = "#ffffff";
  context.fillRect(x, y, width, height);

  context.strokeStyle = "#000000";
  context.lineWidth = INNER_BORDER;
  context.strokeRect(x, y, width, height);

  context.fillStyle = "#000000";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = TITLE_FONT;
  fitText(context, paperPack.name, x + width / 2, y + height * 0.43, width - 120, 110);

  context.font = SUBTITLE_FONT;
  fitText(context, `${paperPack.releaseYear} Release`, x + width / 2, y + height * 0.76, width - 160, 38);
}

function fitText(context, text, x, y, maxWidth, minFontSize) {
  const font = context.font;
  const match = font.match(/^(.+?)(\d+)px\s+(.+)$/);

  if (!match) {
    context.fillText(text, x, y, maxWidth);
    return;
  }

  const [, prefix, size, suffix] = match;
  let fontSize = Number(size);

  while (fontSize > minFontSize && context.measureText(text).width > maxWidth) {
    fontSize -= 2;
    context.font = `${prefix}${fontSize}px ${suffix}`;
  }

  context.fillText(text, x, y, maxWidth);
  context.font = font;
}

function getReadableTextColor(hex) {
  const { red, green, blue } = parseHexColor(hex);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.62 ? "#000000" : "#ffffff";
}

function parseHexColor(hex) {
  const normalizedHex = hex.replace("#", "");
  const red = parseInt(normalizedHex.slice(0, 2), 16);
  const green = parseInt(normalizedHex.slice(2, 4), 16);
  const blue = parseInt(normalizedHex.slice(4, 6), 16);

  return { red, green, blue };
}

async function chooseCoverSheetFile(paperPack) {
  const fileName = `${slugifyFileName(paperPack.name)}-cover-sheet.png`;

  if ("showSaveFilePicker" in window) {
    try {
      return await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: "PNG image",
            accept: {
              "image/png": [".png"]
            }
          }
        ]
      });
    } catch (error) {
      if (error.name === "AbortError") {
        return false;
      }
    }
  }

  return null;
}

async function saveCoverSheet(blob, paperPack, fileHandle) {
  const fileName = `${slugifyFileName(paperPack.name)}-cover-sheet.png`;

  if (fileHandle) {
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (error) {
      if (error.name === "AbortError") {
        return;
      }
    }
  }

  downloadBlob(blob, fileName);
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function slugifyFileName(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
