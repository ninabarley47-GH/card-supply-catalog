import test from "node:test";
import assert from "node:assert/strict";
import { applyDefaultOwner, buildPaperPackFromForm, waitForPaperPackPersistence } from "./add-dsp.js";
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
const owners = [
  { id: "owner-nina", name: "Nina" },
  { id: "owner-amanda", name: "Amanda" }
];

test("Add DSP applies the configured device-local Default Owner", () => {
  const form = { elements: { owner: { value: "Previous owner" } } };
  applyDefaultOwner(form, "owner-nina", owners);
  assert.equal(form.elements.owner.value, "Nina");
});

test("Add DSP preserves the last selected owner when no valid Default Owner is set", () => {
  const form = { elements: { owner: { value: "Previous owner" } } };
  applyDefaultOwner(form, "", owners);
  assert.equal(form.elements.owner.value, "Previous owner");
  applyDefaultOwner(form, "owner-missing", owners);
  assert.equal(form.elements.owner.value, "Previous owner");
});

test("Add DSP leaves the owner empty when neither owner default exists", () => {
  const form = { elements: { owner: { value: "" } } };
  applyDefaultOwner(form, "", owners);
  assert.equal(form.elements.owner.value, "");
});

test("Add DSP saves a user-changed owner using that owner's stable ID", () => {
  const form = createValidPaperPackForm();
  form.set("owner", "Amanda");
  const result = buildPaperPackFromForm(form, colorsById, [], null, [], owners);
  assert.equal(result.ok, true);
  assert.equal(result.paperPack.owner, "Amanda");
  assert.equal(result.paperPack.ownerId, "owner-amanda");
});

test("Add DSP stores shared-picker selections in keywords", () => {
  const result = buildPaperPackFromForm(createValidPaperPackForm(), colorsById, [], null, ["Floral", "Fun Fold"]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.paperPack.keywords, ["Floral", "Fun Fold"]);
});

test("Edit DSP round-trips the existing id, favorite, and selected keywords", () => {
  const existing = { id: "original-id", recentlyAdded: true, favorite: true, patterns: [], keywords: ["Floral"] };
  const result = buildPaperPackFromForm(createValidPaperPackForm(), colorsById, [], existing, existing.keywords);
  assert.equal(result.paperPack.id, "original-id");
  assert.equal(result.paperPack.favorite, true);
  assert.deepEqual(result.paperPack.keywords, ["Floral"]);
});

test("legacy Paper keyword replacements remain active", () => {
  assert.deepEqual(normalizePaperPackKeywords({ keywords: ["cartoon", "ocean animals", "background"] }).keywords, ["Illustration", "Water Animals"]);
});

test("Paper tag creation prevents case-insensitive duplicates", async () => {
  const writes = [];
  const updates = [];
  const store = createTagVocabularyStore({ loadVocabulary: async () => ["Floral"], saveVocabulary: async (tags) => writes.push(tags), buildVocabulary: buildEffectivePaperTagVocabulary, onVocabularyChanged: (tags) => updates.push(tags) });
  await store.load([]);
  assert.equal(await store.create(" floral "), "Floral");
  assert.equal(writes.length, 0);
  await store.create("New Paper Tag");
  assert.deepEqual(updates, [["Floral", "New Paper Tag"]]);
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
