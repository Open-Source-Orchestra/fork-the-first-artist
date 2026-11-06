import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, loadDotEnv, type Config } from '../src/config.ts';

test('config: the shipped .env.example parses with exact atomic prices', () => {
  const keys = ['PRICE_ASK_USDC', 'PRICE_METER_USDC'] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    loadDotEnv(new URL('../.env.example', import.meta.url).pathname);
    assert.equal(process.env.PRICE_ASK_USDC, '0.10');
    assert.equal(process.env.PRICE_METER_USDC, '0.002');
    const cfg = loadConfig();
    assert.equal(cfg.prices.askAtomic, 100_000n);
    assert.equal(cfg.prices.meterAtomic, 2_000n);
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

const liveBase = (): Partial<Config> => ({
  mode: 'live',
  accounts: { artist: '0.0.1111', compute: '0.0.2222', meter: '0.0.3333' },
  agentPrivateKey: undefined,
  hcsSpendTopicId: undefined,
  upstream: {
    baseUrl: 'http://upstream.invalid',
    apiKey: 'test-only',
    model: 'test-model',
    trustMode: 'verified',
  },
});

test('config: live mode requires a real upstream credential before accepting requests', () => {
  const overrides = liveBase();
  assert.throws(
    () =>
      loadConfig({
        ...overrides,
        upstream: { ...overrides.upstream!, apiKey: undefined },
      }),
    /UPSTREAM_API_KEY/,
  );
  assert.doesNotThrow(() => loadConfig(overrides));
});

test('config: HCS is optional, but an enabled topic requires its signing key', () => {
  assert.doesNotThrow(() => loadConfig(liveBase()), 'base live settlement does not require HCS');
  assert.throws(
    () => loadConfig({ ...liveBase(), hcsSpendTopicId: '0.0.3333' }),
    /HCS_SPEND_TOPIC_ID requires HEDERA_AGENT_PRIVATE_KEY/,
  );
  assert.doesNotThrow(() =>
    loadConfig({
      ...liveBase(),
      hcsSpendTopicId: '0.0.3333',
      agentPrivateKey: 'test-only',
    }),
  );
});

test('config: live meter recipient is required and cannot be the compute payer', () => {
  const overrides = liveBase();
  assert.throws(
    () =>
      loadConfig({
        ...overrides,
        accounts: { artist: '0.0.1111', compute: '0.0.2222', meter: '0.0.2222' },
      }),
    /must differ.*no self-payment/,
  );
  assert.throws(
    () =>
      loadConfig({
        ...overrides,
        accounts: { artist: '0.0.1111', compute: '0.0.2222', meter: '' },
      }),
    /HEDERA_METER_ACCOUNT_ID/,
  );
});
