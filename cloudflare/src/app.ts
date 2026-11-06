import type { Gate } from '../../payments/src/gate/types.ts';
import { settleConfirmed } from '../../payments/src/settlement.ts';
import type { Payer } from '../../agent/src/rails/payer.ts';
import type { WorkerConfig } from './config.ts';
import { DemoLimiter } from './limiter.ts';
import {
  ALLOWED_ORIGINS,
  HttpError,
  errorBody,
  json,
  readQuestion,
  withCommonHeaders,
} from './http.ts';
import { callZeroG, DEMO_ARTIST, ZeroGError } from './zero-g.ts';
import { PaymentReplayGuard, type PaymentClaim } from './replay-guard.ts';

export interface AppDependencies {
  config: WorkerConfig;
  gate: Gate;
  createFanPayer: () => Promise<Payer>;
  fetchImpl?: typeof fetch;
  limiter?: DemoLimiter;
  replayGuard?: { begin(paymentHeader: string): Promise<PaymentClaim> };
}

const ambiguous = (code: string, message: string) => ({
  ok: false,
  error: code,
  message,
  answer: null,
  settled: null,
  proof: null,
  reconciliationRequired: true,
});

function strictGate(gate: Gate): Gate {
  return {
    kind: gate.kind,
    challenge: (input) => gate.challenge(input),
    verify: async (input) => {
      const result = await gate.verify(input);
      if ((result.ok as unknown) !== true && (result.ok as unknown) !== false) {
        throw new Error('facilitator validity was not boolean');
      }
      return result;
    },
    settle: async (input) => {
      const result = await gate.settle(input);
      if ((result.success as unknown) !== true && (result.success as unknown) !== false) {
        throw new Error('facilitator settlement status was not boolean');
      }
      return result;
    },
  };
}

async function handleAsk(
  request: Request,
  cfg: WorkerConfig,
  originalGate: Gate,
  fetchImpl: typeof fetch,
  replayGuard: { begin(paymentHeader: string): Promise<PaymentClaim> },
): Promise<Response> {
  const gate = strictGate(originalGate);
  const question = await readQuestion(request);
  const resource = `${new URL(request.url).origin}/ask`;

  let challenge: Awaited<ReturnType<Gate['challenge']>>;
  try {
    challenge = await gate.challenge({
      resource,
      amountAtomic: cfg.priceAtomic,
      payTo: cfg.artistAccountId,
      description: 'one artist-grounded answer from the public fictional demo profile',
    });
  } catch {
    return json(
      502,
      errorBody('PAYMENT_CHALLENGE_UNAVAILABLE', 'the facilitator could not quote this payment'),
    );
  }
  // This exact requirements object, including facilitator extra.feePayer, is
  // deliberately reused for verify and settle. Never reconstruct it.
  const requirements = challenge.body.accepts[0];
  if (!requirements) return json(502, errorBody('PAYMENT_CHALLENGE_INVALID', 'empty x402 challenge'));

  const paymentHeader = request.headers.get('x-payment') ?? undefined;
  if (paymentHeader && paymentHeader.length > 32_768) {
    return json(413, errorBody('PAYMENT_HEADER_TOO_LARGE', 'X-PAYMENT exceeds 32768 characters'));
  }
  let verified: Awaited<ReturnType<Gate['verify']>>;
  try {
    verified = await gate.verify({ paymentHeader, requirements });
  } catch {
    return json(
      502,
      errorBody('PAYMENT_VERIFICATION_UNAVAILABLE', 'payment validity could not be checked; nothing was settled'),
    );
  }
  if (!verified.ok) {
    return json(
      402,
      {
        ...challenge.body,
        error: verified.reason ?? 'payment required',
        answer: null,
        settled: false,
        proof: null,
      },
      challenge.headers,
    );
  }

  let claim: PaymentClaim | undefined;
  if (paymentHeader) {
    try { claim = await replayGuard.begin(paymentHeader); } catch {
      return json(502, errorBody('REPLAY_GUARD_UNAVAILABLE', 'payment claim unavailable; no compute or settlement occurred'));
    }
    if (!claim.ok) {
      return json(409, {
        ...ambiguous('PAYMENT_REPLAY_REJECTED', claim.state === 'inflight'
          ? 'this payment is already being processed'
          : 'this payment was already processed; use its original response or reconcile before retrying'),
      }, { 'retry-after': claim.state === 'inflight' ? '2' : '60' });
    }
  }
  const lease = claim?.ok ? claim.lease : undefined;

  let upstream: Awaited<ReturnType<typeof callZeroG>>;
  try {
    upstream = await callZeroG(question, cfg, fetchImpl);
  } catch (error) {
    await lease?.release();
    if (error instanceof ZeroGError && error.kind === 'degraded') {
      return json(422, errorBody('DEGRADED_ANSWER', `${error.message}; no payment was settled`));
    }
    return json(
      502,
      errorBody(
        'UPSTREAM_FAILED',
        `${error instanceof ZeroGError ? error.message : '0G inference failed'}; no payment was settled`,
      ),
    );
  }

  try { await lease?.seal(); } catch {
    return json(502, errorBody('REPLAY_GUARD_UNAVAILABLE', 'could not persist payment use; settlement was not attempted'));
  }
  const confirmed = await settleConfirmed(gate, { handle: verified.handle, requirements });
  if (!confirmed.ok) return json(502, { ...confirmed.body, answer: null });
  const { settlement, txId } = confirmed;
  if (settlement.network !== cfg.network) {
    return json(
      502,
      ambiguous(
        'SETTLEMENT_UNCONFIRMED',
        'the facilitator omitted or returned a different network; reconcile before retrying',
      ),
    );
  }

  const payer = settlement.payer ?? verified.payer ?? null;
  const settlementReceipt = Buffer.from(
    JSON.stringify({
      success: true,
      transaction: txId,
      network: cfg.network,
      ...(payer === null ? {} : { payer }),
    }),
  ).toString('base64');
  const headers: Record<string, string> = {
    'x-payment-response': settlementReceipt,
    'x-0g-request-id': upstream.provenance.requestId,
  };
  if (upstream.provenance.zgResKey) headers['ZG-Res-Key'] = upstream.provenance.zgResKey;

  return json(
    200,
    {
      ok: true,
      answer: upstream.answer,
      artist: DEMO_ARTIST,
      usage: upstream.usage,
      charged: true,
      settled: true,
      proof: {
        paymentTxId: txId,
        network: cfg.network,
        asset: cfg.assetId,
        amountAtomic: cfg.priceAtomic.toString(),
        payer,
        payTo: cfg.artistAccountId,
        hashScan: `https://hashscan.io/testnet/transaction/${encodeURIComponent(txId)}`,
        upstream: upstream.provenance,
      },
    },
    headers,
  );
}

