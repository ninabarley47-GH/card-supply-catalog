import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateGlobalTagCatalog } from "./global-tag-catalog.js";
import {
  addGlobalCategory, addGlobalTag, addTagToCategory, editGlobalCategory, editGlobalTag,
  getGlobalTagUsage, removeGlobalCategory, removeGlobalTag, removeTagFromCategory, sortGlobalTags
} from "./global-tag-management.js";

const tag = (id, name, appliesTo = ["paper"], categoryIds = []) => ({ id, name, appliesTo, categoryIds });
const catalog = (tags = [], categories = []) => ({ schemaVersion: 1, tags, categories });

test("Settings declares one flat global tag manager rather than product-specific managers", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("./settings.js", import.meta.url), "utf8");
  assert.equal((html.match(/data-global-tag-settings/g) || []).length, 1);
  assert.equal(html.includes('data-tag-settings="paper"'), false);
  assert.equal(html.includes('data-tag-settings="card"'), false);
  assert.equal(html.includes("data-tag-add-product"), false);
  assert.equal(source.includes("global-tag-applicability"), false);
});

test("successful global tag changes request an immediate Paper Library refresh", async () => {
  const source = await readFile(new URL("./settings.js", import.meta.url), "utf8");
  const manager = source.slice(source.indexOf("async function initializeTagSettings"), source.indexOf("function confirmTagDeletion"));
  assert.match(manager, /onPaperPacksUpdated\?\.\(\)/);
  assert.match(manager, /dispatchGlobalTagUpdates\(\)/);
});

