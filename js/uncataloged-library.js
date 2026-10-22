export function normalizeUncatalogedPath(value) {
  return String(value || '').replace(/\\/g, '/').split('/').filter(Boolean).join('/').toLocaleLowerCase();
}

export function findUncatalogedCardImages(entries, cards = []) {
  const catalogedPaths = new Set(cards
    .filter(card => card?.imageLibrary === 'card-images' && card.imagePath)
    .map(card => normalizeUncatalogedPath(card.imagePath)));
  return entries.filter(entry => !catalogedPaths.has(normalizeUncatalogedPath(entry.path)));
}

export function findUncatalogedStampItems(items, sets = []) {
  const catalogKeys = new Set(sets.flatMap(set => [set?.id, set?.name]
    .filter(Boolean).map(normalizeStampName)));
  return items.filter(item => !catalogKeys.has(normalizeStampName(item.name)));
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
    if (!groups.has(id)) groups.set(id, { id, name: key, imageCount: 0 });
    groups.get(id).imageCount++;
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

function normalizeStampName(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function attachUncatalogedLibraryFinder({ screen, button, title, scan }) {
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
  button.addEventListener('click', async () => {
    panel.hidden = false; button.disabled = true; list.replaceChildren(); message.textContent = 'Scanning the image library...';
    try {
      const result = await scan();
      if (!result.ok) { message.textContent = result.message; message.dataset.tone = 'error'; return; }
      const items = result.items;
      message.textContent = items.length ? `${items.length} uncataloged ${title.toLowerCase()} found.` : `Every ${title.toLowerCase()} image is already cataloged, or the source is empty.`;
      message.dataset.tone = items.length ? 'success' : '';
      list.replaceChildren(...items.map(item => {
        const row = document.createElement('li'); row.className = 'uncataloged-pack-item';
        const details = document.createElement('div'); details.className = 'uncataloged-pack-details';
        const name = document.createElement('strong'); name.textContent = item.name;
        const count = document.createElement('span'); count.textContent = `${item.imageCount ?? 1} image${(item.imageCount ?? 1) === 1 ? '' : 's'}${item.path ? ` · ${item.path}` : ''}`;
        details.append(name, count); row.append(details); return row;
      }));
    } catch { message.textContent = `The ${title.toLowerCase()} image library could not be scanned.`; message.dataset.tone = 'error'; }
    finally { button.disabled = false; }
  });
  close.addEventListener('click', () => { panel.hidden = true; button.focus(); });
}
