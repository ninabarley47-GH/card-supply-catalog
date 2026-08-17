import { initializeCardLibrary } from './cards.js';
import { initializeLibraryShell } from './library.js';
import { initializePwaInstall } from './pwa.js';
import { initializeVersionDisplay } from './version.js';

initializePwaInstall();
initializeVersionDisplay();

const { paperPacks } = await initializeLibraryShell();
await initializeCardLibrary({ paperPacks });
