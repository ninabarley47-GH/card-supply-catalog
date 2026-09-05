import {
  checkImageLibraryHealth,
  generateMissingImageThumbnails,
  migratePaperPackImagesToLocalFolder,
  repairBrokenPaperPackImageLinks
} from "./images.js";
import { checkCardImageLibraryHealth, generateMissingCardImageThumbnails } from "./card-images.js";
import { deleteGlobalTagEverywhere, loadCatalogSetting, loadGlobalTagCatalog, loadSavedCards, loadSavedStampDieSets, saveCatalogSetting, saveGlobalTagCatalog, saveOwner, savePaperPack, savePaperPacks } from "./storage.js";
import {
  addGlobalCategory, addGlobalTag, addTagToCategory, editGlobalCategory, editGlobalTag,
  getGlobalTagUsage, removeGlobalCategory, removeTagFromCategory, sortGlobalCategories, sortGlobalTags
} from "./global-tag-management.js";
import { createLegacyOwnerId, getOwnerNameKey, isActiveOwner, normalizeOwnerName } from "./owners.js";
import { supportsDirectoryPicker } from "./browser-capabilities.js";

const IMAGE_LIBRARY_SETTING_ID = "imageLibrary";
const CARD_IMAGE_LIBRARY_SETTING_ID = "cardImageLibrary";
const LAST_BACKUP_EXPORT_SETTING_ID = "lastBackupExportedAt";
const LAST_BACKUP_IMPORT_SETTING_ID = "lastBackupImportedAt";
export const DEFAULT_OWNER_SETTING_ID = "defaultOwnerId";

export async function loadDefaultOwnerId(services = {}) {
  const loadSetting = services.loadCatalogSetting || loadCatalogSetting;
  const ownerId = await loadSetting(DEFAULT_OWNER_SETTING_ID);
  return typeof ownerId === "string" ? ownerId : "";
}

export async function saveDefaultOwnerId(ownerId, services = {}) {
  const saveSetting = services.saveCatalogSetting || saveCatalogSetting;
  const normalizedOwnerId = typeof ownerId === "string" ? ownerId : "";
  await saveSetting(DEFAULT_OWNER_SETTING_ID, normalizedOwnerId || null);
  return normalizedOwnerId;
}

function sortTagsAlphabetically(tags = []) {
  return [...tags].sort((first, second) => first.localeCompare(second, undefined, {
    numeric: true,
    sensitivity: "base"
  }));
}

export function initializeSettings(options = {}) {
  initializeOwnerSettings(options);
  initializeSetupStatus(options);
  initializeImageLibrarySettings(options);
  initializeCardImageLibrarySettings(options);
  initializeBulkOwnerSettings(options);
  initializeTagSettings(options);
}

async function initializeOwnerSettings({ owners = [], paperPacks = [], onPaperPacksUpdated } = {}) {
  const select = document.querySelector("[data-default-owner]");
  const message = document.querySelector("[data-default-owner-message]");
  const list = document.querySelector("[data-owner-settings-list]");
  if (!select || !message || !list) return;

  const render = () => {
    const selectedId = select.value;
    const activeOwners = owners.filter(isActiveOwner);
    const options = activeOwners.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .map((owner) => new Option(owner.name, owner.id));
    select.replaceChildren(new Option("Not selected", ""), ...options);
    select.value = activeOwners.some((owner) => owner.id === selectedId) ? selectedId : "";
    list.replaceChildren(...activeOwners.map((owner) => createOwnerSettingsRow(owner, owners, paperPacks, message, render, onPaperPacksUpdated)));
  };

  const savedOwnerId = await loadDefaultOwnerId().catch(() => "");
  render();
  select.value = owners.some((owner) => isActiveOwner(owner) && owner.id === savedOwnerId) ? savedOwnerId : "";
  renderDefaultOwnerMessage(message, owners, select.value);
  select.addEventListener("change", async () => {
    await saveDefaultOwnerId(select.value);
    renderDefaultOwnerMessage(message, owners, select.value);
    message.dataset.tone = "success";
  });
  document.addEventListener("catalog:owners-updated", () => {
    render();
    renderDefaultOwnerMessage(message, owners, select.value);
  });
}

function createOwnerSettingsRow(owner, owners, paperPacks, message, render, onPaperPacksUpdated) {
  const row = document.createElement("div");
  const input = document.createElement("input");
  const button = document.createElement("button");
  const deleteButton = document.createElement("button");
  row.className = "owner-settings-row";
  input.value = owner.name;
  input.setAttribute("aria-label", `Owner name for ${owner.name}`);
  button.className = "button button-compact";
  button.type = "button";
  button.textContent = "Rename";
  deleteButton.className = "button button-compact";
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  button.addEventListener("click", async () => {
    const name = normalizeOwnerName(input.value);
    if (!name || owners.some((candidate) => candidate.id !== owner.id && getOwnerNameKey(candidate.name) === getOwnerNameKey(name))) {
      message.textContent = "Enter a unique owner name.";
      message.dataset.tone = "error";
      return;
    }
    await saveOwner({ id: owner.id, name });
    owner.name = name;
    paperPacks.filter((pack) => pack.ownerId === owner.id).forEach((pack) => { pack.owner = name; });
    message.textContent = `Owner renamed to ${name}. Existing ownership links were preserved.`;
    message.dataset.tone = "success";
    render();
    onPaperPacksUpdated?.();
  });
  deleteButton.addEventListener("click", async () => {
    if (!window.confirm(`Delete ${owner.name} from the owner list? Existing Paper Packs and Cards will keep their owner.`)) return;
    const wasDefault = selectDefaultOwnerId(owner.id);
    await saveOwner({ id: owner.id, name: owner.name, archived: true });
    owner.archived = true;
    if (wasDefault) await saveDefaultOwnerId("");
    render();
    document.dispatchEvent(new CustomEvent("catalog:owners-updated"));
    message.textContent = `${owner.name} was deleted from the owner list. Existing ownership was unchanged.`;
    message.dataset.tone = "success";
  });
  row.append(input, button, deleteButton);
  return row;
}

function selectDefaultOwnerId(ownerId) {
  return document.querySelector("[data-default-owner]")?.value === ownerId;
}

function renderDefaultOwnerMessage(message, owners, ownerId) {
  const owner = owners.find((candidate) => isActiveOwner(candidate) && candidate.id === ownerId);
  message.textContent = owner ? `Default owner for this device: ${owner.name}.` : "No default owner selected for this device.";
}

