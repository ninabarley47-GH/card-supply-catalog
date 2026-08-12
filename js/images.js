import { loadCatalogSetting } from "./storage.js";
import { generateImageThumbnail } from "./thumbnails.js";

const EMBEDDED_IMAGE_STORAGE_STRATEGY = "embedded-indexed-db";
const LOCAL_FOLDER_IMAGE_STORAGE_STRATEGY = "local-folder";
const IMAGE_LIBRARY_SETTING_ID = "imageLibrary";

export async function addPatternImageFiles(files) {
  const imageFiles = files.filter((file) => file.type.startsWith("image/"));
  return await Promise.all(imageFiles.map(readImageFileAsStoredImage));
}

export async function choosePatternImagesFromLibrary() {
  if (!("showOpenFilePicker" in window)) {
    return {
      ok: false,
      images: [],
      message: "Choosing existing library images is not supported in this browser."
    };
  }

  const directoryHandle = await getReadableImageLibraryDirectoryHandle();

  if (!directoryHandle) {
    return {
      ok: false,
      images: [],
      message: "Choose an image library folder before adding existing library images."
    };
  }

  try {
    const fileHandles = await window.showOpenFilePicker({
      id: "csc-existing-images",
      multiple: true,
      startIn: directoryHandle,
      types: [
        {
          description: "Images",
          accept: {
            "image/*": [".jpg", ".jpeg", ".png", ".webp", ".gif"]
          }
        }
      ]
    });

    const images = await Promise.all(
      fileHandles.map((fileHandle) => createLibraryImageEntry(directoryHandle, fileHandle))
    );

    return {
      ok: true,
      images,
      message: ""
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      return {
        ok: true,
        images: [],
        message: ""
      };
    }

    return {
      ok: false,
      images: [],
      message: "Existing library images could not be selected."
    };
  }
}

export async function loadPatternImagesForPaperPackName(paperPackName) {
  const paperPackId = createId(paperPackName);

  if (!paperPackId) {
    return {
      ok: true,
      images: [],
      message: ""
    };
  }

  // This lookup is started by the user's change/blur action in the DSP form, so
  // it can restore access to a previously selected folder. Saved directory
  // handles commonly return to the "prompt" state after the browser reopens.
  const directoryHandle = await getReadableImageLibraryDirectoryHandle();

  if (!directoryHandle) {
    return {
      ok: false,
      images: [],
      message: "Image folder permission is needed before images can be loaded automatically. Reconnect the image folder in Settings."
    };
  }

  try {
    const packDirectory = await findPaperPackImageDirectory(directoryHandle, paperPackId);

    if (!packDirectory) {
      return {
        ok: true,
        images: [],
        message: `No image folder found for ${paperPackName}.`
      };
    }

    const images = await getImagesFromDirectory(packDirectory.handle, packDirectory.path);

    return {
      ok: true,
      images,
      message:
        images.length > 0
          ? `${images.length} image${images.length === 1 ? "" : "s"} loaded from the image library.`
          : `No image files found in ${packDirectory.path}.`
    };
  } catch (error) {
    return {
      ok: false,
      images: [],
      message: `Images for ${paperPackName} could not be loaded automatically.`
    };
  }
}

export async function scanImageLibraryPaperPackFolders() {
  const directoryHandle = await getReadableImageLibraryDirectoryHandle();

  if (!directoryHandle) {
    return {
      ok: false,
      folders: [],
      message: "Choose or reconnect the image library folder before looking for uncataloged packs."
    };
  }

  if (!directoryHandle.entries) {
    return {
      ok: false,
      folders: [],
      message: "This browser cannot scan the selected image library folder."
    };
  }

  try {
    const folders = [];

    for await (const [folderName, folderHandle] of directoryHandle.entries()) {
      if (folderHandle.kind !== "directory") {
        continue;
      }

      const imageCount = await countImagesInDirectory(folderHandle);

      if (imageCount > 0) {
        folders.push({
          id: createId(folderName),
          folderName,
          paperPackName: formatPaperPackNameFromFolder(folderName),
          imageCount
        });
      }
    }

    folders.sort((firstFolder, secondFolder) =>
      firstFolder.paperPackName.localeCompare(secondFolder.paperPackName, undefined, {
        numeric: true,
        sensitivity: "base"
      })
    );

    return {
      ok: true,
      folders,
      message: ""
    };
  } catch (error) {
    return {
      ok: false,
      folders: [],
      message: "The image library folders could not be scanned."
    };
  }
}

