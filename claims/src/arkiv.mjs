import { randomUUID } from 'node:crypto';
import { createPublicClient, createWalletClient, ExpirationTime } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { defineSchema, str, bytes } from '@arkiv-network/sdk/schema';
import { and, eq } from '@arkiv-network/sdk/query';
import { http, nonceManager, BaseError, ContractFunctionRevertedError } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN_ID, SCHEMA_NAME, InputError, StateConflictError, configuration } from './config.mjs';
import { seal, unseal } from './seal.mjs';

export const Records = defineSchema(SCHEMA_NAME, {
  namespace: str().indexed(), kind: str().indexed(), id: str().indexed(), sealed: bytes(),
});
const HEX_KEY = /^0x[0-9a-f]{64}$/i;

export function connect(env = process.env) {
  const config = configuration(env);
  const chain = rabdi({ accessKey: config.accessKey });
  let account;
  try { account = privateKeyToAccount(config.privateKey, { nonceManager }); }
  catch { throw new InputError('ARKIV_PRIVATE_KEY is not a valid signing key.'); }
  const transport = () => http(undefined, { timeout: 15000, retryCount: 0 });
  const publicClient = createPublicClient({ chain, transport: transport(), cacheTime: 0 });
  const walletClient = createWalletClient({ chain, account, transport: transport(), cacheTime: 0 });
  return new ArkivStore({ publicClient, walletClient, owner: account.address, ...config });
}

export class ArkivStore {
  constructor({ publicClient, walletClient, owner, namespace, encryptionKey, retentionDays = 30 }) {
    Object.assign(this, { publicClient, walletClient, owner, namespace, encryptionKey, retentionDays });
  }
  async check() {
    if (await this.publicClient.getChainId() !== CHAIN_ID) throw new InputError('RPC is not the approved Rabdi testnet.');
    const timing = await this.publicClient.getBlockTiming();
    if (!Number.isSafeInteger(timing.currentBlockTime) || Math.abs(Date.now() / 1000 - timing.currentBlockTime) > 120) {
      throw new InputError('Arkiv head is stale or the local clock is incorrect.');
    }
    return timing;
  }
  context(kind, id) { return { owner: this.owner, namespace: this.namespace, kind, id }; }
  query(kind, id) {
    return this.publicClient.select().from(Records, { onMismatch: 'throw' })
      .ownedBy(this.owner).createdBy(this.owner)
      .where(and(eq('namespace', this.namespace), eq('kind', kind), eq('id', id)))
      .withCount().limit(2);
  }
  async read(kind, id) {
    const head = await this.check();
    const page = await this.query(kind, id).fetch();
    if (page.blockNumber < head.currentBlock || page.skipped || page.count > 1n) {
      throw new InputError('Arkiv returned stale, ambiguous, or invalid claim state.');
    }
    if (page.count === 0n && page.entities.length === 0) return null;
    if (page.count !== 1n || page.entities.length !== 1) throw new InputError('Arkiv returned inconsistent claim state.');
    const row = page.entities[0];
    if (!HEX_KEY.test(row.$key) || row.$owner.toLowerCase() !== this.owner.toLowerCase()
      || row.$creator.toLowerCase() !== this.owner.toLowerCase() || !row.$creationFlags.readonly
      || row.$expiresAt <= page.blockNumber || row.namespace.value !== this.namespace
      || row.kind.value !== kind || row.id.value !== id) throw new InputError('Untrusted or expired Arkiv record.');
    return { entityKey: row.$key, expiresAtBlock: row.$expiresAt, data: unseal(row.sealed.value, this.encryptionKey, this.context(kind, id)) };
  }
  creation(kind, id, data) {
    return { schema: Records,
      values: { namespace: this.namespace, kind, id, sealed: seal(data, this.encryptionKey, this.context(kind, id)) },
      expiration: ExpirationTime.fromDays(this.retentionDays), flags: { readonly: true } };
  }
  async write(kind, id, data, event, previous = null) {
    await this.check();
    const auditId = randomUUID();
    const batch = {
      creates: [this.creation(kind, id, data), this.creation('audit', auditId, { ...event, recordKind: kind, recordId: id })],
      ...(previous ? { deletes: [{ entityKey: previous.entityKey }] } : {}),
    };
    try {
      const result = await this.walletClient.executeBatch(batch);
      if (!HEX_KEY.test(result.txHash) || result.createdEntities.length !== 2
        || result.createdEntities.some((key) => !HEX_KEY.test(key))) throw new Error();
      return { txHash: result.txHash, entityKey: result.createdEntities[0], auditEntityKey: result.createdEntities[1] };
    } catch (error) {
      // Distinguish a decoded missing-prior-entity revert from an RPC timeout.
      // The live test must not count an arbitrary network failure as CAS evidence.
      for (let cause = error, depth = 0; cause && depth < 8; cause = cause.cause, depth++) {
        if (!(cause instanceof BaseError) || !previous) continue;
        const reverted = cause.walk((entry) => entry instanceof ContractFunctionRevertedError);
        if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName === 'EntityNotFound'
          && reverted.data.args?.[0]?.toLowerCase() === previous.entityKey.toLowerCase()) {
          throw new StateConflictError('The prior Arkiv entity was consumed or removed. Read the record again before retrying.');
        }
      }
      const hash = HEX_KEY.test(error?.txHash ?? '') ? ` Transaction: ${error.txHash}.` : '';
      throw new InputError(`Arkiv write was not confirmed for ${kind} ${id}.${hash} Inspect chain state before retrying; a pending write may still commit.`);
    }
  }
}
