import { loadCatalogSetting } from "./storage.js";

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

  const directoryHandle = await getReadableImageLibraryDirectoryHandle({ requestPermission: false });

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

  const imagesToMigrate = countEmbeddedPatternImages(paperPack);
  const migratedPaperPack = await preparePaperPackWithLocalFolderImages(paperPack, directoryHandle);

  return {
    ok: true,
    paperPack: migratedPaperPack,
    imagesMigrated: imagesToMigrate,
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
    missingImages: []
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
      }
    }
  }

  return {
    ok: Boolean(directoryHandle) || summary.folderImages === 0,
    needsFolder: !directoryHandle && summary.folderImages > 0,
    summary
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

async function preparePaperPackWithLocalFolderImages(paperPack, directoryHandle) {
  const patterns = [];

  for (const [index, patternEntry] of (paperPack.patterns || []).entries()) {
    patterns.push(await preparePatternForLocalFolderStorage(directoryHandle, paperPack, patternEntry, index));
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

async function preparePatternForLocalFolderStorage(directoryHandle, paperPack, patternEntry, index) {
  const patternObject = patternEntry && typeof patternEntry === "object" ? patternEntry : null;

  if (!patternObject) {
    return patternEntry;
  }

  if (!patternObject.__imageFile && !patternObject.imageSrc) {
    return removeTransientImageFields(patternObject);
  }

  const imageName = createStoredImageFileName(patternObject, index);
  const imageBlob = patternObject.__imageFile || (await getBlobFromImageSource(patternObject.imageSrc));
  const imagePath = await writePatternImageFile(directoryHandle, paperPack, imageBlob, imageName);

  return {
    id: patternObject.id || `pattern-${index + 1}`,
    imageName,
    imagePath,
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

  for await (const [entryName, entryHandle] of directoryHandle.entries()) {
    if (entryHandle.kind === "directory" && createId(entryName) === paperPackId) {
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

function isSupportedImageFileName(fileName) {
  return /\.(jpe?g|png|webp|gif)$/i.test(String(fileName || ""));
}

async function hydratePatternImageSource(patternEntry, directoryHandle) {
  const patternObject = patternEntry && typeof patternEntry === "object" ? patternEntry : null;

  if (!patternObject?.imagePath || patternObject.imagePreviewSrc || patternObject.imageSrc) {
    return;
  }

  try {
    const file = await findFileFromImagePath(directoryHandle, patternObject.imagePath);
    patternObject.imagePreviewSrc = URL.createObjectURL(file);
  } catch (error) {
    // The placeholder remains visible if the local image cannot be read.
  }
}

async function findFileFromImagePath(directoryHandle, imagePath) {
  try {
    return await getFileFromImagePath(directoryHandle, imagePath);
  } catch (error) {
    const fallbackImagePath = getUnprefixedImagePath(imagePath);

    if (!fallbackImagePath || fallbackImagePath === imagePath) {
      throw error;
    }

    return await getFileFromImagePath(directoryHandle, fallbackImagePath);
  }
}

async function getFileFromImagePath(directoryHandle, imagePath) {
  const pathParts = imagePath.split("/").filter(Boolean);
  const fileName = pathParts.pop();
  let currentDirectory = directoryHandle;

  for (const pathPart of pathParts) {
    currentDirectory = await currentDirectory.getDirectoryHandle(pathPart);
  }

  const fileHandle = await currentDirectory.getFileHandle(fileName);
  return await fileHandle.getFile();
}

function getUnprefixedImagePath(imagePath) {
  const pathParts = String(imagePath || "").split("/").filter(Boolean);
  const fileName = pathParts.pop();
  const unprefixedFileName = fileName?.replace(/^\d{2}-/, "");

  if (!fileName || !unprefixedFileName || unprefixedFileName === fileName) {
    return "";
  }

  return [...pathParts, unprefixedFileName].join("/");
}

async function writePatternImageFile(directoryHandle, paperPack, imageFile, imageName) {
  const packFolderName = createId(paperPack.id || paperPack.name) || "paper-pack";
  const packDirectory = await directoryHandle.getDirectoryHandle(packFolderName, { create: true });
  const fileHandle = await packDirectory.getFileHandle(imageName, { create: true });
  const writable = await fileHandle.createWritable();

  await writable.write(imageFile);
  await writable.close();

  return `${packFolderName}/${imageName}`;
}

async function getBlobFromImageSource(imageSrc) {
  const response = await fetch(imageSrc);

  if (!response.ok) {
    throw new Error("Image source could not be read.");
  }

  return await response.blob();
}

function countEmbeddedPatternImages(paperPack) {
  return (paperPack.patterns || []).filter((pattern) => pattern && typeof pattern === "object" && pattern.imageSrc)
    .length;
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