test("the row Edit button is hidden while the global tag editor is open", async () => {
  const styles = await readFile(new URL("../css/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.global-tag-settings-row > \.button\[hidden\]\s*\{\s*display:\s*none;/);
});

test("one shared Paper and Card tag remains one rendered entity", () => {
  const shared = tag("shared", "Holiday", ["paper", "card"]);
  assert.deepEqual(sortGlobalTags(catalog([shared]).tags), [shared]);
});

test("usage reports Paper, Card, and Stamp assignment counts", () => {
  const source = catalog([tag("all", "Holiday", ["paper", "card", "stamp"])]);
  const usage = getGlobalTagUsage(source, {
    paperRecords: [{ tagIds: ["all"] }], cardRecords: [{ tagIds: ["all"] }, { tagIds: ["all"] }], stampRecords: [{ tagIds: ["all"] }]
  });
  assert.deepEqual(usage.get("all"), { paper: 1, card: 2, stamp: 1 });
});

test("adds a universal global tag without writing deprecated applicability", () => {
  const result = addGlobalTag(catalog(), { name: "  New   Tag ", idFactory: () => "opaque" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.tag, { id: "opaque", name: "New Tag", categoryIds: [] });
});

test("blocks exact normalized duplicates and points to the existing entity", () => {
  const existing = tag("one", "Birthday");
  const result = addGlobalTag(catalog([existing]), { name: " birthday ", appliesTo: ["card"] });
  assert.equal(result.reason, "duplicate");
  assert.equal(result.existingTag.id, "one");
});

test("fuzzy duplicates warn only and may be explicitly created", () => {
  const source = catalog([tag("one", "Birthday")]);
  const warning = addGlobalTag(source, { name: "Birthdays", appliesTo: ["card"], idFactory: () => "two" });
  assert.equal(warning.reason, "fuzzy");
  assert.equal(source.tags.length, 1);
  const created = addGlobalTag(source, { name: "Birthdays", appliesTo: ["card"], allowFuzzy: true, idFactory: () => "two" });
  assert.equal(created.ok, true);
  assert.equal(created.catalog.tags.length, 2);
});

test("adds an empty category and blocks exact normalized duplicates", () => {
  const added = addGlobalCategory(catalog(), { name: "  Messages ", idFactory: () => "category-messages" });
  assert.deepEqual(added.category, { id: "category-messages", name: "Messages" });
  assert.deepEqual(added.catalog.tags, []);
  const duplicate = addGlobalCategory(added.catalog, { name: " messages " });
  assert.equal(duplicate.reason, "duplicate");
  assert.equal(duplicate.existingCategory.id, "category-messages");
});

test("fuzzy category match warns without merging and may be explicitly created", () => {
  const source = catalog([], [{ id: "category-message", name: "Message" }]);
  const warning = addGlobalCategory(source, { name: "Messages", idFactory: () => "category-messages" });
  assert.equal(warning.reason, "fuzzy");
  assert.equal(source.categories.length, 1);
  const created = addGlobalCategory(source, { name: "Messages", allowFuzzy: true, idFactory: () => "category-messages" });
  assert.equal(created.catalog.categories.length, 2);
});

test("renaming a category preserves its stable ID and every tag membership", () => {
  const source = catalog([tag("one", "Birthday", ["card"], ["cat"]), tag("two", "Cake", ["paper"], ["cat"])], [{ id: "cat", name: "Old" }]);
  const result = editGlobalCategory(source, "cat", { name: "Celebrations" });
  assert.equal(result.category.id, "cat");
  assert.deepEqual(result.catalog.tags.map((entry) => entry.categoryIds), [["cat"], ["cat"]]);
});

test("fuzzy category rename warns without changing the catalog and requires explicit confirmation", () => {
  const source = catalog([], [{ id: "animals", name: "Animals" }, { id: "seasons", name: "Seasons" }]);
  const warning = editGlobalCategory(source, "animals", { name: "Season" });
  assert.equal(warning.reason, "fuzzy");
  assert.deepEqual(warning.fuzzyCandidates, ["Seasons"]);
  assert.equal(source.categories.find((entry) => entry.id === "animals").name, "Animals");
  const renamed = editGlobalCategory(source, "animals", { name: "Season", allowFuzzy: true });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.category.id, "animals");
  assert.equal(renamed.category.name, "Season");
});

test("deleting a category removes relationships while preserving tags and item records", () => {
  const source = catalog([tag("one", "Birthday", ["card"], ["cat", "keep"])], [{ id: "cat", name: "Delete" }, { id: "keep", name: "Keep" }]);
  const paperRecords = [{ id: "paper", tagIds: ["one"], patterns: [{ imagePath: "shared.jpg" }] }];
  const cardRecords = [{ id: "card", tagIds: ["one"] }];
  const result = removeGlobalCategory(source, "cat");
  assert.deepEqual(result.catalog.categories.map((entry) => entry.id), ["keep"]);
  assert.deepEqual(result.catalog.tags, [tag("one", "Birthday", ["card"], ["keep"])]);
  assert.deepEqual(paperRecords[0].tagIds, ["one"]);
  assert.deepEqual(cardRecords[0].tagIds, ["one"]);
});

test("tag membership supports multiple categories and preserves ID and applicability", () => {
  const source = catalog([tag("stable", "Birthday", ["card", "stamp"])], [{ id: "messages", name: "Messages" }, { id: "celebrations", name: "Celebrations" }]);
  const first = addTagToCategory(source, "stable", "messages");
  const second = addTagToCategory(first.catalog, "stable", "celebrations");
  assert.deepEqual(second.tag.categoryIds, ["messages", "celebrations"]);
  assert.equal(second.tag.id, "stable");
  assert.deepEqual(second.tag.appliesTo, ["card", "stamp"]);
  const removed = removeTagFromCategory(second.catalog, "stable", "messages");
  assert.deepEqual(removed.tag.categoryIds, ["celebrations"]);
  assert.deepEqual(removed.tag.appliesTo, ["card", "stamp"]);
});

test("duplicate category membership and missing references are rejected", () => {
  const source = catalog([tag("one", "Birthday", ["card"], ["cat"])], [{ id: "cat", name: "Messages" }]);
  assert.equal(addTagToCategory(source, "one", "cat").reason, "duplicate-membership");
  assert.equal(addTagToCategory(source, "one", "missing").reason, "category-not-found");
  assert.equal(addTagToCategory(source, "missing", "cat").reason, "tag-not-found");
});

test("every category and membership mutation produces a valid complete catalog", () => {
  let current = catalog([tag("tag-one", "Birthday", ["card", "stamp"])], []);
  const mutations = [
    () => addGlobalCategory(current, { name: "Messages", idFactory: () => "category-one" }),
    () => editGlobalCategory(current, "category-one", { name: "Celebrations" }),
    () => addTagToCategory(current, "tag-one", "category-one"),
    () => removeTagFromCategory(current, "tag-one", "category-one"),
    () => removeGlobalCategory(current, "category-one")
  ];
  for (const mutate of mutations) {
    const result = mutate();
    assert.equal(result.ok, true);
    assert.equal(validateGlobalTagCatalog(result.catalog).ok, true);
    current = result.catalog;
  }
});

test("C2 Settings stays flat, excludes assigned category choices, and does not use item or image deletion APIs", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("./settings.js", import.meta.url), "utf8");
  assert.equal((html.match(/data-tag-list/g) || []).length, 1);
  assert.match(html, /data-category-add-form/);
  assert.match(html, /data-category-list/);
  assert.match(source, /filter\(\(category\) => !tag\.categoryIds\.includes\(category\.id\)\)/);
  const deleteStart = source.indexOf("onDelete: async () =>", source.indexOf("createGlobalCategorySettingsRow"));
  const deleteEnd = source.indexOf("}))", deleteStart);
  const categoryDelete = source.slice(deleteStart, deleteEnd);
  assert.match(categoryDelete, /removeGlobalCategory/);
  assert.match(categoryDelete, /persistCatalogMutation/);
  assert.equal(/savePaper|deleteGlobalTagEverywhere|image|directory|folder/i.test(categoryDelete), false);
});

