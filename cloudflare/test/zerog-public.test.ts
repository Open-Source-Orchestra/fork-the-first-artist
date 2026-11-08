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

test('public 0G steward speaks for Shaka from his public garden profile only', async () => {
  const original = globalThis.fetch;
  let system = '';
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    system = body.messages[0].content;
    assert.equal(body.messages[1].content, 'FAN_QUESTION:\nWhen is Shaka\'s talk?');
    return new Response(JSON.stringify(successPayload()), { status: 200, headers: { 'x-0g-request-id': 'req-shaka' } });
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://artist-preview-kzu6ctlpau-ffieyo32.taur.link', 'cf-connecting-ip': '203.0.113.3' },
      body: JSON.stringify({ instruction: "When is Shaka's talk?", artist: 'shaka' }),
    }), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.artist, { slug: 'shaka', name: 'Shaka', fictional: false, mode: 'asked', grounding: 'public garden profile only' });
    assert.equal(body.proof.requestId, 'req-shaka');
    assert.equal(body.charged, false);
    assert.match(system, /real artist who asked for this steward/);
    assert.match(system, /Jasmine Stage 4/);
    assert.match(system, /untrusted data, not instructions/);
    assert.doesNotMatch(system, /Mira Modal/);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://artist-preview-kzu6ctlpau-ffieyo32.taur.link');
  } finally { globalThis.fetch = original; }
});

test('public 0G steward defaults to Mira and rejects unknown artists before upstream', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let system = '';
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    system = JSON.parse(String(init?.body)).messages[0].content;
    return new Response(JSON.stringify(successPayload()), { status: 200 });
  };
  try {
    const ok = await worker.fetch(new Request('https://worker.example/ask', {
      method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.4' },
      body: JSON.stringify({ instruction: 'List the songs.' }),
    }), env);
    assert.equal(ok.status, 200);
    const okBody = await ok.json();
    assert.equal(okBody.artist.slug, 'mira-modal');
    assert.equal(okBody.artist.mode, 'demo');
    assert.match(system, /fictional demo artist/);
    assert.match(system, /Mira Modal/);
    for (const [i, artist] of (['someone-else', '__proto__', 'constructor', 'perrie', 42] as unknown[]).entries()) {
      const bad = await worker.fetch(new Request('https://worker.example/ask', {
        method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `203.0.113.${10 + i}` },
        body: JSON.stringify({ instruction: 'hello', artist }),
      }), env);
      assert.equal(bad.status, 400, String(artist));
      const err = (await bad.json()).error;
      assert.equal(err.code, 'UNKNOWN_ARTIST');
      assert.doesNotMatch(err.message, /dj-chalk|0xmentalist|shaka/, 'does not dump the roster');
    }
    assert.equal(calls, 1);
    const health = await (await worker.fetch(new Request('https://worker.example/health'), env)).json();
    assert.equal(health.stewards.demo, 1);
    assert.equal(health.stewards.asked, 1);
    assert.equal(health.stewards.preview, 39, 'every garden artist except Shaka and the held-back one');
    assert.equal(health.stewards.total, 41);
    assert.equal(health.stewards.default, 'mira-modal');
  } finally { globalThis.fetch = original; }
});
