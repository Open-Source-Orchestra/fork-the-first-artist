// 💸 Tip the artist — on any Ethereum chain, straight from the fan's own wallet.
//
// Flow (one primary action at a time): pick an artist who switched tips on (their ENS name) → pick a
// chain + USDC or ETH + amount → Connect wallet → Switch network → Review (every address, amount and
// contract shown) → Send: the wallet signs TWO plain transfers, 96.31% to the artist, 3.69% to the
// steward. No contract, no server, no custody. Kill switch: /tip-config.json (enabled / mainnet).
//
// Pure logic + tests: tip-core.mjs (frontend/test/tip-core.test.mjs). ENS reads: tip-ens.mjs.
import * as core from './tip-core.mjs';
import { makeClient, readName, readEthUsd } from './tip-ens.mjs';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LEDGER_KEY = 'oso-tip-ledger-v1';
const STANDALONE = !!document.getElementById('tip-root');

const S = {
  config: null, chains: [], byId: new Map(), artists: [], bySlug: new Map(), registry: { artists: {} },
  slug: null, network: 'mainnet', chainId: null, asset: 'usdc', amount: '5',
  wallets: new Map(), wallet: null, busy: false, names: new Map(), steward: null, price: null,
  plan: null, record: null, status: '', statusKind: 'info', client: null, loaded: null,
};