export async function hydratePaperPackImageSources(paperPacks) {
  const directoryHandle = await getReadableImageLibraryDirectoryHandle();

  if (!directoryHandle) {
    return paperPacks;
  }

  await Promise.all(
    paperPacks.flatMap((paperPack) =>
      (paperPack.patterns || []).map((patternEntry) => hydratePatternImageSource(patternEntry, directoryHandle))
    )
  );

  return paperPacks;
}

export function clearPaperPackImageObjectUrls(paperPack) {
  for (const patternEntry of paperPack?.patterns || []) {
    if (patternEntry && typeof patternEntry === "object") {
      clearStalePatternObjectUrls(patternEntry);
    }
  }
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
      const patternObject = pattern && typeof pattern === "object" ? pattern : null;
      const imageSrc = getPatternImageSource(pattern);

      if (!patternObject && !imageSrc) {
        return null;
      }

      if (!imageSrc && !patternObject?.imagePath) {
        return null;
      }

      return {
        id: patternObject?.id || `pattern-${index + 1}`,
        name: patternObject?.imageName || patternObject?.id || `Pattern ${index + 1}`,
        imagePath: patternObject?.imagePath,
        src: imageSrc,
        storageStrategy: patternObject?.imageStorageStrategy,
        missing: Boolean(patternObject?.imagePath && !imageSrc)
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

  return patternObject?.imagePreviewSrc || patternObject?.imageSrc || "";
}

export async function getPatternImageFile(patternEntry) {
  const patternObject = patternEntry && typeof patternEntry === "object" ? patternEntry : null;

  if (!patternObject?.imagePath) {
    return null;
  }

  const directoryHandle = await getReadableImageLibraryDirectoryHandle();

  if (!directoryHandle) {
    return null;
  }

  return await findFileFromImagePath(directoryHandle, patternObject.imagePath);
}

export async function preparePaperPackImagesForSave(paperPack) {
  const directoryHandle = await getWritableImageLibraryDirectoryHandle();

  if (!directoryHandle) {
    return {
      paperPack: preparePaperPackWithEmbeddedImages(paperPack),
      warning: ""
    };
  }

  try {
    return {
      paperPack: await preparePaperPackWithLocalFolderImages(paperPack, directoryHandle),
      warning: ""
    };
  } catch (error) {
    return {
      paperPack: preparePaperPackWithEmbeddedImages(paperPack),
      warning:
        "The paper pack was saved, but images could not be written to the selected image folder. They were kept in fallback browser storage for now."
    };
  }
}

export async function migratePaperPackImagesToLocalFolder(paperPack) {
  const directoryHandle = await getWritableImageLibraryDirectoryHandle();

  if (!directoryHandle) {
    return {
      ok: false,
      paperPack,
      imagesMigrated: 0,
      warning: "Choose an image folder before migrating existing images."
    };
  }

  const migrationStats = { imagesAdded: 0 };
  const migratedPaperPack = await preparePaperPackWithLocalFolderImages(
    paperPack,
    directoryHandle,
    migrationStats
  );

  return {
    ok: true,
    paperPack: migratedPaperPack,
    imagesMigrated: migrationStats.imagesAdded,
    warning: ""
  };
}

export async function checkImageLibraryHealth(paperPacks) {
  const directoryHandle = await getReadableImageLibraryDirectoryHandle();
  const summary = {
    folderName: directoryHandle?.name || "",
    packsChecked: paperPacks.length,
    folderImages: 0,
    imagesFound: 0,
    imagesMissing: 0,
    embeddedImages: 0,
    missingImages: [],
    fallbackPaperPacks: []
  };

  for (const paperPack of paperPacks) {
    for (const [index, patternEntry] of (paperPack.patterns || []).entries()) {
      const patternObject = patternEntry && typeof patternEntry === "object" ? patternEntry : null;

      if (!patternObject) {
        continue;
      }

      if (patternObject.imagePath) {
        summary.folderImages += 1;

        if (!directoryHandle) {
          summary.imagesMissing += 1;
          summary.missingImages.push(createMissingImageEntry(paperPack, patternObject, index));
          continue;
        }

        try {
          await findFileFromImagePath(directoryHandle, patternObject.imagePath);
          summary.imagesFound += 1;
        } catch (error) {
          summary.imagesMissing += 1;
          summary.missingImages.push(createMissingImageEntry(paperPack, patternObject, index));
        }

        continue;
      }

      if (patternObject.imageSrc || patternObject.imagePreviewSrc) {
        summary.embeddedImages += 1;
        const fallbackPaperPack = summary.fallbackPaperPacks.find(
          (entry) => entry.packId === paperPack.id
        );

        if (fallbackPaperPack) {
          fallbackPaperPack.imageCount += 1;
        } else {
          summary.fallbackPaperPacks.push({
            packId: paperPack.id,
            packName: paperPack.name || "Untitled pack",
            imageCount: 1
          });
        }
      }
    }
  }

  return {
    ok: Boolean(directoryHandle) || summary.folderImages === 0,
    needsFolder: !directoryHandle && summary.folderImages > 0,
    summary
  };
}

export async function repairBrokenPaperPackImageLinks(paperPacks) {
  const directoryHandle = await getReadableImageLibraryDirectoryHandle();
  const summary = {
    packsChecked: paperPacks.length,
    packsRepaired: 0,
    linksRepaired: 0,
    packsUnresolved: [],
    repairedPaperPacks: []
  };

  if (!directoryHandle) {
    return {
      ok: false,
      needsFolder: true,
      summary
    };
  }

  for (const paperPack of paperPacks) {
    const brokenLinkCount = await countBrokenImageLinks(paperPack, directoryHandle);
    const fallbackImageCount = countFallbackPatternImages(paperPack);

    if (brokenLinkCount === 0 && fallbackImageCount === 0) {
      continue;
    }

    const packDirectory = await findPaperPackImageDirectoryForPack(directoryHandle, paperPack);

    if (!packDirectory) {
      summary.packsUnresolved.push(paperPack.name || paperPack.id || "Untitled pack");
      continue;
    }

    const images = await getImagesFromDirectory(packDirectory.handle, packDirectory.path);

    if (images.length === 0) {
      summary.packsUnresolved.push(paperPack.name || paperPack.id || "Untitled pack");
      continue;
    }

    const repairResult = brokenLinkCount > 0
      ? {
          paperPack: rebuildPaperPackImageReferences(paperPack, images),
          linksRepaired: brokenLinkCount + fallbackImageCount
        }
      : reconnectFallbackPatternsFromImages(paperPack, images);

    if (repairResult.linksRepaired === 0) {
      summary.packsUnresolved.push(paperPack.name || paperPack.id || "Untitled pack");
      continue;
    }

    summary.packsRepaired += 1;
    summary.linksRepaired += repairResult.linksRepaired;
    summary.repairedPaperPacks.push(repairResult.paperPack);
  }

  return {
    ok: true,
    needsFolder: false,
    summary
  };
}

export async function reconnectPaperPackImagesToExistingFolder(paperPack) {
  const directoryHandle = await getReadableImageLibraryDirectoryHandle();

  if (!directoryHandle || countFallbackPatternImages(paperPack) === 0) {
    return { paperPack, linksRepaired: 0 };
  }

  const packDirectory = await findPaperPackImageDirectoryForPack(directoryHandle, paperPack);

  if (!packDirectory) {
    return { paperPack, linksRepaired: 0 };
  }

  const images = await getImagesFromDirectory(packDirectory.handle, packDirectory.path);
  return reconnectFallbackPatternsFromImages(paperPack, images);
}

function reconnectFallbackPatternsFromImages(paperPack, images) {
  let linksRepaired = 0;
  const patterns = (paperPack.patterns || []).map((patternEntry, index) => {
    const patternObject = patternEntry && typeof patternEntry === "object" ? patternEntry : null;

    if (!patternObject || patternObject.imagePath || (!patternObject.imageSrc && !patternObject.imagePreviewSrc)) {
      return patternEntry;
    }

    const desiredImageName = createStoredImageFileName(patternObject, index);
    const desiredImageKey = getFlexibleImageFileKey(desiredImageName);
    const matchingImage = images.find(
      (image) => getFlexibleImageFileKey(image.name) === desiredImageKey
    ) || images[index];

    if (!matchingImage) {
      return patternEntry;
    }

    linksRepaired += 1;
    return {
      id: patternObject.id || `pattern-${index + 1}`,
      imageName: matchingImage.name,
      imagePath: matchingImage.imagePath,
      imageStorageStrategy: LOCAL_FOLDER_IMAGE_STORAGE_STRATEGY
    };
  });

  return {
    paperPack: linksRepaired > 0
      ? { ...paperPack, patterns, imageStorageStrategy: LOCAL_FOLDER_IMAGE_STORAGE_STRATEGY }
      : paperPack,
    linksRepaired
  };
}

function countFallbackPatternImages(paperPack) {
  return (paperPack.patterns || []).filter(
    (pattern) => pattern && typeof pattern === "object" && !pattern.imagePath &&
      (pattern.imageSrc || pattern.imagePreviewSrc)
  ).length;
}

async function countBrokenImageLinks(paperPack, directoryHandle) {
  let brokenLinkCount = 0;

  for (const patternEntry of paperPack.patterns || []) {
    const patternObject = patternEntry && typeof patternEntry === "object" ? patternEntry : null;

    if (!patternObject?.imagePath) {
      continue;
    }

    try {
      await findFileFromImagePath(directoryHandle, patternObject.imagePath);
    } catch (error) {
      brokenLinkCount += 1;
    }
  }

  return brokenLinkCount;
}

async function findPaperPackImageDirectoryForPack(directoryHandle, paperPack) {
  const referencedFolderNames = (paperPack.patterns || [])
    .map((pattern) => (pattern && typeof pattern === "object" ? pattern.imagePath : ""))
    .map((imagePath) => String(imagePath || "").split("/").filter(Boolean)[0])
    .filter(Boolean);
  const candidateIds = new Set(
    [...referencedFolderNames, paperPack.name, paperPack.id].filter(Boolean).map(createId)
  );

  if (!directoryHandle.entries) {
    for (const candidateId of candidateIds) {
      const packDirectory = await findPaperPackImageDirectory(directoryHandle, candidateId);

      if (packDirectory) {
        return packDirectory;
      }
    }

    return null;
  }

  const directories = [];

  for await (const [folderName, folderHandle] of directoryHandle.entries()) {
    if (folderHandle.kind !== "directory") {
      continue;
    }

    const images = await getImagesFromDirectory(folderHandle, folderName);

    if (images.length > 0) {
      directories.push({ handle: folderHandle, path: folderName, images });
    }
  }

  const nameMatches = directories
    .filter((directory) => candidateIds.has(createId(directory.path)))
    .sort((firstDirectory, secondDirectory) => secondDirectory.images.length - firstDirectory.images.length);

  if (nameMatches.length > 0) {
    return nameMatches[0];
  }

  const expectedImageKeys = new Set(
    (paperPack.patterns || [])
      .map((pattern, index) => {
        const patternObject = pattern && typeof pattern === "object" ? pattern : null;
        return patternObject ? getFlexibleImageFileKey(createStoredImageFileName(patternObject, index)) : "";
      })
      .filter(Boolean)
  );
  const scoredDirectories = directories
    .map((directory) => ({
      ...directory,
      matchCount: directory.images.filter((image) => expectedImageKeys.has(getFlexibleImageFileKey(image.name))).length
    }))
    .filter((directory) => directory.matchCount > 0)
    .sort((firstDirectory, secondDirectory) => secondDirectory.matchCount - firstDirectory.matchCount);

  if (
    scoredDirectories.length > 0 &&
    (scoredDirectories.length === 1 || scoredDirectories[0].matchCount > scoredDirectories[1].matchCount)
  ) {
    return scoredDirectories[0];
  }

  return null;
}

function rebuildPaperPackImageReferences(paperPack, images) {
  const patternCount = Math.max(
    Number.isInteger(paperPack.patternCount) ? paperPack.patternCount : 0,
    (paperPack.patterns || []).length,
    images.length
  );

  const patterns = Array.from({ length: patternCount }, (_, index) => {
    const image = images[index];

    if (!image) {
      return `pattern-${index + 1}`;
    }

    return {
      id: `pattern-${index + 1}`,
      imageName: image.name,
      imagePath: image.imagePath,
      imageStorageStrategy: LOCAL_FOLDER_IMAGE_STORAGE_STRATEGY
    };
  });

  return {
    ...paperPack,
    patternCount,
    patterns,
    imageStorageStrategy: LOCAL_FOLDER_IMAGE_STORAGE_STRATEGY
  };
}

export async function deletePaperPackImages(paperPack) {
  const directoryHandle = await getWritableImageLibraryDirectoryHandle();

  if (!directoryHandle) {
    return;
  }

  await deleteLocalPaperPackImageFolder(directoryHandle, paperPack);
}

function createMissingImageEntry(paperPack, patternObject, index) {
  return {
    packName: paperPack.name || "Untitled pack",
    patternName: patternObject.imageName || `Pattern ${index + 1}`,
    imagePath: patternObject.imagePath || ""
  };
}

async function preparePaperPackWithLocalFolderImages(paperPack, directoryHandle, migrationStats = null) {
  const patterns = [];

  for (const [index, patternEntry] of (paperPack.patterns || []).entries()) {
    patterns.push(
      await preparePatternForLocalFolderStorage(
        directoryHandle,
        paperPack,
        patternEntry,
        index,
        migrationStats
      )
    );
  }

  return {
    ...paperPack,
    imageStorageStrategy: LOCAL_FOLDER_IMAGE_STORAGE_STRATEGY,
    patterns
  };
}

function preparePaperPackWithEmbeddedImages(paperPack) {
  return {
    ...paperPack,
    imageStorageStrategy: EMBEDDED_IMAGE_STORAGE_STRATEGY,
    patterns: (paperPack.patterns || []).map(preparePatternForEmbeddedStorage)
  };
}

async function preparePatternForLocalFolderStorage(
  directoryHandle,
  paperPack,
  patternEntry,
  index,
  migrationStats = null
) {
  const patternObject = patternEntry && typeof patternEntry === "object" ? patternEntry : null;

  if (!patternObject) {
    return patternEntry;
  }

  if (!patternObject.__imageFile && !patternObject.imageSrc) {
    return removeTransientImageFields(patternObject);
  }

  const imageName = createStoredImageFileName(patternObject, index);
  const imageBlob = patternObject.__imageFile || (await getBlobFromImageSource(patternObject.imageSrc));
  const writeResult = await writePatternImageFile(directoryHandle, paperPack, imageBlob, imageName);

  if (patternObject.__imageFile && writeResult.wasCreated) {
    await writeNewPatternThumbnail(writeResult.packDirectory, imageBlob, imageName);
  }

  if (migrationStats && writeResult.wasCreated) {
    migrationStats.imagesAdded += 1;
  }

  return {
    id: patternObject.id || `pattern-${index + 1}`,
    imageName,
    imagePath: writeResult.imagePath,
    imageStorageStrategy: LOCAL_FOLDER_IMAGE_STORAGE_STRATEGY
  };
}

function preparePatternForEmbeddedStorage(patternEntry) {
  const patternObject = patternEntry && typeof patternEntry === "object" ? patternEntry : null;

  if (!patternObject) {
    return patternEntry;
  }

  if (patternObject.imagePath && !patternObject.imageSrc && !patternObject.imagePreviewSrc) {
    return removeTransientImageFields(patternObject);
  }

  return {
    id: patternObject.id,
    imageName: patternObject.imageName,
    imageSrc: patternObject.imageSrc || patternObject.imagePreviewSrc || "",
    imageStorageStrategy: EMBEDDED_IMAGE_STORAGE_STRATEGY
  };
}

function readImageFileAsStoredImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      resolve({
        id: createId(file.name.replace(/\.[^.]+$/, "")) || `image-${Date.now()}`,
        name: file.name,
        file,
        src: reader.result,
        storageStrategy: EMBEDDED_IMAGE_STORAGE_STRATEGY
      });
    });

    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function createStoredPatternReference(selectedImage, index) {
  if (selectedImage.imagePath) {
    return {
      id: `pattern-${index + 1}`,
      imageName: selectedImage.name,
      imagePath: selectedImage.imagePath,
      imagePreviewSrc: selectedImage.src,
      imageStorageStrategy: LOCAL_FOLDER_IMAGE_STORAGE_STRATEGY
    };
  }

  return {
    id: `pattern-${index + 1}`,
    imageName: selectedImage.name,
    __imageFile: selectedImage.file,
    imageSrc: selectedImage.src,
    imageStorageStrategy: selectedImage.storageStrategy || EMBEDDED_IMAGE_STORAGE_STRATEGY
  };
}

