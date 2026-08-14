# Cards

## Purpose

Provide a searchable gallery of finished cards linked to DSP packs.

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