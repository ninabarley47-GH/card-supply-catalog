import { loadCatalogSetting, saveCatalogSetting, loadOwners } from './storage.js';
import { supportsDirectoryPicker } from './browser-capabilities.js';
import { hasDirectoryPermission, fileExists, writeFile } from './image-references.js';

export const EXPORT_LIBRARY_SETTING_ID = 'exportLibrary';

export async function chooseExportDirectory(environment = globalThis, services = {}) {
  if (!supportsDirectoryPicker(environment)) return null;
  const directoryHandle = await environment.showDirectoryPicker({ id: 'csc-export-library', mode: 'readwrite' });
  await (services.saveCatalogSetting || saveCatalogSetting)(EXPORT_LIBRARY_SETTING_ID, {
    strategy: 'local-folder', directoryHandle, selectedAt: new Date().toISOString()
  });
  return directoryHandle;
}

export async function loadWritableExportDirectory(environment = globalThis, services = {}) {
  if (!supportsDirectoryPicker(environment)) return null;
  try {
    const setting = await (services.loadCatalogSetting || loadCatalogSetting)(EXPORT_LIBRARY_SETTING_ID);
    return await hasDirectoryPermission(setting?.directoryHandle, 'readwrite', true) ? setting.directoryHandle : null;
  } catch {
    return null;
  }
}

let exportWriteQueue = Promise.resolve();

export function createExportFileName(label, extension, services = {}) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(services.now?.() || new Date()).map(({ type, value }) => [type, value]));
  const timestamp = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}-${parts.minute}-${parts.second}-PT`;
  const safeLabel = String(label).replace(/[^a-zA-Z0-9_-]+/g, '-');
  const safeExtension = String(extension).replace(/[^a-zA-Z0-9]/g, '');
  const ownerName = String(services.ownerName || '').trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, '-').replace(/^[. -]+|[. -]+$/g, '');
  return `${ownerName ? `${ownerName}-` : ''}CSC-${safeLabel}-${timestamp}.${safeExtension}`;
}

// Serialize exports in this page so same-second writes cannot race each other.
export function saveExportFile(...args) {
  const saved = exportWriteQueue.then(() => performExportSave(...args));
  exportWriteQueue = saved.catch(() => {});
  return saved;
}

async function performExportSave(blob, { label = 'backup', extension = 'json', directoryHandle = null } = {}, services = {}) {
  if (!blob?.size) throw new Error('The generated export file is empty.');
  let ownerName = '';
  try {
    const ownerId = await (services.loadCatalogSetting || loadCatalogSetting)('defaultOwnerId');
    if (ownerId) {
      const owners = await (services.loadOwners || loadOwners)();
      ownerName = owners.find((owner) => owner.id === ownerId)?.name || '';
    }
  } catch { /* A missing device setting must not prevent export. */ }
  let fileName = createExportFileName(label, extension, { ...services, ownerName });
  if (directoryHandle) {
    try {
      const dot = fileName.lastIndexOf('.');
      const base = fileName.slice(0, dot), suffix = fileName.slice(dot);
      let collision = 2;
      while (await fileExists(directoryHandle, fileName)) fileName = `${base}-${collision++}${suffix}`;
      // Shared writer checks again and refuses to overwrite an existing entry.
      await writeFile(directoryHandle, fileName, blob);
      return { savedToFolder: true, folderName: directoryHandle.name, fileName, fileSize: blob.size };
    } catch {
      // Preserve the generated Blob even if lookup, permission, write, or close fails.
      // Do not delete partial new exports or any other user-controlled files.
    }
  }
  await (services.download || downloadExportFile)(blob, fileName);
  return { savedToFolder: false, folderName: '', fileName, fileSize: blob.size };
}

export function downloadExportFile(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Safari may still be reading the object URL after the click handler returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
