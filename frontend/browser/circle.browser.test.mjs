import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
import axe from 'axe-core';
import { createPreviewServer } from '../server.mjs';

const viewports = [
  { name: 'desktop-1280x800', width: 1280, height: 800 },
  { name: 'mobile-375x812', width: 375, height: 812 },
  { name: 'small-320x568', width: 320, height: 568 },
];
const report = { hitTesting: [], accessibility: [], generatedAt: new Date().toISOString() };
let server;
let browser;
let base;

before(async () => {
  server = createPreviewServer({ projectId: '' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (process.env.CIRCLE_BROWSER_REPORT) {
    await mkdir(dirname(process.env.CIRCLE_BROWSER_REPORT), { recursive: true });
    await writeFile(process.env.CIRCLE_BROWSER_REPORT, `${JSON.stringify(report, null, 2)}\n`);
  }
});

async function withPage(viewport, callback, { javaScriptEnabled = true } = {}) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: 'reduce',
    javaScriptEnabled,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));
  try {
    await callback(page, context);
    assert.deepEqual(errors, [], 'no browser runtime or local-request errors');
  } finally {
    await context.close();
  }
}

async function assertNoOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.ok(dimensions.scroll <= dimensions.client, `horizontal overflow: ${dimensions.scroll} > ${dimensions.client}`);
}

for (const viewport of viewports) {
  test(`every seat center hits its own native button at ${viewport.name}`, async () => {
    await withPage(viewport, async (page) => {
      const response = await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200);
      await assertNoOverflow(page);
      await page.getByRole('searchbox', { name: 'Find an artist by name' }).waitFor({ state: 'visible' });
      const seats = page.locator('.seat');
      assert.equal(await seats.count(), 40);
      assert.equal(await page.locator('#ring > li').count(), 40);
      const hits = [];
      for (let index = 0; index < 40; index += 1) {
        const seat = seats.nth(index);
        await seat.scrollIntoViewIfNeeded();
        const hit = await seat.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const x = bounds.left + bounds.width / 2;
          const y = bounds.top + bounds.height / 2;
          const target = document.elementFromPoint(x, y);
          return {
            slug: element.dataset.slug,
            width: bounds.width,
            height: bounds.height,
            centerInViewport: x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight,
            ownButton: target?.closest('.seat') === element,
            hit: target?.closest('.seat')?.dataset.slug ?? target?.tagName ?? null,
          };
        });
        hits.push(hit);
      }
      const intercepted = hits.filter((hit) => !hit.ownButton || !hit.centerInViewport);
      report.hitTesting.push({ viewport, total: hits.length, intercepted, hits });
      assert.deepEqual(intercepted, [], `${viewport.name}: wrong-seat or offscreen centers`);
      const cta = page.locator('#spin');
      await cta.scrollIntoViewIfNeeded();
      assert.equal(await cta.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('#spin') === element;
      }), true, 'CTA is not obstructed');
      await assertNoOverflow(page);
      if (process.env.CIRCLE_BROWSER_ARTIFACTS) {
        await mkdir(process.env.CIRCLE_BROWSER_ARTIFACTS, { recursive: true });
        await page.screenshot({ path: `${process.env.CIRCLE_BROWSER_ARTIFACTS}/${viewport.name}.png`, fullPage: true });
      }
    });
  });
}

