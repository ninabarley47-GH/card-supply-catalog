export function normalizeOwnerName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function getOwnerNameKey(value) {
  return normalizeOwnerName(value).toLocaleLowerCase();
}

export function createLegacyOwnerId(name) {
  const normalizedName = normalizeOwnerName(name);
  const slug = normalizedName.toLocaleLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "owner";
  let hash = 2166136261;

  for (const character of getOwnerNameKey(normalizedName)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return `owner-${slug}-${(hash >>> 0).toString(36)}`;
}

export function isOwner(owner) {
  return Boolean(owner && typeof owner.id === "string" && owner.id && normalizeOwnerName(owner.name));
}

export function buildOwnerRegistry(existingOwners = [], paperPacks = []) {
  const ownersById = new Map(existingOwners.filter(isOwner).map((owner) => [owner.id, {
    id: owner.id,
    name: normalizeOwnerName(owner.name)
  }]));
  const ownersByName = new Map();

  for (const owner of ownersById.values()) {
    const key = getOwnerNameKey(owner.name);
    if (!ownersByName.has(key)) ownersByName.set(key, owner);
  }

  ownersById.clear();
  ownersByName.forEach((owner) => ownersById.set(owner.id, owner));

  for (const paperPack of paperPacks) {
    const legacyName = normalizeOwnerName(paperPack?.owner);

    if (!legacyName || ownersByName.has(getOwnerNameKey(legacyName))) continue;
    const owner = { id: createLegacyOwnerId(legacyName), name: legacyName };
    ownersById.set(owner.id, owner);
    ownersByName.set(getOwnerNameKey(owner.name), owner);
  }

  return [...ownersById.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function migratePaperPackOwners(paperPacks = [], owners = []) {
  const ownersById = new Map(owners.map((owner) => [owner.id, owner]));
  const ownersByName = new Map(owners.map((owner) => [getOwnerNameKey(owner.name), owner]));

  return paperPacks.map((paperPack) => {
    const owner = ownersById.get(paperPack.ownerId) || ownersByName.get(getOwnerNameKey(paperPack.owner));
    return owner ? { ...paperPack, ownerId: owner.id, owner: owner.name } : { ...paperPack };
  });
}

export function serializePaperPackOwner(paperPack) {
  const { owner, ...storedPaperPack } = paperPack;
  return storedPaperPack;
}
