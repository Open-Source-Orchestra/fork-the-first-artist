import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (p) => readFile(new URL(`../public/${p}`, import.meta.url), 'utf8');

test('garden circle is the front door and carries the fork layer', async () => {
  const [html, app, fork] = await Promise.all([read('index.html'), read('app.js'), read('fork.js')]);
  assert.match(html, /The <em>Full Circle<\/em>/);
  assert.match(html, /<script type="module" src="\.\/fork\.js[^"]*"><\/script>\s*<script type="module" src="\.\/app\.js/);
  assert.match(app, /new CustomEvent\('fork:artist'/);
  assert.match(app, /hash !== 'fork'/);
  // No relative links that only resolve on opensourceorchestra.org.
  assert.doesNotMatch(html, /href="\.\.\/|href="\/(takedown|schedule)\//);
  assert.doesNotMatch(await read('data/artists.json'), /"\.\.\//);
  assert.doesNotMatch(await read('keys.js'), /fetch\('\.\.\//);
  // The fork layer never fabricates an answer or a claim.
  assert.match(fork, /No mock answer/i);
  assert.doesNotMatch(fork, /status = 'issued'|claimed = true/);
});

test('no-JS visitors get every circle artist and the proof routes', async () => {
  const html = await read('index.html');
  const { artists } = JSON.parse(await read('data/artists.json'));
  const noScript = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? '';
  for (const a of artists.filter((x) => x.kind !== 'away')) {
    const name = a.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    assert.ok(noScript.includes(name), `no-JS list omits ${a.name}`);
  }
  for (const route of ['/list', '/steward', '/arkiv']) assert.ok(noScript.includes(`href="${route}"`), route);
});

test('ENS registry starts honest: no artist listed without consent', async () => {
  const reg = JSON.parse(await read('fork/registry.json'));
  assert.equal(reg.parent, 'osoartist.eth');
  for (const [slug, a] of Object.entries(reg.artists)) {
    assert.match(slug, /^[a-z0-9-]+$/);
    assert.ok(['approved', 'issued'].includes(a.status), `${slug} has a status`);
    if (a.status === 'issued') assert.match(a.owner ?? '', /^0x[0-9a-fA-F]{40}$/, `${slug} issued names need the artist's own owner address`);
  }
});
