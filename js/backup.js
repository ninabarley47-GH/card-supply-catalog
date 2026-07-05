const BACKUP_SCHEMA_VERSION = 1;

export function initializeCatalogBackup({ paperPacks, colorsById }) {
  const exportButton = document.querySelector("[data-export-catalog]");
  const message = document.querySelector("[data-backup-message]");

  if (!exportButton) {
    return;
  }

  exportButton.addEventListener("click", () => {
    try {
      const backup = createCatalogBackup({
        paperPacks,
        colorsById
      });

      downloadJsonBackup(backup);
      renderBackupMessage(message, "Catalog backup downloaded.", "success");
    } catch (error) {
      renderBackupMessage(message, "The catalog backup could not be created.", "error");
    }
  });
}

function createCatalogBackup({ paperPacks, colorsById }) {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    app: "card-supply-catalog",
    exportedAt: new Date().toISOString(),
    imageStorage: {
      strategy: "embedded-indexed-db",
      note: "Prototype backup includes embedded image data when present. Future backups should support local image folder references."
    },
    colors: sortObjectByKey(colorsById),
    paperPacks: paperPacks.map(cloneJsonSafe)
  };
}

function downloadJsonBackup(backup) {
  const backupJson = JSON.stringify(backup, null, 2);
  const blob = new Blob([backupJson], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `card-supply-catalog-backup-${formatDateStamp(new Date())}.json`;
  link.click();

  URL.revokeObjectURL(url);
}

function sortObjectByKey(valueByKey) {
  return Object.fromEntries(
    Object.entries(valueByKey)
      .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
      .map(([key, value]) => [key, cloneJsonSafe(value)])
  );
}

function cloneJsonSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function formatDateStamp(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function renderBackupMessage(message, text, tone) {
  if (!message) {
    return;
  }

  message.textContent = text;
  message.dataset.tone = tone;
}
