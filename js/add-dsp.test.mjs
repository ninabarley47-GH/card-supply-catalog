import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyDefaultOwner, buildPaperPackFromForm, getPatternImageHelpText, shouldShowPatternLibraryPicker, waitForPaperPackPersistence } from "./add-dsp.js";
import { normalizePaperPackKeywords } from "./storage.js";

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
const tagCatalog = {
  schemaVersion: 1,
  categories: [],
  tags: [
    { id: "tag-floral", name: "Floral", appliesTo: ["paper"], categoryIds: [] },
    { id: "tag-fun-fold", name: "Fun Fold", appliesTo: ["paper"], categoryIds: [] }
  ]
};
const owners = [
  { id: "owner-nina", name: "Nina" },
  { id: "owner-amanda", name: "Amanda" }
];

test("Add Paper applies the configured device-local Default Owner", () => {
  const form = { elements: { owner: { value: "Previous owner" } } };
  applyDefaultOwner(form, "owner-nina", owners);
  assert.equal(form.elements.owner.value, "Nina");
});

test("Add Paper preserves the last selected owner when no valid Default Owner is set", () => {
  const form = { elements: { owner: { value: "Previous owner" } } };
  applyDefaultOwner(form, "", owners);
  assert.equal(form.elements.owner.value, "Previous owner");
  applyDefaultOwner(form, "owner-missing", owners);
  assert.equal(form.elements.owner.value, "Previous owner");
});

test("Add Paper leaves the owner empty when neither owner default exists", () => {
  const form = { elements: { owner: { value: "" } } };
  applyDefaultOwner(form, "", owners);
  assert.equal(form.elements.owner.value, "");
});

test("Add Paper saves a user-changed owner using that owner's stable ID", () => {
  const form = createValidPaperPackForm();
  form.set("owner", "Amanda");
  const result = buildPaperPackFromForm(form, colorsById, [], null, [], owners);
  assert.equal(result.ok, true);
  assert.equal(result.paperPack.owner, "Amanda");
  assert.equal(result.paperPack.ownerId, "owner-amanda");
});

test("Add Paper stores canonical picker IDs with a temporary keyword projection", () => {
  const result = buildPaperPackFromForm(createValidPaperPackForm(), colorsById, [], null, ["tag-floral", "tag-fun-fold"], [], tagCatalog);
  assert.equal(result.ok, true);
  assert.deepEqual(result.paperPack.tagIds, ["tag-floral", "tag-fun-fold"]);
  assert.deepEqual(result.paperPack.keywords, ["Floral", "Fun Fold"]);
});

test("Edit Paper round-trips the existing id, favorite, and canonical tag IDs", () => {
  const existing = { id: "original-id", recentlyAdded: true, favorite: true, patterns: [], tagIds: ["tag-floral"], keywords: ["Floral"] };
  const result = buildPaperPackFromForm(createValidPaperPackForm(), colorsById, [], existing, existing.tagIds, [], tagCatalog);
  assert.equal(result.paperPack.id, "original-id");
  assert.equal(result.paperPack.favorite, true);
  assert.deepEqual(result.paperPack.tagIds, ["tag-floral"]);
  assert.deepEqual(result.paperPack.keywords, ["Floral"]);
});

test("Add Paper stores the Not Bought paper-pack status", () => {
  const form = createValidPaperPackForm();
  form.set("availability", "not-bought");
  const result = buildPaperPackFromForm(form, colorsById, [], null, []);
  assert.equal(result.ok, true);
  assert.equal(result.paperPack.availability, "not-bought");
});

test("legacy Paper keyword replacements remain active", () => {
  assert.deepEqual(normalizePaperPackKeywords({ keywords: ["cartoon", "ocean animals", "background"] }).keywords, ["Illustration", "Water Animals"]);
});

test("Add Paper remains pending until persistence completes", async () => {
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

test("Add Paper converts failed and rejected persistence into non-success results", async () => {
  assert.deepEqual(
    await waitForPaperPackPersistence(Promise.resolve({ ok: false, message: "database full" })),
    { ok: false, message: "database full" }
  );
  assert.deepEqual(
    await waitForPaperPackPersistence(Promise.reject(new Error("database unavailable"))),
    { ok: false, message: "The paper pack could not be saved in this browser." }
  );
});

test("Add From Library is shown only when the open-file picker is supported", () => {
  assert.equal(shouldShowPatternLibraryPicker({ showOpenFilePicker() {} }), true);
  assert.equal(shouldShowPatternLibraryPicker({}), false);
  assert.equal(shouldShowPatternLibraryPicker(null), false);
});

test("Paper image actions prioritize the library picker and use one multiple-file fallback", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const libraryPickerIndex = html.indexOf("data-pattern-library-picker");
  const fileInputIndex = html.indexOf('id="dsp-pattern-images"');

  assert.ok(libraryPickerIndex >= 0);
  assert.ok(fileInputIndex > libraryPickerIndex);
  assert.match(html, /id="dsp-pattern-images"[^>]*\smultiple(?:\s|>)/);
  assert.doesNotMatch(html, /id="dsp-pattern-image"(?:\s|>)/);
});

test("Paper image help matches directory capability", () => {
  assert.match(
    getPatternImageHelpText({ showDirectoryPicker() {} }),
    /image library folder is selected in Settings/
  );
  assert.equal(
    getPatternImageHelpText({}),
    "Choose one or more images from this device. They will be stored with this browser's catalog."
  );
});


test("Paper form titles use Add Paper and Edit Paper", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("./add-dsp.js", import.meta.url), "utf8");
  assert.match(html, /data-add-dsp-title>Add Paper<\/h3>/);
  assert.match(html, /aria-label="Close Add Paper"/);
  assert.match(source, /controls\.title\.textContent = "Edit Paper"/);
  assert.match(source, /controls\.title\.textContent = "Add Paper"/);
  assert.doesNotMatch(source, /"(?:Add|Edit) DSP"/);
});


