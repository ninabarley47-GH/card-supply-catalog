import { generateImageThumbnail } from "./thumbnails.js";

const fileInput = document.querySelector("#image-files");
const status = document.querySelector("#status");
const comparisons = document.querySelector("#comparisons");
const comparisonTemplate = document.querySelector("#comparison-template");
const activeObjectUrls = new Set();

fileInput.addEventListener("change", async () => {
  clearComparisons();

  const imageFiles = [...fileInput.files].filter((file) => file.type.startsWith("image/"));

  if (imageFiles.length === 0) {
    status.textContent = "No images selected.";
    return;
  }

  status.textContent = `Generating ${imageFiles.length} thumbnail${imageFiles.length === 1 ? "" : "s"}…`;
  fileInput.disabled = true;

  const results = await Promise.allSettled(imageFiles.map(renderComparison));
  const failedCount = results.filter((result) => result.status === "rejected").length;

  status.textContent = failedCount === 0
    ? `${imageFiles.length} thumbnail${imageFiles.length === 1 ? "" : "s"} ready for comparison.`
    : `${imageFiles.length - failedCount} ready; ${failedCount} image${failedCount === 1 ? "" : "s"} could not be processed.`;
  fileInput.disabled = false;
});

window.addEventListener("pagehide", revokeActiveObjectUrls);

async function renderComparison(sourceFile) {
  const article = comparisonTemplate.content.firstElementChild.cloneNode(true);
  article.querySelector("[data-file-name]").textContent = sourceFile.name;
  comparisons.append(article);

  try {
    const thumbnailBlob = await generateImageThumbnail(sourceFile);
    const originalUrl = createTrackedObjectUrl(sourceFile);
    const thumbnailUrl = createTrackedObjectUrl(thumbnailBlob);
    const [originalDimensions, thumbnailDimensions] = await Promise.all([
      loadImageDimensions(originalUrl),
      loadImageDimensions(thumbnailUrl)
    ]);

    article.querySelector("[data-original-image]").src = originalUrl;
    article.querySelector("[data-original-image]").alt = `Original ${sourceFile.name}`;
    article.querySelector("[data-thumbnail-image]").src = thumbnailUrl;
    article.querySelector("[data-thumbnail-image]").alt = `Generated thumbnail for ${sourceFile.name}`;
    article.querySelector("[data-card-image]").src = thumbnailUrl;
    article.querySelector("[data-card-image]").alt = `Card-size thumbnail preview for ${sourceFile.name}`;
    article.querySelector("[data-original-metadata]").textContent = formatMetadata(
      originalDimensions,
      sourceFile.size,
      sourceFile.type
    );
    article.querySelector("[data-thumbnail-metadata]").textContent = formatMetadata(
      thumbnailDimensions,
      thumbnailBlob.size,
      thumbnailBlob.type
    );
    article.querySelector("[data-size-change]").textContent = formatSizeChange(
      sourceFile.size,
      thumbnailBlob.size
    );
  } catch (error) {
    article.querySelector(".comparison-grid").remove();
    const errorMessage = document.createElement("p");
    errorMessage.className = "error";
    errorMessage.textContent = `This image could not be processed: ${error.message}`;
    article.append(errorMessage);
    throw error;
  }
}

function loadImageDimensions(imageUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.addEventListener("load", () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    });
    image.addEventListener("error", () => reject(new Error("Image dimensions could not be read.")));
    image.src = imageUrl;
  });
}

function formatMetadata(dimensions, byteSize, mimeType) {
  return `${dimensions.width} × ${dimensions.height}px · ${formatFileSize(byteSize)} · ${mimeType || "image"}`;
}

function formatSizeChange(originalSize, thumbnailSize) {
  if (originalSize === 0) {
    return `Thumbnail: ${formatFileSize(thumbnailSize)}`;
  }

  const reduction = Math.round((1 - thumbnailSize / originalSize) * 100);
  return reduction >= 0
    ? `${formatFileSize(originalSize)} → ${formatFileSize(thumbnailSize)} (${reduction}% smaller)`
    : `${formatFileSize(originalSize)} → ${formatFileSize(thumbnailSize)} (${Math.abs(reduction)}% larger)`;
}

function formatFileSize(byteSize) {
  if (byteSize < 1024) {
    return `${byteSize} B`;
  }

  if (byteSize < 1024 * 1024) {
    return `${(byteSize / 1024).toFixed(1)} KB`;
  }

  return `${(byteSize / (1024 * 1024)).toFixed(2)} MB`;
}

function createTrackedObjectUrl(blob) {
  const objectUrl = URL.createObjectURL(blob);
  activeObjectUrls.add(objectUrl);
  return objectUrl;
}

function clearComparisons() {
  comparisons.replaceChildren();
  revokeActiveObjectUrls();
}

function revokeActiveObjectUrls() {
  for (const objectUrl of activeObjectUrls) {
    URL.revokeObjectURL(objectUrl);
  }

  activeObjectUrls.clear();
}
