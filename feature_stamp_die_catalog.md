# Stamp & Die Catalog

## Phase 1: Library shell and data model

Status: Phase 1 implemented. There is no user-facing record creation yet.

A Stamp & Die Set is one catalog record containing stamps only, dies only, or
coordinating stamps and dies. There are no individual stamp or die records,
separate stampIds/dieIds, or required per-image Stamp/Die classifications.

## Record

```js
{
  schemaVersion: 3,
  id: 'stable-set-id',
  name: 'Set name',
  imageRefs: [],
  tagIds: [],
  favorite: false,
  dateCreated: '2026-09-05'
}
```

The name is required and trimmed. Identity is a stable, nonempty string and is
not regenerated from the name. `dateCreated` follows Cards' existing naming and
YYYY-MM-DD convention. `favorite` follows the existing Paper/Card boolean field.
The scaffold validates supplied values; record creation and its defaults are deferred.
`schemaVersion` uses the existing catalog-record version helper. No existing record
format changes, catalog-version increment, or record migrations are introduced.

`imageRefs` is an ordered array, empty or containing multiple reference objects.
Each reference has a relative `imagePath` and optional `imageName` and
`imageLibrary`, using existing Paper/Card reference field names. All references
belong to the same set. Only reference metadata is serialized; temporary blob URLs,
file handles, and image contents are not stored. No Stamp & Die folder marker or
folder selection is implemented. Future image storage can extend each reference
with the established thumbnail/fallback fields when that behavior is implemented.
Future Library and Detail views should show all images, side-by-side when practical.

## Global tags

Sets assign canonical stable `tagIds` from the existing global catalog, never names
or category IDs. All global tags are available; deprecated `appliesTo` metadata
cannot restrict assignments. Categories organize tags and are not record fields.
Stamp and Die are ordinary global tags, not separate entity types or special flags.
Phase 1 does not automatically create either tag.

Future filename inference may add Die when a filename contains `die`, ignoring case,
or add Stamp for a stamp image whose filename does not contain `die`. Inference
is additive only and never automatically removes either tag. Users may manually
add or remove either tag. No inference is implemented in Phase 1.

## Storage and shell

IndexedDB remains authoritative. Database version 6 adds only the `stampDieSets`
object store with keyPath `id`, preserving existing stores and records. The existing
storage module exposes `loadSavedStampDieSets` and `saveStampDieSet`; normalization
lives in `js/stamp-die-sets.js`. Existing global-tag usage counts, assignment
validation, and atomic tag deletion include saved sets so tag references stay valid.

The Stamps & Dies navigation link opens `#stamps-dies` through the existing shared
hash-navigation handler. The empty shell reuses Library structure and CSS, hides
other libraries' sidebar controls, and has no Add action or persisted/sample data.
It does not yet render records saved through the storage scaffold.

Decision 32 applies to future Stamp & Die images: editing or deleting a catalog
record must never delete, move, rename, overwrite, or otherwise modify existing
files in the user-selected shared library. Phase 1 has no image filesystem access.

## Boundaries

No Add/Edit, image import or persistence, folder selection/scanning, thumbnails,
filename inference, search, filtering, categories UI, detail panel, Card relationships,
or backup/restore support is included. Standard and iPad backups do not include
Stamp & Die Set records in this phase. Cards' existing free-text `stampSets` values
remain unchanged; they are not stable references to these records.

## Verification

Focused tests exercise shared navigation to and from the new screen, multi-image
reference metadata, required fields, stable tag identities across renames, an additive
database upgrade preserving existing stores, save/load round trips, and global-tag
assignment/deletion integrity. Storage upgrade tests use an in-memory IndexedDB API
harness; no real user database or image files are changed by the tests.
