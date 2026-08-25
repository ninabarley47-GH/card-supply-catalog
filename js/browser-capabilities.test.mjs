import test from "node:test";
import assert from "node:assert/strict";
import {
  supportsDirectoryIteration,
  supportsDirectoryPicker,
  supportsOpenFilePicker,
  supportsOrdinaryImageFileFallback
} from "./browser-capabilities.js";

test("picker capabilities are detected independently", () => {
  const directoryOnly = { showDirectoryPicker() {} };
  const fileOnly = { showOpenFilePicker() {} };

  assert.equal(supportsDirectoryPicker(directoryOnly), true);
  assert.equal(supportsOpenFilePicker(directoryOnly), false);
  assert.equal(supportsDirectoryPicker(fileOnly), false);
  assert.equal(supportsOpenFilePicker(fileOnly), true);
});

test("picker properties must be callable", () => {
  const environment = { showDirectoryPicker: undefined, showOpenFilePicker: true };

  assert.equal(supportsDirectoryPicker(environment), false);
  assert.equal(supportsOpenFilePicker(environment), false);
  assert.equal(supportsDirectoryPicker(null), false);
  assert.equal(supportsOpenFilePicker(null), false);
});

test("directory iteration depends on the selected handle", () => {
  assert.equal(supportsDirectoryIteration({ entries() {} }), true);
  assert.equal(supportsDirectoryIteration({ entries: null }), false);
  assert.equal(supportsDirectoryIteration(null), false);
});

test("ordinary image-file fallback requires a file input host and FileReader", () => {
  const supported = {
    document: { createElement() {} },
    FileReader: function FileReader() {}
  };

  assert.equal(supportsOrdinaryImageFileFallback(supported), true);
  assert.equal(supportsOrdinaryImageFileFallback({ document: supported.document }), false);
  assert.equal(supportsOrdinaryImageFileFallback({ FileReader: supported.FileReader }), false);
  assert.equal(supportsOrdinaryImageFileFallback(null), false);
});

test("ordinary image fallback can exist without filesystem pickers", () => {
  const fallbackOnly = {
    document: { createElement() {} },
    FileReader: function FileReader() {}
  };

  assert.equal(supportsDirectoryPicker(fallbackOnly), false);
  assert.equal(supportsOpenFilePicker(fallbackOnly), false);
  assert.equal(supportsOrdinaryImageFileFallback(fallbackOnly), true);
});
