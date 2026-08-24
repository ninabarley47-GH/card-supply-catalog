import test from "node:test";
import assert from "node:assert/strict";

import { buildOwnerRegistry, createLegacyOwnerId, migratePaperPackOwners, serializePaperPackOwner } from "./owners.js";
import { createCatalogBackupSnapshot, validateBackup } from "./backup.js";

test("legacy Paper Pack owners migrate to one stable registry entry per name", () => {
  const packs = [{ id: "one", owner: "Nina" }, { id: "two", owner: " nina " }];
  const owners = buildOwnerRegistry([], packs);
  const migrated = migratePaperPackOwners(packs, owners);
  assert.equal(owners.length, 1);
  assert.equal(owners[0].id, createLegacyOwnerId("Nina"));
  assert.equal(migrated[0].ownerId, migrated[1].ownerId);
  assert.equal(migrated[0].owner, "Nina");
});

test("renaming an owner preserves Paper Pack owner IDs without rewriting records", () => {
  const ownerId = createLegacyOwnerId("Nina");
  const storedPack = { id: "one", ownerId };
  const renamed = migratePaperPackOwners([storedPack], [{ id: ownerId, name: "Amanda" }]);
  assert.equal(renamed[0].ownerId, ownerId);
  assert.equal(renamed[0].owner, "Amanda");
  assert.deepEqual(serializePaperPackOwner(renamed[0]), storedPack);
});

test("Paper Pack persistence strips the runtime owner display name", () => {
  assert.deepEqual(serializePaperPackOwner({ id: "one", ownerId: "owner-1", owner: "Nina" }), {
    id: "one",
    ownerId: "owner-1"
  });
});

test("shared backups include owners and store Paper Pack ownership by ownerId", () => {
  const owner = { id: "owner-1", name: "Nina" };
  const backup = createCatalogBackupSnapshot({
    owners: [owner],
    colorsById: {},
    paperPacks: [{
      id: "one", name: "Paper", ownerId: owner.id, owner: owner.name, releaseYear: 2026,
      patternCount: 1, colors: [], keywords: [], patterns: []
    }]
  });
  assert.deepEqual(backup.owners, [owner]);
  assert.equal(backup.paperPacks[0].ownerId, owner.id);
  assert.equal("owner" in backup.paperPacks[0], false);
  assert.equal("defaultOwnerId" in backup, false);
  assert.equal(validateBackup(backup).ok, true);
});
