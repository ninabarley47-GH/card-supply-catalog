import test from "node:test";
import assert from "node:assert/strict";
import { createEmbeddedImageStreamScanner, createShareableDiagnosticReport } from "./backup.js";

test("low-memory scanner finds embedded images across arbitrary chunk boundaries", () => {
  const scanner = createEmbeddedImageStreamScanner();
  const json = JSON.stringify({
    paperPacks: [{ patterns: [{ imageSrc: "data:image/jpeg;base64,QUJDRA==" }] }],
    cards: [{ imageSrc: "data:image/png;base64,AAEC" }]
  });

  for (let offset = 0; offset < json.length; offset += 7) {
    scanner.push(json.slice(offset, offset + 7));
  }
  scanner.finish();

  const images = scanner.getImages();
  assert.equal(images.length, 2);
  assert.deepEqual(
    images.map(({ mimeType, supportedPrefix, base64CharacterCount, estimatedDecodedBytes, invalidBase64Characters }) => ({
      mimeType,
      supportedPrefix,
      base64CharacterCount,
      estimatedDecodedBytes,
      invalidBase64Characters
    })),
    [
      { mimeType: "image/jpeg", supportedPrefix: true, base64CharacterCount: 8, estimatedDecodedBytes: 4, invalidBase64Characters: 0 },
      { mimeType: "image/png", supportedPrefix: true, base64CharacterCount: 4, estimatedDecodedBytes: 3, invalidBase64Characters: 0 }
    ]
  );
});

test("low-memory scanner reports unsupported and malformed image data", () => {
  const scanner = createEmbeddedImageStreamScanner();
  scanner.push('{"imageSrc":"data:image/tiff;base64,QU JD"}');
  scanner.finish();

  const [image] = scanner.getImages();
  assert.equal(image.supportedPrefix, false);
  assert.equal(image.mimeType, "image/tiff");
  assert.equal(image.invalidBase64Characters, 1);
});

test("shareable diagnostic keeps failures and only the ten largest valid images", () => {
  const images = Array.from({ length: 15 }, (_, index) => ({
    imageIndex: index + 1,
    supportedPrefix: index !== 3,
    invalidBase64Characters: index === 3 ? 1 : 0,
    estimatedDecodedBytes: (index + 1) * 100
  }));
  const compact = createShareableDiagnosticReport({
    diagnosticMode: "read-only-streaming-scan",
    images,
    summary: { failures: 1 }
  });

  assert.equal("images" in compact, true);
  assert.equal(compact.images, undefined);
  assert.deepEqual(compact.imageEvidence.malformedImages.map((image) => image.imageIndex), [4]);
  assert.deepEqual(compact.imageEvidence.largestValidImages.map((image) => image.imageIndex), [15, 14, 13, 12, 11, 10, 9, 8, 7, 6]);
  assert.equal(compact.imageEvidence.omittedSuccessfulImages, 4);
});
