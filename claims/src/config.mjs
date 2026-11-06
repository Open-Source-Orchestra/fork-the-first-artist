export class InputError extends Error {}
export class StateConflictError extends InputError {}
export const CHAIN_ID = 7794095;
export const SCHEMA_NAME = 'oso.claims.v1';

export function configuration(env = process.env) {
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(env.ARKIV_NAMESPACE ?? '')) throw new InputError('Set ARKIV_NAMESPACE to a unique 3–64 character lowercase identifier.');
  if (!env.ARKIV_ACCESS_KEY?.trim()) throw new InputError('Set ARKIV_ACCESS_KEY locally.');
  if (!/^0x[0-9a-f]{64}$/i.test(env.ARKIV_PRIVATE_KEY ?? '')) throw new InputError('Set a dedicated Rabdi test wallet in ARKIV_PRIVATE_KEY locally.');
  if (!/^[0-9a-f]{64}$/i.test(env.ARKIV_ENCRYPTION_KEY ?? '')) throw new InputError('Set ARKIV_ENCRYPTION_KEY to a separately generated 32-byte hex secret.');
  if (env.ARKIV_PRIVATE_KEY.slice(2).toLowerCase() === env.ARKIV_ENCRYPTION_KEY.toLowerCase()) throw new InputError('Use separate signing and encryption keys.');
  const retentionDays = Number(env.ARKIV_RETENTION_DAYS ?? 30);
  if (!Number.isInteger(retentionDays) || retentionDays < 4 || retentionDays > 180) throw new InputError('ARKIV_RETENTION_DAYS must be an integer from 4 to 180.');
  if (env.DEBUG) throw new InputError('Unset DEBUG before running the claims CLI.');
  return { namespace: env.ARKIV_NAMESPACE, accessKey: env.ARKIV_ACCESS_KEY.trim(), privateKey: env.ARKIV_PRIVATE_KEY,
    encryptionKey: Buffer.from(env.ARKIV_ENCRYPTION_KEY, 'hex'), retentionDays };
}
