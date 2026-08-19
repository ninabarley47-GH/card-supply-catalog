import test from "node:test";
import assert from "node:assert/strict";
import { addTag, countTagAssignments, removeTag, renameTag, replaceTagAssignments } from "./tag-utils.js";

test("adds a normalized tag and prevents duplicates", () => {
  assert.deepEqual(addTag(["Floral"], "  Fun   Fold "), ["Floral", "Fun Fold"]);
  assert.deepEqual(addTag(["Floral"], " floral "), ["Floral"]);
});
test("renames a tag and prevents rename duplicates", () => {
  assert.deepEqual(renameTag(["Old", "Other"], "Old", " New  Name ").tags, ["New Name", "Other"]);
  assert.equal(renameTag(["Old", "Other"], "Old", "other").reason, "duplicate");
});
test("deletes an unassigned tag", () => assert.deepEqual(removeTag(["Keep", "Delete"], " delete "), ["Keep"]));
test("Paper and Card vocabularies remain separate", () => {
  assert.deepEqual(addTag(["Paper"], "Paper only"), ["Paper", "Paper only"]);
  assert.deepEqual(addTag(["Card"], "Card only"), ["Card", "Card only"]);
});
test("assigned tags are detected before removal", () => {
  assert.equal(countTagAssignments([{ tags: ["Birthday"] }, { tags: [" birthday "] }], "tags", "BIRTHDAY"), 2);
});
test("rename migration updates assignments without creating duplicates", () => {
  assert.deepEqual(replaceTagAssignments([{ keywords: ["Old", "New"] }], "keywords", "Old", "New")[0].keywords, ["New"]);
});
