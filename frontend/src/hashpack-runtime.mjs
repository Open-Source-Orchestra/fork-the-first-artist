import SignClient from '@walletconnect/sign-client';
import QRCode from 'qrcode';

// WalletConnect session material is transient in this preview, not IndexedDB/localStorage.
function memoryStorage() {
  const entries = new Map();
  return {
    async getKeys() { return [...entries.keys()]; },
    async getEntries() { return structuredClone([...entries]); },
    async getItem(key) { return structuredClone(entries.get(key)); },
    async setItem(key, value) { entries.set(key, structuredClone(value)); },
    async removeItem(key) { entries.delete(key); },
  };
}

export function createHashPackClient(projectId, origin) {
  if (!/^[0-9a-f]{32}$/i.test(projectId)) throw new Error('Reown project ID is not configured');
  const url = new URL(origin);
  const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.origin !== origin || (url.protocol !== 'https:' && !loopback)) {
    throw new Error('Use HTTPS or loopback for wallet pairing');
  }
  return SignClient.init({
    projectId,
    relayUrl: 'wss://relay.walletconnect.com',
    telemetryEnabled: false,
    logger: 'silent',
    storage: memoryStorage(),
    customStoragePrefix: 'oso-artist-claim',
    metadata: { name: 'Fork the First Artist', description: 'Artist identity and Hedera payout account claim', url: origin, icons: [] },
  });
}

export function pairingQr(uri) {
  return QRCode.toDataURL(uri, { width: 280, margin: 2, errorCorrectionLevel: 'M' });
}
