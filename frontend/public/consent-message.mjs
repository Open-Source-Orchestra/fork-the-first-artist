// Canonical OSO artist consent message (EIP-191 personal_sign). No dependencies: imported by
// the static consent page AND by ens/scripts/onboard.mjs, so both always build the exact same text.
export const CONSENT_SENTENCE = 'I consent to OSO listing me and routing fan payments to this address';
export const CONSENT_CHAIN_ID = 1;
export const PARENT_NAME = 'osoartist.eth';

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HEDERA_RE = /^\d{1,10}\.\d{1,20}\.\d{1,20}$/;
const ETH_RE = /^0x[0-9a-fA-F]{40}$/;

export function validateConsentFields({ label, ethAddress, hederaPayout, timestamp, chainId = CONSENT_CHAIN_ID, inviteId }) {
  if (inviteId != null && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(inviteId))) throw new Error('inviteId must be the v4 UUID of a steward invitation');
  if (!LABEL_RE.test(String(label ?? ''))) throw new Error('label must be lowercase a-z, 0-9 and inner hyphens (1-63 chars)');
  if (!ETH_RE.test(String(ethAddress ?? ''))) throw new Error('ethAddress must be a 0x-prefixed 20-byte address');
  if (hederaPayout !== 'alias' && !HEDERA_RE.test(String(hederaPayout ?? ''))) throw new Error("hedera payout must be a Hedera account id like 0.0.12345 or the word 'alias'");
  if (!timestamp || Number.isNaN(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) throw new Error('timestamp must be an ISO-8601 UTC string (Date#toISOString)');
  if (Number(chainId) !== CONSENT_CHAIN_ID) throw new Error(`chainId must be ${CONSENT_CHAIN_ID} (Ethereum mainnet, where ENS lives)`);
}

/** Exact text the artist signs. ethAddress is lower-cased so checksum casing can never change the message. */
export function buildConsentMessage(fields) {
  validateConsentFields(fields);
  const { label, ethAddress, hederaPayout, timestamp, chainId = CONSENT_CHAIN_ID, inviteId } = fields;
  return [
    'Open Source Orchestra — artist consent',
    `name: ${label}.${PARENT_NAME}`,
    `label: ${label}`,
    `ethAddress: ${ethAddress.toLowerCase()}`,
    `hedera payout: ${hederaPayout}`,
    // Present when a steward invited the artist (trust-message.mjs); older consents without it stay valid text.
    ...(inviteId != null ? [`invite: ${inviteId}`] : []),
    CONSENT_SENTENCE,
    `timestamp: ${timestamp}`,
    `chainId: ${Number(chainId)}`,
  ].join('\n');
}
