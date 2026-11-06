import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, type Config } from '../src/config.ts';

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
