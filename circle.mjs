import { roster } from '/circle/artists.mjs';
import { createFilterState, draftUrlForArtist, filterArtists } from '/circle-state.mjs';

// Public preview only: render native list/button semantics with one combined filter state.
const $ = (id) => document.getElementById(id);
const ring = $('ring');
const { artists } = roster;
const state = createFilterState();
const photos = artists.filter((artist) => artist.photo);

// The decorative arc is not interactive and never receives pointer events.
for (const artist of [...photos, ...photos]) {
  const img = document.createElement('img');
  img.src = artist.photo;
  img.alt = '';
  img.loading = 'lazy';
  $('arc').append(img);
}

const seats = artists.map((artist, index) => {
  const item = document.createElement('li');
  const angle = ((360 / artists.length) * index - 90) * (Math.PI / 180);
  item.style.setProperty('--x', `${50 + 43 * Math.cos(angle)}%`);
  item.style.setProperty('--y', `${50 + 45 * Math.sin(angle)}%`);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = `seat ${artist.kind}`;
  button.dataset.slug = artist.slug;
  button.setAttribute('aria-label', `${artist.name}${artist.set ? ` · ${artist.set}` : ''}`);

  const visual = document.createElement('span');
  visual.className = 'seat-visual';
  visual.setAttribute('aria-hidden', 'true');
  if (artist.photo) visual.style.backgroundImage = `url("${artist.photo}")`;
  else visual.textContent = artist.glyph || '🎶';

  const name = document.createElement('span');
  name.className = 'nm';
  name.textContent = artist.name;
  const set = document.createElement('span');
  set.className = 'seat-set';
  set.textContent = artist.set || artist.status || '';

  button.append(visual, name, set);
  button.addEventListener('click', () => openProfile(artist, button));
  item.append(button);
  ring.append(item);
  return { artist, button, item };
});

function syncControls() {
  if ($('find').value !== state.query) $('find').value = state.query;
  document.querySelectorAll('.pill[data-day]').forEach((button) => {
    const selected = button.dataset.day === state.day;
    button.classList.toggle('is-on', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function applyFilters() {
  const matching = new Set(filterArtists(artists, state));
  for (const { artist, button, item } of seats) {
    const visible = matching.has(artist);
    item.hidden = !visible;
    item.classList.toggle('is-dimmed', !visible);
    if (visible) item.removeAttribute('aria-hidden');
    else item.setAttribute('aria-hidden', 'true');
    button.tabIndex = visible ? 0 : -1;
  }
  $('count').textContent = `${matching.size} of ${artists.length}`;
  $('meter').max = artists.length;
  $('meter').value = matching.size;
  $('meter').textContent = `${matching.size} of ${artists.length}`;
}

syncControls();
applyFilters();

$('pills').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-day]');
  if (!button) return;
  state.day = button.dataset.day;
  syncControls();
  applyFilters();
});

$('finder').addEventListener('submit', (event) => event.preventDefault());
$('find').addEventListener('input', (event) => {
  state.query = event.target.value;
  applyFilters();
});

function resetCircle() {
  Object.assign(state, createFilterState());
  syncControls();
  applyFilters();
  // Celebration changes paint only; seat geometry and hit targets stay stable.
  ring.classList.remove('spin');
  void ring.offsetWidth;
  ring.classList.add('spin');
}

$('reset-filters').addEventListener('click', resetCircle);
$('spin').addEventListener('click', resetCircle);

const dialog = $('profile');
let dialogOpener = null;
function openProfile(artist, opener) {
  dialogOpener = opener;
  const photo = $('p-photo');
  photo.textContent = '';
  photo.style.backgroundImage = '';
  if (artist.photo) photo.style.backgroundImage = `url("${artist.photo}")`;
  else photo.textContent = artist.glyph || '🎶';
  $('p-set').textContent = artist.set || artist.status || '';
  $('p-name').textContent = artist.name;
  $('p-tag').textContent = artist.tagline || '';
  $('p-head').textContent = artist.headline || '';
  $('p-draft').href = draftUrlForArtist(artist);

  const links = $('p-links');
  links.textContent = '';
  for (const publicLink of artist.links || []) {
    const item = document.createElement('li');
    const anchor = document.createElement('a');
    anchor.href = publicLink.url;
    anchor.textContent = publicLink.label;
    anchor.rel = 'noopener noreferrer';
    anchor.target = '_blank';
    item.append(anchor);
    links.append(item);
  }
  links.hidden = !(artist.links || []).length;
  dialog.showModal();
}

$('p-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  if (dialogOpener?.isConnected) dialogOpener.focus();
});
dialog.addEventListener('click', (event) => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  if (outside) dialog.close();
});

// Reveal interactive controls only after all renderers and handlers are ready.
document.body.classList.remove('no-js');
