# Cards

## Purpose

Provide a searchable gallery of finished cards linked to paper packs.

# Goals

- Inspiration
- Connect cards to paper
- Search by color
- Search by tags
- Search by paper pack

# Architecture
Reuse or extract shared page-shell and navigation behavior where that can be done safely, but do not undertake a broad refactor as part of the preliminary tasks.

Favor incremental changes over broad refactoring.

# Navigation

Left Nav
- Paper Library
- Color Library
- Card Library
- Settings

Version & build information

# Phases

Phase 1
    Navigation only
Phase 2
    Gallery
Phase 3
    Initial image storage
Phase 4
    Pack relationships
Phase 5
    Add incremental backup loads
Phase 6
    Automatic thumbnail creation and image storage
Phase 7
    Card Gallery

## CSC v0.2.1 — Paper Library Improvements

### New
- Added thumbnail generation and thumbnail-first loading for Paper Library images
- Paper pack cards now show up to 12 patterns by default, with an option to expand
- Added additional sort options, including name, owner, and release year in ascending or descending order
- Added visible version/build information for troubleshooting and update checks
- Imports can now add only new paper packs without replacing packs already in the catalog

### Fixed
- Fixed duplicate folders being created by Move Images to Folder
- Improved image-folder and thumbnail hydration behavior

### Notes
- Existing full-resolution images remain unchanged
- Paper Library falls back to full-resolution images when thumbnails are unavailable
## Card Notes

Cards support optional plain-string `notes`. Add and Edit provide a multiline Notes
textarea after the structured metadata. Detail shows meaningful Notes as plain text,
with line breaks and wrapping; empty Notes are hidden. Tiles and search are unchanged.
Missing/null Notes normalize to an empty string; saving trims outer whitespace while
preserving internal line breaks, without a character limit. Non-string values are
invalid. Existing records need no bulk rewrite. Standard and iPad backups preserve
Notes through restore, including backups from before Notes existed.


## Stamp & Die relationship editing from Sets

Cards reference multiple Sets through stable `stampDieSetIds`. Stamp Library and
Detail derive Related Cards from this field and use the shared Detail Back history.
Stamp Add/Edit can also manage these assignments: explicit additions/removals write
through to the affected Cards in the same transaction as the Set save. Opening and
saving unchanged selections does not rewrite Cards. Paper references and missing
Set IDs unrelated to an explicit removal remain intact. Backup/restore and Set
catalog-only deletion retain the existing relationship and image-file safety rules.


## Legacy Stamp name migration

At startup, CSC converts legacy `stampSets` (and older singular `stampSet`) names
only when exactly one existing Set matches after ignoring case and surrounding
whitespace. Existing stable IDs are retained and duplicate IDs are avoided. Matched
names are removed atomically with adding their IDs; unmatched or ambiguous names
remain available as legacy metadata. No Sets are created and no fuzzy matching runs.
Only changed Cards are written; unrelated metadata and image references are preserved.
Normal loading and rendering remain read-only. A failed migration retains the original
records and can be retried on reload. Unresolved names are reconsidered at later startups.

Older backups use the same matching rules inside the existing restore transaction,
against the final imported/retained Set catalog. Skipped Cards are not rewritten by
restore. No schema or backup version changes are required: this converts existing
fields and retains compatibility for unresolved legacy names.

### Reviewing unresolved names

Card Edit shows unresolved legacy Stamp Set names beneath the existing Set lookup.
Find Set searches that same control; selecting a result replaces just that legacy
name with the chosen stable ID in the draft. Already-selected Sets can be chosen
without duplicating IDs. Result metadata helps distinguish same-name Sets. Cancel
linking leaves the name intact. Discard name explicitly removes only the old text,
never existing Set or Paper IDs. Users may leave unresolved names for later.

All changes use the normal Card Save path; canceling the form preserves the saved
Card. No second free-text Stamp field, automatic Set creation, or additional schema
migration is introduced. Cards without unresolved names show no review area.