async function createLibraryImageEntry(directoryHandle, fileHandle) {
  const file = await fileHandle.getFile();
  const imagePath = await findRelativePathForFileHandle(directoryHandle, fileHandle);

  if (!imagePath) {
    const embeddedImage = await readImageFileAsStoredImage(file);

    return {
      ...embeddedImage,
      message: "Selected image was outside the image library folder and will be copied on save."
    };
  }

  return {
    id: createId(file.name.replace(/\.[^.]+$/, "")) || `image-${Date.now()}`,
    name: file.name,
    imagePath,
    src: URL.createObjectURL(file),
    storageStrategy: LOCAL_FOLDER_IMAGE_STORAGE_STRATEGY
  };
}

async function findRelativePathForFileHandle(directoryHandle, targetFileHandle, pathPrefix = "") {
  if (!directoryHandle.entries) {
    return "";
  }

  for await (const [entryName, entryHandle] of directoryHandle.entries()) {
    const entryPath = pathPrefix ? `${pathPrefix}/${entryName}` : entryName;

    if (entryHandle.kind === "file" && entryHandle.isSameEntry && (await entryHandle.isSameEntry(targetFileHandle))) {
      return entryPath;
    }

    if (entryHandle.kind === "directory") {
      const nestedPath = await findRelativePathForFileHandle(entryHandle, targetFileHandle, entryPath);

      if (nestedPath) {
        return nestedPath;
      }
    }
  }

  return "";
}

