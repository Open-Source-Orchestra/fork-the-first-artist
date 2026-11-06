import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { InputError, CHAIN_ID, SCHEMA_NAME } from './config.mjs';

function aad({ owner, namespace, kind, id }) {
  return Buffer.from(JSON.stringify([SCHEMA_NAME, CHAIN_ID, owner.toLowerCase(), namespace, kind, id]));
}
export function seal(value, key, context) {
  const plaintext = Buffer.from(JSON.stringify(value));
  if (plaintext.length > 16384) throw new InputError('Private record exceeds the 16 KiB application limit.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(context));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return new Uint8Array(Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]));
}
export function unseal(payload, key, context) {
  try {
    const bytes = typeof payload === 'string' && /^0x(?:[0-9a-f]{2})+$/i.test(payload)
      ? Buffer.from(payload.slice(2), 'hex') : Buffer.from(payload);
    if (bytes[0] !== 1 || bytes.length < 30 || bytes.length > 16413) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(1, 13));
    decipher.setAAD(aad(context));
    decipher.setAuthTag(bytes.subarray(13, 29));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]).toString('utf8'));
  } catch {
    throw new InputError('Private record authentication failed; check the encryption key and record context.');
  }
}
