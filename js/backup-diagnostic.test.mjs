import test from "node:test";
import assert from "node:assert/strict";
import { createEmbeddedImageStreamScanner } from "./backup.js";

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

