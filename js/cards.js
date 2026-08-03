const SAMPLE_CARDS = [
  { id: 'floral-friendship', tags: ['Friendship', 'Floral', 'Magenta'], favorite: true },
  { id: 'summer-cheers', tags: ['Cheers', 'Fun Fold', 'Pink'], favorite: false },
  { id: 'woodland-music', tags: ['Woodland', 'Music', 'Interactive'], favorite: true },
  { id: 'rose-birthday', tags: ['Birthday', 'Roses', 'Gold'], favorite: false }
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
