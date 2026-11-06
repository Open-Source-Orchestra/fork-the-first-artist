/* ── THE GREENHOUSE · find any artist in the garden · CC0 ────────────────────
   A search that grows a garden: every match is a flower, butterflies and
   dragonflies drift over it, roots run to a beating heart at the bottom.
   Client-side only · no tracking · respects prefers-reduced-motion.
   init({ ARTISTS, BY, ORDER, pick, hueOf, initials, esc, getCircle }) from app.js
   ------------------------------------------------------------------------- */
const FLOWERS = ['🌸', '🌺', '🌻', '🌼', '🌷', '🪻', '🪷', '🌹', '💮', '🏵️'];
// there is no dragonfly emoji — so we draw one (teal body, four glassy wings)
const DRAGON_SVG = (c) => `<svg viewBox="0 0 40 24" width="1.9em" height="1.15em" aria-hidden="true"><g fill="rgba(200,240,255,.55)" stroke="rgba(255,255,255,.7)" stroke-width=".4"><ellipse cx="15" cy="6" rx="10" ry="3" transform="rotate(-14 15 6)"/><ellipse cx="15" cy="18" rx="10" ry="3" transform="rotate(14 15 18)"/><ellipse cx="22" cy="7" rx="9" ry="2.6" transform="rotate(-8 22 7)"/><ellipse cx="22" cy="17" rx="9" ry="2.6" transform="rotate(8 22 17)"/></g><path d="M6 12 H36" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/><circle cx="5" cy="12" r="2.6" fill="${c}"/></svg>`;
const REDUCED = matchMedia('(prefers-reduced-motion:reduce)').matches;

// what people type → what artists are called on the page
const SYN = {
  dj: ['dj', 'house', 'techno', 'trance', 'disco', 'edm', 'decks', 'electronic', 'set'],
  house: ['house', 'dj', 'disco'], techno: ['techno', 'trance', 'dj'],
  drums: ['tabla', 'dhol', 'percussion', 'drum', 'jugalbandi', 'rhythm'], tabla: ['tabla', 'percussion', 'drum'],
  india: ['indian', 'hindi', 'hindustani', 'bollywood', 'classical', 'gujarati', 'punjabi', 'ghazal', 'gayaki'],
  indian: ['indian', 'hindi', 'hindustani', 'bollywood', 'classical'], classical: ['classical', 'hindustani', 'gayaki', 'ghazal'],
  sing: ['voice', 'vocal', 'vocals', 'singer', 'songwriting', 'songwriter', 'sing'], singer: ['voice', 'vocal', 'vocals', 'singer', 'songwriter'],
  voice: ['voice', 'vocal', 'vocals', 'singer'], vocals: ['voice', 'vocal', 'vocals', 'singer'],
  guitar: ['guitar', 'strumming', 'acoustic', 'electric'], keys: ['piano', 'keyboard', 'keys', 'pianist', 'synth', 'modular'], piano: ['piano', 'keyboard', 'pianist'],
  synth: ['synth', 'modular', 'electroacoustic', 'electronic', 'bass'], rap: ['rap', 'hip-hop', 'hip', 'hop', 'mic'], hiphop: ['rap', 'hip-hop'],
  magic: ['magic', 'mentalism', 'trick', 'mentalist'], code: ['live', 'coding', 'code'], coding: ['live', 'coding', 'code'],
  host: ['host', 'steward', 'bard', 'totem', 'orchestra'], steward: ['steward'], ai: ['ai', 'agent', 'family', 'totem'],
  songwriter: ['songwriter', 'songwriting', 'writing', 'original'], jam: ['jam', 'improvisation', 'improv'], folk: ['folk', 'gujarati', 'acoustic'],
};
// glyph → instrument chip
const GLYPH_CHIPS = [['🎤', 'voice'], ['🎸', 'guitar'], ['💿', 'dj'], ['🎹', 'keys'], ['🎛️', 'synth'], ['🪘', 'drums'], ['🎩', 'magic'], ['💻', 'code']];

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const words = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
function lev1(a, b) { // true when edit-distance ≤ 1
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++e > 1) return false;
    if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
  }
  return e + (a.length - i) + (b.length - j) <= 1;
}
const rnd = (a, b) => a + Math.random() * (b - a);
const pickOne = (arr) => arr[(Math.random() * arr.length) | 0];

