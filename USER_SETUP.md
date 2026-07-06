# User Setup Guide

This guide is for someone using Card Supply Catalog for the first time.

## Recommended Browser

Use a Chromium-based desktop browser such as Chrome, Edge, or Brave.

The app can browse catalog data in other modern browsers, but choosing an image library folder depends on the File System Access API, which is mainly supported in Chromium desktop browsers.

## Open the App

Card Supply Catalog is a local-first web app. It should be opened from the shared app URL or from a local development server, not by double-clicking `index.html`.

During local development:

1. Start a local web server from the project folder.
2. Open the local URL in the browser.

On Windows:

1. Open the `card-supply-catalog` folder in File Explorer.
2. Click the address bar at the top of File Explorer.
3. Type `powershell` and press Enter.
4. In the PowerShell window, run:

```text
python -m http.server 8000
```

5. Leave that PowerShell window open while using the app.
6. Open this address in Chrome, Edge, or Brave:

```text
http://localhost:8000
```

If Windows opens the Microsoft Store instead of starting the server, install Python from python.org or ask the person who shared the app to help set up the local server.

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

## Important Habits

- Export a backup after cataloging sessions.
- Back up or sync the image library folder separately.
- Keep the catalog backup JSON and image folder together.
- Reconnect the image folder if the browser asks for permission again.

## Current Limitations

- The app is focused on Designer Series Paper.
- Folder-backed image storage requires a supported desktop browser.
- Folder-backed images are not embedded in the JSON backup.
- Each user must have access to the same image folder if sharing catalog data.
