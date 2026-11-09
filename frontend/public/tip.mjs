// 💸 Tip the artist — on any Ethereum chain, straight from the fan's own wallet.
//
// Two modes:
//   · one artist        — 96.31% to the artist, 3.69% to the steward (one transfer if they share a wallet);
//   · 🎻 whole orchestra — one amount, 96.31% split EQUALLY across every distinct tippable wallet, 3.69% (+ the
//     integer dust) to the steward. ERC-20 tips go as ONE EIP-5792 atomic batch when the wallet supports it,
//     otherwise one transfer at a time with progress.
// One primary action at a time: Connect → Switch network → Review → Send. No contract, no server, no custody.
//
// Safety model (QA 9 Nov 2026): a stored tip is only ever INTENT. Before EVERY transfer — fresh or resumed —
// the page re-fetches the kill switch, re-reads ENS (two RPCs must agree), re-checks pins, limits, chain, account
// and the token contract, rebuilds the plan, and only continues if it equals the stored legs. Each transaction
// carries its chainId. The wallet nonce is recorded before every prompt: a leg is re-sent only if the nonce
// provably did not move. One tab at a time (Web Locks).
//
// Pure logic + tests: tip-core.mjs (frontend/test/tip-core.test.mjs). ENS reads: tip-ens.mjs.
import * as core from './tip-core.mjs';
import { makeClients, readName, readEthUsd } from './tip-ens.mjs';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LEDGER_KEY = 'oso-tip-ledger-v1';
const STANDALONE = !!document.getElementById('tip-root');
const FRAMED = (() => { try { return window.top !== window.self; } catch { return true; } })();
const PRUNE_MS = 30 * 24 * 3600e3;

const S = {
  config: null, chains: [], byId: new Map(), artists: [], bySlug: new Map(), registry: { artists: {} },
  mode: 'one', slug: null, network: 'mainnet', chainId: null, asset: 'usdc', amount: '5',
  wallets: new Map(), wallet: null, busy: false, names: new Map(), price: null,
  plan: null, record: null, confirm: null, status: '', statusKind: 'info', clients: null, loaded: null, form: 0,
};

/* ── config (kill switch): fetched fresh before every review and every transfer ─────────────── */
async function fetchConfig() {
  try {
    const r = await fetch(`/tip-config.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const c = await r.json();
    if (!c || typeof c !== 'object' || typeof c.enabled !== 'boolean' || !core.ADDRESS_RE.test(c.stewardPin ?? '')) throw new Error('malformed');
    return c;
  } catch {
    return { enabled: false, mainnet: false, reason: 'The tip switchboard could not be read, so tips are off (fail closed).' };
  }
}
function gate(cfg, c) {
  if (FRAMED) throw new Error('this page is inside a frame — open it directly to tip');
  if (!cfg.enabled) throw new Error(`tips are switched off right now${cfg.reason ? ` — ${cfg.reason}` : ''}`);
  if (!c) throw new Error('that chain is not offered');
  if (!c.testnet && !cfg.mainnet) throw new Error('mainnet tips are switched off right now');
  if ((cfg.disabledChains ?? []).includes(c.chainId)) throw new Error(`${c.name} is paused right now`);
}

async function load() {
  const get = (u) => fetch(u, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${u} ${r.status}`))));
  const [config, chains, artists, registry] = await Promise.all([
    fetchConfig(),
    get('/tip-chains.json').catch(() => null),
    get('/data/artists.json').catch(() => ({ artists: [] })),
    get('/fork/registry.json').catch(() => ({ artists: {} })),
  ]);
  S.config = config;
  S.chains = Array.isArray(chains?.chains) ? chains.chains : [];
  S.chainsVerifiedAt = chains?.verifiedAt ?? null;
  S.byId = new Map(S.chains.map((c) => [c.chainId, c]));
  S.artists = artists.artists ?? [];
  S.bySlug = new Map(S.artists.map((a) => [a.slug, a]));
  S.registry = registry && typeof registry.artists === 'object' ? registry : { artists: {} };
  if (!S.config.mainnet) S.network = 'testnet';
}

/** Host cards paid on a name Shaka owns (tip-config `hostPayees`, e.g. the orchestra → osoartist.eth). Must equal their pin. */
function hostPayee(slug) {
  const h = S.config?.hostPayees?.[slug];
  return h && typeof h.ens === 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/.test(h.ens) ? h : null;
}
function ensFor(slug) {
  const host = hostPayee(slug);
  if (host) return host.ens;
  const r = S.registry.artists?.[slug];
  return r && r.status === 'issued' && typeof r.ens === 'string' && r.ens.endsWith('.osoartist.eth') ? r.ens : null;
}
const nameOf = (slug) => S.bySlug.get(slug)?.name ?? slug;

function circleSlugs() {
  const p = new URLSearchParams(location.search);
  const who = p.get('who') ?? p.get('artist');
  let list = [];
  if (who === 'everyone' || who === 'all') list = S.artists.map((a) => a.slug);
  else if (who) list = who.split(',').map((s) => s.trim()).filter((s) => S.bySlug.has(s));
  if (!list.length) list = S.artists.map((a) => a.slug);
  return [...new Set(list)].sort((a, b) => (ensFor(b) ? 1 : 0) - (ensFor(a) ? 1 : 0));
}
/** The whole orchestra = every card in the garden that can be paid (not only the ones in this circle). */
const orchestraSlugs = () => [...new Set([...S.artists.map((a) => a.slug), ...Object.keys(S.config?.hostPayees ?? {})])].filter(ensFor);

const visibleChains = () => S.chains.filter((c) => (S.network === 'testnet' ? c.testnet : !c.testnet) && !(S.config.disabledChains ?? []).includes(c.chainId));
const chain = () => S.byId.get(S.chainId) ?? null;

function assetFor(c, kind = S.asset) {
  if (!c) return null;
  if (kind === 'usdc' && c.usdc) return { kind: 'erc20', address: c.usdc.address, decimals: c.usdc.decimals, symbol: c.usdc.symbol, issuer: c.usdc.issuer, ui: 'usdc' };
  if (kind === 'native' && c.nativeTip) return { kind: 'native', decimals: 18, symbol: c.nativeCurrency.symbol, ui: 'eth' };
  return null;
}
function limits(a, cfg = S.config) {
  const L = cfg.limits ?? {};
  return a?.ui === 'eth' ? { min: L.minEth ?? '0.0001', max: L.maxEth ?? '0.05', symbol: a.symbol } : { min: L.minUsdc ?? '0.01', max: L.maxUsdc ?? '100', symbol: a?.symbol ?? 'USDC' };
}

/* ── ENS (lazy, two RPCs must agree) ───────────────────────────────────────────────────── */
async function clients() {
  S.clients ??= await makeClients(S.config.ensRpcUrls ?? ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://1rpc.io/eth']);
  return S.clients;
}
async function refreshNames() {
  const cl = await clients();
  const slugs = [...new Set([...circleSlugs(), ...orchestraSlugs()])].filter(ensFor);
  await Promise.all(slugs.map(async (slug) => {
    if (S.names.get(slug)?.state === 'ok') return;
    S.names.set(slug, { state: 'loading' });
    try {
      S.names.set(slug, { state: 'ok', data: await readName(cl, ensFor(slug), [], { requireConsent: !hostPayee(slug) }) });
    } catch (e) {
      S.names.set(slug, { state: 'no', message: e.message, code: e.code });
    }
  }));
  if (!S.price) S.price = await readEthUsd(cl);
  render();
}

/* ── wallets (EIP-6963 + legacy injected) ──────────────────────────────────────────────── */
function discover() {
  addEventListener('eip6963:announceProvider', (ev) => {
    const { info, provider } = ev.detail ?? {};
    if (!info || typeof info.uuid !== 'string' || !provider || typeof provider.request !== 'function') return;
    if (S.wallets.size >= 12 || S.wallets.has(info.uuid)) return;
    S.wallets.set(info.uuid, { id: info.uuid, name: String(info.name ?? 'Wallet').slice(0, 40), icon: /^data:image\/(png|svg\+xml|webp|jpeg);/.test(info.icon ?? '') ? info.icon : null, provider });
    render();
  });
  dispatchEvent(new Event('eip6963:requestProvider'));
  setTimeout(() => {
    if (!S.wallets.size && window.ethereum && typeof window.ethereum.request === 'function') {
      S.wallets.set('injected', { id: 'injected', name: 'Browser wallet', icon: null, provider: window.ethereum });
      render();
    }
  }, 400);
}
function onWalletEvent() {
  if (!S.wallet) return;
  const w = S.wallet;
  w.provider.request({ method: 'eth_accounts' }).then(async (acc) => {
    const chainHex = await w.provider.request({ method: 'eth_chainId' });
    if (S.wallet !== w) return;
    const account = Array.isArray(acc) && core.ADDRESS_RE.test(acc[0] ?? '') ? acc[0] : null;
    const changed = !core.sameAddress(account, w.account) || Number(BigInt(chainHex)) !== w.chainId;
    w.account = account;
    w.chainId = Number(BigInt(chainHex));
    if (!account) S.wallet = null;
    if (changed && S.plan && !S.busy) { S.plan = null; setStatus('Your wallet changed — review the tip again.', 'warn'); }
    render();
  }).catch(() => {});
}
async function connect(id) {
  const w = S.wallets.get(id);
  if (!w || S.busy) return;
  await guard('connect', async () => {
    setStatus(`Approve the connection in ${w.name}. Connecting asks for your address only — nothing is signed or sent.`);
    const acc = await w.provider.request({ method: 'eth_requestAccounts' });
    const chainHex = await w.provider.request({ method: 'eth_chainId' });
    if (!Array.isArray(acc) || !core.ADDRESS_RE.test(acc[0] ?? '')) throw new Error('the wallet shared no account');
    if (S.wallet?.provider && S.wallet.provider !== w.provider) detach(S.wallet.provider);
    S.wallet = { id, name: w.name, provider: w.provider, account: acc[0], chainId: Number(BigInt(chainHex)) };
    w.provider.on?.('accountsChanged', onWalletEvent);
    w.provider.on?.('chainChanged', onWalletEvent);
    setStatus(`Connected ${core.shortAddress(acc[0])} in ${w.name}.`, 'ok');
  });
}
function detach(p) {
  p.removeListener?.('accountsChanged', onWalletEvent);
  p.removeListener?.('chainChanged', onWalletEvent);
}
async function switchTo(c) {
  try {
    await S.wallet.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: core.chainHex(c.chainId) }] });
  } catch (e) {
    const unknown = e?.code === 4902 || e?.data?.originalError?.code === 4902 || /unrecognized|not added|unknown chain/i.test(String(e?.message));
    if (!unknown) throw e;
    setStatus(`${S.wallet.name} doesn't know ${c.name} yet — asking it to add the network (chain id ${c.chainId}, ${c.rpcUrls[0]}).`);
    await S.wallet.provider.request({ method: 'wallet_addEthereumChain', params: [core.addChainParams(c)] });
  }
  const now = Number(BigInt(await S.wallet.provider.request({ method: 'eth_chainId' })));
  S.wallet.chainId = now;
  if (now !== c.chainId) throw new Error(`the wallet is still on chain ${now}`);
}
async function switchChain() {
  const c = chain();
  if (!c || !S.wallet) return;
  await guard('switch', async () => {
    setStatus(`Asking ${S.wallet.name} to switch to ${c.name}…`);
    await switchTo(c);
    setStatus(`On ${c.name}.`, 'ok');
  });
}

