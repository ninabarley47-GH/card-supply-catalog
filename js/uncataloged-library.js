import { getProductNameKey } from './tag-utils.js';

export function normalizeUncatalogedPath(value) {
  return String(value || '').replace(/\\/g, '/').split('/').filter(Boolean).join('/').toLocaleLowerCase();
}

export function findUncatalogedCardImages(entries, cards = []) {
  const catalogedPaths = new Set(cards
    .filter(card => card?.imageLibrary === 'card-images' && card.imagePath)
    .map(card => normalizeUncatalogedPath(card.imagePath)));
  return entries.filter(entry => !catalogedPaths.has(normalizeUncatalogedPath(entry.path)));
}

export function isCardImagePathCataloged(cards = [], path = '') {
  const target = normalizeUncatalogedPath(path);
  return Boolean(target) && cards.some(card => card?.imageLibrary === 'card-images' &&
    normalizeUncatalogedPath(card.imagePath) === target);
}

export function findUncatalogedStampItems(items, sets = []) {
  return classifyStampImageItems(items, sets).filter(item => !item.matchedSet);
}

export function findStampImagesForExistingSets(items, sets = []) {
  return classifyStampImageItems(items, sets).filter(item => item.matchedSet);
}

export function classifyStampImageItems(items, sets = []) {
  const catalogKeys = new Set(sets.flatMap(set => [set?.id, set?.name].filter(Boolean).map(normalizeStampName)));
  const catalogedImagePaths = new Set(sets.flatMap(set => set?.imageRefs || [])
    .filter(reference => reference?.imageLibrary === 'stamp-die-images' && reference.imagePath)
    .map(reference => normalizeUncatalogedPath(reference.imagePath)));
  return items.flatMap(item => {
    const matchedSet = sets.find(set => normalizeProductStampName(set?.name) === normalizeProductStampName(item.name));
    const identityMatchesCatalog = catalogKeys.has(normalizeStampName(item.id)) || catalogKeys.has(normalizeStampName(item.name));
    const imagePaths = item.imagePaths || [];
    const unassociatedImagePaths = imagePaths.filter(path => !catalogedImagePaths.has(normalizeUncatalogedPath(path)));
    if (matchedSet) {
      if (!unassociatedImagePaths.length) return [];
      return [{ ...item, imagePaths: unassociatedImagePaths, imageCount: unassociatedImagePaths.length, matchedSet }];
    }
    if (identityMatchesCatalog || imagePaths.some(path => catalogedImagePaths.has(normalizeUncatalogedPath(path)))) return [];
    return [item];
  });
}

export async function openUncatalogedItemAddWorkflow(addButton, panel, prepare = null) {
  if (!addButton) return false;
  panel.hidden = true;
  if (prepare && await prepare() === false) return false;
  addButton.click();
  return true;
}

export async function scanImageTree(directory, path = '', isSupportedImage = isCatalogImageFile) {
  const files = [];
  for await (const [name, handle] of directory.entries()) {
    const relativePath = path ? `${path}/${name}` : name;
    if (handle.kind === 'directory') files.push(...await scanImageTree(handle, relativePath, isSupportedImage));
    else if (isSupportedImage(name)) files.push({ name, path: relativePath });
  }
  return files;
}

function isCatalogImageFile(name) {
  return /\.(?:jpe?g|png|webp|gif)$/i.test(name) && !/\.thumb\.jpe?g$/i.test(name);
}

export function groupStampImageEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const parts = entry.path.split('/');
    const key = parts.length > 1
      ? parts[0]
      : entry.name.replace(/\.[^.]+$/, '').replace(/[\s_-]+(?:stamps?|dies?|masks?)$/i, '').trim();
    if (!key) continue;
    const id = normalizeStampName(key);
    if (!groups.has(id)) groups.set(id, { id, name: key, imageCount: 0, imagePaths: [] });
    groups.get(id).imageCount++;
    groups.get(id).imagePaths.push(entry.path);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

