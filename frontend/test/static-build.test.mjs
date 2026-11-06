import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/build-static.mjs', import.meta.url));
const exists = async (path) => { try { await stat(path); return true; } catch { return false; } };

test('static build creates public routes/assets and keeps wallets disabled without secrets', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'artist-static-test-'));
  t.after(async () => { await import('node:fs/promises').then(({ rm }) => rm(temp, { recursive: true, force: true })); });
  const out = join(temp, 'site');
  await execute(process.execPath, [script, out, '--cname=artist.example.org'], { env: { ...process.env, REOWN_PROJECT_ID: '' } });
  for (const path of ['index.html', 'home/index.html', 'draft/index.html', 'wallets/index.html', 'arkiv/index.html', 'steward/index.html', 'steward.mjs', 'circle/artists.mjs', 'circle/img/shaka.jpg', 'arkiv-proof.json', 'arkiv-query.mjs', 'CNAME', '.nojekyll']) {
    assert.equal(await exists(join(out, path)), true, path);
  }
  const config = JSON.parse(await readFile(join(out, 'wallet-config.json'), 'utf8'));
  assert.deepEqual(config, { projectId: '', runtimeReady: false, enabled: false });
  assert.equal(await exists(join(out, '.env')), false);
  assert.equal(await exists(join(out, 'hashpack-runtime.mjs')), false);
  const images = await readdir(join(out, 'circle/img'));
  assert.equal(images.filter((name) => name.endsWith('.jpg')).length, 23);
  assert.equal(await readFile(join(out, 'CNAME'), 'utf8'), 'artist.example.org\n');
});

test('static build refuses to erase an unmarked directory', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'artist-static-refuse-'));
  t.after(async () => { await import('node:fs/promises').then(({ rm }) => rm(temp, { recursive: true, force: true })); });
  await mkdir(join(temp, 'existing'), { recursive: true });
  await writeFile(join(temp, 'existing', 'keep.txt'), 'keep');
  await assert.rejects(execute(process.execPath, [script, join(temp, 'existing')]), /Refusing to clean/);
  assert.equal(await readFile(join(temp, 'existing', 'keep.txt'), 'utf8'), 'keep');
});
