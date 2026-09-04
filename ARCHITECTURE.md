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

# Data Storage
The application has three storage layers:

1. `data/paper-packs.json` and `data/colors.json` provide version-controlled base data.
2. IndexedDB stores writable paper packs, cards, deleted base-pack IDs, user-added colors, and settings. Saved paper-pack records are merged with base JSON at startup; cards are user-created records with no bundled base-data layer.
3. User-selected Paper and Card image-library folders are the preferred durable locations for image files on supported desktop browsers. Records store paths relative to their applicable folder. New Cards reference images already inside the separate Card folder without copying; images selected elsewhere are copied into its root. A sibling `.thumb.jpg` is created in either case. Legacy Card paths without an image-library marker continue resolving from the Paper image folder. Embedded data URLs in IndexedDB remain the compatibility fallback.

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
keywords
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

- Standard backup: includes paper packs, Cards, colors, the versioned global tag catalog, `tagIds` assignments, embedded fallback images, and relative references to folder-backed Paper and Card images. The image folders must be backed up separately.
- iPad backup: includes the same global tag catalog and `tagIds` assignments while embedding compressed copies of accessible Paper and Card images so the catalog can be restored where folder access is unavailable.
- Import: validates and reconciles the complete taxonomy and all catalog records in memory before writing; then persists the global catalog and selected Paper/Card records in one IndexedDB transaction. Any unresolved identity conflict, validation, preparation, or transaction failure leaves IndexedDB and in-memory catalog state unchanged. Legacy name-based backups remain importable through the approved conversion rules.
- Destination: if the selected image-library folder is writable, export saves there; otherwise it uses a browser download.

## Schema Version Boundaries

Catalog-record schema and backup-envelope schema are versioned independently in `js/schema.js` because they protect different compatibility boundaries.

- `CATALOG_SCHEMA_VERSION` describes the structure and interpretation of catalog records such as Paper Packs, Cards, and colors. Increment it when persisted record fields, allowed values, validation, or record migration behavior changes.
- `BACKUP_SCHEMA_VERSION` describes the top-level backup envelope: its identifying fields, collection layout, image-storage metadata, and import contract. Increment it only when that envelope structure or its interpretation changes incompatibly.

The Card Status change raised the catalog schema to version 3. Cards now persist `status` as either `available` or `sent`; legacy Cards without a status are normalized to `available` when loaded or imported. Exported records carry catalog schema version 3, and exported backup envelopes declare `catalogSchemaVersion: 3`.

Phase B2 raises the backup envelope to version 3. Version-3 Standard and Compact iPad exports contain one `tagCatalog` object (`schemaVersion`, `tags`, and `categories`), and Paper/Card records contain only `tagIds`. Version-1/2 backups with optional `tagVocabularies` and legacy `keywords`/`tags` remain importable through in-memory conversion and reconciliation. The record catalog schema remains version 3.

Paper and Card Add/Edit forms select global tags by stable ID through the shared category-aware picker and persist canonical `tagIds`. Temporary runtime `keywords` and `tags` name projections remain available for Library detail and filtering compatibility until those consumers migrate; they are not authoritative picker state or persisted fields.

Every global tag is assignable to Paper Packs, Cards, and Stamp Sets. Assignment validation checks that each `tagId` identifies a real tag and never a category; it does not filter by product type. The legacy `appliesTo` field is optional, deprecated compatibility metadata. Existing catalogs and backups may retain and round-trip it, but current selection, search, validation, legacy fallback resolution, and runtime projections ignore it. Newly created tags omit it without changing the catalog or backup schema version.

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
