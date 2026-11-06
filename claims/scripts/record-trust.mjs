#!/usr/bin/env node
// Record the circle's chain of trust on Arkiv (Shaka's "option 1", 7 Nov 2026):
// the ʻohana's server writer STORES what stewards and artists signed; the signatures stay the authority.
//
//   node --env-file=claims/.env claims/scripts/record-trust.mjs <approved.json | invite-link | grant.json> [--dry-run]
//
// Every input is verified BEFORE any write (ens/src/trust.mjs: stewards.json root + root-signed grants).
// Records are PUBLIC, unencrypted signed attestations (schema oso.trust.v1) so anyone can re-verify them
// from Arkiv alone — /arkiv reads them live and re-checks every signature in the browser.
// Already-recorded items (same kind + id) are skipped, so re-running is safe.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createPublicClient, createWalletClient, ExpirationTime } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { defineSchema, str, bytes } from '@arkiv-network/sdk/schema';
import { and, eq } from '@arkiv-network/sdk/query';
import { http, nonceManager } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadTrusted, verifyTrustChain } from '../../ens/src/trust.mjs';
import { buildGrantMessage, buildInviteMessage, decodeInvite, verifyInvite } from '../../frontend/public/trust-message.mjs';
import { buildConsentMessage } from '../../frontend/public/consent-message.mjs';
import { recoverMessageAddress } from 'viem';

export const TRUST_SCHEMA = 'oso.trust.v1';
export const TRUST_NAMESPACE = process.env.ARKIV_TRUST_NAMESPACE ?? 'oso-circle-trust';
const Trust = defineSchema(TRUST_SCHEMA, {
  namespace: str().indexed(), kind: str().indexed(), id: str().indexed(), label: str().indexed(), steward: str().indexed(), payload: bytes(),
});
const LOG = process.env.OSO_TRUST_LOG ? new URL(`file://${process.env.OSO_TRUST_LOG}`) : new URL('../../frontend/public/fork/trust-log.json', import.meta.url);
const recover = (message, signature) => recoverMessageAddress({ message, signature });
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const input = args.find((a) => !a.startsWith('--'));
if (!input) { console.error('usage: record-trust.mjs <approved.json | invite-link | grant.json> [--dry-run]'); process.exit(1); }

// Rehearsal only: a throwaway stewards file may be used, and then only in a *-rehearsal namespace.
const STEWARDS = process.env.OSO_STEWARDS_FILE ?? new URL('../../frontend/public/fork/stewards.json', import.meta.url);
if (process.env.OSO_STEWARDS_FILE && !/rehearsal/.test(TRUST_NAMESPACE)) throw new Error('OSO_STEWARDS_FILE requires ARKIV_TRUST_NAMESPACE containing "rehearsal"');
const stewardsDoc = JSON.parse(readFileSync(STEWARDS, 'utf8'));
const trusted = await loadTrusted(stewardsDoc);
const raw = existsSync(input) ? readFileSync(input, 'utf8').trim() : input.trim();
const records = [];

if (/^https?:\/\/|^[A-Za-z0-9_-]{40,}$/.test(raw)) {
  const inv = decodeInvite(raw.includes('invite=') ? new URL(raw).searchParams.get('invite') : raw);
  const { steward } = await verifyInvite(inv, trusted, recover);
  records.push({ kind: 'invite', id: inv.inviteId, label: inv.label, steward: steward.address, payload: { ...inv, message: buildInviteMessage(inv) } });
} else {
  const j = JSON.parse(raw);
  if (j.approval) {
    const t = await verifyTrustChain(j, trusted);
    const inv = typeof j.invite === 'string' ? decodeInvite(j.invite) : j.invite;
    const consentMessage = buildConsentMessage(j);
    records.push({ kind: 'invite', id: inv.inviteId, label: inv.label, steward: t.inviter.address, payload: { ...inv, message: buildInviteMessage(inv) } });
    records.push({ kind: 'consent', id: inv.inviteId, label: j.label, steward: t.inviter.address,
      payload: { label: j.label, ethAddress: j.ethAddress, hederaPayout: j.hederaPayout, timestamp: j.timestamp, chainId: j.chainId, inviteId: j.inviteId, message: consentMessage, signature: j.signature, consentHash: t.consentHash } });
    records.push({ kind: 'approval', id: inv.inviteId, label: j.label, steward: t.approver.address, payload: { ...j.approval } });
  } else if (j.address && j.grantedAt && j.signature) {
    const doc = stewardsDoc;
    const message = buildGrantMessage({ steward: j.address, name: j.name, grantedAt: j.grantedAt, root: doc.root.address });
    if ((await recover(message, j.signature)).toLowerCase() !== doc.root.address.toLowerCase()) throw new Error('grant is not signed by the root steward');
    records.push({ kind: 'grant', id: j.address.toLowerCase(), label: '-', steward: doc.root.address, payload: { ...j, root: doc.root.address, message } });
  } else throw new Error('input is not an approved bundle, an invitation link, or a steward grant');
}
console.log(`✔ verified ${records.map((r) => `${r.kind}:${r.label}`).join(', ')} against stewards.json`);

