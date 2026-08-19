import test from "node:test";
import assert from "node:assert/strict";
import { buildPaperPackFromForm, waitForPaperPackPersistence } from "./add-dsp.js";
import { createTagVocabularyStore } from "./card-tags.js";
import { normalizePaperPackKeywords } from "./storage.js";
import { buildEffectiveCardTagVocabulary, buildEffectivePaperTagVocabulary } from "./tag-utils.js";

function createValidPaperPackForm() {
  const form = new FormData();
  form.set("name", "Test Pack");
  form.set("owner", "Nina");
  form.set("releaseYear", "2026");
  form.set("patternCount", "1");
  form.set("colors", "red");
  form.set("availability", "available");
  form.set("refillAvailable", "");
  return form;
}

const colorsById = { red: { id: "red", name: "Red" } };

test("Add DSP stores shared-picker selections in keywords", () => {
  const result = buildPaperPackFromForm(createValidPaperPackForm(), colorsById, [], null, ["Floral", "Fun Fold"]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.paperPack.keywords, ["Floral", "Fun Fold"]);
});

test("Edit DSP round-trips the existing id and selected keywords", () => {
  const existing = { id: "original-id", recentlyAdded: true, patterns: [], keywords: ["Floral"] };
  const result = buildPaperPackFromForm(createValidPaperPackForm(), colorsById, [], existing, existing.keywords);
  assert.equal(result.paperPack.id, "original-id");
  assert.deepEqual(result.paperPack.keywords, ["Floral"]);
});

test("legacy Paper keyword replacements remain active", () => {
  assert.deepEqual(normalizePaperPackKeywords({ keywords: ["cartoon", "ocean animals", "background"] }).keywords, ["Illustration", "Water Animals"]);
});

test("Paper tag creation prevents case-insensitive duplicates", async () => {
  const writes = [];
  const store = createTagVocabularyStore({ loadVocabulary: async () => ["Floral"], saveVocabulary: async (tags) => writes.push(tags), buildVocabulary: buildEffectivePaperTagVocabulary });
  await store.load([]);
  assert.equal(await store.create(" floral "), "Floral");
  assert.equal(writes.length, 0);
});

test("Paper and Card vocabulary stores remain isolated", async () => {
  const paperStore = createTagVocabularyStore({ loadVocabulary: async () => ["Paper Only"], saveVocabulary: async () => {}, buildVocabulary: buildEffectivePaperTagVocabulary });
  const cardStore = createTagVocabularyStore({ loadVocabulary: async () => ["Card Only"], saveVocabulary: async () => {}, buildVocabulary: buildEffectiveCardTagVocabulary });
  const paper = await paperStore.load([]);
  const card = await cardStore.load([]);
  assert.equal(paper.includes("Card Only"), false);
  assert.equal(card.includes("Paper Only"), false);
});

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