async function initializeTagSettings({ paperPacks = [], onPaperPacksUpdated } = {}) {
  const root = document.querySelector("[data-global-tag-settings]");
  if (!root) return;
  let cards = await loadSavedCards().catch(() => []);
  let stampSets = await loadSavedStampDieSets();
  const form = root.querySelector("[data-tag-add-form]");
  const input = root.querySelector("[data-tag-add-input]");
  const list = root.querySelector("[data-tag-list]");
  const message = root.querySelector("[data-tag-message]");
  const total = root.querySelector("[data-tag-total]");
  const categoryForm = root.querySelector("[data-category-add-form]");
  const categoryInput = root.querySelector("[data-category-add-input]");
  const categoryList = root.querySelector("[data-category-list]");
  const categoryTotal = root.querySelector("[data-category-total]");
  const categoryMessage = root.querySelector("[data-category-message]");
  const categoryAddOpen = root.querySelector("[data-category-add-open]");
  const categoryAddCancel = root.querySelector("[data-category-add-cancel]");
  const tagAddOpen = root.querySelector("[data-tag-add-open]");
  const tagAddCancel = root.querySelector("[data-tag-add-cancel]");
  let catalog = await loadGlobalTagCatalog();
  const announce = createSettingsAnnouncer(message);
  const announceCategory = createSettingsAnnouncer(categoryMessage);
  const toggleAddForm = (addForm, trigger, expanded) => {
    addForm.hidden = !expanded;
    trigger.hidden = expanded;
    trigger.setAttribute("aria-expanded", String(expanded));
  };
  const persistCatalogMutation = async (result, successMessage, notify = announce) => {
    if (!result.ok) return false;
    try {
      await saveGlobalTagCatalog(result.catalog);
      catalog = result.catalog;
      render();
      dispatchGlobalTagUpdates();
      notify(successMessage, "success");
      return true;
    } catch (error) {
      notify(error.message || "The category change could not be saved.", "error");
      return false;
    }
  };
  const render = () => {
    const usage = getGlobalTagUsage(catalog, { paperRecords: paperPacks, cardRecords: cards, stampRecords: stampSets });
    const tags = sortGlobalTags(catalog.tags);
    total.textContent = `${tags.length} tag${tags.length === 1 ? "" : "s"}`;
    const categories = sortGlobalCategories(catalog.categories);
    categoryTotal.textContent = `${categories.length} categor${categories.length === 1 ? "y" : "ies"}`;
    categoryList.replaceChildren(...categories.map((category) => createGlobalCategorySettingsRow({
      category,
      memberCount: catalog.tags.filter((tag) => tag.categoryIds.includes(category.id)).length,
      onRename: async (name) => {
        let result = editGlobalCategory(catalog, category.id, { name });
        if (!result.ok && result.reason === "fuzzy") {
          if (!window.confirm(`Possible duplicate${result.fuzzyCandidates.length === 1 ? "" : "s"}: ${result.fuzzyCandidates.join(", ")}. Rename this category anyway?`)) {
            announceCategory("The possible duplicate rename was cancelled.", "");
            return false;
          }
          result = editGlobalCategory(catalog, category.id, { name, allowFuzzy: true });
        }
        if (!result.ok) {
          announceCategory(result.reason === "duplicate" ? `That category already exists as “${result.existingCategory.name}”.` : "Enter a unique category name.", "error");
          return false;
        }
        return persistCatalogMutation(result, `Renamed category to “${result.category.name}”. Its relationships were preserved.`, announceCategory);
      },
      onDelete: async () => {
        const memberCount = catalog.tags.filter((tag) => tag.categoryIds.includes(category.id)).length;
        if (!window.confirm(`Delete “${category.name}”? Its relationship will be removed from ${memberCount} tag${memberCount === 1 ? "" : "s"}. The tags and all item assignments will remain unchanged.`)) return;
        const result = removeGlobalCategory(catalog, category.id);
        await persistCatalogMutation(result, `Deleted “${category.name}” and removed its tag relationships. Tags and item assignments were unchanged.`, announceCategory);
      }
    })));
    list.replaceChildren(...tags.map((tag) => createGlobalTagSettingsRow({
      tag, catalog, usage: usage.get(tag.id),
      onAddCategory: async (categoryId) => {
        const result = addTagToCategory(catalog, tag.id, categoryId);
        if (!result.ok) { announce("That category relationship could not be added.", "error"); return false; }
        const category = catalog.categories.find((entry) => entry.id === categoryId);
        return persistCatalogMutation(result, `Added “${tag.name}” to “${category.name}”.`);
      },
      onRemoveCategory: async (categoryId) => {
        const category = catalog.categories.find((entry) => entry.id === categoryId);
        const result = removeTagFromCategory(catalog, tag.id, categoryId);
        if (!result.ok) { announce("That category relationship could not be removed.", "error"); return false; }
        return persistCatalogMutation(result, `Removed “${tag.name}” from “${category.name}”.`);
      },
      onSave: async (name) => {
        const result = editGlobalTag(catalog, tag.id, { name });
        if (!result.ok) {
          announce(result.reason === "duplicate" ? `That name already belongs to “${result.existingTag.name}”.` : "Enter a unique tag name.", "error");
          return false;
        }
        try {
          await saveGlobalTagCatalog(result.catalog);
          renameRuntimeTagDisplay(paperPacks, tag.id, result.tag.name, "keywords");
          renameRuntimeTagDisplay(cards, tag.id, result.tag.name, "tags");
          catalog = result.catalog;
          render();
          dispatchGlobalTagUpdates();
          onPaperPacksUpdated?.();
          announce(`Updated “${result.tag.name}”. Its stable ID was preserved.`, "success");
          return true;
        } catch (error) { announce(error.message || "The tag could not be updated.", "error"); return false; }
      },
      onDelete: async () => {
        catalog = await loadGlobalTagCatalog();
        cards = await loadSavedCards().catch(() => cards);
        stampSets = await loadSavedStampDieSets();
        const currentUsage = getGlobalTagUsage(catalog, { paperRecords: paperPacks, cardRecords: cards, stampRecords: stampSets });
        const counts = currentUsage.get(tag.id) || { paper: 0, card: 0, stamp: 0 };
        const assigned = counts.paper + counts.card + counts.stamp;
        if (!await confirmTagDeletion(tag.name, assigned, "item")) return;
        try {
          const result = await deleteGlobalTagEverywhere(tag.id, { paperRecords: paperPacks });
          catalog = result.catalog;
          removeRuntimeTagAssignments(paperPacks, tag.id, "keywords");
          removeRuntimeTagAssignments(cards, tag.id, "tags");
          stampSets = await loadSavedStampDieSets();
          render();
          dispatchGlobalTagUpdates();
          onPaperPacksUpdated?.();
          announce(`Deleted “${tag.name}” and removed it from ${assigned} item${assigned === 1 ? "" : "s"}. Image files were unchanged.`, "success");
        } catch (error) { announce(`“${tag.name}” could not be deleted. No changes were saved.`, "error"); }
      }
    })));
  };
  categoryAddOpen.addEventListener("click", () => {
    announceCategory("");
    toggleAddForm(categoryForm, categoryAddOpen, true);
    categoryInput.focus();
  });
  categoryAddCancel.addEventListener("click", () => {
    categoryInput.value = "";
    announceCategory("");
    toggleAddForm(categoryForm, categoryAddOpen, false);
  });
  tagAddOpen.addEventListener("click", () => {
    announce("");
    toggleAddForm(form, tagAddOpen, true);
    input.focus();
  });
  tagAddCancel.addEventListener("click", () => {
    input.value = "";
    announce("");
    toggleAddForm(form, tagAddOpen, false);
  });
  categoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    let result = addGlobalCategory(catalog, { name: categoryInput.value });
    if (!result.ok && result.reason === "duplicate") { announceCategory(`That category already exists as “${result.existingCategory.name}”.`, "error"); return; }
    if (!result.ok && result.reason === "fuzzy") {
      if (!window.confirm(`Possible duplicate${result.fuzzyCandidates.length === 1 ? "" : "s"}: ${result.fuzzyCandidates.join(", ")}. Create a distinct category anyway?`)) { announceCategory("The possible duplicate was not created.", ""); return; }
      result = addGlobalCategory(catalog, { name: categoryInput.value, allowFuzzy: true });
    }
    if (!result.ok) { announceCategory("Enter a unique category name.", "error"); return; }
    if (await persistCatalogMutation(result, `Added category “${result.category.name}”.`, announceCategory)) {
      categoryInput.value = "";
      toggleAddForm(categoryForm, categoryAddOpen, false);
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    let result = addGlobalTag(catalog, { name: input.value });
    if (!result.ok && result.reason === "duplicate") { announce(`That tag already exists as “${result.existingTag.name}”.`, "error"); return; }
    if (!result.ok && result.reason === "fuzzy") {
      if (!window.confirm(`Possible duplicate${result.fuzzyCandidates.length === 1 ? "" : "s"}: ${result.fuzzyCandidates.join(", ")}. Create a distinct tag anyway?`)) { announce("The possible duplicate was not created.", ""); return; }
      result = addGlobalTag(catalog, { name: input.value, allowFuzzy: true });
    }
    if (!result.ok) { announce("Enter a unique tag name.", "error"); return; }
    try {
      await saveGlobalTagCatalog(result.catalog);
      catalog = result.catalog;
      input.value = "";
      toggleAddForm(form, tagAddOpen, false);
      render();
      dispatchGlobalTagUpdates();
      announce(`Added “${result.tag.name}”.`, "success");
    } catch (error) {
      announce("The tag could not be added. No changes were saved.", "error");
    }
  });
  const refreshAfterItemSave = async (event) => {
    catalog = await loadGlobalTagCatalog();
    if (event.type === "catalog:card-saved") cards = await loadSavedCards().catch(() => cards);
    if (event.type === "catalog:stamp-die-set-saved") stampSets = await loadSavedStampDieSets();
    render();
  };
  document.addEventListener("catalog:paper-pack-saved", refreshAfterItemSave);
  document.addEventListener("catalog:card-saved", refreshAfterItemSave);
  document.addEventListener("catalog:stamp-die-set-saved", refreshAfterItemSave);
  render();
}

