# Stamp & Die Catalog

## Status

Phases 1, 2A, and 2B1 are implemented: a Library, Add Set metadata workflow,
and ordered multiple-image selection/persistence. Edit, Detail, filtering, search,
Card relationships, and backup/restore remain out of scope.

A Stamp & Die Set is one catalog record for stamps only, dies only, or coordinating
stamps and dies. There are no individual stamp/die records, separate stampIds or
dieIds, or required per-image classifications. Every image belongs to the same Set.

## Canonical record

```js
{
  schemaVersion: 5,
  id: 'stable-set-id',
  name: 'Set name',
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
The existing `getTagKey()` helper supplies the comparison key. Add Set reads saved
Sets at submit time and never checks other catalog types. A duplicate error keeps
the entire draft intact. Future ownership data will describe who owns one Set
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
The order returned by selection is retained, and later selections append to it.
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

Failed record saves retain the draft for retry. Prepared image references are reused
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
contains `mask` adds ordinary global Mask; else contains `die` adds ordinary global
Die; otherwise adds ordinary global Stamp. Mask takes precedence when both words
occur. A mixed selection may add all three. Inference only adds assignments, preserving manual tags. Removing an
image does not remove a tag. Users may remove either inferred tag before saving;
Save and reload never recalculate it. Selecting another image can add its inferred
tag again.

If an exact Stamp/Die/Mask tag is missing, the existing global-tag creation helper adds
it to the draft catalog only. On successful Save, any still-selected new inference
tags and the Set commit in one IndexedDB transaction. An exact-name tag created
meanwhile is reused by stable ID; failed commits leave both catalog and Set unchanged.
No second taxonomy is created. No image-level classification is persisted; filename
classification is evaluated only when selection occurs.

## Library and safety

The existing hash navigation opens Stamps & Dies. Library tiles retain Set name,
Release Year, Favorite, and current global tag names. All images render in stored
order: one uses the available width, two appear side-by-side, and additional images
wrap into a two-column grid. Thumbnails are preferred; a failed thumbnail falls back
to the full image. Missing files show Image unavailable. Empty Sets show No image.
There is no Detail or Edit action.

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
import/export, automatic folder discovery/Set creation, Edit, Detail, Library search
or filtering, Card relationships, or image-deletion workflow was added.

## Verification

Automated tests cover multiple selection and order, safe folder copies/references,
collision handling, embedded and thumbnail-unavailable fallback, thumbnail metadata,
Mask-first filename inference (including mixed selections and case variants), manual overrides, categories, cancel/removal/late reads,
Library image rendering, atomic inferred-tag/Set writes, and reload. Existing
Paper/Card and global-tag tests remain in the full suite. DOM, directory, and
IndexedDB API harnesses do not modify real user files. Real picker permissions,
iPad selection, and visual layout still require browser verification.
