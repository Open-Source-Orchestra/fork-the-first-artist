// Plain EIP-1193 (window.ethereum) personal_sign — no Reown, no network calls, no gas.
import { buildConsentMessage, CONSENT_CHAIN_ID } from '/consent-message.mjs';

const $ = (id) => document.getElementById(id);
let account = null;
let timestamp = null;

const toHex = (s) => `0x${Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('')}`;

function fields() {
  return {
    label: $('label').value.trim().toLowerCase(),
    ethAddress: account ?? '',
    hederaPayout: $('hedera').value.trim() || 'alias',
    timestamp: timestamp ?? new Date().toISOString(),
    chainId: CONSENT_CHAIN_ID,
  };
}

function render() {
  timestamp = new Date().toISOString();
  try {
    $('message').textContent = buildConsentMessage(fields());
    $('sign').disabled = !account;
    $('status').textContent = account ? '' : 'Connect your wallet first.';
  } catch (e) {
    $('message').textContent = `— ${e.message} —`;
    $('sign').disabled = true;
  }
}

$('connect').addEventListener('click', async () => {
  if (!window.ethereum) {
    $('status').textContent = 'No browser wallet found. Open this page in MetaMask (or any EIP-1193 wallet) and retry.';
    return;
  }
  try {
    const [a] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    account = a;
    $('account').textContent = a;
    render();
  } catch (e) {
    $('status').textContent = `Wallet refused: ${e.message ?? e}`;
  }
});
for (const id of ['label', 'hedera']) $(id).addEventListener('input', render);

$('consent-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = fields();
  let message;
  try {
    message = buildConsentMessage(f);
  } catch (e) {
    $('status').textContent = e.message;
    return;
  }
  $('message').textContent = message;
  $('status').textContent = 'Check your wallet: it should show exactly the message above.';
  try {
    const signature = await window.ethereum.request({ method: 'personal_sign', params: [toHex(message), account] });
    const json = JSON.stringify({ ...f, message, signature }, null, 2);
    $('json').textContent = json;
    $('download').href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    $('download').download = `consent-${f.label}.json`;
    $('out-card').hidden = false;
    $('status').textContent = 'Signed. Nothing was sent anywhere — copy or download the JSON below.';
  } catch (e) {
    $('status').textContent = `Not signed: ${e.message ?? e}`;
  }
});
$('copy').addEventListener('click', () => navigator.clipboard?.writeText($('json').textContent));
render();
