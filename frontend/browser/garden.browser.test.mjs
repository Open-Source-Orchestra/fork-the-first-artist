import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createPreviewServer } from '../server.mjs';

// The garden circle front door with the Fork the First Artist layer.
// Requests to the live 0G Worker are blocked here (CORS only allows the deployed origins), so
// the test also proves the layer degrades honestly — no mock answer — when 0G is unreachable.
let server; let browser; let base;
before(async () => {
  server = createPreviewServer({ projectId: '' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

for (const vp of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
  test(`garden circle loads, opens an artist with the fork card and the fork panel at ${vp.width}x${vp.height}`, async () => {
    const context = await browser.newContext({ viewport: vp, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => { if (r.url().startsWith(base)) errors.push(`requestfailed: ${r.url()}`); });
    page.on('response', (r) => { if (r.url().startsWith(base) && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    await page.route('https://oso-zerog-steward.shakaverse.workers.dev/**', (route) => route.abort());
    await page.route('https://opensourceorchestra.org/**', (route) => route.abort());
    try {
      await page.goto(`${base}/#shaka`);
      await page.locator('#enter').click({ timeout: 20000 });
      await page.waitForFunction(() => window.__circleReady === true || !document.querySelector('#fallback').hidden, null, { timeout: 30000 });
      assert.equal(await page.locator('#fallback').isHidden(), true, '3D circle started (no list fallback)');
      await page.locator('#detail.open .fork-card').waitFor({ timeout: 10000 });
      assert.match(await page.locator('.fork-card .ens').textContent(), /^shaka\.osoartist\.eth$/);
      // shaka.osoartist.eth is issued on mainnet (PR #8) → a real "pay Shaka" button next to the example one
      assert.match(await page.locator('.fork-card .ens-state').textContent(), /^issued · owned by 0x2596…c934/);
      assert.equal(await page.locator('.fork-card [data-fork-pay]').getAttribute('href'), '/pay?artist=shaka');
      assert.equal((await page.locator('.fork-card [data-fork-pay]').textContent()).trim(), '💸 pay Shaka · x402 testnet');
      assert.equal((await page.locator('.fork-card [data-fork-open]').textContent()).trim(), '⚡ see an example x402 payment');
      assert.equal(await page.locator('.fork-card [data-fork-payout]').getAttribute('href'), '/payout?artist=shaka');
      assert.match(await page.locator('.fork-card .fine').innerText(), /His name is issued to his own wallet/);
      assert.equal((await page.locator('.fork-card [data-fork-ask]').textContent()).trim(), "🧠 ask Shaka's steward · live 0G");
      await page.locator('.fork-card [data-fork-open]').click();
      await page.locator('#fork.open').waitFor();
      // The panel's default steward is still the fictional Mira…
      assert.equal(await page.locator('#fork [data-steward="mira-modal"]').getAttribute('aria-pressed'), 'true');
      assert.match(await page.locator('#fork-chips').innerText(), /List Mira's songs/);
      // …and Shaka's card button switches it to Shaka's own steward.
      await page.evaluate(() => document.querySelector('.fork-card [data-fork-ask]').click());
      assert.equal(await page.locator('#fork [data-steward="shaka"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#fork [data-steward="mira-modal"]').getAttribute('aria-pressed'), 'false');
      assert.match(await page.locator('#fork-chips').innerText(), /What does Shaka play\?[\s\S]*When is Shaka's talk\?/);
      assert.match(await page.locator('#fork-who-note').innerText(), /only on his public garden profile/);
      assert.match(await page.locator('#fork-ask-h').innerText(), /Ask Shaka's steward/);
      await page.waitForFunction(() => /unavailable|live/.test(document.querySelector('#fork-zg-badge')?.textContent || ''));
      assert.equal(await page.locator('#fork-zg-badge').textContent(), 'unavailable');
      assert.equal(await page.locator('#fork-answer').isHidden(), true, 'no mock answer');
      assert.match(await page.locator('#fork-ask-status').textContent(), /No mock answer/);
      assert.match(await page.locator('#fork-arkiv-kv').innerText(), /0xf5ac4a62/);
      assert.equal(await page.locator('#fork-open').isVisible(), true);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      assert.equal(overflow, false);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
}

const ZG = 'https://oso-zerog-steward.shakaverse.workers.dev';
const corsJson = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

async function openArtist(page, slug, name) {
  if (!page.url().startsWith(base)) {
    await page.goto(`${base}/#${slug}`);
    await page.locator('#enter').click({ timeout: 20000 });
    await page.waitForFunction(() => window.__circleReady === true || !document.querySelector('#fallback').hidden, null, { timeout: 30000 });
  } else {
    await page.evaluate((s) => { location.hash = s; }, slug); // the garden selects on hashchange
  }
  await page.locator(`#detail.open .fork-card[aria-label="fork ${name}"]`).waitFor({ timeout: 10000 });
}

test('every garden artist gets their own preview steward on the fork card; the held-back one gets none', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const asks = [];
  await page.route(`${ZG}/health`, (route) => corsJson(route, { ok: true, provider: '0g', model: 'test-model', inference: 'live 0G Private Computer' }));
  await page.route(`${ZG}/ask`, async (route) => {
    const body = JSON.parse(route.request().postData());
    asks.push(body);
    if (body.instruction === 'slow one') await new Promise((r) => setTimeout(r, 1500));
    return corsJson(route, { ok: true, artist: { slug: body.artist, name: 'DJ Chalk', fictional: false, mode: 'preview', grounding: 'public garden profile only · preview' }, reply: { text: 'DJ Chalk plays the shared tag-team floor.' }, proof: { requestId: 'req-test', model: 'test-model', billingMicro: '120' } });
  });
  await page.route('https://opensourceorchestra.org/**', (route) => route.abort());
  try {
    await openArtist(page, 'dj-chalk', 'DJ Chalk');
    const ask = page.locator('.fork-card [data-fork-ask]');
    assert.equal(await page.locator('.fork-card [data-fork-payout]').count(), 0, 'no payout link before a name is issued');
    assert.equal(await ask.getAttribute('data-fork-ask'), 'dj-chalk');
    assert.equal((await ask.textContent()).trim(), "🧠 ask DJ Chalk's steward · live 0G");
    assert.match(await page.locator('.fork-card .fine').innerText(), /preview that only repeats DJ Chalk's public garden profile/);
    await page.evaluate(() => document.querySelector('.fork-card [data-fork-ask]').click());
    await page.locator('#fork.open').waitFor();
    const toggle = page.locator('#fork [data-steward="dj-chalk"]');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    assert.match(await toggle.innerText(), /DJ Chalk\s*preview/);
    assert.equal(await page.locator('#fork [data-steward="mira-modal"]').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#fork [data-steward="shaka"]').count(), 1, 'Mira and Shaka toggles stay');
    assert.match(await page.locator('#fork-chips').innerText(), /Who is DJ Chalk\?[\s\S]*When does DJ Chalk play\?[\s\S]*Where can I follow DJ Chalk\?/);
    assert.match(await page.locator('#fork-who-note').innerText(), /preview[\s\S]*public garden profile[\s\S]*does not speak for them[\s\S]*consent/);
    assert.match(await page.locator('#fork-ask-h').innerText(), /Ask DJ Chalk's steward/);
    await page.waitForFunction(() => document.querySelector('#fork-zg-badge')?.textContent === 'live · mainnet');
    // A real (mocked-transport) round trip: the request names the artist, the answer is labelled preview.
    await page.locator('#fork-chips [data-q]').first().click();
    await page.locator('#fork-answer').waitFor({ state: 'visible' });
    assert.deepEqual(asks.at(-1), { instruction: 'Who is DJ Chalk?', artist: 'dj-chalk' });
    assert.equal(await page.locator('#fork-said-who').textContent(), "DJ Chalk's steward (preview · public garden profile only) said:");
    // Switching stewards mid-flight never shows the other steward's answer.
    await page.locator('#fork-q').fill('slow one');
    await page.locator('#fork-ask-go').click();
    await page.locator('#fork [data-steward="mira-modal"]').click();
    await page.waitForFunction(() => document.querySelector('#fork-ask-go')?.textContent === 'ask through 0G', null, { timeout: 5000 });
    assert.equal(await page.locator('#fork-answer').isHidden(), true);
    assert.match(await page.locator('#fork-chips').innerText(), /List Mira's songs/);
    // Another artist replaces the one dynamic toggle instead of piling up buttons.
    await page.locator('#fork-x').click();
    await openArtist(page, 'adegbenga', 'Adegbenga');
    assert.equal((await page.locator('.fork-card [data-fork-ask]').textContent()).trim(), "🧠 ask Adegbenga's steward · live 0G");
    await page.evaluate(() => document.querySelector('.fork-card [data-fork-ask]').click());
    await page.locator('#fork.open').waitFor();
    assert.equal(await page.locator('#fork [data-steward-dynamic]').count(), 1);
    assert.equal(await page.locator('#fork [data-steward="adegbenga"]').getAttribute('aria-pressed'), 'true');
    // perrie is held back until she confirms: no steward at all on her card.
    await openArtist(page, 'perrie', 'Perrie');
    assert.equal(await page.locator('.fork-card [data-fork-ask]').count(), 0);
    assert.doesNotMatch(await page.locator('.fork-card').innerText(), /steward · live 0G/);
    assert.ok(asks.every((b) => b.artist !== 'perrie'));
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
