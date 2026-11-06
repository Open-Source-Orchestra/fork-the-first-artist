import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createApp, type AppDependencies } from '../src/app.ts';
import type { WorkerConfig } from '../src/config.ts';
import { DemoLimiter } from '../src/limiter.ts';
import type { Gate } from '../../payments/src/gate/types.ts';
import type { Config } from '../../payments/src/config.ts';
import { createHederaGate } from '../../payments/src/gate/hedera.ts';
import type { Payer } from '../../agent/src/rails/payer.ts';

const TX = '0.0.123@1762450000.123456789';
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function config(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    artistAccountId: '0.0.1001',
    fanAccountId: '0.0.1002',
    fanPrivateKey: 'not-used-by-mock-tests',
    network: 'hedera:testnet',
    assetId: '0.0.429274',
    assetDecimals: 6,
    facilitatorUrl: 'https://facilitator.test',
    upstreamApiKey: 'not-used-by-mock-tests',
    upstreamBaseUrl: 'https://0g.test/v1',
    upstreamModel: 'explicit-test-model',
    upstreamTrustMode: 'verified',
    priceAtomic: 1000n,
    maxOutputTokens: 160,
    maxPaymentUsd: '$0.01',
    ipLimitPerMinute: 2,
    globalLimitPerMinute: 6,
    maxInflight: 2,
    ...overrides,
  };
}

function validZeroG(init: {
  answer?: string;
  finishReason?: string | null;
  model?: string | null;
  teeVerified?: boolean | null;
  zgResKey?: string | null;
  requestId?: string | null;
  headerRequestId?: string;
  provider?: string | null;
  headerProvider?: string;
} = {}) {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-body-fallback',
      model: init.model === undefined ? 'explicit-test-model' : init.model,
      choices: [
        {
          finish_reason: init.finishReason === undefined ? 'stop' : init.finishReason,
          message: {
            role: 'assistant',
            content: init.answer ?? 'Mira Modal makes quiet electronic music from field recordings.',
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 12 },
      x_0g_trace: {
        request_id: init.requestId === undefined ? '0g-request-123' : init.requestId,
        provider: init.provider === undefined ? '0x0000000000000000000000000000000000000abc' : init.provider,
        tee_verified: init.teeVerified === undefined ? true : init.teeVerified,
      },
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        ...(init.zgResKey === null ? {} : { 'ZG-Res-Key': init.zgResKey ?? 'zg-chat-123' }),
        ...(init.headerRequestId ? { 'x-0g-request-id': init.headerRequestId } : {}),
        ...(init.headerProvider ? { 'X-Provider': init.headerProvider } : {}),
      },
    },
  );
}

interface GateCalls {
  challenges: { input: Parameters<Gate['challenge']>[0]; requirements: unknown }[];
  verifies: Parameters<Gate['verify']>[0][];
  settles: Parameters<Gate['settle']>[0][];
}

function fakeGate(options: {
  verify?: Gate['verify'];
  settle?: Gate['settle'];
} = {}): { gate: Gate; calls: GateCalls } {
  const calls: GateCalls = { challenges: [], verifies: [], settles: [] };
  const gate: Gate = {
    kind: 'hedera',
    async challenge(input) {
      const requirements = {
        scheme: 'exact' as const,
        network: 'hedera:testnet',
        amount: input.amountAtomic.toString(),
        asset: '0.0.429274',
        payTo: input.payTo,
        resource: input.resource,
        description: input.description,
        maxTimeoutSeconds: 180,
        extra: { feePayer: '0.0.9999' },
      };
      const body = { x402Version: 2 as const, accepts: [requirements] };
      calls.challenges.push({ input, requirements });
      return {
        status: 402,
        body,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'payment-required': Buffer.from(JSON.stringify(body)).toString('base64'),
        },
      };
    },
    async verify(input) {
      calls.verifies.push(input);
      if (options.verify) return options.verify(input);
      if (!input.paymentHeader) return { ok: false, reason: 'missing X-PAYMENT header' };
      return { ok: true, payer: '0.0.1002', handle: { payment: input.paymentHeader } };
    },
    async settle(input) {
      calls.settles.push(input);
      if (options.settle) return options.settle(input);
      return { success: true, txId: TX, payer: '0.0.1002', network: 'hedera:testnet' };
    },
  };
  return { gate, calls };
}

