# Image Library Verification

Status: Required before folder-backed image storage is considered ready for real catalog data.

Use a Chromium-based desktop browser that supports folder selection.

## Folder Setup

1. Create or choose a test image library folder.
2. Open the app at the local development URL.
3. Go to Settings.
4. Choose the image library folder.
5. Confirm the Settings message says the image folder was selected.

## New Pack Save

1. Add a new paper pack with one or more image files.
2. Save the pack.
3. Confirm image files appear inside a pack folder in the selected image library folder.
4. Confirm the saved pack displays its images in the Library.
5. Export a backup.
6. Confirm the exported pack stores relative `imagePath` values, not embedded image data URLs.

## Reconnect

1. Reload the app.
2. If the browser asks for permission again, reconnect the same image library folder in Settings.
3. Run Check Image Library.
4. Confirm all folder-backed images are found.
5. Open a pack detail view and confirm images still display.

## Fallback Behavior

If the app cannot write to the selected folder, the pack should still save, but the user should see a warning that images were kept in fallback browser storage.

## Expected Result

The catalog JSON stores stable relative image paths. The actual image files live in the selected image library folder and can be backed up or synced separately.