/* ── the plan: built from scratch from INTENT, every time ──────────────────────────────── */
const rq = (method, params) => S.wallet.provider.request({ method, params });
const stop = (msg, code) => Object.assign(new Error(msg), { code: code ?? 'stop' });

async function payeeFor(r, id) {
  const needEthCode = r.eth && !r.perChain[id] && !r.defaultEvm;
  const needDefCode = r.defaultEvm && !r.perChain[id];
  const [codeOnTarget, defaultCodeOnTarget] = await Promise.all([
    needEthCode ? rq('eth_getCode', [r.eth, 'latest']).catch(() => null) : '0x',
    needDefCode ? rq('eth_getCode', [r.defaultEvm, 'latest']).catch(() => null) : null,
  ]);
  return core.pickPayout({ chainId: id, specific: r.perChain[id], defaultEvm: r.defaultEvm, eth: r.eth, ethCodeOnMainnet: r.ethCodeOnMainnet, codeOnTarget,
    defaultCodeOnMainnet: r.defaultEvm ? r.defaultCodeOnMainnet : undefined, defaultCodeOnTarget: r.defaultEvm ? defaultCodeOnTarget : undefined });
}

/**
 * intent: { kind: 'single'|'orchestra', chainId, assetKind: 'usdc'|'native', slug?, total: bigint, fan }
 * opts.record: an existing tip being continued (balance/gas are checked for its unfinished legs only).
 */
async function buildPlan(intent, { record = null, cache = null } = {}) {
  const cfg = await fetchConfig();
  S.config = cfg;
  const c = S.byId.get(intent.chainId);
  gate(cfg, c);
  const a = assetFor(c, intent.assetKind);
  if (!a) throw stop('pick a token');
  const lim = limits(a, cfg);
  const lo = core.toAtomic(lim.min, a.decimals), hi = core.toAtomic(lim.max, a.decimals);
  if (lo == null || hi == null || intent.total < lo || intent.total > hi) throw stop(`pick an amount from ${lim.min} to ${lim.max} ${a.symbol}`);
  const live = Number(BigInt(await rq('eth_chainId', [])));
  if (live !== c.chainId) throw stop(`your wallet is on chain ${live}, not ${c.name} (${c.chainId}) — switch back`);
  const [acc] = await rq('eth_accounts', []);
  if (!core.sameAddress(acc, intent.fan)) throw stop(`connect the wallet that ${record ? 'started this tip' : 'you chose'} (${core.shortAddress(intent.fan)})`);
  // never let a fan send into a chain that stopped producing blocks (e.g. a sunset L2)
  const head = await rq('eth_getBlockByNumber', ['latest', false]);
  const age = Math.floor(Date.now() / 1000) - Number(core.hexToBigInt(head?.timestamp ?? '0x0'));
  if (!(age < 600)) throw stop(`${c.name} has not produced a block for ${Math.round(age / 60)} minutes — it looks stopped, so tips there are refused`);
  if (a.kind === 'erc20') {
    const [code, dec, sym] = await Promise.all([
      rq('eth_getCode', [a.address, 'latest']),
      rq('eth_call', [{ to: a.address, data: core.DECIMALS_SELECTOR }, 'latest']),
      rq('eth_call', [{ to: a.address, data: core.SYMBOL_SELECTOR }, 'latest']),
    ]);
    if (!code || code === '0x') throw stop(`no token contract at ${a.address} on this chain — refusing`);
    if (Number(core.hexToBigInt(dec)) !== a.decimals) throw stop(`the token says ${Number(core.hexToBigInt(dec))} decimals, expected ${a.decimals} — refusing`);
    if (core.decodeString(sym) !== a.symbol) throw stop(`the token says "${core.decodeString(sym)}", expected ${a.symbol} — refusing`);
  }
  const cl = await clients();
  const id = c.testnet ? c.testnetOf : c.chainId; // testnets pay the same ENS-resolved addresses as their mainnet
  // within one send session the same ENS answers are reused for 2 minutes (they were just verified by 2 RPCs)
  const read = (name, opts) => {
    const k = `${name}|${id}|${opts.requireConsent}`;
    const hit = cache?.get(k);
    if (hit && Date.now() - hit.at < 120_000) return hit.p;
    const p = readName(cl, name, [id], opts);
    cache?.set(k, { at: Date.now(), p });
    p.catch(() => cache?.delete(k));
    return p;
  };
  const stw = await read(cfg.stewardEns ?? 'osoartist.eth', { requireConsent: false });
  const ps = await payeeFor(stw, id);
  if (!ps.ok) throw stop(`steward ${stw.name}: ${ps.message}`);
  if (!core.sameAddress(ps.address, cfg.stewardPin)) throw stop('the steward address on osoartist.eth no longer matches the published one — tips are paused for safety');
  const resolveSlug = async (slug) => {
    const ens = ensFor(slug);
    if (!ens) throw stop(`${nameOf(slug)} has not switched tips on yet`);
    const host = hostPayee(slug);
    const r = await read(ens, { requireConsent: !host });
    const p = await payeeFor(r, id);
    if (!p.ok) throw stop(`${ens}: ${p.message}`);
    if (host && !core.sameAddress(p.address, host.pin ?? cfg.stewardPin)) throw stop(`${ens} no longer points at the published orchestra wallet — tips are paused for safety`);
    return { slug, label: ens, name: nameOf(slug), address: p.address, source: p.source };
  };
  let plan, skipped = [];
  if (intent.kind === 'orchestra') {
    const got = await Promise.all(orchestraSlugs().map((s) => resolveSlug(s).then((x) => ({ ok: x }), (e) => ({ slug: s, err: e }))));
    // an artist who paused, has no/odd records or no consent is left out (and named); an RPC problem stops the review
    const SKIP = new Set(['stop', 'no-consent', 'paused', 'bad-record', 'bad-name']);
    if (got.some((g) => g.err && !SKIP.has(g.err.code))) {
      const bad = got.find((g) => g.err && !SKIP.has(g.err.code));
      throw stop(`could not check ${nameOf(bad.slug)} right now (${bad.err.message}) — try again`);
    }
    skipped = got.filter((g) => g.err).map((g) => ({ slug: g.slug, why: g.err.message }));
    const recipients = got.filter((g) => g.ok).map((g) => g.ok);
    plan = core.planOrchestra({ chainId: c.chainId, asset: a, fan: intent.fan, recipients, steward: { address: ps.address, label: stw.name }, total: intent.total });
  } else {
    const r = await resolveSlug(intent.slug);
    plan = core.planTip({ chainId: c.chainId, asset: a, fan: intent.fan, artist: { address: r.address, label: r.label, source: r.source }, steward: { address: ps.address, label: stw.name, source: ps.source }, total: intent.total });
  }
  if (!plan.ok) throw stop(plan.problems.join('; '));
  // balances + gas for what is still to be sent, read through the fan's own wallet
  const pending = record ? plan.legs.filter((l, i) => record.legs[i]?.state !== 'confirmed') : plan.legs;
  const need = pending.reduce((s, l) => s + l.amount, 0n);
  const bal = a.kind === 'erc20' ? core.hexToBigInt(await rq('eth_call', [{ to: a.address, data: core.encodeBalanceOf(intent.fan) }, 'latest'])) : core.hexToBigInt(await rq('eth_getBalance', [intent.fan, 'latest']));
  if (bal < need) throw stop(`this wallet holds ${core.fromAtomic(bal, a.decimals)} ${a.symbol} on ${c.name} — not enough for ${core.fromAtomic(need, a.decimals)}`);
  const gasBal = a.kind === 'native' ? bal : core.hexToBigInt(await rq('eth_getBalance', [intent.fan, 'latest']));
  if (gasBal === 0n) throw stop(`this wallet has no ${c.nativeCurrency.symbol} on ${c.name} to pay the network fee`);
  for (const l of pending) {
    try {
      l.gas = await rq('eth_estimateGas', [l.tx]);
    } catch (e) {
      throw stop(`the transfer to ${l.label} would fail: ${core.walletErrorText(e)}`);
    }
  }
  return { ...plan, kind: intent.kind, intent, chain: c, skipped };
}