function normalizeStampName(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeProductStampName(value) {
  return normalizeStampName(getProductNameKey(value));
}

export function attachUncatalogedLibraryFinder({ screen, button, title, scan, addButton, addLabel, onAddItem, associateLabel, onAssociateItem, refreshEvent }) {
  if (!screen || !button) return;
  const panel = document.createElement('section');
  panel.className = 'uncataloged-packs';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', `${button.dataset.findUncatalogedSets ? 'uncataloged-sets' : 'uncataloged-cards'}-title`);
  const heading = document.createElement('h3');
  heading.id = button.dataset.findUncatalogedSets ? 'uncataloged-sets-title' : 'uncataloged-cards-title';
  heading.textContent = `Uncataloged ${title}`;
  const close = document.createElement('button');
  close.className = 'detail-close'; close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', `Close uncataloged ${title.toLowerCase()}`);
  const header = document.createElement('div'); header.className = 'uncataloged-packs-header'; header.append(heading, close);
  const message = document.createElement('p'); message.className = 'settings-message'; message.setAttribute('aria-live', 'polite');
  const list = document.createElement('ul'); list.className = 'uncataloged-pack-list';
  panel.append(header, message, list);
  screen.insertBefore(panel, screen.querySelector('.library-section, .color-reference-controls'));
  let hasScanned = false;
  async function refreshResults() {
    try {
      const result = await scan();
      hasScanned = true;
      if (!result.ok) { message.textContent = result.message; message.dataset.tone = 'error'; list.replaceChildren(); return; }
      const items = result.items;
      message.textContent = items.length ? `${items.length} uncataloged ${title.toLowerCase()} found.` : `Every ${title.toLowerCase()} image is already cataloged, or the source is empty.`;
      message.dataset.tone = items.length ? 'success' : '';
      list.replaceChildren(...items.map(item => {
        const row = document.createElement('li'); row.className = 'uncataloged-pack-item';
        const details = document.createElement('div'); details.className = 'uncataloged-pack-details';
        const name = document.createElement('strong'); name.textContent = item.name;
        const count = document.createElement('span'); count.textContent = `${item.imageCount ?? 1} image${(item.imageCount ?? 1) === 1 ? '' : 's'}${item.path ? ` · ${item.path}` : ''}`;
        details.append(name, count); row.append(details);
        if (item.matchedSet && associateLabel && onAssociateItem) {
          const actions = document.createElement('div'); actions.className = 'uncataloged-pack-actions';
          const associate = document.createElement('button'); associate.className = 'button button-primary'; associate.type = 'button';
          associate.textContent = typeof associateLabel === 'function' ? associateLabel(item) : associateLabel;
          associate.addEventListener('click', async () => {
            associate.disabled = true;
            panel.hidden = true;
            try {
              const associated = await onAssociateItem(item);
              if (!associated) { panel.hidden = false; await refreshResults(); }
            } catch {
              panel.hidden = false;
              message.textContent = `The ${title.toLowerCase()} images could not be associated with the existing Set.`;
              message.dataset.tone = 'error';
            } finally { associate.disabled = false; }
          });
          actions.append(associate); row.append(actions);
        } else if (addButton && addLabel) {
          const actions = document.createElement('div'); actions.className = 'uncataloged-pack-actions';
          const addItem = document.createElement('button'); addItem.className = 'button button-primary'; addItem.type = 'button'; addItem.textContent = addLabel;
          addItem.addEventListener('click', async () => {
            addItem.disabled = true;
            try {
              const opened = await openUncatalogedItemAddWorkflow(addButton, panel, () => onAddItem?.(item));
              if (!opened) await refreshResults();
            } catch {
              panel.hidden = false;
              message.textContent = `The ${title.toLowerCase()} item could not be checked against the latest catalog.`;
              message.dataset.tone = 'error';
            } finally { addItem.disabled = false; }
          });
          actions.append(addItem); row.append(actions);
        }
        return row;
      }));
    } catch { hasScanned = true; message.textContent = `The ${title.toLowerCase()} image library could not be scanned.`; message.dataset.tone = 'error'; list.replaceChildren(); }
  }
  button.addEventListener('click', async () => {
    panel.hidden = false; button.disabled = true; list.replaceChildren(); message.textContent = 'Scanning the image library...';
    try { await refreshResults(); } finally { button.disabled = false; }
  });
  for (const eventName of Array.isArray(refreshEvent) ? refreshEvent : [refreshEvent]) {
    if (eventName) document.addEventListener(eventName, () => { if (hasScanned) refreshResults(); });
  }
  close.addEventListener('click', () => { panel.hidden = true; button.focus(); });
}