function createSettingsAnnouncer(element) {
  let successTimer = null;
  return (text, tone = "") => {
    if (successTimer !== null) window.clearTimeout(successTimer);
    successTimer = null;
    element.textContent = text;
    element.dataset.tone = tone;
    if (text && tone === "success") {
      successTimer = window.setTimeout(() => {
        element.textContent = "";
        element.dataset.tone = "";
        successTimer = null;
      }, 4000);
    }
  };
}

function removeRuntimeTagAssignments(records, tagId, legacyField) {
  for (const record of records) {
    const removedIndex = record.tagIds?.indexOf(tagId) ?? -1;
    if (removedIndex < 0) continue;
    record.tagIds = record.tagIds.filter((id) => id !== tagId);
    if (Array.isArray(record[legacyField])) record[legacyField].splice(removedIndex, 1);
  }
}

function renameRuntimeTagDisplay(records, tagId, nextName, legacyField) {
  for (const record of records) {
    const tagIndex = record.tagIds?.indexOf(tagId) ?? -1;
    if (tagIndex >= 0 && Array.isArray(record[legacyField])) record[legacyField][tagIndex] = nextName;
  }
}

function dispatchGlobalTagUpdates() {
  document.dispatchEvent(new CustomEvent("catalog:global-tags-updated"));
}

function confirmTagDeletion(tag, assignmentCount, recordName) {
  const dialog = document.createElement("dialog");
  const title = document.createElement("h4");
  const message = document.createElement("p");
  const warning = document.createElement("p");
  const actions = document.createElement("div");
  const cancelButton = document.createElement("button");
  const deleteButton = document.createElement("button");
  const titleId = `delete-tag-title-${Date.now()}`;
  const descriptionId = `delete-tag-description-${Date.now()}`;

  dialog.className = "tag-delete-dialog";
  dialog.setAttribute("aria-labelledby", titleId);
  dialog.setAttribute("aria-describedby", descriptionId);
  title.id = titleId;
  title.textContent = `Delete “${tag}”?`;
  message.id = descriptionId;
  message.textContent = assignmentCount > 0
    ? `This tag will be removed from ${assignmentCount} ${recordName}${assignmentCount === 1 ? "" : "s"}, then removed from the tag vocabulary.`
    : "This tag will be removed from the tag vocabulary.";
  warning.className = "tag-delete-warning";
  warning.textContent = "This action cannot be undone.";
  actions.className = "tag-delete-actions";
  cancelButton.className = "button";
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  deleteButton.className = "button button-danger";
  deleteButton.type = "button";
  deleteButton.textContent = "Delete Tag";
  actions.append(cancelButton, deleteButton);
  dialog.append(title, message, warning, actions);
  document.body.append(dialog);

  if (typeof dialog.showModal !== "function") {
    dialog.remove();
    return Promise.resolve(window.confirm(`${title.textContent}\n\n${message.textContent}`));
  }

  return new Promise((resolve) => {
    let approved = false;
    const close = (shouldDelete) => {
      approved = shouldDelete;
      dialog.close();
    };

    cancelButton.addEventListener("click", () => close(false));
    deleteButton.addEventListener("click", () => close(true));
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close(false);
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(approved);
    }, { once: true });
    dialog.showModal();
    cancelButton.focus();
  });
}

function createGlobalCategorySettingsRow({ category, memberCount, onRename, onDelete }) {
  const row = document.createElement("div");
  const display = document.createElement("div");
  const label = document.createElement("strong");
  const count = document.createElement("span");
  const editor = document.createElement("div");
  const input = document.createElement("input");
  const save = document.createElement("button");
  const cancel = document.createElement("button");
  const edit = document.createElement("button");
  const remove = document.createElement("button");
  row.className = "category-settings-row";
  display.className = "category-settings-display";
  label.textContent = category.name;
  count.textContent = `${memberCount} tag${memberCount === 1 ? "" : "s"}`;
  display.append(label, count);
  editor.className = "category-settings-editor";
  editor.hidden = true;
  input.value = category.name;
  input.setAttribute("aria-label", `Category name for ${category.name}`);
  save.className = cancel.className = edit.className = "button button-compact";
  save.type = cancel.type = edit.type = remove.type = "button";
  save.textContent = "Save";
  cancel.textContent = "Cancel";
  edit.textContent = "Edit";
  edit.setAttribute("aria-label", `Edit ${category.name}`);
  edit.className = "tag-settings-action category-edit-action";
  edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.25-1 10.5-10.5-3.25-3.25L5 15.75 4 20Zm9.75-13 3.25 3.25M14.5 6.25l1.25-1.25a1.75 1.75 0 0 1 2.5 0l.75.75a1.75 1.75 0 0 1 0 2.5L17.75 9.5"/></svg>';
  remove.className = "tag-settings-action";
  remove.setAttribute("aria-label", `Delete ${category.name}`);
  remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></svg>';
  const closeEditor = () => {
    input.value = category.name;
    editor.hidden = true;
    display.hidden = false;
    edit.hidden = false;
  };
  edit.addEventListener("click", () => {
    display.hidden = true;
    edit.hidden = true;
    editor.hidden = false;
    input.focus();
    input.select();
  });
  cancel.addEventListener("click", closeEditor);
  save.addEventListener("click", async () => {
    if (await onRename(input.value)) closeEditor();
  });
  remove.addEventListener("click", onDelete);
  editor.append(input, save, cancel);
  row.append(display, editor, edit, remove);
  return row;
}

