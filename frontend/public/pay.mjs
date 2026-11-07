// ⚡ Tip the artist — drives the public oso-tip-loop Worker (POST /tip, NDJSON stream of real
// Hedera testnet steps). Only what the Worker returns is shown; on any failure the honest
// error and the recorded proof are shown instead. Nothing here is ever simulated.
export const WORKER = 'https://oso-tip-loop.shakaverse.workers.dev';
export const PROOF = 'https://github.com/Open-Source-Orchestra/fork-the-first-artist/blob/main/docs/TX-PROOF.md';

export const MIN_HBAR = '0.01';
export const MAX_HBAR = '10';
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** `?artist=shaka` -> 'shaka'; anything that is not a garden slug -> null (pure; tested). */
export function artistFromSearch(search) {
  const v = new URLSearchParams(search ?? '').get('artist');
  return v && LABEL_RE.test(v) ? v : null;
}

/** HBAR text -> tinybar BigInt, or null. Exact decimal, ≤8 places, no exponents (pure; tested). */
export function toTinybar(text) {
  const m = /^(\d{1,4})(?:\.(\d{1,8}))?$/.exec(String(text ?? '').trim().replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''));
  return m ? BigInt(m[1]) * 100000000n + BigInt((m[2] ?? '').padEnd(8, '0') || '0') : null;
}
const fmt = (t) => {
  const s = t.toString().padStart(9, '0');
  const frac = s.slice(-8).replace(/0+$/, '');
  return frac ? `${s.slice(0, -8)}.${frac}` : s.slice(0, -8);
};

/** Amount -> the exact split the Worker will apply (96.31% artist, rest = 0G meter), or an error (pure; tested). */
export function splitPreview(text, max = MAX_HBAR) {
  const t = toTinybar(text);
  const lo = toTinybar(MIN_HBAR);
  const hi = toTinybar(max) ?? toTinybar(MAX_HBAR);
  if (t == null || t < lo || t > hi) return { ok: false, message: `Pick an amount from ${MIN_HBAR} to ${fmt(hi)} HBAR.` };
  const artist = (t * 9631n) / 10000n;
  return { ok: true, amountHbar: fmt(t), artistHbar: fmt(artist), computeHbar: fmt(t - artist) };
}

const HASHSCAN = /^https:\/\/hashscan\.io\/testnet\/(transaction|topic|account)\/[0-9A-Za-z.@%-]+$/;
const account = (id) => (/^0\.0\.\d+$/.test(id ?? '') ? `https://hashscan.io/testnet/account/${id}` : null);

