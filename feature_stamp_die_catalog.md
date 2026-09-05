# Stamp & Die Catalog

## Phases 1 and 2A: Library, data model, and Add Set

Status: Phase 1 and Phase 2A implemented. Add Set creates metadata-only records.

A Stamp & Die Set is one catalog record containing stamps only, dies only, or
coordinating stamps and dies. There are no individual stamp or die records,
separate stampIds/dieIds, or required per-image Stamp/Die classifications.

## Record

```js
{
  schemaVersion: 4,
  id: 'stable-set-id',
  name: 'Set name',
  imageRefs: [],
  tagIds: [],
  favorite: false,
  dateCreated: '2026-09-05',
  releaseYear: 2024
}
```

The name is required and trimmed. Identity is a stable, nonempty string and is
not regenerated from the name. `dateCreated` follows Cards' existing naming and
YYYY-MM-DD convention. `favorite` follows the existing Paper/Card boolean field.
Add Set defaults Release Year to the current year, Favorite to false, and tags to empty.
Creation date remains automatic local-today metadata; it is not a release date.
The form and storage path validate supplied values before persistence.
`schemaVersion` uses the existing shared catalog-record version helper. The Release
Year follow-up raises that version to 4. Earlier records remain readable without
a release year; their original creation dates are preserved and never inferred as
release years. No database upgrade or bulk record rewrite is required.

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
Neither phase automatically creates either tag.

Future filename inference may add Die when a filename contains `die`, ignoring case,
or add Stamp for a stamp image whose filename does not contain `die`. Inference
is additive only and never automatically removes either tag. Users may manually
add or remove either tag. No inference is implemented in Phase 2A.

## Storage and shell

IndexedDB remains authoritative. Database version 6 adds only the `stampDieSets`
object store with keyPath `id`, preserving existing stores and records. The existing
storage module exposes `loadSavedStampDieSets` and `saveStampDieSet`; normalization
lives in `js/stamp-die-sets.js`. Existing global-tag usage counts, assignment
validation, and atomic tag deletion include saved sets so tag references stay valid.

The Stamps & Dies navigation link opens `#stamps-dies` through the existing shared
hash-navigation handler. The Library reuses existing structure and CSS and hides other libraries' sidebar
controls. It loads saved records on startup and renders each name, release year, Favorite
state, current tag display names, and a simple No image placeholder. Tiles have
no Detail or Edit actions, and no sample records are created.

Decision 32 applies to future Stamp & Die images: editing or deleting a catalog
record must never delete, move, rename, overwrite, or otherwise modify existing
files in the user-selected shared library. Phases 1 and 2A have no image filesystem access.

## Boundaries

No Edit, image import or persistence, folder selection/scanning, thumbnails,
filename inference, Library search/filtering, category management, detail panel, Card relationships,
or backup/restore support is included. Standard and iPad backups do not include
Stamp & Die Set records in this phase. Cards' existing free-text `stampSets` values
remain unchanged; they are not stable references to these records.

## Verification

Focused tests exercise shared navigation to and from the new screen, multi-image
reference metadata, required fields, stable tag identities across renames, an additive
database upgrade preserving existing stores, save/load round trips, and global-tag
assignment/deletion integrity. Storage upgrade tests use an in-memory IndexedDB API
harness; no real user database or image files are changed by the tests.

## Phase 2A Add Set workflow

The Library's Add Set action opens a native modal dialog with Set Name, Release Year,
Favorite, and the existing D1 global tag picker. Field, checkbox, and action styling
reuse Cards' existing CSS; the dialog uses native focus containment and Escape
handling. Cancel is on the left and Save Set on the right. No image input is present.

Set Name is required and trimmed. Within the Stamp & Die Catalog, Add Set rejects
normalized duplicate names: surrounding whitespace, repeated internal whitespace,
and case differences do not distinguish names. The existing `getTagKey()` helper
provides comparison normalization without changing the stored display name. The
check reads saved Sets at submit time and never consults Paper, Cards, or other
catalog types, where the same name is allowed. A clear validation message leaves
all draft fields and selected tags intact so the user can correct the name.

This is a Set-only data-quality rule: CSC should keep one record for a given set;
future ownership data will indicate who owns it rather than creating duplicate
records. Sets still use a `set-` UUID with the same timestamp/random fallback
approach as Cards. Generated IDs remain the true record identity. No existing
records, IDs, schema versions, storage structure, or tag behavior are changed.

Release Year matches DSP's year-only field: a required whole number from 1990 to
2100, defaulting to the current year. It persists as numeric `releaseYear` and
appears on Library tiles instead of creation date. Existing Sets without this field
show "Release year not recorded". Their creation dates are not repurposed.
`dateCreated` remains automatic creation metadata using the same local-calendar
helper as Cards in `ui.js`.

Saved records pass through `normalizeStampDieSet`, the shared
`addCatalogSchemaVersion` helper, and `saveStampDieSet`. Every new record has
`imageRefs: []`. The Release Year follow-up raises the shared catalog schema to 4;
IndexedDB stays at 6 and the backup envelope stays at 3. No Stamp-specific version,
new store, or image-reference extension is introduced.

The shared tag picker uses product type `stamp` and stable `tagIds`. All tags remain
available, including tags with legacy Paper/Card applicability metadata. Category
groups are organizational; only tags can be selected. Picker-local tag search is
part of the shared picker, not Library search. New tags are created in Settings.

Successful saves close the dialog, refresh the Library, announce success, and emit
`catalog:stamp-die-set-saved` so existing Settings usage counts refresh. Global tag
changes refresh Library display names and assignments. Failed saves retain the
draft for retry. While saving, the form prevents duplicate submits and dismissal.
Cancel or Escape discards the draft without writing; reopening resets the name,
release year, Favorite, selected tags, and picker search. No confirmation is required for
cancellation. Focus returns to Add Set after dismissal.

Phase 2A tests cover opening/defaults, whitespace-only names, canonical record
creation, universal tag selection, category rejection, Favorite persistence,
placeholder rendering, tag renames, cancel/Escape/reset, normalized duplicate-name
rejection and correction, distinct names, cross-catalog name independence, failed
save/retry, repeated-submit protection, and a fresh storage-module reload. DOM and
IndexedDB API harnesses run without altering real user records. Visual layout,
native focus containment, and browser-native validation still require a browser
check; the in-app browser was unavailable during this phase's verification.

Release Year tests cover the DSP year range, persistence, Library display, and
compatibility with older Sets whose creation dates remain unchanged.
