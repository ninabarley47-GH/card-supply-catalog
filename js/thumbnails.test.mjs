import test from "node:test";
import assert from "node:assert/strict";

globalThis.Blob ??= class Blob {
  constructor(parts = [], options = {}) {
    this.type = options.type || "";
    this.bytes = parts.map((part) =>
      typeof part === "string" ? new TextEncoder().encode(part) : new Uint8Array(part)
    );
    this.size = this.bytes.reduce((total, part) => total + part.byteLength, 0);
  }

  async arrayBuffer() {
    const combinedBytes = new Uint8Array(this.size);
    let offset = 0;

    for (const part of this.bytes) {
      combinedBytes.set(part, offset);
      offset += part.byteLength;
    }

    return combinedBytes.buffer;
  }
};

const sourceImage = new Blob(["full-resolution-source"], { type: "image/png" });
const sourceSnapshot = await sourceImage.arrayBuffer();
let bitmapDimensions = { width: 1600, height: 1200 };
let bitmapClosed = false;
let canvasState;

globalThis.createImageBitmap = async (blob, options) => {
  assert.equal(blob, sourceImage);
  assert.deepEqual(options, { imageOrientation: "from-image" });

  return {
    ...bitmapDimensions,
    close() {
      bitmapClosed = true;
    }
  };
};

globalThis.document = {
  createElement(elementName) {
    assert.equal(elementName, "canvas");
    const context = {
      drawImage(...argumentsReceived) {
        canvasState.drawArguments = argumentsReceived;
      }
    };

    canvasState = {
      canvas: {
        width: 0,
        height: 0,
        getContext: () => context,
        toBlob(callback, type, quality) {
          canvasState.encoding = { type, quality };
          callback(new Blob([new Uint8Array(18_000)], { type }));
        }
      },
      context
    };

    return canvasState.canvas;
  }
};

const { generateImageThumbnail } = await import("./thumbnails.js");

test("creates a 400px landscape JPEG thumbnail", async () => {
  bitmapDimensions = { width: 1600, height: 1200 };
  bitmapClosed = false;

  const thumbnail = await generateImageThumbnail(sourceImage);

  assert.equal(canvasState.canvas.width, 400);
  assert.equal(canvasState.canvas.height, 300);
  assert.deepEqual(canvasState.drawArguments.slice(1), [0, 0, 400, 300]);
  assert.deepEqual(canvasState.encoding, { type: "image/jpeg", quality: 0.82 });
  assert.equal(thumbnail.type, "image/jpeg");
  assert.equal(thumbnail.size, 18_000);
  assert.equal(canvasState.context.imageSmoothingEnabled, true);
  assert.equal(canvasState.context.imageSmoothingQuality, "high");
  assert.equal(bitmapClosed, true);
});

test("creates a 400px portrait thumbnail while preserving aspect ratio", async () => {
  bitmapDimensions = { width: 1200, height: 1600 };

  await generateImageThumbnail(sourceImage);

  assert.equal(canvasState.canvas.width, 300);
  assert.equal(canvasState.canvas.height, 400);
});

test("does not upscale a source image smaller than 400px", async () => {
  bitmapDimensions = { width: 320, height: 200 };

  await generateImageThumbnail(sourceImage);

  assert.equal(canvasState.canvas.width, 320);
  assert.equal(canvasState.canvas.height, 200);
});

test("does not alter the source Blob", async () => {
  assert.deepEqual(await sourceImage.arrayBuffer(), sourceSnapshot);
  assert.equal(sourceImage.type, "image/png");
  assert.equal(sourceImage.size, 22);
});

test("rejects non-image input", async () => {
  await assert.rejects(
    generateImageThumbnail(new Blob(["not an image"], { type: "text/plain" })),
    { name: "TypeError", message: "A valid image Blob or File is required." }
  );
});

test("creates a representative new-image thumbnail without changing its source", async () => {
  const representativeSource = new Blob([new Uint8Array(1_248_000)], { type: "image/jpeg" });
  const representativeSnapshot = await representativeSource.arrayBuffer();
  bitmapDimensions = { width: 2400, height: 1800 };

  globalThis.createImageBitmap = async (blob) => ({
    ...bitmapDimensions,
    close() {
      bitmapClosed = true;
    }
  });

  const thumbnail = await generateImageThumbnail(representativeSource);

  assert.equal(canvasState.canvas.width, 400);
  assert.equal(canvasState.canvas.height, 300);
  assert.equal(thumbnail.type, "image/jpeg");
  assert.equal(thumbnail.size, 18_000);
  assert.equal(representativeSource.size, 1_248_000);
  assert.deepEqual(await representativeSource.arrayBuffer(), representativeSnapshot);
});
