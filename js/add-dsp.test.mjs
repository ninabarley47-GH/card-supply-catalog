import test from "node:test";
import assert from "node:assert/strict";
import { waitForPaperPackPersistence } from "./add-dsp.js";

test("Add DSP remains pending until persistence completes", async () => {
  let completePersistence;
  const persistence = new Promise((resolve) => { completePersistence = resolve; });
  let completionObserved = false;

  const resultPromise = waitForPaperPackPersistence(persistence).then((result) => {
    completionObserved = true;
    return result;
  });

  await Promise.resolve();
  assert.equal(completionObserved, false);

  completePersistence({ ok: true, warning: "fallback storage used" });
  assert.deepEqual(await resultPromise, { ok: true, warning: "fallback storage used" });
  assert.equal(completionObserved, true);
});

test("Add DSP converts failed and rejected persistence into non-success results", async () => {
  assert.deepEqual(
    await waitForPaperPackPersistence(Promise.resolve({ ok: false, message: "database full" })),
    { ok: false, message: "database full" }
  );
  assert.deepEqual(
    await waitForPaperPackPersistence(Promise.reject(new Error("database unavailable"))),
    { ok: false, message: "The paper pack could not be saved in this browser." }
  );
});
