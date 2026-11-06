import test from 'node:test';
import assert from 'node:assert/strict';
import { createFanPayer } from '../src/rails/fan-payer.ts';
import { createPayer, type Payer, type PayerOptions } from '../src/rails/payer.ts';

const payerOfKind = (kind: Payer['kind']): Payer => ({
  kind,
  accountId: '0.0.7777',
  fetch: async () => {
    throw new Error('selection tests must not make network calls');
  },
});

test('demo fan payer: dev explicitly uses mock and never inherits the compute key', async () => {
  const calls: PayerOptions[] = [];
  const payer = await createFanPayer(
    {
      mode: 'dev',
      env: {
        HEDERA_FAN_ACCOUNT_ID: '0.0.7777',
        HEDERA_AGENT_ACCOUNT_ID: '0.0.8888',
        HEDERA_AGENT_PRIVATE_KEY: 'compute-key-must-not-be-reused',
      },
    },
    async (opts) => {
      calls.push(opts);
      return payerOfKind('mock');
    },
  );
  assert.equal(payer.kind, 'mock');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.accountId, '0.0.7777');
  assert.equal(calls[0]!.privateKey, '');
  assert.equal(calls[0]!.allowMock, true);
});

test('demo fan payer: live uses only the distinct fan account and private key', async () => {
  const calls: PayerOptions[] = [];
  const payer = await createFanPayer(
    {
      mode: 'live',
      env: {
        HEDERA_FAN_ACCOUNT_ID: '0.0.7777',
        HEDERA_FAN_PRIVATE_KEY: 'fan-private-key',
        HEDERA_AGENT_ACCOUNT_ID: '0.0.8888',
        HEDERA_AGENT_PRIVATE_KEY: 'agent-compute-key',
        HEDERA_NETWORK: 'hedera:testnet',
      },
    },
    async (opts) => {
      calls.push(opts);
      return payerOfKind('hedera');
    },
  );
  assert.equal(payer.kind, 'hedera');
  assert.deepEqual(calls, [
    {
      accountId: '0.0.7777',
      privateKey: 'fan-private-key',
      network: 'hedera:testnet',
      allowMock: false,
    },
  ]);
});

test('demo fan payer: live refuses missing fan credentials even when compute credentials exist', async () => {
  let factoryCalls = 0;
  const factory = async (): Promise<Payer> => {
    factoryCalls++;
    return payerOfKind('mock');
  };
  for (const env of [
    { HEDERA_AGENT_ACCOUNT_ID: '0.0.8888', HEDERA_AGENT_PRIVATE_KEY: 'agent-key' },
    {
      HEDERA_FAN_ACCOUNT_ID: '0.0.7777',
      HEDERA_AGENT_ACCOUNT_ID: '0.0.8888',
      HEDERA_AGENT_PRIVATE_KEY: 'agent-key',
    },
    { HEDERA_FAN_PRIVATE_KEY: 'fan-key', HEDERA_AGENT_ACCOUNT_ID: '0.0.8888' },
  ]) {
    await assert.rejects(createFanPayer({ mode: 'live', env }, factory), /HEDERA_FAN_(ACCOUNT_ID|PRIVATE_KEY)/);
  }
  assert.equal(factoryCalls, 0, 'validation fails before constructing any payer');
});

test('demo fan payer: live rejects a mock result and unknown modes fail closed', async () => {
  await assert.rejects(
    createFanPayer(
      {
        mode: 'live',
        env: { HEDERA_FAN_ACCOUNT_ID: '0.0.7777', HEDERA_FAN_PRIVATE_KEY: 'fan-key' },
      },
      async () => payerOfKind('mock'),
    ),
    /payer is not configured for Hedera settlement/,
  );
  await assert.rejects(createFanPayer({ mode: 'DEV' }), /mode must be dev or live/);
});

test('payer: disabling mock fails before any SDK import, network, or settlement', async () => {
  await assert.rejects(
    createPayer({ accountId: '0.0.7777', privateKey: '', allowMock: false }),
    /mock payment is disabled/,
  );
});
