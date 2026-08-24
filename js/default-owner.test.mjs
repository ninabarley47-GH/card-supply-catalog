import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_OWNER_SETTING_ID, loadDefaultOwnerId, saveDefaultOwnerId } from "./settings.js";

test("Default Owner stores only the stable owner ID in local settings", async () => {
  const settings = new Map();
  const services = {
    loadCatalogSetting: async (id) => settings.get(id) ?? null,
    saveCatalogSetting: async (id, value) => settings.set(id, value)
  };
  await saveDefaultOwnerId("owner-nina", services);
  assert.equal(settings.get(DEFAULT_OWNER_SETTING_ID), "owner-nina");
  assert.equal(await loadDefaultOwnerId(services), "owner-nina");
});

test("clearing Default Owner leaves it unset", async () => {
  let savedValue = "not-called";
  await saveDefaultOwnerId("", { saveCatalogSetting: async (_id, value) => { savedValue = value; } });
  assert.equal(savedValue, null);
});
