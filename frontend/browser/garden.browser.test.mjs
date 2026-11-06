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
      assert.match(await page.locator('.fork-card .ens-state').textContent(), /not issued/);
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
