import { loadCatalogSetting, saveCatalogSetting } from './storage.js';
import { supportsDirectoryPicker } from './browser-capabilities.js';
import { hasDirectoryPermission } from './image-references.js';

export const COVER_SHEET_FOLDER_SETTING_ID = 'coverSheetFolder';

export async function chooseCoverSheetDirectory(environment = globalThis, services = {}) {
  if (!supportsDirectoryPicker(environment)) return null;
  const directoryHandle = await environment.showDirectoryPicker({ id: 'csc-cover-sheets', mode: 'readwrite' });
  await (services.saveCatalogSetting || saveCatalogSetting)(COVER_SHEET_FOLDER_SETTING_ID, {
    strategy: 'local-folder', directoryHandle, selectedAt: new Date().toISOString()
  });
  return directoryHandle;
}

export async function loadWritableCoverSheetDirectory(environment = globalThis, services = {}) {
  if (!supportsDirectoryPicker(environment)) return null;
  try {
    const setting = await (services.loadCatalogSetting || loadCatalogSetting)(COVER_SHEET_FOLDER_SETTING_ID);
    return await hasDirectoryPermission(setting?.directoryHandle, 'readwrite', true) ? setting.directoryHandle : null;
  } catch {
    return null;
  }
}