function createGlobalTagSettingsRow({ tag, catalog, usage = { paper: 0, card: 0, stamp: 0 }, onSave, onDelete, onAddCategory, onRemoveCategory }) {
  const row = document.createElement("div");
  const display = document.createElement("div");
  const label = document.createElement("strong");
  const details = document.createElement("span");
  const relationships = document.createElement("div");
  const input = document.createElement("input");
  const editor = document.createElement("div");
  const save = document.createElement("button");
  const cancel = document.createElement("button");
  const edit = document.createElement("button");
  const remove = document.createElement("button");
  row.className = "tag-settings-row global-tag-settings-row";
  display.className = "global-tag-display";
  label.textContent = tag.name;
  details.textContent = `Paper: ${usage.paper} used · Card: ${usage.card} used · Stamp: ${usage.stamp} used`;
  relationships.className = "tag-category-relationships";
  for (const category of sortGlobalCategories(catalog.categories.filter((entry) => tag.categoryIds.includes(entry.id)))) {
    const chip = document.createElement("span");
    const removeCategory = document.createElement("button");
    chip.className = "tag-category-chip";
    chip.append(document.createTextNode(category.name));
    removeCategory.type = "button";
    removeCategory.textContent = "×";
    removeCategory.setAttribute("aria-label", `Remove ${tag.name} from ${category.name}`);
    removeCategory.addEventListener("click", () => onRemoveCategory(category.id));
    chip.append(removeCategory);
    relationships.append(chip);
  }
  const availableCategories = sortGlobalCategories(catalog.categories.filter((category) => !tag.categoryIds.includes(category.id)));
  if (availableCategories.length) {
    const select = document.createElement("select");
    const reveal = document.createElement("button");
    const chooser = document.createElement("span");
    const cancelCategory = document.createElement("button");
    select.setAttribute("aria-label", `Category to add ${tag.name} to`);
    select.append(new Option("Add to category…", ""), ...availableCategories.map((category) => new Option(category.name, category.id)));
    reveal.className = "text-action tag-category-reveal";
    reveal.type = "button";
    reveal.textContent = "+ Add to category";
    reveal.setAttribute("aria-expanded", "false");
    chooser.className = "tag-category-chooser";
    chooser.hidden = true;
    cancelCategory.className = "text-action";
    cancelCategory.type = "button";
    cancelCategory.textContent = "Cancel";
    reveal.addEventListener("click", () => {
      reveal.hidden = true;
      chooser.hidden = false;
      reveal.setAttribute("aria-expanded", "true");
      select.focus();
    });
    cancelCategory.addEventListener("click", () => {
      select.value = "";
      chooser.hidden = true;
      reveal.hidden = false;
      reveal.setAttribute("aria-expanded", "false");
    });
    select.addEventListener("change", async () => {
      if (select.value) await onAddCategory(select.value);
    });
    chooser.append(select, cancelCategory);
    relationships.append(reveal, chooser);
  } else if (!catalog.categories.length) {
    const empty = document.createElement("span");
    empty.className = "tag-category-empty";
    empty.textContent = "Create a category above to organize this tag.";
    relationships.append(empty);
  }
  display.append(label, details, relationships);
  input.value = tag.name;
  input.setAttribute("aria-label", `Tag name for ${tag.name}`);
  input.className = "tag-settings-name-input";
  editor.className = "global-tag-editor";
  editor.hidden = true;
  save.className = cancel.className = edit.className = "button button-compact";
  save.type = cancel.type = edit.type = remove.type = "button";
  save.textContent = "Save";
  cancel.textContent = "Cancel";
  edit.textContent = "Edit";
  edit.className = "tag-settings-action tag-edit-action";
  edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.25-1 10.5-10.5-3.25-3.25L5 15.75 4 20Zm9.75-13 3.25 3.25M14.5 6.25l1.25-1.25a1.75 1.75 0 0 1 2.5 0l.75.75a1.75 1.75 0 0 1 0 2.5L17.75 9.5"/></svg>';
  remove.className = "tag-settings-action";
  edit.setAttribute("aria-label", `Edit ${tag.name}`);
  remove.setAttribute("aria-label", `Delete ${tag.name}`);
  remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></svg>';
  const beginEditing = () => {
    display.hidden = true;
    edit.hidden = true;
    editor.hidden = false;
    input.focus();
    input.select();
  };
  const cancelEditing = () => {
    input.value = tag.name;
    editor.hidden = true;
    display.hidden = false;
    edit.hidden = false;
  };
  edit.addEventListener("click", beginEditing);
  cancel.addEventListener("click", cancelEditing);
  save.addEventListener("click", async () => {
    if (await onSave(input.value)) cancelEditing();
  });
  remove.addEventListener("click", onDelete);
  editor.append(input, save, cancel);
  row.append(display, editor, edit, remove);
  return row;
}

async function initializeCardImageLibrarySettings({ paperPacks = [] } = {}) {
  const chooseButton = document.querySelector("[data-choose-card-image-library]");
  const reconnectButton = document.querySelector("[data-reconnect-card-image-library]");
  const generateThumbnailsButton = document.querySelector("[data-generate-missing-card-thumbnails]");
  const status = document.querySelector("[data-card-image-library-status]");
  const maintenanceStatus = document.querySelector("[data-image-maintenance-status]");

  if (!chooseButton || !status) {
    return;
  }

  if (!supportsDirectoryPicker(window)) {
    chooseButton.disabled = true;
    if (reconnectButton) {
      reconnectButton.disabled = true;
    }
    if (generateThumbnailsButton) {
      generateThumbnailsButton.disabled = true;
    }
    renderImageLibraryStatus(
      status,
      "Card image folder selection is not supported in this browser. IndexedDB will remain the fallback.",
      "error"
    );
    return;
  }

  await renderSavedCardImageLibraryStatus(status);

  chooseButton.addEventListener("click", async () => {
    await selectCardImageLibraryFolder(status, "Card image folder selected", paperPacks);
  });

  reconnectButton?.addEventListener("click", async () => {
    await selectCardImageLibraryFolder(status, "Card image folder reconnected", paperPacks);
  });

  generateThumbnailsButton?.addEventListener("click", async () => {
    generateThumbnailsButton.disabled = true;
    renderImageLibraryStatus(maintenanceStatus, "Scanning catalog Card images for missing thumbnails...", "");

    try {
      const cards = await loadSavedCards();
      const result = await generateMissingCardImageThumbnails(cards);

      if (!result.ok) {
        renderImageLibraryStatus(maintenanceStatus, "Reconnect the Card image folder before generating Card thumbnails.", "error");
        return;
      }

      renderImageLibraryStatus(
        maintenanceStatus,
        formatThumbnailGenerationSummary(result.summary, "Card"),
        result.summary.errors.length > 0 ? "error" : "success"
      );
      document.dispatchEvent(new CustomEvent("catalog:card-image-library-selected"));
    } catch (error) {
      renderImageLibraryStatus(maintenanceStatus, "Missing Card thumbnails could not be generated.", "error");
    } finally {
      generateThumbnailsButton.disabled = false;
    }
  });
}

async function selectCardImageLibraryFolder(status, successPrefix, paperPacks) {
  try {
    const directoryHandle = await window.showDirectoryPicker({
      id: "csc-card-image-library",
      mode: "readwrite"
    });

    await saveCatalogSetting(CARD_IMAGE_LIBRARY_SETTING_ID, {
      strategy: "local-folder",
      directoryHandle,
      selectedAt: new Date().toISOString()
    });

    renderImageLibraryStatus(status, `${successPrefix}: ${directoryHandle.name}.`, "success");
    document.dispatchEvent(new CustomEvent("catalog:card-image-library-selected"));
    renderSetupStatus(document.querySelector("[data-setup-status]"), paperPacks);
    return true;
  } catch (error) {
    if (error?.name === "AbortError") {
      renderImageLibraryStatus(status, "Card image folder selection was cancelled.", "");
      return false;
    }

    renderImageLibraryStatus(status, getFolderSelectionErrorMessage(error), "error");
    return false;
  }
}

