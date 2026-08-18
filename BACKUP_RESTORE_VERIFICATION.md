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
   - tags are correct
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

Folder-backed image files are not embedded in the standard JSON backup. The Paper and Card image folders must be backed up or shared separately. The iPad backup embeds accessible Paper and Card images.

## Import Mode Verification

1. With existing test paper packs and Cards present, import a backup with replacement unchecked.
2. Confirm matching paper-pack and Card IDs are skipped, missing IDs are added, and current matching records remain unchanged.
3. Import the same backup with **Replace existing catalog entries during import** checked and approve the confirmation.
4. Confirm matching paper-pack and Card IDs now contain the backup values, missing IDs are added, and records absent from the backup remain unchanged.
5. Confirm the restore summary reports imported and skipped paper packs, colors, and Cards accurately.

# Atomic Failure Verification
## If validation, preparation, or any database write fails, the transaction is aborted and the existing catalog remains unchanged.

Use only a disposable test profile for this check.

1. Record the current paper-pack, color, and Card counts and the values of several recognizable records.
2. Make a copy of a valid backup and deliberately invalidate one Card, such as changing `size.width` from a number to text.
3. Import the invalid backup.
4. Confirm the restore reports that nothing was imported.
5. Confirm all original counts and recognizable record values are unchanged.
6. Repeat with a duplicate paper-pack ID or a color object whose key does not match its `id`.
7. Import the original valid backup and confirm the complete selected import succeeds.
