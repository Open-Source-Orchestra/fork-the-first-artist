/**
 * Select the demo fan's payer without ever reusing the agent compute wallet.
 *
 * Development uses an explicit mock payer. Live mode requires the distinct fan
 * account/key and rejects a mock result, even if agent compute credentials exist.
 * No network or chain call happens until the returned payer's fetch is invoked.
 */
import { createPayer, type Payer, type PayerOptions } from './payer.ts';

export interface FanPayerSelection {
  /** The mode reported by the payments service health endpoint. */
  mode: string;
  env?: NodeJS.ProcessEnv;
}

type PayerFactory = (opts: PayerOptions) => Promise<Payer>;

export async function createFanPayer(
  selection: FanPayerSelection,
  payerFactory: PayerFactory = createPayer,
): Promise<Payer> {
  const env = selection.env ?? process.env;
  if (selection.mode !== 'dev' && selection.mode !== 'live') {
    throw new Error('payments mode must be dev or live before selecting a fan payer');
  }

  const live = selection.mode === 'live';
  const accountId = live
    ? required(env.HEDERA_FAN_ACCOUNT_ID, 'HEDERA_FAN_ACCOUNT_ID')
    : env.HEDERA_FAN_ACCOUNT_ID?.trim() || '0.0.7777';
  // An explicit empty key in dev prevents createPayer from inheriting the agent
  // compute key. Live never falls back to HEDERA_AGENT_* credentials.
  const privateKey = live ? required(env.HEDERA_FAN_PRIVATE_KEY, 'HEDERA_FAN_PRIVATE_KEY') : '';
  const payer = await payerFactory({
    accountId,
    privateKey,
    network: env.HEDERA_FAN_NETWORK ?? env.HEDERA_NETWORK ?? 'hedera:testnet',
    allowMock: !live,
    // HBAR (`0.0.0`) is not a default x402 asset: forward the asset + an exact
    // per-payment cap so the SDK will sign it (see spendControlsFor).
    ...(env.HEDERA_ASSET ? { asset: env.HEDERA_ASSET } : {}),
    ...(env.HEDERA_ASSET_DECIMALS ? { assetDecimals: Number(env.HEDERA_ASSET_DECIMALS) } : {}),
    ...(env.HEDERA_FAN_MAX_PER_PAYMENT ?? env.PAYER_MAX_PER_PAYMENT
      ? { maxPerPaymentAsset: env.HEDERA_FAN_MAX_PER_PAYMENT ?? env.PAYER_MAX_PER_PAYMENT }
      : {}),
  });

  if (live && payer.kind !== 'hedera') {
    throw new Error('live fan payment refused: payer is not configured for Hedera settlement');
  }
  return payer;
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} is required for live fan payment`);
  return trimmed;
}
