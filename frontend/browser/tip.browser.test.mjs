// 💸 Multichain tip, end to end, against REAL contracts on anvil forks of the real chains:
// Ethereum (ENS reads + USDC), Base (USDC 6 dp), BNB Smart Chain (Binance-Peg USDC 18 dp), OP (native ETH),
// Arbitrum (wallet must ADD the chain first). The "wallet" is a tiny EIP-1193/EIP-6963 test provider that
// forwards to the forks; anvil signs for its unlocked dev account. Nothing here touches a live chain's state.
//   needs: anvil (Foundry) on PATH or at /workspace/.foundry/bin/anvil, outbound HTTPS to public RPCs.
//   run:   node --test --test-concurrency=1 browser/tip.browser.test.mjs
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import axe from 'axe-core';
import { createPreviewServer } from '../server.mjs';

const ANVIL = existsSync('/workspace/.foundry/bin/anvil') ? '/workspace/.foundry/bin/anvil' : 'anvil';
const FORKS = {
  1: { port: 28545, url: 'https://ethereum-rpc.publicnode.com' },
  8453: { port: 28453, url: 'https://mainnet.base.org' },
  56: { port: 28056, url: 'https://bsc-rpc.publicnode.com' },
  10: { port: 28010, url: 'https://mainnet.optimism.io' },
  42161: { port: 28161, url: 'https://arb1.arbitrum.io/rpc' },
};
const FAN = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // anvil dev account #0 (unlocked on the forks only)
const SHAKA = '0x25965899f4600b3AA5362ee4f34be95E5E62c934'; // shaka.osoartist.eth = osoartist.eth today
const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'; // used ONLY on forks as a stand-in steward to exercise the 2-transfer path
const NICK = '0xb8c2C29ee19D8307cb7255e1Cd9CbDE883A267d5'; // nick.eth — fork-only stand-in for a 3rd distinct artist wallet
const USDC = { 1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 56: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' };
const WHO = '/?who=open-source-orchestra,shaka,ohana,amogh,0xmentalist,jaydeepdan-gadhavi,nidhi-harihar,aniket-gundewar,vivek-teega';
const ENS_RPCS = ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://1rpc.io/eth'];
const BASE_CONFIG = { enabled: true, mainnet: false, mainnetLive: true, stewardEns: 'osoartist.eth', stewardPin: SHAKA, hostPayees: { 'open-source-orchestra': { ens: 'osoartist.eth' } }, limits: { minUsdc: '0.01', maxUsdc: '100', minEth: '0.0001', maxEth: '0.05' }, disabledChains: [], ensRpcUrls: ENS_RPCS };

const procs = [];
let server; let browser; let base;
const rpc = async (chainId, method, params = []) => {
  const r = await fetch(`http://127.0.0.1:${FORKS[chainId].port}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
  return j.result;
};
const pad = (h) => h.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const balanceOf = async (chainId, token, who) => BigInt(await rpc(chainId, 'eth_call', [{ to: token, data: '0x70a08231' + pad(who) }, 'latest']));

/** Give the fan tokens on a fork by finding the ERC-20 balance-mapping slot (0..20). */
async function deal(chainId, token, holder, amount) {
  const { keccak256 } = await import('../../ens/node_modules/viem/_esm/index.js');
  for (let s = 0; s <= 20; s++) {
    const key = keccak256('0x' + pad(holder) + pad('0x' + s.toString(16)));
    const old = await rpc(chainId, 'eth_getStorageAt', [token, key, 'latest']);
    await rpc(chainId, 'anvil_setStorageAt', [token, key, '0x' + amount.toString(16).padStart(64, '0')]);
    if ((await balanceOf(chainId, token, holder)) === amount) return s;
    await rpc(chainId, 'anvil_setStorageAt', [token, key, old]);
  }
  throw new Error(`no balance slot for ${token} on ${chainId}`);
}

before(async () => {
  for (const [id, f] of Object.entries(FORKS)) {
    const p = spawn(ANVIL, ['--fork-url', f.url, '--port', String(f.port), '--silent', '--no-rate-limit'], { stdio: 'ignore' });
    procs.push(p);
    for (let i = 0; i < 60; i++) {
      try { if (Number(BigInt(await rpc(id, 'eth_chainId'))) === Number(id)) break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await deal(8453, USDC[8453], FAN, 500_000_000n); // 500 USDC
  await deal(56, USDC[56], FAN, 500n * 10n ** 18n); // 500 Binance-Peg USDC (18 dp)
  await deal(42161, USDC[42161], FAN, 500_000_000n);
  server = createPreviewServer({ projectId: '' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const p of procs) p.kill('SIGKILL');
});

/** Page + test wallet. opts: { config, startChain, knownChains, rejectSend: Set(n), wrongDecimals, noWallet } */
async function open(path, opts = {}, vp = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport: vp, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  const calls = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/WebGL|GPU|THREE/i.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('response', (r) => { if (r.url().startsWith(base) && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  // ENS reads → the Ethereum fork (deterministic, offline from live state)
  {
    await page.route((url) => ENS_RPCS.some((u) => url.href.startsWith(u)), async (route) => {
      const body = route.request().postData();
      const r = await fetch(`http://127.0.0.1:${FORKS[1].port}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      let text = await r.text();
      // a lying RPC (MITM): swap Shaka's address for 0x…dEaD in every answer from this one host
      if (opts.tamperRpc && route.request().url().startsWith(opts.tamperRpc)) text = text.replaceAll('25965899f4600b3aa5362ee4f34be95e5e62c934', '000000000000000000000000000000000000dead');
      route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: text });
    });
  }
  // fork.js pings the live 0G steward; production allows only its own origin, so stub it on localhost
  await page.route('https://oso-zerog-steward.shakaverse.workers.dev/**', (route) => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ ok: true, stewards: { total: 41 } }) }));
  await page.route((u) => u.pathname === '/tip-config.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(opts.config ?? BASE_CONFIG) }));
  let current = opts.startChain ?? 8453;
  const known = new Set(opts.knownChains ?? [1, 8453, 56, 10]);
  let sends = 0;
  const batches = [];
  const batchResults = new Map();
  await page.exposeFunction('__testWallet', async (method, params) => {
    calls.push({ method, params, chain: current });
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [FAN];
    if (method === 'eth_getBlockByNumber' && params[0] === 'latest' && !opts.staleChain) await rpc(current, 'evm_mine'); // a live chain keeps producing blocks
    if (method === 'eth_getBlockByNumber' && params[0] === 'latest' && opts.staleChain) { const b = await rpc(current, 'eth_getBlockByNumber', params); return { ...b, timestamp: '0x' + (Math.floor(Date.now() / 1000) - 3600).toString(16) }; }
    if (method === 'eth_chainId') return '0x' + current.toString(16);
    if (method === 'wallet_switchEthereumChain') {
      const id = Number(BigInt(params[0].chainId));
      if (!known.has(id)) return { __error: { code: 4902, message: 'Unrecognized chain ID' } };
      current = id;
      return { __event: 'chainChanged', value: params[0].chainId };
    }
    if (method === 'wallet_addEthereumChain') {
      const id = Number(BigInt(params[0].chainId));
      if (!FORKS[id]) return { __error: { code: -32603, message: 'test wallet cannot add this chain' } };
      known.add(id);
      current = id;
      return { __event: 'chainChanged', value: params[0].chainId };
    }
    if (method === 'eth_sendTransaction') {
      sends += 1;
      if (opts.rejectSend?.has(sends)) return { __error: { code: 4001, message: 'User rejected the request.' } };
      if (opts.errorAfterBroadcast?.has(sends)) { await rpc(current, method, params); return { __error: { code: -32603, message: 'Internal JSON-RPC error.' } }; }
      if (opts.hangAfterBroadcast?.has(sends)) { await rpc(current, method, params); return new Promise(() => {}); } // approved in the wallet, then the page went away
      if (opts.hangNoBroadcast?.has(sends)) return new Promise(() => {}); // prompt left open, page reloaded
    }
    if (method === 'wallet_getCapabilities') {
      if (!opts.atomic) return { __error: { code: -32601, message: 'Method not supported' } };
      return { ['0x' + current.toString(16)]: { atomic: { status: 'supported' } } };
    }
    if (method === 'wallet_sendCalls') {
      batches.push(params[0]);
      if (opts.batchErrorNoExec && batches.length === 1) return { __error: { code: -32603, message: 'Internal error' } };
      if (Number(BigInt(params[0].chainId)) !== current || params[0].atomicRequired !== true) return { __error: { code: -32602, message: 'bad batch' } };
      const snap = await rpc(current, 'evm_snapshot');
      const receipts = [];
      for (const call of params[0].calls) {
        const h = await rpc(current, 'eth_sendTransaction', [{ from: params[0].from, to: call.to, value: call.value, data: call.data }]);
        let rc = null;
        for (let k = 0; k < 50 && !rc; k++) { rc = await rpc(current, 'eth_getTransactionReceipt', [h]); if (!rc) await new Promise((r) => setTimeout(r, 200)); }
        if (rc.status !== '0x1') { await rpc(current, 'evm_revert', [snap]); return { id: 'batch-failed' }; }
        receipts.push(rc);
      }
      const id = params[0].id ?? '0x' + String(batches.length).padStart(64, '0');
      if (batchResults.has(id)) return { __error: { code: 5720, message: 'Duplicate ID' } };
      batchResults.set(id, receipts);
      if (opts.batchErrorAfterExec && batches.length === 1) return { __error: { code: -32603, message: 'Internal error after submit' } };
      return { id };
    }
    if (method === 'wallet_getCallsStatus') {
      const rcs = batchResults.get(params[0]);
      if (opts.statusUnknown) return { __error: { code: 5730, message: 'Unknown bundle id' } };
      return rcs ? { version: '2.0.0', id: params[0], chainId: '0x' + current.toString(16), status: 200, atomic: true, receipts: rcs } : { __error: { code: 5730, message: 'Unknown bundle id' } };
    }
    if (opts.wrongDecimals && method === 'eth_call' && params[0]?.data === '0x313ce567') return '0x' + '12'.padStart(64, '0');
    try {
      return await rpc(current, method, params);
    } catch (e) {
      return { __error: { code: e.code ?? -32000, message: e.message } };
    }
  });
  if (opts.noLocks) await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'locks', { get: () => undefined, configurable: true }); });
  if (!opts.noWallet) {
    await page.addInitScript(() => {
      const listeners = {};
      const provider = {
        isTestWallet: true,
        async request({ method, params }) {
          const r = await window.__testWallet(method, params ?? []);
          if (r && r.__error) throw Object.assign(new Error(r.__error.message), { code: r.__error.code });
          if (r && r.__event) { setTimeout(() => (listeners[r.__event] ?? []).forEach((f) => f(r.value)), 0); return null; }
          return r;
        },
        on(ev, f) { (listeners[ev] ??= []).push(f); },
        removeListener(ev, f) { listeners[ev] = (listeners[ev] ?? []).filter((x) => x !== f); },
      };
      const info = Object.freeze({ uuid: '6b7d4c7e-0000-4000-8000-000000000001', name: 'Test Wallet', icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=', rdns: 'org.example.test' });
      const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
      window.addEventListener('eip6963:requestProvider', announce);
      announce();
    });
  }
  await page.goto(`${base}${path}`);
  return { context, page, errors, calls, batches, sends: () => sends };
}

async function enter(page) {
  await page.waitForFunction(() => window.__circleReady === true, null, { timeout: 30_000 });
  await page.locator('#enter').click();
  await page.waitForFunction(() => document.querySelector('#loading').classList.contains('gone'));
}
async function openPanel(page) {
  await enter(page);
  await page.locator('#tip-open').click();
  await page.waitForFunction(() => document.querySelector('#tip').classList.contains('open'));
  await page.waitForFunction(() => /tips on · shaka\.osoartist\.eth/.test(document.querySelector('#tip .body').textContent), null, { timeout: 30_000 });
}
const pick = async (page, sel) => {
  await page.locator('label', { has: page.locator(sel) }).click(); // like a person: tap the chip/row
  await page.waitForFunction((q) => document.querySelector(q)?.checked === true, sel);
};
const statusText = (page) => page.locator('#tip-status').textContent();
async function waitStatus(page, re, timeout = 150_000) {
  try {
    await page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#tip-status')?.textContent ?? ''), re.source, { timeout });
  } catch (e) {
    throw new Error(`status never matched ${re}: last status = "${await page.locator('#tip-status').textContent().catch(() => '?')}"`);
  }
}

test('the exact ?who= circle URL loads with no errors; the tip panel shows the chain picker and honest artist states', async () => {
  for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const { context, page, errors } = await open(WHO, {}, vp);
    try {
      await openPanel(page);
      const chips = await page.locator('#tip-chains .tip-chain').allInnerTexts();
      for (const name of ['Ethereum', 'Base', 'OP Mainnet', 'Arbitrum One', 'World Chain', 'BNB Smart Chain', 'Polygon PoS', 'Unichain', 'Linea', 'ZKsync Era', 'Celo', 'Ink', 'Scroll', 'Soneium']) {
        assert.ok(chips.some((c) => c.startsWith(name)), `${name} chip missing at ${vp.width}`);
      }
      assert.equal(await page.locator('#tip-chains').isVisible(), true);
      const body = await page.locator('#tip .body').textContent();
      assert.match(body, /Open Source Orchestra✅ tips on · osoartist\.eth/);
      assert.match(body, /Shaka 🤙✅ tips on · shaka\.osoartist\.eth/);
      for (const n of ['Amogh', '0xMentalist', 'Jaydeepdan Gadhavi', 'Nidhi Harihar', 'Aniket Gundewar', 'Vivek Teegalapally', 'the ʻohana']) assert.match(body, new RegExp(`${n}[^⏳✅]*⏳ awaiting the artist’s wallet`), n);
      assert.equal(await page.locator('input[name=tip-artist][value=amogh]').isDisabled(), true);
      assert.doesNotMatch(body, /0xFC60/i, 'the opensourceorchestra.eth wallet is never shown');
      await page.evaluate(axe.source);
      const v = await page.evaluate(async () => (await axe.run(document.querySelector('#tip'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map((x) => `${x.id}: ${x.nodes.length}`));
      assert.deepEqual(v, [], `axe at ${vp.width}`);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('Base · USDC · shaka (artist wallet = steward wallet today) → ONE exact transfer of 100%', async () => {
  const { context, page, errors, calls } = await open(WHO, { startChain: 8453 });
  try {
    await openPanel(page);
    await pick(page, 'input[name=tip-artist][value=shaka]');
    await pick(page, 'input[name=tip-chain][value="8453"]');
    await page.locator('#tip-amount').fill('2.5');
    assert.match(await page.locator('#tip-split').textContent(), /2\.40775 USDC ≈ \$2\.40 → artist \(96\.31%\) · 0\.09225 USDC ≈ \$0\.09 → steward \(3\.69%\) · no platform fee/);
    await page.locator('[data-connect]').click();
    await waitStatus(page, /Connected 0xf39F…2266/);
    await page.locator('[data-act=review]').click();
    await waitStatus(page, /Everything checks out/);
    const review = await page.locator('#tip-review').textContent();
    assert.match(review, /Base · id 8453/);
    assert.match(review, /USDC · contract 0x 8335 89fC D6eD b6E0 8f4c 7C32 D4f7 1b54 bdA0 2913/);
    assert.match(review, /transfer\s*2\.5 USDC → shaka\.osoartist\.eth\s*0x 2596 5899 f460 0b3A A536 2ee4 f34b e95E 5E62 c934/);
    assert.match(review, /both shares go in one transfer/);
    const before = await balanceOf(8453, USDC[8453], SHAKA);
    await page.locator('[data-act=send]').dblclick(); // double-click guard
    await waitStatus(page, /Done — 2\.5 USDC went straight to shaka\.osoartist\.eth/);
    assert.equal((await balanceOf(8453, USDC[8453], SHAKA)) - before, 2_500_000n);
    assert.equal(calls.filter((c) => c.method === 'eth_sendTransaction').length, 1, 'exactly one wallet prompt');
    const tx = calls.find((c) => c.method === 'eth_sendTransaction').params[0];
    assert.equal(tx.to, USDC[8453]);
    assert.equal(tx.value, '0x0');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('BNB Smart Chain · Binance-Peg USDC (18 decimals) · two transfers split 96.31 / 3.69 exactly', async () => {
  const config = { ...BASE_CONFIG, stewardEns: 'vitalik.eth', stewardPin: VITALIK }; // fork-only stand-in steward ≠ artist
  const { context, page, errors, calls } = await open(WHO, { config, startChain: 8453 });
  try {
    await openPanel(page);
    await pick(page, 'input[name=tip-artist][value=shaka]');
    await pick(page, 'input[name=tip-chain][value="56"]');
    await page.locator('#tip-amount').fill('10');
    await page.locator('[data-connect]').click();
    await waitStatus(page, /Connected/);
    await page.locator('[data-act=switch]').click();
    await waitStatus(page, /On BNB Smart Chain/);
    await page.locator('[data-act=review]').click();
    await waitStatus(page, /Everything checks out/);
    const review = await page.locator('#tip-review').textContent();
    assert.match(review, /9\.631 USDC → shaka\.osoartist\.eth\s*0x 2596 5899 f460 0b3A A536 2ee4 f34b e95E 5E62 c934/);
    assert.match(review, /0\.369 USDC → vitalik\.eth\s*0x d8dA 6BF2 6964 aF9D 7eEd 9e03 E534 15D3 7aA9 6045/);
    const [a0, s0] = await Promise.all([balanceOf(56, USDC[56], SHAKA), balanceOf(56, USDC[56], VITALIK)]);
    await page.locator('[data-act=send]').click();
    await waitStatus(page, /Done — 10 USDC/);
    assert.equal((await balanceOf(56, USDC[56], SHAKA)) - a0, 9_631n * 10n ** 15n);
    assert.equal((await balanceOf(56, USDC[56], VITALIK)) - s0, 369n * 10n ** 15n);
    assert.equal(calls.filter((c) => c.method === 'eth_sendTransaction').length, 2);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('the open-source-orchestra card refuses to pay when osoartist.eth ≠ the published pin', async () => {
  const config = { ...BASE_CONFIG, stewardEns: 'vitalik.eth', stewardPin: VITALIK };
  const { context, page } = await open(WHO, { config, startChain: 8453 });
  try {
    await openPanel(page);
    await pick(page, 'input[name=tip-artist][value=open-source-orchestra]');
    await pick(page, 'input[name=tip-chain][value="8453"]');
    await page.locator('[data-connect]').click();
    await waitStatus(page, /Connected/);
    await page.locator('[data-act=review]').click();
    await waitStatus(page, /no longer points at the published orchestra wallet/);
    assert.equal(await page.locator('[data-act=send]').count(), 0);
  } finally { await context.close(); }
});

test('OP Mainnet · native ETH · two value transfers, exact wei', async () => {
  const config = { ...BASE_CONFIG, stewardEns: 'vitalik.eth', stewardPin: VITALIK };
  const { context, page, errors } = await open(WHO, { config, startChain: 10 });
  try {
    await openPanel(page);
    await pick(page, 'input[name=tip-artist][value=shaka]');
    await pick(page, 'input[name=tip-chain][value="10"]');
    await page.locator('[data-asset=native]').click();
    await page.locator('#tip-amount').fill('0.01');
    await page.locator('[data-connect]').click();
    await waitStatus(page, /Connected/);
    await page.locator('[data-act=review]').click();
    await waitStatus(page, /Everything checks out/);
    const bal = async (a) => BigInt(await rpc(10, 'eth_getBalance', [a, 'latest']));
    const [a0, s0] = await Promise.all([bal(SHAKA), bal(VITALIK)]);
    await page.locator('[data-act=send]').click();
    await waitStatus(page, /Done — 0\.01 ETH/);
    assert.equal((await bal(SHAKA)) - a0, 9_631_000_000_000_000n);
    assert.equal((await bal(VITALIK)) - s0, 369_000_000_000_000n);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Arbitrum · the wallet does not know the chain → wallet_addEthereumChain with the checked params; reject transfer 2 → continue sends ONLY transfer 2', async () => {
  const config = { ...BASE_CONFIG, stewardEns: 'vitalik.eth', stewardPin: VITALIK };
  const { context, page, calls, sends } = await open(WHO, { config, startChain: 8453, knownChains: [1, 8453], rejectSend: new Set([2]) });
  try {
    await openPanel(page);
    await pick(page, 'input[name=tip-artist][value=shaka]');
    await pick(page, 'input[name=tip-chain][value="42161"]');
    await page.locator('#tip-amount').fill('1');
    await page.locator('[data-connect]').click();
    await waitStatus(page, /Connected/);
    await page.locator('[data-act=switch]').click();
    await waitStatus(page, /On Arbitrum One/);
    const add = calls.find((c) => c.method === 'wallet_addEthereumChain').params[0];
    assert.deepEqual(add, { chainId: '0xa4b1', chainName: 'Arbitrum One', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://arb1.arbitrum.io/rpc'], blockExplorerUrls: ['https://arbiscan.io'] });
    await page.locator('[data-act=review]').click();
    await waitStatus(page, /Everything checks out/);
    const [a0, s0] = await Promise.all([balanceOf(42161, USDC[42161], SHAKA), balanceOf(42161, USDC[42161], VITALIK)]);
    await page.locator('[data-act=send]').click();
    await waitStatus(page, /declined in your wallet/);
    assert.equal((await balanceOf(42161, USDC[42161], SHAKA)) - a0, 963_100n, 'transfer 1 landed');
    assert.equal(await balanceOf(42161, USDC[42161], VITALIK), s0, 'transfer 2 did not');
    assert.match(await page.locator('#tip-review').textContent(), /confirmed.*rejected/s);
    assert.ok(calls.filter((c) => c.method === 'eth_sendTransaction').every((c) => c.params[0].chainId === '0xa4b1'), 'every tx carries chainId');
    await page.locator('[data-act=send]').click(); // "continue the tip"
    await waitStatus(page, /Done — 1 USDC/);
    assert.equal((await balanceOf(42161, USDC[42161], SHAKA)) - a0, 963_100n, 'transfer 1 was NOT sent again');
    assert.equal((await balanceOf(42161, USDC[42161], VITALIK)) - s0, 36_900n);
    assert.equal(sends(), 3, '1 ok + 1 rejected + 1 retry of the steward leg only');
    const ledger = await page.evaluate(() => JSON.parse(localStorage.getItem('oso-tip-ledger-v1')));
    assert.ok(Object.values(ledger).some((r) => r.legs.every((l) => l.state === 'confirmed' && /^0x[0-9a-f]{64}$/.test(l.hash))));
  } finally { await context.close(); }
});

test('fail closed: wrong token decimals, kill switch, mainnet off, no wallet', async () => {
  {
    const { context, page } = await open(WHO, { startChain: 8453, wrongDecimals: true });
    try {
      await openPanel(page);
      await pick(page, 'input[name=tip-artist][value=shaka]');
      await pick(page, 'input[name=tip-chain][value="8453"]');
      await page.locator('[data-connect]').click();
      await waitStatus(page, /Connected/);
      await page.locator('[data-act=review]').click();
      await waitStatus(page, /the token says 18 decimals, expected 6 — refusing/);
      assert.equal(await page.locator('[data-act=send]').count(), 0);
    } finally { await context.close(); }
  }
  {
    const { context, page } = await open(WHO, { config: { ...BASE_CONFIG, enabled: false, reason: 'paused for maintenance' } });
    try {
      await enter(page);
      await page.locator('#tip-open').click();
      await page.waitForFunction(() => /Tips are switched off right now\. paused for maintenance/.test(document.querySelector('#tip .body').textContent));
      assert.equal(await page.locator('[data-connect]').count(), 0);
    } finally { await context.close(); }
  }
  {
    const { context, page } = await open(WHO, { config: { ...BASE_CONFIG, mainnetLive: false } });
    try {
      await openPanel(page);
      assert.equal(await page.locator('[data-net=mainnet]').isDisabled(), true);
      const chips = await page.locator('#tip-chains .tip-chain').allInnerTexts();
      assert.ok(chips.length >= 8 && chips.every((c) => /Sepolia|Amoy/.test(c)), chips.join('|'));
    } finally { await context.close(); }
  }
  {
    const { context, page } = await open('/tip?artist=shaka&chain=8453', { noWallet: true });
    try {
      await page.waitForFunction(() => /No browser wallet here/.test(document.querySelector('#tip .body')?.textContent ?? ''), null, { timeout: 30_000 });
      assert.equal(await page.locator('input[name=tip-chain][value="8453"]').isChecked(), true);
    } finally { await context.close(); }
  }
});

test('config fetch failure = tips off (fail closed)', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.route((u) => u.pathname === '/tip-config.json', (r) => r.fulfill({ status: 500, body: 'no' }));
    await page.goto(`${base}/tip`);
    await page.waitForFunction(() => /Tips are switched off right now/.test(document.querySelector('#tip .body')?.textContent ?? ''));
  } finally { await context.close(); }
});

/* ── QA fixes (9 Nov 2026 review) ─────────────────────────────────────────────────────── */
const planted = (legs, total, extra = {}) => ({ id: 'tip_00000000000000000001', createdAt: new Date().toISOString(), kind: 'single', chainId: 8453, artistSlug: 'shaka', fan: FAN,
  asset: { kind: 'erc20', address: USDC[8453], decimals: 6, symbol: 'USDC' }, assetKind: 'usdc', total, legs, ...extra });
async function plant(page, rec) {
  await page.evaluate((r) => localStorage.setItem('oso-tip-ledger-v1', JSON.stringify({ [r.id]: r })), rec);
  await page.reload();
}

test('B1: a tampered stored tip ("shaka 5 USDC" but really 99 USDC → 0x…dEaD) is refused on continue — nothing is sent', async () => {
  const { context, page, calls } = await open(WHO, { startChain: 8453 });
  try {
    await plant(page, planted([{ leg: 'artist+steward', to: '0x000000000000000000000000000000000000dEaD', label: 'shaka.osoartist.eth', amount: '99000000', state: 'planned', hash: null }], '99000000'));
    await openPanel(page);
    await page.locator('[data-connect]').click();
    await waitStatus(page, /Connected/);
    await page.locator('[data-act=resume]').click();
    await waitStatus(page, /payees or amounts changed since this tip was planned/);
    assert.equal(calls.filter((c) => c.method === 'eth_sendTransaction').length, 0);
  } finally { await context.close(); }
});

test('B1: the kill switch holds for continued tips (mainnet off → an unfinished Base tip is NOT sent)', async () => {
  const { context, page, calls } = await open(WHO, { startChain: 8453, config: { ...BASE_CONFIG, mainnetLive: false } });
  try {
    await plant(page, planted([{ leg: 'artist+steward', to: SHAKA, label: 'shaka.osoartist.eth', amount: '5000000', state: 'planned', hash: null }], '5000000'));
    await enter(page);
    await page.locator('#tip-open').click();
    await page.locator('[data-connect]').click();
    await waitStatus(page, /Connected/);
    await page.locator('[data-act=resume]').click();
    await waitStatus(page, /mainnet tips are switched off/);
    assert.equal(calls.filter((c) => c.method === 'eth_sendTransaction').length, 0);
  } finally { await context.close(); }
});

test('H3: the wallet errors AFTER broadcasting transfer 1 → continue finds it onchain and never pays the artist twice', async () => {
  const config = { ...BASE_CONFIG, stewardEns: 'vitalik.eth', stewardPin: VITALIK };
  const { context, page, sends } = await open(WHO, { config, startChain: 8453, errorAfterBroadcast: new Set([1]) });
  try {
    await openPanel(page);
    await pick(page, 'input[name=tip-artist][value=shaka]');
    await pick(page, 'input[name=tip-chain][value="8453"]');
    await page.locator('#tip-amount').fill('3');
    await page.locator('[data-connect]').click();
    await waitStatus(page, /Connected/);
    await page.locator('[data-act=review]').click();
    await waitStatus(page, /Everything checks out/);
    const [a0, s0] = await Promise.all([balanceOf(8453, USDC[8453], SHAKA), balanceOf(8453, USDC[8453], VITALIK)]);
    await page.locator('[data-act=send]').click();
    await waitStatus(page, /may or may not have gone out/);
    assert.equal((await balanceOf(8453, USDC[8453], SHAKA)) - a0, 2_889_300n, 'the wallet did broadcast it');
    await page.locator('[data-act=send]').click(); // continue
    await waitStatus(page, /Done — 3 USDC/);
    assert.equal((await balanceOf(8453, USDC[8453], SHAKA)) - a0, 2_889_300n, 'artist paid exactly once');
    assert.equal((await balanceOf(8453, USDC[8453], VITALIK)) - s0, 110_700n);
    assert.equal(sends(), 2, 'transfer 1 found via its Transfer log, only transfer 2 was sent');
  } finally { await context.close(); }
});

test('H2: one lying Ethereum RPC (answers 0x…dEaD for shaka) → the page refuses to pay', async () => {
  const { context, page, calls } = await open(WHO, { startChain: 8453, tamperRpc: 'https://eth.drpc.org' });
  try {
    await enter(page);
    await page.locator('#tip-open').click();
    await page.waitForFunction(() => /two Ethereum RPCs gave different answers|can’t read right now/.test(document.querySelector('#tip .body').textContent), null, { timeout: 30_000 });
    assert.equal(await page.locator('input[name=tip-artist][value=shaka]').isDisabled(), true, 'shaka is not tippable while the RPCs disagree');
    assert.equal(calls.filter((c) => c.method === 'eth_sendTransaction').length, 0);
  } finally { await context.close(); }
});

const ORCH_CONFIG = { ...BASE_CONFIG, batch: true, stewardEns: 'vitalik.eth', stewardPin: VITALIK, hostPayees: { 'open-source-orchestra': { ens: 'osoartist.eth', pin: SHAKA }, ohana: { ens: 'nick.eth', pin: NICK } } };
for (const atomic of [true, false]) {
  test(`🎻 whole orchestra on Base · ${atomic ? 'ONE EIP-5792 atomic batch' : 'no batch support → one transfer at a time'} · equal shares per distinct wallet, dust → steward`, async () => {
    const { context, page, calls, batches, sends } = await open(WHO, { config: ORCH_CONFIG, startChain: 8453, atomic });
    try {
      await openPanel(page);
      await page.locator('[data-mode=orchestra]').click();
      await page.waitForFunction(() => /2 distinct wallets/.test(document.querySelector('#tip .body').textContent), null, { timeout: 30_000 });
      assert.match(await page.locator('#tip .body').textContent(), /(Shaka 🤙 \+ Open Source Orchestra|Open Source Orchestra \+ Shaka 🤙) share one wallet/);
      await pick(page, 'input[name=tip-chain][value="8453"]');
      await page.locator('#tip-amount').fill('10.000001');
      await page.locator('[data-connect]').click();
      await waitStatus(page, /Connected/);
      await page.locator('[data-act=review]').click();
      await waitStatus(page, /Everything checks out/);
      const review = await page.locator('#tip-review').textContent();
      // total 10_000_001 → steward floor(3.69%) = 369_000; pool 9_631_001 → each 4_815_500, dust 1 → steward 369_001
      assert.match(review, /4\.8155 USDC → (shaka\.osoartist\.eth \+ osoartist\.eth|osoartist\.eth \+ shaka\.osoartist\.eth)/);
      assert.match(review, /4\.8155 USDC → nick\.eth/);
      assert.match(review, /0\.369001 USDC → vitalik\.eth/);
      assert.match(review, atomic ? /one atomic batch/ : /3 times — once per transfer/);
      const before = await Promise.all([SHAKA, NICK, VITALIK].map((a) => balanceOf(8453, USDC[8453], a)));
      await page.locator('[data-act=send]').click();
      await waitStatus(page, /Done — 10\.000001 USDC went straight to 3 wallets of the orchestra/);
      const after = await Promise.all([SHAKA, NICK, VITALIK].map((a) => balanceOf(8453, USDC[8453], a)));
      assert.deepEqual(after.map((x, i) => x - before[i]), [4_815_500n, 4_815_500n, 369_001n]);
      if (atomic) {
        assert.equal(batches.length, 1);
        assert.equal(batches[0].calls.length, 3);
        assert.equal(sends(), 0, 'no single transfers when the wallet batches');
      } else {
        assert.equal(batches.length, 0);
        assert.equal(sends(), 3);
        assert.ok(calls.some((c) => c.method === 'wallet_getCapabilities'));
      }
    } finally { await context.close(); }
  });
}

test('M7: on a 390 px phone the circle count stays on screen next to the 💸 pill', async () => {
  const { context, page } = await open(WHO, {}, { width: 390, height: 844 });
  try {
    await enter(page);
    const box = (sel) => page.locator(sel).boundingBox();
    const [tip, count] = await Promise.all([box('#tip-open'), box('#count')]);
    for (const [n, b] of [['tip', tip], ['count', count]]) assert.ok(b && b.x >= 0 && b.x + b.width <= 390, `${n} is on screen: ${JSON.stringify(b)}`);
  } finally { await context.close(); }
});

test('a chain that stopped producing blocks is refused at review (sunset L2s like Lisk)', async () => {
  const { context, page, calls } = await open(WHO, { startChain: 8453, staleChain: true });
  try {
    await openPanel(page);
    await pick(page, 'input[name=tip-artist][value=shaka]');
    await pick(page, 'input[name=tip-chain][value="8453"]');
    await page.locator('[data-connect]').click();
    await waitStatus(page, /Connected/);
    await page.locator('[data-act=review]').click();
    await waitStatus(page, /has not produced a block for 60 minutes — it looks stopped/);
    assert.equal(calls.filter((c) => c.method === 'eth_sendTransaction').length, 0);
  } finally { await context.close(); }
});

/* ── QA pass 2 (B2 · H4 · H5 · M14) ───────────────────────────────────────────────────── */
async function startShakaTip(page, amount = '4') {
  await openPanel(page);
  await pick(page, 'input[name=tip-artist][value=shaka]');
  await pick(page, 'input[name=tip-chain][value="8453"]');
  await page.locator('#tip-amount').fill(amount);
  await page.locator('[data-connect]').click();
  await waitStatus(page, /Connected/);
  await page.locator('[data-act=review]').click();
  await waitStatus(page, /Everything checks out/);
}
async function reopenAndContinue(page) {
  await page.reload();
  await enter(page);
  await page.locator('#tip-open').click();
  await page.locator('[data-connect]').click();
  await waitStatus(page, /Connected/);
  await page.locator('[data-act=resume]').click();
}

test('B2: the fan approved in the wallet but the page reloaded mid-prompt → continue finds the transfer, never pays twice', async () => {
  const { context, page, sends } = await open(WHO, { startChain: 8453, hangAfterBroadcast: new Set([1]) });
  try {
    await startShakaTip(page, '4');
    const before = await balanceOf(8453, USDC[8453], SHAKA);
    await page.locator('[data-act=send]').click();
    await page.waitForFunction(() => /confirm 4 USDC/.test(document.querySelector('#tip-status').textContent));
    await new Promise((r) => setTimeout(r, 1500));
    await reopenAndContinue(page);
    await waitStatus(page, /Done — 4 USDC/);
    assert.equal((await balanceOf(8453, USDC[8453], SHAKA)) - before, 4_000_000n, 'paid exactly once');
    assert.equal(sends(), 1);
  } finally { await context.close(); }
});

test('B2: the prompt was left open (never approved) and the page reloaded → continue asks the fan to close it, then sends once', async () => {
  const { context, page, sends } = await open(WHO, { startChain: 8453, hangNoBroadcast: new Set([1]) });
  try {
    await startShakaTip(page, '1.5');
    const before = await balanceOf(8453, USDC[8453], SHAKA);
    await page.locator('[data-act=send]').click();
    await page.waitForFunction(() => /confirm 1\.5 USDC/.test(document.querySelector('#tip-status').textContent));
    await reopenAndContinue(page);
    await waitStatus(page, /close any open request in your wallet/);
    assert.equal(sends(), 1, 'nothing re-sent without the fan confirming');
    await page.locator('[data-act=confirm-resend]').click();
    await waitStatus(page, /Done — 1\.5 USDC/);
    assert.equal((await balanceOf(8453, USDC[8453], SHAKA)) - before, 1_500_000n);
    assert.equal(sends(), 2);
  } finally { await context.close(); }
});

test('H4: batch went through, wallet then errored, fan is a smart account (nonce never moves) → continue finds every transfer, pays nobody twice', async () => {
  const { context, page, batches } = await open(WHO, { config: ORCH_CONFIG, startChain: 8453, atomic: true, batchErrorAfterExec: true, statusUnknown: true });
  try {
    await openPanel(page);
    await page.locator('[data-mode=orchestra]').click();
    await page.waitForFunction(() => /2 distinct wallets/.test(document.querySelector('#tip .body').textContent), null, { timeout: 30_000 });
    await pick(page, 'input[name=tip-chain][value="8453"]');
    await page.locator('#tip-amount').fill('6');
    await page.locator('[data-connect]').click();
    await waitStatus(page, /Connected/);
    await page.locator('[data-act=review]').click();
    await waitStatus(page, /Everything checks out/);
    const before = await Promise.all([SHAKA, NICK, VITALIK].map((a) => balanceOf(8453, USDC[8453], a)));
    await page.locator('[data-act=send]').click();
    await waitStatus(page, /answered the batch with an error/);
    await rpc(8453, 'anvil_setCode', [FAN, '0x6080604052']); // now the fan looks like a smart account
    try {
      await page.locator('[data-act=send]').click(); // continue
      await waitStatus(page, /Done — 6 USDC/);
    } finally { await rpc(8453, 'anvil_setCode', [FAN, '0x']); }
    const after = await Promise.all([SHAKA, NICK, VITALIK].map((a) => balanceOf(8453, USDC[8453], a)));
    assert.deepEqual(after.map((x, i) => x - before[i]), [2_889_300n, 2_889_300n, 221_400n], 'each payee exactly once');
    assert.equal(batches.length, 1, 'the batch was never submitted again');
  } finally { await context.close(); }
});

test('H5/H6: ambiguous wallet_sendCalls error → the page never re-submits a batch the wallet may have accepted, nothing is paid twice', async () => {
  const { context, page, batches, sends } = await open(WHO, { config: ORCH_CONFIG, startChain: 8453, atomic: true, batchErrorNoExec: true });
  try {
    await openPanel(page);
    await page.locator('[data-mode=orchestra]').click();
    await page.waitForFunction(() => /2 distinct wallets/.test(document.querySelector('#tip .body').textContent), null, { timeout: 30_000 });
    await pick(page, 'input[name=tip-chain][value="8453"]');
    await page.locator('#tip-amount').fill('10');
    await page.locator('[data-connect]').click();
    await waitStatus(page, /Connected/);
    await page.locator('[data-act=review]').click();
    await waitStatus(page, /Everything checks out/);
    const before = await Promise.all([SHAKA, NICK, VITALIK].map((a) => balanceOf(8453, USDC[8453], a)));
    await page.locator('[data-act=send]').click();
    await waitStatus(page, /answered the batch with an error/);
    await page.locator('[data-act=send]').click(); // continue
    await waitStatus(page, /no longer knows this batch .* will not send it again/);
    const after = await Promise.all([SHAKA, NICK, VITALIK].map((a) => balanceOf(8453, USDC[8453], a)));
    assert.deepEqual(after.map((x, i) => x - before[i]), [0n, 0n, 0n]);
    assert.equal(batches.length, 1, 'never re-submitted');
    assert.equal(sends(), 0);
  } finally { await context.close(); }
});

test('M14: without Web Locks the tip still works (localStorage lease)', async () => {
  const { context, page } = await open(WHO, { startChain: 8453, noLocks: true });
  try {
    assert.equal(await page.evaluate(() => navigator.locks), undefined);
    await startShakaTip(page, '0.5');
    await page.locator('[data-act=send]').click();
    await waitStatus(page, /Done — 0\.5 USDC/);
  } finally { await context.close(); }
});
