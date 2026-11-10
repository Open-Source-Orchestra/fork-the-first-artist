import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import axe from 'axe-core';
import { chromium } from 'playwright';
import { createPreviewServer } from '../server.mjs';

// /pay "🔐 pay from my own wallet" with a MOCKED HashPack (a fake WalletConnect SignClient served as
// /hashpack-runtime.mjs) and a stubbed oso-tip-loop Worker. The transaction bodies are REAL SDK bytes
// (test/fixtures/wallet-legs.json), so the page's own decoder check runs for real. The Worker side
// (prepare/settle/idempotency/recovery) is tested in cloudflare/test/wallet-tip.test.ts.
const F = JSON.parse(readFileSync(new URL('../test/fixtures/wallet-legs.json', import.meta.url), 'utf8'));
const { fan, artist, steward, feePayer } = F.accounts;
const W = 'https://oso-tip-loop.shakaverse.workers.dev';
const cors = { 'access-control-allow-origin': '*' };
const HEALTH = {
  ok: true, service: 'oso-tip-loop', network: 'hedera:testnet', limits: { dailyCap: 20, remainingToday: 19, nextRunInSeconds: 0 },
  wallet: {
    testnet: { enabled: true, network: 'hedera:testnet', steward, currencies: [{ currency: 'HBAR', asset: '0.0.0', maxTip: '10' }, { currency: 'USDC', asset: '0.0.429274', maxTip: '10' }] },
    mainnet: { enabled: false, error: 'MAINNET_DISABLED' },
  },
};
const SHAKA = { ok: true, network: 'hedera:testnet', artist: { label: 'shaka', ens: 'shaka.osoartist.eth', payTo: artist, accountId: artist, alias: null, path: 'hbar', resolver: null, source: 'their ENS record addr(3030)' } };
const FAKE_RUNTIME = `
export function createHashPackClient(projectId) {
  if (!/^[0-9a-f]{32}$/.test(projectId)) throw new Error('bad project id');
  window.__wc = { requests: [], requested: null };
  return {
    core: { pairing: { disconnect: async () => {} } },
    on() {},
    async connect(opts) {
      window.__wc.requested = opts;
      return { uri: 'wc:${'c'.repeat(64)}@2?symKey=x', approval: async () => ({ topic: '${'b'.repeat(64)}', expiry: Math.floor(Date.now() / 1000) + 3600, namespaces: { hedera: { methods: ['hedera_signTransaction'], accounts: ['hedera:testnet:${fan}'] } } }) };
    },
    async disconnect() {},
    async request(r) { window.__wc.requests.push(r); return { signatureMap: btoa('sig-' + r.request.params.transactionBody.slice(0, 8)) }; },
  };
}
export async function pairingQr() { return 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; }
`;
const leg = (name, over = {}) => ({
  leg: name, payTo: name === 'artist' ? artist : steward, amount: name === 'artist' ? '96310000' : '3690000', status: 'prepared',
  bodyBytes: name === 'artist' ? F.good.hbarArtist : F.good.hbarSteward, feePayer, txId: `${feePayer}@1794160800.000000000`,
  amountDisplay: name === 'artist' ? '0.9631 HBAR' : '0.0369 HBAR', settledTx: null, hashscan: null, error: null, ...over,
});
const record = (legs, state = 'prepared') => ({ id: 'x', state, network: 'hedera:testnet', currency: 'HBAR', asset: '0.0.0', total: '100000000', totalDisplay: '1 HBAR', fan, artist: { label: 'shaka', ens: 'shaka.osoartist.eth', payTo: artist, source: 'their ENS record addr(3030)' }, legs });
const settled = (name, n) => leg(name, { status: 'settled', bodyBytes: null, settledTx: `${feePayer}@1794160800.00000000${n}`, hashscan: `https://hashscan.io/testnet/transaction/${feePayer}-1794160800-00000000${n}` });