async function getReadableImageLibraryDirectoryHandle(options = {}) {
  const imageLibrary = await loadCatalogSetting(IMAGE_LIBRARY_SETTING_ID);
  const directoryHandle = imageLibrary?.directoryHandle;

  if (!directoryHandle || !(await hasDirectoryPermission(directoryHandle, "read", options))) {
    return null;
  }

  return directoryHandle;
}

async function getWritableImageLibraryDirectoryHandle() {
  const imageLibrary = await loadCatalogSetting(IMAGE_LIBRARY_SETTING_ID);
  const directoryHandle = imageLibrary?.directoryHandle;

  if (!directoryHandle || !(await hasDirectoryPermission(directoryHandle, "readwrite"))) {
    return null;
  }

  return directoryHandle;
}

async function hasDirectoryPermission(directoryHandle, mode, options = {}) {
  if (!directoryHandle?.queryPermission) {
    return false;
  }

  try {
    const permission = { mode };

    if ((await directoryHandle.queryPermission(permission)) === "granted") {
      return true;
    }

    if (options.requestPermission === false || !directoryHandle.requestPermission) {
      return false;
    }

    return (await directoryHandle.requestPermission(permission)) === "granted";
  } catch (error) {
    return false;
  }
}

async function findPaperPackImageDirectory(directoryHandle, paperPackId) {
  try {
    return {
      handle: await directoryHandle.getDirectoryHandle(paperPackId),
      path: paperPackId
    };
  } catch (error) {
    // Fall through to a normalized folder-name search below.
  }

  if (!directoryHandle.entries) {
    return null;
  }

  const normalizedPaperPackId = createId(paperPackId);

  for await (const [entryName, entryHandle] of directoryHandle.entries()) {
    if (entryHandle.kind === "directory" && createId(entryName) === normalizedPaperPackId) {
      return {
        handle: entryHandle,
        path: entryName
      };
    }
  }

  return null;
}

