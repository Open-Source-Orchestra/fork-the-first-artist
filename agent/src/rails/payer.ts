/**
 * The steward's wallet. This is what makes the agent autonomous: it pays for its
 * own inference, per call, with no human approving anything.
 *
 *   mock   — no wallet key configured: sends a dev X-PAYMENT header. The meter in
 *            dev mode accepts it. Lets the whole loop run offline.
 *   hedera — real x402: on 402, sign a partially-signed Hedera TransferTransaction
 *            with @x402/hedera, retry with X-PAYMENT, let the facilitator settle.
 *
 * `setSpendControls` is the SDK's built-in guard (per-payment cap + asset
 * allowlist) - the "spending controls for agents" requirement, enforced
 * client-side as a second line of defence behind the meter's own budget.
 *
 * ## Why the payer wraps `fetch` instead of being called explicitly
 *
 * The steward does not know it is paying. It calls a provider, the provider calls
 * `payer.fetch`, and the 402 -> sign -> retry handshake happens inside this wrapper.
 * That is the x402 model: payment is a *transport concern*. It also means the payment
 * code has exactly one entry point (`fetch`) and cannot be reached by a model deciding
 * to call something - there is no `pay()` for a prompt injection to invoke.
 *
 * ## Two independent spend ceilings
 *
 * | Where | What it protects |
 * |---|---|
 * | `setSpendControls` here | a single payment cannot exceed `maxAmountPerPayment` |
 * | `payments/src/meter.ts` budget gate | the steward's *total* spend over time |
 *
 * Neither is sufficient alone: the client cap cannot see history, the server gate
 * cannot stop a compromised client. Both are checked.
 */
import type { Provenance } from '../types.ts';

export interface Payer {
  kind: 'mock' | 'hedera';
  accountId?: string;
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

export interface PayerOptions {
  accountId?: string;
  privateKey?: string;
  network?: string;
  /** hard client-side ceiling per payment, USD (default $1) — applies to default assets (USDC) */
  maxAmountPerPayment?: string;
  /**
   * Non-default asset the payer may pay with, e.g. native HBAR `0.0.0`.
   * Defaults to `HEDERA_ASSET` when that is not testnet/mainnet USDC.
   */
  asset?: string;
  /** decimals of `asset` (HBAR: 8). Defaults to `HEDERA_ASSET_DECIMALS`, else 8 for HBAR. */
  assetDecimals?: number;
  /**
   * Hard per-payment cap for `asset`, as a decimal string in that asset's units
   * (default `PAYER_MAX_PER_PAYMENT`, else 2 for HBAR). Converted to an exact
   * atomic integer: the x402 SDK only accepts atomic caps for non-default assets.
   */
  maxPerPaymentAsset?: string;
  timeoutMs?: number;
  /** Set false for live callers so a missing key can never degrade to mock. */
  allowMock?: boolean;
}

/**
 * Create the wallet.
 *
 * @returns `{ kind: 'mock' }` only when mock is allowed and no private key is
 *          configured. `allowMock: false` (and PAYMENTS_MODE=live by default)
 *          fails closed instead of silently turning a live payment into a mock.
 */
export async function createPayer(opts: PayerOptions = {}): Promise<Payer> {
  const accountId = opts.accountId ?? process.env.HEDERA_AGENT_ACCOUNT_ID ?? '';
  const privateKey = opts.privateKey ?? process.env.HEDERA_AGENT_PRIVATE_KEY;
  const network = opts.network ?? process.env.HEDERA_NETWORK ?? 'hedera:testnet';

  if (!privateKey) {
    const allowMock = opts.allowMock ?? process.env.PAYMENTS_MODE !== 'live';
    if (!allowMock) {
      throw new Error('a live payer requires an explicit private key; mock payment is disabled');
    }
    // Dev payer: no key, no chain. The meter must be in PAYMENTS_MODE=dev too.
    return {
      kind: 'mock',
      accountId: accountId || undefined,
      async fetch(url, init) {
        const headers = new Headers(init?.headers);
        headers.set('x-payment', `mock payer=${accountId || '0.0.0000'}`);
        return fetch(url, { ...init, headers });
      },
    };
  }

  if (!accountId) throw new Error('accountId is required when a payer private key is configured');

  const spendControls = spendControlsFor({
    network,
    asset: opts.asset ?? process.env.HEDERA_ASSET,
    assetDecimals:
      opts.assetDecimals ??
      (process.env.HEDERA_ASSET_DECIMALS ? Number(process.env.HEDERA_ASSET_DECIMALS) : undefined),
    maxAmountPerPayment: opts.maxAmountPerPayment,
    maxPerPaymentAsset: opts.maxPerPaymentAsset ?? process.env.PAYER_MAX_PER_PAYMENT,
  });
  const client = await buildX402Client({ accountId, privateKey, network, spendControls });

  return {
    kind: 'hedera',
    accountId,
    async fetch(url, init) {
      // Try unauthenticated first. A metered endpoint answers 402; anything else
      // (200, 500, ...) is passed through untouched, so a non-payment error is never
      // swallowed by the payment path.
      const first = await fetch(url, init);
      if (first.status !== 402) return first;

      const raw = await first.text();
      let challenge: { x402Version?: number; accepts?: unknown[] };
      try {
        challenge = JSON.parse(raw) as typeof challenge;
      } catch {
        throw new Error(`402 from ${url} was not JSON: ${raw.slice(0, 200)}`);
      }
      if (!challenge.accepts?.length) {
        throw new Error(`402 from ${url} had no payment requirements: ${raw.slice(0, 200)}`);
      }

      // Sign exactly what the server asked for. We do NOT invent requirements; we
      // echo `accepts` back signed. A server asking for an asset outside the
      // allowlist is refused by setSpendControls, not by us.
      const paymentPayload = await client.createPaymentPayload({
        x402Version: challenge.x402Version ?? 2,
        accepts: challenge.accepts,
      } as never);
      const header = client.encodePaymentSignatureHeader(paymentPayload);

      const headers = new Headers(init?.headers);
      headers.set('X-PAYMENT', header);
      return fetch(url, { ...init, headers });
    },
  };
}

/** Assets @x402/hedera 2.30 already knows (DEFAULT_ASSETS): USD-capped by `$` money. */
const DEFAULT_HEDERA_ASSETS = new Set(['0.0.429274', '0.0.456858']);
export const HBAR_ASSET_ID = '0.0.0';

export interface SpendControlsView {
  maxAmountPerPayment: string;
  allowedAssets?: { network: string; asset: string; maxAmountPerPayment: string }[];
}

/**
 * The client-side spend guard for this payer.
 *
 * USDC is a default asset, so the SDK's USD cap applies. HBAR (`0.0.0`) is NOT a
 * default asset in @x402/hedera 2.30: without an explicit `allowedAssets` entry
 * the SDK refuses every HBAR requirement, and with an entry but no cap it would
 * pay any amount. So a non-default asset always gets an exact atomic cap.
 */
export function spendControlsFor(opts: {
  network: string;
  asset?: string;
  assetDecimals?: number;
  maxAmountPerPayment?: string;
  maxPerPaymentAsset?: string;
}): SpendControlsView {
  const base: SpendControlsView = { maxAmountPerPayment: opts.maxAmountPerPayment ?? '$1' };
  const asset = opts.asset?.trim();
  if (!asset || DEFAULT_HEDERA_ASSETS.has(asset)) return base;
  const isHbar = asset === HBAR_ASSET_ID;
  const decimals = opts.assetDecimals ?? (isHbar ? 8 : undefined);
  if (decimals === undefined || !Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`asset ${asset} needs HEDERA_ASSET_DECIMALS to cap payments`);
  }
  if (isHbar && decimals !== 8) throw new Error(`HBAR has 8 decimals, got ${decimals}`);
  const cap = opts.maxPerPaymentAsset ?? (isHbar ? '2' : undefined);
  if (!cap) throw new Error(`asset ${asset} needs PAYER_MAX_PER_PAYMENT (per-payment cap in asset units)`);
  return {
    ...base,
    allowedAssets: [{ network: opts.network, asset, maxAmountPerPayment: decimalToAtomicString(cap, decimals) }],
  };
}

