// Fork the First Artist — the ETHGlobal Mumbai layer on top of the Open Source Orchestra garden circle.
// The circle itself (app.js, finder.js, data/, img/, history/) is the garden, imported as-is.
// This module only adds: a ribbon + "the fork" panel with the live proofs, and a per-artist
// block inside the garden's detail panel. It never claims, activates or pays an artist.

const WORKER = 'https://oso-zerog-steward.shakaverse.workers.dev';
const REPO = 'https://github.com/Open-Source-Orchestra/fork-the-first-artist';
const HASHSCAN = 'https://hashscan.io/testnet';
const PROOF = {
  fanPay: '0.0.9185802-1794000789-476065413',
  forward: '0.0.11345897-1794000798-406931877',
  meter: '0.0.9185802-1794000791-797622368',
  topic: '0.0.11345907',
  artistAcct: '0.0.11345896',
  zeroGRequest: 'f8ff36e7-159e-408c-8e6a-6a0e419183a9',
};

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ensLabel = (slug) => String(slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 40);

let registry = { parent: 'osoartist.eth', consentPage: null, artists: {} };
let arkiv = null;
const ready = Promise.all([
  fetch('./fork/registry.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && typeof d === 'object') registry = { ...registry, ...d, artists: d.artists || {} }; }).catch(() => {}),
  fetch('./arkiv-proof.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then((d) => { arkiv = d; }).catch(() => {}),
]);

/* ── ribbon + opener in the garden's top-right corner ───────────────────────── */
function mountRibbon() {
  const right = $('#top .right');
  if (!right || $('#fork-open')) return;
  const ribbon = document.createElement('div');
  ribbon.id = 'fork-ribbon';
  ribbon.innerHTML = '<span class="dot" aria-hidden="true"></span><b>ETHGlobal Mumbai</b> · Hedera · 0G · Arkiv · ENS';
  const btn = document.createElement('button');
  btn.className = 'pill';
  btn.id = 'fork-open';
  btn.type = 'button';
  btn.setAttribute('aria-controls', 'fork');
  btn.textContent = '🍴 fork the first artist';
  btn.addEventListener('click', () => openFork());
  right.prepend(btn);
  right.prepend(ribbon);
}

/* ── the fork panel ─────────────────────────────────────────────────────────── */
function mountPanel() {
  if ($('#fork')) return;
  const p = document.createElement('aside');
  p.className = 'panel';
  p.id = 'fork';
  p.setAttribute('aria-label', 'Fork the First Artist');
  const tx = (id, label) => `<a href="${HASHSCAN}/transaction/${id}" target="_blank" rel="noopener">${esc(label || id)}</a>`;
  p.innerHTML = `
  <header><h2>🍴 Fork the First Artist</h2><button class="x" type="button" id="fork-x" aria-label="close">✕</button></header>
  <div class="body">
    <p class="lede">Every artist in this circle can be <b>forked</b>: a name they own, a steward agent that answers for them, and a tip jar that pays <b>96.31% straight to them</b>.</p>
    <p class="sub">The 3.69% keeps the steward's compute running. <b>Open Source Orchestra takes zero.</b> Nothing happens in an artist's name until that artist signs for it with their own key.</p>
    <div class="fork-split" role="img" aria-label="96.31 percent to the artist, 3.69 percent to steward compute, 0 percent to OSO"><span class="a">96.31% artist</span><span class="c">3.69%</span></div>
    <div class="fork-split-legend"><span><b>artist</b> · their own Hedera account</span><span><b>steward compute</b> · 0G · <b>OSO 0%</b></span></div>
    <ol class="fork-flow">
      <li>A fan (or a fan's agent) asks an artist's steward and gets <b>HTTP 402</b> — pay first.</li>
      <li>It pays autonomously with <b>x402 on Hedera</b>; the facilitator settles it.</li>
      <li>The steward answers through <b>0G Private Computer</b>, paying the 0G meter per call.</li>
      <li>It forwards <b>96.31%</b> to the artist and logs the split on <b>Hedera Consensus Service</b>.</li>
      <li>Invitations to the circle live on <b>Arkiv</b>; the artist's name is <b>&lt;name&gt;.osoartist.eth</b> on ENS.</li>
    </ol>

    <section class="fork-tile teal" id="fork-ask-tile" aria-labelledby="fork-ask-h">
      <h4 id="fork-ask-h">🧠 Ask a steward · 0G Private Computer <span class="fork-badge wait" id="fork-zg-badge">checking…</span></h4>
      <p>Real 0G inference, live in your browser — the answer arrives with its <b>0G request ID</b>. This public demo steward speaks for <b>Mira Modal, a fictional artist</b>; a real artist's steward wakes only after that artist consents.</p>
      <form class="fork-ask" id="fork-ask" autocomplete="off">
        <div class="fork-chips" aria-label="example questions">
          <button type="button" data-q="List Mira's songs.">List Mira's songs</button>
          <button type="button" data-q="What does Mira make music from?">What does Mira make music from?</button>
          <button type="button" data-q="How do fans support Mira?">How do fans support Mira?</button>
        </div>
        <label class="visually-hidden" for="fork-q">your question for the steward</label>
        <textarea class="search" id="fork-q" maxlength="280" placeholder="ask the steward anything about the artist (≤ 280 characters)" disabled></textarea>
        <div class="row2"><button class="big" type="submit" id="fork-ask-go" disabled>ask through 0G</button><a class="pill" href="/steward">full steward page →</a></div>
        <div class="fork-status" id="fork-ask-status" role="status" aria-live="polite"></div>
      </form>
      <div class="fork-answer" id="fork-answer" hidden>
        <div class="said" id="fork-said" dir="auto"></div>
        <dl class="fork-kv">
          <dt>0G request</dt><dd id="fork-rid"></dd>
          <dt>model</dt><dd id="fork-model"></dd>
          <dt>compute cost</dt><dd id="fork-cost"></dd>
        </dl>
        <p class="fork-honest">Router metadata shown as returned; no independent TEE verification is claimed.</p>
      </div>
    </section>

    <section class="fork-tile" aria-labelledby="fork-hedera-h">
      <h4 id="fork-hedera-h">⚡ x402 on Hedera <span class="fork-badge live">settled · testnet</span></h4>
      <p>A fan agent hit the 402, paid <b>1 HBAR</b> with x402, the steward paid the <b>0G meter</b> for each inference, forwarded <b>0.9631 HBAR (96.31%)</b> to the artist and wrote the split to HCS. Every ID re-read from the mirror node.</p>
      <dl class="fork-kv">
        <dt>fan → steward (x402)</dt><dd>${tx(PROOF.fanPay)}</dd>
        <dt>steward → 0G meter</dt><dd>${tx(PROOF.meter)}</dd>
        <dt>96.31% → artist</dt><dd>${tx(PROOF.forward)}</dd>
        <dt>HCS split log</dt><dd><a href="${HASHSCAN}/topic/${PROOF.topic}" target="_blank" rel="noopener">topic ${PROOF.topic}</a></dd>
        <dt>0G request (bound)</dt><dd>${PROOF.zeroGRequest}</dd>
      </dl>
      <div class="links"><a class="pill" href="${REPO}/blob/main/docs/TX-PROOF.md" target="_blank" rel="noopener">full proof ↗</a><a class="pill teal" href="${REPO}/tree/main/hedera-steward" target="_blank" rel="noopener">Hedera Agent Kit steward ↗</a></div>
      <p class="fork-honest">Synthetic demo accounts on testnet — no real artist was paid or activated.</p>
    </section>

    <section class="fork-tile violet" aria-labelledby="fork-arkiv-h">
      <h4 id="fork-arkiv-h">🗝 Invitations on Arkiv <span class="fork-badge live">written · Rabdi testnet</span></h4>
      <p>An artist's invitation into the circle is an <b>encrypted Arkiv entity</b> that can be issued, read and revoked — no personal data on chain. The page below queries Arkiv live from your browser.</p>
      <dl class="fork-kv" id="fork-arkiv-kv"><dt>state</dt><dd>loading…</dd></dl>
      <div class="links"><a class="pill violet" href="/arkiv">live Arkiv read →</a><a class="pill" href="${REPO}/tree/main/claims" target="_blank" rel="noopener">claims code ↗</a></div>
    </section>

    <section class="fork-tile" aria-labelledby="fork-ens-h">
      <h4 id="fork-ens-h">🏷 A name the artist owns <span class="fork-badge" id="fork-ens-badge">ENS</span></h4>
      <p>Each artist can hold <b>&lt;name&gt;.osoartist.eth</b>, owned by <b>their own wallet</b> with their own resolver; it points fans and agents at their Hedera account and their steward. OSO keeps no record rights. Tap any figure in the circle to see their name.</p>
      <p class="fork-honest" id="fork-ens-state"></p>
      <div class="links"><a class="pill" href="https://app.ens.domains/osoartist.eth" target="_blank" rel="noopener">osoartist.eth ↗</a></div>
    </section>

    <div class="links" style="display:flex;flex-wrap:wrap;gap:6px">
      <a class="pill" href="/home">sample artist home</a>
      <a class="pill" href="/draft">draft your artist home</a>
      <a class="pill" href="/wallets">wallet preview</a>
      <a class="pill" href="/list">plain list</a>
      <a class="pill teal" href="${REPO}" target="_blank" rel="noopener">code ↗</a>
    </div>
    <p class="fork-team">Built at <b>ETHGlobal Mumbai</b>, 7 Nov 2026, by the Open Source Orchestra team on top of its existing garden circle (the 3D circle, photos and artist roster come from <a href="https://opensourceorchestra.org/garden/circle/" target="_blank" rel="noopener">opensourceorchestra.org</a>). Public artist information here is a preview — it is <b>not</b> consent, a claim or a payout address.</p>
  </div>`;
  document.body.appendChild(p);
  $('#fork-x').addEventListener('click', () => p.classList.remove('open'));
  wireAsk();
}

function openFork(focusAsk = false) {
  mountPanel();
  document.querySelectorAll('.panel.open').forEach((x) => { if (x.id !== 'fork') x.classList.remove('open'); });
  $('#fork').classList.add('open');
  if (focusAsk) setTimeout(() => { $('#fork-ask-tile').scrollIntoView({ behavior: 'smooth', block: 'start' }); const q = $('#fork-q'); if (q && !q.disabled) q.focus({ preventScroll: true }); }, 320);
}

/* ── live 0G ask (same public Worker as /steward; no mock answer ever) ──────── */
let zgHealthy = false;
async function wireAsk() {
  const form = $('#fork-ask'), q = $('#fork-q'), go = $('#fork-ask-go'), st = $('#fork-ask-status'), badge = $('#fork-zg-badge');
  form.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => { q.value = b.dataset.q; if (zgHealthy) form.requestSubmit(); }));
  try {
    const r = await fetch(`${WORKER}/health`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const h = await r.json();
    if (!r.ok || !h.ok || h.provider !== '0g') throw new Error('unhealthy');
    zgHealthy = true;
    badge.className = 'fork-badge live'; badge.textContent = 'live · mainnet';
    q.disabled = false; go.disabled = false;
    st.textContent = `live: ${h.model || '0G model'} via 0G ${h.inference || 'router'}`;
  } catch {
    badge.className = 'fork-badge off'; badge.textContent = 'unavailable';
    st.textContent = 'The live steward is unreachable right now. No mock answer will be shown.';
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const instruction = q.value.trim();
    if (!zgHealthy) return;
    if (!instruction || instruction.length > 280) { st.textContent = 'Ask in 1–280 characters.'; return; }
    q.disabled = true; go.disabled = true; go.textContent = 'asking 0G…';
    $('#fork-answer').hidden = true;
    st.textContent = 'waiting for real 0G inference — usually a few seconds…';
    try {
      const r = await fetch(`${WORKER}/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction }), signal: AbortSignal.timeout(75000) });
      const b = await r.json();
      if (!r.ok || !b.ok || !b.reply?.text || !b.proof?.requestId) throw new Error('degraded');
      $('#fork-said').textContent = b.reply.text;
      $('#fork-rid').textContent = b.proof.requestId;
      $('#fork-model').textContent = b.proof.model || b.proof.requestedModel || '—';
      const micro = Number(b.proof.billingMicro);
      $('#fork-cost').textContent = Number.isFinite(micro) ? `$${(micro / 1e6).toFixed(6)}` : '—';
      $('#fork-answer').hidden = false;
      st.textContent = 'real 0G answer received ✓';
    } catch {
      st.textContent = '0G inference failed or came back unusable — no mock answer substituted. Try again in a moment.';
    } finally {
      q.disabled = false; go.disabled = false; go.textContent = 'ask through 0G';
    }
  });
  await ready;
  fillProofs();
}

function fillProofs() {
  const kv = $('#fork-arkiv-kv');
  if (kv && arkiv) {
    const ex = (h) => `<a href="https://rabdi.explorer.arkiv.network/tx/${esc(h)}" target="_blank" rel="noopener">${esc(h.slice(0, 18))}…</a>`;
    kv.innerHTML = `<dt>invitation issued</dt><dd>${ex(arkiv.issueTx)}</dd><dt>revoked</dt><dd>${ex(arkiv.revokeTx)}</dd><dt>entity</dt><dd>${esc(arkiv.entityKey)}</dd><dt>state now</dt><dd>${esc(arkiv.operationalState)} · verified ${esc(arkiv.verifiedAt)}</dd>`;
  }
  const issued = Object.values(registry.artists).filter((a) => a && a.status === 'issued').length;
  const consented = Object.values(registry.artists).filter((a) => a && (a.status === 'consented' || a.status === 'issued')).length;
  const badge = $('#fork-ens-badge'), state = $('#fork-ens-state');
  if (badge) { badge.className = 'fork-badge ' + (issued ? 'live' : 'wait'); badge.textContent = issued ? `${issued} issued · mainnet` : 'parent live · names on consent'; }
  if (state) state.textContent = issued
    ? `${issued} artist name${issued > 1 ? 's' : ''} issued on Ethereum mainnet, each owned by the artist's own wallet.`
    : `osoartist.eth is live on ENS. ${consented ? consented + ' artist' + (consented > 1 ? 's have' : ' has') + ' signed consent; ' : ''}no artist name is issued until that artist signs.`;
}

/* ── per-artist block in the garden's detail panel ─────────────────────────── */
function artistBlock(slug, a) {
  const body = $('#detail-body');
  if (!body || !a) return;
  body.querySelector('.fork-card')?.remove();
  const reg = registry.artists[slug] || null;
  const label = ensLabel(slug);
  const ens = reg?.ens || `${label}.${registry.parent || 'osoartist.eth'}`;
  const first = String(a.name || '').split(/[\s×&·]/)[0] || 'the artist';
  let state;
  if (reg?.status === 'issued') state = `<b>issued</b> · owned by ${esc(reg.owner ? reg.owner.slice(0, 6) + '…' + reg.owner.slice(-4) : 'the artist')}${reg.hedera ? ` · pays to Hedera <a href="${HASHSCAN.replace('/testnet', '/mainnet')}/account/${esc(reg.hedera)}" target="_blank" rel="noopener">${esc(reg.hedera)}</a>` : ''}`;
  else if (reg?.status === 'consented') state = `<b>consent signed</b> · name being issued to ${esc(first)}'s own wallet`;
  else state = `<b>not issued</b> · waits for ${esc(first)}'s own signature. Nothing is collected in an artist's name before that.`;
  const links = [];
  if (reg?.status === 'issued') links.push(`<a class="pill teal" href="https://app.ens.domains/${esc(ens)}" target="_blank" rel="noopener">🏷 ${esc(ens)} ↗</a>`);
  if (registry.consentPage && reg?.status !== 'issued') links.push(`<a class="pill" href="${esc(registry.consentPage)}?artist=${encodeURIComponent(slug)}">✍️ I am ${esc(first)} — sign consent</a>`);
  links.push(`<button class="pill teal" type="button" data-fork-ask>🧠 ask a steward · live 0G</button>`);
  links.push(`<button class="pill" type="button" data-fork-open>⚡ see a real x402 payment</button>`);
  if (/^[a-z0-9-]+$/.test(slug)) links.push(`<a class="pill violet" href="/draft?artist=${encodeURIComponent(slug)}">✏️ draft ${esc(first)}'s home</a>`);
  const card = document.createElement('section');
  card.className = 'fork-card';
  card.setAttribute('aria-label', `fork ${a.name}`);
  card.innerHTML = `
    <div class="k">🍴 fork ${esc(a.name)}</div>
    <div class="ens">${esc(ens)}</div>
    <div class="ens-state">${state}</div>
    <div class="fork-split" role="img" aria-label="96.31 percent to ${esc(a.name)}, 3.69 percent steward compute, 0 percent OSO"><span class="a">96.31% → ${esc(first)}</span><span class="c">3.69%</span></div>
    <div class="fork-split-legend"><span>every tip, paid with x402 on Hedera</span><span>steward compute · OSO 0%</span></div>
    <div class="links">${links.join('')}</div>
    <p class="fine">Public garden info is a preview, not consent: no name, steward or payout is activated for ${esc(a.name)} until they sign with their own key.</p>`;
  body.appendChild(card);
  card.querySelector('[data-fork-ask]')?.addEventListener('click', () => openFork(true));
  card.querySelector('[data-fork-open]')?.addEventListener('click', () => openFork(false));
}

document.addEventListener('fork:artist', async (e) => { await ready; artistBlock(e.detail.slug, e.detail.artist); });

function boot() {
  mountRibbon();
  mountPanel();
  ready.then(fillProofs);
  if (location.hash === '#fork') setTimeout(() => openFork(), 900);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#fork')?.classList.remove('open'); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