async function review() {
  const c = chain();
  const a = assetFor(c);
  const form = S.form;
  await guard('review', async () => {
    if (!a) throw stop('pick a token');
    const amt = core.parseAmount(S.amount, a.decimals, limits(a));
    if (!amt.ok) throw stop(amt.message);
    if (S.mode === 'one' && !ensFor(S.slug)) throw stop('this artist has not switched tips on yet');
    setStatus('Checking the chain, the token contract and every payee (two Ethereum RPCs must agree)…');
    const slow = setTimeout(() => S.busy === 'review' && setStatus('Still checking — public RPCs are slow right now…'), 15_000);
    try {
      const plan = await buildPlan({ kind: S.mode === 'orchestra' ? 'orchestra' : 'single', chainId: c.chainId, assetKind: S.asset, slug: S.slug, total: amt.total, fan: S.wallet.account });
      if (form !== S.form) return setStatus('You changed something while it was checking — review again.', 'warn');
      if (S.config.batch === true && plan.kind === 'orchestra' && plan.asset.kind === 'erc20') {
        const caps = await rq('wallet_getCapabilities', [S.wallet.account, [core.chainHex(c.chainId)]]).catch(() => null);
        plan.atomic = core.atomicSupport(caps, c.chainId);
      }
      S.plan = { ...plan, id: core.newTipId(), createdAt: new Date().toISOString() };
      setStatus('Everything checks out. Read it once more, then send.', 'ok');
    } finally {
      clearTimeout(slow);
    }
  });
}

/* ── the ledger (this browser only) ────────────────────────────────────────────────────── */
const CLAIMED_KEY = 'oso-tip-claimed-v1';
function ledger() {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(LEDGER_KEY) ?? '{}') ?? {}; } catch { all = {}; }
  return all && typeof all === 'object' ? all : {};
}
function writeLedger(all) {
  try { localStorage.setItem(LEDGER_KEY, JSON.stringify(all, (k, v) => (typeof v === 'bigint' ? v.toString() : v))); return true; } catch { return false; }
}
/** In the send path a note that can't be saved is a hard stop: without it the page could not prove what it sent. */
function saveRecord(r) {
  const all = ledger();
  all[r.id] = r;
  if (!writeLedger(all)) throw stop('this browser refused to save the tip note (storage full or private mode) — nothing more is sent; free some space or use a normal window');
}
function readRecord(id) {
  const r = ledger()[id];
  return core.validRecord(r) ? r : null;
}
function openRecords() {
  const all = ledger();
  let dirty = false;
  const out = [];
  for (const [k, r] of Object.entries(all)) {
    if (!core.validRecord(r)) { delete all[k]; dirty = true; continue; }
    const done = r.legs.every((l) => l.state === 'confirmed');
    if (done && Date.now() - Date.parse(r.createdAt ?? 0) > PRUNE_MS) { delete all[k]; dirty = true; continue; }
    if (!done) out.push(r);
  }
  if (dirty) writeLedger(all);
  return out;
}
/** Transfers this browser already attributed to some leg, per LOG (tx:logIndex) and per (tx, payee) — one batch tx
 *  carries many transfers, so a whole tx hash is never "taken" by a single leg. */