/** "1.5" + 8 -> "150000000". Refuses to round (a rounded cap is a different cap). */
function decimalToAtomicString(value: string, decimals: number): string {
  const v = value.trim();
  if (!/^\d*(\.\d*)?$/.test(v) || v === '' || v === '.') throw new Error(`invalid amount ${JSON.stringify(value)}`);
  const [whole, frac = ''] = v.split('.');
  if (frac.length > decimals) throw new Error(`${value} has more than ${decimals} decimals`);
  const atomic = BigInt(`${whole || '0'}${(frac + '0'.repeat(decimals)).slice(0, decimals)}`);
  if (atomic <= 0n) throw new Error('per-payment cap must be greater than zero');
  return atomic.toString();
}

interface X402ClientLike {
  createPaymentPayload(paymentRequired: unknown): Promise<unknown>;
  encodePaymentSignatureHeader(payload: unknown): string;
}

/**
 * Build the real x402 client lazily.
 *
 * The `import()`s are dynamic on purpose: the x402 packages and the Hedera SDK are
 * `optionalDependencies`, so a dev-mode checkout can run with none of them installed.
 * Only an operator who actually configured a key pays the install cost - and gets a
 * clear error naming all three packages if they are missing.
 */
async function buildX402Client(opts: {
  accountId: string;
  privateKey: string;
  network: string;
  spendControls: SpendControlsView;
}): Promise<X402ClientLike> {
  // dynamic: dev mode does not need these packages installed at all
  const [{ x402Client }, { encodePaymentSignatureHeader }, hedera] = await Promise.all([
    import('@x402/core/client'),
    import('@x402/core/http'),
    import('@x402/hedera'),
  ]).catch((err: unknown) => {
    throw new Error(
      `Hedera payment needs @x402/core, @x402/hedera and @hiero-ledger/sdk installed: ${(err as Error).message}`,
    );
  });

  const { ExactHederaScheme } = await import('@x402/hedera/exact/client');
  const signer = hedera.createClientHederaSigner(
    opts.accountId,
    hedera.PrivateKey.fromStringECDSA(opts.privateKey),
    { network: opts.network },
  );

  const client = new x402Client()
    .register(opts.network as `${string}:${string}`, new ExactHederaScheme(signer))
    .setSpendControls(opts.spendControls as never);

  return {
    createPaymentPayload: (pr) => client.createPaymentPayload(pr as never),
    encodePaymentSignatureHeader: (p) => encodePaymentSignatureHeader(p as never),
  };
}

/** Pull the settlement tx id + upstream provenance out of a paid response. */
export function readMeterProvenance(payload: {
  x_meter?: {
    paymentTxId?: string;
    hcsTxId?: string | null;
    upstream?: { requestId?: string | null; teeVerified?: boolean | null };
  };
}): Provenance {
  const m = payload.x_meter;
  return {
    paymentTxId: m?.paymentTxId,
    hcsTxId: m?.hcsTxId ?? null,
    requestId: m?.upstream?.requestId ?? undefined,
    teeVerified: m?.upstream?.teeVerified ?? null,
  };
}
