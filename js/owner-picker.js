import { createLegacyOwnerId, getOwnerNameKey, normalizeOwnerName } from './owners.js';

const OWNER_DATALIST_ID = 'catalog-owner-options';

export function initializeOwnerInput(input, owners = []) {
  if (!input) return;
  input.setAttribute('list', OWNER_DATALIST_ID);
  input.setAttribute('autocomplete', 'off');
  input.placeholder = 'Select owner…';
  input.required = true;
  refreshOwnerOptions(owners);
}

export function refreshOwnerOptions(owners = []) {
  let datalist = document.getElementById(OWNER_DATALIST_ID);
  if (!datalist) {
    datalist = document.createElement('datalist');
    datalist.id = OWNER_DATALIST_ID;
    document.body.append(datalist);
  }
  datalist.replaceChildren(...owners
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .map((owner) => new Option(owner.name)));
}

export function getOwnerNameForId(ownerId, owners = []) {
  return owners.find((owner) => owner.id === ownerId)?.name || '';
}

export function resolveOwnerInput(value, owners = []) {
  const name = normalizeOwnerName(value);
  if (!name) return null;
  return owners.find((owner) => getOwnerNameKey(owner.name) === getOwnerNameKey(name)) || {
    id: createLegacyOwnerId(name),
    name
  };
}