export function initFinder(ctx) {
  const { ARTISTS, BY, ORDER, pick, hueOf, initials, esc, getCircle } = ctx;
  const $ = (s, r = document) => r.querySelector(s);
  const panel = $('#greenhouse'), results = $('#gh-results'), input = $('#gh-q'), rail = $('#gh-rail'), garden = $('#gh-garden');
  const fab = $('#gh-fab');
  if (!panel || !fab) return;


  // 🗝️ garden keys — an artist's own door (keys.js loads only when someone asks)
  let keysApi = null;
  const openKeys = async (tab) => {
    try { keysApi = keysApi || (await import('./keys.js')).initKeys(ctx); keysApi.open(tab); }
    catch (e) { console.error(e); const t = document.getElementById('toast'); if (t) { t.innerHTML = '<b>The garden door is stuck.</b> Please refresh and try again.'; t.classList.add('show'); } }
  };
  const kb = document.createElement('button'); kb.className = 'gkbtn'; kb.id = 'gh-keys'; kb.type = 'button';
  kb.innerHTML = '🗝️ <span>I’m an artist — open my garden</span>';
  kb.addEventListener('click', () => openKeys('garden'));
  panel.appendChild(kb);
  window.__gardenKeys = { open: openKeys };

  // ── index ──
  const idx = ARTISTS.map((a) => {
    const nameW = words(a.name);
    const body = words([a.role, a.tagline, a.headline, a.set, a.kind === 'garden' ? 'garden osoopen open' : '', a.kind === 'host' ? 'host always' : '', a.kind === 'away' ? 'away next time' : '',
      a.day ? 'nov ' + a.day + ' day' + a.day : '', (Array.isArray(a.links) ? a.links : []).map((l) => l.label).join(' ')].join(' '));
    const chips = GLYPH_CHIPS.filter(([g]) => (a.glyph || '').includes(g)).map(([, n]) => n);
    return { a, nameN: norm(a.name), nameW, bodyW: body, bodyN: ' ' + body.join(' ') + ' ', chips, flower: FLOWERS[Math.abs(hueOf(a.slug)) % FLOWERS.length] };
  });
  const dayOf = (x) => (x.a.kind === 'host' ? [3, 4, 5, 6] : x.a.day ? [x.a.day, 6] : /nov 3[–-]6/i.test(x.a.set || '') ? [3, 4, 5, 6] : []);

  const state = { q: '', chips: new Set(), sel: 0, list: [] };

  // ── scoring ──
  function score(x, toks) {
    let total = 0;
    for (const t of toks) {
      const alts = [t, ...(SYN[t] || [])];
      let best = 0;
      for (const [i, w] of alts.entries()) {
        const pen = i === 0 ? 1 : 0.55;
        if (x.nameN === w) best = Math.max(best, 100 * pen);
        else if (x.nameW.some((n) => n.startsWith(w))) best = Math.max(best, 80 * pen);
        else if (x.nameN.includes(w) && w.length > 1) best = Math.max(best, 60 * pen);
        else if (x.bodyW.some((b) => b === w)) best = Math.max(best, 34 * pen);
        else if (x.bodyW.some((b) => b.startsWith(w)) && w.length > 1) best = Math.max(best, 24 * pen);
        else if (w.length >= 5 && x.bodyN.includes(w)) best = Math.max(best, 14 * pen);
        else if (w.length >= 4 && i === 0 && (x.nameW.some((n) => lev1(n, w)) || x.bodyW.some((b) => b.length >= 4 && lev1(b, w)))) best = Math.max(best, 18);
      }
      if (!best) return 0; // every typed word must find something
      total += best;
    }
    return total;
  }
  function run() {
    const toks = words(state.q);
    let items = idx.slice();
    if (state.chips.size) {
      const days = [...state.chips].filter((c) => c.startsWith('d')).map((c) => +c.slice(1));
      const kinds = [...state.chips].filter((c) => c.startsWith('k:')).map((c) => c.slice(2));
      const insts = [...state.chips].filter((c) => c.startsWith('i:')).map((c) => c.slice(2));
      items = items.filter((x) => (!days.length || days.some((d) => dayOf(x).includes(d))) && (!kinds.length || kinds.includes(x.a.kind)) && (!insts.length || insts.some((i) => x.chips.includes(i))));
    }
    if (toks.length) { items = items.map((x) => ({ x, s: score(x, toks) })).filter((r) => r.s > 0).sort((p, q) => q.s - p.s || ORDER.indexOf(p.x.a.slug) - ORDER.indexOf(q.x.a.slug)).map((r) => r.x); }
    else items.sort((p, q) => p.nameN.localeCompare(q.nameN));
    state.list = items; state.sel = 0;
    render(toks);
    growGarden(items.length, toks.length > 0 || state.chips.size > 0);
  }

  // ── render ──
  function mark(name, toks) {
    let out = esc(name);
    for (const t of toks) { const re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'); out = out.replace(re, '<mark>$1</mark>'); }
    return out;
  }
  const sub = (a) => esc(a.kind === 'placed' ? (a.set || '') : (a.role || a.tagline || '').split(' · ').slice(0, 2).join(' · '));
  function render(toks) {
    const inC = new Set(getCircle());
    const alpha = !toks.length && !state.chips.size;
    panel.classList.toggle('alpha', alpha);
    panel.classList.toggle('hasq', !!state.q);
    $('#gh-count').textContent = state.list.length;
    $('#gh-of').textContent = alpha ? 'flowers in the greenhouse' : (state.list.length === 1 ? 'flower found' : 'flowers found');
    if (!state.list.length) {
      results.innerHTML = `<div class="empty"><b>🌱</b>Nothing has bloomed for “${esc(state.q)}” yet.<br>Try an instrument (<i>tabla</i>, <i>guitar</i>, <i>dj</i>), a day (<i>nov 4</i>) or a feeling (<i>folk</i>, <i>rap</i>).<br><br>#NOONEISEVEROUT — the circle always has room.</div>`;
      rail.innerHTML = ''; return;
    }
    let html = '', lastL = '';
    const letters = new Set();
    state.list.forEach((x, i) => {
      const a = x.a, L = (x.nameN.match(/[a-z0-9]/) || ['#'])[0].toUpperCase().replace(/[0-9]/, '#');
      if (alpha && L !== lastL) { html += `<div class="grp" data-l="${L}">${L}</div>`; lastL = L; letters.add(L); }
      const av = a.photo ? `<img class="av" src="${a.photo}" alt="" loading="lazy">` : `<div class="av mono" style="background:linear-gradient(140deg,hsl(${hueOf(a.slug)} 52% 42%),hsl(${hueOf(a.slug) + 55} 58% 28%))">${esc(initials(a))}</div>`;
      html += `<button class="row${i === state.sel ? ' sel' : ''}${inC.has(a.slug) ? ' in' : ''}" data-i="${i}" data-slug="${a.slug}" role="option">${av}<div class="nm">${mark(a.name, toks)}<small>${sub(a)}</small></div><span class="gl">${esc((a.glyph || '').slice(0, 4))}</span><span class="fl">${inC.has(a.slug) ? '🌟' : x.flower}</span></button>`;
    });
    results.innerHTML = html;
    // rail
    if (alpha) {
      const all = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
      rail.innerHTML = all.map((l) => `<span data-l="${l}" class="${letters.has(l) ? '' : 'dim'}">${l}</span>`).join('');
    } else rail.innerHTML = '';
  }
  results.addEventListener('click', (e) => { const r = e.target.closest('.row'); if (!r) return; burstAt(e); choose(r.dataset.slug); });
  results.addEventListener('mousemove', (e) => { const r = e.target.closest('.row'); if (r && +r.dataset.i !== state.sel) setSel(+r.dataset.i, false); });
  function setSel(i, scroll = true) {
    state.sel = Math.max(0, Math.min(state.list.length - 1, i));
    results.querySelectorAll('.row.sel').forEach((r) => r.classList.remove('sel'));
    const r = results.querySelector(`.row[data-i="${state.sel}"]`); if (r) { r.classList.add('sel'); if (scroll) r.scrollIntoView({ block: 'nearest' }); }
  }
  function choose(slug) { pick(slug); close(); }

  // ── A–Z rail: tap or drag ──
  const bubble = $('#gh-bubble');
  let bt;
  function jump(l) {
    const g = results.querySelector(`.grp[data-l="${l}"]`); if (!g) return;
    results.style.scrollBehavior = 'auto'; results.scrollTop = g.offsetTop - 6; results.style.scrollBehavior = '';
    rail.querySelectorAll('.on').forEach((s) => s.classList.remove('on')); const s = rail.querySelector(`[data-l="${l}"]`); s && s.classList.add('on');
    bubble.textContent = l; bubble.classList.add('show'); clearTimeout(bt); bt = setTimeout(() => { bubble.classList.remove('show'); s && s.classList.remove('on'); }, 700);
  }
  const fromPoint = (e) => { const t = document.elementFromPoint(e.clientX, e.clientY); if (t && t.dataset && t.dataset.l && rail.contains(t)) jump(t.dataset.l); };
  rail.addEventListener('pointerdown', (e) => { rail.setPointerCapture?.(e.pointerId); rail._d = true; fromPoint(e); });
  rail.addEventListener('pointermove', (e) => { if (rail._d) fromPoint(e); });
  rail.addEventListener('pointerup', () => { rail._d = false; });
  rail.addEventListener('pointercancel', () => { rail._d = false; });

  // ── chips ──
  const days = [3, 4, 5, 6];
  const chipDefs = [
    ...days.map((d) => ['d' + d, '🗓 Nov ' + d]),
    ['k:garden', '🌱 the garden'], ['k:host', '🎼 hosts'], ['k:away', '🌺 next time'],
    ...GLYPH_CHIPS.map(([g, n]) => ['i:' + n, g + ' ' + n]),
  ];
  const chipBox = $('#gh-chips');
  chipBox.innerHTML = chipDefs.map(([k, l]) => `<button class="chip" data-c="${k}" aria-pressed="false">${l}</button>`).join('');
  chipBox.addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; const k = b.dataset.c; if (state.chips.has(k)) state.chips.delete(k); else state.chips.add(k); b.classList.toggle('on', state.chips.has(k)); b.setAttribute('aria-pressed', state.chips.has(k)); run(); });

  // ── input + keyboard ──
  let dbt;
  input.addEventListener('input', () => { state.q = input.value.trim(); clearTimeout(dbt); dbt = setTimeout(run, 60); });
  $('#gh-clear').addEventListener('click', () => { input.value = ''; state.q = ''; state.chips.clear(); chipBox.querySelectorAll('.on').forEach((c) => c.classList.remove('on')); run(); input.focus(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(state.sel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(state.sel - 1); }
    else if (e.key === 'Enter') { const x = state.list[state.sel]; if (x) { e.preventDefault(); choose(x.a.slug); } }
    else if (e.key === 'Escape') { if (state.q) { e.stopPropagation(); input.value = ''; state.q = ''; run(); } }
  });
  $('#gh-surprise').addEventListener('click', (e) => { const x = pickOne(idx); burstAt(e, 14); choose(x.a.slug); });
  addEventListener('keydown', (e) => {
    if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); open(); }
  });

  // ── open / close ──
  function open() {
    document.querySelectorAll('.panel.open').forEach((p) => { if (p !== panel) p.classList.remove('open'); });
    panel.classList.add('open'); document.body.classList.add('ghopen', 'ghpanel');
    run();
    setTimeout(() => { input.focus(); input.select(); }, 320);
    ambient();
  }
  function close() { panel.classList.remove('open'); document.body.classList.remove('ghopen'); syncPanelClass(); }
  fab.addEventListener('click', open);
  $('#gh-x').addEventListener('click', close);
  $('#btn-add')?.addEventListener('click', (e) => { e.stopImmediatePropagation(); open(); }, true); // "add artist" now opens the greenhouse
  // keep the fab clear of whichever panel is open
  function syncPanelClass() { const any = document.querySelector('.panel.open'); document.body.classList.toggle('ghpanel', !!any); document.body.classList.toggle('ghopen', panel.classList.contains('open')); }
  new MutationObserver(syncPanelClass).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: false });

  // ── the garden ──
  let flowers = [], ambientT = null;
  function growGarden(n, searching) {
    if (!garden) return;
    const want = Math.min(searching ? n : Math.round(n * 0.6), REDUCED ? 8 : 26);
    // keep stems whose index < want, add or trim the rest
    while (flowers.length > want) { const f = flowers.pop(); f.style.transition = 'transform .4s,opacity .4s'; f.style.transform = 'scale(0) translateY(30px)'; f.style.opacity = 0; setTimeout(() => f.remove(), 420); }
    while (flowers.length < want) {
      const f = document.createElement('div'); f.className = 'flw';
      const i = flowers.length, w = garden.clientWidth || 400;
      f.textContent = pickOne(FLOWERS);
      f.style.left = ((i + 0.5) / Math.max(want, 8) * 0.92 + 0.04) * w + rnd(-10, 10) + 'px';
      f.style.fontSize = rnd(20, 34) + 'px'; f.style.setProperty('--st', rnd(14, 46) + 'px'); f.style.bottom = 20 + rnd(0, 6) + 'px';
      f.style.setProperty('--sw', rnd(3.6, 6.4) + 's'); f.style.setProperty('--dl', rnd(0, 2) + 's'); f.style.setProperty('--r', rnd(3, 9) + 'deg');
      f.style.animationDelay = (i * 0.04) + 's, ' + rnd(0, 2) + 's';
      garden.appendChild(f); flowers.push(f);
    }
    // fliers scale with the bloom
    const fl = [...garden.querySelectorAll('.fly')];
    const wantF = REDUCED ? 0 : Math.min(2 + Math.floor(want / 4), 8);
    while (fl.length > wantF) { fl.pop().remove(); }
    for (let k = fl.length; k < wantF; k++) spawnFlier(k < wantF / 3);
  }
  function spawnFlier(dragon) {
    const f = document.createElement('div'); f.className = 'fly' + (dragon ? ' dragon' : '');
    f.innerHTML = '<i>' + (dragon ? DRAGON_SVG(pickOne(['#2dd4bf', '#b48cff', '#ff8a5c', '#e86a92'])) : pickOne(['🦋', '🦋', '🦋', '🐝'])) + '</i>';
    f.style.fontSize = rnd(15, 26) + 'px';
    f.style.setProperty('--d', rnd(dragon ? 7 : 12, dragon ? 12 : 22) + 's'); f.style.setProperty('--dl', -rnd(0, 18) + 's'); f.style.setProperty('--y0', rnd(30, 120) + 'px');
    f.style.bottom = rnd(20, 70) + 'px';
    garden.appendChild(f);
  }
  function ambient() {
    clearInterval(ambientT);
    if (REDUCED) return;
    ambientT = setInterval(() => { // notes drift up from the roots
      if (!panel.classList.contains('open')) { clearInterval(ambientT); return; }
      const n = document.createElement('span'); n.className = 'note'; n.textContent = pickOne(['♪', '♫', '♩', '♬']);
      n.style.left = rnd(8, 92) + '%'; garden.appendChild(n); setTimeout(() => n.remove(), 5200);
    }, 900);
  }
  function burstAt(e, n = 7) {
    if (REDUCED || !garden) return;
    const gr = garden.getBoundingClientRect(), x = Math.min(Math.max(e.clientX - gr.left, 10), gr.width - 10), y = gr.height - 40;
    for (let i = 0; i < n; i++) {
      const b = document.createElement('span'); b.className = 'burst'; b.textContent = pickOne([...FLOWERS, '🦋', '✨']);
      b.style.left = x + 'px'; b.style.top = y + 'px';
      b.style.setProperty('--bx', rnd(-90, 90) + 'px'); b.style.setProperty('--by', -rnd(60, 190) + 'px'); b.style.setProperty('--br', rnd(-90, 90) + 'deg');
      garden.appendChild(b); setTimeout(() => b.remove(), 1300);
    }
  }
  // roots (a hand-drawn tangle running to the heart)
  const roots = $('svg.roots', garden);
  if (roots) roots.innerHTML = '<path d="M0 8 C60 14 90 30 160 24 S260 6 320 22 S380 34 400 20"/><path d="M0 28 C50 22 110 40 190 36 S300 40 400 30"/><path d="M200 44 C196 30 180 24 150 26 M200 44 C206 30 230 22 268 24 M200 44 C200 34 198 20 190 10 M200 44 C204 32 214 18 226 8"/>';

  // arrive: an idea for the deep link (?find=tabla)
  const f = new URLSearchParams(location.search).get('find');
  if (f) { input.value = f; state.q = f; setTimeout(open, 900); }
  if (new URLSearchParams(location.search).has('keys')) setTimeout(() => openKeys('garden'), 1100);
  run();
  window.__greenhouse = { open, close, run };
}
