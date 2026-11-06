/* ── GARDEN KEYS · "My garden" · an artist's own key opens only their own profile ─────────────
   No server. The key (4 words) is turned into a signing key IN YOUR BROWSER (PBKDF2 → Ed25519);
   the key itself is never sent anywhere and never stored. Every action becomes a SIGNED MESSAGE
   that you email (or paste) to the stewards; a steward-agent verifies the signature against the
   public keys in ../keys/pub.json and publishes only the five fields an artist may change.
   THE CODE IS LAW AND THE LAW IS LOVE.
   by the ʻohana — Shaka's AI family · CC0
   ------------------------------------------------------------------------------------------- */
import { LIMITS, clean, cleanLinks, cpLen, applyFields, saveLocal, privacyIssue } from './overlay.js';

const SALT = 'oso-garden-key-v1', ITER = 300000;
const REDUCED = matchMedia('(prefers-reduced-motion:reduce)').matches;
const CATS = [['code', '💻 code'], ['design', '🎨 design'], ['schedule', '🗓 schedule'], ['words', '✍️ words'], ['other', '🌱 other']];
const FLOWERS = ['🌸', '🌺', '🌻', '🌼', '🌷', '🪻', '🪷'];

/* ── crypto (identical to gk.py) ─────────────────────────────────────────────────────────── */
export const normKey = (k) => String(k || '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const b64u = (u8) => b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let naclP;
function loadNacl() {
  if (self.nacl && self.nacl.sign) return Promise.resolve(self.nacl);
  return naclP || (naclP = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = new URL('./vendor/nacl-fast.min.js', import.meta.url).href;
    s.onload = () => res(self.nacl); s.onerror = () => rej(new Error('could not load the signing library')); document.head.appendChild(s);
  }));
}
export async function derive(key) {
  if (!(self.crypto && crypto.subtle)) throw new Error('this browser cannot grow keys (needs a secure page)');
  const nacl = await loadNacl();
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(normKey(key)), 'PBKDF2', false, ['deriveBits']);
  const seed = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(SALT), iterations: ITER }, base, 256));
  const kp = nacl.sign.keyPair.fromSeed(seed);
  seed.fill(0);
  return { pub: b64(kp.publicKey), secret: kp.secretKey };
}
export async function signMessage(session, kind, fields) {
  const nacl = await loadNacl();
  const nonce = b64u(crypto.getRandomValues(new Uint8Array(12)));
  const payload = { v: 1, slug: session.slug, ts: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), nonce, seq: Date.now(), kind, fields };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const sig = nacl.sign.detached(bytes, session.secret);
  return { block: 'OSO-GARDEN-v1.' + b64u(bytes) + '.' + b64u(sig), payload };
}
// built from parts so Cloudflare's address-obfuscation can't mangle it
const addr = () => { const u = 'aloha', h = ['myagentohana', 'com'].join('.'); return u + String.fromCharCode(64) + h; };
const mailto = (kind, slug, block) => {
  const body = `Hello stewards 🌱 — this is a signed garden message from ${slug}. Just press send, and please leave the block exactly as it is.\n\n-----BEGIN OSO GARDEN-----\n${block}\n-----END OSO GARDEN-----\n`;
  return 'mailto:' + addr() + '?subject=' + encodeURIComponent(`OSO-GARDEN ${kind} — ${slug}`) + '&body=' + encodeURIComponent(body);
};

