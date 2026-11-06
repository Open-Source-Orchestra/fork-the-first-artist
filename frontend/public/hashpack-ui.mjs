import { createHederaConnection } from './hedera-wallet.mjs';

const connect = document.querySelector('#connect-hedera');
const forget = document.querySelector('#forget-hedera');
const select = document.querySelector('#hedera-account');
const status = document.querySelector('#hedera-status');
const pairing = document.querySelector('#hedera-pairing');
const qr = document.querySelector('#hedera-qr');
const copy = document.querySelector('#copy-pairing');
const copyStatus = document.querySelector('#pairing-copy-status');
let runtime;
let config;
let generation = 0;

function render(state) {
  generation += 1;
  const current = generation;
  connect.disabled = !config?.enabled || ['connecting', 'pairing'].includes(state.status);
  forget.disabled = state.status === 'disconnected';
  select.replaceChildren(new Option('Select a testnet payout account', ''), ...state.accounts.map((account) => new Option(account.slice('hedera:testnet:'.length), account)));
  select.value = state.account ?? '';
  select.disabled = !['select-account', 'connected'].includes(state.status);
  status.textContent = state.message;
  pairing.hidden = !state.uri;
  copyStatus.textContent = '';
  qr.removeAttribute('src');
  qr.hidden = true;
  if (state.uri) {
    void runtime.pairingQr(state.uri).then((image) => {
      if (generation === current) { qr.src = image; qr.hidden = false; }
    }).catch(() => {
      if (generation === current) copyStatus.textContent = 'QR rendering failed. Use Copy pairing link instead.';
    });
  }
}
const connection = createHederaConnection({
  createClient: async () => {
    runtime ??= await import('/hashpack-runtime.mjs');
    return runtime.createHashPackClient(config.projectId, window.location.origin);
  },
  onChange: render,
});

connect.addEventListener('click', () => { if (config?.enabled) void connection.connect(); });
forget.addEventListener('click', () => { void connection.forget(); });
select.addEventListener('change', () => connection.selectAccount(select.value));
copy.addEventListener('click', async () => {
  const uri = connection.getState().uri;
  if (!uri) return;
  try {
    await navigator.clipboard.writeText(uri);
    if (connection.getState().uri === uri) copyStatus.textContent = 'Pairing link copied. Paste only into your HashPack wallet; do not share it.';
  } catch {
    if (connection.getState().uri === uri) copyStatus.textContent = 'Clipboard access was denied. Scan the QR code with HashPack instead.';
  }
});
window.addEventListener('pagehide', () => { void connection.forget(); });

try {
  const response = await fetch('/wallet-config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Configuration unavailable');
  config = await response.json();
  document.querySelector('#wallet-notices').hidden = !config.runtimeReady;
  if (!config.enabled) {
    status.textContent = 'HashPack pairing is not configured yet. Your payout account remains unverified.';
  } else {
    render(connection.getState());
  }
} catch {
  status.textContent = 'Wallet configuration could not be loaded. Reload the page to try again.';
}