test("category rows match tag rows with read-only display, Edit, Save/Cancel, and trash action", async () => {
  const source = await readFile(new URL("./settings.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../css/styles.css", import.meta.url), "utf8");
  const row = source.slice(source.indexOf("function createGlobalCategorySettingsRow"), source.indexOf("function createGlobalTagSettingsRow"));
  assert.match(row, /category-settings-display/);
  assert.match(row, /edit\.textContent = "Edit"/);
  assert.match(row, /save\.textContent = "Save"/);
  assert.match(row, /cancel\.textContent = "Cancel"/);
  assert.match(row, /remove\.className = "tag-settings-action"/);
  assert.match(row, /<svg/);
  assert.match(row, /editor\.hidden = true/);
  assert.match(styles, /\.category-settings-list\s*\{[^}]*justify-items:\s*start;/);
  assert.match(styles, /\.category-settings-row\s*\{[^}]*justify-content:\s*start;[^}]*width:\s*min\(100%, 36rem\);/);
  assert.match(styles, /\.category-settings-display\s*\{[^}]*justify-self:\s*start;[^}]*text-align:\s*left;/);
  assert.match(styles, /\.category-settings-display strong, \.category-settings-display span\s*\{\s*justify-self:\s*start;/);
});

test("category validation feedback is rendered beside category controls", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("./settings.js", import.meta.url), "utf8");
  const categorySection = html.slice(html.indexOf('<section class="category-settings"'), html.indexOf("</section>", html.indexOf('<section class="category-settings"')));
  assert.match(categorySection, /data-category-message/);
  assert.ok(categorySection.indexOf("data-category-message") < categorySection.indexOf("data-category-list"));
  assert.match(source, /announceCategory\(result\.reason === "duplicate"/);
  assert.match(source, /persistCatalogMutation\(result, `Renamed category[^;]+announceCategory\)/);
});

test("C2 cleanup collapses creation forms and category choices in the resting state", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("./settings.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../css/styles.css", import.meta.url), "utf8");
  assert.match(html, /data-category-add-open[^>]*>\+ Add Category</);
  assert.match(html, /data-category-add-form hidden/);
  assert.match(html, /data-category-add-cancel/);
  assert.match(html, /data-tag-add-open[^>]*>\+ Add Tag</);
  assert.match(html, /data-tag-add-form hidden/);
  assert.match(html, /data-tag-add-cancel/);
  assert.match(source, /reveal\.textContent = "\+ Add to category"/);
  assert.match(source, /select\.addEventListener\("change", async \(\) =>/);
  assert.doesNotMatch(source.slice(source.indexOf("const availableCategories"), source.indexOf("} else if (!catalog.categories.length)")), /textContent = "Add"/);
  assert.match(styles, /\.category-settings-message:empty, \.tag-settings-message:empty\s*\{\s*display:\s*none;/);
});

test("final C2 labels and tag actions match the category treatment", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("./settings.js", import.meta.url), "utf8");
  const tagRow = source.slice(source.indexOf("function createGlobalTagSettingsRow"), source.indexOf("function formatProductType"));
  assert.match(html, /Tags &amp; Categories/);
  assert.match(html, /Manage the shared tag system for Paper, Cards, and Stamp Sets\./);
  assert.match(html, /<h5>All Tags<\/h5>/);
  assert.doesNotMatch(html, /Tags inventory/);
  assert.match(tagRow, /edit\.className = "tag-settings-action tag-edit-action"/);
  assert.match(tagRow, /edit\.innerHTML = '<svg/);
  assert.match(tagRow, /remove\.className = "tag-settings-action"/);
  assert.match(tagRow, /reveal\.textContent = "\+ Add to category"/);
});

test("successful Settings messages clear without hiding errors automatically", async () => {
  const source = await readFile(new URL("./settings.js", import.meta.url), "utf8");
  const announcer = source.slice(source.indexOf("function createSettingsAnnouncer"), source.indexOf("function removeRuntimeTagAssignments"));
  assert.match(announcer, /tone === "success"/);
  assert.match(announcer, /window\.setTimeout/);
  assert.doesNotMatch(announcer, /tone === "error"[^}]*setTimeout/);
});

test("rename preserves stable ID and existing category relationships", () => {
  const source = catalog([tag("stable", "Old", ["paper"], ["cat"] )], [{ id: "cat", name: "Messages" }]);
  const result = editGlobalTag(source, "stable", { name: "New" });
  assert.equal(result.tag.id, "stable");
  assert.deepEqual(result.tag.categoryIds, ["cat"]);
});

test("rename preserves deprecated applicability metadata without depending on it", () => {
  const result = editGlobalTag(catalog([tag("one", "Tag", ["card"])]), "one", { name: "Renamed" });
  assert.deepEqual(result.tag.appliesTo, ["card"]);
});

test("delete removes tag assignments and entity without touching images", () => {
  const patterns = [{ imagePath: "shared/image.jpg", imageSrc: "data:image/jpeg;base64,AA" }];
  const result = removeGlobalTag(catalog([tag("delete", "Delete"), tag("keep", "Keep")]), "delete", {
    paperRecords: [{ id: "p", tagIds: ["delete", "keep"], patterns }], cardRecords: [{ id: "c", tagIds: ["delete"] }]
  });
  assert.deepEqual(result.catalog.tags.map((entry) => entry.id), ["keep"]);
  assert.deepEqual(result.paperRecords[0].tagIds, ["keep"]);
  assert.deepEqual(result.cardRecords[0].tagIds, []);
  assert.strictEqual(result.paperRecords[0].patterns, patterns);
});

test("legacy runtime name arrays remain countable during transition", () => {
  const source = catalog([tag("shared", "Holiday", ["paper", "card"])]);
  const usage = getGlobalTagUsage(source, { paperRecords: [{ keywords: [" holiday "] }], cardRecords: [{ tags: ["HOLIDAY"] }] });
  assert.deepEqual(usage.get("shared"), { paper: 1, card: 1, stamp: 0 });
});

test("obsolete product vocabulary runtime bridges are removed", async () => {
  const source = await readFile(new URL("./storage.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /loadPaperTagVocabulary|loadCardTagVocabulary|saveLegacyTagVocabulary|ensureLegacyNamesInGlobalCatalog/);
  assert.match(source, /paperVocabularySetting[\s\S]*?cardVocabularySetting/);
  assert.match(source, /migrateGlobalTagPersistence/);
});

test("Settings refreshes usage after Paper or Card saves", async () => {
  const settings = await readFile(new URL("./settings.js", import.meta.url), "utf8");
  const library = await readFile(new URL("./library.js", import.meta.url), "utf8");
  const cards = await readFile(new URL("./cards.js", import.meta.url), "utf8");
  assert.match(settings, /catalog:paper-pack-saved/);
  assert.match(settings, /catalog:card-saved/);
  assert.match(library, /new CustomEvent\("catalog:paper-pack-saved"\)/);
  assert.match(cards, /new CustomEvent\('catalog:card-saved'\)/);
});

test("Delete refreshes assignment counts immediately before confirmation", async () => {
  const settings = await readFile(new URL("./settings.js", import.meta.url), "utf8");
  const deleteHandler = settings.slice(settings.indexOf("onDelete: async"), settings.indexOf("if (!await confirmTagDeletion", settings.indexOf("onDelete: async")));
  assert.match(deleteHandler, /await loadGlobalTagCatalog\(\)/);
  assert.match(deleteHandler, /await loadSavedCards\(\)/);
  assert.match(deleteHandler, /getGlobalTagUsage/);
});

test("persistent deletion is one transaction over taxonomy and assignment stores only", async () => {
  const source = await readFile(new URL("./storage.js", import.meta.url), "utf8");
  const start = source.indexOf("export async function deleteGlobalTagEverywhere");
  const end = source.indexOf("function assertCatalogSupportsAssignments", start);
  const body = source.slice(start, end);
  assert.match(body, /writeTransaction\(database, \[PAPER_PACKS_STORE, CARDS_STORE, SETTINGS_STORE\]/);
  assert.equal(/removeEntry|remove\(|imageLibrary|directoryHandle/.test(body), false);
});
