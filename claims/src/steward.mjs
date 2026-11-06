import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { InputError } from './config.mjs';

function text(value, maximum, field) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new InputError(`${field} must be nonempty single-line text within ${maximum} characters.`);
  }
  return value.trim();
}
export function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new InputError('Provide a valid record UUID.');
  return value.toLowerCase();
}
function validate(record, id, kind) {
  const data = record?.data;
  if (!data) throw new InputError('Record not found or expired; access must remain disabled.');
  if (data.version !== 1 || data.id !== id || data.kind !== kind) throw new InputError('Invalid private record schema.');
  if (kind === 'invite' && (!['issued', 'revoked', 'claimed'].includes(data.state)
    || !/^[0-9a-f]{64}$/.test(data.tokenHash) || !Number.isSafeInteger(data.expiresAt))) throw new InputError('Invalid invitation state.');
  if (kind === 'claim' && (!['pending', 'active', 'failed'].includes(data.activationState)
    || !/^0x[0-9a-f]{40}$/.test(data.ensOwner) || data.hederaNetwork !== 'testnet'
    || !/^(0|[1-9][0-9]{0,18})\.(0|[1-9][0-9]{0,18})\.([1-9][0-9]{0,18})$/.test(data.hederaAccount)
    || !Number.isSafeInteger(data.verifiedAt) || !(data.frozen === null || (Number.isSafeInteger(data.frozen?.at)
      && typeof data.frozen.actor === 'string' && typeof data.frozen.reason === 'string')))) throw new InputError('Invalid claim state.');
  return data;
}

export async function issueInvite(store, { artist, actor, ttlHours = 24 }) {
  artist = text(artist, 80, 'Artist'); actor = text(actor, 120, 'Actor');
  if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 72) throw new InputError('Invite lifetime must be an integer from 1 to 72 hours.');
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const data = { version: 1, kind: 'invite', id, state: 'issued', artist, issuedBy: actor,
    createdAt: now, expiresAt: now + ttlHours * 3600000, tokenHash: createHash('sha256').update(token).digest('hex') };
  const receipt = await store.write('invite', id, data, { action: 'invite_issued', actor, at: now });
  return { inviteId: id, token, expiresAt: new Date(data.expiresAt).toISOString(), ...receipt };
}

export async function revokeInvite(store, { inviteId, actor, reason }) {
  inviteId = uuid(inviteId); actor = text(actor, 120, 'Actor'); reason = text(reason, 500, 'Reason');
  const previous = await store.read('invite', inviteId);
  const data = validate(previous, inviteId, 'invite');
  if (data.state === 'claimed') throw new InputError('Invitation already claimed; freeze its OSO services instead.');
  if (data.state === 'revoked') return { inviteId, changed: false };
  const now = Date.now();
  const receipt = await store.write('invite', inviteId, { ...data, state: 'revoked', revokedAt: now },
    { action: 'invite_revoked', actor, reason, at: now }, previous);
  return { inviteId, changed: true, ...receipt };
}

export async function freezeClaim(store, { claimId, actor, reason }) {
  claimId = uuid(claimId); actor = text(actor, 120, 'Actor'); reason = text(reason, 500, 'Reason');
  const previous = await store.read('claim', claimId);
  const data = validate(previous, claimId, 'claim');
  if (data.frozen) return { claimId, changed: false };
  const now = Date.now();
  const receipt = await store.write('claim', claimId, { ...data, frozen: { at: now, actor, reason } },
    { action: 'claim_frozen', actor, reason, at: now }, previous);
  return { claimId, changed: true, ...receipt };
}

export async function claimStatus(store, claimId) {
  claimId = uuid(claimId);
  const record = await store.read('claim', claimId);
  const data = validate(record, claimId, 'claim');
  return { id: claimId, activationState: data.activationState, frozenAt: data.frozen?.at ?? null,
    entityKey: record.entityKey, expiresAtBlock: String(record.expiresAtBlock) };
}
export async function inviteStatus(store, inviteId) {
  inviteId = uuid(inviteId);
  const record = await store.read('invite', inviteId);
  const data = validate(record, inviteId, 'invite');
  return { id: inviteId, state: data.state === 'issued' && data.expiresAt <= Date.now() ? 'expired' : data.state,
    expiresAt: new Date(data.expiresAt).toISOString(), entityKey: record.entityKey, expiresAtBlock: String(record.expiresAtBlock) };
}