let server; let browser; let base;
before(async () => {
  server = createPreviewServer({ projectId: 'a'.repeat(32) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

async function open({ prepare, settle, vp = { width: 1280, height: 900 } }) {
  const context = await browser.newContext({ viewport: vp, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  const calls = { prepare: [], settle: [] };
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.url().startsWith(base) && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.route(`${base}/wallet-config.json`, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ projectId: 'a'.repeat(32), runtimeReady: true, enabled: true }) }));
  await page.route(`${base}/hashpack-runtime.mjs`, (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_RUNTIME }));
  await page.route(`${W}/health`, (r) => r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify(HEALTH) }));
  await page.route(`${W}/artist?**`, (r) => r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify(SHAKA) }));
  await page.route(`${W}/tip`, () => { throw new Error('the demo fan must not run'); });
  const handler = (list, fn) => async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' } });
    const body = JSON.parse(r.request().postData());
    list.push(body);
    return r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify(fn(body, list.length)) });
  };
  await page.route(`${W}/wallet/prepare`, handler(calls.prepare, prepare));
  await page.route(`${W}/wallet/settle`, handler(calls.settle, settle));
  await page.goto(`${base}/pay?artist=shaka`);
  await page.waitForFunction(() => !document.querySelector('#fan-fields').disabled && !document.querySelector('#fan-connect').disabled);
  return { context, page, errors, calls };
}

async function connectAndPay(page, amount = '1') {
  await page.locator('#fan-amount').fill(amount);
  await page.locator('#fan-connect').click();
  await page.waitForFunction(() => document.querySelectorAll('#fan-account option').length === 2);
  await page.locator('#fan-account').selectOption(`hedera:testnet:${fan}`);
  await page.waitForFunction(() => !document.querySelector('#fan-pay').disabled);
  await page.locator('#fan-pay').click();
}

