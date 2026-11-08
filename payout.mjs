// /payout — the artist changes the Hedera payout on their own <label>.osoartist.eth.
// Reads via public Ethereum RPCs, prepares ONE resolver transaction, shows it, and asks the
// artist's own EIP-1193 wallet to send it. This page never signs or sends anything by itself.
import { connectWallet } from '/wallet-connect.mjs';
import {
  DEFAULT_REGISTRY, buildTx, checkSigner, coinLabel, COIN, describePlan, effectivePayout, isHederaAccountId,
  makeRpc, parseLabel, planPayout, readRecords, simulate,
} from '/payout-plan.mjs';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const rpc = makeRpc();
let registry = DEFAULT_REGISTRY;
let info = null;        // readRecords() result
let account = null;     // connected wallet (untrusted until it matches the owner)
let chainId = null;
let current = null;     // { plan, tx } on screen
let revision = 0;       // drops stale async checks

const radio = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;

function row(dt, dd) { return `<dt>${esc(dt)}</dt><dd>${dd}</dd>`; }
const code = (s) => (s ? `<code>${esc(s)}</code>` : '<em>not set</em>');

function renderCurrent() {
  const r = info.records;
  const t = effectivePayout(r, 'testnet');
  const m = effectivePayout(r, 'mainnet');
  const now = (p, net) => (r.network && r.network !== net ? `refused (name says ${esc(r.network)})` : p.payTo ? `${code(p.payTo)} <small>(${esc(p.path)})</small>` : 'nobody');
  $('current').innerHTML = [
    row('name', code(info.name)),
    row('owner', info.owner ? code(info.owner) : '<em>not registered</em>'),
    row('resolver', code(info.resolver)),
    row(coinLabel(COIN.HBAR), code(r.hbarAccount ?? r.hbarRaw)),
    row(coinLabel(COIN.HEDERA_TESTNET_EVM), code(r.evmTestnet)),
    row(coinLabel(COIN.HEDERA_MAINNET_EVM), code(r.evmMainnet)),
    row(coinLabel(COIN.ETH), code(r.eth)),
    row('text hedera.network', code(r.network)),
    row('text oso.consent', code(r.consent)),
    row('text oso.steward.status', code(r.stewardStatus)),
    row('a testnet tip pays today', now(t, 'testnet')),
    row('a mainnet tip pays today', now(m, 'mainnet')),
  ].join('');
  $('current').hidden = false;
}

async function read(e) {
  e?.preventDefault();
  const my = ++revision;
  info = null; current = null;
  $('choose-card').hidden = true; $('review-card').hidden = true; $('current').hidden = true;
  let label;
  try { label = parseLabel($('label').value); } catch (err) { $('read-status').textContent = err.message; return; }
  $('label').value = label;
  history.replaceState(null, '', `?artist=${encodeURIComponent(label)}`);
  $('read-status').textContent = `reading ${label}.osoartist.eth from Ethereum mainnet…`;
  try {
    const got = await readRecords(label, { rpc, registry });
    if (my !== revision) return;
    info = got;
  } catch (err) {
    $('read-status').textContent = `Could not read the name right now (${err.message}). Public RPCs rate-limit; try again in a moment.`;
    return;
  }
  renderCurrent();
  if (!info.owner || !info.resolver) {
    $('read-status').textContent = `${info.name} is not issued yet${info.owner ? ' (no resolver)' : ''}. A steward invites you, you sign consent, a steward approves, then the name is issued to your wallet.`;
    return;
  }
  $('read-status').textContent = `${info.name} is owned by ${info.owner}. Only that wallet can change these records.`;
  const r = info.records;
  if (r.network === 'mainnet' || r.network === 'testnet') document.querySelector(`input[name="network"][value="${r.network}"]`).checked = true;
  if (r.hbarAccount) { document.querySelector('input[name="mode"][value="account"]').checked = true; $('account-id').value = r.hbarAccount; }
  else document.querySelector('input[name="mode"][value="wallet"]').checked = true;
  $('choose-card').hidden = false;
  update();
}

