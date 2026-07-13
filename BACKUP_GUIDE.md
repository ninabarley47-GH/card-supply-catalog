# Backup Guide

Card Supply Catalog keeps your data under your control. A complete backup can include two pieces:

- a catalog backup JSON file
- the image library folder, if you use folder-backed image storage

## Backup Types

- Export Backup creates a compact catalog backup. Folder-backed images stay as image folder references, so the image folder must be backed up or shared separately.
- Export iPad Backup creates a larger self-contained backup with compressed images embedded in the JSON. Use this when an iPad user needs to see images without connecting an image folder.

## Export the Catalog

1. Open the app.
2. Go to Settings.
3. Choose Export Backup.
4. Save the downloaded JSON file somewhere outside the app.

The JSON backup includes catalog metadata such as paper packs, colors, tags, owners, release years, availability, and image references.

## Back Up Images

If your images are stored in the browser fallback, they are included in the JSON backup as embedded image data.

If you use an image library folder, the JSON backup stores relative `imagePath` references. The image files themselves stay in the selected folder and must be backed up separately.

To back up folder-backed images:

1. Find the image library folder you selected in Settings.
2. Copy the whole folder to your backup location.
3. Keep the folder structure intact.

Cloud-synced folders such as OneDrive, Dropbox, iCloud Drive, or Google Drive can work well as the image library folder, as long as the folder is also available locally on the computer using the app.

## Restore a Catalog

1. Open the app.
2. Go to Settings.
3. Choose Import Backup.
4. Select the backup JSON file.
5. If the backup uses folder-backed images, choose or reconnect the image library folder.
6. Run Check Image Library.

## Backup Routine

Export a fresh catalog backup after every cataloging session where you add or edit several packs.

Back up the image library folder whenever you add, replace, or migrate images.

## What to Keep Together

For a complete real-world backup, keep these together:

- `card-supply-catalog-backup-YYYY-MM-DD.json`
- the image library folder

The JSON file remembers the catalog. The image folder holds the actual image files.
