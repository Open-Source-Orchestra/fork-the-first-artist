import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig, type Env } from '../src/config.ts';
import { DemoLimiter } from '../src/limiter.ts';

const validEnv: Env = {
  HEDERA_ARTIST_ACCOUNT_ID: '0.0.1001',
  HEDERA_FAN_ACCOUNT_ID: '0.0.1002',
  HEDERA_FAN_PRIVATE_KEY: 'dummy-test-only',
  UPSTREAM_API_KEY: 'dummy-test-only',
  UPSTREAM_MODEL: 'explicit-model',
};

test('config requires an explicit model, distinct fan, testnet, tiny price, and bounded output', () => {
  const cfg = loadConfig(validEnv);
  assert.equal(cfg.upstreamBaseUrl, 'https://router-api-testnet.integratenetwork.work/v1');
  assert.equal(cfg.upstreamModel, 'explicit-model');
  assert.equal(cfg.priceAtomic, 1000n);
  assert.equal(cfg.maxOutputTokens, 160);
  assert.throws(() => loadConfig({ ...validEnv, UPSTREAM_MODEL: undefined }), /UPSTREAM_MODEL/);
  assert.throws(() => loadConfig({ ...validEnv, HEDERA_FAN_ACCOUNT_ID: '0.0.1001' }), /different/);
  assert.throws(() => loadConfig({ ...validEnv, HEDERA_NETWORK: 'hedera:mainnet' }), /testnet/);
  assert.throws(() => loadConfig({ ...validEnv, DEMO_PRICE_ATOMIC: '10001' }), /between/);
  assert.throws(() => loadConfig({ ...validEnv, DEMO_MAX_OUTPUT_TOKENS: '161' }), /integer/);
  assert.throws(() => loadConfig({ ...validEnv, UPSTREAM_BASE_URL: 'http://insecure.test/v1' }), /HTTPS/);
});

test('global demo limit applies across source IPs', () => {
  const limiter = new DemoLimiter({ ip: 2, global: 1, inflight: 2 }, () => 1_000);
  const first = limiter.acquire('203.0.113.1');
  assert.equal(first.ok, true);
  if (first.ok) first.release();
  const second = limiter.acquire('203.0.113.2');
  assert.equal(second.ok, false);
});

test('in-flight cap releases correctly and fixed windows reset', () => {
  let now = 1_000;
  const limiter = new DemoLimiter({ ip: 1, global: 1, inflight: 1 }, () => now);
  const first = limiter.acquire('203.0.113.1');
  assert.equal(first.ok, true);
  assert.equal(limiter.acquire('203.0.113.1').ok, false);
  if (first.ok) first.release();
  assert.equal(limiter.acquire('203.0.113.1').ok, false); // still counts toward this minute
  now += 60_001;
  const nextWindow = limiter.acquire('203.0.113.1');
  assert.equal(nextWindow.ok, true);
  if (nextWindow.ok) {
    nextWindow.release();
    nextWindow.release(); // idempotent: cannot drive concurrency negative
  }
  now += 60_001;
  assert.equal(limiter.acquire('203.0.113.1').ok, true);
});

test('rotating-IP rejections remain bounded and pruned', () => {
  const limiter = new DemoLimiter({ ip: 1, global: 1, inflight: 1 }, () => 1_000);
  const first = limiter.acquire('203.0.113.1');
  if (first.ok) first.release();
  for (let i = 0; i < 2_000; i += 1) {
    assert.equal(limiter.acquire(`198.51.100.${i}`).ok, false);
  }
  assert.ok((limiter as any).buckets.size <= 1_500);
});
