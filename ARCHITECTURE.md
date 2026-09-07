# Card Supply Catalog

## Architecture Guide
Version: 1.1

Status: Maintained

Last Updated: 2026-08-27

1. Architectural Goals

# Principles.

Simple over clever.
Local-first.
Offline-first.
Human-readable data.
Modular JavaScript.
Minimal dependencies.
Easy to maintain.
Easy to back up.

# Technology Stack
HTML5
CSS3
Modern JavaScript (ES Modules)
IndexedDB browser storage
Bundled JSON seed data
Local image files
File System Access API where supported
Service worker application shell
Git

No frameworks.
No npm dependencies.
No build tools (Version 1).
This is an intentional design decision.

# Project Structure
card-supply-catalog/

README.md
SPEC.md
DESIGN.md
ARCHITECTURE.md
ROADMAP.md
DECISIONS.md
CHANGELOG.md

index.html

css/
js/
assets/
data/

# JavaScript Modules
Every module should have one clear job. The current modules are:

| Module | Responsibility |
| --- | --- |
| `app.js` | Application startup and feature initialization |
| `library.js` | Screen navigation, Library and Color Library rendering, filters, detail interactions, uncataloged-folder discovery, and catalog coordination |
| `add-dsp.js` | Add/Edit DSP workflow, validation, remembered defaults, and automatic folder-image loading |
| `color-form.js` | Add Color workflow, including missing-color handoff from Add/Edit DSP |
| `images.js` | Embedded images, selected-folder access, relative paths, health checks, migration, and link repair |
| `import-mode.js` | Shared incremental/overlay import planning for paper packs, colors, and Cards |
| `settings.js` | Image-library settings, setup status, and bulk owner changes |
| `storage.js` | IndexedDB persistence for paper packs, cards, colors, settings, base-data merging, deletion markers, and legacy localStorage migration |
| `backup.js` | User-triggered standard/iPad export and import |
| `export-library.js` | Optional export destination, safe filenames, shared non-overwriting writes, and browser-download fallback |
| `browser-capabilities.js` | Side-effect-free browser capability detection for filesystem and ordinary image-file workflows |
| `card-images.js` | Card image selection, folder-backed storage, embedded fallback storage, thumbnail creation, and runtime hydration |
| `cards.js` | Persisted Card gallery, shared Add/Edit Card workflow, Card detail rendering, and paper-pack relationship selection from the merged runtime catalog |
| `cover-sheet.js` | Printable 6-by-6-inch cover-sheet generation |
| `detail.js` | Detail-panel dismissal behavior |
| `schema.js` | Catalog and backup schema versions |
| `pwa.js` | Service worker registration |
| `ui.js` | Shared UI helpers |
| `search.js` | Reserved boundary for future extraction of search/filter logic; current filtering remains in `library.js` |
| `tag-picker.js` | Reusable ID-based global tag selection for product Add/Edit forms, including categories, selected-tag summaries, and picker-local search |
| `global-tag-filter.js` | Shared stable-ID tag/category filter semantics, usage-based filter UI rendering for Paper/Card/Set Libraries, tag-name search projection, and Holiday identity resolution |

# Data Storage
The application has three storage layers:

1. `data/paper-packs.json` and `data/colors.json` provide version-controlled base data.
2. IndexedDB stores writable paper packs, cards, deleted base-pack IDs, user-added colors, and settings. Saved paper-pack records are merged with base JSON at startup; cards are user-created records with no bundled base-data layer.
3. User-selected Paper, Card, and Stamp & Die image-library folders are the preferred durable locations for image files on supported desktop browsers. Records store paths relative to their applicable folder. New Cards reference images already inside the separate Card folder without copying; images selected elsewhere are copied into its root. A sibling `.thumb.jpg` is created in either case. Legacy Card paths without an image-library marker continue resolving from the Paper image folder. Embedded data URLs in IndexedDB remain the compatibility fallback.

