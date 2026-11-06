import type { ReplayNamespace } from './replay-guard.ts';

export interface Env {
  PAYMENT_REPLAY_GUARD?: ReplayNamespace;
  HEDERA_ARTIST_ACCOUNT_ID?: string;
  HEDERA_FAN_ACCOUNT_ID?: string;
  HEDERA_FAN_PRIVATE_KEY?: string;
  HEDERA_NETWORK?: string;
  HEDERA_ASSET?: string;
  HEDERA_ASSET_DECIMALS?: string;
  FACILITATOR_URL?: string;
  UPSTREAM_API_KEY?: string;
  UPSTREAM_BASE_URL?: string;
  UPSTREAM_MODEL?: string;
  UPSTREAM_TRUST_MODE?: string;
  DEMO_PRICE_ATOMIC?: string;
  DEMO_MAX_OUTPUT_TOKENS?: string;
  DEMO_IP_LIMIT_PER_MINUTE?: string;
  DEMO_GLOBAL_LIMIT_PER_MINUTE?: string;
  DEMO_MAX_INFLIGHT?: string;
}

export interface WorkerConfig {
  artistAccountId: string;
  fanAccountId: string;
  fanPrivateKey: string;
  network: 'hedera:testnet';
  assetId: string;
  assetDecimals: number;
  facilitatorUrl: string;
  upstreamApiKey: string;
  upstreamBaseUrl: string;
  upstreamModel: string;
  upstreamTrustMode: string;
  priceAtomic: bigint;
  maxOutputTokens: number;
  maxPaymentUsd: '$0.01';
  ipLimitPerMinute: number;
  globalLimitPerMinute: number;
  maxInflight: number;
}

type StringEnvKey = Exclude<keyof Env, 'PAYMENT_REPLAY_GUARD'>;
const value = (env: Env, key: StringEnvKey): string | undefined => {
  const trimmed = env[key]?.trim();
  return trimmed || undefined;
};

const integer = (
  raw: string | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number,
): number => {
  const parsed = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
};

const httpsUrl = (raw: string, name: string): string => {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an HTTPS base URL without credentials, query, or fragment`);
  }
  return raw.replace(/\/+$/, '');
};

/** Fail before quoting a payment if the live demo is incompletely configured. */
export function loadConfig(env: Env): WorkerConfig {
  const required = [
    'HEDERA_ARTIST_ACCOUNT_ID',
    'HEDERA_FAN_ACCOUNT_ID',
    'HEDERA_FAN_PRIVATE_KEY',
    'UPSTREAM_API_KEY',
    'UPSTREAM_MODEL',
  ] as const;
  const missing = required.filter((key) => !value(env, key));
  if (missing.length) throw new Error(`missing required configuration: ${missing.join(', ')}`);

  const artistAccountId = value(env, 'HEDERA_ARTIST_ACCOUNT_ID')!;
  const fanAccountId = value(env, 'HEDERA_FAN_ACCOUNT_ID')!;
  for (const [name, account] of [
    ['HEDERA_ARTIST_ACCOUNT_ID', artistAccountId],
    ['HEDERA_FAN_ACCOUNT_ID', fanAccountId],
  ] as const) {
    if (!/^0\.0\.\d+$/.test(account)) throw new Error(`${name} must be a Hedera account id`);
  }
  if (artistAccountId === fanAccountId) {
    throw new Error('the autonomous fan account must be different from the artist account');
  }

  const network = value(env, 'HEDERA_NETWORK') ?? 'hedera:testnet';
  if (network !== 'hedera:testnet') {
    throw new Error('this small public demo is deliberately restricted to hedera:testnet');
  }
  const assetId = value(env, 'HEDERA_ASSET') ?? '0.0.429274';
  if (!/^0\.0\.\d+$/.test(assetId)) throw new Error('HEDERA_ASSET must be an HTS token id');

  const priceText = value(env, 'DEMO_PRICE_ATOMIC') ?? '1000';
  if (!/^\d+$/.test(priceText)) throw new Error('DEMO_PRICE_ATOMIC must be an integer string');
  const priceAtomic = BigInt(priceText);
  // A second server-side ceiling, independent of the payer SDK's USD control.
  if (priceAtomic < 1n || priceAtomic > 10_000n) {
    throw new Error('DEMO_PRICE_ATOMIC must be between 1 and 10000 for this public demo');
  }

  return {
    artistAccountId,
    fanAccountId,
    fanPrivateKey: value(env, 'HEDERA_FAN_PRIVATE_KEY')!,
    network,
    assetId,
    assetDecimals: integer(value(env, 'HEDERA_ASSET_DECIMALS'), 6, 'HEDERA_ASSET_DECIMALS', 0, 18),
    facilitatorUrl: httpsUrl(
      value(env, 'FACILITATOR_URL') ?? 'https://x402.org/facilitator',
      'FACILITATOR_URL',
    ),
    upstreamApiKey: value(env, 'UPSTREAM_API_KEY')!,
    upstreamBaseUrl: httpsUrl(
      value(env, 'UPSTREAM_BASE_URL') ??
        'https://router-api-testnet.integratenetwork.work/v1',
      'UPSTREAM_BASE_URL',
    ),
    // Required: no model name is presented as validated by this repository.
    upstreamModel: value(env, 'UPSTREAM_MODEL')!,
    upstreamTrustMode: value(env, 'UPSTREAM_TRUST_MODE') ?? 'verified',
    priceAtomic,
    maxOutputTokens: integer(value(env, 'DEMO_MAX_OUTPUT_TOKENS'), 160, 'DEMO_MAX_OUTPUT_TOKENS', 1, 160),
    maxPaymentUsd: '$0.01',
    ipLimitPerMinute: integer(value(env, 'DEMO_IP_LIMIT_PER_MINUTE'), 2, 'DEMO_IP_LIMIT_PER_MINUTE', 1, 10),
    globalLimitPerMinute: integer(
      value(env, 'DEMO_GLOBAL_LIMIT_PER_MINUTE'),
      6,
      'DEMO_GLOBAL_LIMIT_PER_MINUTE',
      1,
      30,
    ),
    maxInflight: integer(value(env, 'DEMO_MAX_INFLIGHT'), 2, 'DEMO_MAX_INFLIGHT', 1, 4),
  };
}
