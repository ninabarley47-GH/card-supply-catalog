const THUMBNAIL_MAX_DIMENSION = 400;
const THUMBNAIL_MIME_TYPE = "image/jpeg";
const THUMBNAIL_QUALITY = 0.82;

/**
 * Creates a display thumbnail without changing the source image.
 *
 * The returned Blob is a newly encoded JPEG. Images smaller than the maximum
 * dimension keep their original dimensions; larger images are scaled so their
 * longest dimension is 400px.
 *
 * @param {Blob} sourceImage
 * @returns {Promise<Blob>}
 */
export async function generateImageThumbnail(sourceImage) {
  if (!(sourceImage instanceof Blob) || !sourceImage.type.startsWith("image/")) {
    throw new TypeError("A valid image Blob or File is required.");
  }

  const image = await createImageBitmap(sourceImage, { imageOrientation: "from-image" });

  try {
    const { width, height } = getThumbnailDimensions(image.width, image.height);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Thumbnail canvas could not be created.");
    }

    canvas.width = width;
    canvas.height = height;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);

    return await canvasToBlob(canvas);
  } finally {
    image.close();
  }
}

function getThumbnailDimensions(width, height) {
  if (!width || !height) {
    throw new Error("The source image has invalid dimensions.");
  }

  const scale = Math.min(1, THUMBNAIL_MAX_DIMENSION / Math.max(width, height));

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (thumbnailBlob) => {
        if (thumbnailBlob) {
          resolve(thumbnailBlob);
          return;
        }

        reject(new Error("Thumbnail could not be encoded."));
      },
      THUMBNAIL_MIME_TYPE,
      THUMBNAIL_QUALITY
    );
  });
}
