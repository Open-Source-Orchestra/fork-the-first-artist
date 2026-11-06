import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { createPreviewServer } from '../server.mjs';

test('preview serves only public assets and refuses writes and repository paths', async (t) => {
  const server = createPreviewServer({ projectId: '' });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  function get(path, method = 'GET') {
    return new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path, method }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    });
  }

  const home = await get('/');
  assert.equal(home.status, 200);
  assert.match(home.headers['content-type'], /^text\/html/);
  assert.match(home.body, /Everyone plays/);
  assert.match(home.body, /Browse all 40 public artist previews/);
  assert.doesNotMatch(home.body, /keeps every cent|Claim this seat/);
  assert.match((await get('/home')).body, /Sample profile/);
  assert.match((await get('/circle-state.mjs')).body, /export function filterArtists/);
  const roster = await get('/circle/artists.mjs');
  assert.equal(roster.status, 200);
  assert.match(roster.body, /export const roster/);
  assert.equal((await get('/circle/img/shaka.jpg')).status, 200);
  assert.equal((await get('/circle/img/../artists.mjs')).status, 404);
  assert.match(home.headers['content-security-policy'], /default-src 'none'/);
  assert.equal(home.headers['x-content-type-options'], 'nosniff');
  const css = await get('/styles.css');
  assert.equal(css.status, 200);
  assert.match(css.headers['content-type'], /^text\/css/);
  assert.equal((await get('/', 'HEAD')).body, '');

  const editor = await get('/draft');
  assert.equal(editor.status, 200);
  assert.equal((await get('/draft?artist=alaska-x-subcult')).status, 200);
  assert.equal((await get('/draft?artist=unknown-private-text')).status, 200);
  assert.match(editor.body, /id="editor-fields" disabled/);
  assert.match(editor.headers['content-security-policy'], /script-src 'self'/);
  assert.match(editor.headers['content-security-policy'], /form-action 'none'/);
  assert.equal((await get('/wallets')).status, 200);
  const wallet = await get('/wallets');
  assert.match(wallet.headers['content-security-policy'], /wss:\/\/relay.walletconnect.com/);
  assert.doesNotMatch(home.headers['content-security-policy'], /connect-src/);
  assert.doesNotMatch(editor.headers['content-security-policy'], /connect-src/);
  const config = JSON.parse((await get('/wallet-config.json')).body);
  assert.equal(config.projectId, '');
  assert.equal(config.enabled, false);
  assert.deepEqual(Object.keys(config).sort(), ['enabled', 'projectId', 'runtimeReady']);
  if (config.runtimeReady) {
    for (const path of ['/hashpack-runtime.mjs', '/hashpack-runtime.mjs.LEGAL.txt', '/walletconnect-license.txt', '/qrcode-license.txt']) {
      assert.equal((await get(path)).status, 200, path);
    }
  }
  for (const path of ['/draft.mjs', '/profile-draft.mjs', '/circle-state.mjs', '/wallets.mjs', '/ethereum-wallet.mjs', '/hedera-wallet.mjs', '/hashpack-ui.mjs']) {
    const module = await get(path);
    assert.equal(module.status, 200);
    assert.match(module.headers['content-type'], /^text\/javascript/);
  }

  for (const path of ['/.env', '/.git/config', '/../README.md', '/%2e%2e/README.md', '/public/../../.env', '/server.mjs', '//styles.css', '/missing']) {
    const response = await get(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.body, 'Not found', path);
  }
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const response = await get('/', method);
    assert.equal(response.status, 405);
    assert.equal(response.headers.allow, 'GET, HEAD');
  }
});

test('public wallet configuration rejects invalid IDs without echoing supplied data', () => {
  assert.throws(() => createPreviewServer({ projectId: 'not-a-project-ID' }), { message: 'REOWN_PROJECT_ID must be empty or a 32-character hexadecimal public project ID.' });
});