test('native semantics, accessible search, and filter controls precede all seats', async () => {
  await withPage(viewports[0], async (page) => {
    await page.goto(`${base}/`);
    assert.equal(await page.locator('#ring > li[role]').count(), 0);
    assert.equal(await page.locator('#ring .seat[role]').count(), 0);
    assert.equal(await page.locator('#ring > li').count(), 40);
    assert.equal(await page.locator('#ring > li > button.seat').count(), 40);
    const search = page.getByRole('searchbox', { name: 'Find an artist by name' });
    assert.equal(await search.count(), 1);
    assert.equal(await search.isVisible(), true);
    assert.equal(await page.locator('#find').evaluate((element) => Boolean(element.labels?.[0]?.textContent.trim())), true);
    assert.equal(await page.locator('#pills button[data-day]').evaluateAll((buttons) => buttons.every((button) => button.hasAttribute('aria-pressed'))), true);
    assert.equal(await page.locator('#finder').evaluate((element) => Boolean(element.compareDocumentPosition(document.querySelector('#ring')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
    assert.equal(await page.locator('#pills').evaluate((element) => Boolean(element.compareDocumentPosition(document.querySelector('#ring')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);

    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'find', 'search is the second tab stop, not behind 40 seats');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.day), 'all');
  });
});

for (const viewport of viewports) {
  test(`combined filters and complete reset stay consistent at ${viewport.name}`, async () => {
    await withPage(viewport, async (page) => {
      await page.goto(`${base}/`);
      const visibleSeats = page.locator('#ring > li:not([hidden]) .seat');
      await page.locator('[data-day="3"]').click();
      assert.equal(await page.locator('[data-day="3"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('[data-day="all"]').getAttribute('aria-pressed'), 'false');
      await page.locator('#find').fill('Alaska');
      await page.waitForFunction(() => document.querySelector('#count').textContent === '0 of 40');
      assert.equal(await visibleSeats.count(), 0, 'Nov 3 + Alaska must not show a Nov 4 set');
      assert.equal(await page.locator('#ring > li[hidden][aria-hidden="true"]').count(), 40);
      assert.equal(await page.locator('#ring .seat[tabindex="-1"]').count(), 40);

      await page.locator('[data-day="4"]').click();
      await page.waitForFunction(() => document.querySelector('#count').textContent === '1 of 40');
      assert.equal(await visibleSeats.count(), 1);
      assert.equal(await visibleSeats.first().getAttribute('data-slug'), 'alaska-x-subcult');

      await page.locator('#reset-filters').click();
      assert.equal(await page.locator('#find').inputValue(), '');
      assert.equal(await visibleSeats.count(), 40);
      assert.equal(await page.locator('#count').textContent(), '40 of 40');
      assert.equal(await page.locator('[data-day="all"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('[data-day="3"]').getAttribute('aria-pressed'), 'false');

      await page.locator('#find').fill('0xMentalist');
      for (const day of [3, 4, 5, 6]) {
        await page.locator(`[data-day="${day}"]`).click();
        assert.equal(await visibleSeats.count(), 1, `multi-day artist on Nov ${day}`);
        assert.equal(await visibleSeats.first().getAttribute('data-slug'), '0xmentalist');
      }
      await page.locator('#find').fill('Alaska');
      await page.locator('[data-day="3"]').click();
      await page.locator('#spin').click();
      assert.equal(await page.locator('#find').inputValue(), '');
      assert.equal(await visibleSeats.count(), 40, 'show-everyone reset clears stale query and highlights');
      assert.equal(await page.locator('[data-day="all"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#count').textContent(), '40 of 40');
    });
  });
}

test('native dialog opens by keyboard, Escape closes it, and focus returns to its seat', async () => {
  await withPage(viewports[0], async (page) => {
    await page.goto(`${base}/`);
    const seat = page.locator('.seat[data-slug="alaska-x-subcult"]');
    await seat.focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('#profile');
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await page.locator('#p-name').textContent(), 'Alaska × Subcult — live coding');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'p-close');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement.dataset.slug), 'alaska-x-subcult');
    await page.keyboard.press('Space');
    await dialog.waitFor({ state: 'visible' });
    await page.locator('#p-close').click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement.dataset.slug), 'alaska-x-subcult');
  });
});

test('CTA prefills only the selected public name and removes its transient slug', async () => {
  await withPage(viewports[1], async (page) => {
    await page.goto(`${base}/`);
    await page.locator('.seat[data-slug="alaska-x-subcult"]').click();
    const draftLink = page.locator('#p-draft');
    assert.equal(await draftLink.textContent(), 'Start a local draft');
    assert.equal(await draftLink.getAttribute('href'), '/draft?artist=alaska-x-subcult');
    await draftLink.click();
    await page.waitForURL((url) => url.pathname === '/draft');
    assert.equal(await page.locator('#draft-name').inputValue(), 'Alaska × Subcult — live coding');
    assert.equal(await page.locator('#draft-bio').inputValue(), '');
    assert.equal(new URL(page.url()).search, '');
    assert.equal(await page.locator('#draft-preview').isVisible(), false);
    assert.equal(await page.evaluate(() => localStorage.length), 0);

    await page.goto(`${base}/draft?artist=${encodeURIComponent('<img src=x onerror=alert(1)>')}&private=never-copy-this`);
    await page.waitForFunction(() => document.querySelector('#editor-fields').disabled === false);
    assert.equal(await page.locator('#draft-name').inputValue(), '');
    assert.equal(new URL(page.url()).search, '');
    assert.equal(await page.locator('body').textContent().then((text) => text.includes('never-copy-this')), false);
  });
});

test('no-JS has a useful 40-artist list, working project routes, and no 0/0 state', async () => {
  await withPage(viewports[2], async (page) => {
    const response = await page.goto(`${base}/`);
    assert.equal(response.status(), 200);
    assert.equal(await page.locator('.seat').count(), 0);
    assert.equal(await page.locator('.no-js-artists > li').count(), 40);
    assert.equal(await page.locator('section.no-js').isVisible(), true);
    assert.equal(await page.locator('.controls').isVisible(), false);
    assert.equal(await page.locator('#spin').isVisible(), false);
    assert.equal(await page.locator('#count').textContent(), '40 of 40');
    assert.equal(await page.locator('section.no-js a[href="https://opensourceorchestra.org/garden/circle/"]').count(), 1);
    await assertNoOverflow(page);
    for (const route of ['/home', '/draft', '/wallets']) {
      const routed = await page.goto(base + route);
      assert.equal(routed.status(), 200, route);
      await assertNoOverflow(page);
      if (route === '/draft') {
        assert.equal(await page.locator('#editor-fields').evaluate((element) => element.disabled), true);
        assert.equal(await page.locator('#draft-name').isDisabled(), true);
      }
    }
  }, { javaScriptEnabled: false });
});

test('axe WCAG audit is clean on every public route at all three viewports', async () => {
  for (const viewport of viewports) {
    await withPage(viewport, async (page) => {
      for (const route of ['/', '/home', '/draft', '/wallets']) {
        const response = await page.goto(base + route);
        assert.equal(response.status(), 200);
        await page.evaluate(axe.source);
        const violations = await page.evaluate(async () => {
          const result = await axe.run(document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2b', 'wcag21aa', 'wcag22aa'] },
          });
          return result.violations.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            nodes: violation.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
          }));
        });
        report.accessibility.push({ viewport, route, violations });
        assert.deepEqual(violations, [], `${viewport.name} ${route}: axe violations`);
        await assertNoOverflow(page);
      }
    });
  }
});
