import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { hashMessage } from 'viem';
import { buildApprovalMessage, buildGrantMessage, buildInviteMessage, encodeInvite } from '../../frontend/public/trust-message.mjs';
import { buildConsentMessage } from '../src/consent.mjs';
import { loadTrusted, verifyTrustChain } from '../src/trust.mjs';

const acct = () => privateKeyToAccount(generatePrivateKey());
const root = acct(), helper = acct(), stranger = acct(), artist = acct();
const now = Date.now();
const isoAt = (ms) => new Date(ms).toISOString();

async function grant(by, steward, name) {
  const g = { address: steward.address, name, grantedAt: isoAt(now - 60_000) };
  g.signature = await by.signMessage({ message: buildGrantMessage({ steward: g.address, name, grantedAt: g.grantedAt, root: root.address }) });
  return g;
}
async function docWith(...stewards) {
  return { v: 1, root: { address: root.address, name: 'Root' }, stewards };
}
async function chain({ inviter = root, approver = root, bindTo = null, label = 'mira', expiresIn = 86_400_000, inviteLabel = label, signer = artist, quoteInvite = true, encode = true } = {}) {
  const inv = { v: 1, kind: 'oso.invite', artist: 'mira-modal', label: inviteLabel, inviteId: randomUUID(), bindTo, issuedAt: isoAt(now - 120_000), expiresAt: isoAt(now - 120_000 + expiresIn), steward: inviter.address };
  inv.signature = await inviter.signMessage({ message: buildInviteMessage(inv) });
  const c = { label, ethAddress: artist.address, hederaPayout: 'alias', timestamp: isoAt(now - 60_000), chainId: 1, ...(quoteInvite ? { inviteId: inv.inviteId } : {}) };
  const message = buildConsentMessage(c);
  c.message = message;
  c.signature = await signer.signMessage({ message });
  c.invite = encode ? encodeInvite(inv) : inv;
  const a = { approvedAt: isoAt(now), steward: approver.address };
  a.signature = await approver.signMessage({ message: buildApprovalMessage({ ...a, label, ethAddress: artist.address, hederaPayout: 'alias', consentHash: hashMessage(message), inviteId: inv.inviteId }) });
  c.approval = a;
  return c;
}

test('full chain: root invites, artist consents with own key, root approves → accepted', async () => {
  const trusted = await loadTrusted(await docWith());
  const r = await verifyTrustChain(await chain(), trusted);
  assert.equal(r.inviter.role, 'root');
  assert.equal(r.approver.role, 'root');
  assert.equal(r.slug, 'mira-modal');
});

test('the circle grows: a root-granted steward may invite and approve; a self-granted one may not', async () => {
  const trusted = await loadTrusted(await docWith(await grant(root, helper, 'Helper'), await grant(stranger, stranger, 'Self-made')));
  assert.equal(trusted.size, 2, 'root + helper only');
  const r = await verifyTrustChain(await chain({ inviter: helper, approver: helper }), trusted);
  assert.equal(r.inviter.name, 'Helper');
  await assert.rejects(verifyTrustChain(await chain({ inviter: stranger }), trusted), /not signed by a trusted steward/);
});

test('refusals: no invitation, stranger approval, expired, label swap, unquoted invite, wrong bound wallet, tampered approval', async () => {
  const trusted = await loadTrusted(await docWith());
  const noInvite = await chain(); delete noInvite.invite;
  await assert.rejects(verifyTrustChain(noInvite, trusted), /invitation only/);
  await assert.rejects(verifyTrustChain(await chain({ approver: stranger }), trusted), /approval was not signed by a trusted steward/);
  await assert.rejects(verifyTrustChain(await chain({ expiresIn: 30_000 }), trusted), /expired/);
  await assert.rejects(verifyTrustChain(await chain({ inviteLabel: 'shaka', label: 'mira' }), trusted), /invitation is for shaka/);
  await assert.rejects(verifyTrustChain(await chain({ quoteInvite: false }), trusted), /does not quote this invitation/);
  await assert.rejects(verifyTrustChain(await chain({ bindTo: stranger.address }), trusted), /bound to/);
  const tampered = await chain();
  tampered.hederaPayout = '0.0.666';
  await assert.rejects(verifyTrustChain(tampered, trusted), /approval signature does not match/);
});

test('decoded (object) invitations work too, and the real stewards.json roots at the osoartist.eth owner', async () => {
  const trusted = await loadTrusted(await docWith());
  await verifyTrustChain(await chain({ encode: false }), trusted);
  const real = await loadTrusted();
  assert.ok(real.has('0x25965899f4600b3aa5362ee4f34be95e5e62c934'));
});
