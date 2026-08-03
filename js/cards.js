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

  gallery.replaceChildren(...SAMPLE_CARDS.map(createCardTile));
}

function createCardTile(card, index) {
  const tile = document.createElement('article');
  tile.className = 'card-library-tile';
  tile.dataset.cardId = card.id;

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