async function handleDemo(
  request: Request,
  cfg: WorkerConfig,
  createFanPayer: () => Promise<Payer>,
  limiter: DemoLimiter,
): Promise<Response> {
  const sourceIp = request.headers.get('cf-connecting-ip') ?? 'local-or-unknown';
  const permit = limiter.acquire(sourceIp);
  if (!permit.ok) {
    return json(
      429,
      errorBody('DEMO_RATE_LIMITED', 'public demo limit reached; retry later'),
      { 'retry-after': permit.retryAfterSeconds.toString() },
    );
  }

  try {
    const question = await readQuestion(request);
    const payer = await createFanPayer();
    if (payer.kind !== 'hedera' || payer.accountId !== cfg.fanAccountId) {
      return json(
        500,
        errorBody('FAN_PAYER_NOT_LIVE', 'the dedicated autonomous Hedera fan payer is not configured'),
      );
    }

    let response: Response;
    try {
      response = await payer.fetch(`${new URL(request.url).origin}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ question }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch {
      // A signed retry may have reached /ask even if its response did not reach us.
      return json(
        502,
        ambiguous(
          'DEMO_RESULT_UNCONFIRMED',
          'the autonomous demo request was interrupted; reconcile the fan wallet before retrying',
        ),
      );
    }
    const out = new Response(response.body, response);
    out.headers.set('x-demo-runner', 'autonomous-fan');
    return out;
  } finally {
    permit.release();
  }
}

export function createApp(deps: AppDependencies): (request: Request) => Promise<Response> {
  const {
    config: cfg,
    gate,
    createFanPayer,
    fetchImpl = fetch,
    limiter = new DemoLimiter({
      ip: cfg.ipLimitPerMinute,
      global: cfg.globalLimitPerMinute,
      inflight: cfg.maxInflight,
    }),
    replayGuard = new PaymentReplayGuard(),
  } = deps;

  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    let response: Response;
    try {
      if (origin && !ALLOWED_ORIGINS.has(origin)) {
        throw new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'this browser origin is not allowed');
      }
      const path = new URL(request.url).pathname;
      if (request.method === 'OPTIONS') {
        if (path !== '/ask' && path !== '/demo') throw new HttpError(404, 'NOT_FOUND', 'not found');
        if (origin && !ALLOWED_ORIGINS.has(origin)) {
          throw new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'this browser origin is not allowed');
        }
        response = new Response(null, {
          status: 204,
          headers: {
            'access-control-allow-methods': 'POST, OPTIONS',
            'access-control-allow-headers': 'content-type, x-payment',
            'access-control-max-age': '600',
          },
        });
      } else if (path === '/health') {
        if (request.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'use GET');
        response = json(200, {
          ok: true,
          service: 'oso-artist-demo',
          routes: ['POST /ask', 'POST /demo', 'GET /health'],
          network: cfg.network,
          asset: cfg.assetId,
          priceAtomic: cfg.priceAtomic.toString(),
          upstream: {
            provider: '0g',
            baseUrl: cfg.upstreamBaseUrl,
            model: cfg.upstreamModel,
            trustMode: cfg.upstreamTrustMode,
            independentVerificationPerformed: false,
          },
          demoLimits: {
            ipPerMinute: cfg.ipLimitPerMinute,
            globalPerMinutePerIsolate: cfg.globalLimitPerMinute,
            maxInflightPerIsolate: cfg.maxInflight,
            durableGlobalLedger: false,
          },
        });
      } else if (path === '/ask') {
        if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'use POST');
        response = await handleAsk(request, cfg, gate, fetchImpl, replayGuard);
      } else if (path === '/demo') {
        if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'use POST');
        response = await handleDemo(request, cfg, createFanPayer, limiter);
      } else {
        throw new HttpError(404, 'NOT_FOUND', 'not found');
      }
    } catch (error) {
      if (error instanceof HttpError) {
        response = json(error.status, errorBody(error.code, error.message), error.headers);
      } else {
        // No prompt, key, facilitator body, or upstream body is logged or returned.
        response = json(500, errorBody('INTERNAL_ERROR', 'the demo request failed safely'));
      }
    }
    return withCommonHeaders(response, request);
  };
}
