# Stamp & Die Catalog

## Status

Phases 1, 2A, 2B1, 2B2, 2C, and 2D are implemented: Library and Detail views, a shared
Add/Edit Set workflow, ordered multiple-image selection/persistence, and Library search/filtering.
Card relationships, Settings/library-folder configuration, and backup/restore remain out of scope.

A Stamp & Die Set is one catalog record for stamps only, dies only, or coordinating
stamps and dies. There are no individual stamp/die records, separate stampIds or
dieIds, or required per-image classifications. Every image belongs to the same Set.

## Canonical record

```js
{
  schemaVersion: 6,
  id: 'stable-set-id',
  name: 'Set name',
  ownerId: 'stable-owner-id',
  imageRefs: [],
  tagIds: [],
  favorite: false,
  dateCreated: '2026-09-05',
  releaseYear: 2024
}
```

Identity is a generated `set-` UUID, with the same timestamp/random fallback as
Cards. Names do not determine identity. Set Name is required and trimmed.
Normalized duplicates within the Stamp & Die Catalog are rejected: case,
surrounding whitespace, and repeated internal whitespace do not distinguish names.
The existing `getTagKey()` helper supplies the comparison key. Add/Edit reads saved
Sets at submit time, excluding the current stable ID during Edit, and never checks other catalog types. A duplicate error keeps
the entire draft intact. Ownership describes who owns one Set
rather than requiring duplicate records for different owners.

Release Year matches DSP: a required whole year from 1990 to 2100, defaulting to
the current year. Older Sets may omit it and show "Release year not recorded".
`dateCreated` remains automatic creation metadata in local YYYY-MM-DD format,
using Cards' shared date helper. Existing creation dates are never converted into
release years. Favorite defaults to false; manually selected tags start empty.

The shared `addCatalogSchemaVersion()` boundary is authoritative. Release Year
raised the catalog schema from 3 to 4; Phase 2B1 raises it to 5 because persisted
image references now accept embedded image data and thumbnail fields that the old
normalizer rejected or discarded. These are shared catalog versions, not Set-specific
versions. Older path-only/no-image records remain readable. IndexedDB stays at
version 6; the backup envelope stays at 3. No bulk record rewrite is needed.

## Image references and shared utilities

`imageRefs` is an ordered array. It wraps existing CSC image field meanings rather
than establishing another image storage format. Each reference may contain:

```js
{
  imageName: 'set-stamps.jpg',
  imagePath: 'set-stamps.jpg',             // relative folder path, when folder-backed
  imageLibrary: 'stamp-die-images',        // folder identity
  thumbnailImagePath: 'set-stamps.thumb.jpg',
  imageStorageStrategy: 'local-folder'
}
// Embedded fallback:
{
  imageName: 'set-dies.jpg',
  imageSrc: 'data:image/jpeg;base64,...',
  thumbnailImageSrc: 'data:image/jpeg;base64,...',
  imageStorageStrategy: 'embedded-indexed-db'
}
```

A valid reference requires an imagePath or embedded imageSrc. Thumbnail fields are
optional. Supported embedded image types are JPEG, PNG, WebP, and GIF. Persistence
whitelists the canonical fields and rejects invalid paths/data; temporary blob URLs,
imagePreviewSrc, imageThumbnailSrc, File objects, and handles are never record data.

`image-references.js` extracts Card image preparation, relative-path loading,
thumbnail naming, embedded encoding, and runtime URL cleanup for reuse. Cards
continue using those implementations with their existing library marker. Sets reuse
Card file validation/preview and thumbnail-first source selection, the existing
browser-capability helpers, and `thumbnails.js` (400px JPEG thumbnails).
`stamp-die-images.js` coordinates arrays and the Set folder; it does not duplicate
image encoders or the folder-reference format.

## Add Set image workflow

Choose Images accepts multiple images in one operation. Native open-file selection
is used where available; other browsers, including iPad, use a multiple file input.
Images are grouped Stamp first, Die second, Mask last. Selection order is retained
within each type, and later selections append within their type.
Compact previews have Remove buttons. No image classification input is present.

Choose Image Folder is available on browsers supporting directory selection. It
stores a separate directory handle under `stampDieImageLibrary` in existing Settings
storage, without a Settings redesign. Users can choose the same folder again to
reconnect it. Selecting a folder does not import/scan it or write image files.

