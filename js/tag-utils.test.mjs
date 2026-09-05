import test from "node:test";
import assert from "node:assert/strict";
import {
  getTagKey,
  normalizeTagName
} from "./tag-utils.js";

test("normalizes whitespace while preserving display casing", () => {
  assert.equal(normalizeTagName("  Fun\t  Fold \n"), "Fun Fold");
  assert.equal(getTagKey("  Fun   Fold "), "fun fold");
});
