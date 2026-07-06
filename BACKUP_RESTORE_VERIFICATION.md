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

Folder-backed image files are not embedded in the JSON backup. The image folder must be backed up or shared separately.
