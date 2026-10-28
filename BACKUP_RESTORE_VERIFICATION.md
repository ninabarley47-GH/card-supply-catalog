# Backup / Restore Verification

Status: Required before backup/import is considered ready for real catalog data.

Use a test browser profile or a browser where app data can be safely cleared.

## Round Trip

1. Start with known sample catalog data.
2. Open the app at the local development URL.
3. Go to Settings.
4. Export a backup.
5. Save a copy of the export file outside the app.
6. Clear the app data in the test browser/profile.
7. Reload the app.
8. Import the backup.
9. Confirm all restored catalog data:
   - all packs return
   - pack names are correct
   - colors are correct
   - Paper Pack, Card, and Stamp & Die Set tag assignments are correct
   - category memberships are correct
   - Tool Tags retain their IDs, type, custom filename terms, and explicit `true` and `false` fallback settings
   - owners are correct
   - release years are correct
   - notes/status fields return
   - embedded images return if the backup includes embedded image data
   - folder-backed image references return as relative `imagePath` values
   - folder-backed images display after the image library folder is reconnected
   - all Cards return
   - Card dates, sizes, favorites, tags, stamp sets, paper-pack links, and color links are correct
   - embedded Card images return when the backup includes embedded image data
   - folder-backed Card image references return and display after the Card image folder is reconnected
   - all Stamp & Die Sets return with their names, owners, release years, favorites, and tag assignments
   - embedded Stamp & Die images return when present; folder-backed image references display after the Stamp & Die image folder is reconnected
10. Confirm restored app behavior:
    - search still works
    - tag filters still work
    - color matching/similar packs still works
    - detail view opens correctly
11. Re-export after restore.
12. Compare the restored export with the original export.

## Expected Result

The second export should preserve the same catalog content as the original export.

Expected differences:

- `exportedAt`
- future verification metadata, if added later

Folder-backed image files are not embedded in the standard JSON backup. The Paper,
Card, and Stamp & Die image folders must be backed up or shared separately. The
compact iPad backup embeds accessible images from all three libraries.

## Import Mode Verification

1. With sample Paper Packs, Cards, and Stamp & Die Sets present, import a backup with replacement unchecked.
2. Confirm matching IDs are skipped, missing IDs are added, and current matching records remain unchanged.
3. Import the same backup with **Replace existing catalog entries during import** checked and approve the confirmation.
4. Confirm matching IDs now contain the backup values, missing IDs are added, and records absent from the backup remain unchanged.
5. Confirm the restore summary reports imported and skipped Paper Packs, colors, Cards, and Stamp & Die Sets accurately.

## Tag Configuration Conflict

Use only a disposable test profile with sample records. Keep a copy of the valid
backup, then edit the copy so a tag that matches a local tag has a different Tool
Tag setting. For example, change its `filenameTerms` while keeping the tag ID.
Import the edited backup with replacement unchecked. Confirm the summary names the
tag, says how it matched, and shows the local and backup settings. Confirm that no
catalog or item values changed. Repeat with replacement checked and verify that
the backup's tag configuration is used.

## Atomic Failure Verification

If validation, preparation, or any database write fails, the transaction is
aborted and the existing catalog remains unchanged.

Use only a disposable test profile for this check.

1. Record the current Paper Pack, color, Card, Stamp & Die Set, tag, and Owner counts, plus a few recognizable values.
2. Make a copy of a valid backup and deliberately invalidate one Card, such as changing `size.width` from a number to text.
3. Import the invalid backup.
4. Confirm the restore reports that nothing was imported.
5. Confirm all original counts and recognizable record values are unchanged.
6. Repeat with a duplicate paper-pack ID or a color object whose key does not match its `id`.
7. Import the original valid backup and confirm the complete selected import succeeds.
