// The circle's chain of trust, verified server-side before the ops key issues any name:
// root (osoartist.eth owner) → steward grant → invitation → artist consent → steward approval.
// Same message builders as the browser (frontend/public/trust-message.mjs); recovery via viem.
import { readFileSync } from 'node:fs';
import { getAddress, hashMessage, recoverMessageAddress } from 'viem';
import { buildApprovalMessage, buildInviteMessage, decodeInvite, trustedStewards, verifyInvite } from '../../frontend/public/trust-message.mjs';
import { buildConsentMessage } from '../../frontend/public/consent-message.mjs';

export const STEWARDS_FILE = new URL('../../frontend/public/fork/stewards.json', import.meta.url);
const recover = (message, signature) => recoverMessageAddress({ message, signature });

export async function loadTrusted(doc = JSON.parse(readFileSync(STEWARDS_FILE, 'utf8'))) {
  return trustedStewards(doc, recover);
}

/** Throws unless `c` carries a valid invitation AND approval from trusted stewards, bound to this exact consent. */
export async function verifyTrustChain(c, trusted) {
  const who = `consent for ${c.label}`;
  if (!c.invite) throw new Error(`${who}: no steward invitation — artists are onboarded by invitation only`);
  const inv = typeof c.invite === 'string' ? decodeInvite(c.invite) : (buildInviteMessage(c.invite), c.invite);
  const { steward: inviter } = await verifyInvite(inv, trusted, recover, Date.parse(c.timestamp));
  if (inv.label !== c.label) throw new Error(`${who}: invitation is for ${inv.label}, not ${c.label}`);
  if (c.inviteId !== inv.inviteId) throw new Error(`${who}: the artist's signature does not quote this invitation`);
  if (inv.bindTo && getAddress(inv.bindTo) !== getAddress(c.ethAddress)) throw new Error(`${who}: invitation is bound to ${inv.bindTo}`);
  const consentHash = hashMessage(buildConsentMessage(c));
  const a = c.approval;
  if (!a?.signature) throw new Error(`${who}: no steward approval`);
  const message = buildApprovalMessage({ ...a, label: c.label, ethAddress: c.ethAddress, hederaPayout: c.hederaPayout, consentHash, inviteId: inv.inviteId });
  const signer = (await recover(message, a.signature)).toLowerCase();
  if (signer !== String(a.steward).toLowerCase()) throw new Error(`${who}: approval signature does not match its steward`);
  const approver = trusted.get(signer);
  if (!approver) throw new Error(`${who}: approval was not signed by a trusted steward`);
  return { inviter, approver, inviteId: inv.inviteId, slug: inv.artist, consentHash };
}