/* ── boot ─────────────────────────────────────────────────────────────────── */
async function load() {
  const get = (u) => fetch(u, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${u} ${r.status}`))));
  const [config, chains, artists, registry] = await Promise.all([
    get('/tip-config.json').catch(() => null),
    get('/tip-chains.json').catch(() => null),
    get('/data/artists.json').catch(() => ({ artists: [] })),
    get('/fork/registry.json').catch(() => ({ artists: {} })),
  ]);
  S.config = config && typeof config === 'object' ? config : { enabled: false, reason: 'The tip switchboard could not be read, so tips are off (fail closed).' };
  S.chains = Array.isArray(chains?.chains) ? chains.chains.filter((c) => !(S.config.disabledChains ?? []).includes(c.chainId)) : [];
  S.chainsVerifiedAt = chains?.verifiedAt ?? null;
  S.byId = new Map(S.chains.map((c) => [c.chainId, c]));
  S.artists = artists.artists ?? [];
  S.bySlug = new Map(S.artists.map((a) => [a.slug, a]));
  S.registry = registry && typeof registry.artists === 'object' ? registry : { artists: {} };
  if (!S.config.mainnet) S.network = 'testnet';
}

/** Host cards that are paid on a name Shaka owns (tip-config.json `hostPayees`, e.g. the orchestra itself →
 *  osoartist.eth). Those must resolve to the pinned steward address, or they are not tippable. */
function hostPayee(slug) {
  const h = S.config?.hostPayees?.[slug];
  return h && typeof h.ens === 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/.test(h.ens) ? h.ens : null;
}
function ensFor(slug) {
  const host = hostPayee(slug);
  if (host) return host;
  const r = S.registry.artists?.[slug];
  return r && r.status === 'issued' && typeof r.ens === 'string' && r.ens.endsWith('.osoartist.eth') ? r.ens : null;
}

function circleSlugs() {
  const p = new URLSearchParams(location.search);
  const who = p.get('who') ?? p.get('artist');
  let list = [];
  if (who === 'everyone' || who === 'all') list = S.artists.map((a) => a.slug);
  else if (who) list = who.split(',').map((s) => s.trim()).filter((s) => S.bySlug.has(s));
  if (!list.length) list = S.artists.map((a) => a.slug);
  // tippable first, then the circle's own order
  return [...new Set(list)].sort((a, b) => (ensFor(b) ? 1 : 0) - (ensFor(a) ? 1 : 0));
}

function visibleChains() {
  return S.chains.filter((c) => (S.network === 'testnet' ? c.testnet : !c.testnet));
}

function chain() {
  return S.byId.get(S.chainId) ?? null;
}

function assetFor(c, kind = S.asset) {
  if (!c) return null;
  if (kind === 'usdc' && c.usdc) return { kind: 'erc20', address: c.usdc.address, decimals: c.usdc.decimals, symbol: c.usdc.symbol, issuer: c.usdc.issuer, ui: 'usdc' };
  if (kind === 'native' && c.nativeTip) return { kind: 'native', decimals: 18, symbol: c.nativeCurrency.symbol, ui: 'eth' };
  return null;
}

function limits(a) {
  const L = S.config.limits ?? {};
  return a?.ui === 'eth' ? { min: L.minEth ?? '0.0001', max: L.maxEth ?? '0.05', symbol: a.symbol } : { min: L.minUsdc ?? '0.01', max: L.maxUsdc ?? '100', symbol: a?.symbol ?? 'USDC' };
}

/* ── ENS (lazy) ───────────────────────────────────────────────────────────── */
async function client() {
  S.client ??= await makeClient(S.config.ensRpcUrls ?? ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://1rpc.io/eth']);
  return S.client;
}

async function refreshNames() {
  const c = await client();
  const slugs = circleSlugs().filter(ensFor);
  await Promise.all(slugs.map(async (slug) => {
    if (S.names.get(slug)?.state === 'ok') return;
    S.names.set(slug, { state: 'loading' });
    try {
      S.names.set(slug, { state: 'ok', data: await readName(c, ensFor(slug), [], { requireConsent: !hostPayee(slug) }) });
    } catch (e) {
      S.names.set(slug, { state: 'no', message: e.message, code: e.code });
    }
  }));
  if (!S.price) S.price = await readEthUsd(c);
  render();
}

/* ── wallets (EIP-6963 + legacy injected) ─────────────────────────────────── */
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
  S.wallet.provider.request({ method: 'eth_accounts' }).then(async (acc) => {
    const chainHex = await S.wallet.provider.request({ method: 'eth_chainId' });
    const account = Array.isArray(acc) && core.ADDRESS_RE.test(acc[0] ?? '') ? acc[0] : null;
    const changed = !core.sameAddress(account, S.wallet.account) || Number(BigInt(chainHex)) !== S.wallet.chainId;
    S.wallet.account = account;
    S.wallet.chainId = Number(BigInt(chainHex));
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

async function switchChain() {
  const c = chain();
  if (!c || !S.wallet) return;
  await guard('switch', async () => {
    setStatus(`Asking ${S.wallet.name} to switch to ${c.name}…`);
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
    setStatus(`On ${c.name}.`, 'ok');
  });
}

/* ── review: every check happens here, before any signature is asked ─────── */
const rq = (method, params) => S.wallet.provider.request({ method, params });

async function review() {
  const c = chain();
  const a = assetFor(c);
  const lim = limits(a);
  await guard('review', async () => {
    if (!S.config.enabled) throw new Error('tips are switched off');
    if (!c.testnet && !S.config.mainnet) throw new Error('mainnet tips are switched off right now');
    if (!a) throw new Error('pick a token');
    const amt = core.parseAmount(S.amount, a.decimals, lim);
    if (!amt.ok) throw new Error(amt.message);
    const ens = ensFor(S.slug);
    if (!ens) throw new Error('this artist has not switched tips on yet');
    setStatus('Checking the chain, the token contract and both payees…');
    const live = Number(BigInt(await rq('eth_chainId', [])));
    if (live !== c.chainId) throw new Error(`your wallet is on chain ${live}, not ${c.name} (${c.chainId})`);
    const [acc] = await rq('eth_accounts', []);
    if (!core.sameAddress(acc, S.wallet.account)) throw new Error('the wallet account changed — connect again');
    if (a.kind === 'erc20') {
      const [code, dec, sym] = await Promise.all([
        rq('eth_getCode', [a.address, 'latest']),
        rq('eth_call', [{ to: a.address, data: core.DECIMALS_SELECTOR }, 'latest']),
        rq('eth_call', [{ to: a.address, data: core.SYMBOL_SELECTOR }, 'latest']),
      ]);
      if (!code || code === '0x') throw new Error(`no token contract at ${a.address} on this chain — refusing`);
      if (Number(core.hexToBigInt(dec)) !== a.decimals) throw new Error(`the token says ${Number(core.hexToBigInt(dec))} decimals, expected ${a.decimals} — refusing`);
      if (core.decodeString(sym) !== a.symbol) throw new Error(`the token says "${core.decodeString(sym)}", expected ${a.symbol} — refusing`);
    }
    // payees: re-read ENS now, for THIS chain
    const cl = await client();
    const [art, stw] = await Promise.all([readName(cl, ens, [c.testnet ? c.testnetOf : c.chainId], { requireConsent: !hostPayee(S.slug) }), readName(cl, S.config.stewardEns ?? 'osoartist.eth', [c.testnet ? c.testnetOf : c.chainId], { requireConsent: false })]);
    const payeeFor = async (r) => {
      const id = c.testnet ? c.testnetOf : c.chainId;
      const codeOnTarget = r.eth && !r.perChain[id] && !r.defaultEvm ? await rq('eth_getCode', [r.eth, 'latest']).catch(() => null) : '0x';
      return core.pickPayout({ chainId: id, specific: r.perChain[id], defaultEvm: r.defaultEvm, eth: r.eth, ethCodeOnMainnet: r.ethCodeOnMainnet, codeOnTarget });
    };
    const [pa, ps] = await Promise.all([payeeFor(art), payeeFor(stw)]);
    if (!pa.ok) throw new Error(`${ens}: ${pa.message}`);
    if (!ps.ok) throw new Error(`steward ${stw.name}: ${ps.message}`);
    if (!core.sameAddress(ps.address, S.config.stewardPin)) throw new Error('the steward address on osoartist.eth no longer matches the published one — tips are paused for safety');
    if (hostPayee(S.slug) && !core.sameAddress(pa.address, S.config.stewardPin)) throw new Error(`${ens} no longer points at the published orchestra wallet — tips are paused for safety`);
    const plan = core.planTip({ chainId: c.chainId, asset: a, fan: S.wallet.account, artist: { address: pa.address, label: ens, source: pa.source }, steward: { address: ps.address, label: stw.name, source: ps.source }, total: amt.total });
    if (!plan.ok) throw new Error(plan.problems.join('; '));
    // balances + gas, read through the fan's own wallet
    const bal = a.kind === 'erc20' ? core.hexToBigInt(await rq('eth_call', [{ to: a.address, data: core.encodeBalanceOf(S.wallet.account) }, 'latest'])) : core.hexToBigInt(await rq('eth_getBalance', [S.wallet.account, 'latest']));
    if (bal < plan.total) throw new Error(`this wallet holds ${core.fromAtomic(bal, a.decimals)} ${a.symbol} on ${c.name} — not enough for ${core.fromAtomic(plan.total, a.decimals)}`);
    const gasBal = a.kind === 'native' ? bal : core.hexToBigInt(await rq('eth_getBalance', [S.wallet.account, 'latest']));
    if (gasBal === 0n) throw new Error(`this wallet has no ${c.nativeCurrency.symbol} on ${c.name} to pay the network fee`);
    for (const l of plan.legs) {
      try {
        l.gas = await rq('eth_estimateGas', [l.tx]);
      } catch (e) {
        throw new Error(`the ${l.leg} transfer would fail: ${core.walletErrorText(e)}`);
      }
    }
    S.plan = { ...plan, id: core.newTipId(), chain: c, artistSlug: S.slug, createdAt: new Date().toISOString() };
    setStatus('Everything checks out. Read it once more, then send.', 'ok');
  });
}

/* ── send: two transfers, hashes saved before waiting, never re-sent ──────── */
function ledger() {
  try { return JSON.parse(localStorage.getItem(LEDGER_KEY) ?? '{}') ?? {}; } catch { return {}; }
}
function saveRecord(r) {
  const all = ledger();
  all[r.id] = r;
  try { localStorage.setItem(LEDGER_KEY, JSON.stringify(all, (k, v) => (typeof v === 'bigint' ? v.toString() : v))); } catch { /* private mode: the page still works, recovery won't survive reload */ }
}
function openRecords() {
  return Object.values(ledger()).filter((r) => r && Array.isArray(r.legs) && r.legs.some((l) => l.state !== 'confirmed') && !r.dismissed);
}
function recordFromPlan(p) {
  return {
    id: p.id, createdAt: p.createdAt, chainId: p.chainId, artistSlug: p.artistSlug, fan: p.fan,
    asset: { kind: p.asset.kind, address: p.asset.address ?? null, decimals: p.asset.decimals, symbol: p.asset.symbol },
    total: p.total.toString(),
    legs: p.legs.map((l) => ({ leg: l.leg, to: l.to, label: l.label, amount: l.amount.toString(), tx: l.tx, state: 'planned', hash: null })),
  };
}

async function send(record) {
  const c = S.byId.get(record.chainId);
  await guard('send', async () => {
    S.record = record;
    saveRecord(record);
    for (;;) {
      const next = core.nextLeg(record);
      if (next.action === 'done') break;
      if (next.action === 'stop') throw new Error(`the ${next.leg.leg} transfer needs a look on the explorer before anything else is sent`);
      const live = Number(BigInt(await rq('eth_chainId', [])));
      const [acc] = await rq('eth_accounts', []);
      if (live !== record.chainId) throw new Error(`your wallet moved to chain ${live} — switch back to ${c.name} and press continue`);
      if (!core.sameAddress(acc, record.fan)) throw new Error('the wallet account changed — switch back to the account that started this tip');
      const l = next.leg;
      if (next.action === 'send') {
        const n = record.legs.indexOf(l) + 1;
        setStatus(`Transfer ${n} of ${record.legs.length}: confirm ${core.fromAtomic(l.amount, record.asset.decimals)} ${record.asset.symbol} → ${l.label} in your wallet.`);
        render();
        let hash;
        try {
          hash = await rq('eth_sendTransaction', [l.tx]);
        } catch (e) {
          l.state = 'rejected';
          saveRecord(record);
          throw e;
        }
        if (!core.HASH_RE.test(hash ?? '')) throw new Error('the wallet returned no transaction hash');
        l.hash = hash;
        l.state = 'sent';
        saveRecord(record);
      }
      setStatus(`Waiting for ${c.name} to include transfer ${record.legs.indexOf(l) + 1}…`);
      render();
      const res = await waitLeg(record, l);
      l.state = res.ok ? 'confirmed' : res.reverted ? 'failed' : 'mismatch';
      l.note = res.reason ?? null;
      saveRecord(record);
      render();
      if (!res.ok) throw new Error(res.reason);
    }
    setStatus(`Done — ${core.fromAtomic(record.total, record.asset.decimals)} ${record.asset.symbol} went straight to ${record.legs[0].label}. Mahalo 🌺`, 'ok');
  });
}

async function waitLeg(record, l) {
  const asset = { ...record.asset };
  const leg = { to: l.to, amount: BigInt(l.amount) };
  const t0 = Date.now();
  while (Date.now() - t0 < 15 * 60_000) {
    const receipt = await rq('eth_getTransactionReceipt', [l.hash]).catch(() => null);
    if (receipt) {
      const tx = asset.kind === 'native' ? await rq('eth_getTransactionByHash', [l.hash]).catch(() => null) : null;
      const r = core.checkLegReceipt({ asset, fan: record.fan, leg, receipt, tx });
      if (r.done) return { ok: r.ok, reason: r.reason, reverted: !r.ok && /reverted/.test(r.reason ?? '') };
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
  return { ok: false, reason: 'still not included after 15 minutes — check the explorer link; this page will not send it again' };
}

/* ── one lock for every wallet action (double-click guard) ────────────────── */
async function guard(kind, fn) {
  if (S.busy) return;
  S.busy = kind;
  render();
  try {
    await fn();
  } catch (e) {
    setStatus(e?.code != null ? core.walletErrorText(e) : String(e?.message ?? e).slice(0, 300), 'err');
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

/* ── render ───────────────────────────────────────────────────────────────── */
function artistRow(slug) {
  const a = S.bySlug.get(slug);
  const ens = ensFor(slug);
  const n = S.names.get(slug);
  let badge = '<span class="tip-badge wait">⏳ awaiting the artist’s wallet</span>';
  let can = false;
  if (ens) {
    if (!n || n.state === 'loading') badge = `<span class="tip-badge">reading ${esc(ens)}…</span>`;
    else if (n.state === 'ok') { badge = `<span class="tip-badge on">✅ tips on · ${esc(ens)}</span>`; can = true; }
    else badge = `<span class="tip-badge wait" title="${esc(n.message)}">⏳ ${esc(ens)} — ${n.code === 'no-consent' ? 'tips not switched on yet' : 'can’t read right now'}</span>`;
  }
  return `<label class="tip-artist${can ? '' : ' off'}"><input type="radio" name="tip-artist" value="${esc(slug)}" ${can ? '' : 'disabled'} ${S.slug === slug ? 'checked' : ''}><span class="nm">${esc(a?.name ?? slug)}</span>${badge}</label>`;
}

function render() {
  const root = $('#tip .body');
  if (!root || !S.loaded) return;
  const c = chain();
  const a = assetFor(c);
  const lim = limits(a);
  const amt = a ? core.parseAmount(S.amount, a.decimals, lim) : { ok: false };
  const slugs = circleSlugs();
  const enabled = !!S.config.enabled;
  const vis = visibleChains();
  const open = openRecords();
  const w = S.wallet;
  const busy = S.busy;
  const usd = (v) => (a ? core.usdOf(v, a.decimals, a.ui, S.price ? core.freshPrice(S.price, Math.floor(Date.now() / 1000)) : null) : null);
  const money = (v) => `${core.fromAtomic(v, a.decimals)} ${esc(a.symbol)}${usd(v) ? ` <small>≈ $${usd(v)}</small>` : a.ui === 'eth' ? ' <small>(USD price unavailable)</small>' : ''}`;

  let html = '';
  if (!enabled) html += `<div class="tip-banner err">Tips are switched off right now. ${esc(S.config.reason ?? '')}</div>`;
  else if (!S.config.mainnet) html += '<div class="tip-banner">🧪 Mainnet tips are not switched on yet — you can practise on a testnet (no real money).</div>';
  if (S.config.message) html += `<div class="tip-banner">${esc(S.config.message)}</div>`;

  if (open.length && !S.record) {
    const r = open[0];
    const rc = S.byId.get(r.chainId);
    html += `<div class="tip-tile warn"><h4>Unfinished tip in this browser</h4><p>${esc(core.fromAtomic(r.total, r.asset.decimals))} ${esc(r.asset.symbol)} on ${esc(rc?.name ?? r.chainId)} to ${esc(r.legs[0].label)} — ${r.legs.map((l) => `${esc(l.leg)}: <b>${esc(l.state)}</b>${l.hash && rc ? ` <a href="${esc(core.explorerTx(rc, l.hash))}" target="_blank" rel="noopener">tx ↗</a>` : ''}`).join(' · ')}</p>
      <div class="tip-row"><button class="pill" data-act="resume" data-id="${esc(r.id)}" ${busy || !w ? 'disabled' : ''}>continue it</button><button class="pill" data-act="dismiss" data-id="${esc(r.id)}" ${busy ? 'disabled' : ''}>forget it</button></div>
      ${w ? '' : '<p class="fine">Connect the same wallet below to continue. Transfers that already have a hash are never sent twice.</p>'}</div>`;
  }

  html += `<p class="tip-lede">Every artist in the circle can be tipped <b>straight into their own wallet</b> on Ethereum, its layer 2s and BNB Chain. <b>96.31%</b> goes to the artist, <b>3.69%</b> to the AI steward’s compute — Open Source Orchestra takes <b>zero</b> and never holds the money.</p>
    <div class="fork-split" aria-hidden="true"><span class="a">96.31% → the artist</span><span class="c">3.69%</span></div>`;

  html += `<fieldset class="tip-step"><legend>1 · who</legend><div class="tip-artists" role="radiogroup" aria-label="artist">${slugs.map(artistRow).join('')}</div>
    <p class="fine">Only artists who switched tips on, on their own ENS name, can be tipped. We never guess or type in an address — the rest show “awaiting the artist’s wallet”.</p></fieldset>`;

  html += `<fieldset class="tip-step"><legend>2 · where</legend>
    <div class="tip-net" role="radiogroup" aria-label="network type"><button class="pill ${S.network === 'mainnet' ? 'on' : ''}" data-net="mainnet" aria-pressed="${S.network === 'mainnet'}" ${S.config.mainnet ? '' : 'disabled'}>mainnets · real money</button><button class="pill ${S.network === 'testnet' ? 'on' : ''}" data-net="testnet" aria-pressed="${S.network === 'testnet'}">testnets · practice</button></div>
    <div class="tip-chains" id="tip-chains" role="radiogroup" aria-label="chain">${vis.map((x) => `<label class="tip-chain${S.chainId === x.chainId ? ' on' : ''}"><input type="radio" name="tip-chain" value="${x.chainId}" ${S.chainId === x.chainId ? 'checked' : ''}><b>${esc(x.name)}</b><small>${esc(x.testnet ? 'testnet · ' + (S.byId.get(x.testnetOf)?.name ?? '') : x.family)} · ${[x.usdc ? 'USDC' : null, x.nativeTip ? 'ETH' : null].filter(Boolean).join(' + ')}</small></label>`).join('')}</div></fieldset>`;

  if (c) {
    const usdcOk = !!c.usdc, ethOk = !!c.nativeTip;
    html += `<fieldset class="tip-step"><legend>3 · how much</legend>
      <div class="tip-net"><button class="pill ${S.asset === 'usdc' ? 'on' : ''}" data-asset="usdc" aria-pressed="${S.asset === 'usdc'}" ${usdcOk ? '' : 'disabled'}>USDC</button><button class="pill ${S.asset === 'native' ? 'on' : ''}" data-asset="native" aria-pressed="${S.asset === 'native'}" ${ethOk ? '' : 'disabled'}>${esc(c.nativeTip ? c.nativeCurrency.symbol : 'ETH')}</button></div>
      ${a ? `<label class="tip-amt"><span>amount (${esc(a.symbol)})</span><input id="tip-amount" inputmode="decimal" autocomplete="off" value="${esc(S.amount)}" aria-describedby="tip-split"></label>
      <div class="tip-row">${(a.ui === 'eth' ? ['0.001', '0.005', '0.01'] : ['1', '5', '10', '25']).map((v) => `<button class="pill" data-quick="${v}">${v}</button>`).join('')}</div>
      <p id="tip-split" class="tip-split-txt">${amt.ok ? `${money(amt.artist)} → artist (96.31%) · ${money(amt.steward)} → steward (3.69%) · <b>0 to OSO</b>` : esc(amt.message ?? '')}</p>
      <p class="fine">${a.kind === 'erc20' ? `Token: ${esc(a.symbol)} <a href="${esc(core.explorerAddress(c, a.address))}" target="_blank" rel="noopener">${esc(core.shortAddress(a.address))} ↗</a> · issued by ${esc(a.issuer)}${c.chainId === 56 ? ' · 18 decimals on BNB Chain' : ''}.` : `Native ${esc(a.symbol)} on ${esc(c.name)}.`} You pay the network fee in ${esc(c.nativeCurrency.symbol)}.</p>` : '<p class="fine">Pick a token.</p>'}
    </fieldset>`;
  }

  // the ONE primary action
  let action = '';
  const ready = enabled && S.slug && c && a && amt.ok && (c.testnet || S.config.mainnet);
  if (!enabled) action = '';
  else if (!w) {
    if (S.wallets.size) action = `<div class="tip-wallets">${[...S.wallets.values()].map((x) => `<button class="big tip-cta" data-connect="${esc(x.id)}" ${busy ? 'disabled' : ''}>${x.icon ? `<img src="${esc(x.icon)}" alt="">` : ''}${busy === 'connect' ? 'connecting…' : `connect ${esc(x.name)}`}</button>`).join('')}</div>`;
    else action = `<div class="tip-tile"><h4>No browser wallet here</h4><p>Open this page inside your wallet’s own browser (MetaMask, Coinbase Wallet, Rainbow, Rabby, Trust, OKX, Binance Wallet…) or install one. Nothing on this page works without your own wallet — that’s the point.</p><button class="pill" data-act="copy">copy this link</button></div>`;
  } else if (!ready) action = `<button class="big tip-cta" disabled>${!S.slug ? 'pick an artist' : !c ? 'pick a chain' : 'pick an amount'}</button>`;
  else if (w.chainId !== c.chainId) action = `<button class="big tip-cta" data-act="switch" ${busy ? 'disabled' : ''}>${busy === 'switch' ? 'switching…' : `switch wallet to ${esc(c.name)}`}</button>`;
  else if (!S.plan) action = `<button class="big tip-cta" data-act="review" ${busy ? 'disabled' : ''}>${busy === 'review' ? 'checking…' : 'review the tip'}</button>`;
  else {
    const p = S.plan;
    const pa = p.asset;
    const m = (v) => `${core.fromAtomic(v, pa.decimals)} ${esc(pa.symbol)}`;
    const rec = S.record && S.record.id === p.id ? S.record : null;
    html += `<div class="tip-review" id="tip-review"><h4>${c.testnet ? '🧪 TESTNET · no real money' : 'Real money · please read'}</h4>
      <dl><dt>chain</dt><dd>${esc(c.name)} · id ${c.chainId}</dd>
      <dt>token</dt><dd>${pa.kind === 'erc20' ? `${esc(pa.symbol)} · contract <a href="${esc(core.explorerAddress(c, pa.address))}" target="_blank" rel="noopener">${esc(core.shortAddress(pa.address))} ↗</a>` : `native ${esc(pa.symbol)}`}</dd>
      <dt>from</dt><dd>your wallet ${esc(core.shortAddress(p.fan))}</dd>
      ${p.legs.map((l, i) => `<dt>transfer ${i + 1}</dt><dd><b>${m(l.amount)}</b> → ${esc(l.label)} <a href="${esc(core.explorerAddress(c, l.to))}" target="_blank" rel="noopener"><code>${esc(core.shortAddress(l.to))}</code> ↗</a>${l.leg === 'artist+steward' ? '<br><small>the artist’s wallet is also the steward wallet today, so both shares go in one transfer</small>' : `<br><small>${l.leg === 'artist' ? '96.31% · the artist' : '3.69% · the AI steward’s compute'}</small>`}${rec ? ` <span class="tip-leg ${esc(rec.legs[i]?.state)}">${esc(rec.legs[i]?.state)}</span>${rec.legs[i]?.hash ? ` <a href="${esc(core.explorerTx(c, rec.legs[i].hash))}" target="_blank" rel="noopener">tx ↗</a>` : ''}` : ''}</dd>`).join('')}
      <dt>total</dt><dd>${m(p.total)} + network fee in ${esc(c.nativeCurrency.symbol)} · Open Source Orchestra gets 0</dd></dl>
      <p class="fine">Your wallet will ask ${p.legs.length === 1 ? 'once' : 'twice — once per transfer'}. Check that the addresses in the wallet match the ones above. Onchain transfers are public and can’t be undone.</p></div>`;
    const finished = rec && core.nextLeg(rec).action === 'done';
    action = finished
      ? '<button class="big tip-cta" data-act="again">tip again</button>'
      : `<div class="tip-row"><button class="big tip-cta" data-act="send" ${busy ? 'disabled' : ''}>${busy === 'send' ? 'sending — follow your wallet…' : rec ? 'continue the tip' : `send ${p.legs.length === 1 ? 'the tip' : 'both transfers'}`}</button><button class="pill" data-act="back" ${busy ? 'disabled' : ''}>change something</button></div>`;
  }
  html += `<div class="tip-action">${action}</div>`;
  html += `<p class="tip-status" id="tip-status" role="status" aria-live="polite" data-kind="${esc(S.statusKind)}">${esc(S.status)}</p>`;
  if (w) html += `<p class="fine">Wallet: ${esc(w.name)} · ${esc(core.shortAddress(w.account))} · chain ${w.chainId}${S.byId.get(w.chainId) ? ` (${esc(S.byId.get(w.chainId).name)})` : ''} · <button class="linkish" data-act="disconnect" ${busy ? 'disabled' : ''}>forget on this page</button></p>`;

  html += `<details class="tip-how"><summary>How this works · what is public · your escape hatch</summary>
    <ul><li><b>No custody, no contract.</b> Your wallet sends plain transfers straight to the artist and the steward. Nothing passes through Open Source Orchestra; there is no server and no smart contract of ours.</li>
    <li><b>Who gets paid</b> is read live from the artist’s own ENS name (<code>&lt;name&gt;.osoartist.eth</code>, their resolver, their records): a record for this chain first (ENSIP-11), then their “every EVM chain” record (ENSIP-19), then their ETH address only if it is a key-held wallet. No record → no tip.</li>
    <li><b>The steward</b> share goes to the address on <code>osoartist.eth</code>, which must match <code>${esc(core.shortAddress(S.config.stewardPin))}</code> or tips stop.</li>
    <li><b>Public:</b> both transfers (your address, amounts, time) are public onchain forever. ENS names are read through public Ethereum RPCs (${esc((S.config.ensRpcUrls ?? []).map((u) => new URL(u).host).join(', '))}); your wallet’s own RPC sees your balance checks. No analytics, no cookies.</li>
    <li><b>Stablecoin risk:</b> USDC is issued by Circle and can be frozen by its issuer; on BNB Chain it is Binance-Peg USDC, issued by Binance. ETH tips avoid issuer risk.</li>
    <li><b>Escape hatch:</b> you never need this page — send to the artist’s ENS name from any wallet yourself. The code is open source: <a href="https://github.com/Open-Source-Orchestra/fork-the-first-artist" target="_blank" rel="noopener">GitHub</a>. Token addresses were checked onchain ${esc((S.chainsVerifiedAt ?? '').slice(0, 10))} against Circle’s list and are re-checked in your wallet before every tip.</li></ul></details>`;

  const focusId = document.activeElement?.id;
  root.innerHTML = html;
  if (focusId === 'tip-amount') { const i = $('#tip-amount'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }
}

/* ── events ───────────────────────────────────────────────────────────────── */
function bind() {
  const root = $('#tip .body');
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'tip-artist') { S.slug = t.value; S.plan = null; render(); }
    if (t.name === 'tip-chain') { S.chainId = Number(t.value); const c = chain(); if (!assetFor(c)) S.asset = c?.usdc ? 'usdc' : 'native'; S.plan = null; render(); }
  });
  root.addEventListener('input', (e) => {
    if (e.target.id === 'tip-amount') { S.amount = e.target.value.slice(0, 40); S.plan = null; render(); }
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.net) { S.network = b.dataset.net; S.chainId = null; S.plan = null; render(); }
    else if (b.dataset.asset) { S.asset = b.dataset.asset; S.amount = S.asset === 'native' ? '0.001' : '5'; S.plan = null; render(); }
    else if (b.dataset.quick) { S.amount = b.dataset.quick; S.plan = null; render(); }
    else if (b.dataset.connect) connect(b.dataset.connect);
    else if (b.dataset.act === 'switch') switchChain();
    else if (b.dataset.act === 'review') review();
    else if (b.dataset.act === 'send') { const rec = S.record && S.record.id === S.plan.id ? S.record : recordFromPlan(S.plan); send(rec); }
    else if (b.dataset.act === 'back') { S.plan = null; setStatus(''); render(); }
    else if (b.dataset.act === 'again') { S.plan = null; S.record = null; setStatus(''); render(); }
    else if (b.dataset.act === 'disconnect') { if (S.wallet) detach(S.wallet.provider); S.wallet = null; S.plan = null; setStatus('Forgotten on this page. Your wallet’s own site permissions are unchanged.'); render(); }
    else if (b.dataset.act === 'copy') navigator.clipboard?.writeText(location.href).then(() => setStatus('Link copied — paste it into your wallet’s browser.', 'ok'));
    else if (b.dataset.act === 'dismiss') { const all = ledger(); if (all[b.dataset.id]) { all[b.dataset.id].dismissed = true; localStorage.setItem(LEDGER_KEY, JSON.stringify(all)); } render(); }
    else if (b.dataset.act === 'resume') resume(b.dataset.id);
  });
}

async function resume(id) {
  const r = ledger()[id];
  if (!r || !S.wallet) return;
  const c = S.byId.get(r.chainId);
  if (!c) return setStatus('That chain is not offered any more — check the explorer links instead.', 'err');
  if (!core.sameAddress(S.wallet.account, r.fan)) return setStatus(`Connect the wallet that started this tip (${core.shortAddress(r.fan)}).`, 'err');
  S.network = c.testnet ? 'testnet' : 'mainnet';
  S.chainId = c.chainId;
  S.slug = r.artistSlug;
  S.asset = r.asset.kind === 'native' ? 'native' : 'usdc';
  if (S.wallet.chainId !== c.chainId) await switchChain();
  if (S.wallet?.chainId !== c.chainId) return;
  S.plan = { ...r, id: r.id, chain: c, asset: r.asset, total: BigInt(r.total), fan: r.fan, legs: r.legs.map((l) => ({ ...l, amount: BigInt(l.amount) })) };
  S.record = r;
  render();
  await send(r);
}

/* ── mount ────────────────────────────────────────────────────────────────── */
function mount() {
  if (STANDALONE) {
    $('#tip-root').innerHTML = '<section id="tip" class="tip-page" aria-label="tip an artist"><div class="body"></div></section>';
  } else {
    const p = document.createElement('aside');
    p.className = 'panel';
    p.id = 'tip';
    p.setAttribute('aria-label', 'tip an artist on any Ethereum chain');
    p.innerHTML = '<header><h2>💸 Tip an artist · any Ethereum chain</h2><button class="x" id="tip-x" aria-label="close">✕</button></header><div class="body"></div>';
    document.body.appendChild(p);
    $('#tip-x').addEventListener('click', () => p.classList.remove('open'));
    const btn = document.createElement('button');
    btn.className = 'pill';
    btn.id = 'tip-open';
    btn.type = 'button';
    btn.setAttribute('aria-controls', 'tip');
    btn.textContent = '💸 tip · any Ethereum chain';
    btn.addEventListener('click', () => openTip());
    const place = () => { const right = $('#top .right'); if (!right) return; const f = $('#fork-open'); if (f) f.after(btn); else right.prepend(btn); };
    place();
    setTimeout(place, 800); // fork.js may mount its opener after us — keep ours right next to it
    document.addEventListener('fork:artist', (e) => {
      const slug = e.detail?.slug;
      const links = $('#detail-body .links');
      if (!slug || !links || links.querySelector('[data-tip-artist]')) return;
      const b = document.createElement('button');
      b.className = 'pill tip-detail';
      b.dataset.tipArtist = slug;
      b.textContent = ensFor(slug) ? `💸 tip ${S.bySlug.get(slug)?.name ?? slug}` : '💸 tips · awaiting the artist’s wallet';
      b.addEventListener('click', () => openTip(slug));
      links.appendChild(b);
    });
  }
  bind();
}

export async function openTip(slug) {
  await S.loaded;
  if (slug && ensFor(slug)) { S.slug = slug; S.plan = null; }
  if (!STANDALONE) {
    document.querySelectorAll('.panel.open').forEach((p) => p.id !== 'tip' && p.classList.remove('open'));
    $('#tip').classList.add('open');
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
  render();
  if (STANDALONE || p.has('tip')) openTip(p.get('tip') || undefined);
});
window.__tip = { S, openTip, render };
