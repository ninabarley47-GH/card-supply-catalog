import { createLegacyOwnerId, getOwnerNameKey, normalizeOwnerName } from './owners.js';
import { isActiveOwner } from './owners.js';

export const NEW_OWNER_VALUE = '__new_owner__';

export function initializeOwnerPicker(select, newOwnerInput, owners = []) {
  if (!select || !newOwnerInput) return;
  select.dataset.ownerPicker = '';
  newOwnerInput.dataset.newOwnerInput = '';
  if (!select.dataset.ownerPickerReady) {
    select.addEventListener('change', () => updateNewOwnerInput(select, newOwnerInput));
    document.addEventListener('catalog:owners-updated', () => refreshOwnerPicker(select, owners));
    select.dataset.ownerPickerReady = 'true';
  }
  refreshOwnerPicker(select, owners);
  updateNewOwnerInput(select, newOwnerInput);
}

export function refreshOwnerOptions(owners = []) {
  document.querySelectorAll('[data-owner-picker]').forEach((select) => {
    refreshOwnerPicker(select, owners);
    const input = select.parentElement?.querySelector('[data-new-owner-input]');
    if (input) updateNewOwnerInput(select, input);
  });
}

export function setOwnerPickerValue(select, newOwnerInput, ownerId, ownerName, owners = []) {
  const existingOwner = owners.find((owner) => isActiveOwner(owner) && owner.id === ownerId) ||
    owners.find((owner) => isActiveOwner(owner) && getOwnerNameKey(owner.name) === getOwnerNameKey(ownerName));
  if (existingOwner) {
    select.value = existingOwner.id;
    newOwnerInput.value = '';
  } else if (normalizeOwnerName(ownerName)) {
    select.value = NEW_OWNER_VALUE;
    newOwnerInput.value = normalizeOwnerName(ownerName);
  } else {
    select.value = '';
    newOwnerInput.value = '';
  }
  updateNewOwnerInput(select, newOwnerInput);
}

export function resolveOwnerPicker(select, newOwnerInput, owners = []) {
  if (select.value === NEW_OWNER_VALUE) {
    const name = normalizeOwnerName(newOwnerInput.value);
    if (!name) return null;
    return owners.find((owner) => isActiveOwner(owner) && getOwnerNameKey(owner.name) === getOwnerNameKey(name)) || { id: createLegacyOwnerId(name), name };
  }
  return owners.find((owner) => isActiveOwner(owner) && owner.id === select.value) || null;
}

export function notifyOwnerRegistryUpdated() {
  document.dispatchEvent(new CustomEvent('catalog:owners-updated'));
}

function refreshOwnerPicker(select, owners) {
  const selectedValue = select.value;
  const options = owners.filter(isActiveOwner)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .map((owner) => new Option(owner.name, owner.id));
  select.replaceChildren(new Option('Select owner…', ''), ...options, new Option('Add new owner…', NEW_OWNER_VALUE));
  select.value = [...select.options].some((option) => option.value === selectedValue) ? selectedValue : '';
}

function updateNewOwnerInput(select, input) {
  const addingOwner = select.value === NEW_OWNER_VALUE;
  input.hidden = !addingOwner;
  input.disabled = !addingOwner;
  input.required = addingOwner;
  if (!addingOwner) input.value = '';
}