for (const vp of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
  test(`fan wallet: HashPack signs BOTH direct payments (artist 96.31% + steward 3.69%), page checks bodies first, settles, shows HashScan at ${vp.width}px`, async () => {
    const { context, page, errors, calls } = await open({
      vp,
      prepare: () => ({ ok: true, reused: false, record: record([leg('artist'), leg('steward')]) }),
      settle: () => ({ ok: true, state: 'complete', results: [], record: record([settled('artist', 1), settled('steward', 2)], 'complete') }),
    });
    try {
      assert.equal(await page.locator('#fan-network option[value="mainnet"]').isDisabled(), true, 'mainnet switched off at the Worker');
      assert.match(await page.locator('#fan-network option[value="mainnet"]').innerText(), /switched off/);
      assert.match(await page.locator('#fan-split').innerText(), /0\.09631 HBAR → artist \(96\.31%\) · 0\.00369 HBAR → steward \(3\.69%\) · 0 to OSO/, 'default 0.1');
      await connectAndPay(page);
      assert.match(await page.locator('#fan-split').innerText(), /0\.9631 HBAR → artist \(96\.31%\) · 0\.0369 HBAR → steward \(3\.69%\) · 0 to OSO/);
      await page.waitForFunction(() => /Both payments landed/.test(document.querySelector('#fan-status').textContent));
      const wc = await page.evaluate(() => window.__wc);
      assert.deepEqual(wc.requested.requiredNamespaces.hedera.methods, ['hedera_signTransaction']);
      assert.deepEqual(wc.requested.requiredNamespaces.hedera.chains, ['hedera:testnet']);
      assert.deepEqual(wc.requests.map((r) => [r.chainId, r.request.method, r.request.params.signerAccountId, r.request.params.transactionBody]), [
        ['hedera:testnet', 'hedera_signTransaction', `hedera:testnet:${fan}`, F.good.hbarArtist],
        ['hedera:testnet', 'hedera_signTransaction', `hedera:testnet:${fan}`, F.good.hbarSteward],
      ]);
      const p = calls.prepare[0];
      assert.match(p.id, /^tip_[0-9a-f]{24}$/);
      assert.deepEqual({ ...p, id: 'x' }, { id: 'x', network: 'testnet', currency: 'HBAR', amount: '1', artist: 'shaka', fan });
      assert.deepEqual(calls.settle[0], { id: p.id, signatures: { artist: btoaNode(`sig-${F.good.hbarArtist.slice(0, 8)}`), steward: btoaNode(`sig-${F.good.hbarSteward.slice(0, 8)}`) } });
      const steps = await page.locator('#fan-steps li').allInnerTexts();
      assert.match(steps.join('\n'), /✓ 0\.9631 HBAR → the artist \(shaka\.osoartist\.eth\) · 0\.0\.11347291/);
      assert.match(steps.join('\n'), /✓ 0\.0369 HBAR → the steward · 0\.0\.11345897/);
      assert.match(steps.join('\n'), /decoded both transactions: exactly these transfers/);
      const hrefs = await page.locator('#fan-steps a').evaluateAll((as) => as.map((a) => a.href));
      assert.deepEqual(hrefs, [`https://hashscan.io/testnet/transaction/${feePayer}-1794160800-000000001`, `https://hashscan.io/testnet/transaction/${feePayer}-1794160800-000000002`]);
      assert.equal(await page.evaluate(() => sessionStorage.length), 0, 'a complete tip leaves no pending id');
      await page.evaluate(axe.source);
      const violations = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2b', 'wcag21aa', 'wcag22aa'] } })).violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })));
      assert.deepEqual(violations, [], 'axe WCAG audit of /pay with the fan wallet');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, 'no horizontal overflow');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}

function btoaNode(s) { return Buffer.from(s, 'binary').toString('base64'); }

test('fan wallet: a tampered prepared transfer is refused BEFORE the wallet is asked; nothing is settled', async () => {
  const { context, page, calls } = await open({
    prepare: () => ({ ok: true, reused: false, record: record([leg('artist', { bodyBytes: F.bad.extraRecipient }), leg('steward')]) }),
    settle: () => { throw new Error('must not settle'); },
  });
  try {
    await connectAndPay(page);
    await page.waitForFunction(() => /Nothing was signed and nothing was paid/.test(document.querySelector('#fan-status').textContent));
    assert.match(await page.locator('#fan-steps li.error').innerText(), /Refused to ask your wallet.*artist leg: .*not exactly/s);
    assert.deepEqual(await page.evaluate(() => window.__wc.requests), [], 'HashPack was never asked to sign');
    assert.equal(calls.settle.length, 0);
  } finally {
    await context.close();
  }
});

test('fan wallet: artist paid + steward failed -> "partial", retry reuses the SAME tip id and signs ONLY the steward leg', async () => {
  const { context, page, calls } = await open({
    prepare: (_b, n) => ({ ok: true, reused: n > 1, record: n === 1 ? record([leg('artist'), leg('steward')]) : record([settled('artist', 1), leg('steward', { status: 'failed', error: 'settle failed: transaction_failed' })], 'partial') }),
    settle: (_b, n) => (n === 1
      ? { ok: true, state: 'partial', results: [], record: record([settled('artist', 1), leg('steward', { status: 'failed', error: 'settle failed: transaction_failed' })], 'partial'), recovery: 'only the steward leg is retried' }
      : { ok: true, state: 'complete', results: [], record: record([settled('artist', 1), settled('steward', 2)], 'complete') }),
  });
  try {
    await connectAndPay(page);
    await page.waitForFunction(() => /The artist is paid/.test(document.querySelector('#fan-status').textContent));
    assert.equal(await page.locator('#fan-retry').isVisible(), true);
    assert.match(await page.locator('#fan-steps li.error').innerText(), /0\.0369 HBAR → the steward · failed/);
    await page.locator('#fan-retry').click();
    await page.waitForFunction(() => /Both payments landed/.test(document.querySelector('#fan-status').textContent));
    assert.equal(calls.prepare.length, 2);
    assert.equal(calls.prepare[1].id, calls.prepare[0].id, 'same idempotency key on retry');
    assert.deepEqual(Object.keys(calls.settle[1].signatures), ['steward'], 'only the unpaid leg is signed again');
    const reqs = await page.evaluate(() => window.__wc.requests.map((r) => r.request.params.transactionBody));
    assert.deepEqual(reqs, [F.good.hbarArtist, F.good.hbarSteward, F.good.hbarSteward]);
  } finally {
    await context.close();
  }
});

test('fan wallet: a mainnet refusal from the Worker is shown honestly; without a Reown project id the page says so and offers the labelled demo', async () => {
  const { context, page } = await open({
    prepare: () => ({ ok: false, error: 'MAINNET_DISABLED', message: 'mainnet tips are switched off' }),
    settle: () => ({}),
  });
  try {
    await connectAndPay(page);
    await page.waitForFunction(() => /The payment stopped/.test(document.querySelector('#fan-steps').textContent));
    assert.deepEqual(await page.evaluate(() => window.__wc.requests), []);
  } finally {
    await context.close();
  }
  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  try {
    await page2.route(`${W}/health`, (r) => r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify(HEALTH) }));
    await page2.route(`${W}/artist?**`, (r) => r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify(SHAKA) }));
    await page2.route(`${base}/wallet-config.json`, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ projectId: '', runtimeReady: false, enabled: false }) }));
    await page2.goto(`${base}/pay?artist=shaka`);
    await page2.waitForFunction(() => /Reown project ID not deployed/.test(document.querySelector('#fan-wallet-status').textContent));
    assert.equal(await page2.locator('#fan-connect').isDisabled(), true);
    assert.match(await page2.locator('#run-heading').innerText(), /DEMO: a server-side testnet fan pays — not you/);
  } finally {
    await context2.close();
  }
});
