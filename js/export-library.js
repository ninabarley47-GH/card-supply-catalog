import { loadCatalogSetting, saveCatalogSetting } from './storage.js';
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

let fallbackSequence = 0;

export function createExportFileName(label, extension, services = {}) {
  const timestamp = (services.now?.() || new Date()).toISOString().replace(/[:.]/g, '-');
  let token;
  try { token = (services.randomUUID || (() => globalThis.crypto?.randomUUID?.()))(); } catch { /* Use a compatible filename suffix below. */ }
  token ||= `${Date.now().toString(36)}-${(++fallbackSequence).toString(36)}-${Math.random().toString(36).slice(2)}`;
  const safeLabel = String(label).replace(/[^a-zA-Z0-9_-]+/g, '-');
  const safeExtension = String(extension).replace(/[^a-zA-Z0-9]/g, '');
  return `card-supply-catalog-${safeLabel}-${timestamp}-${token}.${safeExtension}`;
}

export async function saveExportFile(blob, { label = 'backup', extension = 'json', directoryHandle = null } = {}, services = {}) {
  if (!blob?.size) throw new Error('The generated export file is empty.');
  let fileName = createExportFileName(label, extension, services);
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
