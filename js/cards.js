const SAMPLE_CARDS = [
  {
    id: 'floral-friendship',
    dateCreated: '2026-07-12',
    tags: ['Friendship', 'Floral', 'Magenta'],
    paperPackIds: [],
    colorIds: ['berry-burst', 'lost-lagoon', 'lemon-lolly'],
    size: { width: 5.5, height: 4.25 },
    thumbnailImagePath: 'assets/cards/IMG_7797.JPEG',
    detailImagePath: 'assets/cards/IMG_7797-detail.webp',
    favorite: true
  },
  {
    id: 'summer-cheers',
    dateCreated: '2026-07-18',
    tags: ['Cheers', 'Fun Fold', 'Pink'],
    paperPackIds: [],
    colorIds: ['melon-mambo', 'flirty-flamingo', 'lemon-lolly'],
    size: { width: 5.5, height: 8 },
    thumbnailImagePath: 'assets/cards/IMG_5309.JPG',
    detailImagePath: 'assets/cards/IMG_5309-detail.webp',
    favorite: false
  },
  {
    id: 'woodland-music',
    dateCreated: '2026-07-24',
    tags: ['Woodland', 'Music', 'Interactive'],
    paperPackIds: [],
    colorIds: ['berry-burst', 'balmy-blue', 'pecan-pie'],
    size: { width: 6, height: 6 },
    thumbnailImagePath: 'assets/cards/IMG_5464.JPEG',
    detailImagePath: 'assets/cards/IMG_5464-detail.webp',
    favorite: true
  },
  {
    id: 'rose-birthday',
    dateCreated: '2026-07-30',
    tags: ['Birthday', 'Roses', 'Gold'],
    paperPackIds: [],
    colorIds: ['calypso-coral', 'petal-pink', 'garden-green'],
    size: { width: 4.25, height: 5.5 },
    thumbnailImagePath: 'assets/cards/IMG_3109.JPEG',
    detailImagePath: 'assets/cards/IMG_3109-detail.webp',
    favorite: false
  }
];

export function initializeCardLibrary() {
  const gallery = document.querySelector('[data-card-library]');
  const toolbar = gallery?.closest('#cards')?.querySelector('.library-toolbar');

  if (!gallery || !toolbar) {
    return;
  }

  const detailView = createCardDetailView();
  const addCardView = createAddCardView();
  const addCardButton = createAddCardButton();
  let activeTile = null;

  gallery.replaceChildren(...SAMPLE_CARDS.map(createCardTile));
  toolbar.append(addCardButton);
  document.body.append(detailView.overlay, addCardView.overlay);

  addCardButton.addEventListener('click', () => openAddCardView(addCardView));
  addCardView.close.addEventListener('click', () => closeAddCardView(addCardView, addCardButton));
  addCardView.cancel.addEventListener('click', () => closeAddCardView(addCardView, addCardButton));
  addCardView.overlay.addEventListener('click', (event) => {
    if (event.target === addCardView.overlay) {
      closeAddCardView(addCardView, addCardButton);
    }
  });

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
    if (event.key === 'Escape' && !addCardView.overlay.hidden) {
      closeAddCardView(addCardView, addCardButton);
      return;
    }

    if (event.key === 'Escape' && !detailView.overlay.hidden) {
      closeCardDetail(detailView, activeTile);
    }
  });
}

function createAddCardButton() {
  const button = document.createElement('button');
  button.className = 'button button-primary';
  button.type = 'button';
  button.textContent = '+ Add Card';
  button.setAttribute('aria-haspopup', 'dialog');
  return button;
}

function createAddCardView() {
  const overlay = document.createElement('div');
  overlay.className = 'card-add-overlay';
  overlay.hidden = true;

  const panel = document.createElement('aside');
  panel.className = 'card-add-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'card-add-title');

  const header = document.createElement('header');
  header.className = 'card-add-header';
  const title = document.createElement('h3');
  title.id = 'card-add-title';
  title.textContent = 'Add Card';

  const close = document.createElement('button');
  close.className = 'card-add-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close Add Card');
  close.textContent = String.fromCodePoint(215);
  header.append(title, close);

  const form = document.createElement('form');
  form.className = 'card-add-form';
  form.addEventListener('submit', (event) => event.preventDefault());

  const content = document.createElement('div');
  content.className = 'card-add-form-content';

  const actions = document.createElement('div');
  actions.className = 'card-add-actions';
  const cancel = document.createElement('button');
  cancel.className = 'button';
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const save = document.createElement('button');
  save.className = 'button button-primary';
  save.type = 'submit';
  save.textContent = 'Save';
  save.disabled = true;
  actions.append(cancel, save);
  form.append(content, actions);
  panel.append(header, form);
  overlay.append(panel);

  return { overlay, panel, close, cancel, save };
}

function openAddCardView(addCardView) {
  addCardView.overlay.hidden = false;
  addCardView.close.focus();
}

function closeAddCardView(addCardView, addCardButton) {
  if (addCardView.overlay.hidden) {
    return;
  }

  addCardView.overlay.hidden = true;
  addCardButton.focus();
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
  applyCardMockupSize(image, card);

  const cardImage = createCardImage(card, 'card-library-image', card.thumbnailImagePath);
  cardImage.loading = 'lazy';
  image.append(cardImage);

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
  applyCardMockupSize(image, card);
  image.append(createCardImage(card, 'card-detail-image', card.detailImagePath, card.thumbnailImagePath));

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

function applyCardMockupSize(element, card) {
  const aspectRatio = card.size.width / card.size.height;
  let mockupWidth = '58%';

  if (aspectRatio > 1) {
    mockupWidth = '78%';
  } else if (aspectRatio === 1) {
    mockupWidth = '68%';
  } else if (aspectRatio < 0.75) {
    mockupWidth = '52%';
  }

  element.style.setProperty('--card-width', card.size.width);
  element.style.setProperty('--card-height', card.size.height);
  element.style.setProperty('--card-mockup-width', mockupWidth);
}

function createCardImage(card, className, imagePath, fallbackPath = null) {
  const image = document.createElement('img');
  image.className = className;
  image.src = imagePath;
  image.alt = `${card.tags[0]} handmade card, ${card.size.width} by ${card.size.height} inches`;
  image.decoding = 'async';

  if (fallbackPath) {
    image.addEventListener('error', () => {
      image.src = fallbackPath;
    }, { once: true });
  }

  return image;
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