On Save, a selected file already within that folder is referenced at its relative
path using the directory handle's resolve method. Files selected elsewhere are
copied into the folder root using an available filename. Originals and existing
sibling thumbnails are retained; only missing thumbnails are created. The copy-name
check accounts for both original and thumbnail collisions, and the shared save
writer refuses to overwrite an existing file. Permission/read errors are not treated
as proof that a file is absent.

When no writable folder is available, or preparation in the folder fails, the
original image and thumbnail are embedded in IndexedDB. A browser without working
thumbnail generation can retain the embedded original without a thumbnail. Save
reports when images were kept in browser storage. A Set without images remains valid.

Known minor storage debt (accepted for now): failed record saves may leave newly
created image files behind. Failed saves retain the draft for retry. Prepared image references are reused
for that draft/folder to avoid recopying successful preparations. Filesystem creation
and IndexedDB cannot form one transaction: new files can remain if a subsequent
thumbnail/record write fails. They are never deleted as rollback. This limitation
preserves the shared-library invariant.

Cancel/Escape discards draft fields, previews, and selection without saving a Set or
inference tags. Removing a draft image affects only the in-memory selection and
preview URL, never user files. Late file-read results after cancellation are ignored.
An explicitly chosen image-folder setting remains remembered. During Save the form
blocks repeated submits and dismissal; while images load, Save is disabled.

## Global tags and filename inference

All tags remain universally available through the existing D1 category-aware picker.
Only stable tag IDs are assignments; categories organize the picker and are never
assigned. Deprecated appliesTo metadata does not restrict Set assignments. Ordinary
tag creation remains in Settings; there is no inline tag-creation form.

For each newly selected image, filename inference uses this case-insensitive order:
contains `die` adds ordinary global Die; else contains `mask` adds ordinary global
Mask; otherwise adds ordinary global Stamp. Die takes precedence when both words
occur. A mixed selection may add all three. Inference only adds assignments, preserving manual tags. Removing an
image does not remove a tag. Users may remove either inferred tag before saving;
Save and reload never recalculate it. Selecting another image can add its inferred
tag again.

If an exact Stamp/Die/Mask tag is missing, the existing global-tag creation helper adds
it to the draft catalog only. On successful Save, any still-selected new inference
tags and the Set commit in one IndexedDB transaction. An exact-name tag created
meanwhile is reused by stable ID; failed commits leave both catalog and Set unchanged.
No second taxonomy is created. No image-level classification is persisted; filename
classification is derived from filenames for presentation ordering; tag assignment
inference runs only when new images are selected.

## Library and safety

The existing hash navigation opens Stamps & Dies. Library tiles retain Set name,
Release Year, Favorite, and current global tag names. All images render in stable
Stamp -> Die -> Mask order: one uses the available width, two appear side-by-side, and additional images
wrap into a two-column grid. Thumbnails are preferred; a failed thumbnail falls back
to the full image. Missing files show Image unavailable. Empty Sets show No image.
Each tile opens Detail and also retains its Edit action.

Folder-backed references are hydrated at runtime, with object URLs released on
refresh. New Set references use the explicit stamp-die-images marker. Existing
explicit Card/Paper references resolve through their corresponding libraries;
unmarked legacy paths retain CSC's Paper-folder convention. Unknown markers never
silently route into a different library. Reading does not request folder permissions.

Decision 32 applies permanently: canceling, removing draft images, or changing a
catalog record must never delete, rename, move, overwrite, or otherwise modify
existing shared-library images. Only new image/thumbnail files may be created during
Save. No Set path calls image deletion, folder scanning, or thumbnail repair.

Standard/iPad backups still exclude Stamp & Die Set records and images. No backup,
import/export, automatic folder discovery/Set creation, Card relationships, or
image-deletion workflow was added by the image phases. Library search/filtering
is covered by Phase 2D below.

## Edit Set (Phase 2B2)

Edit uses the same dialog, validation, image selection, and global tag picker as Add.
It reloads the persisted Set and allows changes to Set Name, Release Year, Favorite,
Tags, and Images. Renaming preserves the stable ID; Save updates that record through
the existing storage path and refreshes the Library. Creation metadata is preserved
internally and is not a form field. Legacy Sets without a Release Year may leave it
unknown on Edit; entering a year uses the existing 1990-2100 validation.

Existing images load as references with previews, without copying originals,
regenerating thumbnails, or converting folder references to embedded images.
Supported path, embedded, library, and thumbnail fields survive saving. Missing
files display an unavailable placeholder and retain their references.

