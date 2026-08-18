import test from "node:test";
import assert from "node:assert/strict";
import {
  getReferencedPaperPackImagePaths,
  getPaperLibraryImageSource,
  getPatternImageSource,
  isUsableThumbnailFile
} from "./images.js";

test("Paper Library prefers a hydrated thumbnail while detail keeps the full image", () => {
  const packWithThumbnail = {
    name: "Pack with thumbnail",
    patterns: [
      {
        imagePath: "pack-with-thumbnail/01-pattern.jpg",
        imagePreviewSrc: "blob:full-resolution",
        imageThumbnailSrc: "blob:thumbnail"
      }
    ]
  };

  assert.equal(getPaperLibraryImageSource(packWithThumbnail.patterns[0]), "blob:thumbnail");
  assert.equal(getPatternImageSource(packWithThumbnail.patterns[0]), "blob:full-resolution");
});

test("Paper Library retains the full-image source when no thumbnail exists", () => {
  const existingPackWithoutThumbnails = {
    name: "Existing pack",
    patterns: [
      {
        imagePath: "existing-pack/01-pattern.jpg",
        imagePreviewSrc: "blob:existing-full-resolution"
      }
    ]
  };

  assert.equal(
    getPaperLibraryImageSource(existingPackWithoutThumbnails.patterns[0]),
    "blob:existing-full-resolution"
  );
  assert.equal(
    getPatternImageSource(existingPackWithoutThumbnails.patterns[0]),
    "blob:existing-full-resolution"
  );
});

test("Paper Library can use a thumbnail when its full-resolution source is unavailable", () => {
  const packWithRenamedOriginal = {
    name: "Pack with renamed original",
    patterns: [
      {
        imagePath: "renamed-pack/01-pattern.jpg",
        imageThumbnailSrc: "blob:thumbnail-from-stored-path"
      }
    ]
  };

  assert.equal(
    getPaperLibraryImageSource(packWithRenamedOriginal.patterns[0]),
    "blob:thumbnail-from-stored-path"
  );
  assert.equal(getPatternImageSource(packWithRenamedOriginal.patterns[0]), "");
});

test("thumbnail generation treats empty or unreadable thumbnail files as unusable", async () => {
  assert.equal(await isUsableThumbnailFile({ getFile: async () => ({ size: 12_000 }) }), true);
  assert.equal(await isUsableThumbnailFile({ getFile: async () => ({ size: 0 }) }), false);
  assert.equal(await isUsableThumbnailFile({ getFile: async () => { throw new Error("unreadable"); } }), false);
});

test("thumbnail generation targets only unique catalog-referenced Paper Pack images", () => {
  const paths = getReferencedPaperPackImagePaths([
    {
      patterns: [
        { imagePath: "Dainty Flowers/Dainty Flowers_7.jpg" },
        { imagePath: "dainty flowers\\Dainty Flowers_7.jpg" },
        { imagePath: "Dainty Flowers/Dainty Flowers_8.jpg" },
        { imageSrc: "data:image/jpeg;base64,embedded" },
        "pattern-placeholder"
      ]
    }
  ]);

  assert.deepEqual([...paths], [
    "dainty flowers/dainty flowers_7.jpg",
    "dainty flowers/dainty flowers_8.jpg"
  ]);
});
