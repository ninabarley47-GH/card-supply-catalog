import { migrateLegacyCardStampSets } from './storage.js';
import { initializeStampDieLibrary } from './stamp-die-library.js';
import { initializeCardLibrary } from './cards.js';
import { initializeLibraryShell, setCardsForPaperPackDetails } from './library.js';
import { initializePwaInstall } from './pwa.js';
import { initializeVersionDisplay } from './version.js';

initializePwaInstall();
initializeVersionDisplay();

const { paperPacks, owners } = await initializeLibraryShell();
try {
  await migrateLegacyCardStampSets();
} catch {
  window.alert('Legacy Stamp Set names could not be converted. Existing Card data was kept; reload to retry.');
}
const cards = await initializeCardLibrary({ paperPacks, owners });
setCardsForPaperPackDetails(cards);

await initializeStampDieLibrary({ owners, cards });
