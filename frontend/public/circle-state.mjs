// Shared, DOM-free circle behavior. Public roster data is preview-only.
export const ALL_DAYS = 'all';
export const EVENT_DAYS = Object.freeze([3, 4, 5, 6]);

export function createFilterState() {
  return { day: ALL_DAYS, query: '' };
}

export function normalizeQuery(value) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('en') : '';
}

export function filterArtists(artists, state = createFilterState()) {
  const day = state.day === ALL_DAYS ? ALL_DAYS : Number(state.day);
  const query = normalizeQuery(state.query);
  return artists.filter((artist) => {
    const onDay = day === ALL_DAYS || (Array.isArray(artist.days) && artist.days.includes(day));
    const matchesName = !query || artist.name.toLocaleLowerCase('en').includes(query);
    return onDay && matchesName;
  });
}

export function draftUrlForArtist(artist) {
  if (!artist || typeof artist.slug !== 'string' || !/^[a-z0-9-]+$/.test(artist.slug)) {
    throw new TypeError('A public artist slug is required.');
  }
  return `/draft?artist=${encodeURIComponent(artist.slug)}`;
}

export function artistNameForSlug(slug, artists) {
  if (typeof slug !== 'string') return '';
  return artists.find((artist) => artist.slug === slug)?.name ?? '';
}
