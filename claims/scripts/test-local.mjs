// Runs only on a fresh private temporary cluster; never opens an existing database.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';

const bin = process.env.PG_BIN ?? '/opt/homebrew/opt/postgresql@18/bin';
const directory = mkdtempSync(join(tmpdir(), 'oso-claims-pg-'));
const data = join(directory, 'data');
const password = randomBytes(24).toString('hex');
const passwordFile = join(directory, 'password');
writeFileSync(passwordFile, password, { mode: 0o600 });
const probe = createServer();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
let started = false;
function stop() {
  if (!started) return;
  execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-w', '-m', 'fast', 'stop'], { stdio: 'pipe', timeout: 30000 });
  started = false;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop(); process.exit(1); });
try {
  execFileSync(join(bin, 'initdb'), ['-D', data, '--username=claims_test', `--pwfile=${passwordFile}`, '--auth-local=trust', '--auth-host=scram-sha-256', '--no-locale', '--encoding=UTF8'], { stdio: 'pipe', timeout: 60000 });
  try {
    // TCP only: avoid Unix-socket path limits in macOS temporary directories.
    execFileSync(join(bin, 'pg_ctl'), ['-D', data, '-l', join(directory, 'server.log'), '-o', `-h 127.0.0.1 -p ${port} -k ''`, '-w', 'start'], { stdio: 'pipe', timeout: 30000 });
    started = true;
  } catch (error) {
    // A timed-out start may still have launched the server; clean it up too.
    try { execFileSync(join(bin, 'pg_ctl'), ['-D', data, 'status'], { stdio: 'pipe' }); started = true; } catch {}
    throw error;
  }
  const url = `postgresql://claims_test:${password}@127.0.0.1:${port}/postgres`;
  const child = spawn(process.execPath, ['--test', 'test/config.test.mjs', 'test/steward.integration.test.mjs'], {
    cwd: new URL('../', import.meta.url), env: { ...process.env, TEST_DATABASE_URL: url }, stdio: 'inherit',
  });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  process.exitCode = code ?? 1;
} finally {
  stop();
  console.log('Temporary PostgreSQL cluster stopped. Test data retained in a private temporary directory.');
}
