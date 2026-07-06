# Product Backlog

## Discovery

### Similar Packs Based on Multiple Attributes

Instead of only color:

- shared colors
- shared tags
- same collection
- same designer

---

## Cataloging

### Auto-fill Previous Values

Consider remembering:

- Owner
- Release Year
- Status

to speed repetitive data entry.

### Follow-up: Multi-tag search/filter
Status: Backlog

Current behavior:
- The search bar uses free-text search across fields.
- Tags are searchable as text, but there is no dedicated multi-tag filter yet.

Desired behavior:
- User can select more than one tag.
- Catalog shows packs matching the selected tag logic.
- Decide whether multi-tag matching means:
  - AND: pack must have all selected tags
  - OR: pack can have any selected tag

Initial recommendation:
- Use AND logic first, because it helps narrow results.
- Add a visible selected-tag list with a way to remove individual tags.

---

# Technical Backlog

## Ownership Model

### Separate Paper Packs from Ownership

**Status:** Future Investigation

### Background

Initially, supporting multiple owners could be accomplished by duplicating paper pack records and assigning a different owner to each copy.

After discussion, this approach was rejected because it would duplicate shared metadata and create unnecessary maintenance. Updates to colors, tags, images, or other shared information would need to be made in multiple places.

### Proposed Direction

Treat the paper pack as a single shared entity.

Store owner-specific information separately.

Shared paper pack data would include:

- Name
- Images
- Colors
- Tags
- Release information
- Pattern count

Owner-specific data would include:

- Owner
- Inventory status (Available / Used Up)
- Favorite
- Personal notes
- Storage location
- Other user-specific metadata

### Benefits

- One authoritative record for each DSP.
- Eliminates duplicate maintenance.
- Allows multiple owners to share the same paper pack definition.
- Supports future filtering by owner without duplicating packs.

### Notes

Current implementation continues to use a single owner per paper pack. This item should only be revisited if multiple-owner support becomes a project goal.

## Image Storage

### Durable Local Image Storage
Current prototype uses IndexedDB.

Future version should evaluate storing images as local files with database references.

Verification checklist: `IMAGE_LIBRARY_VERIFICATION.md`

Reason:
- Better scalability
- Easier backup
- Less database bloat

### Backup / Restore Verification Checklist
Status: Required before backup/import is considered complete.

Canonical checklist: `BACKUP_RESTORE_VERIFICATION.md`

Use a test browser profile or a browser where app data can be safely cleared.

Round-trip restore steps:

1. Start with known sample catalog data.
2. Export a backup.
3. Save a copy of the export file outside the app.
4. Clear the app data in the test browser/profile.
5. Import the backup.
6. Confirm all restored catalog data:
   - all packs return
   - pack names are correct
   - colors are correct
   - tags are correct
   - owners are correct
   - release years are correct
   - notes/status fields return
   - images return if embedded image export was selected
   - folder-backed image references return as relative `imagePath` values
   - folder-backed images display after the image library folder is reconnected
7. Confirm restored app behavior:
   - search still works
   - tag filters still work
   - color matching/similar packs still works
   - detail view opens correctly
8. Re-export after restore.
9. Compare the restored export with the original export.

Expected result:
- The second export should preserve the same catalog content as the original export.
- Differences should be limited to expected metadata such as export timestamp.
- Folder-backed image files are not embedded in the JSON backup; the image folder must be backed up or shared separately.

---