function fixture(options: {
  gate?: Gate;
  fetchImpl?: typeof fetch;
  createFanPayer?: () => Promise<Payer>;
  config?: Partial<WorkerConfig>;
} = {}) {
  const cfg = config(options.config);
  const fake = fakeGate();
  const gate = options.gate ?? fake.gate;
  const createFanPayer = options.createFanPayer ?? (async () => {
    throw new Error('unexpected fan payer creation');
  });
  const app = createApp({
    config: cfg,
    gate,
    createFanPayer,
    fetchImpl: options.fetchImpl ?? (async () => validZeroG()),
  } satisfies AppDependencies);
  return { app, cfg, calls: fake.calls };
}

const paidPost = (app: (request: Request) => Promise<Response>, path = '/ask') =>
  app(new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-payment': 'signed-test-payment' },
    body: JSON.stringify({ question: 'What music does Mira make?' }),
  }));

test('unpaid /ask returns one canonical 402 with feePayer and does not call 0G or settle', async () => {
  let upstreamCalls = 0;
  const { app, calls } = fixture({ fetchImpl: async () => { upstreamCalls += 1; return validZeroG(); } });
  const response = await app(new Request('https://worker.test/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'What music?' }),
  }));
  assert.equal(response.status, 402);
  const body = await response.json();
  const requirements = body.accepts[0];
  assert.equal(requirements.extra.feePayer, '0.0.9999');
  assert.equal(requirements.payTo, '0.0.1001');
  assert.equal(body.answer, null);
  assert.equal(body.settled, false);
  const encodedHeader = response.headers.get('payment-required');
  assert.ok(encodedHeader);
  const header = JSON.parse(Buffer.from(encodedHeader, 'base64').toString());
  assert.deepEqual(header.accepts, body.accepts);
  assert.deepEqual(requirements, calls.challenges[0].requirements);
  assert.strictEqual(calls.verifies[0].requirements, calls.challenges[0].requirements);
  assert.equal(calls.settles.length, 0);
  assert.equal(upstreamCalls, 0);
});

test('successful /ask returns real-shaped tx/HashScan and 0G verification provenance only after settlement', async () => {
  const { gate, calls } = fakeGate();
  let upstreamBody: any;
  const app = createApp({
    config: config(), gate,
    createFanPayer: async () => { throw new Error('not needed'); },
    fetchImpl: async (_url, init) => {
      upstreamBody = JSON.parse(String(init?.body));
      return validZeroG();
    },
  });
  const response = await paidPost(app);
  assert.equal(response.status, 200);
  assert.strictEqual(calls.verifies[0].requirements, calls.challenges[0].requirements);
  assert.strictEqual(calls.settles[0].requirements, calls.challenges[0].requirements);
  assert.equal(upstreamBody.max_tokens, 160);
  assert.equal(upstreamBody.verify_tee, true);
  assert.deepEqual(upstreamBody.chat_template_kwargs, { enable_thinking: false });
  assert.equal(upstreamBody.stream, false);
  assert.equal(upstreamBody.messages.length, 2);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.settled, true);
  assert.equal(body.proof.paymentTxId, TX);
  assert.equal(body.proof.hashScan, `https://hashscan.io/testnet/transaction/${encodeURIComponent(TX)}`);
  assert.equal(body.proof.payTo, '0.0.1001');
  assert.equal(body.proof.upstream.requestId, '0g-request-123');
  assert.equal(body.proof.upstream.zgResKey, 'zg-chat-123');
  assert.equal(body.proof.upstream.verificationChatId, 'zg-chat-123');
  assert.equal(body.proof.upstream.providerAddress, '0x0000000000000000000000000000000000000abc');
  assert.equal(body.proof.upstream.routerReportedTeeVerified, true);
  assert.equal(body.proof.upstream.independentlyVerified, false);
  assert.equal(response.headers.get('ZG-Res-Key'), 'zg-chat-123');
  assert.equal(response.headers.get('x-0g-request-id'), '0g-request-123');
  assert.ok(response.headers.get('x-payment-response'));
});

