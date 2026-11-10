import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from 'playwright';
import axe from 'axe-core';
import { createPreviewServer } from '../server.mjs';
import { decodeFunctionData, encodeErrorResult, encodeFunctionResult, namehash } from '../../ens/node_modules/viem/_esm/index.js';
import { ABIS, COIN, buildTx, dnsEncode, planPayout } from '../public/payout-plan.mjs';

// /payout end to end in a real browser: the public RPC is answered by a tiny in-test ENS (owner,
// resolver, records — shaped exactly like mainnet's shaka.osoartist.eth), the wallet is a mock
// EIP-1193 provider that only records what it is asked to send. Nothing leaves this machine.
const OWNER = '0x25965899f4600b3AA5362ee4f34be95E5E62c934';
const STRANGER = '0x000000000000000000000000000000000000dEaD';
const RESOLVER = '0xdDFf981748Ec5F6D6618D830E90ba964DaA60Fb1';
const REGISTRY = '0xE9d4002cb12a53b50FAA244Cf801Ced40D7c3b48';
const NAME = 'shaka.osoartist.eth';
const NODE = namehash(NAME);
const RECORDS = { addr: { [String(COIN.ETH)]: OWNER, [String(COIN.HEDERA_TESTNET_EVM)]: OWNER }, text: { 'hedera.network': 'testnet', 'oso.consent': 'active' } };
const ROUTER = [...ABIS.registry, ...ABIS.universalResolver];

function ensAnswer({ to, data, from }) {
  if (to.toLowerCase() === RESOLVER.toLowerCase()) {
    if (from?.toLowerCase() !== OWNER.toLowerCase()) {
      return { error: { code: 3, message: 'execution reverted', data: encodeErrorResult({ abi: ABIS.resolver, errorName: 'EACUnauthorizedAccountRoles', args: [0n, 1n, from] }) } };
    }
    return { result: '0x' };
  }
  const call = decodeFunctionData({ abi: ROUTER, data });
  if (call.functionName === 'findOwner') return { result: encodeFunctionResult({ abi: ABIS.registry, functionName: 'findOwner', result: call.args[0] === 'shaka' ? OWNER : '0x0000000000000000000000000000000000000000' }) };
  if (call.functionName === 'findResolver') return { result: encodeFunctionResult({ abi: ABIS.universalResolver, functionName: 'findResolver', result: [call.args[0] === dnsEncode(NAME) ? RESOLVER : '0x0000000000000000000000000000000000000000', NODE, 0n] }) };
  if (call.functionName === 'resolve') {
    const inner = decodeFunctionData({ abi: ABIS.profile, data: call.args[1] });
    assert.equal(inner.args[0], NODE);
    const value = inner.functionName === 'addr'
      ? encodeFunctionResult({ abi: ABIS.profile, functionName: 'addr', result: RECORDS.addr[String(inner.args[1])]?.toLowerCase() ?? '0x' })
      : encodeFunctionResult({ abi: ABIS.profile, functionName: 'text', result: RECORDS.text[inner.args[1]] ?? '' });
    return { result: encodeFunctionResult({ abi: ABIS.universalResolver, functionName: 'resolve', result: [value, RESOLVER] }) };
  }
  throw new Error(`unexpected call ${call.functionName}`);
}

