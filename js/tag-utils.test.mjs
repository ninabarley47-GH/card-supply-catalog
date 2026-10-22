import test from "node:test";
import assert from "node:assert/strict";
import {
  getTagKey,
  getProductNameKey,
  normalizeTagName
} from "./tag-utils.js";

test("normalizes whitespace while preserving display casing", () => {
  assert.equal(normalizeTagName("  Fun\t  Fold \n"), "Fun Fold");
  assert.equal(getTagKey("  Fun   Fold "), "fun fold");
});

test('product name comparison treats standalone and and ampersand as equivalent', () => {
  assert.equal(getProductNameKey('Blooms And Bliss'), getProductNameKey('Blooms & Bliss'));
  assert.equal(getProductNameKey('  BLOOMS   aNd   BLISS '), getProductNameKey('Blooms   &   Bliss'));
  assert.notEqual(getProductNameKey('Blooms Bliss'), getProductNameKey('Blooms and Bliss'));
  assert.notEqual(getProductNameKey('Anderson Blooms'), getProductNameKey('&erson Blooms'));
});
