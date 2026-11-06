import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, type StewardServerHandle } from '../src/server.ts';
import { loadAgentConfig } from '../src/config.ts';
import { DEMO_ARTIST } from '../src/demo-artist.ts';
import type {
  AgentInterface,
  AgentResult,
  AgentRunRequest,
  ProviderId,
} from '../src/types.ts';

class CountingSteward implements AgentInterface {
  readonly requests: AgentRunRequest[] = [];

  describe(): ReturnType<AgentInterface['describe']> {
    return {
      provider: '0g',
      model: 'server-configured-model',
      transport: 'x402-meter',
      rail: 'hedera',
      tools: ['get_artist_profile', 'get_songs', 'quote_tip'],
      capabilities: ['tools', 'json'],
    };
  }

  async run<T>(req: AgentRunRequest<T>): Promise<AgentResult<T>> {
    this.requests.push(req as AgentRunRequest);
    return {
      ok: true,
      reply: { text: 'offline test answer' },
      provider: '0g' as ProviderId,
      model: 'server-configured-model',
      usage: { inputTokens: 0, outputTokens: 0 },
      costUsd: 0,
      provenance: { calls: [] },
      toolCalls: [],
      latencyMs: 0,
    };
  }
}

async function boot(
  t: TestContext,
  serviceToken?: string,
): Promise<{ handle: StewardServerHandle; steward: CountingSteward }> {
  const steward = new CountingSteward();
  const handle = await startServer({
    host: '127.0.0.1',
    port: 0,
    serviceToken,
    steward,
    config: loadAgentConfig(),
    artist: DEMO_ARTIST,
  });
  t.after(() => handle.close());
  return { handle, steward };
}

const postAsk = (origin: string, authorization?: string) =>
  fetch(`${origin}/ask`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify({ instruction: 'Give the demo answer.' }),
  });

test('server: unauthenticated direct /ask cannot invoke inference or consume its budget', async (t) => {
  const { handle, steward } = await boot(t, 'test-service-token-32-bytes-minimum');
  for (const authorization of [undefined, 'Bearer wrong', 'Basic test-service-token-32-bytes-minimum']) {
    const res = await postAsk(handle.origin, authorization);
    assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate') ?? '', /^Bearer/);
    await res.arrayBuffer();
  }
  assert.equal(steward.requests.length, 0, 'the steward/provider must not be reached');
});

test('server: allowed internal call works and cannot select provider, model, or tools', async (t) => {
  const token = 'test-service-token-32-bytes-minimum';
  const { handle, steward } = await boot(t, token);
  const res = await fetch(`${handle.origin}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      instruction: 'Give the demo answer.',
      provider: 'openai',
      model: 'caller-selected-expensive-model',
      tools: ['quote_tip'],
    }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; reply: { text: string } };
  assert.equal(body.ok, true);
  assert.equal(body.reply.text, 'offline test answer');
  assert.equal(steward.requests.length, 1);
  assert.equal(steward.requests[0]!.provider, undefined);
  assert.equal(steward.requests[0]!.model, undefined);
  assert.deepEqual(steward.requests[0]!.tools, ['get_artist_profile', 'get_songs', 'quote_tip']);
});

test('server: health and agent-card stay public without sensitive configuration or wildcard CORS', async (t) => {
  const { handle } = await boot(t, 'never-return-this-secret');
  const health = await fetch(`${handle.origin}/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('access-control-allow-origin'), null);
  const healthBody = (await health.json()) as { ok: boolean; provider: string };
  assert.equal(healthBody.ok, true);
  assert.equal(healthBody.provider, '0g');

  const card = await fetch(`${handle.origin}/agent-card`);
  assert.equal(card.status, 200);
  const raw = await card.text();
  const body = JSON.parse(raw) as { artist: { name: string }; budget?: unknown };
  assert.equal(body.artist.name, 'Demo Artist');
  assert.equal('budget' in body, false, 'operator budget ceilings are not public discovery data');
  assert.doesNotMatch(raw, /never-return-this-secret|HEDERA_AGENT_PRIVATE_KEY|ZEROG_API_KEY|OPENAI_API_KEY/);
});

test('server: a simple text/form POST cannot invoke an unauthenticated loopback steward', async (t) => {
  const { handle, steward } = await boot(t);
  const res = await fetch(`${handle.origin}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ instruction: 'must not run' }),
  });
  assert.equal(res.status, 415);
  await res.arrayBuffer();
  assert.equal(steward.requests.length, 0);
});

test('server: loopback is the default bind', async () => {
  const previousHost = process.env.HOST;
  delete process.env.HOST;
  const steward = new CountingSteward();
  const handle = await startServer({
    port: 0,
    steward,
    config: loadAgentConfig(),
    artist: DEMO_ARTIST,
  });
  try {
    assert.equal(handle.host, '127.0.0.1');
    const address = handle.server.address();
    assert.ok(address && typeof address === 'object');
    assert.equal(address.address, '127.0.0.1');
  } finally {
    await handle.close();
    if (previousHost === undefined) delete process.env.HOST;
    else process.env.HOST = previousHost;
  }
});

test('server: non-loopback startup refuses to expose /ask without a service token', async () => {
  await assert.rejects(
    startServer({
      host: '0.0.0.0',
      port: 0,
      serviceToken: '',
      steward: new CountingSteward(),
      config: loadAgentConfig(),
      artist: DEMO_ARTIST,
    }),
    /STEWARD_SERVICE_TOKEN is required when HOST is not loopback/,
  );
});