Directory handles are permission-scoped browser objects and may require the user to reconnect or grant access again. A cloud-synced local folder such as OneDrive can be selected, but the app does not call a cloud-storage API directly.

# JSON Design
Each DSP contains:

catalog schema version
unique ID
name
owner
colors
release year
pattern count
availability
refill available
tagIds
patterns
recently added status

Readable JSON.

Pretty printed.

Human-readable and manually recoverable if necessary.

# Images
Images may come from:

Official product images
Internet searches
Personal photographs

Images are:
optional
replaceable
individually managed
imported by folder or by file

# Colors
Treat colors as first-class data entities. Every product in the catalog references colors by ID. The colors.json file is the authoritative source for all color metadata.

Each color's JSON entry includes a color ID derived from the name, name, HEX value, RGB value, collection family, visual color family, optional collection years, status, aliases, and supported product metadata (cardstock, ink, DSP, marker, and blend).
   
# Backups

Backups are explicit, user-triggered JSON exports rather than automatic rolling snapshots.

- Standard backup: includes Paper Packs, Cards, Stamp & Die Sets, colors, the versioned global tag catalog, `tagIds` assignments, embedded fallback images, and relative references to folder-backed Paper, Card, and Stamp & Die images. The image folders must be backed up separately.
- iPad backup: includes the same global tag catalog and `tagIds` assignments while embedding compressed copies of accessible Paper, Card, and Stamp & Die images so the catalog can be restored where folder access is unavailable.
- Import: validates and reconciles the complete taxonomy and all catalog records in memory before writing; then persists the global catalog and selected Paper/Card/Set records, colors, and Owners in one IndexedDB transaction. Any unresolved identity conflict, validation, preparation, or transaction failure leaves IndexedDB and in-memory catalog state unchanged. Legacy name-based backups remain importable through the approved conversion rules.
- Destination: the independently configured, optional Export Library receives exports when writable; otherwise exports use a browser download. Image-library roots are never chosen implicitly as export destinations.

## Schema Version Boundaries

Catalog-record schema and backup-envelope schema are versioned independently in `js/schema.js` because they protect different compatibility boundaries.

- `CATALOG_SCHEMA_VERSION` describes the structure and interpretation of catalog records such as Paper Packs, Cards, and colors. Increment it when persisted record fields, allowed values, validation, or record migration behavior changes.
- `BACKUP_SCHEMA_VERSION` describes the top-level backup envelope: its identifying fields, collection layout, image-storage metadata, and import contract. Increment it only when that envelope structure or its interpretation changes incompatibly.

The Card Status change raised the catalog schema to version 3. Cards now persist `status` as either `available` or `sent`; legacy Cards without a status are normalized to `available` when loaded or imported. The later Stamp & Die Release Year addition raises the shared catalog schema to version 4; current exports declare `catalogSchemaVersion: 5` after the Set image-reference extension.

Phase B2 raises the backup envelope to version 3. Version-3 Standard and Compact iPad exports contain one `tagCatalog` object (`schemaVersion`, `tags`, and `categories`), and Paper/Card records contain only `tagIds`. Version-1/2 backups with optional `tagVocabularies` and legacy `keywords`/`tags` remain importable through in-memory conversion and reconciliation. At Phase B2 the record catalog schema remained version 3; the later Release Year change uses version 4.

Paper and Card Add/Edit forms select global tags by stable ID through the shared category-aware picker and persist canonical `tagIds`. Runtime `keywords` and `tags` arrays are derived display projections used only by existing Paper/Card tile and detail renderers. They remain enumerable so ordinary runtime record copies retain canonical `tagIds`; persistence validates and writes `tagIds` directly and never rebuilds identity from those display names.

