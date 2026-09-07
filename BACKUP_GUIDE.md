# Backup Guide

Card Supply Catalog keeps your data under your control. A complete backup includes the catalog JSON and any configured image folders:

- a catalog backup JSON file
- the Paper image library folder, if you use folder-backed Paper images
- the Card image library folder, if you use folder-backed Card images
- the Stamp & Die image library folder, if you use folder-backed Set images

## Backup Types

- Export Backup creates a compact catalog backup. Folder-backed images stay as image folder references, so the image folder must be backed up or shared separately.
- Export Compact iPad Backup creates a self-contained backup with iPad-sized compressed images embedded in the JSON. Use this when an iPad user needs to see images without connecting an image folder.

## Export the Catalog

1. Open the app.
2. Go to Settings.
3. Choose Export Backup.
4. If an Export Library folder is configured and writable, confirm the JSON file appears there. Otherwise, save the browser download somewhere safe.

The JSON backup includes Paper Packs, Cards, Stamp & Die Sets, colors, the global tags/categories, Owners, and persisted metadata and image references.

Current backups also preserve Card Status. A Card status is either `available` or `sent`; a legacy Card without a status is restored as `available`.

## Optional Export Library

Settings ? Export Library Folder lets you choose or reconnect a folder for generated
files. It is independent of the Paper, Card, and Stamp & Die image libraries:

- The three image libraries hold the source images referenced by catalog records.
- The Export Library receives standard backups, compact iPad backups, diagnostic
  JSON reports, and generated cover-sheet PNGs.

The Export Library is optional. Supported browsers remember the selected folder on
this device. If it is missing, inaccessible, or permission is denied, backups and
reports use the normal browser download. Unsupported browsers, including Safari
on iPad, show disabled folder controls with download-fallback messaging. Cover sheets
retain their existing Save As picker when no Export Library is usable, with browser
download when that picker is unavailable; a direct folder-write failure downloads
the generated file.

Automatically saved exports use names such as
`card-supply-catalog-backup-2026-09-07T12-34-56-789Z-<unique-suffix>.json`.
The UTC timestamp includes milliseconds; a unique suffix and existing-file checks
prevent automatic replacement. If a name is occupied, CSC adds a numbered suffix.
CSC never automatically deletes old exports, renames files, creates an Export
subfolder in an image library, or cleans up the selected folder. A failed write may
leave a new partial file; CSC preserves it and downloads the complete generated file.

Export Library configuration is device-local and excluded from backup contents.
Import does not change the destination for future exports. Check Image Libraries
continues to check only Paper, Card, and Stamp & Die images; the Export Library has
its own Choose/Reconnect controls and status.

## Backup and Catalog Schema Versions

The backup JSON contains two separate version numbers:

- `schemaVersion` versions the backup envelope: the top-level JSON structure, collection layout, image-storage information, and import contract.
- `catalogSchemaVersion` versions the catalog records stored inside that envelope, including the fields and allowed values on Cards, Paper Packs, and Stamp & Die Sets.

The current combination is backup envelope version 4 and catalog-record version 6:

```json
{
  "schemaVersion": 4,
  "catalogSchemaVersion": 6
}
```

Envelope version 4 adds `stampDieSets` and standard-backup descriptive
`imageStorage.configuredStampDieLibrary` metadata. The Set record format has not
changed, so catalog version 6 and IndexedDB version 6 remain unchanged. Version-1/2
legacy taxonomy backups and version-3 global-tag backups remain importable. An
absent Set section means no Sets to import; it never clears existing Sets or
creates inferred records. Backups declaring a newer backup/catalog version are
rejected before restore.

For future changes, increment `catalogSchemaVersion` for record fields, validation rules, or record migrations. Increment the backup `schemaVersion` only for changes to the top-level envelope or its import contract. If a change affects both, increment and document both versions.

## Back Up Images

If your images are stored in the browser fallback, they are included in the JSON backup as embedded image data.

If you use Paper, Card, or Stamp & Die image library folders, the JSON backup stores relative `imagePath` references. The image files themselves stay in the selected folders and must be backed up separately.

To back up folder-backed images, repeat these steps for each configured image folder:

1. Find the Paper, Card, or Stamp & Die image library folder you selected in Settings.
2. Copy the whole folder to your backup location.
3. Keep the folder structure intact.

Cloud-synced folders such as OneDrive, Dropbox, iCloud Drive, or Google Drive can work well as the image library folder, as long as the folder is also available locally on the computer using the app.

## Restore a Catalog

1. Open the app.
2. Go to Settings.
3. Choose Import Backup.
4. Select the backup JSON file.
5. If the backup uses folder-backed images, choose or reconnect the Paper, Card, and Stamp & Die image library folders.
6. Run Check Image Libraries and confirm images display in all three catalogs.

## Import Modes

- Incremental import is the default. It adds Paper Packs, colors, Cards, and Stamp & Die Sets whose IDs are not already present and skips matching IDs.
- Overlay import is enabled with **Replace existing catalog entries during import**. It replaces matching IDs with the backup versions and also adds missing IDs. Existing records absent from the backup remain untouched.

Paper Packs, Cards, and Stamp & Die Sets use the same ID-based rules. Two Cards that look alike but have different IDs are distinct records and are retained in either mode.

## Backup Routine

Export a fresh catalog backup after every cataloging session where you add or edit several Paper Packs, Cards, or Sets.

Back up the Paper, Card, and Stamp & Die image library folders whenever you add, replace, or migrate images.

## What to Keep Together

For a complete real-world backup, keep these together:

- `card-supply-catalog-backup-YYYY-MM-DD.json`
- the Paper image library folder
- the Card image library folder
- the Stamp & Die image library folder

The JSON file remembers the catalog. The image folders hold the actual image files.

## Stamp & Die backup/restore

Standard backups preserve `id`, `name`, optional `releaseYear` and `ownerId`,
`favorite`, `dateCreated`, canonical `tagIds`, and the ordered `imageRefs` array.
References preserve relative original/thumbnail paths, image name/library marker,
embedded original/thumbnail data, and storage strategy. Runtime previews, object
URLs, draft state, and handles are excluded.

Compact iPad backups use the same 400px JPEG compression policy as Paper/Card.
Successfully embedded Set images use the existing `embedded-indexed-db` strategy;
redundant paths/thumbnails are omitted as in compact Cards. If an image cannot be
embedded, its valid original reference and existing embedded fallback remain in
the backup, and the export reports missing folder images. Use standard backups
when exact original image/reference preservation is required.

Standard backups describe each library with only strategy, folder name, and
selection timestamp. Compact backups omit descriptive folder settings for all
products. Directory handles, absolute paths, and permission state are never
exported. Import preserves this device's configured handles; descriptive metadata
is informational and cannot reconnect folders automatically.

Validation and tag/category reconciliation precede the one IndexedDB restore
transaction containing Paper, Card, Set, color, Owner, and taxonomy updates. Invalid
Set data or a failed transaction cannot partially restore the catalog. Referenced
Owner IDs must exist in the backup; older Sets with no Owner remain valid. Shared
tag IDs are reconciled with the local catalog using the existing rules.

Decision 32 applies: import/export never deletes, moves, renames, overwrites, or
cleans up source images or folders. Standard export creates a backup JSON file;
compact export reads accessible images. Restore writes catalog metadata only.