let server; let browser; let base;
before(async () => {
  server = createPreviewServer({ projectId: '' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

test('/payout: reads the name, shows exactly what will be written, only the owner can send', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' };
  let rpcCalls = 0;
  await page.route('https://ethereum-rpc.publicnode.com/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const { id, method, params } = JSON.parse(route.request().postData());
    rpcCalls += 1;
    assert.equal(method, 'eth_call');
    const answer = ensAnswer(params[0]);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ jsonrpc: '2.0', id, ...answer }) });
  });
  await page.addInitScript(({ stranger }) => {
    const handlers = {};
    window.__acct = stranger;
    window.__sent = [];
    window.__emit = (ev, v) => (handlers[ev] || []).forEach((h) => h(v));
    window.ethereum = {
      request: async ({ method, params }) => {
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [window.__acct];
        if (method === 'eth_chainId') return '0x1';
        if (method === 'eth_sendTransaction') { window.__sent.push(params[0]); return `0x${'ab'.repeat(32)}`; }
        throw new Error(`unexpected ${method}`);
      },
      on: (ev, h) => { (handlers[ev] ||= []).push(h); },
      removeListener: () => {},
    };
  }, { stranger: STRANGER });
  try {
    await page.goto(`${base}/payout?artist=shaka`);
    await page.locator('#choose-card:not([hidden])').waitFor({ timeout: 10000 });
    const current = await page.locator('#current').innerText();
    assert.match(current, new RegExp(`owner\\s+${OWNER}`));
    assert.match(current, new RegExp(`resolver\\s+${RESOLVER}`));
    assert.match(current, /text hedera\.network\s+testnet/);
    assert.match(current, /a mainnet tip pays today\s+refused \(name says testnet\)/);
    assert.match(await page.locator('#read-status').textContent(), /owned by 0x2596/);
    assert.equal(await page.locator('input[name="mode"][value="wallet"]').isChecked(), true, 'preselects what the name has today');

    // Hedera mainnet account: the plan names every record before any wallet is involved
    await page.locator('input[name="network"][value="mainnet"]').check();
    await page.locator('input[name="mode"][value="account"]').check();
    await page.locator('#account-id').fill('0.0.4242');
    const plan = await page.locator('#plan').textContent();
    assert.match(plan, /on shaka\.osoartist\.eth, resolver 0xdDFf981748Ec5F6D6618D830E90ba964DaA60Fb1, Ethereum mainnet:/);
    assert.match(plan, /set addr 3030 · Hedera account ← 0\.0\.4242 \(Hedera mainnet account\)/);
    assert.match(plan, /set text hedera\.network ← mainnet/);
    assert.match(plan, /a fan's tip on Hedera mainnet pays: 0\.0\.4242 \(hbar\)/);
    assert.match(await page.locator('#warnings').innerText(), /tips on Hedera testnet are refused/);
    assert.match(await page.locator('#checks').innerText(), /connect your wallet/);
    assert.equal(await page.locator('#send').isDisabled(), true);

    // a wallet that is not the owner never gets the send button, and the resolver would refuse it anyway
    await page.locator('#connect').click();
    await page.waitForFunction(() => /connected as 0x000000000000000000000000000000000000dEaD/.test(document.querySelector('#who').textContent));
    assert.match(await page.locator('#checks').innerText(), /is not the owner of this name/);
    assert.equal(await page.locator('#send').isDisabled(), true);

    // the owner: signer check ✔, dry run ✔, send enabled → the wallet receives exactly the planned tx
    await page.evaluate((owner) => { window.__acct = owner; window.__emit('accountsChanged', [owner]); }, OWNER);
    await page.waitForFunction(() => /dry run: your resolver accepts this/.test(document.querySelector('#checks').textContent));
    assert.equal(await page.locator('#send').isDisabled(), false);
    await page.evaluate(axe.source);
    const violations = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2b', 'wcag21aa', 'wcag22aa'] } }))
      .violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })));
    assert.deepEqual(violations, [], 'axe WCAG audit of the filled-in /payout page');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, 'no horizontal overflow');
    await page.locator('#send').click();
    await page.waitForFunction(() => /Sent by your wallet/.test(document.querySelector('#send-status').textContent));
    const sent = await page.evaluate(() => window.__sent);
    const expected = buildTx(planPayout({ label: 'shaka', network: 'mainnet', mode: 'account', accountId: '0.0.4242', current: { records: { hbarAccount: null } } }), RESOLVER);
    assert.deepEqual(sent, [{ from: OWNER, ...expected }]);
    assert.equal(await page.locator('#send-status a').getAttribute('href'), `https://etherscan.io/tx/0x${'ab'.repeat(32)}`);

    // "my wallet address": the connected owner becomes the mainnet alias (no 3030 to clear on this name)
    await page.locator('input[name="mode"][value="wallet"]').check();
    const walletPlan = await page.locator('#plan').textContent();
    assert.match(walletPlan, new RegExp(`set addr 0x80000127 · Hedera mainnet EVM address ← ${OWNER} \\(your wallet address`));
    assert.doesNotMatch(walletPlan, /cleared/);
    assert.equal(await page.locator('#account-id').isDisabled(), true);

    // an unissued name says so and offers nothing to sign
    await page.locator('#label').fill('not-issued');
    await page.locator('#read').click();
    await page.waitForFunction(() => /not issued yet/.test(document.querySelector('#read-status').textContent));
    assert.equal(await page.locator('#choose-card').isHidden(), true);
    assert.equal(await page.locator('#review-card').isHidden(), true);
    assert.ok(rpcCalls > 0);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