async function renderSavedCardImageLibraryStatus(status) {
  const savedLibrary = await loadCatalogSetting(CARD_IMAGE_LIBRARY_SETTING_ID);
  const directoryHandle = savedLibrary?.directoryHandle;

  if (!directoryHandle) {
    renderImageLibraryStatus(
      status,
      "No Card image folder selected. New Card images will use fallback browser storage.",
      ""
    );
    return;
  }

  const permissionState = await getDirectoryPermissionState(directoryHandle);

  if (permissionState === "granted") {
    renderImageLibraryStatus(status, `Card image folder ready: ${directoryHandle.name}.`, "success");
    return;
  }

  renderImageLibraryStatus(
    status,
    `Saved Card image folder: ${directoryHandle.name}. Reconnect may be needed before images can be read.`,
    ""
  );
}

function initializeBulkOwnerSettings({ paperPacks = [], owners = [], onPaperPacksUpdated } = {}) {
  const form = document.querySelector("[data-bulk-owner-form]");
  const ownerInput = document.querySelector("[data-bulk-owner-input]");
  const submitButton = document.querySelector("[data-bulk-owner-submit]");
  const message = document.querySelector("[data-bulk-owner-message]");

  if (!form || !ownerInput || !submitButton || !message) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const newOwner = String(ownerInput.value || "").trim().replace(/\s+/g, " ");

    if (!newOwner) {
      renderBulkOwnerMessage(message, "Enter the new owner name before updating the catalog.", "error");
      ownerInput.focus();
      return;
    }

    let owner = owners.find((candidate) => getOwnerNameKey(candidate.name) === getOwnerNameKey(newOwner));
    if (!owner) {
      owner = { id: createLegacyOwnerId(newOwner), name: newOwner };
      await saveOwner(owner);
      owners.push(owner);
    }
    const affectedPacks = paperPacks.filter((paperPack) => paperPack.ownerId !== owner.id);

    if (affectedPacks.length === 0) {
      renderBulkOwnerMessage(message, `All paper packs are already owned by ${newOwner}.`, "");
      return;
    }

    if (!window.confirm(`Change the owner to "${newOwner}" for ${affectedPacks.length} paper pack${affectedPacks.length === 1 ? "" : "s"}?`)) {
      renderBulkOwnerMessage(message, "Owner update cancelled. No catalog changes were made.", "");
      return;
    }

    const updatedPaperPacks = paperPacks.map((paperPack) => ({ ...paperPack, ownerId: owner.id, owner: owner.name }));
    submitButton.disabled = true;
    renderBulkOwnerMessage(message, "Updating paper pack owners...", "");

    try {
      await savePaperPacks(updatedPaperPacks);
      paperPacks.splice(0, paperPacks.length, ...updatedPaperPacks);
      onPaperPacksUpdated?.();
      ownerInput.value = "";
      renderBulkOwnerMessage(message, `${affectedPacks.length} paper pack${affectedPacks.length === 1 ? "" : "s"} updated to owner ${newOwner}.`, "success");
    } catch (error) {
      renderBulkOwnerMessage(message, "Paper pack owners could not be updated.", "error");
    } finally {
      submitButton.disabled = false;
    }
  });
}

function renderBulkOwnerMessage(message, text, tone) {
  message.textContent = text;
  message.dataset.tone = tone;
}

function initializeSetupStatus({ paperPacks = [] } = {}) {
  const container = document.querySelector("[data-setup-status]");

  if (!container) {
    return;
  }

  renderSetupStatus(container, paperPacks);

  document.addEventListener("catalog:backup-exported", () => renderSetupStatus(container, paperPacks));
  document.addEventListener("catalog:backup-imported", () => renderSetupStatus(container, paperPacks));
}

async function initializeImageLibrarySettings({ paperPacks = [], onImageLibrarySelected, onImagesMigrated } = {}) {
  const chooseButton = document.querySelector("[data-choose-image-library]");
  const reconnectButton = document.querySelector("[data-reconnect-image-library]");
  const checkButton = document.querySelector("[data-check-image-libraries]");
  const repairButton = document.querySelector("[data-repair-image-library]");
  const generateThumbnailsButton = document.querySelector("[data-generate-missing-thumbnails]");
  const migrateButton = document.querySelector("[data-migrate-image-library]");
  const status = document.querySelector("[data-image-library-status]");
  const maintenanceStatus = document.querySelector("[data-image-maintenance-status]");
  const health = document.querySelector("[data-image-library-health]");

  if (!chooseButton || !status) {
    return;
  }

  if (!supportsDirectoryPicker(window)) {
    chooseButton.disabled = true;
    if (reconnectButton) {
      reconnectButton.disabled = true;
    }
    if (checkButton) {
      checkButton.disabled = true;
    }
    if (repairButton) {
      repairButton.disabled = true;
    }
    if (migrateButton) {
      migrateButton.disabled = true;
    }
    if (generateThumbnailsButton) {
      generateThumbnailsButton.disabled = true;
    }
    renderImageLibraryStatus(
      status,
      "Image folder selection is not supported in this browser. IndexedDB will remain the fallback for now.",
      "error"
    );
    renderImageLibraryStatus(
      maintenanceStatus,
      "Image maintenance is not supported in this browser because a local image folder cannot be connected.",
      "error"
    );
    return;
  }

  await renderSavedImageLibraryStatus(status);

  chooseButton.addEventListener("click", async () => {
    await selectImageLibraryFolder({
      paperPacks,
      status,
      health,
      onImageLibrarySelected,
      successPrefix: "Image folder selected"
    });
  });

  reconnectButton?.addEventListener("click", async () => {
    const selected = await selectImageLibraryFolder({
      paperPacks,
      status,
      health,
      onImageLibrarySelected,
      successPrefix: "Image folder reconnected"
    });

    if (selected) {
      await checkImageLibraryReferences({
        button: reconnectButton,
        health,
        paperPacks,
        status,
        checkingMessage: "Checking image library after reconnect..."
      });
      renderSetupStatus(document.querySelector("[data-setup-status]"), paperPacks);
    }
  });

  checkButton?.addEventListener("click", async () => {
    await checkBothImageLibraries({
      button: checkButton,
      paperPacks,
      paperStatus: status,
      paperHealth: health,
      cardStatus: document.querySelector("[data-card-image-library-status]"),
      cardHealth: document.querySelector("[data-card-image-library-health]")
    });
    renderSetupStatus(document.querySelector("[data-setup-status]"), paperPacks);
  });

  repairButton?.addEventListener("click", async () => {
    repairButton.disabled = true;
    renderImageLibraryStatus(maintenanceStatus, "Repairing image links and reconnecting fallback images...", "");

    try {
      const result = await repairBrokenPaperPackImageLinks(paperPacks);

      if (!result.ok) {
        renderImageLibraryStatus(maintenanceStatus, "Reconnect the image folder before repairing image links.", "error");
        return;
      }

      for (const repairedPaperPack of result.summary.repairedPaperPacks) {
        await savePaperPack(repairedPaperPack);
        replacePaperPack(paperPacks, repairedPaperPack);
      }

      await onImagesMigrated?.();
      const healthResult = await checkImageLibraryHealth(paperPacks);
      renderImageLibraryHealth(health, healthResult.summary);
      renderImageLibraryStatus(
        maintenanceStatus,
        formatImageLinkRepairSummary(result.summary),
        result.summary.packsUnresolved.length > 0 ? "error" : "success"
      );
      renderSetupStatus(document.querySelector("[data-setup-status]"), paperPacks);
    } catch (error) {
      renderImageLibraryStatus(maintenanceStatus, "Image links and fallback images could not be repaired.", "error");
    } finally {
      repairButton.disabled = false;
    }
  });

  generateThumbnailsButton?.addEventListener("click", async () => {
    generateThumbnailsButton.disabled = true;
    renderImageLibraryStatus(maintenanceStatus, "Scanning the selected folder for missing thumbnails...", "");

    try {
      const result = await generateMissingImageThumbnails(paperPacks);

      if (!result.ok) {
        renderImageLibraryStatus(maintenanceStatus, "Reconnect the image folder before generating thumbnails.", "error");
        return;
      }

      renderImageLibraryStatus(
        maintenanceStatus,
        formatThumbnailGenerationSummary(result.summary, "Paper"),
        result.summary.errors.length > 0 ? "error" : "success"
      );
      await onImagesMigrated?.();
    } catch (error) {
      renderImageLibraryStatus(maintenanceStatus, "Missing thumbnails could not be generated.", "error");
    } finally {
      generateThumbnailsButton.disabled = false;
    }
  });

  migrateButton?.addEventListener("click", async () => {
    migrateButton.disabled = true;
    renderImageLibraryStatus(maintenanceStatus, "Migrating embedded images into the selected folder...", "");

    try {
      const summary = await migrateEmbeddedImages(paperPacks);

      onImagesMigrated?.();
      renderImageLibraryStatus(maintenanceStatus, formatMigrationSummary(summary), summary.errors.length > 0 ? "error" : "success");
      renderSetupStatus(document.querySelector("[data-setup-status]"), paperPacks);
    } catch (error) {
      renderImageLibraryStatus(maintenanceStatus, "Existing images could not be migrated.", "error");
    } finally {
      migrateButton.disabled = false;
    }
  });
}

