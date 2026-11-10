// 🔐 Pay from your OWN wallet — the fan signs two x402 payments with HashPack (WalletConnect /
// HIP-820 hedera_signTransaction): 96.31% straight to the artist's own Hedera account (read from
// their ENS name by the oso-tip-loop Worker), 3.69% straight to the steward. OSO never holds the
// money and never sees a key. Before the wallet is asked to sign anything, this page decodes each
// transaction body itself and refuses unless it is exactly the planned transfer.
//
// Pure helpers are exported and unit-tested (frontend/test/fan-pay.test.mjs); the DOM part runs
// only on /pay. Testnet by default; mainnet only when the Worker reports its switch is on.
import { checkTransferBody } from './hedera-body.mjs';
import { createHederaConnection } from './hedera-wallet.mjs';

export const WORKER = 'https://oso-tip-loop.shakaverse.workers.dev';
export const DECIMALS = { HBAR: 8, USDC: 6 };
export const ASSETS = { testnet: { HBAR: '0.0.0', USDC: '0.0.429274' }, mainnet: { HBAR: '0.0.0', USDC: '0.0.456858' } };
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const HASHSCAN = /^https:\/\/hashscan\.io\/(testnet|mainnet)\/transaction\/[0-9A-Za-z.@%-]+$/;