function update() {
  if (!info?.resolver) return;
  const my = ++revision;
  $('review-card').hidden = false;
  $('send').disabled = true;
  $('send-status').textContent = '';
  const network = radio('network');
  const mode = radio('mode');
  $('account-id').disabled = mode !== 'account';
  const checks = [];
  const mark = (ok, text) => checks.push(`<li class="${ok ? 'ok' : 'bad'}">${ok ? '✔' : '✖'} ${esc(text)}</li>`);
  try {
    if (mode === 'account' && !isHederaAccountId($('account-id').value)) throw new Error('Enter your Hedera account id, like 0.0.12345.');
    const plan = planPayout({ label: info.label, network, mode, accountId: $('account-id').value, walletAddress: account, current: info });
    const tx = buildTx(plan, info.resolver);
    current = { plan, tx };
    $('plan').textContent = describePlan(plan, info.resolver).join('\n');
    $('warnings').innerHTML = plan.warnings.map((w) => `<li class="bad">⚠ ${esc(w)}</li>`).join('');
    $('calldata').textContent = `to:    ${tx.to} (your resolver)\nvalue: 0\nchain: Ethereum mainnet (1)\ndata:  ${tx.data}`;
  } catch (err) {
    current = null;
    $('plan').textContent = err.message;
    $('warnings').innerHTML = '';
    $('calldata').textContent = '';
    $('checks').innerHTML = '';
    return;
  }
  const signer = checkSigner({ owner: info.owner, account });
  mark(signer.ok, signer.reason);
  if (account) mark(chainId === '0x1', chainId === '0x1' ? 'wallet is on Ethereum mainnet' : `wallet is on chain ${chainId}; it will be asked to switch to Ethereum mainnet`);
  $('checks').innerHTML = checks.join('');
  if (!signer.ok) return;
  $('checks').insertAdjacentHTML('beforeend', '<li>… dry-running the exact transaction from your address</li>');
  simulate(rpc, current.tx, account).then((sim) => {
    if (my !== revision) return;
    mark(sim.ok, sim.ok ? 'dry run: your resolver accepts this from your address' : `dry run failed: ${sim.reason}`);
    $('checks').innerHTML = checks.join('');
    $('send').disabled = !sim.ok;
  }, (err) => {
    if (my !== revision) return;
    mark(false, `could not dry-run right now (${err.message}); try again`);
    $('checks').innerHTML = checks.join('');
  });
}

async function connect() {
  try {
    account = await connectWallet();
    chainId = await window.ethereum.request({ method: 'eth_chainId' });
    $('who').textContent = `connected as ${account}`;
  } catch (err) {
    account = null;
    $('who').textContent = err.message;
  }
  update();
}

async function send() {
  if (!current || !info) return;
  $('send').disabled = true;
  try {
    const [now] = await window.ethereum.request({ method: 'eth_accounts' });
    const signer = checkSigner({ owner: info.owner, account: now });
    if (!signer.ok) throw new Error(signer.reason);
    if ((await window.ethereum.request({ method: 'eth_chainId' })) !== '0x1') {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] });
    }
    $('send-status').textContent = 'Check your wallet: confirm the transaction to your own resolver…';
    const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: now, ...current.tx }] });
    $('send-status').innerHTML = `Sent by your wallet: <a href="https://etherscan.io/tx/${esc(hash)}" target="_blank" rel="noopener">${esc(hash)}</a>. Once it confirms, <button type="button" id="reread">re-read your records</button>. Tips use the new payout within about a minute.`;
    $('reread').addEventListener('click', read);
  } catch (err) {
    $('send-status').textContent = err?.code === 4001 ? 'You declined in your wallet. Nothing was sent.' : `Not sent: ${err.message ?? err}`;
    $('send').disabled = false;
  }
}

$('name-form').addEventListener('submit', read);
$('payout-form').addEventListener('change', update);
$('account-id').addEventListener('input', update);
$('connect').addEventListener('click', connect);
$('send').addEventListener('click', send);
window.ethereum?.on?.('accountsChanged', (a) => { account = a?.[0] ?? null; $('who').textContent = account ? `connected as ${account}` : 'not connected'; update(); });
window.ethereum?.on?.('chainChanged', (c) => { chainId = c; update(); });

fetch('/fork/registry.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then((d) => {
  if (d && /^0x[0-9a-fA-F]{40}$/.test(d.registry ?? '')) registry = d.registry;
}).catch(() => {}).finally(() => {
  const preset = new URLSearchParams(location.search).get('artist');
  if (preset) { $('label').value = preset; read(); }
});
