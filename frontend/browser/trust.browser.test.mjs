import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createPreviewServer } from '../server.mjs';
import { loadTrusted, verifyTrustChain } from '../../ens/src/trust.mjs';

// End to end through the real pages: root steward invites → artist consents with own wallet →
// steward approves → the server-side issuer check (ens/src/trust.mjs) accepts the bundle.
// Wallets are throwaway keys injected as a minimal EIP-1193 provider; stewards.json is swapped
// for one rooted at the throwaway root (the real root is Shaka's osoartist.eth owner key).
const { generatePrivateKey, privateKeyToAccount } = createRequire(new URL('../../ens/package.json', import.meta.url))('viem/accounts');
const root = privateKeyToAccount(generatePrivateKey());
const artist = privateKeyToAccount(generatePrivateKey());
const stewardsDoc = { v: 1, root: { address: root.address, name: 'Test Root' }, stewards: [] };

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

async function pageAs(account) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  await context.route('**/fork/stewards.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(stewardsDoc) }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.exposeFunction('__sign', async (hex) => account.signMessage({ message: { raw: hex } }));
  await page.addInitScript((address) => {
    window.ethereum = { request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts') return [address];
      if (method === 'personal_sign') return window.__sign(params[0]);
      throw new Error(`unsupported ${method}`);
    } };
  }, account.address);
  return { page, context, errors };
}

test('steward invites, artist consents, steward approves — issuer accepts the chain', async () => {
  const s = await pageAs(root);
  await s.page.goto(`${base}/admin?artist=shaka`);
  await s.page.locator('#connect').click();
  await s.page.waitForFunction(() => /root steward/.test(document.querySelector('#who-status').textContent));
  assert.equal(await s.page.locator('#artist').inputValue(), 'shaka');
  assert.equal(await s.page.locator('#label').inputValue(), 'shaka');
  await s.page.locator('#invite-go').click();
  await s.page.locator('#invite-out:not([hidden])').waitFor();
  const link = await s.page.locator('#invite-link').inputValue();
  assert.match(link, /\/consent\?invite=[A-Za-z0-9_-]+$/);

  const a = await pageAs(artist);
  await a.page.goto(link.replace(/^https?:\/\/[^/]+/, base));
  await a.page.waitForFunction(() => /invited/.test(document.querySelector('#invite-banner').textContent));
  assert.match(await a.page.locator('#invite-banner').textContent(), /Test Root.*invited.*shaka\.osoartist\.eth/s);
  assert.equal(await a.page.locator('#label').inputValue(), 'shaka');
  await a.page.locator('#connect').click();
  await a.page.waitForFunction(() => !document.querySelector('#sign').disabled);
  await a.page.locator('#sign').click();
  await a.page.locator('#out-card:not([hidden])').waitFor();
  const consentJson = await a.page.locator('#json').textContent();
  assert.match(consentJson, /"inviteId"/);

  await s.page.locator('#claim').fill(consentJson);
  await s.page.locator('#check').click();
  await s.page.waitForFunction(() => !document.querySelector('#approve-go').disabled);
  assert.equal(await s.page.locator('#checks .bad').count(), 0);
  await s.page.locator('#approve-go').click();
  await s.page.locator('#approve-out:not([hidden])').waitFor();
  const approved = JSON.parse(await s.page.locator('#approve-json').textContent());

  const r = await verifyTrustChain(approved, await loadTrusted(stewardsDoc));
  assert.equal(r.slug, 'shaka');
  assert.equal(r.inviter.role, 'root');
  assert.deepEqual([...s.errors, ...a.errors], []);
  await s.context.close(); await a.context.close();
});

test('consent without an invitation cannot be signed; a non-steward wallet gets no desk', async () => {
  const a = await pageAs(artist);
  await a.page.goto(`${base}/consent`);
  await a.page.waitForFunction(() => /Invitation needed/.test(document.querySelector('#invite-banner').textContent));
  await a.page.locator('#connect').click();
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator('#sign').isDisabled(), true);
  await a.page.goto(`${base}/admin`);
  await a.page.locator('#connect').click();
  await a.page.waitForFunction(() => /not a steward/.test(document.querySelector('#who-status').textContent));
  assert.equal(await a.page.locator('#invite-fields').evaluate((f) => f.disabled), true);
  assert.deepEqual(a.errors, []);
  await a.context.close();
});
