// ⚡ Tip the artist — drives the public oso-tip-loop Worker (POST /tip, NDJSON stream of real
// Hedera testnet steps). Only what the Worker returns is shown; on any failure the honest
// error and the recorded proof are shown instead. Nothing here is ever simulated.
export const WORKER = 'https://oso-tip-loop.shakaverse.workers.dev';
export const PROOF = 'https://github.com/Open-Source-Orchestra/fork-the-first-artist/blob/main/docs/TX-PROOF.md';

const HASHSCAN = /^https:\/\/hashscan\.io\/testnet\/(transaction|topic|account)\/[0-9A-Za-z.@%-]+$/;
const account = (id) => (/^0\.0\.\d+$/.test(id ?? '') ? `https://hashscan.io/testnet/account/${id}` : null);

/** Turn one Worker event into { title, detail, links[] } for display (pure; tested). */
export function describe(e) {
  const link = (label, href) => (typeof href === 'string' && HASHSCAN.test(href) ? { label, href } : null);
  const acc = (label, id) => link(label, account(id));
  switch (e.step) {
    case 'start':
      return { title: `Live run started · tip ${e.tipHbar} HBAR on ${e.network}`, detail: `split: ${e.split?.artistHbar} HBAR to the artist (96.31%) · ${e.split?.computeHbar} HBAR steward compute (3.69%) · OSO 0%`, links: [acc(`fan ${e.accounts?.fan}`, e.accounts?.fan), acc(`steward ${e.accounts?.steward}`, e.accounts?.steward), acc(`artist ${e.accounts?.artist}`, e.accounts?.artist)].filter(Boolean) };
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
      return { title: `5 · Steward forwards 96.31% → artist · ${e.amountHbar} HBAR`, detail: `${e.from} → ${e.to} · receipt ${e.status}`, links: [link(`forward tx ${e.txId}`, e.hashscan)].filter(Boolean) };
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
  const LABEL = button.textContent;

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
      service.textContent = `Live on ${h.network}: tip ${h.tipHbar} HBAR · meter ${h.meterHbar} HBAR · ${l.remainingToday ?? '?'} of ${l.dailyCap ?? '?'} live runs left today${l.nextRunInSeconds ? ` · next run possible in ${l.nextRunInSeconds}s` : ''}.`;
      fields.disabled = !(l.remainingToday > 0);
      if (!(l.remainingToday > 0)) say('Today’s live runs are used up.', true);
    } catch {
      service.textContent = 'The live loop is unreachable right now. Nothing will be simulated.';
      service.append(' ', proofLink());
    }
  };
  await refresh();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = $('#pay-question').value.trim().slice(0, 280);
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
        body: JSON.stringify(question ? { question } : {}),
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