/** Turn one Worker event into { title, detail, links[] } for display (pure; tested). */
export function describe(e) {
  const link = (label, href) => (typeof href === 'string' && HASHSCAN.test(href) ? { label, href } : null);
  const acc = (label, id) => link(label, account(id));
  switch (e.step) {
    case 'start':
      return { title: e.target?.ens ? `Live run started · paying ${e.target.ens} ${e.tipHbar} HBAR on ${e.network}` : `Live run started · tip ${e.tipHbar} HBAR on ${e.network}`, detail: `split: ${e.split?.artistHbar} HBAR to the artist (96.31%) · ${e.split?.computeHbar} HBAR steward compute (3.69%) · OSO 0%${e.target?.ens ? ` · payout read from ${e.target.ens} just now` : ''}`, links: [acc(`fan ${e.accounts?.fan}`, e.accounts?.fan), acc(`steward ${e.accounts?.steward}`, e.accounts?.steward), acc(`${e.target?.ens ? e.target.ens.split('.')[0] : 'artist'} ${e.accounts?.artist}`, e.accounts?.artist)].filter(Boolean) };
    case 'ask-402':
      return { title: `1 · Fan agent asks the steward → HTTP ${e.status} Payment Required`, detail: `x402 ${e.scheme} · ${e.amountHbar} HBAR (asset ${e.asset}) · payTo ${e.payTo}${e.feePayer ? ` · fees sponsored by facilitator ${e.feePayer}` : ''}`, links: [] };
    case 'ask-signed':
      return { title: '2 · Fan agent signs the HBAR transfer and retries with X-PAYMENT', detail: `payer ${e.payer}; the x402 facilitator verified it — settlement waits until the steward has answered`, links: [] };
    case 'meter-402':
      return { title: `3 · Steward calls the 0G meter → HTTP ${e.status}`, detail: `the steward pays its own inference: ${e.amountHbar} HBAR (the 3.69%) to meter ${e.payTo}`, links: [] };
    case 'meter-paid':
      return { title: `3 · Steward paid the 0G meter (x402) · real 0G answer`, detail: `0G request id ${e.zeroG?.requestId ?? '—'} · model ${e.zeroG?.model ?? '—'}`, links: [link(`meter tx ${e.txId}`, e.hashscan)].filter(Boolean) };
    case 'ask-settled':
      return { title: `4 · Fan → steward settled · ${e.amountHbar} HBAR`, detail: `${e.from} → ${e.to}, submitted by the x402 facilitator`, links: [link(`settlement tx ${e.txId}`, e.hashscan)].filter(Boolean) };
    case 'forwarded':
      return { title: `5 · Steward forwards 96.31% → ${e.artistName ?? 'artist'} · ${e.amountHbar} HBAR`, detail: `${e.from} → ${e.to} · receipt ${e.status}`, links: [link(`forward tx ${e.txId}`, e.hashscan)].filter(Boolean) };
    case 'hcs-logged':
      return { title: `6 · Split logged on HCS · topic ${e.topic} · sequence ${e.sequence ?? '—'}`, detail: `receipt ${e.status}; the message carries the settled tx, the forward, the meter tx and the 0G request id`, links: [link(`HCS tx ${e.txId}`, e.hashscan), link(`topic ${e.topic}`, e.topicHashscan)].filter(Boolean) };
    case 'mirror':
      return { title: `7 · Re-read from the Hedera mirror node`, detail: `fan payment ${e.askSettledOnMirror ? 'SUCCESS ✓' : 'not visible yet'} · artist forward ${e.forwardOnMirror ? 'SUCCESS ✓' : 'not visible yet'}`, links: [] };
    case 'done':
      return { title: '✓ Loop complete — every id above is a real Hedera testnet transaction', detail: `${e.startedAt} → ${e.finishedAt}`, links: [] };
    case 'error':
      return { title: `✖ The live run stopped at “${e.failedStep}”`, detail: `${e.message}. Money moved so far: ${e.moneyMoved}. Nothing was simulated.`, links: [], error: true };
    default:
      return null;
  }
}

/** Split a streamed NDJSON buffer into complete events + the unfinished remainder (pure; tested). */
export function parseChunk(buffer) {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const events = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e.step === 'string') events.push(e);
    } catch {
      /* a malformed line is skipped, never invented */
    }
  }
  return { events, rest };
}