test("Paper terminology covers visible labels, messages and app description while retaining internal hooks", async () => {
  const [html, source, library, settings, manifestText] = await Promise.all(
    ['../index.html', './add-dsp.js', './library.js', './settings.js', '../manifest.webmanifest']
      .map(file => readFile(new URL(file, import.meta.url), 'utf8')));
  for (const text of ['Visual Paper Library', '>Paper Packs<', '>Paper Pack Name<', '>Paper</h2>', 'Save a new paper pack to this catalog.']) assert.ok(html.includes(text), text);
  assert.match(html, /Paper\s*<select name="productDsp">/);
  assert.match(library, /createColorDetailItem\("Paper", formatMetadataValue\(color.products\?\.dsp\)\)/);
  assert.match(settings, /Paper image folder ready/);
  assert.equal(JSON.parse(manifestText).description, 'A visual library for paper and coordinating colors.');
  for (const text of ['saving this paper pack.', 'Change the paper pack name', 'unique paper pack name', 'Update this paper pack.', 'Save a new paper pack to this catalog.']) assert.ok(source.includes(text), text);
  assert.match(getPatternImageHelpText({ showDirectoryPicker() {} }), /matching the paper pack name/);
  assert.match(html, /matching the paper pack name/);
  assert.match(source, /ADD_DSP_DEFAULTS_SETTING_ID = "addDspDefaults"/);
  assert.match(source, /source: "add-dsp"/);
  assert.match(html, /id="dsp-name"/);
  assert.doesNotMatch(html.replace(/<[^>]*>/g, ''), /\bDSP\b|Designer Series Paper/);
});
import vm from 'node:vm';

const addDspSource = await readFile(new URL('./add-dsp.js', import.meta.url), 'utf8');
function autoCountHarness(loadImages, editingPaperPack = null) {
  const form = { elements: { name: { value: 'Test Pack' }, patternCount: { value: '12' } } };
  const selectedImages = [];
  const state = { editingPaperPack, autoLoadedPaperPackId: '', isLoadingLibraryImages: false };
  const context = vm.createContext({
    window: {}, supportsDirectoryPicker: () => true,
    cleanText: value => value.trim(), createId: value => value.toLowerCase(),
    loadPatternImagesForPaperPackName: loadImages,
    renderFormMessage() {}, renderImagePreviews() {}
  });
  const start = addDspSource.indexOf('async function autoLoadImagesForCurrentPaperPackName(');
  const end = addDspSource.indexOf('async function addImagesFromInput(', start);
  vm.runInContext(addDspSource.slice(start, end), context);
  return { form, selectedImages, state,
    load: () => context.autoLoadImagesForCurrentPaperPackName(form, selectedImages, null, null, null, state) };
}

for (const imageCount of [0, 6, 12, 24]) {
  test('Add Paper defaults pattern count from folder with ' + imageCount + ' images and preserves later edits', async () => {
    let lookups = 0;
    const h = autoCountHarness(async () => {
      lookups++;
      return { ok: true, images: Array.from({ length: imageCount }, () => ({})), message: '' };
    });
    // An old value must not prevent the new folder-based default.
    h.form.elements.patternCount.value = '30';
    await h.load();
    assert.equal(h.form.elements.patternCount.value, String(imageCount || 12));
    assert.equal(h.selectedImages.length, imageCount);
    h.form.elements.patternCount.value = '36';
    await h.load(); // Repeated blur and submit must preserve a user's choice.
    assert.equal(h.form.elements.patternCount.value, '36');
    assert.equal(lookups, 1);
  });
}

test('Add Paper preserves a user-entered count while folder images are loading', async () => {
  let finish;
  const h = autoCountHarness(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.load();
  h.form.elements.patternCount.value = '20';
  finish({ ok: true, images: Array.from({ length: 6 }, () => ({})), message: '' });
  await pending;
  assert.equal(h.form.elements.patternCount.value, '20');
  assert.equal(h.selectedImages.length, 6);
});

test('Edit Paper does not replace its saved pattern count through automatic folder loading', async () => {
  const h = autoCountHarness(() => assert.fail('editing must not perform automatic lookup'), { id: 'existing' });
  h.form.elements.patternCount.value = '18';
  await h.load();
  assert.equal(h.form.elements.patternCount.value, '18');
});
