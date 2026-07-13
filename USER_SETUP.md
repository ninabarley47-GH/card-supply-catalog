# User Setup Guide

This guide is for someone using Card Supply Catalog for the first time.

## Recommended Browser

For iPad, use Safari and install the shared app URL on the Home Screen.

For desktop setup and image-folder management, use a Chromium-based browser such as Chrome, Edge, or Brave.

The app can browse catalog data in other modern browsers, but choosing an image library folder depends on the File System Access API, which is mainly supported in Chromium desktop browsers.

## Install on iPad

Use the public app URL, not the GitHub repository page.

App URL:

```text
https://ninabarley47-gh.github.io/card-supply-catalog/
```

Do not open `github.com/ninabarley47-GH/card-supply-catalog` for normal use. That is the source-code page and may ask for a GitHub login.

1. Open the app URL in Safari.
2. Tap the Share button. In Safari this is the square icon with an up arrow, usually in the top or bottom toolbar.
3. Tap Add to Home Screen.
4. Keep the suggested name or rename it to Card Catalog.
5. Tap Add.
6. Open Card Catalog from the iPad Home Screen.

The Home Screen app opens without needing Python, GitHub, or a local server.

If the iPad asks you to sign into GitHub, you are probably on the GitHub repository page instead of the app URL, or the GitHub Pages deployment is not public yet.

## Open the App on Desktop

Card Supply Catalog is a local-first web app. It should be opened from the shared app URL or from a local development server, not by double-clicking `index.html`.

For normal use, open the shared app URL in Chrome, Edge, Brave, or Safari.

During local development only:

1. Start a local web server from the project folder.
2. Open the local URL in the browser.

On Windows:

1. Open the `card-supply-catalog` folder in File Explorer.
2. Click the address bar at the top of File Explorer.
3. Type `powershell` and press Enter.
4. In the PowerShell window, confirm the prompt ends with `card-supply-catalog>`.
5. Check whether Python is already installed:

```type:
python --version
```

If PowerShell shows a Python version, start the local server:

```type:
python -m http.server 8000
```

If Windows opens the Microsoft Store instead, install Python:

1. In the Microsoft Store, choose Get or Install.
2. After Python installs, close PowerShell.
3. Open PowerShell from the `card-supply-catalog` folder again.
4. Run:

```type:
python --version
```

5. If it shows a Python version, start the local server:

```type:
python -m http.server 8000
```

6. Leave that PowerShell window open while using the app.
7. Open this address in Chrome, Edge, or Brave:

```type:
http://localhost:8000
```

If Python still does not work after installing it, ask the person who shared the app to help set up the local server.

## First-Time Setup

1. Open the app.
2. Go to Settings.
3. Choose an image library folder if you want images stored as normal files.
4. Add or import paper packs.
5. Export a backup after the first cataloging session.

## Shared Image Folder

For multiple people, use a folder that each person can access locally on their own computer.

A practical setup is:

1. Create a folder inside OneDrive, Dropbox, iCloud Drive, or Google Drive.
2. Share that folder with the other users.
3. Make sure each user syncs the folder locally.
4. Each user chooses or reconnects that local folder in Settings.

The app reads and writes normal local files. The cloud service handles syncing in the background.

## Moving to Another Computer

To move or restore the catalog:

1. Open the app on the new computer.
2. Import the catalog backup JSON.
3. Choose or reconnect the image library folder.
4. Run Check Image Library in Settings.

## Sharing With an iPad User

Use the iPad backup when the other person needs to see images without connecting a local image folder.

On the computer that has access to the image folder:

1. Open the app.
2. Go to Settings.
3. Choose or reconnect the image library folder.
4. Run Check Image Library and resolve missing images if needed.
5. Choose Export iPad Backup.
6. Share the downloaded JSON file with the iPad user.

On the iPad:

1. Open Card Catalog from the Home Screen.
2. Go to Settings.
3. Choose Import Backup.
4. Select the iPad backup JSON.

The iPad backup embeds compressed images directly in the backup file. It is larger than the normal catalog backup, but it does not need access to the shared image folder.

## Important Habits

- Export a backup after cataloging sessions.
- Use Export iPad Backup when sharing a self-contained catalog with an iPad user.
- Back up or sync the image library folder separately.
- Keep the catalog backup JSON and image folder together.
- Reconnect the image folder if the browser asks for permission again.

## Current Limitations

- The app is focused on Designer Series Paper.
- Folder-backed image storage requires a supported desktop browser.
- iPad is best for browsing, searching, viewing colors, and using imported catalog data.
- Full image-folder setup and folder-backed image migration should be done from a supported desktop browser.
- Folder-backed images are not embedded in the JSON backup.
- Each user must have access to the same image folder if sharing catalog data.