function formatThumbnailGenerationSummary(summary, imageKind) {
  const { imagesScanned, thumbnailsCreated, thumbnailsRepaired, thumbnailsSkipped, errors } = summary;
  const errorMessage = errors.length > 0
    ? ` ${errors.length} image${errors.length === 1 ? "" : "s"} could not be processed.`
    : "";

  return `${imagesScanned} ${imageKind} image${imagesScanned === 1 ? "" : "s"} scanned. ${thumbnailsCreated} missing thumbnail${thumbnailsCreated === 1 ? "" : "s"} created; ${thumbnailsRepaired} empty thumbnail${thumbnailsRepaired === 1 ? "" : "s"} repaired; ${thumbnailsSkipped} existing thumbnail${thumbnailsSkipped === 1 ? "" : "s"} left unchanged.${errorMessage}`;
}

function formatImageLinkRepairSummary(summary) {
  if (summary.linksRepaired === 0 && summary.packsUnresolved.length === 0) {
    return "No broken links or reconnectable fallback images were found.";
  }

  const repairedMessage = `${summary.linksRepaired} image link${summary.linksRepaired === 1 ? "" : "s"} repaired across ${summary.packsRepaired} paper pack${summary.packsRepaired === 1 ? "" : "s"}.`;

  if (summary.packsUnresolved.length === 0) {
    return repairedMessage;
  }

  return `${repairedMessage} No unique matching image folder could be identified for: ${formatLimitedList(summary.packsUnresolved, 5)}.`;
}

async function selectImageLibraryFolder({ paperPacks = [], status, health, onImageLibrarySelected, successPrefix }) {
  try {
    const directoryHandle = await window.showDirectoryPicker({
      id: "csc-image-library",
      mode: "readwrite"
    });

    await saveCatalogSetting(IMAGE_LIBRARY_SETTING_ID, {
      strategy: "local-folder",
      directoryHandle,
      selectedAt: new Date().toISOString()
    });

    await onImageLibrarySelected?.();
    renderImageLibraryStatus(status, getSelectedImageLibraryMessage(directoryHandle, successPrefix), "success");
    renderImageLibraryHealth(health, null);
    renderSetupStatus(document.querySelector("[data-setup-status]"), paperPacks);

    return true;
  } catch (error) {
    if (error?.name === "AbortError") {
      renderImageLibraryStatus(status, "Image folder selection was cancelled.", "");
      return false;
    }

    renderImageLibraryStatus(status, getFolderSelectionErrorMessage(error), "error");
    return false;
  }
}

async function renderSetupStatus(container, paperPacks = []) {
  if (!container) {
    return;
  }

  const [imageLibrary, cardImageLibrary, cards, lastBackupExportedAt, lastBackupImportedAt] = await Promise.all([
    loadCatalogSetting(IMAGE_LIBRARY_SETTING_ID),
    loadCatalogSetting(CARD_IMAGE_LIBRARY_SETTING_ID),
    loadSavedCards(),
    loadCatalogSetting(LAST_BACKUP_EXPORT_SETTING_ID),
    loadCatalogSetting(LAST_BACKUP_IMPORT_SETTING_ID)
  ]);
  const directoryHandle = imageLibrary?.directoryHandle;
  const cardDirectoryHandle = cardImageLibrary?.directoryHandle;
  const folderPermission = directoryHandle ? await getDirectoryPermissionState(directoryHandle) : "";
  const cardFolderPermission = cardDirectoryHandle ? await getDirectoryPermissionState(cardDirectoryHandle) : "";
  const imageHealth =
    directoryHandle && folderPermission === "granted" ? await checkImageLibraryHealth(paperPacks).catch(() => null) : null;
  const folderImages = imageHealth?.summary.folderImages ?? countFolderImageReferences(paperPacks);
  const missingImages = imageHealth?.summary.imagesMissing ?? 0;
  const missingImageFolders = getMissingImageFolders(imageHealth?.summary.missingImages);
  const imageReferencesChecked = Boolean(imageHealth);
  const cardFolderImages = countCardFolderImageReferences(cards);

  container.replaceChildren(
    createSetupStatusItem({
      title: "Catalog data",
      detail: paperPacks.length > 0 ? `${paperPacks.length} paper pack${paperPacks.length === 1 ? "" : "s"} loaded.` : "No paper packs are loaded yet.",
      badge: paperPacks.length > 0 ? "Ready" : "Needs data",
      status: paperPacks.length > 0 ? "ready" : "attention"
    }),
    createSetupStatusItem({
      title: "Catalog backup",
      detail: getBackupStatusDetail(lastBackupExportedAt, lastBackupImportedAt),
      badge: lastBackupExportedAt ? "Exported" : "Reminder",
      status: lastBackupExportedAt ? "ready" : "neutral"
    }),
    createSetupStatusItem({
      title: "Paper Pack image folder",
      detail: getImageFolderStatusDetail(directoryHandle, folderPermission, "Paper Pack image"),
      badge: getImageFolderStatusBadge(directoryHandle, folderPermission),
      status: getImageFolderStatusTone(directoryHandle, folderPermission)
    }),
    createSetupStatusItem({
      title: "Card image folder",
      detail: getImageFolderStatusDetail(cardDirectoryHandle, cardFolderPermission, "Card image"),
      badge: getImageFolderStatusBadge(cardDirectoryHandle, cardFolderPermission),
      status: getImageFolderStatusTone(cardDirectoryHandle, cardFolderPermission)
    }),
    createSetupStatusItem({
      title: "Paper Pack image references",
      detail: getImageReferenceStatusDetail(
        folderImages,
        missingImages,
        imageReferencesChecked,
        Boolean(directoryHandle),
        missingImageFolders
      ),
      badge: getImageReferenceStatusBadge(folderImages, missingImages, imageReferencesChecked),
      status: getImageReferenceStatusTone(missingImages, imageReferencesChecked)
    }),
    createSetupStatusItem({
      title: "Card image references",
      detail: getCardImageReferenceStatusDetail(cardFolderImages, cardDirectoryHandle, cardFolderPermission),
      badge: getCardImageReferenceStatusBadge(cardFolderImages, cardDirectoryHandle, cardFolderPermission),
      status: getImageFolderStatusTone(cardDirectoryHandle, cardFolderPermission)
    })
  );
}

