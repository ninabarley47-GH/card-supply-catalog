import test from "node:test";
import assert from "node:assert/strict";
import { getUncatalogedPackDiscoveryAvailability } from "./images.js";
import { getUncatalogedPackControlPresentation } from "./library.js";

const pickerEnvironment = { showDirectoryPicker() {} };
const iterableDirectoryHandle = { entries() {} };

test("unsupported browsers hide Find Uncataloged Packs", async () => {
  const availability = await getUncatalogedPackDiscoveryAvailability({});

  assert.deepEqual(availability, { available: false, reason: "unsupported" });
  assert.deepEqual(getUncatalogedPackControlPresentation(availability), {
    hidden: true,
    disabled: true,
    message: ""
  });
});

test("supported browsers without a saved Paper folder show a disabled control", async () => {
  const availability = await getUncatalogedPackDiscoveryAvailability(pickerEnvironment, {
    loadCatalogSetting: async () => null
  });
  const presentation = getUncatalogedPackControlPresentation(availability);

  assert.equal(availability.reason, "disconnected");
  assert.equal(presentation.hidden, false);
  assert.equal(presentation.disabled, true);
  assert.match(presentation.message, /Paper image folder/);
});

test("a saved Paper folder with denied permission keeps the control disabled without prompting", async () => {
  let permissionOptions = null;
  const availability = await getUncatalogedPackDiscoveryAvailability(pickerEnvironment, {
    loadCatalogSetting: async () => ({ directoryHandle: iterableDirectoryHandle }),
    hasDirectoryPermission: async (_handle, _mode, options) => {
      permissionOptions = options;
      return false;
    }
  });

  assert.deepEqual(permissionOptions, { requestPermission: false });
  assert.equal(availability.reason, "disconnected");
  assert.equal(getUncatalogedPackControlPresentation(availability).disabled, true);
});

test("a non-iterable saved directory handle is treated as unsupported", async () => {
  const availability = await getUncatalogedPackDiscoveryAvailability(pickerEnvironment, {
    loadCatalogSetting: async () => ({ directoryHandle: {} })
  });

  assert.equal(availability.reason, "unsupported");
  assert.equal(getUncatalogedPackControlPresentation(availability).hidden, true);
});

test("a readable iterable Paper folder preserves the enabled control", async () => {
  const availability = await getUncatalogedPackDiscoveryAvailability(pickerEnvironment, {
    loadCatalogSetting: async () => ({ directoryHandle: iterableDirectoryHandle }),
    hasDirectoryPermission: async () => true
  });

  assert.deepEqual(availability, { available: true, reason: "ready" });
  assert.deepEqual(getUncatalogedPackControlPresentation(availability), {
    hidden: false,
    disabled: false,
    message: ""
  });
});