/* ── the panel ───────────────────────────────────────────────────────────────────────────── */
export function initKeys(ctx) {
  const { ARTISTS, BY, esc, hueOf, initials, refreshArtist } = ctx;
  if (document.getElementById('gardenkeys')) return { open: () => document.getElementById('gardenkeys').classList.add('open') };
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('./keys.css', import.meta.url).href; document.head.appendChild(css);

  const panel = document.createElement('aside');
  panel.className = 'panel'; panel.id = 'gardenkeys'; panel.setAttribute('aria-label', 'my garden — artist keys');
  panel.innerHTML = `
    <header><h2>🗝️ My garden</h2><button class="x" id="gk-x" aria-label="close">✕</button></header>
    <div class="gk-strip" aria-hidden="true"><span>🌷</span><span>🌼</span><span class="b">🦋</span><span>🌺</span><span>🌻</span><span class="b b2">🦋</span><span>🪻</span><span>🌸</span></div>
    <nav class="gk-tabs" role="tablist"><button role="tab" data-t="garden" aria-selected="true">🌿 My garden</button><button role="tab" data-t="propose" aria-selected="false">💡 Propose</button><button role="tab" data-t="board" aria-selected="false">🌱 Board</button></nav>
    <div class="body gk-body" id="gk-body"></div>`;
  document.body.appendChild(panel);
  const $ = (s, r = panel) => r.querySelector(s);
  const body = $('#gk-body');

  let tab = 'garden', session = null, pubMap = null, proposals = null, idleT, draft = null, out = null;

  const loadPub = async () => pubMap || (pubMap = await fetch('https://opensourceorchestra.org/garden/keys/pub.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  const loadProposals = async () => { proposals = await fetch('https://opensourceorchestra.org/garden/keys/proposals.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : [])).catch(() => []); return proposals; };
  const bumpIdle = () => { clearTimeout(idleT); if (session) idleT = setTimeout(() => { lock('Your garden was locked after a quiet while — your key stays with you.'); }, 15 * 60e3); };
  function lock(msg) { if (session) session.secret.fill(0); session = null; draft = null; out = null; clearTimeout(idleT); render(msg); }

  /* tabs + open/close */
  panel.querySelectorAll('.gk-tabs [data-t]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t; out = null; render(); }));
  function open(t) {
    if (t) tab = t;
    document.querySelectorAll('.panel.open').forEach((p) => { if (p !== panel) p.classList.remove('open'); });
    panel.classList.add('open'); render();
    setTimeout(() => { const i = $('#gk-key') || $('input,textarea,button.gk-go'); i && i.focus({ preventScroll: true }); }, 320);
  }
  $('#gk-x').addEventListener('click', () => panel.classList.remove('open'));
  new MutationObserver(() => document.body.classList.toggle('gkopen', panel.classList.contains('open'))).observe(panel, { attributes: true, attributeFilter: ['class'] });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); panel.classList.remove('open'); } bumpIdle(); });
  panel.addEventListener('input', bumpIdle);

  /* ── views ── */
  function render(note) {
    panel.querySelectorAll('.gk-tabs [data-t]').forEach((b) => b.setAttribute('aria-selected', b.dataset.t === tab));
    if (tab === 'board') return renderBoard();
    if (!session) return renderLock(note);
    if (tab === 'propose') return renderPropose();
    renderGarden();
  }

  function renderLock(note) {
    body.innerHTML = `
      ${note ? `<div class="gk-note">${esc(note)}</div>` : ''}
      <p class="gk-lead">Every artist in the garden gets <b>one key</b> — four little words. It opens <i>your</i> corner only: you can tune your own words and send ideas for the garden’s open-source code. Nobody else’s.</p>
      <label class="gk-lbl" for="gk-key">your garden key</label>
      <div class="gk-keyrow"><input id="gk-key" class="search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="fern-tabla-moon-dawn" aria-describedby="gk-hint"><button class="pill gk-eye" id="gk-eye" aria-label="hide or show the key" title="hide / show">👁</button></div>
      <div id="gk-err" class="gk-err" role="alert" aria-live="polite"></div>
      <button class="big gk-go" id="gk-unlock">Open my garden 🌱</button>
      <p class="gk-fine" id="gk-hint">Your key never leaves this page: it is turned into a signing key right here in your browser. We will never ask you for it. Lost it? Tell any steward — we grow you a new one.<br><br>Not an artist yet? <b>#NOONEISEVEROUT</b> — the circle always has room; the 🌱 Board tab is open to everyone.</p>
      <div id="gk-grow" class="gk-grow" hidden aria-live="polite"><span class="seed">🌱</span><span>growing your key…</span></div>`;
    const inp = $('#gk-key');
    $('#gk-eye').addEventListener('click', () => inp.classList.toggle('hid'));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
    $('#gk-unlock').addEventListener('click', unlock);
  }

  async function unlock() {
    const inp = $('#gk-key'), err = $('#gk-err'), grow = $('#gk-grow'); if (!inp) return;
    const raw = inp.value; err.textContent = '';
    if (normKey(raw).split('-').filter(Boolean).length < 3) { err.textContent = 'That doesn’t look like a garden key yet — it is four words joined by dashes.'; inp.focus(); return; }
    $('#gk-unlock').disabled = true; grow.hidden = false;
    try {
      const [kp, pub] = await Promise.all([derive(raw), loadPub(), new Promise((r) => setTimeout(r, REDUCED ? 150 : 650))]);
      inp.value = '';
      const slug = pub[kp.pub];
      if (!slug || !BY[slug]) { kp.secret.fill(0); grow.hidden = true; $('#gk-unlock').disabled = false; err.textContent = 'That key doesn’t open any garden door. Check the four words and try again — or ask a steward.'; return; }
      session = { slug, secret: kp.secret }; bumpIdle(); draft = null; out = null;
      bloom(); render();
    } catch (e) { grow.hidden = true; $('#gk-unlock').disabled = false; err.textContent = 'Something went wrong growing the key: ' + e.message; }
  }

  const ro = (label, val) => (val ? `<div class="gk-ro"><span>${label}</span><b>${esc(val)}</b></div>` : '');
  function avatar(a) { return a.photo ? `<img class="av" src="${esc(a.photo)}" alt="">` : `<div class="av mono" style="background:linear-gradient(140deg,hsl(${hueOf(a.slug)} 52% 42%),hsl(${hueOf(a.slug) + 55} 58% 28%))">${esc(initials(a))}</div>`; }

  function renderGarden() {
    const a = BY[session.slug];
    if (!draft) draft = { tagline: a.tagline || '', headline: a.headline || '', bio: a.bio || '', glyph: a.glyph || '', links: (a.links || []).map((l) => ({ ...l })), orig: null };
    if (!draft.orig) draft.orig = JSON.stringify({ tagline: draft.tagline, headline: draft.headline, bio: draft.bio, glyph: draft.glyph, links: draft.links });
    body.innerHTML = `
      <div class="gk-welcome"><div class="gk-who">${avatar(a)}<div><h3>Welcome home, ${esc(a.name)} 🌺</h3><div class="gk-sub">your key is open · <button class="gk-link" id="gk-lock">lock it</button></div></div></div></div>
      <div class="gk-live" id="gk-live"></div>
      <div class="gk-form">
        <div class="gk-grid2"><div><label class="gk-lbl" for="gk-glyph">glyph</label><input id="gk-glyph" class="search" value="${esc(draft.glyph)}" aria-describedby="gk-glyph-c"><div class="gk-c" id="gk-glyph-c"></div></div>
        <div><label class="gk-lbl" for="gk-head">headline</label><input id="gk-head" class="search" maxlength="${LIMITS.headline}" value="${esc(draft.headline)}"><div class="gk-c" id="gk-head-c"></div></div></div>
        <label class="gk-lbl" for="gk-tag">tagline</label><textarea id="gk-tag" class="search" rows="2" maxlength="${LIMITS.tagline}">${esc(draft.tagline)}</textarea><div class="gk-c" id="gk-tag-c"></div>
        <label class="gk-lbl" for="gk-bio">bio · plain words, in your own voice</label><textarea id="gk-bio" class="search" rows="6" maxlength="${LIMITS.bio}">${esc(draft.bio)}</textarea><div class="gk-c" id="gk-bio-c"></div>
        <div class="gk-lbl">links · https only · up to ${LIMITS.links}</div><div id="gk-links"></div><button class="pill" id="gk-addlink">+ add a link</button>
        <div id="gk-err" class="gk-err" role="alert" aria-live="polite"></div>
        <button class="big gk-go" id="gk-prep">Sign my update ✍️</button>
        <div class="gk-fine">Stewards keep these: <b>set time &amp; day · name · photo · rider · kind</b> — they are shared promises with the Devcon team. Everything you send is signed with your key, checked by a steward-agent, and can always be put back.</div>
      </div>
      <div id="gk-out"></div>`;
    $('#gk-lock').addEventListener('click', () => lock());
    const bind = (id, k, max) => { const el = $('#' + id); const c = $('#' + id + '-c'); const upd = () => { draft[k] = el.value; if (c) c.textContent = cpLen(el.value) + ' / ' + max; livePreview(); }; el.addEventListener('input', upd); upd(); };
    bind('gk-glyph', 'glyph', LIMITS.glyph); bind('gk-head', 'headline', LIMITS.headline); bind('gk-tag', 'tagline', LIMITS.tagline); bind('gk-bio', 'bio', LIMITS.bio);
    drawLinks();
    $('#gk-addlink').addEventListener('click', () => { if (draft.links.length < LIMITS.links) { draft.links.push({ label: '', url: 'https://' }); drawLinks(); const r = body.querySelectorAll('.gk-lrow'); r[r.length - 1].querySelector('input').focus(); } });
    $('#gk-prep').addEventListener('click', prepareEdit);
    if (out) showOut(out.kind, out.res, out.extra);
    livePreview();
  }
  function livePreview() {
    const el = $('#gk-live'); if (!el) return; const a = BY[session.slug];
    el.innerHTML = `<div class="gk-card"><div class="gk-card-top">${avatar(a)}<div><b>${esc(a.name)}</b><span>${esc(clean(draft.glyph, 8))}</span></div></div>${draft.headline ? `<div class="gk-h">${esc(clean(draft.headline, LIMITS.headline))}</div>` : ''}${draft.tagline ? `<div class="gk-t">${esc(clean(draft.tagline, LIMITS.tagline))}</div>` : ''}${draft.bio ? `<div class="gk-b">${esc(clean(draft.bio, LIMITS.bio, true))}</div>` : ''}<div class="gk-pv">how your card will look</div></div>`;
  }
  function drawLinks() {
    const box = $('#gk-links'); if (!box) return;
    box.innerHTML = draft.links.map((l, i) => `<div class="gk-lrow"><input class="search" aria-label="link ${i + 1} label" placeholder="label" maxlength="${LIMITS.label}" value="${esc(l.label)}" data-i="${i}" data-f="label"><input class="search" aria-label="link ${i + 1} address" placeholder="https://…" inputmode="url" value="${esc(l.url)}" data-i="${i}" data-f="url"><button class="gk-rm" data-i="${i}" aria-label="remove link ${i + 1}">✕</button></div>`).join('');
    box.querySelectorAll('input').forEach((el) => el.addEventListener('input', () => { draft.links[+el.dataset.i][el.dataset.f] = el.value; }));
    box.querySelectorAll('.gk-rm').forEach((b) => b.addEventListener('click', () => { draft.links.splice(+b.dataset.i, 1); drawLinks(); }));
    const add = $('#gk-addlink'); if (add) add.hidden = draft.links.length >= LIMITS.links;
  }

  async function prepareEdit() {
    const err = $('#gk-err'); err.textContent = '';
    const o = JSON.parse(draft.orig), f = {};
    const glyph = [...String(draft.glyph).trim()];
    if (glyph.length > LIMITS.glyph) { err.textContent = `The glyph is at most ${LIMITS.glyph} characters — one emoji is perfect.`; return; }
    if (/[A-Za-z0-9<>&"']/.test(draft.glyph)) { err.textContent = 'The glyph is a little emoji, not letters.'; return; }
    const checks = [['tagline', LIMITS.tagline, 'tagline'], ['headline', LIMITS.headline, 'headline'], ['bio', LIMITS.bio, 'bio']];
    for (const [k, max, nm] of checks) {
      if (cpLen(draft[k]) > max) { err.textContent = `Your ${nm} is a little long (max ${max}).`; return; }
      if (/<[a-z\/!?]/i.test(draft[k])) { err.textContent = `Plain words only in the ${nm} — no tags, please.`; return; }
      const pv = privacyIssue(draft[k]); if (pv) { err.textContent = `Your ${nm} has ${pv} in it — profiles are public, so we keep private things out. Please take it out 🙏`; return; }
    }
    const links = [];
    for (const l of draft.links) {
      if (!l.label.trim() && (!l.url.trim() || l.url.trim() === 'https://')) continue;
      const c = cleanLinks([l]);
      if (!c.length) { err.textContent = `“${l.label || l.url}” needs a short label and an https:// address.`; return; }
      links.push(c[0]);
    }
    const cur = { tagline: clean(draft.tagline, LIMITS.tagline), headline: clean(draft.headline, LIMITS.headline), bio: clean(draft.bio, LIMITS.bio, true), glyph: glyph.join(''), links };
    for (const k of ['tagline', 'headline', 'bio', 'glyph']) if (cur[k] !== clean(o[k], 9999, k === 'bio')) f[k] = cur[k];
    if (JSON.stringify(links) !== JSON.stringify(cleanLinks(JSON.parse(draft.orig).links))) f.links = links;
    if (!Object.keys(f).length) { err.textContent = 'Nothing has changed yet — grow something first 🌱'; return; }
    $('#gk-prep').disabled = true;
    try {
      const res = await signMessage(session, 'edit', f);
      applyFields(BY[session.slug], f); saveLocal(session.slug, res.payload.seq, f); refreshArtist && refreshArtist(session.slug);
      draft.orig = JSON.stringify({ tagline: cur.tagline, headline: cur.headline, bio: cur.bio, glyph: cur.glyph, links });
      out = { kind: 'edit', res, extra: 'It already shows in your own browser.' };
      showOut('edit', res, out.extra); bloom();
    } catch (e) { err.textContent = 'Could not sign: ' + e.message; }
    $('#gk-prep').disabled = false;
  }

  function showOut(kind, res, extra) {
    const box = $('#gk-out') || body; const slug = session.slug;
    box.innerHTML = `<div class="gk-sent" role="status"><h4>✅ Signed. Now send it to the stewards.</h4>
      <p>${esc(extra || '')} It is signed with your key — nobody can change a letter of it.</p>
      <div class="gk-btns"><a class="big gk-mail" href="${esc(mailto(kind, slug, res.block))}">✉️ Send by email</a><button class="pill teal" id="gk-copy">⧉ Copy (for Telegram or anywhere)</button></div>
      <textarea class="gk-block" readonly rows="3" aria-label="signed message">${esc(res.block)}</textarea>
      <p class="gk-fine"><b>Your garden grows within ~10 minutes</b> once a steward-agent checks the mailbox — refresh to see it.</p></div>`;
    $('#gk-copy', box).addEventListener('click', async (e) => { try { await navigator.clipboard.writeText(res.block); e.target.textContent = '✓ copied — paste it to the stewards'; } catch { $('.gk-block', box).select(); e.target.textContent = 'select + copy it by hand'; } });
    box.scrollIntoView({ block: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' });
  }

  function renderPropose() {
    body.innerHTML = `<p class="gk-lead">The garden’s code is open — <b>the code is law and the law is love.</b> Have an idea for the site, the schedule, the words, the way we do things? Plant it here. Everyone with a key can 🌱 water it.</p>
      <div class="gk-form"><label class="gk-lbl" for="gk-pt">title</label><input id="gk-pt" class="search" maxlength="${LIMITS.title}" placeholder="a short name for the idea"><div class="gk-c" id="gk-pt-c"></div>
      <label class="gk-lbl" for="gk-pc">category</label><select id="gk-pc" class="search">${CATS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <label class="gk-lbl" for="gk-pb">the idea · plain words</label><textarea id="gk-pb" class="search" rows="8" maxlength="${LIMITS.body}"></textarea><div class="gk-c" id="gk-pb-c"></div>
      <div id="gk-err" class="gk-err" role="alert" aria-live="polite"></div>
      <button class="big gk-go" id="gk-psign">Sign my proposal ✍️</button></div><div id="gk-out"></div>
      <div class="gk-fine">No phone numbers, emails or private links please — proposals are public, and become a GitHub issue anyone can discuss.</div>`;
    const cnt = (id, max) => { const el = $('#' + id), c = $('#' + id + '-c'); const u = () => (c.textContent = cpLen(el.value) + ' / ' + max); el.addEventListener('input', u); u(); };
    cnt('gk-pt', LIMITS.title); cnt('gk-pb', LIMITS.body);
    $('#gk-psign').addEventListener('click', async () => {
      const err = $('#gk-err'); err.textContent = '';
      const title = clean($('#gk-pt').value, LIMITS.title), text = clean($('#gk-pb').value, LIMITS.body, true), category = $('#gk-pc').value;
      if (title.length < 3 || text.length < 10) { err.textContent = 'Give it a title and a few words of explanation.'; return; }
      if (/<[a-z\/!?]/i.test(title + text)) { err.textContent = 'Plain words only — no tags, please.'; return; }
      const pv = privacyIssue(title + ' ' + text); if (pv) { err.textContent = `There is ${pv} in there — proposals are public, so please take it out 🙏`; return; }
      try { const res = await signMessage(session, 'propose', { title, body: text, category }); showOut('propose', res, 'Your idea is ready to plant.'); bloom(); } catch (e) { err.textContent = 'Could not sign: ' + e.message; }
    });
  }

  async function renderBoard() {
    body.innerHTML = '<div class="gk-grow"><span class="seed">🌱</span><span>reading the board…</span></div>';
    const list = await loadProposals();
    const mine = session && session.slug;
    const items = [...list].sort((a, b) => (b.waters || []).length - (a.waters || []).length || String(b.ts).localeCompare(String(a.ts)));
    body.innerHTML = `<p class="gk-lead">Ideas planted by the artists of the garden, for the open-source code we all share. ${mine ? 'Water the ones you want to see grow 🌱 — one water each.' : 'Open your garden with your key to plant or water one.'}</p>
      ${items.length ? items.map((p) => {
        const w = (p.waters || []), name = BY[p.slug] ? BY[p.slug].name : p.slug, cat = (CATS.find((c) => c[0] === p.category) || CATS[4])[1];
        const can = mine && !w.includes(mine) && p.slug !== mine;
        return `<article class="gk-prop"><div class="gk-ph"><span class="gk-cat">${cat}</span><span class="gk-pw">🌱 ${w.length}</span></div><h4>${esc(p.title)}</h4><div class="gk-pby">planted by ${esc(name)} · ${esc(String(p.ts || '').slice(0, 10))}</div><div class="gk-pbody">${esc(p.body)}</div>
        <div class="gk-pa">${p.issue ? `<a class="pill violet" href="${esc(p.issue)}" target="_blank" rel="noopener">discuss on GitHub ↗</a>` : ''}${can ? `<button class="pill teal" data-w="${esc(p.id)}">water 🌱</button>` : mine && w.includes(mine) ? '<span class="gk-done">you watered this ✓</span>' : ''}</div></article>`;
      }).join('') : '<div class="gk-empty"><b>🌱</b>The board is an empty field — yours could be the first seed.</div>'}
      <div id="gk-out"></div>`;
    body.querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', async () => {
      try { const res = await signMessage(session, 'water', { proposal: b.dataset.w }); b.textContent = 'signed ✓'; b.disabled = true; showOut('water', res, 'Your water is ready.'); bloom(); } catch (e) { b.textContent = 'oops'; }
    }));
  }

  /* little joys — a flower bloom when something succeeds */
  function bloom() {
    if (REDUCED) return;
    const r = panel.getBoundingClientRect();
    for (let i = 0; i < 9; i++) {
      const s = document.createElement('span'); s.className = 'gk-pop'; s.textContent = i % 4 === 3 ? '🦋' : FLOWERS[(Math.random() * FLOWERS.length) | 0];
      s.style.left = 20 + Math.random() * (r.width - 40) + 'px'; s.style.setProperty('--dx', (Math.random() * 80 - 40) + 'px'); s.style.animationDelay = i * 60 + 'ms';
      panel.appendChild(s); setTimeout(() => s.remove(), 1900);
    }
  }

  return { open, lock };
}