Removing an image is catalog-only: Save omits its reference, never touches its file
or thumbnail, and never removes tags. New images use the existing native/fallback
picker and persistence path. Inference runs only when new images are selected,
with Die before Mask before Stamp; it never runs on Edit initialization or Save.
Manual removal of an inferred tag is respected, and unrelated tags remain intact.

Library and Add/Edit previews use stable Stamp -> Die -> Mask ordering. Save retains
that order in imageRefs; within each type, original relative order is preserved.
Classification stays derived from the filename (or path basename for legacy refs),
with no new persisted taxonomy. An older interleaved record is grouped on display
and its next save; image reference contents and tag assignments are not reinterpreted.

Cancel/Escape discards fields, added images, and reference removals without writing
the record or image files. Reopening reloads persisted data. A session token prevents
late reads from a canceled Edit entering a reopened draft for the same record ID.
Failed saves retain the draft for retry. Existing accepted failed-save file debt
also applies to newly selected Edit images; no deletion/rollback was added.

No database, schema, backup, Settings, or Paper/Card image behavior changed.

## Detail view (Phase 2C)

Click a Library tile, or focus it and press Enter/Space, to open its modal Detail.
This follows the Paper/Card modal-panel interaction and Card header styling, using
Set's existing native dialog mechanics for focus containment and Escape. The close
control, Escape, or clicking the backdrop closes Detail and returns focus to
the Library tile. The application hash and shell are unchanged; no history stack
was added.

Detail displays Set Name, Release Year (or unknown), read-only Favorite state,
ordinary global tag names resolved from canonical tagIds, and every image. Tags
are not editable in Detail; categories remain organizational metadata.

Images use stable Stamp -> Die -> Mask ordering without changing stored data.
A responsive grid gives one image the available width, fits two or three alongside
one another when space permits, and wraps on narrower screens. Images retain useful
size rather than shrinking every image into a single row of thumbnails.

Detail reuses Card's full-image source selector through the Set image module and
the existing folder hydration path. Full folder-backed or embedded images are
preferred, with the existing thumbnail source as fallback. Unavailable sources show
Image unavailable; Sets with no images show No image. Viewing or failing to load an
image never writes a record, runs inference, prepares a thumbnail, or modifies files.

Edit opens the existing form for the selected stable ID above Detail. Save refreshes
the Library and that same open Detail, including changed images and tag names.
Cancel returns to the unchanged Detail. No alternate Edit implementation, Favorite
toggle, schema change, or storage change was introduced.

## Delete Set and Library polish (Phase 2C1)

Detail exposes Delete Set. A native confirmation asks whether to remove the named
Set from CSC and states that image files will not be deleted. Cancel changes nothing.
Confirmed deletion commits a transaction against only the stampDieSets store. The
record and its embedded data/references disappear together; global tags, settings,
other records, original files, and shared thumbnails remain untouched. No filesystem
cleanup runs. Runtime preview URLs are released after success.

Only after commit does Detail close and clear its selected record, and the Library
refresh. A failed transaction retains the record and open Detail with a red error
and allows retry. No schema or database version change is required.

Cards and Sets now show the same initial loading-message style as Paper Packs.
Library Favorites share Paper's inline heart styling (muted off, rose on); Card's
existing toggle remains, while Set's heart is read-only and Favorite is edited via
Edit. Card and Set grid items stretch to their row's tallest module, with native
auto-sized rows and existing responsive column widths.

## Verification

Detail tests cover tile/keyboard navigation, metadata, global-tag renames, full and
thumbnail image sources, missing images, stable ordering, read-only safety, and
Edit returning to and refreshing the selected record.

Automated tests cover multiple selection and order, safe folder copies/references,
collision handling, embedded and thumbnail-unavailable fallback, thumbnail metadata,
Die-first filename inference (including mixed selections and case variants), manual overrides, categories, cancel/removal/late reads,
Library image rendering, atomic inferred-tag/Set writes, and reload. Existing
Paper/Card and global-tag tests remain in the full suite. DOM, directory, and
IndexedDB API harnesses do not modify real user files. Real picker permissions,
iPad selection, and visual layout still require browser verification.


## Stamp & Die Ownership

