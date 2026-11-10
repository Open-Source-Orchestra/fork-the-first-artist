import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, loadDotEnv, assetSymbol, formatAsset, HBAR_ASSET_ID } from '../src/config.ts';
import { splitAtomic, describeSplit } from '../src/split.ts';
import { askPayTo } from '../src/paywall.ts';

const KEYS = [
  'HEDERA_ASSET',
  'HEDERA_ASSET_DECIMALS',
  'HEDERA_ASSET_SYMBOL',
  'PRICE_ASK',
  'PRICE_METER',
  'PRICE_ASK_USDC',
  'PRICE_METER_USDC',
  'PRICE_ASK_HBAR',
  'PRICE_METER_HBAR',
  'BUDGET_TOTAL_USD',
  'BUDGET_HOURLY_USD',
  'BUDGET_MAX_PER_CALL_USD',
  'ASK_PAYEE',
  'PAYMENTS_MODE',
  'HEDERA_ARTIST_ACCOUNT_ID',
  'HEDERA_COMPUTE_ACCOUNT_ID',
  'HEDERA_METER_ACCOUNT_ID',
  'UPSTREAM_API_KEY',
  'HCS_SPEND_TOPIC_ID',
] as const;

function withEnv(vars: Partial<Record<(typeof KEYS)[number], string>>, fn: () => void): void {
  const previous = new Map(KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(vars)) process.env[k] = v;
    fn();
  } finally {
    for (const k of KEYS) {
      const v = previous.get(k);
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('hbar: asset 0.0.0 defaults to 8 decimals, HBAR labels and HBAR-sized prices', () => {
  withEnv({ HEDERA_ASSET: HBAR_ASSET_ID }, () => {
    const cfg = loadConfig();
    assert.deepEqual(cfg.asset, { id: '0.0.0', decimals: 8, symbol: 'HBAR' });
    assert.equal(cfg.prices.askAtomic, 100_000_000n); // 1 HBAR in tinybars
    assert.equal(cfg.prices.meterAtomic, 1_000_000n); // 0.01 HBAR
    // budgets are in asset units; the default per-call cap must admit one meter call
    assert.ok(cfg.budget.maxPerCallUsd >= 0.01);
    assert.equal(formatAsset(cfg.prices.askAtomic, cfg.asset), '1.00000000 HBAR');
  });
});

test('hbar: asset-neutral and symbol-specific prices; stale USDC prices are ignored for HBAR', () => {
  withEnv({ HEDERA_ASSET: '0.0.0', PRICE_ASK_USDC: '0.10', PRICE_METER_HBAR: '0.02' }, () => {
    const cfg = loadConfig();
    assert.equal(cfg.prices.askAtomic, 100_000_000n, 'PRICE_ASK_USDC must not price an HBAR ask');
    assert.equal(cfg.prices.meterAtomic, 2_000_000n);
  });
  withEnv({ HEDERA_ASSET: '0.0.0', PRICE_ASK: '0.5', PRICE_METER: '0.00000001' }, () => {
    const cfg = loadConfig();
    assert.equal(cfg.prices.askAtomic, 50_000_000n);
    assert.equal(cfg.prices.meterAtomic, 1n); // one tinybar, exact
  });
});

test('hbar: refuses a wrong decimals value and sub-tinybar prices', () => {
  withEnv({ HEDERA_ASSET: '0.0.0', HEDERA_ASSET_DECIMALS: '6' }, () => {
    assert.throws(() => loadConfig(), /8 decimals/);
  });
  withEnv({ HEDERA_ASSET: '0.0.0', PRICE_ASK: '0.000000001' }, () => {
    assert.throws(() => loadConfig(), /more than 8 decimals/);
  });
});

test('hbar: USDC stays the default and keeps its legacy PRICE_*_USDC names', () => {
  withEnv({ PRICE_ASK_USDC: '0.25' }, () => {
    const cfg = loadConfig();
    assert.deepEqual(cfg.asset, { id: '0.0.429274', decimals: 6, symbol: 'USDC' });
    assert.equal(cfg.prices.askAtomic, 250_000n);
    assert.equal(cfg.prices.meterAtomic, 2_000n);
  });
  assert.equal(assetSymbol('0.0.999'), 'TOKEN');
  assert.equal(assetSymbol('0.0.999', 'tip'), 'TIP');
});

test('hbar: split labels follow the asset', () => {
  const s = splitAtomic(100_000_000n, { artist: 9631, agent: 369 });
  assert.equal(s.artist, 96_310_000n);
  assert.equal(s.agent, 3_690_000n);
  assert.equal(
    describeSplit(s, 8, 'HBAR'),
    '1.00000000 HBAR -> 0.96310000 HBAR artist / 0.03690000 HBAR agent',
  );
});

test('hbar: the shipped .env.hbar.example parses into a valid HBAR config', () => {
  withEnv({}, () => {
    loadDotEnv(new URL('../.env.hbar.example', import.meta.url).pathname);
    const cfg = loadConfig({ mode: 'dev' });
    assert.equal(cfg.asset.symbol, 'HBAR');
    assert.equal(cfg.asset.decimals, 8);
    assert.equal(cfg.prices.askAtomic, 100_000_000n);
    assert.equal(cfg.prices.meterAtomic, 1_000_000n);
    assert.equal(cfg.askPayee, 'steward');
    assert.ok(cfg.budget.maxPerCallUsd >= Number(cfg.prices.meterAtomic) / 1e8);
  });
});

test('ask payee: artist by default; steward mode pays the steward compute account', () => {
  withEnv({}, () => {
    const cfg = loadConfig();
    assert.equal(cfg.askPayee, 'artist');
    assert.equal(askPayTo(cfg), cfg.accounts.artist);
  });
  withEnv({ ASK_PAYEE: 'steward' }, () => {
    const cfg = loadConfig();
    assert.equal(askPayTo(cfg), cfg.accounts.compute);
  });
  withEnv({ ASK_PAYEE: 'oso' }, () => {
    assert.throws(() => loadConfig(), /ASK_PAYEE/);
  });
});

test('live: artist and steward compute account must differ (no self-forward)', () => {
  withEnv(
    {
      PAYMENTS_MODE: 'live',
      HEDERA_ARTIST_ACCOUNT_ID: '0.0.2222',
      HEDERA_COMPUTE_ACCOUNT_ID: '0.0.2222',
      HEDERA_METER_ACCOUNT_ID: '0.0.3333',
      UPSTREAM_API_KEY: 'test-only',
    },
    () => assert.throws(() => loadConfig(), /must differ from HEDERA_COMPUTE_ACCOUNT_ID/),
  );
});