Every global tag is assignable to Paper Packs, Cards, and Stamp Sets. Assignment validation checks that each `tagId` identifies a real tag and never a category; it does not filter by product type. The legacy `appliesTo` field is optional, deprecated compatibility metadata. Existing catalogs and backups may retain and round-trip it, but current selection, search, validation, legacy fallback resolution, and runtime projections ignore it. Newly created tags omit it without changing the catalog or backup schema version.

Paper, Card, and Stamp & Die Library tag filters consume canonical item `tagIds`. Individual tag constraints use AND semantics. Each category constraint resolves its current member IDs from the global catalog and uses OR semantics; selected category members replace the full membership set as a refinement. Independent tag and category constraints combine with AND semantics. General Library search resolves assigned tag IDs to current display names, so renaming a tag changes searchable text without changing persisted assignments. Category names are not general-search terms. The retained Holiday quick filter resolves the current Holiday tag (or a Holiday/Holidays category fallback) to stable identity before evaluating item IDs.

`getRelevantTagFilterOptions(items, catalog)` derives filter presentation from the
complete product Library's canonical `tagIds`. It exposes only used uncategorized
tags standalone and used categorized tags through their categories, hiding unused
children and empty categories. Multiple-category membership remains intact.
Search/current filter results never determine relevance. The shared renderer keeps
unchanged controls in place and reconciles selections when options actually change;
removed controls cannot leave hidden constraints. Matching still uses the complete
global catalog and existing AND/OR semantics. Add/Edit pickers and Settings remain
universal. This is runtime UI data only; no record, taxonomy, or schema changes.


The old product-specific vocabulary stores, vocabulary loaders/writers, inline name-to-tag creation bridge, and Paper/Card-specific tag update events have been removed. The legacy `paperTagVocabulary` and `cardTagVocabulary` setting IDs are still read during the idempotent one-time migration and may be written only while restoring an older backup; they are not current taxonomy stores. Legacy Paper `keywords` and Card `tags` are likewise accepted only by migration/import compatibility paths. A side-effect-free legacy-vocabulary merge export remains as an upgrade shim because an older service-worker-cached `storage.js` may briefly import it while the browser replaces the module graph; current runtime code does not call it.

# Error Handling
Never lose user data.
Validate before saving.
Recover gracefully.
Never leave an invalid or partially written catalog record in IndexedDB.
Backup restore is atomic across paper packs, deletion markers, colors, and Cards: either the complete selected import commits or none of it does.

# Performance Goals
Startup feels instantaneous.
Search updates immediately.
Library scrolling remains smooth.
Folder-backed images are hydrated from relative paths without persisting temporary blob URLs.

# Coding Standards
One responsibility per module.
Semantic function names.
No duplicated logic.
Favor readability.
Small functions.
Self-documenting code.
Consistent formatting.
Functions should generally perform one task and remain small enough to be easily understood without scrolling extensively.

# Module Communication
Modules communicate through exported functions and a small set of document custom events, including paper-pack saves, color saves, and backup completion. Avoid direct manipulation of another module's internal state. Shared functionality belongs in `ui.js` or another dedicated module.

# File Ownership
Each file should have a single clear responsibility.

When a feature grows large enough to require multiple responsibilities,
split it into additional modules rather than expanding existing ones indefinitely.

# Data Evolution
Catalog Compatibility

Future versions should migrate existing catalog data whenever possible.

Changes to the JSON structure should preserve existing user data automatically.

For future version changes, identify the boundary before incrementing a version:

1. A record-only change increments the catalog schema and supplies normalization or migration for older records; it does not automatically increment the backup envelope.
2. A top-level backup-format or import-contract change increments the backup-envelope schema and must define how older envelopes are recognized or rejected.
3. A change that affects both boundaries increments both versions and documents both compatibility paths.

# Git Workflow

Commit frequently.
One logical change per commit.
Meaningful commit messages.
Tag milestones.

# Future Expansion
The architecture should support future additions such as:

Cardstock
Ribbon
Embellishments
Custom keywords