function createSetupStatusItem({ title, detail, badge, status }) {
  const item = document.createElement("div");
  const text = document.createElement("div");
  const titleElement = document.createElement("strong");
  const detailElement = document.createElement("span");
  const badgeElement = document.createElement("span");

  item.className = "setup-status-item";
  item.dataset.status = status;
  titleElement.textContent = title;
  detailElement.textContent = detail;
  badgeElement.className = "setup-status-badge";
  badgeElement.textContent = badge;
  text.append(titleElement, detailElement);
  item.append(text, badgeElement);

  return item;
}

function getBackupStatusDetail(lastBackupExportedAt, lastBackupImportedAt) {
  if (lastBackupExportedAt) {
    return `Last export: ${formatDateTime(lastBackupExportedAt)}.`;
  }

  if (lastBackupImportedAt) {
    return `Last import: ${formatDateTime(lastBackupImportedAt)}. Export a fresh backup after making changes.`;
  }

  return "Export a backup after setup or after cataloging several packs.";
}

function getImageFolderStatusDetail(directoryHandle, permissionState, imageType = "image") {
  if (!supportsDirectoryPicker(window)) {
    return `This browser does not support choosing a ${imageType} library folder.`;
  }

  if (!directoryHandle) {
    return `No ${imageType} folder selected. Images will use fallback browser storage.`;
  }

  if (permissionState === "granted") {
    return `Selected folder: ${directoryHandle.name}.`;
  }

  return `Saved folder: ${directoryHandle.name}. Reconnect may be needed before images can be read.`;
}

function getImageFolderStatusBadge(directoryHandle, permissionState) {
  if (!supportsDirectoryPicker(window)) {
    return "Unsupported";
  }

  if (!directoryHandle) {
    return "Optional";
  }

  return permissionState === "granted" ? "Ready" : "Reconnect";
}

function getImageFolderStatusTone(directoryHandle, permissionState) {
  if (!supportsDirectoryPicker(window)) {
    return "attention";
  }

  if (!directoryHandle) {
    return "neutral";
  }

  return permissionState === "granted" ? "ready" : "attention";
}

function getImageReferenceStatusDetail(folderImages, missingImages, wasChecked, hasDirectoryHandle, missingImageFolders = []) {
  if (folderImages === 0) {
    return "No folder-backed image references found yet.";
  }

  if (!wasChecked) {
    return hasDirectoryHandle
      ? `Reconnect or check the image folder to verify ${folderImages} folder image reference${folderImages === 1 ? "" : "s"}.`
      : `${folderImages} folder image reference${folderImages === 1 ? "" : "s"} need an image folder connection.`;
  }

  if (missingImages > 0) {
    const folderSummary =
      missingImageFolders.length > 0
        ? ` Folders: ${formatLimitedList(missingImageFolders, 4)}.`
        : "";

    return `${missingImages} of ${folderImages} folder image reference${folderImages === 1 ? "" : "s"} need attention.${folderSummary}`;
  }

  return `${folderImages} folder image reference${folderImages === 1 ? "" : "s"} found.`;
}

function getImageReferenceStatusBadge(folderImages, missingImages, wasChecked) {
  if (folderImages === 0) {
    return "OK";
  }

  if (!wasChecked) {
    return "Verify";
  }

  return missingImages > 0 ? "Check needed" : "OK";
}

function getImageReferenceStatusTone(missingImages, wasChecked) {
  if (!wasChecked) {
    return "neutral";
  }

  return missingImages > 0 ? "attention" : "ready";
}

function countFolderImageReferences(paperPacks) {
  return paperPacks.reduce(
    (total, paperPack) =>
      total +
      (paperPack.patterns || []).filter((pattern) => pattern && typeof pattern === "object" && pattern.imagePath).length,
    0
  );
}

function countCardFolderImageReferences(cards) {
  return cards.filter((card) => card && typeof card === "object" && card.imagePath).length;
}

function getCardImageReferenceStatusDetail(folderImages, directoryHandle, permissionState) {
  if (folderImages === 0) {
    return "No folder-backed Card image references found yet.";
  }

  if (!directoryHandle) {
    return `${folderImages} Card image reference${folderImages === 1 ? "" : "s"} need a Card image folder connection.`;
  }

  if (permissionState !== "granted") {
    return `Reconnect the Card image folder to access ${folderImages} Card image reference${folderImages === 1 ? "" : "s"}.`;
  }

  return `${folderImages} folder-backed Card image reference${folderImages === 1 ? "" : "s"} connected.`;
}

function getCardImageReferenceStatusBadge(folderImages, directoryHandle, permissionState) {
  if (folderImages === 0) {
    return "OK";
  }

  return directoryHandle && permissionState === "granted" ? "Connected" : "Reconnect";
}

function formatDateTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

