import { initializeCardLibrary } from './cards.js';
import { initializeLibraryShell } from './library.js';
import { initializePwaInstall } from './pwa.js';
import { initializeVersionDisplay } from './version.js';

initializeLibraryShell();
initializePwaInstall();
initializeCardLibrary();
initializeVersionDisplay();
