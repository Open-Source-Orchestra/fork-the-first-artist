import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createPreviewServer } from '../server.mjs';

// /pay against a stubbed oso-tip-loop Worker. The stub replays the NDJSON of a REAL production run
// (browser/fixtures/tip-run.ndjson, 6 Nov 2026 23:22Z) so the page's rendering is tested without
// spending testnet HBAR. The live Worker itself is exercised by cloudflare/test/tip-loop.test.ts + docs.
const RUN = readFileSync(new URL('./fixtures/tip-run.ndjson', import.meta.url), 'utf8');
const HEALTH = { ok: true, service: 'oso-tip-loop', network: 'hedera:testnet', tipHbar: 0.1, meterHbar: 0.00369, limits: { dailyCap: 20, remainingToday: 19, nextRunInSeconds: 0 } };
const cors = { 'access-control-allow-origin': '*' };
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

async function open(vp, tip) {
  const context = await browser.newContext({ viewport: vp, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.url().startsWith(base) && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.route('https://oso-tip-loop.shakaverse.workers.dev/health', (r) => r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify(HEALTH) }));
  await page.route('https://oso-tip-loop.shakaverse.workers.dev/tip', tip);
  await page.goto(`${base}/pay`);
  return { context, page, errors };
}

for (const vp of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
  test(`/pay runs the loop and shows every real step with HashScan links at ${vp.width}x${vp.height}`, async () => {
    const { context, page, errors } = await open(vp, (r) => r.fulfill({ contentType: 'application/x-ndjson', headers: cors, body: RUN }));
    try {
      await page.waitForFunction(() => /19 of 20 live runs left today/.test(document.querySelector('#pay-service').textContent));
      await page.locator('#pay-go').click();
      await page.waitForFunction(() => /Loop complete/.test(document.querySelector('#pay-status').textContent));
      const steps = await page.locator('#pay-steps li').allInnerTexts();
      assert.equal(steps.length, 10);
      assert.match(steps[1], /HTTP 402 Payment Required/);
      assert.match(steps.join('\n'), /Fan → steward settled · 0\.1 HBAR/);
      assert.match(steps.join('\n'), /forwards 96\.31% → artist · 0\.09631 HBAR/);
      assert.match(steps.join('\n'), /topic 0\.0\.11345907 · sequence 6/);
      const hrefs = await page.locator('#pay-steps a').evaluateAll((as) => as.map((a) => a.href));
      assert.ok(hrefs.includes('https://hashscan.io/testnet/transaction/0.0.9185802-1794007315-772507168'));
      assert.ok(hrefs.includes('https://hashscan.io/testnet/transaction/0.0.11345897-1794007320-053355411'));
      assert.ok(hrefs.every((h) => h.startsWith('https://hashscan.io/testnet/')));
      assert.equal(await page.locator('#pay-answer').isVisible(), true);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      assert.equal(overflow, false);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}

test('/pay shows an honest busy message + recorded proof on 429, and no steps', async () => {
  const { context, page, errors } = await open({ width: 1280, height: 800 }, (r) => r.fulfill({ status: 429, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: false, error: 'RATE_LIMITED', reason: 'cooldown', retryAfterSeconds: 41, message: 'someone just ran the live loop — try again shortly' }) }));
  try {
    await page.waitForFunction(() => !document.querySelector('#pay-fields').disabled);
    await page.locator('#pay-go').click();
    await page.waitForFunction(() => /Retry in 41s/.test(document.querySelector('#pay-status').textContent));
    assert.equal(await page.locator('#pay-steps-card').isHidden(), true);
    assert.match(await page.locator('#pay-status a').getAttribute('href'), /TX-PROOF\.md$/);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('/pay renders a mid-loop failure as an error, never as success', async () => {
  const lines = RUN.split('\n').filter(Boolean).slice(0, 6);
  lines.push(JSON.stringify({ step: 'error', ok: false, failedStep: 'forward', message: 'steward forward to the artist failed: test', moneyMoved: 'fan -> steward settled (0.0.9185802@1794007315.772507168)' }));
  const { context, page } = await open({ width: 1280, height: 800 }, (r) => r.fulfill({ contentType: 'application/x-ndjson', headers: cors, body: `${lines.join('\n')}\n` }));
  try {
    await page.waitForFunction(() => !document.querySelector('#pay-fields').disabled);
    await page.locator('#pay-go').click();
    await page.waitForFunction(() => /honest error/.test(document.querySelector('#pay-status').textContent));
    assert.equal(await page.locator('#pay-steps li.error').count(), 1);
    assert.equal(await page.locator('#pay-steps li.done').count(), 0);
    assert.match(await page.locator('#pay-steps li.error').innerText(), /stopped at “forward”/);
  } finally {
    await context.close();
  }
});

test('/pay with the Worker unreachable stays disabled and says so', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('https://oso-tip-loop.shakaverse.workers.dev/**', (r) => r.abort());
  try {
    await page.goto(`${base}/pay`);
    await page.waitForFunction(() => /unreachable/.test(document.querySelector('#pay-service').textContent));
    assert.equal(await page.evaluate(() => document.querySelector('#pay-fields').disabled), true);
    assert.equal(await page.locator('#pay-go').isDisabled(), true);
  } finally {
    await context.close();
  }
});
