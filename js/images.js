const CURRENT_IMAGE_STORAGE_STRATEGY = "embedded-indexed-db";

export async function addPatternImageFiles(files) {
  const imageFiles = files.filter((file) => file.type.startsWith("image/"));
  return await Promise.all(imageFiles.map(readImageFileAsStoredImage));
}

export function createPatternSlots(patternCount, selectedImages = [], existingPatterns = []) {
  return Array.from({ length: patternCount }, (_, index) => {
    const selectedImage = selectedImages[index];

    if (selectedImage) {
      return createStoredPatternReference(selectedImage, index);
    }

    const existingPattern = existingPatterns[index];

    if (existingPattern && (typeof existingPattern !== "object" || !getPatternImageSource(existingPattern))) {
      return existingPattern;
    }

    return `pattern-${index + 1}`;
  });
}

export function getImageEntriesFromPatterns(patterns = []) {
  return patterns
    .map((pattern, index) => {
      const imageSrc = getPatternImageSource(pattern);

      if (!imageSrc) {
        return null;
      }

      return {
        id: pattern.id || `pattern-${index + 1}`,
        name: pattern.imageName || pattern.id || `Pattern ${index + 1}`,
        src: imageSrc
      };
    })
    .filter(Boolean);
}

export function getAvailablePatternImages(paperPack) {
  return (paperPack.patterns || [])
    .map((patternEntry, index) => {
      const imageSrc = getPatternImageSource(patternEntry);
      const patternObject = patternEntry && typeof patternEntry === "object" ? patternEntry : null;

      return {
        imageSrc,
        imageName: patternObject?.imageName || `Pattern ${index + 1}`
      };
    })
    .filter((patternEntry) => patternEntry.imageSrc);
}

export function getPatternImageSource(patternEntry) {
  const patternObject = patternEntry && typeof patternEntry === "object" ? patternEntry : null;

  return patternObject?.imageSrc || patternObject?.imagePath || "";
}

export async function preparePaperPackImagesForSave(paperPack) {
  return {
    ...paperPack,
    imageStorageStrategy: CURRENT_IMAGE_STORAGE_STRATEGY
  };
}

export async function deletePaperPackImages() {
  // Embedded prototype images are deleted with the saved paper pack record.
}

function readImageFileAsStoredImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      resolve({
        id: createId(file.name.replace(/\.[^.]+$/, "")) || `image-${Date.now()}`,
        name: file.name,
        src: reader.result,
        storageStrategy: CURRENT_IMAGE_STORAGE_STRATEGY
      });
    });

    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function createStoredPatternReference(selectedImage, index) {
  return {
    id: `pattern-${index + 1}`,
    imageName: selectedImage.name,
    imageSrc: selectedImage.src,
    imageStorageStrategy: selectedImage.storageStrategy || CURRENT_IMAGE_STORAGE_STRATEGY
  };
}

function createId(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
