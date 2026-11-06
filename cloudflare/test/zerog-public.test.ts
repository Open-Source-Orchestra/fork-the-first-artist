import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/zerog-public.ts';

const env = { UPSTREAM_API_KEY: 'test-only', UPSTREAM_MODEL: 'test-model', UPSTREAM_BASE_URL: 'https://router-api.0g.ai/v1' };
// Tests call the two-argument Worker handler directly.

function successPayload() {
  return {
    id: 'chatcmpl-test',
    model: 'test-model',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Demo Artist performs Demo Song.' } }],
    usage: { prompt_tokens: 20, completion_tokens: 10 },
    x_0g_trace: { request_id: 'req-real', provider: '0xprovider', tee_verified: null, billing: { total_cost_usd_micro: '102' } },
  };
}

test('public 0G steward returns real answer/proof without payment or self-funding claims', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'test-model');
    assert.equal(body.messages[1].role, 'user');
    return new Response(JSON.stringify(successPayload()), { status: 200, headers: { 'ZG-Res-Key': 'verify-chat' } });
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://artist.opensourceorchestra.org', 'cf-connecting-ip': '203.0.113.1' },
      body: JSON.stringify({ instruction: 'What song does Demo Artist perform?' }),
    }), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reply.text, 'Demo Artist performs Demo Song.');
    assert.equal(body.charged, false);
    assert.equal(body.proof.requestId, 'req-real');
    assert.equal(body.proof.zgResKey, 'verify-chat');
    assert.equal(body.proof.billingMicro, '102');
    assert.equal(body.proof.independentlyVerified, false);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://artist.opensourceorchestra.org');
  } finally { globalThis.fetch = original; }
});

test('public 0G steward rejects override, bad origin, and does not fake upstream failure', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'no balance' }), { status: 402 });
  try {
    const response = await worker.fetch(new Request('https://worker.example/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example', 'cf-connecting-ip': '203.0.113.2' },
      body: JSON.stringify({ instruction: 'hello', model: 'caller-override' }),
    }), env);
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error.code, 'ZERO_G_UNAVAILABLE');
    assert.equal(body.error.charged, false);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  } finally { globalThis.fetch = original; }
});

test('public 0G health is honest and input validation happens before upstream', async () => {
  const health = await worker.fetch(new Request('https://worker.example/health'), env);
  assert.equal(health.status, 200);
  const body = await health.json();
  assert.equal(body.provider, '0g');
  assert.equal(body.payment, false);
  assert.equal(body.selfFunding, false);
  const bad = await worker.fetch(new Request('https://worker.example/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), env);
  assert.equal(bad.status, 400);
});