async function getImagesFromDirectory(directoryHandle, directoryPath) {
  if (!directoryHandle.entries) {
    return [];
  }

  const imageEntries = [];

  for await (const [entryName, entryHandle] of directoryHandle.entries()) {
    if (entryHandle.kind !== "file" || !isSupportedImageFileName(entryName)) {
      continue;
    }

    const file = await entryHandle.getFile();
    const imagePath = `${directoryPath}/${entryName}`;

    imageEntries.push({
      id: createId(entryName.replace(/\.[^.]+$/, "")) || `image-${imageEntries.length + 1}`,
      name: entryName,
      imagePath,
      src: URL.createObjectURL(file),
      storageStrategy: LOCAL_FOLDER_IMAGE_STORAGE_STRATEGY
    });
  }

  return imageEntries.sort((firstImage, secondImage) =>
    firstImage.imagePath.localeCompare(secondImage.imagePath, undefined, {
      numeric: true,
      sensitivity: "base"
    })
  );
}

async function countImagesInDirectory(directoryHandle) {
  let imageCount = 0;

  for await (const [entryName, entryHandle] of directoryHandle.entries()) {
    if (entryHandle.kind === "file" && isSupportedImageFileName(entryName)) {
      imageCount += 1;
    }
  }

  return imageCount;
}

