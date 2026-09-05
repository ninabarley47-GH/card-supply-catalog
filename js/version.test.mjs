import test from "node:test";
import assert from "node:assert/strict";
import { isAppUpdateAvailable } from "./version.js";

test("update availability compares the deployed build with the controlling cache", () => {
  assert.equal(isAppUpdateAvailable("2026.09.05.10", "card-supply-catalog-2026.09.05.9"), true);
  assert.equal(isAppUpdateAvailable("2026.09.05.10", "card-supply-catalog-2026.09.05.10"), false);
});

test("a waiting worker is an update even when version metadata already matches", () => {
  assert.equal(isAppUpdateAvailable("2026.09.05.10", "card-supply-catalog-2026.09.05.10", true), true);
});

test("an uncontrolled page does not claim an update from metadata alone", () => {
  assert.equal(isAppUpdateAvailable("2026.09.05.10", "unavailable"), false);
});
