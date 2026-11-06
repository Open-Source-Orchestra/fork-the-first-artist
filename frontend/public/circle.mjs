import { roster } from '/circle/artists.mjs';
// Circle front door: render the seats, filter by day, open a profile card. No inline HTML from data.
const $ = (id) => document.getElementById(id);
const ring = $('ring');
const { artists } = roster;
const photos = artists.filter((a) => a.photo);

// photo arc (twice for a seamless drift)
for (const a of [...photos, ...photos]) {
  const img = document.createElement('img');
  img.src = a.photo; img.alt = ''; img.loading = 'lazy';
  $('arc').append(img);
}

const seats = artists.map((a, i) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = `seat ${a.kind}`; b.setAttribute('role', 'listitem');
  b.setAttribute('aria-label', `${a.name}${a.set ? ' · ' + a.set : ''}`);
  b.style.setProperty('--a', `${(360 / artists.length) * i}deg`);
  if (a.photo) b.style.backgroundImage = `url("${a.photo}")`; else b.textContent = a.glyph || '🎶';
  const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = a.name; b.append(nm);
  b.addEventListener('click', () => open(a));
  ring.append(b);
  return { a, b };
});

const radius = () => { const r = ring.clientWidth * 0.42; seats.forEach(({ b }) => b.style.setProperty('--r', `-${r}px`)); };
radius(); addEventListener('resize', radius);

function show(test) {
  let n = 0;
  for (const { a, b } of seats) { const on = test(a); b.classList.toggle('dim', !on); b.tabIndex = on ? 0 : -1; n += on; }
  $('count').textContent = `${n} / ${artists.length}`; $('meter').value = n / artists.length;
}
show(() => true);

$('pills').addEventListener('click', (e) => {
  const p = e.target.closest('button[data-day]'); if (!p) return;
  document.querySelectorAll('.pill[data-day]').forEach((x) => x.classList.toggle('is-on', x === p));
  const d = p.dataset.day;
  show((a) => d === 'all' || String(a.day) === d || a.kind === 'host');
});

$('finder').addEventListener('submit', (e) => e.preventDefault());
$('find').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  show((a) => !q || a.name.toLowerCase().includes(q));
});

$('spin').addEventListener('click', () => {
  ring.classList.remove('spin'); void ring.offsetWidth; ring.classList.add('spin');
  show(() => true);
});

const dlg = $('profile');
function open(a) {
  const ph = $('p-photo');
  ph.textContent = ''; ph.style.backgroundImage = '';
  if (a.photo) ph.style.backgroundImage = `url("${a.photo}")`; else ph.textContent = a.glyph || '🎶';
  $('p-set').textContent = a.set || a.status || '';
  $('p-name').textContent = a.name;
  $('p-tag').textContent = a.tagline || '';
  $('p-head').textContent = a.headline || '';
  const ul = $('p-links'); ul.textContent = '';
  for (const l of a.links || []) {
    const li = document.createElement('li'); const link = document.createElement('a');
    link.href = l.url; link.textContent = l.label; link.rel = 'noopener noreferrer'; link.target = '_blank';
    li.append(link); ul.append(li);
  }
  dlg.showModal();
}
$('p-close').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
