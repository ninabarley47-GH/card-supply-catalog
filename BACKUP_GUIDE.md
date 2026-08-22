# Backup Guide

Card Supply Catalog keeps your data under your control. A complete backup can include three pieces:

- a catalog backup JSON file
- the Paper image library folder, if you use folder-backed Paper images
- the Card image library folder, if you use folder-backed Card images

## Backup Types

- Export Backup creates a compact catalog backup. Folder-backed images stay as image folder references, so the image folder must be backed up or shared separately.
- Export Compact iPad Backup creates a self-contained backup with iPad-sized compressed images embedded in the JSON. Use this when an iPad user needs to see images without connecting an image folder.

## Export the Catalog

1. Open the app.
2. Go to Settings.
3. Choose Export Backup.
4. If an image library folder is selected, confirm the JSON file appears there. Otherwise, save the downloaded JSON file somewhere safe.

The JSON backup includes paper packs, Cards, colors, tags, owners, release years, availability, and image references.

## Back Up Images

If your images are stored in the browser fallback, they are included in the JSON backup as embedded image data.

If you use Paper or Card image library folders, the JSON backup stores relative `imagePath` references. The image files themselves stay in the selected folders and must be backed up separately.

To back up folder-backed images, repeat these steps for both configured image folders:

1. Find the Paper or Card image library folder you selected in Settings.
2. Copy the whole folder to your backup location.
3. Keep the folder structure intact.

Cloud-synced folders such as OneDrive, Dropbox, iCloud Drive, or Google Drive can work well as the image library folder, as long as the folder is also available locally on the computer using the app.

## Restore a Catalog

1. Open the app.
2. Go to Settings.
3. Choose Import Backup.
4. Select the backup JSON file.
5. If the backup uses folder-backed images, choose or reconnect the Paper and Card image library folders.
6. Run Check Image Library for the Paper library and confirm Card images display.

## Import Modes

- Incremental import is the default. It adds paper packs, colors, and Cards whose IDs are not already present and skips matching IDs.
- Overlay import is enabled with **Replace existing catalog entries during import**. It replaces matching IDs with the backup versions and also adds missing IDs. Existing records absent from the backup remain untouched.

Paper packs and Cards use the same ID-based rules. Two Cards that look alike but have different IDs are distinct records and are retained in either mode.

## Backup Routine

Export a fresh catalog backup after every cataloging session where you add or edit several paper packs or Cards.

Back up the Paper and Card image library folders whenever you add, replace, or migrate images.

## What to Keep Together

For a complete real-world backup, keep these together:

- `card-supply-catalog-backup-YYYY-MM-DD.json`
- the Paper image library folder
- the Card image library folder

The JSON file remembers the catalog. The image folders hold the actual image files.
