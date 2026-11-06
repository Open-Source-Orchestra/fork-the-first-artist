// Read the circle's trust ledger (schema oso.trust.v1) live from Arkiv's public RPC and re-verify
// every signature in the browser. No key, no backend, no cache.
import { recoverMessageAddress } from '/vendor/viem-recover.min.js';
import { buildApprovalMessage, buildInviteMessage, trustedStewards } from '/trust-message.mjs';
import { buildConsentMessage } from '/consent-message.mjs';

const RPC = 'https://rpc.rabdi.db-chain.testnet.arkiv.network';
const WRITER = '0x8e9d4dEc12bc9Da62daB72304659ef1eE6B200f2';
const EXPLORER = 'https://rabdi.explorer.arkiv.network';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const recover = (message, signature) => recoverMessageAddress({ message, signature });
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
$('writer').textContent = WRITER;

function decode(hex) {
  const bytes = new Uint8Array((hex.slice(2).match(/../g) ?? []).map((b) => parseInt(b, 16)));
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function query(namespace) {
  const q = `arkiv.schema = str('oso.trust.v1') AND $owner = addr(${WRITER}) AND $creator = addr(${WRITER}) AND namespace = str('${namespace}')`;
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'arkiv_query', params: [q, { select: { key: true, owner: true, creator: true, createdAt: true, creationFlags: true, attributes: true }, limit: '0x64' }] }) });
  const j = await r.json();
  if (j.error || !Array.isArray(j.result?.data)) throw new Error(j.error?.message ?? 'malformed Arkiv response');
  return j.result.data.map((e) => {
    const at = Object.fromEntries(e.attributes.map((a) => [a.name, a.value]));
    return { key: e.key, block: Number(BigInt(e.createdAt)), readonly: e.creationFlags?.readonly === true, owner: e.owner, kind: at.kind, id: at.id, label: at.label, steward: at.steward, payload: decode(at.payload) };
  }).sort((a, b) => a.block - b.block || ['grant', 'invite', 'consent', 'approval'].indexOf(a.kind) - ['grant', 'invite', 'consent', 'approval'].indexOf(b.kind));
}
async function verify(rec, trusted) {
  const p = rec.payload;
  let message;
  if (rec.kind === 'invite') message = buildInviteMessage(p);
  else if (rec.kind === 'consent') message = buildConsentMessage(p);
  else if (rec.kind === 'approval') message = buildApprovalMessage(p);
  else if (rec.kind === 'grant') message = p.message;
  if (p.message && p.message !== message) return { ok: false, why: 'stored text differs from the canonical message' };
  const signer = (await recover(message, p.signature)).toLowerCase();
  if (rec.kind === 'consent') return signer === p.ethAddress.toLowerCase() ? { ok: true, who: `artist's own wallet ${short(p.ethAddress)}` } : { ok: false, why: 'not signed by the artist wallet' };
  const t = trusted.get(signer);
  return t ? { ok: true, who: `${t.name} (${t.role})` } : { ok: false, who: short(signer), why: 'valid signature, but not a trusted steward of the circle' };
}
const ICON = { grant: '🌱', invite: '💌', consent: '✍️', approval: '✅' };
async function render(ns, list, status, trusted, rehearsal) {
  try {
    const recs = await query(ns);
    if (!recs.length) { status.textContent = rehearsal ? 'No rehearsal records found.' : 'No real records yet — the first appears when a steward’s invitation is recorded.'; return; }
    status.textContent = `${recs.length} record${recs.length > 1 ? 's' : ''} read live from Arkiv.`;
    for (const r of recs) {
      const v = await verify(r, trusted).catch((e) => ({ ok: false, why: e.message }));
      const li = document.createElement('li');
      li.className = v.ok ? 'ok' : (rehearsal ? 'reh' : 'bad');
      li.innerHTML = `<b>${ICON[r.kind] ?? '•'} ${esc(r.kind)}</b> · <code>${esc(r.label)}.osoartist.eth</code> · block ${r.block}<br>
        <span>${v.ok ? '✓ signature verified here: ' + esc(v.who) : (rehearsal ? '◌ ' : '✕ ') + esc(v.why ?? '') + (v.who ? ' (' + esc(v.who) + ')' : '')}</span><br>
        <small>entity <a href="${EXPLORER}/entity/${esc(r.key)}" target="_blank" rel="noopener">${esc(r.key.slice(0, 18))}…</a> · invite ${esc(r.id)}${r.readonly ? ' · read-only' : ''}</small>`;
      list.appendChild(li);
    }
  } catch (e) { status.textContent = `Arkiv query failed: ${e.message}. Nothing is shown rather than a stale copy.`; }
}
const doc = await fetch('/fork/stewards.json', { cache: 'no-cache' }).then((r) => r.json());
const trusted = await trustedStewards(doc, recover);
render('oso-circle-trust', $('live'), $('live-status'), trusted, false);
render('oso-circle-trust-rehearsal', $('reh'), $('reh-status'), trusted, true);
