# Card Supply Catalog

## Architecture Guide
Version: 1.1

Status: Maintained

Last Updated: 2026-08-02

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
| `settings.js` | Image-library settings, setup status, and bulk owner changes |
| `storage.js` | IndexedDB persistence for paper packs, cards, colors, settings, base-data merging, deletion markers, and legacy localStorage migration |
| `backup.js` | User-triggered standard/iPad export and import |
| `cover-sheet.js` | Printable 6-by-6-inch cover-sheet generation |
| `detail.js` | Detail-panel dismissal behavior |
| `schema.js` | Catalog and backup schema versions |
| `pwa.js` | Service worker registration |
| `ui.js` | Shared UI helpers |
| `search.js` | Reserved boundary for future extraction of search/filter logic; current filtering remains in `library.js` |

# Data Storage
The application has three storage layers:

1. `data/paper-packs.json` and `data/colors.json` provide version-controlled base data.
2. IndexedDB stores writable paper packs, cards, deleted base-pack IDs, user-added colors, and settings. Saved paper-pack records are merged with base JSON at startup; cards are user-created records with no bundled base-data layer.
3. A user-selected image-library folder is the preferred durable location for image files on supported desktop browsers. Paper-pack records store relative `imagePath` values. Embedded data URLs in IndexedDB remain the compatibility fallback.

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

- Standard backup: includes catalog data, embedded fallback images, and relative references to folder-backed images. The image folder must be backed up separately.
- iPad backup: embeds compressed copies of accessible images so the catalog can be restored where folder access is unavailable.
- Import: validates the backup, warns before overwriting matching records, persists restored records to IndexedDB, and reports missing folder-image requirements.
- Destination: if the selected image-library folder is writable, export saves there; otherwise it uses a browser download.

# Error Handling
Never lose user data.
Validate before saving.
Recover gracefully.
Never leave an invalid or partially written catalog record in IndexedDB.

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
Do not create competing writable sources of truth. IndexedDB is authoritative for writable catalog records; an image-library folder is authoritative for folder-backed image files; exported JSON is a portable backup.
Never duplicate business logic across modules.
Prefer extending existing modules over creating unnecessary new ones.
