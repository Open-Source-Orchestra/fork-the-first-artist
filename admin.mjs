// Steward desk: invite → (artist consents on /consent) → approve, plus root-signed steward grants.
// Plain EIP-1193 personal_sign. Nothing is sent anywhere; outputs are links/JSON the steward shares.
import { recoverMessageAddress, hashMessage, isAddress, getAddress } from '/vendor/viem-recover.min.js';
import { buildApprovalMessage, buildGrantMessage, buildInviteMessage, decodeInvite, encodeInvite, trustedStewards, verifyInvite } from '/trust-message.mjs';
import { buildConsentMessage } from '/consent-message.mjs';
import { connectWallet } from '/wallet-connect.mjs';

const $ = (id) => document.getElementById(id);
const recover = (message, signature) => recoverMessageAddress({ message, signature });
const toHex = (s) => `0x${Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('')}`;
const sign = (message) => window.ethereum.request({ method: 'personal_sign', params: [toHex(message), account] });

let account = null;
let me = null;
let doc = null;
let trusted = new Map();
let artists = [];
let pending = null;

async function load() {
  doc = await fetch('/fork/stewards.json', { cache: 'no-cache' }).then((r) => r.json());
  trusted = await trustedStewards(doc, recover);
  $('root-name').textContent = `· ${doc.root.name} (${doc.root.address.slice(0, 6)}…${doc.root.address.slice(-4)})`;
  $('steward-count').textContent = `· ${trusted.size - 1} granted so far`;
  const data = await fetch('/data/artists.json', { cache: 'no-cache' }).then((r) => r.json()).catch(() => ({ artists: [] }));
  artists = data.artists.filter((a) => /^[a-z0-9-]{1,60}$/.test(a.slug)).sort((a, b) => a.name.localeCompare(b.name));
  $('artist').innerHTML = artists.map((a) => `<option value="${a.slug}">${a.name.replace(/[<>&"]/g, '')}</option>`).join('');
  const want = new URLSearchParams(location.search).get('artist');
  if (want && artists.some((a) => a.slug === want)) $('artist').value = want;
  syncLabel();
}
function syncLabel() {
  const slug = $('artist').value;
  $('label').value = slug.replace(/^-+|-+$/g, '').slice(0, 63);
  $('label-preview').textContent = $('label').value || '…';
}
$('artist').addEventListener('change', syncLabel);
$('label').addEventListener('input', () => { $('label').value = $('label').value.toLowerCase(); $('label-preview').textContent = $('label').value || '…'; });

$('connect').addEventListener('click', async () => {
  if (!window.ethereum) { $('who-status').textContent = 'No browser wallet found. Open this page in MetaMask (or any EIP-1193 wallet).'; return; }
  await loaded;
  try {
    account = await connectWallet();
    $('account').textContent = account;
    me = trusted.get(account.toLowerCase()) ?? null;
    if (me) {
      $('who-status').textContent = `Welcome, ${me.name} — you are ${me.role === 'root' ? 'the root steward (owner of osoartist.eth)' : 'a granted steward'}. Your signatures count.`;
      $('invite-fields').disabled = false; $('approve-fields').disabled = false;
      $('grow-fields').disabled = me.role !== 'root';
      if (me.role !== 'root') $('grow-status').textContent = 'Only the root steward can grant new stewards (for now).';
    } else {
      $('who-status').textContent = 'This wallet is not a steward of the circle, so its invitations and approvals would be refused. Ask the root steward for a grant (section 03).';
    }
  } catch (e) { $('who-status').textContent = e.message ?? String(e); }
});

/* 01 invite */
$('invite-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const bind = $('bind').value.trim();
  if (bind && !isAddress(bind)) { $('invite-status').textContent = 'That wallet address is not valid.'; return; }
  const issuedAt = new Date().toISOString();
  const inv = {
    v: 1, kind: 'oso.invite',
    artist: $('artist').value, label: $('label').value.trim(), inviteId: crypto.randomUUID(),
    bindTo: bind ? getAddress(bind) : null, issuedAt,
    expiresAt: new Date(Date.parse(issuedAt) + Number($('days').value) * 86_400_000).toISOString(),
    steward: account,
  };
  let message;
  try { message = buildInviteMessage(inv); } catch (e) { $('invite-status').textContent = e.message; return; }
  $('invite-status').textContent = 'Check your wallet: it should show exactly the invitation below.';
  $('invite-message').textContent = message;
  try {
    inv.signature = await sign(message);
    await verifyInvite(inv, trusted, recover);
    const name = artists.find((a) => a.slug === inv.artist)?.name ?? inv.artist;
    inv.artistName = name;
    const link = `${location.origin}/consent?invite=${encodeInvite(inv)}`;
    $('invite-link').value = link; $('invite-open').href = link;
    $('invite-out').hidden = false;
    $('invite-status').textContent = `Invitation for ${name} signed ✓ — valid until ${inv.expiresAt.slice(0, 16).replace('T', ' ')} UTC.`;
  } catch (e) { $('invite-status').textContent = `Not signed: ${e.message ?? e}`; }
});
$('invite-copy').addEventListener('click', () => navigator.clipboard?.writeText($('invite-link').value).then(() => { $('invite-status').textContent = 'Link copied.'; }));

