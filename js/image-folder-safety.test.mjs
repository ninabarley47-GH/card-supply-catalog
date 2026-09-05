import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Paper, Card, and Stamp image-library code never calls the destructive directory removal API", async () => {
  const sources = await Promise.all([
    readFile(new URL("./images.js", import.meta.url), "utf8"),
    readFile(new URL("./card-images.js", import.meta.url), "utf8"),
    readFile(new URL("./library.js", import.meta.url), "utf8"),
    readFile(new URL("./cards.js", import.meta.url), "utf8"),
    readFile(new URL("./image-references.js", import.meta.url), "utf8"),
    readFile(new URL("./stamp-die-images.js", import.meta.url), "utf8")
  ]);

  for (const source of sources) {
    assert.equal(source.includes(".removeEntry("), false);
    assert.equal(source.includes("deletePaperPackImages"), false);
  }
});