async function checkImageLibraryReferences({ button, health, paperPacks, status, checkingMessage }) {
  if (button) {
    button.disabled = true;
  }

  renderImageLibraryStatus(status, checkingMessage, "");

  try {
    const result = await checkImageLibraryHealth(paperPacks);

    renderImageLibraryStatus(
      status,
      formatHealthStatus(result),
      result.summary.imagesMissing > 0 || result.needsFolder ? "error" : "success"
    );
    renderImageLibraryHealth(health, result.summary);
  } catch (error) {
    renderImageLibraryStatus(status, "Image library references could not be checked.", "error");
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function checkBothImageLibraries({
  button,
  paperPacks,
  paperStatus,
  paperHealth,
  cardStatus,
  cardHealth
}) {
  button.disabled = true;
  renderImageLibraryStatus(paperStatus, "Checking Paper image library references...", "");
  renderImageLibraryStatus(cardStatus, "Checking Card image library references...", "");

  try {
    const cards = await loadSavedCards();
    const [paperResult, cardResult] = await Promise.all([
      checkImageLibraryHealth(paperPacks),
      checkCardImageLibraryHealth(cards)
    ]);

    renderImageLibraryStatus(
      paperStatus,
      formatHealthStatus(paperResult),
      paperResult.summary.imagesMissing > 0 || paperResult.needsFolder ? "error" : "success"
    );
    renderImageLibraryHealth(paperHealth, paperResult.summary, "paper");
    renderImageLibraryStatus(
      cardStatus,
      formatHealthStatus(cardResult),
      cardResult.summary.imagesMissing > 0 || cardResult.needsFolder ? "error" : "success"
    );
    renderImageLibraryHealth(cardHealth, cardResult.summary, "card");
  } catch (error) {
    renderImageLibraryStatus(paperStatus, "Paper image library references could not be checked.", "error");
    renderImageLibraryStatus(cardStatus, "Card image library references could not be checked.", "error");
  } finally {
    button.disabled = false;
  }
}

function formatHealthStatus(result) {
  const { summary } = result;

  if (result.needsFolder) {
    return "Image folder permission is needed before folder-backed images can be checked.";
  }

  if (summary.folderImages === 0) {
    return "No folder-backed images found yet. Current images are still using fallback storage or placeholders.";
  }

  if (summary.imagesMissing > 0) {
    return `${summary.imagesFound} of ${summary.folderImages} folder image${summary.folderImages === 1 ? "" : "s"} found.`;
  }

  return `${summary.imagesFound} folder image${summary.imagesFound === 1 ? "" : "s"} found. No missing folder images.`;
}

function renderImageLibraryHealth(container, summary, imageKind = "paper") {
  if (!container) {
    return;
  }

  if (!summary) {
    container.replaceChildren();
    return;
  }

  const overview = document.createElement("ul");
  overview.className = "image-library-health-list";

  overview.append(
    createHealthItem(imageKind === "card" ? "Cards checked" : "Packs checked", imageKind === "card" ? summary.cardsChecked : summary.packsChecked),
    createHealthItem("Folder images", summary.folderImages),
    createHealthItem("Images found", summary.imagesFound),
    createHealthItem("Missing images", summary.imagesMissing),
    createHealthItem("Fallback images", summary.embeddedImages)
  );

  const children = [overview];

  if (imageKind === "paper" && (summary.fallbackPaperPacks || []).length > 0) {
    const fallback = document.createElement("div");
    fallback.className = "image-library-fallback";

    const title = document.createElement("p");
    title.textContent = "Paper packs using fallback storage";

    const list = document.createElement("ul");
    list.className = "image-library-missing-list";

    for (const paperPack of summary.fallbackPaperPacks) {
      const item = document.createElement("li");
      item.textContent = `${paperPack.packName} (${paperPack.imageCount} image${paperPack.imageCount === 1 ? "" : "s"})`;
      list.append(item);
    }

    fallback.append(title, list);
    children.push(fallback);
  }

  if (summary.missingImages.length > 0) {
    const missing = document.createElement("div");
    missing.className = "image-library-missing";

    const title = document.createElement("p");
    title.textContent = "Missing references";

    const list = document.createElement("ul");
    list.className = "image-library-missing-list";

    if (imageKind === "card") {
      for (const missingCard of summary.missingImages) {
        const item = document.createElement("li");
        item.textContent = `${missingCard.cardLabel}: ${missingCard.imagePath}`;
        list.append(item);
      }
    } else {
      for (const paperPack of groupMissingImagesByPaperPack(summary.missingImages)) {
        const item = document.createElement("li");
        item.textContent = `${paperPack.packName} (${paperPack.imageCount} missing image${paperPack.imageCount === 1 ? "" : "s"})`;
        list.append(item);
      }
    }

    missing.append(title, list);
    children.push(missing);
  }

  container.replaceChildren(...children);
}

function groupMissingImagesByPaperPack(missingImages = []) {
  const paperPacksById = new Map();

  for (const missingImage of missingImages) {
    const packName = missingImage.packName || "Untitled pack";
    const packId = missingImage.packId || packName;
    const existingPaperPack = paperPacksById.get(packId);

    if (existingPaperPack) {
      existingPaperPack.imageCount += 1;
    } else {
      paperPacksById.set(packId, { packName, imageCount: 1 });
    }
  }

  return [...paperPacksById.values()].sort((firstPack, secondPack) =>
    firstPack.packName.localeCompare(secondPack.packName, undefined, {
      numeric: true,
      sensitivity: "base"
    })
  );
}

function createHealthItem(label, value) {
  const item = document.createElement("li");
  const labelElement = document.createElement("span");
  const valueElement = document.createElement("strong");

  labelElement.textContent = label;
  valueElement.textContent = value;
  item.append(labelElement, valueElement);

  return item;
}

function getMissingImageFolders(missingImages = []) {
  return [
    ...new Set(
      missingImages
        .map((missingImage) => getFolderNameFromImagePath(missingImage.imagePath))
        .filter(Boolean)
    )
  ].sort((firstFolder, secondFolder) =>
    firstFolder.localeCompare(secondFolder, undefined, {
      numeric: true,
      sensitivity: "base"
    })
  );
}

function getFolderNameFromImagePath(imagePath) {
  return String(imagePath || "").split("/").filter(Boolean)[0] || "";
}

function formatLimitedList(values, limit) {
  const visibleValues = values.slice(0, limit);
  const hiddenCount = values.length - visibleValues.length;

  if (values.length === 0) {
    return "unknown";
  }

  if (hiddenCount === 0) {
    return visibleValues.join(", ");
  }

  return `${visibleValues.join(", ")}, and ${hiddenCount} more`;
}

async function migrateEmbeddedImages(paperPacks) {
  const summary = {
    packsMigrated: 0,
    imagesMigrated: 0,
    warnings: [],
    errors: []
  };

  for (const paperPack of paperPacks) {
    if (!hasEmbeddedImages(paperPack)) {
      continue;
    }

    const result = await migratePaperPackImagesToLocalFolder(paperPack);

    if (!result.ok) {
      summary.warnings.push(result.warning);
      break;
    }

    await savePaperPack(result.paperPack);
    replacePaperPack(paperPacks, result.paperPack);
    summary.packsMigrated += 1;
    summary.imagesMigrated += result.imagesMigrated;
  }

  return summary;
}

function hasEmbeddedImages(paperPack) {
  return (paperPack.patterns || []).some((pattern) => pattern && typeof pattern === "object" && pattern.imageSrc);
}

function replacePaperPack(paperPacks, paperPack) {
  const existingIndex = paperPacks.findIndex((existingPack) => existingPack.id === paperPack.id);

  if (existingIndex !== -1) {
    paperPacks.splice(existingIndex, 1, paperPack);
  }
}

function formatMigrationSummary(summary) {
  const parts = [
    `${summary.imagesMigrated} image${summary.imagesMigrated === 1 ? "" : "s"} migrated`,
    `${summary.packsMigrated} pack${summary.packsMigrated === 1 ? "" : "s"} updated`
  ];

  if (summary.warnings.length > 0) {
    parts.push(`Warning: ${summary.warnings[0]}`);
  }

  if (summary.errors.length > 0) {
    parts.push(`Error: ${summary.errors[0]}`);
  }

  return parts.join(". ");
}

async function renderSavedImageLibraryStatus(status) {
  const savedImageLibrary = await loadCatalogSetting(IMAGE_LIBRARY_SETTING_ID);
  const directoryHandle = savedImageLibrary?.directoryHandle;

  if (!directoryHandle) {
    renderImageLibraryStatus(status, "No image folder selected yet. Current images still use the prototype storage.", "");
    return;
  }

  const permissionState = await getDirectoryPermissionState(directoryHandle);

  if (permissionState === "granted") {
    renderImageLibraryStatus(
      status,
      getSelectedImageLibraryMessage(directoryHandle),
      "success"
    );
    return;
  }

  renderImageLibraryStatus(
    status,
    `Image folder saved: ${directoryHandle.name}. Permission may need to be granted again before use.`,
    ""
  );
}

function getFolderSelectionErrorMessage(error) {
  if (error?.name === "SecurityError") {
    return "The browser blocked folder selection. Try again from the Settings button.";
  }

  if (error?.name === "NotAllowedError") {
    return "Folder permission was not granted. Choose the folder again and allow access.";
  }

  return `The image folder could not be selected${error?.name ? ` (${error.name})` : ""}.`;
}

function getSelectedImageLibraryMessage(directoryHandle, prefix = "Image folder selected") {
  return `${prefix}: ${directoryHandle.name}. Full local paths are hidden by the browser, but DSP images can be read from this folder.`;
}

async function getDirectoryPermissionState(directoryHandle) {
  if (!directoryHandle?.queryPermission) {
    return "unknown";
  }

  try {
    return await directoryHandle.queryPermission({ mode: "readwrite" });
  } catch (error) {
    return "unknown";
  }
}

function renderImageLibraryStatus(status, text, tone) {
  status.textContent = text;
  status.dataset.tone = tone;
}