function claimedKeys() {
  const set = new Set();
  for (const r of Object.values(ledger())) for (const l of r?.legs ?? []) if (l.state === 'confirmed' && core.HASH_RE.test(l.hash ?? '') && core.ADDRESS_RE.test(l.to ?? '')) set.add(`${l.hash}:${l.to}`.toLowerCase());
  try { for (const k of JSON.parse(localStorage.getItem(CLAIMED_KEY) ?? '[]')) set.add(String(k).toLowerCase()); } catch { /* none */ }
  return set;
}
function claim(key) {
  try {
    const list = JSON.parse(localStorage.getItem(CLAIMED_KEY) ?? '[]');
    list.push(key.toLowerCase());
    localStorage.setItem(CLAIMED_KEY, JSON.stringify(list.slice(-1000)));
  } catch { /* the leg itself also stores the hash */ }
}
function recordFromPlan(p) {
  return {
    id: p.id, createdAt: p.createdAt, kind: p.kind, chainId: p.chainId, artistSlug: p.intent.slug ?? null, fan: p.fan,
    asset: { kind: p.asset.kind, address: p.asset.address ?? null, decimals: p.asset.decimals, symbol: p.asset.symbol }, assetKind: p.intent.assetKind,
    total: p.total.toString(),
    legs: p.legs.map((l) => ({ leg: l.leg, to: l.to, label: l.label, amount: l.amount.toString(), state: 'planned', hash: null, hashes: [], nonce: null, block: null })),
  };
}
const intentOf = (r) => ({ kind: r.kind ?? 'single', chainId: r.chainId, assetKind: r.assetKind ?? (r.asset.kind === 'native' ? 'native' : 'usdc'), slug: r.artistSlug, total: BigInt(r.total), fan: r.fan });
const randHex = (n) => '0x' + [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

/* ── send ──────────────────────────────────────────────────────────────────────────────── */
const TAB = randHex(8);
/** One tab per tip: Web Locks, or a short localStorage lease where Web Locks don't exist. */
async function withTipLock(id, fn) {
  if (navigator.locks?.request) {
    return navigator.locks.request(`oso-tip-${id}`, { ifAvailable: true }, async (lock) => {
      if (!lock) throw stop('this tip is being sent from another tab — finish it there');
      return fn();
    });
  }
  const key = `oso-tip-lease-${id}`;
  const take = () => {
    try {
      const cur = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (cur && cur.tab !== TAB && cur.until > Date.now()) return false;
      localStorage.setItem(key, JSON.stringify({ tab: TAB, until: Date.now() + 60_000 }));
      return JSON.parse(localStorage.getItem(key)).tab === TAB;
    } catch { return false; }
  };
  if (!take()) throw stop('this tip is being sent from another tab (or the browser blocks storage) — finish it there');
  const renew = setInterval(take, 20_000);
  try { return await fn(); } finally { clearInterval(renew); try { localStorage.removeItem(key); } catch { /* */ } }
}

async function send(record, { confirmLeg = null, confirmBatch = false } = {}) {
  await guard('send', async () => {
    await withTipLock(record.id, () => sendLocked(record.id, record, { confirmLeg, confirmBatch }));
  });
}

const nonceOf = async (fan, tag) => core.hexToBigInt(await rq('eth_getTransactionCount', [fan, tag]));
const pad32 = (a) => '0x' + a.slice(2).toLowerCase().padStart(64, '0');
const isContractAccount = async (a) => core.isContractCode(await rq('eth_getCode', [a, 'latest']).catch(() => '0x'));

async function sendLocked(id, initial, confirm) {
  if (!readRecord(id)) saveRecord(initial);
  const cache = new Map();
  try {
    for (let n = 0; n < 200; n++) {
      const record = readRecord(id); // always the stored truth (another tab may have moved it)
      if (!record) throw stop('this tip note is unreadable — nothing was sent from it');
      S.record = record;
      S.confirm = null;
      const c = S.byId.get(record.chainId);
      render();
      // a batch in flight (or in doubt) is settled before anything else
      if (record.batch && ['prompting', 'sent', 'unknown'].includes(record.batch.state)) {
        await settleBatch(record, c, confirm);
        continue;
      }
      const next = core.nextLeg(record);
      if (next.action === 'done') break;
      if (next.action === 'stop') throw stop(`the transfer to ${next.leg.label} needs a look on the explorer before anything else is sent${next.leg.note ? ` (${next.leg.note})` : ''}`);
      const i = record.legs.indexOf(next.leg);
      if (next.action === 'wait') { await waitLeg(record, i, c); continue; }
      if (next.action === 'check') {
        const verdict = await checkLeg(record, i, confirm);
        if (verdict === 'confirmed') continue;
      }
      // 'send' — re-plan from scratch and require the same legs
      const fresh = await buildPlan(intentOf(record), { record, cache });
      if (!core.legsEqual(fresh.legs, record.legs)) throw stop('the payees or amounts changed since this tip was planned (ENS or the switchboard changed)');
      if (S.config.batch === true && record.kind === 'orchestra' && record.asset.kind === 'erc20' && record.legs.length > 1 && record.legs.every((l) => l.state === 'planned') && !record.batch?.fallback) {
        const caps = await rq('wallet_getCapabilities', [record.fan, [core.chainHex(record.chainId)]]).catch(() => null);
        if (core.atomicSupport(caps, record.chainId) && await startBatch(record, fresh, c)) continue;
      }
      await sendLeg(record, i, fresh.legs[i].tx, c);
    }
  } catch (e) {
    // never tell a fan to "start again" when part of the tip already went out
    const r = readRecord(id);
    const done = r ? r.legs.filter((l) => l.state === 'confirmed') : [];
    if (r && done.length && done.length < r.legs.length && e?.code !== 4001) {
      const notSent = r.legs.filter((l) => ['planned', 'rejected', 'failed'].includes(l.state));
      const doubt = r.legs.filter((l) => l.state !== 'confirmed' && !notSent.includes(l));
      throw Object.assign(new Error(`${done.length} of ${r.legs.length} transfers went out (${done.map((l) => l.label).join(', ')} — see the links).${notSent.length ? ` Not sent: ${notSent.map((l) => l.label).join(', ')}.` : ''}${doubt.length ? ` In doubt — check the explorer: ${doubt.map((l) => l.label).join(', ')}.` : ''} Reason: ${e.message}. Please don’t start a new tip for the same people unless you mean to pay them again.`), { code: e?.code === 'confirm' ? 'confirm' : 'partial' });
    }
    throw e;
  }
  const r = readRecord(id);
  setStatus(`Done — ${core.fromAtomic(r.total, r.asset.decimals)} ${r.asset.symbol} went straight to ${r.kind === 'orchestra' ? `${r.legs.length} wallet${r.legs.length > 1 ? 's' : ''} of the orchestra` : r.legs[0].label}. Mahalo 🌺`, 'ok');
}

/** A leg whose earlier attempt is unclear: find it onchain, else prove nothing went out, else ask the fan. */
async function checkLeg(record, i, confirm) {
  const l = record.legs[i];
  if (await findTransfer(record, l)) return 'confirmed';
  const label = `transfer ${i + 1}${record.legs.length > 1 ? ` of ${record.legs.length}` : ''} (${l.label})`;
  if (await isContractAccount(record.fan)) {
    // smart-account wallets keep their nonce elsewhere — the page can't prove nothing went out
    if (l.state === 'rejected' || (confirm.confirmLeg === i && record.asset.kind !== 'native')) return 'send';
    if (record.asset.kind === 'native') { l.state = 'mismatch'; l.note = 'smart account + ETH: cannot be proven'; saveRecord(record); throw stop(`your wallet is a smart account, so this page can’t prove ${label} didn’t go out — check your wallet’s activity; it does not re-send ETH transfers`); }
    S.confirm = { kind: 'leg', i, text: `Your wallet is a smart account, so this page can’t prove ${label} didn’t go out. Check your wallet’s activity first. Only if it is NOT there, press “send it again”.` };
    throw stop(`check your wallet’s activity for ${label} before sending it again`, 'confirm');
  }
  const pending = await nonceOf(record.fan, 'pending');
  if (l.nonce == null || pending !== BigInt(l.nonce)) {
    l.state = 'mismatch';
    l.note = 'a transaction from this wallet may already have gone out';
    saveRecord(record);
    throw stop(`a transaction from this wallet may already have gone out for ${label} — check the explorer; this page will not send it again`);
  }
  if (l.state === 'rejected' || (confirm.confirmLeg === i && record.asset.kind !== 'native')) return 'send';
  if (record.asset.kind === 'native') {
    // ETH has no transfer log to find a late approval with — never offer a blind re-send (QA4 H9)
    l.state = 'mismatch';
    l.note = 'an earlier ETH request may still be open or approved in the wallet';
    saveRecord(record);
    throw stop(`the earlier wallet request for ${label} may still be open or already approved — check your wallet’s activity; this page does not re-send ETH transfers`);
  }
  S.confirm = { kind: 'leg', i, text: `Check your wallet’s activity first: if ${label} is listed there — even as pending — do NOT press. Otherwise reject/close any request still open in your wallet, then press “send it again”.` };
  throw stop(`close any open request in your wallet, then confirm to send ${label} again`, 'confirm');
}

async function sendLeg(record, i, tx, c) {
  const l = record.legs[i];
  const n = i + 1;
  const retry = l.state !== 'planned' && l.state !== 'failed';
  if (retry) {
    // last look right before the prompt: did the earlier attempt land meanwhile, or did the wallet send anything?
    if (await findTransfer(record, l)) return;
    if (l.nonce != null && !(await isContractAccount(record.fan)) && (await nonceOf(record.fan, 'pending')) !== BigInt(l.nonce)) {
      l.state = 'mismatch';
      l.note = 'a transaction from this wallet went out just before the re-send';
      saveRecord(record);
      throw stop(`a transaction from this wallet went out just now — check the explorer before anything else; transfer ${n} was not sent again`);
    }
  }
  const pendingNonce = await nonceOf(record.fan, 'pending');
  l.nonce = pendingNonce.toString();
  tx = { ...tx, nonce: '0x' + pendingNonce.toString(16) }; // wallets that honour it can never run two copies
  l.block = (core.hexToBigInt(await rq('eth_blockNumber', []))).toString();
  l.state = 'prompting'; // saved BEFORE the prompt: a reload/close now can never lead to a blind re-send
  saveRecord(record);
  setStatus(`Transfer ${n} of ${record.legs.length}: confirm ${core.fromAtomic(l.amount, record.asset.decimals)} ${record.asset.symbol} → ${l.label} in your wallet.`);
  render();
  let hash;
  try {
    hash = await rq('eth_sendTransaction', [tx]);
  } catch (e) {
    l.state = e?.code === 4001 ? 'rejected' : 'unknown';
    l.note = e?.code === 4001 ? null : core.walletErrorText(e);
    saveRecord(record);
    throw e?.code === 4001 ? e : stop(`the wallet answered with an error for transfer ${n} (${core.walletErrorText(e)}). It may or may not have gone out — press continue: the page searches the chain and checks your nonce first, and never sends it twice`);
  }
  if (!core.HASH_RE.test(hash ?? '')) {
    l.state = 'unknown';
    saveRecord(record);
    throw stop('the wallet returned no transaction hash — press continue to check');
  }
  l.hash = hash;
  l.hashes = [...(l.hashes ?? []), hash];
  l.state = 'sent';
  saveRecord(record);
  const t = await rq('eth_getTransactionByHash', [hash]).catch(() => null);
  if (t?.nonce) { l.nonce = core.hexToBigInt(t.nonce).toString(); saveRecord(record); } // the tx's real nonce
  const now = Number(BigInt(await rq('eth_chainId', [])));
  if (now !== record.chainId) throw stop(`your wallet moved to chain ${now} — switch back to ${c.name} so the page can confirm transfer ${n}`);
  await waitLeg(record, i, c);
  if (retry && record.asset.kind === 'erc20') {
    const logs = await rq('eth_getLogs', [{ address: record.asset.address, fromBlock: '0x' + BigInt(l.block).toString(16), toBlock: 'latest', topics: [core.TRANSFER_TOPIC, pad32(record.fan), pad32(l.to)] }]).catch(() => []);
    const same = (logs ?? []).filter((x) => { try { return BigInt(x.data) === BigInt(l.amount); } catch { return false; } });
    if (same.length > 1) { l.note = `paid ${same.length}× — the earlier request was approved too`; saveRecord(record); throw stop(`heads-up: ${l.label} received this transfer ${same.length} times (the earlier wallet request was approved as well). Nothing more will be sent.`); }
  }
}

/** Poll a sent leg. Never re-sends. Detects speed-ups/cancels through the nonce + Transfer logs. */
async function waitLeg(record, i, c) {
  const l = record.legs[i];
  setStatus(`Waiting for ${c.name} to include transfer ${i + 1} of ${record.legs.length}…`);
  render();
  const t0 = Date.now();
  while (Date.now() - t0 < 10 * 60_000) {
    const now = Number(BigInt(await rq('eth_chainId', [])));
    if (now !== record.chainId) throw stop(`switch your wallet back to ${c.name} so the page can confirm transfer ${i + 1} (it is not sent again)`);
    const receipt = await rq('eth_getTransactionReceipt', [l.hash]).catch(() => null);
    if (receipt) {
      const tx = record.asset.kind === 'native' ? await rq('eth_getTransactionByHash', [l.hash]).catch(() => null) : null;
      const r = core.checkLegReceipt({ asset: record.asset, fan: record.fan, leg: { to: l.to, amount: BigInt(l.amount) }, receipt, tx });
      if (r.done) {
        l.state = r.ok ? 'confirmed' : r.code === 'reverted' ? 'failed' : 'mismatch';
        l.note = r.reason ?? null;
        saveRecord(record);
        render();
        if (!r.ok && r.code !== 'reverted') throw stop(r.reason);
        if (!r.ok) throw stop(`${r.reason}. Press continue to send this transfer again.`);
        return;
      }
    } else if (l.nonce != null && !(await isContractAccount(record.fan)) && (await nonceOf(record.fan, 'latest')) > BigInt(l.nonce)) {
      // the nonce is used but this hash has no receipt (yet): give a lagging RPC a moment, then it was sped up or cancelled
      let late = null;
      for (let k = 0; k < 3 && !late; k++) { await new Promise((res) => setTimeout(res, 3000)); late = await rq('eth_getTransactionReceipt', [l.hash]).catch(() => null); }
      if (late) continue;
      if (await findTransfer(record, l)) return;
      l.state = 'mismatch';
      l.note = 'this transaction was replaced in the wallet (sped up or cancelled) and no matching transfer was found';
      saveRecord(record);
      throw stop(`transfer ${i + 1} was replaced in your wallet and no matching transfer is onchain — check the explorer; this page will not send it again`);
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw stop(`transfer ${i + 1} is still not included after 10 minutes — it stays “sent”; press continue later to check again (it is never sent twice)`);
}

/** ERC-20 only: an exact, not-yet-claimed Transfer(fan → payee, amount) since this leg was first attempted? */
async function findTransfer(record, l) {
  if (record.asset.kind !== 'erc20' || l.block == null) return false;
  try {
    const logs = await rq('eth_getLogs', [{ address: record.asset.address, fromBlock: '0x' + BigInt(l.block).toString(16), toBlock: 'latest', topics: [core.TRANSFER_TOPIC, pad32(record.fan), pad32(l.to)] }]);
    const taken = claimedKeys();
    const free = (x) => !taken.has(`${x.transactionHash}:${x.logIndex}`.toLowerCase()) && !taken.has(`${x.transactionHash}:${l.to}`.toLowerCase());
    const hit = (logs ?? []).find((x) => { try { return BigInt(x.data) === BigInt(l.amount) && free(x); } catch { return false; } });
    if (!hit) return false;
    claim(`${hit.transactionHash}:${hit.logIndex}`);
    l.state = 'confirmed';
    l.hash = hit.transactionHash;
    l.hashes = [...(l.hashes ?? []), hit.transactionHash];
    l.note = 'found onchain';
    saveRecord(record);
    return true;
  } catch {
    return false;
  }
}

/* ── 🎻 EIP-5792: every transfer in ONE atomic wallet confirmation ──────────────────────── */
/** Returns true if the batch path took over, false to fall back to one transfer at a time. */
async function startBatch(record, fresh, c) {
  const nonce = (await nonceOf(record.fan, 'pending')).toString();
  const block = core.hexToBigInt(await rq('eth_blockNumber', [])).toString();
  // our own batch id, saved BEFORE the prompt: a wallet must refuse a second batch with the same id (EIP-5792)
  record.batch = { id: randHex(32), state: 'prompting', nonce, block, calls: core.batchCalls(fresh) };
  record.legs.forEach((l) => { l.nonce = nonce; l.block = block; });
  saveRecord(record);
  return submitBatch(record, c);
}

async function submitBatch(record, c) {
  setStatus(`One confirmation for all ${record.legs.length} transfers: approve the batch in your wallet.`);
  render();
  let res;
  try {
    res = await rq('wallet_sendCalls', [{ version: '2.0.0', id: record.batch.id, chainId: core.chainHex(record.chainId), from: record.fan, atomicRequired: true, calls: record.batch.calls }]);
  } catch (e) {
    const kind = core.sendCallsError(e);
    if (kind === 'rejected') { delete record.batch; saveRecord(record); throw e?.code === 4001 ? e : stop('you declined the batch in your wallet — nothing was sent'); }
    if (kind === 'duplicate') { record.batch.state = 'sent'; saveRecord(record); return true; } // already submitted → settle by status
    if (kind === 'unsupported' && (await nonceOf(record.fan, 'pending')) === BigInt(record.batch.nonce)) {
      record.batch = { state: 'unsupported', fallback: true };
      saveRecord(record);
      setStatus('Your wallet can’t batch here — sending one transfer at a time instead.', 'warn');
      return false;
    }
    record.batch.state = 'unknown';
    saveRecord(record);
    throw stop(`the wallet answered the batch with an error (${core.walletErrorText(e)}) — press continue: the page asks the wallet about this exact batch and searches the chain before anything else is sent`);
  }
  const bid = typeof res === 'string' ? res : res?.id;
  if (typeof bid === 'string' && bid && bid.length <= 8194) record.batch.id = bid;
  record.batch.state = 'sent';
  saveRecord(record);
  return true;
}

/** Settle a batch that is in flight or in doubt. Never sends it a second time with a new id. */
async function settleBatch(record, c, confirm) {
  const b = record.batch;
  setStatus(`Checking the batch with your wallet and on ${c.name}…`);
  render();
  const t0 = Date.now();
  let errors = 0;
  while (Date.now() - t0 < 10 * 60_000) {
    let st = null, err = null;
    try { st = await rq('wallet_getCallsStatus', [b.id]); } catch (e) { err = e; }
    const s = st ? core.callsStatus(st) : null;
    if (s === 'confirmed') {
      const ok = core.checkBatchReceipts({ asset: record.asset, fan: record.fan, legs: record.legs, receipts: st.receipts });
      if (ok.ok) {
        const h = st.receipts.find((r) => core.HASH_RE.test(r?.transactionHash ?? ''))?.transactionHash ?? null;
        record.legs.forEach((l) => { l.state = 'confirmed'; l.hash = h; l.hashes = h ? [h] : []; l.note = 'in one atomic batch'; });
      } else {
        for (const l of record.legs) if (l.state !== 'confirmed' && !(await findTransfer(record, l))) { l.state = 'mismatch'; l.note = ok.reason; }
      }
      b.state = record.legs.every((l) => l.state === 'confirmed') ? 'confirmed' : 'mismatch';
      saveRecord(record);
      if (b.state !== 'confirmed') throw stop('the batch was included but not every transfer could be matched — check the explorer');
      return;
    }
    if (s === 'failed') { // never included, or reverted as a whole: nothing moved
      record.legs.forEach((l) => { l.state = 'planned'; l.note = 'the batch did not go through — nothing moved'; });
      record.batch = { state: 'failed', fallback: true }; // try again one transfer at a time (fresh checks first)
      saveRecord(record);
      throw stop('the batch did not go through — nothing moved. Press continue to send the transfers one at a time.');
    }
    if (s === 'unknown') { b.state = 'unknown'; saveRecord(record); throw stop('the wallet reports an unclear batch result — check the explorer before anything else'); }
    if (s === 'pending') { await new Promise((res) => setTimeout(res, 2000)); continue; }
    // no status: does the chain already show the transfers?
    let found = 0;
    for (const l of record.legs) if (l.state === 'confirmed' || (await findTransfer(record, l))) found += 1;
    if (found === record.legs.length) { b.state = 'confirmed'; saveRecord(record); return; }
    if (found > 0) { b.state = 'mismatch'; saveRecord(record); throw stop('only part of an atomic batch is visible onchain — check the explorer'); }
    if (err?.code === 5730) {
      // the wallet has no record of this id. A batch it ever ACCEPTED ('sent'/'unknown') is never re-submitted — only
      // watched on the chain. One that never got an answer ('prompting') may be re-sent after: EOA nonce unmoved,
      // the fan confirms no old prompt is open, a fresh plan identical to the stored one, and fresh calls.
      if (b.state !== 'prompting') {
        if (++errors >= 5) { b.state = 'unknown'; saveRecord(record); throw stop('your wallet no longer knows this batch and the chain shows none of it yet — check your wallet’s activity and the explorer; this page will not send it again'); }
        await new Promise((res) => setTimeout(res, 3000));
        continue;
      }
      if (S.config.batch !== true) { b.state = 'unknown'; saveRecord(record); throw stop('batches are switched off right now — check your wallet’s activity; this batch is not sent again'); }
      if (await isContractAccount(record.fan)) { b.state = 'unknown'; saveRecord(record); throw stop('your wallet is a smart account, so this page can’t prove the batch didn’t go out — check your wallet’s activity; nothing is re-sent automatically'); }
      if ((await nonceOf(record.fan, 'pending')) !== BigInt(b.nonce)) { b.state = 'unknown'; saveRecord(record); throw stop('a transaction from this wallet went out since the batch was prepared — check the explorer; nothing is re-sent automatically'); }
      if (!confirm.confirmBatch) {
        S.confirm = { kind: 'batch', text: 'Your wallet has no record of this batch. Check your wallet’s activity: if the batch is listed there — even as pending — do NOT press. Otherwise reject/close any open request in your wallet, then press “send the batch again”.' };
        throw stop('check your wallet’s activity, close any open batch request, then confirm to send the batch again', 'confirm');
      }
      const fresh = await buildPlan(intentOf(record), { record, cache: new Map() });
      if (!core.legsEqual(fresh.legs, record.legs)) throw stop('the payees or amounts changed since this tip was planned — the batch is not sent again');
      const caps = await rq('wallet_getCapabilities', [record.fan, [core.chainHex(record.chainId)]]).catch(() => null);
      if (!core.atomicSupport(caps, record.chainId)) throw stop('your wallet no longer offers atomic batches here — check its activity; nothing was re-sent');
      b.calls = core.batchCalls(fresh); // never the stored calls
      saveRecord(record);
      confirm.confirmBatch = false;
      if (!(await submitBatch(record, c))) return; // fell back to one-by-one
      continue;
    }
    if (++errors >= 5) { b.state = 'unknown'; saveRecord(record); throw stop('the wallet doesn’t answer about the batch and the chain shows none of it yet — press continue later to check again'); }
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw stop('the batch is still pending after 10 minutes — press continue later to check again');
}

/* ── one lock for every wallet action (double-click guard) ─────────────────────────────── */
async function guard(kind, fn) {
  if (S.busy) return;
  S.busy = kind;
  render();
  try {
    await fn();
  } catch (e) {
    setStatus(typeof e?.code === 'number' ? core.walletErrorText(e) : String(e?.message ?? e).slice(0, 600), e?.code === 'confirm' ? 'warn' : 'err');
  } finally {
    S.busy = false;
    render();
  }
}
function setStatus(text, kind = 'info') {
  S.status = text;
  S.statusKind = kind;
  const el = $('#tip-status');
  if (el) { el.textContent = text; el.dataset.kind = kind; }
}

/* ── render ────────────────────────────────────────────────────────────────────────────── */
const fullAddr = (a) => esc(a).replace(/^0x(.{4})(.{4})(.{4})(.{4})(.{4})(.{4})(.{4})(.{4})(.{4})(.{4})$/, '0x $1 $2 $3 $4 $5 $6 $7 $8 $9 $10');
function artistRow(slug) {
  const ens = ensFor(slug);
  const n = S.names.get(slug);
  let badge = '<span class="tip-badge wait">⏳ awaiting the artist’s wallet</span>';
  let can = false;
  if (ens) {
    if (!n || n.state === 'loading') badge = `<span class="tip-badge">reading ${esc(ens)}…</span>`;
    else if (n.state === 'ok') { badge = `<span class="tip-badge on">✅ tips on · ${esc(ens)}</span>`; can = true; }
    else badge = `<span class="tip-badge wait" title="${esc(n.message)}">⏳ ${esc(ens)} — ${n.code === 'no-consent' ? 'tips not switched on yet' : 'can’t read right now'}</span>`;
  }
  const off = !can || S.mode === 'orchestra';
  return `<label class="tip-artist${can ? '' : ' off'}"><input type="radio" name="tip-artist" value="${esc(slug)}" ${off ? 'disabled' : ''} ${S.slug === slug && S.mode === 'one' ? 'checked' : ''}><span class="nm">${esc(nameOf(slug))}</span>${badge}</label>`;
}
function walletsOf(slugs) {
  const seen = new Map();
  for (const s of slugs) {
    const a = S.names.get(s)?.data?.eth;
    if (a) seen.set(a.toLowerCase(), [...(seen.get(a.toLowerCase()) ?? []), nameOf(s)]);
  }
  return seen;
}
function deepLinks() {
  const href = location.href;
  const enc = encodeURIComponent(href);
  return [
    ['MetaMask', `https://metamask.app.link/dapp/${location.host}${location.pathname}${location.search}`],
    ['Coinbase Wallet', `https://go.cb-w.com/dapp?cb_url=${enc}`],
    ['Trust Wallet', `https://link.trustwallet.com/open_url?coin_id=60&url=${enc}`],
  ];
}

function render() {
  const root = $('#tip .body');
  if (!root || !S.loaded || !S.config) return;
  const focusKey = (() => {
    const el = document.activeElement;
    if (!el || !root.contains(el)) return null;
    if (el.id) return `#${el.id}`;
    if (el.name && el.value != null) return `[name="${el.name}"][value="${CSS.escape(el.value)}"]`;
    for (const k of ['act', 'net', 'asset', 'quick', 'connect', 'mode']) if (el.dataset?.[k] != null) return `[data-${k}="${CSS.escape(el.dataset[k])}"]`;
    return null;
  })();
  const cfg = S.config;
  const c = chain();
  const a = assetFor(c);
  const lim = limits(a);
  const amt = a ? core.parseAmount(S.amount, a.decimals, lim) : { ok: false };
  const enabled = !!cfg.enabled && !FRAMED;
  const vis = visibleChains();
  const open = openRecords();
  const w = S.wallet;
  const busy = S.busy;
  const lockForm = busy ? 'disabled' : '';
  const price = S.price ? core.freshPrice(S.price, Math.floor(Date.now() / 1000)) : null;
  const usd = (v) => (a ? core.usdOf(v, a.decimals, a.ui, price) : null);
  const money = (v) => `${core.fromAtomic(v, a.decimals)} ${esc(a.symbol)}${usd(v) ? ` <small>≈ $${usd(v)}</small>` : a.ui === 'eth' ? ' <small>(USD price unavailable)</small>' : ''}`;
  const orch = S.mode === 'orchestra';
  const isHost = !orch && !!hostPayee(S.slug);

  let html = '';
  if (FRAMED) html += '<div class="tip-banner err">This tip page is shown inside another site’s frame. Open it directly at artist.opensourceorchestra.org to tip.</div>';
  else if (!cfg.enabled) html += `<div class="tip-banner err">Tips are switched off right now. ${esc(cfg.reason ?? '')}</div>`;
  else if (!cfg.mainnet) html += '<div class="tip-banner">🧪 Mainnet tips are not switched on yet — you can practise on a testnet (no real money).</div>';
  if (cfg.message) html += `<div class="tip-banner">${esc(cfg.message)}</div>`;

  if (!S.record || core.nextLeg(S.record).action === 'done') {
    for (const r of open) {
      const rc = S.byId.get(r.chainId);
      html += `<div class="tip-tile warn"><h4>Unfinished tip in this browser</h4><p>${esc(core.fromAtomic(r.total, r.asset.decimals))} ${esc(r.asset.symbol)} on ${esc(rc?.name ?? r.chainId)} ${r.kind === 'orchestra' ? 'to the whole orchestra' : `to ${esc(r.legs[0].label)}`} — ${r.legs.map((l) => `${esc(l.label)}: <b>${esc(l.state)}</b>${l.hash && rc ? ` <a href="${esc(core.explorerTx(rc, l.hash))}" target="_blank" rel="noopener">tx ↗</a>` : ''}`).join(' · ')}</p>
        <div class="tip-row"><button class="pill" data-act="resume" data-id="${esc(r.id)}" ${busy || !w || !enabled ? 'disabled' : ''}>continue it</button><button class="pill" data-act="dismiss" data-id="${esc(r.id)}" ${busy ? 'disabled' : ''}>forget it</button></div>
        <p class="fine">${w ? '' : 'Connect the same wallet below to continue. '}Continuing re-checks everything first; a transfer that may already have gone out is never sent twice. “Forget it” deletes this note from this browser only — it cannot undo anything onchain.</p></div>`;
    }
  }

  html += `<p class="tip-lede">Tip <b>straight into the artist’s own wallet</b> on Ethereum, its layer 2s and BNB Chain. <b>96.31%</b> goes to the artist, <b>3.69%</b> to the steward wallet that pays the AI stewards’ compute — no contract, nothing held in between.</p>
    <div class="fork-split" aria-hidden="true"><span class="a">96.31% → the artist</span><span class="c">3.69%</span></div>
    <div class="tip-net tip-mode" role="group" aria-label="who to tip"><button class="pill ${orch ? '' : 'on'}" data-mode="one" aria-pressed="${!orch}" ${lockForm}>one artist</button><button class="pill ${orch ? 'on' : ''}" data-mode="orchestra" aria-pressed="${orch}" ${lockForm}>🎻 tip the whole orchestra</button></div>`;

  if (orch) {
    const slugs = orchestraSlugs();
    const okSlugs = slugs.filter((s) => S.names.get(s)?.state === 'ok');
    const wm = walletsOf(okSlugs);
    html += `<fieldset class="tip-step" ${lockForm}><legend>1 · the whole orchestra</legend>
      <p class="fine">One amount for everyone who has switched tips on: 96.31% split <b>equally per wallet</b> (cards that share a wallet count once), 3.69% + the last few indivisible units to the steward.</p>
      <ul class="tip-recips">${slugs.map((s) => { const n = S.names.get(s); return `<li>${n?.state === 'ok' ? '✅' : n?.state === 'loading' || !n ? '…' : '⏳'} ${esc(nameOf(s))} <small>${esc(ensFor(s))}${n?.data?.eth ? ` · ${esc(core.shortAddress(n.data.eth))}` : ''}</small></li>`; }).join('')}</ul>
      <p class="fine">${okSlugs.length} card${okSlugs.length === 1 ? '' : 's'} with tips on · ${wm.size} distinct wallet${wm.size === 1 ? '' : 's'}${[...wm.values()].some((v) => v.length > 1) ? ` (${[...wm.values()].filter((v) => v.length > 1).map((v) => esc(v.join(' + '))).join('; ')} share one wallet)` : ''}. Everyone else in the garden is ⏳ awaiting their wallet and is not included.</p></fieldset>`;
  } else {
    html += `<fieldset class="tip-step" ${lockForm}><legend>1 · who</legend><div class="tip-artists" role="radiogroup" aria-label="artist">${circleSlugs().map(artistRow).join('')}</div>
      <p class="fine">Only artists who switched tips on, on their own ENS name, can be tipped. We never guess or type in an address — the rest show “awaiting the artist’s wallet”.</p></fieldset>`;
  }

  html += `<fieldset class="tip-step" ${lockForm}><legend>2 · where</legend>
    <div class="tip-net" role="group" aria-label="network type"><button class="pill ${S.network === 'mainnet' ? 'on' : ''}" data-net="mainnet" aria-pressed="${S.network === 'mainnet'}" ${cfg.mainnet ? '' : 'disabled'}>mainnets · real money</button><button class="pill ${S.network === 'testnet' ? 'on' : ''}" data-net="testnet" aria-pressed="${S.network === 'testnet'}">testnets · practice</button></div>
    <div class="tip-chains" id="tip-chains" role="radiogroup" aria-label="chain">${vis.map((x) => `<label class="tip-chain${S.chainId === x.chainId ? ' on' : ''}"><input type="radio" name="tip-chain" value="${x.chainId}" ${S.chainId === x.chainId ? 'checked' : ''}><b>${esc(x.name)}</b><small>${esc(x.testnet ? 'testnet · ' + (S.byId.get(x.testnetOf)?.name ?? '') : x.family)} · ${[x.usdc ? 'USDC' : null, x.nativeTip ? 'ETH' : null].filter(Boolean).join(' + ')}</small></label>`).join('')}</div></fieldset>`;

  if (c) {
    let split = esc(amt.message ?? '');
    if (amt.ok && orch) {
      const n = Math.max(1, walletsOf(orchestraSlugs().filter((s) => S.names.get(s)?.state === 'ok')).size);
      const pool = amt.total - amt.steward;
      split = `${money(pool / BigInt(n))} → each of ${n} wallet${n > 1 ? 's' : ''} (96.31% ÷ ${n}) · ${money(amt.steward + (pool % BigInt(n)))} → steward (3.69% + dust)`;
    } else if (amt.ok && isHost) split = `${money(amt.total)} → the orchestra itself (osoartist.eth, held by Shaka) — this card’s wallet is also the steward wallet, so the whole tip is one transfer`;
    else if (amt.ok) split = `${money(amt.artist)} → artist (96.31%) · ${money(amt.steward)} → steward (3.69%) · <b>no platform fee</b>`;
    html += `<fieldset class="tip-step" ${lockForm}><legend>3 · how much</legend>
      <div class="tip-net" role="group" aria-label="token"><button class="pill ${S.asset === 'usdc' ? 'on' : ''}" data-asset="usdc" aria-pressed="${S.asset === 'usdc'}" ${c.usdc ? '' : 'disabled'}>USDC</button><button class="pill ${S.asset === 'native' ? 'on' : ''}" data-asset="native" aria-pressed="${S.asset === 'native'}" ${c.nativeTip ? '' : 'disabled'}>${esc(c.nativeTip ? c.nativeCurrency.symbol : 'ETH')}</button></div>
      ${a ? `<label class="tip-amt"><span>amount (${esc(a.symbol)})</span><input id="tip-amount" inputmode="decimal" autocomplete="off" value="${esc(S.amount)}" aria-describedby="tip-split"></label>
      <div class="tip-row">${(a.ui === 'eth' ? ['0.001', '0.005', '0.01'] : ['1', '5', '10', '25']).map((v) => `<button class="pill" data-quick="${v}">${v}</button>`).join('')}</div>
      <p id="tip-split" class="tip-split-txt">${split}</p>
      <p class="fine">${a.kind === 'erc20' ? `Token: ${esc(a.symbol)} <a href="${esc(core.explorerAddress(c, a.address))}" target="_blank" rel="noopener">${esc(core.shortAddress(a.address))} ↗</a> · issued by ${esc(a.issuer)}${c.chainId === 56 ? ' · 18 decimals on BNB Chain' : ''}.` : `Native ${esc(a.symbol)} on ${esc(c.name)}.`} You pay the network fee in ${esc(c.nativeCurrency.symbol)}. The steward wallet is <code>osoartist.eth</code>, held by Shaka, who pays the AI stewards’ compute from it.</p>` : '<p class="fine">Pick a token.</p>'}
    </fieldset>`;
  }

  // the ONE primary action
  let action = '';
  const ready = enabled && (orch || S.slug) && c && a && amt.ok && (c.testnet || cfg.mainnet);
  if (!enabled) action = '';
  else if (!w) {
    if (S.wallets.size) action = `<div class="tip-wallets">${[...S.wallets.values()].map((x) => `<button class="big tip-cta" data-connect="${esc(x.id)}" ${busy ? 'disabled' : ''}>${x.icon ? `<img src="${esc(x.icon)}" alt="">` : ''}${busy === 'connect' ? 'connecting…' : `connect ${esc(x.name)}`}</button>`).join('')}</div>`;
    else action = `<div class="tip-tile"><h4>No browser wallet here</h4><p>Open this page inside your wallet’s own browser — tap one: ${deepLinks().map(([n, u]) => `<a class="pill" href="${esc(u)}" rel="noopener">${esc(n)}</a>`).join(' ')} — or install one. Nothing here works without your own wallet; that’s the point.</p><button class="pill" data-act="copy">copy this link</button></div>`;
  } else if (!ready) action = `<button class="big tip-cta" disabled>${!orch && !S.slug ? 'pick an artist' : !c ? 'pick a chain' : 'pick an amount'}</button>`;
  else if (w.chainId !== c.chainId) action = `<button class="big tip-cta" data-act="switch" ${busy ? 'disabled' : ''}>${busy === 'switch' ? 'switching…' : `switch wallet to ${esc(c.name)}`}</button>`;
  else if (!S.plan) action = `<button class="big tip-cta" data-act="review" ${busy ? 'disabled' : ''}>${busy === 'review' ? 'checking…' : orch ? 'review the orchestra tip' : 'review the tip'}</button>`;
  else {
    const p = S.plan;
    const pc = p.chain;
    const pa = p.asset;
    const m = (v) => `${core.fromAtomic(v, pa.decimals)} ${esc(pa.symbol)}`;
    const rec = S.record && S.record.id === p.id ? S.record : null;
    const what = (l) => (l.leg === 'artist+steward' ? (p.kind === 'orchestra' ? 'their share + the steward share, in one transfer (same wallet)' : 'the artist’s wallet is also the steward wallet, so both shares go in one transfer') : l.leg === 'artist' ? (p.kind === 'orchestra' ? `an equal share (96.31% ÷ ${p.split.wallets})` : '96.31% · the artist') : p.kind === 'orchestra' ? '3.69% + dust · steward (AI compute)' : '3.69% · steward (AI compute)');
    html += `<div class="tip-review" id="tip-review"><h4>${pc.testnet ? '🧪 TESTNET · no real money' : 'Real money · please read'}</h4>
      <dl><dt>chain</dt><dd>${esc(pc.name)} · id ${pc.chainId}</dd>
      <dt>token</dt><dd>${pa.kind === 'erc20' ? `${esc(pa.symbol)} · contract <a href="${esc(core.explorerAddress(pc, pa.address))}" target="_blank" rel="noopener"><code>${fullAddr(pa.address)}</code> ↗</a>` : `native ${esc(pa.symbol)}`}</dd>
      <dt>from</dt><dd>your wallet <code>${fullAddr(p.fan)}</code></dd>
      ${p.legs.map((l, i) => `<dt>${p.legs.length > 1 ? `transfer ${i + 1}` : 'transfer'}</dt><dd><b>${m(l.amount)}</b> → ${esc(l.label)}<br><a href="${esc(core.explorerAddress(pc, l.to))}" target="_blank" rel="noopener"><code>${fullAddr(l.to)}</code> ↗</a><br><small>${what(l)}</small>${rec ? ` <span class="tip-leg ${esc(rec.legs[i]?.state)}">${esc(rec.legs[i]?.state)}</span>${rec.legs[i]?.hash ? ` <a href="${esc(core.explorerTx(pc, rec.legs[i].hash))}" target="_blank" rel="noopener">tx ↗</a>` : ''}` : ''}</dd>`).join('')}
      <dt>total</dt><dd>${m(p.total)}${(() => { const u = core.usdOf(p.total, pa.decimals, pa.kind === 'native' ? 'eth' : 'usdc', S.price ? core.freshPrice(S.price, Math.floor(Date.now() / 1000)) : null); return u ? ` ≈ $${u}` : ''; })()} + network fee in ${esc(pc.nativeCurrency.symbol)}</dd></dl>
      ${p.skipped?.length ? `<p class="fine">Not included (awaiting their wallet): ${p.skipped.map((s) => esc(nameOf(s.slug))).join(', ')}.</p>` : ''}
      <p class="fine">${p.kind === 'orchestra' && p.atomic ? `Your wallet says it can do this as <b>one atomic batch</b> (EIP-5792): one confirmation, all ${p.legs.length} transfers or none. If it can’t after all, the page falls back to one transfer at a time and tells you.` : `Your wallet will ask ${p.legs.length === 1 ? 'once' : `${p.legs.length} times — once per transfer`}.`} Compare every address in the wallet with the full addresses above. Onchain transfers are public and can’t be undone.</p></div>`;
    const finished = rec && core.nextLeg(rec).action === 'done';
    if (rec && S.confirm && !busy) html += `<div class="tip-tile warn" id="tip-confirm"><h4>Before sending again</h4><p>${esc(S.confirm.text)}</p><button class="pill" data-act="confirm-resend">${S.confirm.kind === 'batch' ? 'I checked — send the batch again' : 'I checked — send it again'}</button></div>`;
    const sentN = rec ? rec.legs.filter((l) => l.state === 'confirmed').length : 0;
    action = finished
      ? '<button class="big tip-cta" data-act="again">tip again</button>'
      : `<div class="tip-row"><button class="big tip-cta" data-act="send" ${busy ? 'disabled' : ''}>${busy === 'send' ? (p.legs.length > 1 ? `sending — ${sentN} of ${p.legs.length} done…` : 'sending — follow your wallet…') : rec ? 'continue the tip' : p.legs.length === 1 ? 'send the tip' : p.kind === 'orchestra' && p.atomic ? `send all ${p.legs.length} in one batch` : `send ${p.legs.length} transfers`}</button><button class="pill" data-act="back" ${busy ? 'disabled' : ''}>change something</button></div>`;
  }
  html += `<div class="tip-action">${action}</div>`;
  if (w) html += `<p class="fine">Wallet: ${esc(w.name)} · ${esc(core.shortAddress(w.account))} · chain ${w.chainId}${S.byId.get(w.chainId) ? ` (${esc(S.byId.get(w.chainId).name)})` : ''} · <button class="linkish" data-act="disconnect" ${busy ? 'disabled' : ''}>forget on this page</button></p>`;

  html += `<details class="tip-how"><summary>How this works · what is public · your escape hatch</summary>
    <ul><li><b>No custody, no contract.</b> Your wallet sends plain transfers straight to each payee. Nothing passes through Open Source Orchestra; there is no server and no smart contract of ours.</li>
    <li><b>Who gets paid</b> is read live from the artist’s own ENS name (<code>&lt;name&gt;.osoartist.eth</code>, their resolver, their records), from two Ethereum RPCs that must agree: a record for this chain first (ENSIP-11), then their “every EVM chain” record (ENSIP-19), then their ETH address only if it is a key-held wallet. No record → no tip.</li>
    <li><b>The steward wallet</b> is <code>osoartist.eth</code> (held by Shaka, who pays the AI stewards’ compute). It must equal <code>${fullAddr(cfg.stewardPin)}</code> or tips stop. The Open Source Orchestra card is paid on the same wallet.</li>
    <li><b>Before every transfer</b> — also when you continue an old tip — the page re-checks the switchboard, ENS, the token contract and your chain, and rebuilds the transfer. A transfer that may already have gone out is never sent twice (it checks your wallet’s nonce).</li>
    <li><b>Public:</b> the transfers (your address, amounts, time) are public onchain forever. ENS names are read through public Ethereum RPCs (${esc((cfg.ensRpcUrls ?? []).map((u) => { try { return new URL(u).host; } catch { return ''; } }).join(', '))}); balance checks go through your wallet’s own RPC, and if your wallet adds a network for you it uses the RPC listed for that chain. No analytics, no cookies; the tip notes stay in this browser.</li>
    <li><b>Stablecoin risk:</b> USDC is issued by Circle and can be frozen by its issuer; on BNB Chain it is Binance-Peg USDC, issued by Binance. ETH tips avoid issuer risk.</li>
    <li><b>Switching off</b> takes effect within about 10 minutes (the page host caches the switchboard).</li>
    <li><b>Escape hatch:</b> you never need this page. On <b>Ethereum mainnet</b> you can send to the artist’s ENS name from any wallet; on layer 2s only with a wallet that reads per-chain ENS records (ENSIP-11/19). The code is open source (GPL-3.0): <a href="https://github.com/Open-Source-Orchestra/fork-the-first-artist" target="_blank" rel="noopener">GitHub</a>. Token addresses were checked onchain ${esc((S.chainsVerifiedAt ?? '').slice(0, 10))} against Circle’s list and are re-checked in your wallet before every tip.</li></ul></details>`;

  root.innerHTML = html;
  const st = $('#tip-status');
  if (st && st.textContent !== S.status) { st.textContent = S.status; st.dataset.kind = S.statusKind; }
  if (focusKey) {
    const el = root.querySelector(focusKey);
    if (el && !el.disabled) { el.focus({ preventScroll: true }); if (el.id === 'tip-amount') el.setSelectionRange(el.value.length, el.value.length); }
  }
}

/* ── events ────────────────────────────────────────────────────────────────────────────── */
function changed() { S.form += 1; S.plan = null; }
function bind() {
  const root = $('#tip .body');
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (S.busy) return;
    if (t.name === 'tip-artist') { S.slug = t.value; changed(); render(); }
    if (t.name === 'tip-chain') { S.chainId = Number(t.value); const c = chain(); if (!assetFor(c)) S.asset = c?.usdc ? 'usdc' : 'native'; changed(); render(); }
  });
  root.addEventListener('input', (e) => {
    if (e.target.id === 'tip-amount' && !S.busy) { S.amount = e.target.value.slice(0, 40); changed(); render(); }
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const formBtn = b.dataset.net || b.dataset.asset || b.dataset.quick || b.dataset.mode;
    if (formBtn && S.busy) return;
    if (b.dataset.mode) { S.mode = b.dataset.mode; changed(); render(); refreshNames().catch(() => {}); }
    else if (b.dataset.net) { S.network = b.dataset.net; S.chainId = null; changed(); render(); }
    else if (b.dataset.asset) { S.asset = b.dataset.asset; S.amount = S.asset === 'native' ? '0.001' : '5'; changed(); render(); }
    else if (b.dataset.quick) { S.amount = b.dataset.quick; changed(); render(); }
    else if (b.dataset.connect) connect(b.dataset.connect);
    else if (b.dataset.act === 'switch') switchChain();
    else if (b.dataset.act === 'review') review();
    else if (b.dataset.act === 'send') { const rec = S.record && S.record.id === S.plan.id ? S.record : recordFromPlan(S.plan); send(rec); }
    else if (b.dataset.act === 'back') { changed(); S.record = null; S.confirm = null; setStatus(''); render(); }
    else if (b.dataset.act === 'again') { changed(); S.record = null; S.confirm = null; setStatus(''); render(); }
    else if (b.dataset.act === 'disconnect') { if (S.wallet) detach(S.wallet.provider); S.wallet = null; changed(); setStatus('Forgotten on this page. Your wallet’s own site permissions are unchanged.'); render(); }
    else if (b.dataset.act === 'copy') navigator.clipboard?.writeText(location.href).then(() => setStatus('Link copied — paste it into your wallet’s browser.', 'ok'));
    else if (b.dataset.act === 'dismiss') { const all = ledger(); delete all[b.dataset.id]; writeLedger(all); if (S.record?.id === b.dataset.id) S.record = null; render(); }
    else if (b.dataset.act === 'resume') resume(b.dataset.id);
    else if (b.dataset.act === 'confirm-resend' && S.record && S.confirm) { const cf = S.confirm; S.confirm = null; send(S.record, cf.kind === 'batch' ? { confirmBatch: true } : { confirmLeg: cf.i }); }
  });
}

async function resume(id) {
  const r = readRecord(id);
  if (!r || !S.wallet || S.busy) return;
  const c = S.byId.get(r.chainId);
  if (!c) return setStatus('That chain is not offered any more — check the explorer links instead.', 'err');
  if (!core.sameAddress(S.wallet.account, r.fan)) return setStatus(`Connect the wallet that started this tip (${core.shortAddress(r.fan)}).`, 'err');
  S.network = c.testnet ? 'testnet' : 'mainnet';
  S.chainId = c.chainId;
  S.mode = r.kind === 'orchestra' ? 'orchestra' : 'one';
  S.slug = r.artistSlug;
  S.asset = r.asset.kind === 'native' ? 'native' : 'usdc';
  S.amount = core.fromAtomic(r.total, r.asset.decimals);
  if (S.wallet.chainId !== c.chainId) {
    await guard('switch', () => switchTo(c));
    if (S.wallet?.chainId !== c.chainId) return;
  }
  // show the stored legs; send() re-plans from scratch and refuses unless the fresh plan is identical
  S.plan = { id: r.id, kind: r.kind ?? 'single', chainId: r.chainId, chain: c, asset: r.asset, total: BigInt(r.total), fan: r.fan, split: { wallets: r.legs.length }, legs: r.legs.map((l) => ({ ...l, amount: BigInt(l.amount) })), intent: intentOf(r) };
  S.record = r;
  render();
  await send(r);
}

/* ── mount ─────────────────────────────────────────────────────────────────────────────── */
function footer() {
  return '<p class="tip-status" id="tip-status" role="status" aria-live="polite" data-kind="info"></p>';
}
function mount() {
  if (STANDALONE) {
    $('#tip-root').innerHTML = `<section id="tip" class="tip-page" aria-label="tip an artist"><div class="body"></div>${footer()}</section>`;
  } else {
    const p = document.createElement('aside');
    p.className = 'panel';
    p.id = 'tip';
    p.setAttribute('aria-labelledby', 'tip-h');
    p.innerHTML = `<header><h2 id="tip-h" tabindex="-1">💸 Tip an artist · any Ethereum chain</h2><button class="x" id="tip-x" aria-label="close">✕</button></header><div class="body"></div>${footer()}`;
    document.body.appendChild(p);
    const btn = document.createElement('button');
    btn.className = 'pill';
    btn.id = 'tip-open';
    btn.type = 'button';
    btn.setAttribute('aria-controls', 'tip');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span aria-hidden="true">💸</span> tip<span class="long"> · any Ethereum chain</span>';
    btn.setAttribute('aria-label', 'tip an artist on any Ethereum chain');
    btn.addEventListener('click', () => openTip());
    $('#tip-x').addEventListener('click', () => { p.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); btn.focus(); });
    const place = () => { const right = $('#top .right'); if (!right) return; const f = $('#fork-open'); if (f) f.after(btn); else right.prepend(btn); };
    place();
    setTimeout(place, 800); // fork.js may mount its opener after us — keep ours right next to it
    new MutationObserver(() => { if (!p.classList.contains('open')) btn.setAttribute('aria-expanded', 'false'); }).observe(p, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('fork:artist', (e) => {
      const slug = e.detail?.slug;
      const links = $('#detail-body .links');
      if (!slug || !links || links.querySelector('[data-tip-artist]')) return;
      const b = document.createElement('button');
      b.className = 'pill tip-detail';
      b.dataset.tipArtist = slug;
      b.textContent = ensFor(slug) ? `💸 tip ${nameOf(slug)}` : '💸 tips · awaiting the artist’s wallet';
      b.addEventListener('click', () => openTip(slug));
      links.appendChild(b);
    });
  }
  bind();
}

export async function openTip(slug) {
  await S.loaded;
  if (slug && ensFor(slug)) { S.slug = slug; S.mode = 'one'; changed(); }
  if (!STANDALONE) {
    document.querySelectorAll('.panel.open').forEach((p) => p.id !== 'tip' && p.classList.remove('open'));
    $('#tip').classList.add('open');
    $('#tip-open')?.setAttribute('aria-expanded', 'true');
    setTimeout(() => $('#tip-h')?.focus({ preventScroll: true }), 50);
  }
  render();
  refreshNames().catch(() => {});
}

mount();
discover();
S.loaded = load().then(() => {
  const p = new URLSearchParams(location.search);
  const ch = Number(p.get('chain'));
  if (S.byId.has(ch) && (S.byId.get(ch).testnet || S.config.mainnet)) { S.chainId = ch; S.network = S.byId.get(ch).testnet ? 'testnet' : 'mainnet'; }
  if (ensFor(p.get('artist') ?? '')) S.slug = p.get('artist');
  if (p.get('mode') === 'orchestra') S.mode = 'orchestra';
  render();
  if (STANDALONE || p.has('tip')) openTip(p.get('tip') || undefined);
});
