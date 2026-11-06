import { connectWallet } from '/wallet-connect.mjs';
// Plain EIP-1193 (window.ethereum) personal_sign — no Reown, no network calls, no gas.
import { buildConsentMessage, CONSENT_CHAIN_ID } from '/consent-message.mjs';
import { recoverMessageAddress } from '/vendor/viem-recover.min.js';
import { decodeInvite, trustedStewards, verifyInvite } from '/trust-message.mjs';

const $ = (id) => document.getElementById(id);
let account = null;
let timestamp = null;
let invite = null;     // a steward's signed invitation — required: nobody claims a name in the circle alone
let inviteRaw = null;

const toHex = (s) => `0x${Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('')}`;

function fields() {
  return {
    ...(invite ? { inviteId: invite.inviteId } : {}),
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
    const wrongWallet = invite?.bindTo && account && invite.bindTo.toLowerCase() !== account.toLowerCase();
    $('sign').disabled = !account || !invite || Boolean(wrongWallet);
    $('status').textContent = !invite ? 'You need a steward’s invitation link to sign.' : wrongWallet ? `This invitation is for wallet ${invite.bindTo} — switch to that wallet.` : account ? '' : 'Connect your wallet first.';
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
    const a = await connectWallet();
    account = a;
    $('account').textContent = a;
    render();
  } catch (e) {
    $('status').textContent = e.message ?? String(e);
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
    const json = JSON.stringify({ ...f, slug: invite.artist, message, signature, invite: inviteRaw }, null, 2);
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
async function checkInvite() {
  const banner = $('invite-banner');
  const raw = new URLSearchParams(location.search).get('invite');
  if (!raw) {
    banner.classList.add('bad');
    banner.innerHTML = '<strong>Invitation needed.</strong> Names in the circle are claimed by invitation: a steward of Open Source Orchestra (today, Shaka) sends you a personal link. Ask a steward on the floor or write to aloha@myagentohana.com.';
    $('label').disabled = true;
    return;
  }
  try {
    const inv = decodeInvite(raw);
    const doc = await fetch('/fork/stewards.json', { cache: 'no-cache' }).then((r) => r.json());
    const trusted = await trustedStewards(doc, (message, signature) => recoverMessageAddress({ message, signature }));
    const { steward } = await verifyInvite(inv, trusted, (message, signature) => recoverMessageAddress({ message, signature }));
    invite = inv; inviteRaw = raw;
    $('label').value = inv.label; $('label').readOnly = true;
    const who = String(inv.artistName ?? inv.artist).replace(/[<>&"]/g, '');
    banner.innerHTML = `🌺 <strong>${steward.name.replace(/[<>&"]/g, '')}</strong> (${steward.role === 'root' ? 'root steward' : 'steward'}) invited <strong>${who}</strong> to claim <strong>${inv.label}.osoartist.eth</strong>${inv.bindTo ? ` for wallet <code>${inv.bindTo}</code>` : ''}. Valid until ${inv.expiresAt.slice(0, 16).replace('T', ' ')} UTC.`;
    $('out-steward').textContent = steward.name;
  } catch (e) {
    banner.classList.add('bad');
    banner.innerHTML = `<strong>This invitation can’t be used:</strong> ${String(e.message ?? e).replace(/[<>&"]/g, '')}`;
    $('label').disabled = true;
  }
  render();
}
render();
checkInvite();