function formatPaperPackNameFromFolder(folderName) {
  return String(folderName || "")
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

function isSupportedImageFileName(fileName) {
  const normalizedFileName = String(fileName || "");

  return !isThumbnailImageFileName(normalizedFileName) && /\.(jpe?g|png|webp|gif)$/i.test(normalizedFileName);
}

function isThumbnailImageFileName(fileName) {
  return /\.thumb\.jpe?g$/i.test(String(fileName || ""));
}

async function hydratePatternImageSource(patternEntry, directoryHandle) {
  const patternObject = patternEntry && typeof patternEntry === "object" ? patternEntry : null;

  if (!patternObject?.imagePath) {
    return;
  }

  clearStalePatternObjectUrls(patternObject);

  try {
    const file = await findFileFromImagePath(directoryHandle, patternObject.imagePath);
    patternObject.imagePreviewSrc = URL.createObjectURL(file);
  } catch (error) {
    // The placeholder remains visible if the local image cannot be read.
  }
}

function clearStalePatternObjectUrls(patternObject) {
  for (const fieldName of ["imagePreviewSrc", "imageSrc"]) {
    const imageSource = patternObject[fieldName];

    if (typeof imageSource !== "string" || !imageSource.startsWith("blob:")) {
      continue;
    }

    try {
      URL.revokeObjectURL(imageSource);
    } catch (error) {
      // The URL may belong to an earlier browser session and already be invalid.
    }

    delete patternObject[fieldName];
  }
}

async function findFileFromImagePath(directoryHandle, imagePath) {
  const candidatePaths = getImagePathCandidates(imagePath);
  let lookupError = null;

  for (const candidatePath of candidatePaths) {
    try {
      return await getFileFromImagePath(directoryHandle, candidatePath);
    } catch (error) {
      lookupError = lookupError || error;
    }
  }

  try {
    return await findFileByFlexibleName(directoryHandle, imagePath);
  } catch (error) {
    throw lookupError || error;
  }
}

async function getFileFromImagePath(directoryHandle, imagePath) {
  const pathParts = imagePath.split("/").filter(Boolean);
  const fileName = pathParts.pop();
  let currentDirectory = directoryHandle;

  for (const pathPart of pathParts) {
    currentDirectory = await getDirectoryHandleByName(currentDirectory, pathPart);
  }

  const fileHandle = await currentDirectory.getFileHandle(fileName);
  return await fileHandle.getFile();
}

async function findFileByFlexibleName(directoryHandle, imagePath) {
  const pathParts = String(imagePath || "").split("/").filter(Boolean);
  const fileName = pathParts.pop();
  let currentDirectory = directoryHandle;

  for (const pathPart of pathParts) {
    currentDirectory = await getDirectoryHandleByName(currentDirectory, pathPart);
  }

  if (!fileName || !currentDirectory.entries) {
    throw new Error("Image file could not be found.");
  }

  const targetKey = getFlexibleImageFileKey(fileName);

  for await (const [entryName, entryHandle] of currentDirectory.entries()) {
    if (
      entryHandle.kind === "file" &&
      isSupportedImageFileName(entryName) &&
      getFlexibleImageFileKey(entryName) === targetKey
    ) {
      return await entryHandle.getFile();
    }
  }

  throw new Error("Image file could not be found.");
}

async function getDirectoryHandleByName(directoryHandle, directoryName) {
  try {
    return await directoryHandle.getDirectoryHandle(directoryName);
  } catch (error) {
    if (!directoryHandle.entries) {
      throw error;
    }
  }

  const normalizedDirectoryName = createId(directoryName);

  for await (const [entryName, entryHandle] of directoryHandle.entries()) {
    if (entryHandle.kind === "directory" && createId(entryName) === normalizedDirectoryName) {
      return entryHandle;
    }
  }

  throw new Error("Image directory could not be found.");
}

function getImagePathCandidates(imagePath) {
  const pathParts = String(imagePath || "").split("/").filter(Boolean);
  const fileName = pathParts.pop();

  if (!fileName) {
    return [];
  }

  return [...new Set(getImageFileNameCandidates(fileName).map((candidateName) => [...pathParts, candidateName].join("/")))];
}

function getImageFileNameCandidates(fileName) {
  const candidates = [fileName];
  const extension = getFileExtension(fileName);
  const baseName = fileName.slice(0, -extension.length);
  const prefixedName = baseName.match(/^(\d{2})-(.+)$/);

  if (prefixedName) {
    const [, prefix, unprefixedBaseName] = prefixedName;

    candidates.push(`${unprefixedBaseName}${extension}`);
    candidates.push(`${prefix}${extension}`);

    if (/^\d+$/.test(unprefixedBaseName)) {
      candidates.push(`${Number.parseInt(unprefixedBaseName, 10)}${extension}`);
      candidates.push(`${unprefixedBaseName.padStart(2, "0")}${extension}`);
    }
  }

  if (/^\d+$/.test(baseName)) {
    candidates.push(`${Number.parseInt(baseName, 10)}${extension}`);
    candidates.push(`${baseName.padStart(2, "0")}${extension}`);
  }

  return candidates;
}

function getFlexibleImageFileKey(fileName) {
  const extension = getFileExtension(fileName);
  const baseName = fileName.slice(0, -extension.length).replace(/^\d{2}-/, "");
  const normalizedBaseName = /^\d+$/.test(baseName) ? `${Number.parseInt(baseName, 10)}` : createId(baseName);

  return `${normalizedBaseName}${extension}`;
}

async function writePatternImageFile(directoryHandle, paperPack, imageFile, imageName) {
  const existingPackDirectory = await findPaperPackImageDirectoryForPack(directoryHandle, paperPack);
  const packFolderName =
    existingPackDirectory?.path || createId(paperPack.id || paperPack.name) || "paper-pack";
  const packDirectory =
    existingPackDirectory?.handle ||
    (await directoryHandle.getDirectoryHandle(packFolderName, { create: true }));
  const existingImageName = await findExistingImageFileName(packDirectory, imageName);

  if (existingImageName) {
    return {
      imagePath: `${packFolderName}/${existingImageName}`,
      wasCreated: false
    };
  }

  const fileHandle = await packDirectory.getFileHandle(imageName, { create: true });
  const writable = await fileHandle.createWritable();

  await writable.write(imageFile);
  await writable.close();

  return {
    imagePath: `${packFolderName}/${imageName}`,
    wasCreated: true,
    packDirectory
  };
}

async function writeNewPatternThumbnail(packDirectory, sourceImage, imageName) {
  try {
    const thumbnailBlob = await generateImageThumbnail(sourceImage);
    const thumbnailName = createThumbnailImageFileName(imageName);
    const thumbnailHandle = await packDirectory.getFileHandle(thumbnailName, { create: true });
    const thumbnailWritable = await thumbnailHandle.createWritable();

    await thumbnailWritable.write(thumbnailBlob);
    await thumbnailWritable.close();
  } catch (error) {
    console.warn("The full-resolution image was saved, but its thumbnail could not be created.", error);
  }
}

function createThumbnailImageFileName(imageName) {
  return `${String(imageName || "pattern").replace(/\.[^.]+$/, "")}.thumb.jpg`;
}

async function findExistingImageFileName(directoryHandle, imageName) {
  try {
    await directoryHandle.getFileHandle(imageName);
    return imageName;
  } catch (error) {
    // Fall through to normalized filename matching.
  }

  if (!directoryHandle.entries) {
    return "";
  }

  const imageKey = getFlexibleImageFileKey(imageName);

  for await (const [entryName, entryHandle] of directoryHandle.entries()) {
    if (
      entryHandle.kind === "file" &&
      isSupportedImageFileName(entryName) &&
      getFlexibleImageFileKey(entryName) === imageKey
    ) {
      return entryName;
    }
  }

  return "";
}

async function getBlobFromImageSource(imageSrc) {
  const response = await fetch(imageSrc);

  if (!response.ok) {
    throw new Error("Image source could not be read.");
  }

  return await response.blob();
}

async function deleteLocalPaperPackImageFolder(directoryHandle, paperPack) {
  const packFolderName = createId(paperPack.id || paperPack.name);

  if (!packFolderName || !directoryHandle.removeEntry) {
    return;
  }

  try {
    await directoryHandle.removeEntry(packFolderName, { recursive: true });
  } catch (error) {
    // Deleting image files is best-effort; catalog deletion still proceeds.
  }
}

function createStoredImageFileName(patternObject, index) {
  const originalName = patternObject.imageName || patternObject.__imageFile?.name || `pattern-${index + 1}.jpg`;
  const extension = getFileExtension(originalName);
  const baseName = createId(originalName.replace(/\.[^.]+$/, "")) || `pattern-${index + 1}`;

  return `${String(index + 1).padStart(2, "0")}-${baseName}${extension}`;
}

function getFileExtension(fileName) {
  const match = String(fileName || "").match(/\.([a-z0-9]+)$/i);

  return match ? `.${match[1].toLowerCase()}` : ".jpg";
}

function removeTransientImageFields(patternObject) {
  const { __imageFile, imagePreviewSrc, ...persistentPattern } = patternObject;

  return persistentPattern;
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
