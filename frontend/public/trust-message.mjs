// Open Source Orchestra — the circle's chain of trust (EIP-191 personal_sign messages, no gas).
// Imported by the browser pages (/admin, /consent) AND by ens/ scripts, so both build the exact same text.
//
//   root steward (owner of osoartist.eth — today: Shaka)
//     └─ steward grant  (root signs: "I trust this person to invite and approve")      → more stewards over time
//         └─ invitation  (a steward signs: "I invite <artist> to claim <label>.osoartist.eth")
//             └─ consent  (the artist signs with THEIR OWN wallet, quoting the invitation id)
//                 └─ approval (a steward signs: "issue <label> to <artist wallet>", quoting the consent hash)
//                     └─ ENS issuance by the ops key (ens/scripts/onboard.mjs) — refuses anything missing a link.

export const PARENT_NAME = 'osoartist.eth';
export const TRUST_CHAIN_ID = 1;
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SLUG_RE = /^[a-z0-9-]{1,60}$/;
const ETH_RE = /^0x[0-9a-fA-F]{40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH_RE = /^0x[0-9a-f]{64}$/;
const iso = (t) => typeof t === 'string' && !Number.isNaN(Date.parse(t)) && new Date(t).toISOString() === t;
const need = (ok, msg) => { if (!ok) throw new Error(msg); };

export function buildGrantMessage({ steward, name, grantedAt, root }) {
  need(ETH_RE.test(steward ?? ''), 'steward must be an Ethereum address');
  need(ETH_RE.test(root ?? ''), 'root must be an Ethereum address');
  need(typeof name === 'string' && name.trim().length > 0 && name.length <= 80 && !/\n/.test(name), 'steward name: 1-80 characters, one line');
  need(iso(grantedAt), 'grantedAt must be an ISO-8601 UTC string');
  return [
    'Open Source Orchestra — steward grant',
    'I trust this person to invite and approve artists of the circle.',
    `steward: ${steward.toLowerCase()}`,
    `name: ${name.trim()}`,
    `granted: ${grantedAt}`,
    `by: ${root.toLowerCase()}`,
    `chainId: ${TRUST_CHAIN_ID}`,
  ].join('\n');
}

export function buildInviteMessage({ artist, label, inviteId, bindTo = null, issuedAt, expiresAt, steward }) {
  need(SLUG_RE.test(artist ?? ''), 'artist must be a garden slug');
  need(LABEL_RE.test(label ?? ''), 'label must be lowercase a-z, 0-9 and inner hyphens (1-63 chars)');
  need(UUID_RE.test(inviteId ?? ''), 'inviteId must be a v4 UUID');
  need(bindTo === null || ETH_RE.test(bindTo), 'bindTo must be an Ethereum address or null');
  need(iso(issuedAt) && iso(expiresAt), 'issuedAt/expiresAt must be ISO-8601 UTC strings');
  need(Date.parse(expiresAt) > Date.parse(issuedAt), 'expiresAt must be after issuedAt');
  need(Date.parse(expiresAt) - Date.parse(issuedAt) <= 30 * 86_400_000, 'an invitation lasts at most 30 days');
  need(ETH_RE.test(steward ?? ''), 'steward must be an Ethereum address');
  return [
    'Open Source Orchestra — steward invitation',
    'I am a steward of the circle and I invite this artist to claim their name.',
    `artist: ${artist}`,
    `name: ${label}.${PARENT_NAME}`,
    `invite: ${inviteId}`,
    `for wallet: ${bindTo ? bindTo.toLowerCase() : 'the artist’s own wallet (any)'}`,
    `issued: ${issuedAt}`,
    `expires: ${expiresAt}`,
    `steward: ${steward.toLowerCase()}`,
    `chainId: ${TRUST_CHAIN_ID}`,
  ].join('\n');
}

export function buildApprovalMessage({ label, ethAddress, hederaPayout, consentHash, inviteId, approvedAt, steward }) {
  need(LABEL_RE.test(label ?? ''), 'label invalid');
  need(ETH_RE.test(ethAddress ?? ''), 'artist ethAddress invalid');
  need(hederaPayout === 'alias' || /^\d{1,10}\.\d{1,20}\.\d{1,20}$/.test(String(hederaPayout ?? '')), 'hedera payout invalid');
  need(HASH_RE.test(consentHash ?? ''), 'consentHash must be a 32-byte lowercase hex hash');
  need(UUID_RE.test(inviteId ?? ''), 'inviteId invalid');
  need(iso(approvedAt), 'approvedAt must be an ISO-8601 UTC string');
  need(ETH_RE.test(steward ?? ''), 'steward must be an Ethereum address');
  return [
    'Open Source Orchestra — steward approval',
    'I approve this artist’s claim. Issue the name to their own wallet.',
    `name: ${label}.${PARENT_NAME}`,
    `artist wallet: ${ethAddress.toLowerCase()}`,
    `hedera payout: ${hederaPayout}`,
    `consent: ${consentHash}`,
    `invite: ${inviteId}`,
    `approved: ${approvedAt}`,
    `steward: ${steward.toLowerCase()}`,
    `chainId: ${TRUST_CHAIN_ID}`,
  ].join('\n');
}

/* invitation links: /consent?invite=<base64url(JSON)> — public by design (no secret inside); a leaked link
   still needs the artist's own consent signature AND a steward's approval before anything is issued. */
export function encodeInvite(invite) {
  const bytes = new TextEncoder().encode(JSON.stringify(invite));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeInvite(text) {
  need(typeof text === 'string' && text.length < 4000 && /^[A-Za-z0-9_-]+$/.test(text), 'invitation link is malformed');
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  const inv = JSON.parse(json);
  need(inv && inv.kind === 'oso.invite' && inv.v === 1, 'not an OSO invitation');
  need(/^0x[0-9a-fA-F]{130}$/.test(inv.signature ?? ''), 'invitation is not signed');
  buildInviteMessage(inv);
  return inv;
}

/**
 * Who may sign invitations/approvals: the root, plus every steward whose grant the root signed.
 * `recover(message, signature)` returns the signer address (viem's recoverMessageAddress in both places).
 */
export async function trustedStewards(stewardsDoc, recover) {
  const root = stewardsDoc?.root?.address;
  need(ETH_RE.test(root ?? ''), 'stewards.json has no root address');
  const out = new Map([[root.toLowerCase(), { address: root, name: stewardsDoc.root.name ?? 'root', role: 'root' }]]);
  for (const s of stewardsDoc.stewards ?? []) {
    try {
      const message = buildGrantMessage({ steward: s.address, name: s.name, grantedAt: s.grantedAt, root });
      const signer = await recover(message, s.signature);
      if (signer.toLowerCase() === root.toLowerCase()) out.set(s.address.toLowerCase(), { address: s.address, name: s.name, role: 'steward', grantedAt: s.grantedAt });
    } catch { /* an invalid grant simply grants nothing */ }
  }
  return out;
}

/** Verify a decoded invitation: signed by a trusted steward, not expired. Returns { steward, message }. */
export async function verifyInvite(inv, trusted, recover, now = Date.now()) {
  const message = buildInviteMessage(inv);
  const signer = (await recover(message, inv.signature)).toLowerCase();
  need(signer === String(inv.steward).toLowerCase(), 'invitation signature does not match its steward');
  const steward = trusted.get(signer);
  need(Boolean(steward), 'invitation was not signed by a trusted steward of the circle');
  need(now <= Date.parse(inv.expiresAt), 'this invitation has expired — ask a steward for a new one');
  need(now >= Date.parse(inv.issuedAt) - 5 * 60_000, 'invitation is dated in the future');
  return { steward, message };
}