test('canonical Hedera gate sends identical feePayer requirements to verify and settle', async () => {
  const seen: { verify?: any; settle?: any } = {};
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/supported')) {
      return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'hedera:testnet', extra: { feePayer: '0.0.9999' } }] });
    }
    const parsed = JSON.parse(String(init?.body));
    if (url.endsWith('/verify')) {
      seen.verify = parsed;
      return Response.json({ isValid: true, payer: '0.0.1002' });
    }
    if (url.endsWith('/settle')) {
      seen.settle = parsed;
      return Response.json({ success: true, transaction: TX, network: 'hedera:testnet', payer: '0.0.1002' });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const gate = createHederaGate({
    network: 'hedera:testnet', facilitatorUrl: 'https://facilitator.test', asset: { id: '0.0.429274', decimals: 6 },
  } as Config);
  const challenge = await gate.challenge({ resource: 'https://worker.test/ask', amountAtomic: 1000n, payTo: '0.0.1001', description: 'canonical gate test' });
  const requirements = challenge.body.accepts[0];
  assert.equal(requirements.extra?.feePayer, '0.0.9999');
  const paymentPayload = { x402Version: 2, scheme: 'exact', network: 'hedera:testnet', payload: { signature: 'mock' } };
  const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
  const verified = await gate.verify({ paymentHeader, requirements });
  assert.equal(verified.ok, true);
  const settled = await gate.settle({ handle: verified.handle, requirements });
  assert.equal(settled.txId, TX);
  assert.deepEqual(seen.verify.paymentRequirements, requirements);
  assert.deepEqual(seen.settle.paymentRequirements, requirements);
  assert.deepEqual(seen.verify.paymentRequirements, seen.settle.paymentRequirements);
  assert.deepEqual(seen.settle.paymentPayload, paymentPayload);
});

test('0G transport/status failure produces no settlement and no paid content', async () => {
  const { gate, calls } = fakeGate();
  const app = createApp({ config: config(), gate, createFanPayer: async () => { throw new Error('unused'); }, fetchImpl: async () => new Response('no', { status: 503 }) });
  const response = await paidPost(app);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error, 'UPSTREAM_FAILED');
  assert.equal(body.settled, false);
  assert.equal(body.answer, null);
  assert.equal(body.proof, null);
  assert.equal(calls.settles.length, 0);
  assert.equal(response.headers.get('x-payment-response'), null);
});

test('degraded/truncated 0G answer produces no settlement', async () => {
  const { gate, calls } = fakeGate();
  const app = createApp({ config: config(), gate, createFanPayer: async () => { throw new Error('unused'); }, fetchImpl: async () => validZeroG({ finishReason: 'length' }) });
  const response = await paidPost(app);
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, 'DEGRADED_ANSWER');
  assert.equal(calls.settles.length, 0);
});

test('router-reported failed TEE verification is untrusted and does not settle', async () => {
  const { gate, calls } = fakeGate();
  const app = createApp({ config: config(), gate, createFanPayer: async () => { throw new Error('unused'); }, fetchImpl: async () => validZeroG({ teeVerified: false }) });
  const response = await paidPost(app);
  assert.equal(response.status, 422);
  assert.equal(calls.settles.length, 0);
});

test('settlement success=false returns honest non-200 without answer or proof', async () => {
  const { gate } = fakeGate({ settle: async () => ({ success: false, errorReason: 'mock declined', network: 'hedera:testnet' }) });
  const app = createApp({ config: config(), gate, createFanPayer: async () => { throw new Error('unused'); }, fetchImpl: async () => validZeroG() });
  const response = await paidPost(app);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error, 'SETTLEMENT_FAILED');
  assert.equal(body.settled, false);
  assert.equal(body.answer, null);
  assert.equal(body.proof, null);
  assert.ok(!JSON.stringify(body).includes(TX));
});

test('settlement success without tx is unconfirmed, never a paid success', async () => {
  const { gate } = fakeGate({ settle: async () => ({ success: true, network: 'hedera:testnet' }) });
  const app = createApp({ config: config(), gate, createFanPayer: async () => { throw new Error('unused'); }, fetchImpl: async () => validZeroG() });
  const response = await paidPost(app);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error, 'SETTLEMENT_UNCONFIRMED');
  assert.equal(body.settled, null);
  assert.equal(body.reconciliationRequired, true);
  assert.equal(body.answer, null);
  assert.equal(body.proof, null);
});

test('settlement success without an explicit network is unconfirmed', async () => {
  const { gate } = fakeGate({ settle: async () => ({ success: true, txId: TX }) });
  const app = createApp({ config: config(), gate, createFanPayer: async () => { throw new Error('unused'); }, fetchImpl: async () => validZeroG() });
  const response = await paidPost(app);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error, 'SETTLEMENT_UNCONFIRMED');
  assert.equal(body.settled, null);
  assert.equal(body.answer, null);
  assert.equal(body.proof, null);
});

test('settlement transport ambiguity is unconfirmed and carries no paid proof', async () => {
  const { gate } = fakeGate({ settle: async () => { throw new Error('mock transport lost'); } });
  const app = createApp({ config: config(), gate, createFanPayer: async () => { throw new Error('unused'); }, fetchImpl: async () => validZeroG() });
  const response = await paidPost(app);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error, 'SETTLEMENT_UNCONFIRMED');
  assert.equal(body.settled, null);
  assert.equal(body.answer, null);
  assert.equal(body.proof, null);
});