without redesigning the application.

# Architectural Constraints
The application shell and previously available data must work offline after installation. Initial loading and service-worker installation require the deployed files to be reachable once.
The application must not require a cloud service.
User data must remain under the user's control.
Images are never uploaded automatically.
No feature may require an internet connection to use the catalog.

# Architecture Invariants
Never introduce a framework without approval.
Never combine unrelated responsibilities into a single module.
Never sacrifice readability for brevity.
Do not create competing writable sources of truth. IndexedDB is authoritative for writable catalog records; the selected Paper and Card image-library folders are authoritative for their respective folder-backed image files; exported JSON is a portable backup.
Never duplicate business logic across modules.
Prefer extending existing modules over creating unnecessary new ones.

## Shared Product View Layout

Library and Detail renderers for every product follow the metadata and action
placement defined in [DESIGN.md](DESIGN.md#shared-product-layout). Reuse existing
layout classes, metadata blocks, title/Favorite rows, action sections, and close
controls. Keep product-specific rendering limited to the fields and image layouts
that differ; avoid separate layout conventions for each product.

## Stamp & Die Catalog ? Phase 1

The Stamps & Dies shell reuses shared hash navigation and Library styles. A set is
one named record with multiple image references and canonical global `tagIds`.
IndexedDB version 6 adds the `stampDieSets` store without changing existing records.
`storage.js` supplies minimal load/save support; `stamp-die-sets.js` validates and
serializes metadata using the existing catalog schema helper. Global tag usage and
delete operations include sets. Add Set and multiple-image persistence are now
implemented, including backup/restore parity; relationships remain deferred. See [feature_stamp_die_catalog.md](feature_stamp_die_catalog.md)
for the agreed record shape and Phase 1 boundaries.

### Stamp & Die Release Year

Sets now persist an optional numeric `releaseYear`, using DSP's 1990?2100 range.
Add Set requires this field; older records may omit it. Their original `dateCreated`
is preserved as creation metadata and is never converted into a release year.
This persisted-field change raises shared `CATALOG_SCHEMA_VERSION` to 4 under the
existing record-version boundary. IndexedDB stays at 6 and the backup envelope
stays at 3. No bulk migration or image-storage change is needed.

### Shared image references and Stamp & Die Phase 2B1

`image-references.js` contains reusable Card/Set image preparation, embedded encoding,
relative-path hydration, and thumbnail-first support. It uses `thumbnails.js` rather
than a separate encoder. Stamp & Die `imageRefs[]` is an ordered wrapper around
existing `imagePath`, `imageLibrary`, `imageSrc`, `thumbnailImagePath`,
`thumbnailImageSrc`, and `imageStorageStrategy` fields. Runtime object URLs are not
persisted. The Set folder handle uses the existing Settings store under
`stampDieImageLibrary`; references identify it with `stamp-die-images`.

Supporting embedded images and thumbnail fields changes persisted reference
validation/serialization, so the shared catalog schema advances from 4 to 5.
Legacy path-only and empty references remain readable; no database/store upgrade
or bulk migration is needed. Backup-envelope version 3 is unchanged, and Set
backup support was deferred at Phase 2B and is now covered by the parity phase below.

Filename inference uses case-insensitive Die, then Mask, then Stamp precedence.
It creates missing ordinary Stamp/Die/Mask tags only in draft memory.
Still-selected new tags and their Set commit together through the existing storage
transaction helper. Inference never runs at reload or re-adds manually removed tags
on Save. Folder files created before a failed record commit may remain; rollback
never deletes shared-library files. Existing originals and thumbnails are never
overwritten by the shared save path.


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

### Independent image-library Settings (Stamp & Die Phase 2E)

Paper Packs, Cards, and Stamps & Dies support independently configured image
libraries through the same shared CSC library-management architecture. Settings
uses `imageLibrary`, `cardImageLibrary`, and `stampDieImageLibrary` respectively in
the existing IndexedDB settings store. Each stores a permission-scoped
`directoryHandle`, `strategy`, and `selectedAt`; roots need not share a parent.
Capability detection, permission checks, relative references, embedded fallback,
and safe image writes reuse the existing modules. No database upgrade is needed.

Stamp Add/Edit load their configured root and offer the native library picker
alongside general multiple-file input. Settings emits
`catalog:stamp-image-library-selected` to refresh runtime images without persisting
Set changes. Health checks report each library independently; a failed check or
record load cannot suppress another library's result. Unsupported folder controls
use the existing disabled presentation and embedded-image fallback messaging.

Stamp storage retains Phase 2B's root copies and sibling thumbnails. Selection,
reconnection, health checks, reference removal, and Set deletion never mutate
shared-library files (Decision 32). Existing references are not migrated or rewritten.
Phase 2E left the backup payload and versions unchanged and deferred Stamp backup
metadata. The backup/restore parity phase below supersedes that deferral.

### Stamp & Die backup/restore parity

Backup envelope 4 adds `stampDieSets` and standard-only
`imageStorage.configuredStampDieLibrary` using the same descriptive serializer as
Paper/Card (strategy, folder name, selectedAt). Catalog schema 6 and database version
6 are unchanged: the existing Set fields and store already suffice.
`normalizeStampDieSet` is the shared export/import validation and serialization
boundary, preserving dateCreated, optional owner/year, canonical tagIds, Favorite,
and all supported ordered image-reference fields while excluding transient state.

Standard export preserves embedded originals/thumbnails and relative paths without
reading source files. Compact export hydrates through the existing Set resolver,
uses the shared Card compressor, and normalizes results to the existing embedded
Set strategy. Successful compression omits redundant paths/thumbnails; failed
compression retains the original reference/fallback and reports unavailable images.

Set tag IDs participate in existing taxonomy reconciliation. Owner registries retain
stable IDs even when two device registries contain the same display name. Import
uses the existing ID-based skip/replace plan, validates before persistence, and
includes `stampDieSets` in the same transaction as Paper/Card/color/Owner/settings
updates. Only a successful commit refreshes Set views and the cached global catalog.
An absent Set section is an empty import, never a clear operation. Legacy envelopes
remain supported; future backup/catalog versions are rejected before writing.

Directory handles remain local settings, excluded from JSON and untouched by
restore. No automatic reconnection, migration, folder scan, or image creation runs
for imported Sets. Decision 32 prohibits any source-file cleanup or destructive
filesystem operation. The Phase 2E backup deferral is superseded by this phase.

### Export Library destination

The optional `exportLibrary` setting uses the existing IndexedDB settings store and
`{ strategy: 'local-folder', directoryHandle, selectedAt }` shape. Settings reuses
shared directory capability detection and permission-status presentation. Export
access uses the existing read/write permission helper; unsupported, missing,
denied, and failed setting access resolve to the browser-download path.

`export-library.js` handles standard/compact JSON backups, full diagnostic JSON,
and generated cover-sheet PNGs. It reuses `fileExists` and `writeFile` from the shared
image-reference utilities without introducing new filesystem storage. Filenames
start with the resolved device Default Owner name and `CSC` (or just `CSC` when
no Owner can be resolved), followed by a UTC date/time timestamp through seconds, with no random suffix.
Exports within a page are serialized to prevent same-second write races. Collision checks choose a new numbered
name, and the writer checks again before creating a file. Lookup/write/close errors
preserve the generated Blob for download; no folder scan or cleanup is performed.
Cover sheets retain explicit Save As/cancellation when no export folder is usable.

This setting controls destination only: no Export Library handle or configuration
is serialized in backups or modified by restore. The three image-library settings
and Check Image Libraries remain independent. No schema/version bump is required;
backup contents and catalog records are unchanged. The new module is included in
the offline app shell.