const env = process.env;
if (!/^0x[0-9a-f]{64}$/i.test(env.ARKIV_PRIVATE_KEY ?? '') || !env.ARKIV_ACCESS_KEY) throw new Error('ARKIV_PRIVATE_KEY / ARKIV_ACCESS_KEY missing (use --env-file=claims/.env)');
const chain = rabdi({ accessKey: env.ARKIV_ACCESS_KEY.trim() });
const account = privateKeyToAccount(env.ARKIV_PRIVATE_KEY, { nonceManager });
const pub = createPublicClient({ chain, transport: http(undefined, { timeout: 20000 }), cacheTime: 0 });
const wallet = createWalletClient({ chain, account, transport: http(undefined, { timeout: 20000, retryCount: 0 }), cacheTime: 0 });
if (await pub.getChainId() !== 7794095) throw new Error('not the Rabdi testnet');

const fresh = [];
for (const r of records) {
  const page = await pub.select().from(Trust, { onMismatch: 'skip' }).ownedBy(account.address).createdBy(account.address)
    .where(and(eq('namespace', TRUST_NAMESPACE), eq('kind', r.kind), eq('id', r.id))).withCount().limit(1).fetch();
  if (page.count > 0n) console.log(`· ${r.kind} ${r.id} already on Arkiv — skipped`);
  else fresh.push(r);
}
if (!fresh.length) { console.log('nothing new to record'); process.exit(0); }
if (DRY) { console.log(`DRY RUN — would record ${fresh.length} entit${fresh.length > 1 ? 'ies' : 'y'} as ${account.address} in ${TRUST_NAMESPACE}`); process.exit(0); }

const result = await wallet.executeBatch({
  creates: fresh.map((r) => ({
    schema: Trust,
    values: { namespace: TRUST_NAMESPACE, kind: r.kind, id: r.id, label: r.label, steward: r.steward.toLowerCase(), payload: new TextEncoder().encode(JSON.stringify(r.payload)) },
    expiration: ExpirationTime.fromDays(180), flags: { readonly: true },
  })),
});
const receipt = await pub.waitForTransactionReceipt({ hash: result.txHash }).catch(() => null);
console.log(`✔ recorded ${fresh.length} on Arkiv · tx ${result.txHash}${receipt ? ` · block ${receipt.blockNumber} · status ${receipt.status}` : ''}`);
const log = existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : { schema: TRUST_SCHEMA, namespace: TRUST_NAMESPACE, writer: account.address, rpc: 'https://rpc.rabdi.db-chain.testnet.arkiv.network', records: [] };
fresh.forEach((r, i) => log.records.push({ kind: r.kind, id: r.id, label: r.label, steward: r.steward, entityKey: result.createdEntities[i], txHash: result.txHash, ...(receipt ? { block: Number(receipt.blockNumber) } : {}), recordedAt: new Date().toISOString() }));
writeFileSync(LOG, `${JSON.stringify(log, null, 2)}\n`);
console.log(`garden feed updated: frontend/public/fork/trust-log.json (${log.records.length} records)`);