test('CORS is exact-origin only and preflight exposes verification headers', async () => {
  const { app, calls } = fixture();
  const preflight = await app(new Request('https://worker.test/ask', {
    method: 'OPTIONS', headers: { origin: 'https://artist.opensourceorchestra.org' },
  }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://artist.opensourceorchestra.org');
  const exposedHeaders = preflight.headers.get('access-control-expose-headers');
  assert.ok(exposedHeaders);
  assert.match(exposedHeaders, /ZG-Res-Key/);
  const rejected = await app(new Request('https://worker.test/ask', {
    method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{"question":"hi"}',
  }));
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get('access-control-allow-origin'), null);
  assert.equal(calls.challenges.length, 0);
});

test('input schema rejects payout/model overrides, bad JSON, and oversized bodies before payment', async () => {
  const { app, calls } = fixture();
  for (const payload of [
    { question: 'hi', payTo: '0.0.6666' },
    { question: 'hi', model: 'other' },
    { question: 'hi', artist: { bio: 'private' } },
  ]) {
    const response = await app(new Request('https://worker.test/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'UNSUPPORTED_FIELDS');
  }
  const oversized = await app(new Request('https://worker.test/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'x'.repeat(3000) }) }));
  assert.equal(oversized.status, 413);
  const wrongType = await app(new Request('https://worker.test/ask', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hello' }));
  assert.equal(wrongType.status, 415);
  assert.equal(calls.challenges.length, 0);
});

test('/demo performs the 402-sign-retry loop through the dedicated autonomous fan payer', async () => {
  const { gate, calls } = fakeGate();
  let app: (request: Request) => Promise<Response>;
  let payerCalls = 0;
  let factoryCalls = 0;
  const payer: Payer = {
    kind: 'hedera', accountId: '0.0.1002',
    async fetch(url, init) {
      payerCalls += 1;
      const first = await app(new Request(url, init));
      assert.equal(first.status, 402);
      const challenge = await first.json();
      assert.equal(challenge.accepts[0].extra.feePayer, '0.0.9999');
      const headers = new Headers(init?.headers);
      headers.set('x-payment', 'signed-by-dedicated-fan');
      return app(new Request(url, { ...init, headers }));
    },
  };
  app = createApp({
    config: config(), gate,
    createFanPayer: async () => { factoryCalls += 1; return payer; },
    fetchImpl: async () => validZeroG(),
  });
  const response = await app(new Request('https://worker.test/demo', {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.10' }, body: '{"question":"Name one song"}',
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-demo-runner'), 'autonomous-fan');
  assert.equal(factoryCalls, 1);
  assert.equal(payerCalls, 1);
  assert.equal(calls.challenges.length, 2);
  assert.equal(calls.settles.length, 1);
  assert.ok(calls.challenges.every((call) => call.input.payTo === '0.0.1001'));
  assert.strictEqual(calls.settles[0].requirements, calls.challenges[1].requirements);
  const body = await response.json();
  assert.equal(body.proof.payer, '0.0.1002');
  assert.equal(body.proof.payTo, '0.0.1001');
});

test('/demo transport ambiguity stays non-200 and does not invent settled=false', async () => {
  const payer: Payer = { kind: 'hedera', accountId: '0.0.1002', fetch: async () => { throw new Error('lost after retry'); } };
  const { app } = fixture({ createFanPayer: async () => payer });
  const response = await app(new Request('https://worker.test/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"question":"hi"}' }));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error, 'DEMO_RESULT_UNCONFIRMED');
  assert.equal(body.settled, null);
  assert.equal(body.proof, null);
});

test('/demo strict per-IP limit blocks a second request before payer invocation', async () => {
  let factoryCalls = 0;
  const payer: Payer = { kind: 'hedera', accountId: '0.0.1002', fetch: async () => jsonMockFailure() };
  const { app } = fixture({ config: { ipLimitPerMinute: 1 }, createFanPayer: async () => { factoryCalls += 1; return payer; } });
  const make = () => new Request('https://worker.test/demo', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.20' }, body: '{"question":"hi"}' });
  const first = await app(make());
  assert.equal(first.status, 500); // deliberately non-protocol mock response is passed through honestly
  const second = await app(make());
  assert.equal(second.status, 429);
  assert.equal(factoryCalls, 1);
});

function jsonMockFailure() {
  return new Response('{"ok":false}', { status: 500, headers: { 'content-type': 'application/json' } });
}

test('body id is the documented verification fallback when ZG-Res-Key is absent', async () => {
  const { app } = fixture({ fetchImpl: async () => validZeroG({ zgResKey: null, teeVerified: null }) });
  const response = await paidPost(app);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('ZG-Res-Key'), null);
  const body = await response.json();
  assert.equal(body.proof.upstream.zgResKey, null);
  assert.equal(body.proof.upstream.verificationChatId, 'chatcmpl-body-fallback');
  assert.equal(body.proof.upstream.routerReportedTeeVerified, null);
  assert.equal(body.proof.upstream.independentlyVerified, false);
});

test('0G request/provider headers are retained when trace fields are absent', async () => {
  const { app } = fixture({ fetchImpl: async () => validZeroG({
    requestId: null,
    provider: null,
    headerRequestId: '0g-header-request',
    headerProvider: '0x0000000000000000000000000000000000000def',
  }) });
  const response = await paidPost(app);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-0g-request-id'), '0g-header-request');
  const body = await response.json();
  assert.equal(body.proof.upstream.requestId, '0g-header-request');
  assert.equal(body.proof.upstream.providerAddress, '0x0000000000000000000000000000000000000def');
});

test('concurrent and sequential payment replays never repeat 0G compute', async () => {
  let upstreamCalls = 0;
  let releaseUpstream!: () => void;
  const wait = new Promise<void>((resolve) => { releaseUpstream = resolve; });
  const { gate, calls } = fakeGate();
  const app = createApp({ config: config(), gate, createFanPayer: async () => { throw new Error('unused'); }, fetchImpl: async () => {
    upstreamCalls += 1;
    await wait;
    return validZeroG();
  } });
  const first = paidPost(app);
  while (!upstreamCalls) await new Promise((resolve) => setImmediate(resolve));
  const concurrent = await paidPost(app);
  assert.equal(concurrent.status, 409);
  assert.equal((await concurrent.json()).error, 'PAYMENT_REPLAY_REJECTED');
  releaseUpstream();
  assert.equal((await first).status, 200);
  const sequential = await paidPost(app);
  assert.equal(sequential.status, 409);
  assert.equal(upstreamCalls, 1);
  assert.equal(calls.settles.length, 1);
});

test('non-boolean facilitator verification and settlement statuses fail closed', async () => {
  const invalidVerify = fakeGate({ verify: async () => ({ ok: 'false' } as any) });
  let upstreamCalls = 0;
  const verifyApp = createApp({ config: config(), gate: invalidVerify.gate, createFanPayer: async () => { throw new Error('unused'); }, fetchImpl: async () => { upstreamCalls += 1; return validZeroG(); } });
  const verifyResponse = await paidPost(verifyApp);
  assert.equal(verifyResponse.status, 502);
  assert.equal(upstreamCalls, 0);
  assert.equal(invalidVerify.calls.settles.length, 0);

  const invalidSettle = fakeGate({ settle: async () => ({ success: 'false', txId: TX, network: 'hedera:testnet' } as any) });
  const settleApp = createApp({ config: config(), gate: invalidSettle.gate, createFanPayer: async () => { throw new Error('unused'); }, fetchImpl: async () => validZeroG() });
  const settleResponse = await paidPost(settleApp);
  assert.equal(settleResponse.status, 502);
  const body = await settleResponse.json();
  assert.equal(body.error, 'SETTLEMENT_UNCONFIRMED');
  assert.equal(body.settled, null);
  assert.equal(body.answer, null);
  assert.equal(body.proof, null);
});

test('missing finish_reason is degraded and missing actual model remains null', async () => {
  const missingFinish = fixture({ fetchImpl: async () => validZeroG({ finishReason: null }) });
  const rejected = await paidPost(missingFinish.app);
  assert.equal(rejected.status, 422);
  assert.equal(missingFinish.calls.settles.length, 0);

  const missingModel = fixture({ fetchImpl: async () => validZeroG({ model: null }) });
  const accepted = await paidPost(missingModel.app);
  assert.equal(accepted.status, 200);
  const body = await accepted.json();
  assert.equal(body.proof.upstream.model, null);
  assert.equal(body.proof.upstream.requestedModel, 'explicit-test-model');
});

test('health describes only the narrow slice and explicitly denies a durable global ledger', async () => {
  const { app } = fixture();
  const response = await app(new Request('https://worker.test/health'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.routes, ['POST /ask', 'POST /demo', 'GET /health']);
  assert.equal(body.upstream.baseUrl, 'https://0g.test/v1');
  assert.equal(body.upstream.model, 'explicit-test-model');
  assert.equal(body.upstream.independentVerificationPerformed, false);
  assert.equal(body.demoLimits.durableGlobalLedger, false);
  assert.ok(!JSON.stringify(body).includes('privateKey'));
});
