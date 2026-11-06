import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
test('help is offline; missing config and removed SQL commands fail without leaking environment values', () => {
  const env = { PATH: process.env.PATH, ARKIV_PRIVATE_KEY: 'private-do-not-echo', ARKIV_ACCESS_KEY: 'access-do-not-echo', ARKIV_NAMESPACE: 'test-only' };
  const help = spawnSync(process.execPath, [cli, '--help'], { env, encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /Arkiv Rabdi/);
  for (const args of [['check'], ['migrate'], ['freeze', '--claim', 'not-valid']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr + result.stdout, /private-do-not-echo|access-do-not-echo/);
  }
});
