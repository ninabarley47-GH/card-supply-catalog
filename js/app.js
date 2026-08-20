import { initializeCardLibrary } from './cards.js';
import { initializeLibraryShell, setCardsForPaperPackDetails } from './library.js';
import { initializePwaInstall } from './pwa.js';
import { initializeVersionDisplay } from './version.js';

initializePwaInstall();
initializeVersionDisplay();

const { paperPacks } = await initializeLibraryShell();
const cards = await initializeCardLibrary({ paperPacks });
setCardsForPaperPackDetails(cards);