if (typeof document !== 'undefined') {
  const $ = (s) => document.querySelector(s);
  const form = $('#pay-form');
  const fields = $('#pay-fields');
  const button = $('#pay-go');
  const service = $('#pay-service');
  const status = $('#pay-status');
  const card = $('#pay-steps-card');
  const list = $('#pay-steps');
  const answer = $('#pay-answer');
  const amountInput = $('#pay-amount');
  const splitOut = $('#pay-split');
  const chips = [...document.querySelectorAll('.pay-chip')];
  let LABEL = button.textContent;
  let artist = null; // { label, ens, payTo, accountId, alias, source } once /artist confirmed it
  let maxHbar = MAX_HBAR;
  const wanted = artistFromSearch(location.search);
  const first = () => (artist ? artist.label.charAt(0).toUpperCase() + artist.label.slice(1) : 'the artist');

  const updateSplit = () => {
    const p = splitPreview(amountInput.value, maxHbar);
    for (const c of chips) c.setAttribute('aria-pressed', String(p.ok && c.dataset.amount === p.amountHbar));
    amountInput.setAttribute('aria-invalid', String(!p.ok));
    splitOut.classList.toggle('bad', !p.ok);
    splitOut.textContent = p.ok ? `${p.artistHbar} HBAR → ${artist ? artist.ens : 'the artist'} (96.31%) · ${p.computeHbar} HBAR steward compute on 0G (3.69%) · 0 to OSO` : p.message;
    button.disabled = !p.ok;
    return p;
  };
  for (const c of chips) c.addEventListener('click', () => { amountInput.value = c.dataset.amount; updateSplit(); });
  amountInput.addEventListener('input', updateSplit);
  updateSplit();

  const linkTo = (href, text) => {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = text;
    return a;
  };

  const loadArtist = async () => {
    if (!wanted) return;
    const card2 = $('#pay-artist');
    const detail = $('#pay-artist-detail');
    $('#pay-artist-ens').textContent = `${wanted}.osoartist.eth`;
    card2.hidden = false;
    detail.textContent = 'Reading their payout from their own ENS name…';
    try {
      const r = await fetch(`${WORKER}/artist?name=${encodeURIComponent(wanted)}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      const b = await r.json();
      if (!r.ok || !b.ok || b.artist?.label !== wanted || !/^(0\.0\.\d+|0x[0-9a-fA-F]{40})$/.test(b.artist?.payTo ?? '')) throw Object.assign(new Error('not payable'), { msg: b.message });
      artist = b.artist;
    } catch (e) {
      detail.textContent = `${e?.msg ?? `${wanted}.osoartist.eth can’t be paid right now.`} You can still run the example payment below — it pays the fictional demo artist.`;
      return;
    }
    const acctUrl = artist.accountId ? `https://hashscan.io/testnet/account/${artist.accountId}` : null;
    detail.replaceChildren(
      document.createTextNode(`96.31% of your tip goes to ${first()}’s Hedera testnet account `),
      acctUrl ? linkTo(acctUrl, `${artist.accountId} ↗`) : document.createTextNode(artist.payTo),
      document.createTextNode(`, read just now from ${artist.ens} — ${artist.source}. ${first()} set this when they signed with their own key; OSO can’t change it. `),
      linkTo(`https://app.ens.domains/${artist.ens}`, `${artist.ens} on ENS ↗`),
    );
    document.title = `💸 Pay ${first()} · x402 on Hedera testnet`;
    $('#pay-heading').replaceChildren(document.createTextNode(`💸 Pay ${first()} — `), Object.assign(document.createElement('em'), { textContent: 'x402 on Hedera testnet.' }));
    $('#pay-notice').replaceChildren(
      Object.assign(document.createElement('strong'), { textContent: 'Testnet HBAR, not real money. ' }),
      document.createTextNode(`The fan agent and the steward run server-side with demo testnet accounts (no wallet or key in your browser). The artist is real: ${first()} receives the 96.31% on the account above. Nothing touches mainnet.`),
    );
    $('#pay-question').value = `What should a first-time fan know about ${first()}?`;
    $('#pay-hint').textContent = `Up to 280 characters. The paid answer comes from real 0G inference about ${first()}’s public profile.`;
    LABEL = `💸 pay ${first()} — run the real x402 loop on Hedera testnet`;
    button.textContent = LABEL;
    updateSplit();
  };

  const proofLink = () => {
    const a = document.createElement('a');
    a.href = PROOF;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'see the recorded proof ↗';
    return a;
  };
  const say = (text, withProof = false) => {
    status.replaceChildren(document.createTextNode(text));
    if (withProof) status.append(' ', proofLink());
  };

  const render = (e) => {
    const d = describe(e);
    if (!d) return;
    const li = document.createElement('li');
    if (d.error) li.className = 'error';
    else if (e.step === 'done') li.className = 'done';
    const b = document.createElement('strong');
    b.textContent = d.title;
    const p = document.createElement('p');
    p.textContent = d.detail;
    li.append(b, p);
    if (d.links.length) {
      const div = document.createElement('div');
      div.className = 'links';
      for (const l of d.links) {
        const a = document.createElement('a');
        a.href = l.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = `${l.label} ↗`;
        div.append(a);
      }
      li.append(div);
    }
    if (d.error) li.append(proofLink());
    list.append(li);
    if (e.step === 'meter-paid' && typeof e.answer === 'string') {
      $('#pay-answer-text').textContent = e.answer;
      answer.hidden = false;
    }
  };

  const refresh = async () => {
    try {
      const r = await fetch(`${WORKER}/health`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      const h = await r.json();
      if (!r.ok || !h.ok || h.service !== 'oso-tip-loop' || h.network !== 'hedera:testnet') throw new Error('unhealthy');
      const l = h.limits ?? {};
      if (h.amount?.maxHbar) maxHbar = String(h.amount.maxHbar);
      const hbarLeft = typeof l.remainingHbarToday === 'number' ? ` · ${l.remainingHbarToday} of ${l.dailyHbarCap} testnet HBAR left today` : '';
      service.textContent = `Live on ${h.network}: ${l.remainingToday ?? '?'} of ${l.dailyCap ?? '?'} live runs left today${hbarLeft}${l.nextRunInSeconds ? ` · next run possible in ${l.nextRunInSeconds}s` : ''}.`;
      fields.disabled = !(l.remainingToday > 0);
      updateSplit();
      if (!(l.remainingToday > 0)) say('Today’s live runs are used up.', true);
    } catch {
      service.textContent = 'The live loop is unreachable right now. Nothing will be simulated.';
      service.append(' ', proofLink());
    }
  };
  await Promise.all([refresh(), loadArtist()]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = $('#pay-question').value.trim().slice(0, 280);
    const p = updateSplit();
    if (!p.ok) { amountInput.focus(); return; }
    fields.disabled = true;
    button.textContent = 'Running on Hedera testnet…';
    list.replaceChildren();
    answer.hidden = true;
    card.hidden = false;
    say('Running the live loop — real transactions take a few seconds each.');
    let finished = false;
    try {
      const r = await fetch(`${WORKER}/tip`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...(question ? { question } : {}), amountHbar: p.amountHbar, ...(artist ? { artist: artist.label } : {}) }),
        signal: AbortSignal.timeout(150_000),
      });
      if (!r.ok || !r.body) {
        let body = {};
        try { body = await r.json(); } catch { /* not JSON */ }
        card.hidden = true;
        if (r.status === 429) say(`${body.message ?? 'The live loop is busy.'}${body.retryAfterSeconds ? ` Retry in ${body.retryAfterSeconds}s.` : ''}`, true);
        else say(`The live loop is unavailable (${body.error ?? `HTTP ${r.status}`}). Nothing was paid.`, true);
        return;
      }
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (value) {
          const { events, rest } = parseChunk(buf + value);
          buf = rest;
          for (const e of events) {
            if (e.step === 'forwarded' && artist) e.artistName = first();
            render(e);
            if (e.step === 'done') { finished = true; say('Loop complete. Open any HashScan link to check it yourself.'); }
            if (e.step === 'error') { finished = true; say('The live run stopped with an honest error (see step list).', true); }
          }
        }
        if (done) break;
      }
      if (!finished) say('The stream ended before the loop finished. Check the HashScan links above for what did land.', true);
      $('#steps-heading').focus?.();
    } catch {
      if (!finished) say('The connection to the live loop broke. Any step shown above did land on-chain; nothing was simulated.', true);
    } finally {
      button.textContent = LABEL;
      await refresh();
    }
  });
}
