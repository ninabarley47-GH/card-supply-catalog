const SAMPLE_CARDS = [
  {
    id: 'floral-friendship',
    dateCreated: '2026-07-12',
    tags: ['Friendship', 'Floral', 'Magenta'],
    paperPackIds: [],
    colorIds: ['berry-burst', 'lost-lagoon', 'lemon-lolly'],
    favorite: true
  },
  {
    id: 'summer-cheers',
    dateCreated: '2026-07-18',
    tags: ['Cheers', 'Fun Fold', 'Pink'],
    paperPackIds: [],
    colorIds: ['melon-mambo', 'flirty-flamingo', 'lemon-lolly'],
    favorite: false
  },
  {
    id: 'woodland-music',
    dateCreated: '2026-07-24',
    tags: ['Woodland', 'Music', 'Interactive'],
    paperPackIds: [],
    colorIds: ['berry-burst', 'balmy-blue', 'pecan-pie'],
    favorite: true
  },
  {
    id: 'rose-birthday',
    dateCreated: '2026-07-30',
    tags: ['Birthday', 'Roses', 'Gold'],
    paperPackIds: [],
    colorIds: ['calypso-coral', 'petal-pink', 'garden-green'],
    favorite: false
  }
];

export function initializeCardLibrary() {
  const gallery = document.querySelector('[data-card-library]');

  if (!gallery) {
    return;
  }

  const detailView = createCardDetailView();
  let activeTile = null;

  gallery.replaceChildren(...SAMPLE_CARDS.map(createCardTile));
  document.body.append(detailView.overlay);

  gallery.addEventListener('click', (event) => {
    const tile = event.target.closest('[data-card-id]');

    if (tile) {
      openCardDetail(detailView, findCard(tile.dataset.cardId), tile);
      activeTile = tile;
    }
  });

  gallery.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    const tile = event.target.closest('[data-card-id]');

    if (tile) {
      event.preventDefault();
      openCardDetail(detailView, findCard(tile.dataset.cardId), tile);
      activeTile = tile;
    }
  });

  detailView.close.addEventListener('click', () => closeCardDetail(detailView, activeTile));
  detailView.overlay.addEventListener('click', (event) => {
    if (event.target === detailView.overlay) {
      closeCardDetail(detailView, activeTile);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !detailView.overlay.hidden) {
      closeCardDetail(detailView, activeTile);
    }
  });
}

function createCardTile(card, index) {
  const tile = document.createElement('article');
  tile.className = 'card-library-tile';
  tile.dataset.cardId = card.id;
  tile.setAttribute('role', 'button');
  tile.setAttribute('tabindex', '0');
  tile.setAttribute('aria-haspopup', 'dialog');
  tile.setAttribute('aria-label', `View details for ${card.tags[0]} card`);

  const image = document.createElement('div');
  image.className = `card-library-placeholder card-library-placeholder-${index + 1}`;
  image.setAttribute('role', 'img');
  image.setAttribute('aria-label', `Image placeholder for ${card.tags[0]} card`);

  if (card.favorite) {
    const favorite = document.createElement('span');
    favorite.className = 'card-library-favorite';
    favorite.setAttribute('aria-label', 'Favorite card');
    favorite.textContent = '♥';
    image.append(favorite);
  }

  const tagList = document.createElement('ul');
  tagList.className = 'card-library-tags';
  tagList.setAttribute('aria-label', 'Card tags');

  card.tags.forEach((tag) => {
    const item = document.createElement('li');
    item.textContent = tag;
    tagList.append(item);
  });

  tile.append(image, tagList);
  return tile;
}

function findCard(cardId) {
  return SAMPLE_CARDS.find((card) => card.id === cardId);
}

function createCardDetailView() {
  const overlay = document.createElement('div');
  overlay.className = 'card-detail-overlay';
  overlay.hidden = true;

  const panel = document.createElement('aside');
  panel.className = 'card-detail-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'card-detail-title');

  const header = document.createElement('header');
  header.className = 'card-detail-header';

  const heading = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Card Library';
  const title = document.createElement('h3');
  title.id = 'card-detail-title';
  title.textContent = 'Card Details';
  heading.append(eyebrow, title);

  const close = document.createElement('button');
  close.className = 'card-detail-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close card details');
  close.textContent = '×';

  const body = document.createElement('div');
  body.className = 'card-detail-body';
  header.append(heading, close);
  panel.append(header, body);
  overlay.append(panel);

  return { overlay, panel, close, body };
}

function openCardDetail(detailView, card, tile) {
  if (!card) {
    return;
  }

  const cardIndex = SAMPLE_CARDS.indexOf(card);
  detailView.body.replaceChildren(createCardDetailContent(card, cardIndex));
  detailView.overlay.hidden = false;
  detailView.close.focus();
}

function closeCardDetail(detailView, tile) {
  if (detailView.overlay.hidden) {
    return;
  }

  detailView.overlay.hidden = true;
  detailView.body.replaceChildren();

  if (tile?.isConnected) {
    tile.focus();
  }
}

function createCardDetailContent(card, index) {
  const content = document.createElement('div');
  content.className = 'card-detail-content';

  const image = document.createElement('div');
  image.className = `card-detail-placeholder card-library-placeholder-${index + 1}`;
  image.setAttribute('role', 'img');
  image.setAttribute('aria-label', `Large image placeholder for ${card.tags[0]} card`);

  const metadata = document.createElement('div');
  metadata.className = 'card-detail-metadata';
  metadata.append(
    createCardFacts(card),
    createChipSection('Tags', card.tags),
    createChipSection('Paper packs', card.paperPackIds),
    createChipSection('Colors', card.colorIds)
  );

  content.append(image, metadata);
  return content;
}

function createCardFacts(card) {
  const facts = document.createElement('dl');
  facts.className = 'card-detail-facts';
  appendFact(facts, 'Date created', card.dateCreated);
  appendFact(facts, 'Favorite', card.favorite ? 'Yes' : 'No');
  return facts;
}

function appendFact(list, label, value) {
  const group = document.createElement('div');
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  term.textContent = label;
  description.textContent = value;
  group.append(term, description);
  list.append(group);
}

function createChipSection(label, values) {
  const section = document.createElement('section');
  section.className = 'card-detail-section';
  const heading = document.createElement('h4');
  heading.textContent = label;
  section.append(heading);

  if (values.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'card-detail-empty';
    empty.textContent = 'None';
    section.append(empty);
    return section;
  }

  const list = document.createElement('ul');
  list.className = 'card-detail-chips';
  values.forEach((value) => {
    const item = document.createElement('li');
    item.textContent = value;
    list.append(item);
  });
  section.append(list);
  return section;
}