/* 02 approve */
function check(ok, text) { const li = document.createElement('li'); li.className = ok ? 'ok' : 'bad'; li.textContent = `${ok ? '✓' : '✕'} ${text}`; $('checks').appendChild(li); return ok; }
$('check').addEventListener('click', async () => {
  $('checks').innerHTML = ''; $('approve-go').disabled = true; pending = null; $('approve-out').hidden = true;
  let c;
  try { c = JSON.parse($('claim').value); } catch { check(false, 'This is not JSON — paste the whole block from the artist’s consent page.'); return; }
  try {
    const inv = typeof c.invite === 'string' ? decodeInvite(c.invite) : c.invite;
    if (!check(Boolean(inv && inv.signature), 'carries a steward invitation')) return;
    const { steward } = await verifyInvite(inv, trusted, recover, Date.parse(c.timestamp));
    check(true, `invitation signed by ${steward.name} (${steward.role}), valid when the artist signed`);
    if (!check(c.label === inv.label, `name matches the invitation: ${inv.label}.osoartist.eth`)) return;
    if (!check(c.inviteId === inv.inviteId, 'the artist’s signature quotes this invitation')) return;
    const message = buildConsentMessage(c);
    if (!check(c.message == null || c.message === message, 'signed text is the canonical consent')) return;
    const signer = await recover(message, c.signature);
    if (!check(signer.toLowerCase() === String(c.ethAddress).toLowerCase(), `signed by the artist’s own wallet ${getAddress(c.ethAddress)}`)) return;
    if (inv.bindTo && !check(inv.bindTo.toLowerCase() === c.ethAddress.toLowerCase(), 'wallet is the one the invitation was bound to')) return;
    check(true, `payout: ${c.hederaPayout === 'alias' ? 'the artist’s own ETH address as a Hedera alias' : `Hedera ${c.hederaPayout}`}`);
    if (account && !trusted.has(account.toLowerCase())) { check(false, 'your connected wallet is not a steward — connect a steward wallet to approve'); return; }
    pending = { c, inv, consentHash: hashMessage(message) };
    $('approve-go').disabled = !account;
    $('approve-status').textContent = account ? 'All checks pass. Sign to approve.' : 'All checks pass. Connect your steward wallet to approve.';
  } catch (e) { check(false, e.message ?? String(e)); }
});
$('approve-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!pending) return;
  const { c, inv, consentHash } = pending;
  const approval = { label: c.label, ethAddress: getAddress(c.ethAddress), hederaPayout: c.hederaPayout, consentHash, inviteId: inv.inviteId, approvedAt: new Date().toISOString(), steward: account };
  try {
    const message = buildApprovalMessage(approval);
    $('approve-status').textContent = 'Check your wallet: it should show the approval for this artist.';
    approval.signature = await sign(message);
    approval.message = message;
    const out = { ...c, slug: inv.artist, invite: inv, approval };
    const json = JSON.stringify(out, null, 2);
    $('approve-json').textContent = json;
    $('approve-download').href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    $('approve-download').download = `approved-${c.label}.json`;
    $('approve-out').hidden = false;
    $('approve-status').textContent = `Approved ✓ ${c.label}.osoartist.eth → ${approval.ethAddress}`;
  } catch (e) { $('approve-status').textContent = `Not signed: ${e.message ?? e}`; }
});
$('approve-copy').addEventListener('click', () => navigator.clipboard?.writeText($('approve-json').textContent));

/* 03 grow */
$('grow-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const addr = $('g-addr').value.trim();
  if (!isAddress(addr)) { $('grow-status').textContent = 'That wallet address is not valid.'; return; }
  const grant = { address: getAddress(addr), name: $('g-name').value.trim(), grantedAt: new Date().toISOString() };
  try {
    const message = buildGrantMessage({ steward: grant.address, name: grant.name, grantedAt: grant.grantedAt, root: doc.root.address });
    grant.signature = await sign(message);
    if ((await recover(message, grant.signature)).toLowerCase() !== doc.root.address.toLowerCase()) throw new Error('only the root steward’s signature creates a steward');
    $('grow-json').textContent = JSON.stringify(grant, null, 2);
    $('grow-json').hidden = false;
    $('grow-status').textContent = `Grant for ${grant.name} signed ✓ — send it to the ʻohana ops to add to fork/stewards.json.`;
  } catch (e) { $('grow-status').textContent = `Not signed: ${e.message ?? e}`; }
});

const loaded = load().catch((e) => { $('who-status').textContent = `Could not load the steward list: ${e.message}`; });
