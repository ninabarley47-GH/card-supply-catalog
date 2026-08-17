import test from "node:test";
import assert from "node:assert/strict";
import { createImportPlan } from "./import-mode.js";

const existingRecords = [
  { id: "matching-record", value: "current" },
  { id: "existing-only-record", value: "keep me" }
];
const importedRecords = [
  { id: "matching-record", value: "from backup" },
  { id: "backup-only-record", value: "new" }
];

test("incremental import adds new records and skips matching IDs", () => {
  const plan = createImportPlan(importedRecords, existingRecords, false);

  assert.deepEqual(plan.recordsToImport, [importedRecords[1]]);
  assert.equal(plan.matchingCount, 1);
  assert.equal(plan.newCount, 1);
  assert.equal(plan.skippedCount, 1);
});

test("overlay import replaces matching IDs and also adds new records", () => {
  const plan = createImportPlan(importedRecords, existingRecords, true);

  assert.deepEqual(plan.recordsToImport, importedRecords);
  assert.equal(plan.matchingCount, 1);
  assert.equal(plan.newCount, 1);
  assert.equal(plan.skippedCount, 0);
});

test("records with different IDs remain distinct in both modes", () => {
  const visuallySimilarExistingCard = { id: "card-current", imageName: "same-card.jpg" };
  const visuallySimilarImportedCard = { id: "card-backup", imageName: "same-card.jpg" };

  assert.deepEqual(
    createImportPlan([visuallySimilarImportedCard], [visuallySimilarExistingCard], false).recordsToImport,
    [visuallySimilarImportedCard]
  );
  assert.deepEqual(
    createImportPlan([visuallySimilarImportedCard], [visuallySimilarExistingCard], true).recordsToImport,
    [visuallySimilarImportedCard]
  );
});
