/**
 * HBAR (`0.0.0`) on the x402 payer, exercised with the REAL @x402/hedera client
 * against a local 402 server. Signing is offline (freezeWith only needs the
 * static testnet node list); nothing is submitted to Hedera.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createPayer, spendControlsFor } from '../src/rails/payer.ts';
import { createFanPayer } from '../src/rails/fan-payer.ts';

test('spend controls: USDC keeps the SDK USD cap; HBAR gets an exact tinybar cap', () => {
  assert.deepEqual(spendControlsFor({ network: 'hedera:testnet', asset: '0.0.429274' }), {
    maxAmountPerPayment: '$1',
  });
  assert.deepEqual(spendControlsFor({ network: 'hedera:testnet' }), { maxAmountPerPayment: '$1' });
  assert.deepEqual(spendControlsFor({ network: 'hedera:testnet', asset: '0.0.0' }), {
    maxAmountPerPayment: '$1',
    allowedAssets: [{ network: 'hedera:testnet', asset: '0.0.0', maxAmountPerPayment: '200000000' }],
  });
  assert.equal(
    spendControlsFor({ network: 'hedera:testnet', asset: '0.0.0', maxPerPaymentAsset: '0.05' })
      .allowedAssets?.[0]?.maxAmountPerPayment,
    '5000000',
  );
  assert.throws(() => spendControlsFor({ network: 'hedera:testnet', asset: '0.0.0', assetDecimals: 6 }), /8 decimals/);
  assert.throws(
    () => spendControlsFor({ network: 'hedera:testnet', asset: '0.0.0', maxPerPaymentAsset: '0.000000001' }),
    /more than 8 decimals/,
  );
  assert.throws(() => spendControlsFor({ network: 'hedera:testnet', asset: '0.0.0', maxPerPaymentAsset: '0' }), /greater than zero/);
  assert.throws(() => spendControlsFor({ network: 'hedera:testnet', asset: '0.0.777' }), /HEDERA_ASSET_DECIMALS/);
});

test('fan payer forwards the HBAR asset and per-payment cap from env', async () => {
  const seen: unknown[] = [];
  await createFanPayer(
    {
      mode: 'live',
      env: {
        HEDERA_FAN_ACCOUNT_ID: '0.0.7777',
        HEDERA_FAN_PRIVATE_KEY: 'fan-key',
        HEDERA_ASSET: '0.0.0',
        HEDERA_ASSET_DECIMALS: '8',
        HEDERA_FAN_MAX_PER_PAYMENT: '1.5',
      },
    },
    async (opts) => {
      seen.push(opts);
      return { kind: 'hedera', accountId: opts.accountId, fetch: async () => new Response() };
    },
  );
  assert.deepEqual(seen[0], {
    accountId: '0.0.7777',
    privateKey: 'fan-key',
    network: 'hedera:testnet',
    allowMock: false,
    asset: '0.0.0',
    assetDecimals: 8,
    maxPerPaymentAsset: '1.5',
  });
});

/** A one-resource x402 server: 402 with the given requirement, then 200 echoing X-PAYMENT. */
async function x402Server(amount: string, asset = '0.0.0') {
  let paidHeader: string | undefined;
  const server = createServer((req, res) => {
    const header = req.headers['x-payment'];
    if (typeof header === 'string') {
      paidHeader = header;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    res.writeHead(402, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        x402Version: 2,
        accepts: [
          {
            scheme: 'exact',
            network: 'hedera:testnet',
            amount,
            asset,
            payTo: '0.0.5005',
            resource: 'http://local/ask',
            description: 'test',
            maxTimeoutSeconds: 180,
            extra: { feePayer: '0.0.9185802' },
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ask`;
  return { url, paid: () => paidHeader, close: () => new Promise<void>((r) => server.close(() => r())) };
}

async function sdk() {
  try {
    return await import('@hiero-ledger/sdk');
  } catch {
    return null;
  }
}

test('real x402 client signs a native-HBAR TransferTransaction for exactly the quoted tinybars', async (t) => {
  const hiero = await sdk();
  if (!hiero) return t.skip('@hiero-ledger/sdk not installed');
  const key = hiero.PrivateKey.generateECDSA();
  const srv = await x402Server('100000000'); // 1 HBAR
  try {
    const payer = await createPayer({
      accountId: '0.0.4004',
      privateKey: key.toStringRaw(),
      network: 'hedera:testnet',
      asset: '0.0.0',
      allowMock: false,
    });
    assert.equal(payer.kind, 'hedera');
    const res = await payer.fetch(srv.url, { method: 'POST' });
    assert.equal(res.status, 200);

    const payload = JSON.parse(Buffer.from(srv.paid()!, 'base64').toString('utf8')) as {
      payload: { transaction: string };
      accepted?: { asset: string; amount: string };
    };
    const tx = hiero.Transaction.fromBytes(Buffer.from(payload.payload.transaction, 'base64'));
    assert.ok(tx instanceof hiero.TransferTransaction);
    const transfers = new Map<string, string>();
    for (const [account, hbar] of (tx as InstanceType<typeof hiero.TransferTransaction>).hbarTransfers) {
      transfers.set(account.toString(), hbar.toTinybars().toString());
    }
    assert.deepEqual(Object.fromEntries(transfers), { '0.0.4004': '-100000000', '0.0.5005': '100000000' });
    assert.equal(tx.transactionId?.accountId?.toString(), '0.0.9185802', 'facilitator pays the fee');
    assert.equal((tx as InstanceType<typeof hiero.TransferTransaction>).tokenTransfers.size, 0, 'no token, no association');
  } finally {
    await srv.close();
  }
});

test('real x402 client refuses an HBAR quote above the per-payment cap', async (t) => {
  const hiero = await sdk();
  if (!hiero) return t.skip('@hiero-ledger/sdk not installed');
  const srv = await x402Server('300000000'); // 3 HBAR > default 2 HBAR cap
  try {
    const payer = await createPayer({
      accountId: '0.0.4004',
      privateKey: hiero.PrivateKey.generateECDSA().toStringRaw(),
      asset: '0.0.0',
      allowMock: false,
    });
    await assert.rejects(payer.fetch(srv.url, { method: 'POST' }), /maxAmountPerPayment/);
    assert.equal(srv.paid(), undefined, 'nothing was signed or sent');
  } finally {
    await srv.close();
  }
});

test('without the HBAR allowlist entry the SDK refuses HBAR (why spendControlsFor exists)', async (t) => {
  const hiero = await sdk();
  if (!hiero) return t.skip('@hiero-ledger/sdk not installed');
  const srv = await x402Server('1000000');
  const prev = process.env.HEDERA_ASSET;
  try {
    delete process.env.HEDERA_ASSET;
    const payer = await createPayer({
      accountId: '0.0.4004',
      privateKey: hiero.PrivateKey.generateECDSA().toStringRaw(),
      asset: '0.0.429274',
      allowMock: false,
    });
    await assert.rejects(payer.fetch(srv.url, { method: 'POST' }), /spendControls/);
  } finally {
    if (prev === undefined) delete process.env.HEDERA_ASSET;
    else process.env.HEDERA_ASSET = prev;
    await srv.close();
  }
});

test('0G provider config disables hidden thinking (0gm-1.0-35b-a3b would return empty content)', async () => {
  const { loadAgentConfig } = await import('../src/config.ts');
  const cfg = loadAgentConfig(new URL('../config/providers.example.json', import.meta.url).pathname);
  const zeroG = cfg.providers['0g'] as { extensions?: Record<string, unknown> };
  assert.deepEqual(zeroG.extensions?.chat_template_kwargs, { enable_thinking: false });
  assert.equal(zeroG.extensions?.verify_tee, true);
});