/** A fresh idempotency key for ONE tip (kept across retries of that tip). */
export function newTipId(rand = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return `tip_${[...rand(12)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function toAtomic(text, decimals) {
  const re = new RegExp(`^(\\d{1,6})(?:\\.(\\d{1,${decimals}}))?$`);
  const m = re.exec(String(text ?? '').trim().replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''));
  return m ? BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt((m[2] ?? '').padEnd(decimals, '0') || '0') : null;
}
export function fromAtomic(v, decimals) {
  const s = BigInt(v).toString().padStart(decimals + 1, '0');
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return frac ? `${s.slice(0, -decimals)}.${frac}` : s.slice(0, -decimals);
}

/** Same rule as the Worker (cloudflare/src/direct-split.ts): steward = floor(3.69%), artist = the rest. */
export function directSplit(text, currency, max = '10') {
  const d = DECIMALS[currency];
  const t = d ? toAtomic(text, d) : null;
  const lo = 10n ** BigInt(d - 2);
  const hi = d ? toAtomic(max, d) : null;
  if (t == null || t < lo || t > hi) return { ok: false, message: `Pick an amount from 0.01 to ${max} ${currency}.` };
  const steward = (t * 369n) / 10000n;
  return { ok: true, total: t, artist: t - steward, steward, text: `${fromAtomic(t - steward, d)} ${currency} → artist (96.31%) · ${fromAtomic(steward, d)} ${currency} → steward (3.69%) · 0 to OSO` };
}

/**
 * Check what the Worker prepared against what the fan asked for, BEFORE any wallet prompt.
 * Every unsigned leg's TransactionBody is decoded here and must be exactly one transfer from
 * the fan to that leg's payee, fees on the facilitator. Returns [] when everything matches.
 */
export function checkPrepared(record, want) {
  const problems = [];
  if (!record || typeof record !== 'object') return ['no record'];
  if (record.fan !== want.fan) problems.push(`prepared for ${record.fan}, not your account ${want.fan}`);
  if (record.network !== `hedera:${want.network}`) problems.push(`network ${record.network}`);
  if (record.currency !== want.currency) problems.push(`currency ${record.currency}`);
  if (record.artist?.label !== want.artist) problems.push(`artist ${record.artist?.label}`);
  if (record.total !== want.total.toString()) problems.push(`total ${record.total}, you asked for ${want.total}`);
  const legs = Array.isArray(record.legs) ? record.legs : [];
  if (legs.length !== 2 || legs[0]?.leg !== 'artist' || legs[1]?.leg !== 'steward') return [...problems, 'expected exactly two legs: artist then steward'];
  if (legs[0].payTo !== record.artist.payTo) problems.push('artist leg does not pay the artist account read from ENS');
  if (want.steward && legs[1].payTo !== want.steward) problems.push(`steward leg pays ${legs[1].payTo}, the service advertises ${want.steward}`);
  const sum = BigInt(legs[0].amount) + BigInt(legs[1].amount);
  if (sum !== want.total) problems.push(`legs add up to ${sum}, not ${want.total}`);
  const steward = (want.total * 369n) / 10000n;
  if (BigInt(legs[1].amount) !== steward) problems.push('steward share is not 3.69%');
  const asset = ASSETS[want.network]?.[want.currency];
  for (const leg of legs) {
    if (leg.status === 'settled' || !leg.bodyBytes) continue;
    try {
      const p = checkTransferBody(leg.bodyBytes, { fan: want.fan, payTo: leg.payTo, amount: leg.amount, asset, feePayer: leg.feePayer });
      if (p.length) problems.push(`${leg.leg} leg: ${p.join('; ')}`);
    } catch {
      problems.push(`${leg.leg} leg: body could not be decoded`);
    }
  }
  return problems;
}

/** Ask the wallet to sign every unsigned leg, in order. Returns { [leg]: signatureMap(base64) }. */
export async function signLegs(request, chain, fan, legs, onLeg = () => {}) {
  const out = {};
  for (const leg of legs) {
    if (leg.status === 'settled' || !leg.bodyBytes) continue;
    onLeg(leg);
    const r = await request('hedera_signTransaction', { signerAccountId: `${chain}:${fan}`, transactionBody: leg.bodyBytes });
    const sig = typeof r === 'string' ? r : r?.signatureMap;
    if (typeof sig !== 'string' || !sig) throw new Error('the wallet returned no signature');
    out[leg.leg] = sig;
  }
  return out;
}

/** sessionStorage key for an unfinished tip, so a reload or a retry reuses the SAME idempotency key. */
export const pendingKey = (artist, network) => `oso-fan-tip:${network}:${artist}`;

/** One settle response -> display lines (pure; tested). */
export function describeSettle(res) {
  const lines = [];
  for (const leg of res?.record?.legs ?? []) {
    const who = leg.leg === 'artist' ? `the artist (${res.record.artist?.ens ?? ''})` : 'the steward';
    const link = typeof leg.hashscan === 'string' && HASHSCAN.test(leg.hashscan) ? leg.hashscan : null;
    lines.push({
      title: leg.status === 'settled' ? `✓ ${leg.amountDisplay} → ${who} · ${leg.payTo}` : `${leg.status === 'failed' ? '✖' : '…'} ${leg.amountDisplay} → ${who} · ${leg.status}`,
      detail: leg.status === 'settled' ? `paid directly from your wallet · tx ${leg.settledTx}` : leg.error ?? 'not paid yet',
      link,
      error: leg.status === 'failed',
    });
  }
  const state = res?.state;
  const summary = state === 'complete' ? 'Both payments landed — straight from your wallet to the artist and the steward. OSO held nothing.'
    : state === 'partial' ? 'The artist is paid. The steward payment did not land yet — retry signs and settles only that one; you will never be charged twice.'
    : 'Nothing was paid yet.';
  return { lines, summary, state };
}

// ── DOM ─────────────────────────────────────────────────────────────────────────
if (typeof document !== 'undefined' && document.querySelector('#fan-wallet')) {
  const $ = (s) => document.querySelector(s);
  const artist = (() => { const v = new URLSearchParams(location.search).get('artist'); return v && LABEL_RE.test(v) ? v : null; })();
  const el = {
    fields: $('#fan-fields'), network: $('#fan-network'), currency: $('#fan-currency'), amount: $('#fan-amount'), split: $('#fan-split'),
    connect: $('#fan-connect'), forget: $('#fan-forget'), account: $('#fan-account'), wstatus: $('#fan-wallet-status'),
    pairing: $('#fan-pairing'), qr: $('#fan-qr'), copy: $('#fan-copy'), pay: $('#fan-pay'), steps: $('#fan-steps'), status: $('#fan-status'), retry: $('#fan-retry'), form: $('#fan-form'),
  };
  let health = null;
  let config = null;
  let runtime = null;
  let busy = false;
  let connection = null;
  const chain = () => `hedera:${el.network.value}`;
  const max = () => health?.wallet?.[el.network.value]?.currencies?.find((c) => c.currency === el.currency.value)?.maxTip ?? '10';
  const say = (t) => { el.status.textContent = t; };
  const update = () => {
    const p = directSplit(el.amount.value, el.currency.value, max());
    el.split.textContent = p.ok ? p.text : p.message;
    el.split.classList.toggle('bad', !p.ok);
    const st = connection?.getState();
    el.pay.disabled = busy || !p.ok || !artist || st?.status !== 'connected' || !health?.wallet?.[el.network.value]?.enabled;
    return p;
  };
  const renderWallet = (state) => {
    el.connect.disabled = !config?.enabled || ['connecting', 'pairing'].includes(state.status);
    el.forget.disabled = state.status === 'disconnected';
    el.account.replaceChildren(new Option('Select the account you pay from', ''), ...state.accounts.map((a) => new Option(a.split(':').pop(), a)));
    el.account.value = state.account ?? '';
    el.account.disabled = !['select-account', 'connected'].includes(state.status);
    el.wstatus.textContent = state.message;
    el.pairing.hidden = !state.uri;
    el.qr.hidden = true;
    if (state.uri && runtime) void runtime.pairingQr(state.uri).then((img) => { el.qr.src = img; el.qr.hidden = false; }).catch(() => {});
    update();
  };
  const makeConnection = () => createHederaConnection({
    chain: chain(),
    methods: ['hedera_signTransaction'],
    messages: {
      pairing: `Scan with HashPack or paste the pairing link into HashPack. Choose a Hedera ${el.network.value} account to pay from.`,
      select: 'Paired. Select the account you pay from. Nothing is signed until you press pay and approve each payment in HashPack.',
      connected: `Paying from this account on Hedera ${el.network.value}. HashPack will show each payment before you approve it.`,
      error: `Pairing did not complete with a valid Hedera ${el.network.value} session. Check HashPack and try again.`,
    },
    createClient: async () => {
      runtime ??= await import('/hashpack-runtime.mjs');
      return runtime.createHashPackClient(config.projectId, location.origin);
    },
    onChange: renderWallet,
  });
  const step = (title, detail = '', link = null, cls = '') => {
    const li = document.createElement('li');
    if (cls) li.className = cls;
    const b = document.createElement('strong');
    b.textContent = title;
    const p = document.createElement('p');
    p.textContent = detail;
    li.append(b, p);
    if (link) {
      const a = document.createElement('a');
      a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'HashScan ↗';
      const d = document.createElement('div'); d.className = 'links'; d.append(a); li.append(d);
    }
    el.steps.append(li);
  };
  const post = async (path, body) => {
    const r = await fetch(`${WORKER}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok || !b.ok) throw Object.assign(new Error(b.message ?? `HTTP ${r.status}`), { code: b.error });
    return b;
  };

  const run = async () => {
    const p = update();
    const st = connection?.getState();
    if (!p.ok || !artist || st?.status !== 'connected') return;
    const fan = st.account.split(':').pop();
    const network = el.network.value;
    const currency = el.currency.value;
    const key = pendingKey(artist, network);
    let pending = null;
    try { pending = JSON.parse(sessionStorage.getItem(key) ?? 'null'); } catch { /* none */ }
    const same = pending && pending.fan === fan && pending.currency === currency && pending.total === p.total.toString();
    const id = same ? pending.id : newTipId();
    sessionStorage.setItem(key, JSON.stringify({ id, fan, currency, total: p.total.toString() }));
    busy = true; update(); el.retry.hidden = true; el.steps.replaceChildren();
    try {
      say('Preparing both payments — reading the artist’s payout from their own ENS name…');
      const prep = await post('/wallet/prepare', { id, network, currency, amount: fromAtomic(p.total, DECIMALS[currency]), artist, fan });
      const rec = prep.record;
      const problems = checkPrepared(rec, { fan, network, currency, artist, total: p.total, steward: health?.wallet?.[network]?.steward });
      if (problems.length) {
        step('✖ Refused to ask your wallet: the prepared payment does not match what you asked for', problems.join(' · '), null, 'error');
        say('Nothing was signed and nothing was paid.');
        return;
      }
      step(`Prepared · ${rec.totalDisplay} to ${rec.artist.ens}`, `${rec.legs[0].amountDisplay} → ${rec.artist.payTo} (the artist’s own account, ${rec.artist.source}) · ${rec.legs[1].amountDisplay} → steward ${rec.legs[1].payTo} · network fees paid by the x402 facilitator ${rec.legs[0].feePayer}. This page decoded both transactions: exactly these transfers, nothing else.`);
      const todo = rec.legs.filter((l) => l.status !== 'settled' && l.bodyBytes);
      let n = 0;
      const signatures = await signLegs((m, params) => connection.request(m, params), chain(), fan, todo, (leg) => {
        n += 1;
        say(`Approve payment ${n} of ${todo.length} in HashPack: ${leg.amountDisplay} → ${leg.leg === 'artist' ? rec.artist.ens : 'the steward'} (${leg.payTo}).`);
      });
      step(`Your wallet signed ${Object.keys(signatures).length} payment${Object.keys(signatures).length === 1 ? '' : 's'}`, 'the x402 facilitator now verifies and submits them — artist first, then the steward');
      say('Settling on Hedera…');
      const res = await post('/wallet/settle', { id, signatures });
      const d = describeSettle(res);
      for (const l of d.lines) step(l.title, l.detail, l.link, l.error ? 'error' : 'done');
      say(d.summary);
      if (d.state === 'complete') sessionStorage.removeItem(key);
      else el.retry.hidden = false;
    } catch (e) {
      step('✖ The payment stopped', `${e?.message ?? e}`, null, 'error');
      say(e?.code === 'MAINNET_DISABLED' ? 'Mainnet tips are switched off on this service. Nothing was paid.' : 'Any payment shown above as ✓ did land; nothing else was paid. You can retry — the same tip id is reused, so nothing is charged twice.');
      el.retry.hidden = false;
    } finally {
      busy = false; update();
    }
  };

  el.form.addEventListener('submit', (ev) => { ev.preventDefault(); void run(); });
  el.retry.addEventListener('click', () => { void run(); });
  el.amount.addEventListener('input', update);
  el.currency.addEventListener('change', update);
  el.network.addEventListener('change', () => { void connection?.forget(); connection = makeConnection(); renderWallet(connection.getState()); });
  el.connect.addEventListener('click', () => { if (config?.enabled) void connection.connect(); });
  el.forget.addEventListener('click', () => { void connection.forget(); });
  el.account.addEventListener('change', () => connection.selectAccount(el.account.value));
  el.copy.addEventListener('click', async () => { const u = connection.getState().uri; if (u) try { await navigator.clipboard.writeText(u); } catch { /* QR instead */ } });
  window.addEventListener('pagehide', () => { void connection?.forget(); });

  const [h, c] = await Promise.all([
    fetch(`${WORKER}/health`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null),
    fetch('/wallet-config.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
  ]);
  health = h?.ok ? h : null;
  config = c;
  const mainnet = health?.wallet?.mainnet;
  const mOpt = el.network.querySelector('option[value="mainnet"]');
  mOpt.disabled = !mainnet?.enabled;
  mOpt.textContent = mainnet?.enabled ? 'Hedera mainnet (real money)' : 'Hedera mainnet — switched off';
  connection = makeConnection();
  renderWallet(connection.getState());
  if (!config?.enabled) el.wstatus.textContent = config?.runtimeReady ? 'HashPack pairing is not configured on this site yet (no Reown project ID).' : 'HashPack pairing is not available on this site yet (wallet runtime and Reown project ID not deployed). Use the testnet demo fan below to see the loop.';
  if (!artist) say('Open this page from an artist’s card (…/pay?artist=<name>) to pay that artist from your own wallet.');
  else if (!health?.wallet?.testnet?.enabled) say('The wallet-tip service is not reachable right now (or not deployed yet). Nothing will be simulated.');
  el.fields.disabled = false;
}
