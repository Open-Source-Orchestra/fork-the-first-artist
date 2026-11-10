// Verify an artist's free, off-chain EIP-191 consent signature before anything is issued in their name.
import { getAddress, hashMessage, recoverMessageAddress } from 'viem';
import { buildConsentMessage } from '../../frontend/public/consent-message.mjs';

export { buildConsentMessage };

/**
 * consent = { label, ethAddress, hederaPayout: '0.0.N' | 'alias', timestamp, chainId, message?, signature }
 * Returns { ok, message, messageHash, signer } or throws. `message` (if given) must equal the rebuilt text.
 * maxAgeDays guards against replaying a stale consent.
 */
export async function verifyConsent(consent, { maxAgeDays = 30, now = Date.now() } = {}) {
  const message = buildConsentMessage(consent);
  if (consent.message != null && consent.message !== message) throw new Error(`consent for ${consent.label}: signed text differs from the canonical message`);
  if (!/^0x[0-9a-fA-F]{130}$/.test(String(consent.signature ?? ''))) throw new Error(`consent for ${consent.label}: missing/invalid 65-byte signature`);
  const signer = await recoverMessageAddress({ message, signature: consent.signature });
  if (getAddress(signer) !== getAddress(consent.ethAddress)) {
    throw new Error(`consent for ${consent.label}: signature recovers to ${signer}, not ${consent.ethAddress}`);
  }
  const age = now - Date.parse(consent.timestamp);
  if (age < -5 * 60_000) throw new Error(`consent for ${consent.label}: timestamp is in the future`);
  if (age > maxAgeDays * 86_400_000) throw new Error(`consent for ${consent.label}: older than ${maxAgeDays} days`);
  return { ok: true, message, messageHash: hashMessage(message), signer: getAddress(signer) };
}