Sets persist an optional stable `ownerId` from the shared owner registry. New Sets
require Owner and use the device Default Owner, then the last owner used for a new
Set. Add/Edit reuse the shared owner picker, including Add new owner. Existing
Sets without ownership remain readable and editable without automatic assignment;
they display "Owner not recorded". Library tiles and Detail resolve current owner
names by ID, including archived owners, and refresh after owner renames.
New owners commit atomically with the Set and any inferred tags. Cancel or failed
saves do not add owners. The catalog schema advances to 6 for this persisted field;
IndexedDB and backup-envelope versions are unchanged.


## Search & Filter (Phase 2D)

Stamps & Dies uses the existing sidebar navigation group, search field, quick-filter
styles, collapsible Tags section, Clear tags, and Clear all interaction. Text search
matches Set Name, Release Year, current Owner display name, and assigned global tag
names. Paper's shared normalization trims text, ignores case, treats hyphens and
underscores as spaces, and collapses repeated whitespace. Filenames, paths,
thumbnails, generated IDs, category names, and dateCreated are not searched.

Owner uses canonical ownerId and the global registry, with the same shared dropdown
helper as Paper and Cards. The initial filter is All, matching Paper. Only active
owners appear as choices, sorted by current name. Renames preserve selection by ID;
archiving a selected owner returns that control to All. Sets retain their ownership
and remain visible under All, with archived owner names still displayed/searchable.
No Owner or tag display names are persisted in Set records.

Tags and Categories use global-tag-filter.js without product restrictions. Stamp,
Die, and Mask are ordinary universally available tags, regardless of deprecated
appliesTo values. Explicit tag selections use AND. A category matches any member tag
(OR), optionally refined to selected members (OR). Categories and independent tags
combine with AND; categories themselves are never Set assignments. Renames refresh
labels/search text while retaining stable selected IDs and record assignments.

Favorites matches the existing boolean favorite field. Release Year is an exact-year
quick-filter dropdown with All plus recorded years in descending order. Paper has
year search/sorting but no dedicated year filter, so this uses the existing select
quick-filter pattern. Legacy Sets without releaseYear match All but not a specific
year. A selected year remains selected even after its last matching Set is edited
or deleted, so unrelated constraints are not silently cleared.

Search, Owner, tags/categories, Favorite, and Release Year all combine with AND.
Every control change filters the complete in-memory Set collection without database
reads, image hydration, folder scans, file access, or persistence. Matching counts
show "Showing N of M sets". An empty catalog retains the Add Set invitation;
a populated catalog with zero results says "No sets match the current filters."

Clear all clears search, Owner, Favorite, Release Year, and all tag/category choices,
shows all Sets, and returns focus to Search. Clear tags affects only tag/category
constraints. Filter state stays in the current page through Detail, Edit, Delete,
Add, and switching library screens. Detail/Edit/Delete target stable Set IDs in the
complete collection, even when only one tile is visible. Successful record changes
reapply the active constraints; an edited Set may cease matching while its open
Detail still reflects the saved record. No navigation history or persisted filter
settings were added.

Focused tests cover searchable fields/normalization, identity and rename behavior,
inactive owners, all tag/category semantics, favorites/years, combined constraints,
reset, empty states, filtered Detail/Edit/Delete/Add, and read-only filtering.
Existing Paper/Card and global filter regression tests remain in the full suite.


Stamps & Dies participates in the shared usage-based global filter presentation:
choices come from the complete unfiltered Set Library, categorized tags appear only
under relevant categories, and unused children/empty categories are hidden. Search
and active filters do not shrink these choices. Add/Edit remains universal; matching
semantics and canonical assignments are unchanged. See DESIGN.md's Category-Aware
Tag Filtering rules for selection cleanup after actual usage/membership changes.


## Detail presentation consistency

Set Detail follows the Paper/Card header convention: Stamps & Dies context label,
Set Name with the read-only Favorite heart alongside it, and an accessible close (x) control. The content places the existing
large, uncropped Stamp -> Die -> Mask gallery beside a compact metadata column.
At tablet/narrow widths the metadata stacks below the gallery. Existing image
resolution, responsive gallery sizing, and fallback behavior are retained.

Set Info uses Paper's label/value blocks for Owner and Release Year. The Favorite
heart beside the title uses the existing muted/rose styling. Library tiles likewise
place the Set Name and heart together above the image gallery, matching Paper. Tags use Card Detail chips,
with a compact No tags state. An Actions section in the metadata column contains
Edit Set (primary) and Delete Set (destructive), with delete errors beside the
actions. Closing restores Library focus; Edit/Delete behavior and filter state
are unchanged. No record fields, persistence, or shared visual rules were added.
