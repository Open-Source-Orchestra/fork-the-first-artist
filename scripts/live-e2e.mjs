#!/usr/bin/env node
/**
 * One-command end-to-end run of the whole Fork-the-First-Artist money loop:
 *
 *   1. payments/  x402 rail on Hedera, priced in native HBAR (asset 0.0.0),
 *                 ASK_PAYEE=steward, meter reselling real 0G inference
 *   2. agent/     the artist's steward agent; pays the meter per 0G call (x402)
 *   3. fan agent  agent/scripts/demo.ts — autonomous 402 -> sign -> retry
 *   4. hedera-steward/steward.py (Utkarsh Tiwari) — post-settlement split:
 *                 forwards 96.31% of the settled fan payment to the artist and
 *                 logs the split to HCS, verified on the mirror node
 *   5. writes public-safe proof (tx ids, HashScan links, 0G request ids)
 *
 * Usage:
 *   node scripts/live-e2e.mjs --dev               # mock rail + mock 0G + steward --dry-run (offline)
 *   node scripts/live-e2e.mjs --dev --real-0g     # mock rail, REAL 0G inference (needs 0G key)
 *   node scripts/live-e2e.mjs --live              # real HBAR on testnet + real 0G (accounts must be funded)
 *
 * Options:
 *   --accounts <path>   accounts.env with FORK_DEMO_{FAN,ARTIST,COMPUTE,METER}_* (default: $STEWARD_ACCOUNTS_ENV)
 *   --out <path>        proof markdown (live default docs/TX-PROOF.md; dev default .tmp/live-e2e/TX-PROOF.dev.md)
 *   --steward direct|agent   deterministic SDK split (default) or the LLM Hedera Agent Kit steward
 *   --question "<text>"
 *
 * Secrets: keys are read from the accounts file / key file and passed to child
 * processes through their environment only. Nothing secret is printed or written.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const LIVE = flag('--live');
const DEV = flag('--dev') || !LIVE;
const REAL_0G = LIVE || flag('--real-0g');
const STEWARD_BRAIN = opt('--steward', 'direct');
const QUESTION = opt('--question', 'Who are you, and which song should a first-time fan hear?');
const RUN_DIR = join(ROOT, '.tmp', 'live-e2e', new Date().toISOString().replace(/[:.]/g, '-'));
const OUT = resolve(opt('--out', LIVE ? join(ROOT, 'docs', 'TX-PROOF.md') : join(ROOT, '.tmp', 'live-e2e', 'TX-PROOF.dev.md')));
const ACCOUNTS = opt(
  '--accounts',
  process.env.STEWARD_ACCOUNTS_ENV ??
    '/workspace/vault/ethglobal-mumbai/fork-first-artist-hedera-demo-20261106/accounts.env',
);
const MIRROR = (process.env.HEDERA_MIRROR_NODE ?? 'https://testnet.mirrornode.hedera.com').replace(/\/+$/, '');
const PAY_PORT = Number(process.env.E2E_PAYMENTS_PORT ?? 18402);
const AGENT_PORT = Number(process.env.E2E_AGENT_PORT ?? 18403);
const PRICE_ASK = process.env.PRICE_ASK ?? '1';
const PRICE_METER = process.env.PRICE_METER ?? '0.01';

const children = [];
const log = (s) => console.log(s);
const die = (s) => {
  console.error(`\n✖ ${s}`);
  cleanup();
  process.exit(1);
};
function cleanup() {
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
}
process.on('SIGINT', () => die('interrupted'));

/** Parse KEY=value lines without exporting them into this process's env. */
function readEnvFile(path) {
  const out = {};
  if (!path || !existsSync(path)) return out;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

const stripHex = (k) => (k ?? '').replace(/^0x/i, '');

async function mirror(path) {
  const res = await fetch(`${MIRROR}${path}`, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`mirror ${path} -> ${res.status}`);
  return res.json();
}

/** Resolve one role: explicit 0.0.N, else the EVM alias via the mirror node. */
async function resolveRole(env, role) {
  const p = `FORK_DEMO_${role}_`;
  const evm = env[`${p}EVM_ADDRESS`];
  let id = env[`${p}ACCOUNT_ID`];
  let acct = null;
  if (id) acct = await mirror(`/api/v1/accounts/${id}`);
  else if (evm) {
    acct = await mirror(`/api/v1/accounts/${evm}`);
    id = acct?.account;
  }
  return {
    role: role.toLowerCase(),
    id: id || null,
    evm: evm || null,
    tinybar: acct?.balance?.balance ?? null,
    key: stripHex(env[`${p}PRIVATE_KEY`]),
  };
}

function zeroGKey() {
  if (process.env.ZEROG_API_KEY) return process.env.ZEROG_API_KEY.trim();
  const file = process.env.ZEROG_API_KEY_FILE ?? '/workspace/vault/ethglobal-mumbai/zerog-router-api-key';
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
}

function baseEnv() {
  // Only what a node/python process needs; never inherit the operator's other secrets.
  const keep = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'NODE_OPTIONS', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS'];
  return Object.fromEntries(keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
}

function start(name, cmd, argv, cwd, env) {
  mkdirSync(RUN_DIR, { recursive: true });
  const child = spawn(cmd, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const file = join(RUN_DIR, `${name}.log`);
  let buf = '';
  const sink = (d) => {
    buf += d;
    writeFileSync(file, buf);
  };
  child.stdout.on('data', sink);
  child.stderr.on('data', sink);
  children.push(child);
  return { child, file, output: () => buf };
}

function run(name, cmd, argv, cwd, env, { echo = true } = {}) {
  return new Promise((resolveRun) => {
    const p = start(name, cmd, argv, cwd, env);
    if (echo) p.child.stdout.on('data', (d) => process.stdout.write(d));
    if (echo) p.child.stderr.on('data', (d) => process.stderr.write(d));
    p.child.on('exit', (code) => resolveRun({ code, output: p.output(), file: p.file }));
  });
}

async function waitHealth(url, name, proc) {
  for (let i = 0; i < 60; i++) {
    if (proc.child.exitCode !== null) die(`${name} exited early — see ${proc.file}`);
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return r.json();
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  die(`${name} did not become healthy at ${url} — see ${proc.file}`);
}

const hashscanTx = (id) => {
  if (!id || /^mock|^dev-/.test(id)) return null;
  // 0.0.123@1700000000.123456789 -> 0.0.123-1700000000-123456789
  const m = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(id);
  // nanos are not always zero-padded by SDKs; the mirror/HashScan form needs 9 digits
  return `https://hashscan.io/testnet/transaction/${m ? `${m[1]}-${m[2]}-${m[3].padStart(9, '0')}` : id}`;
};
const hashscanAccount = (id) => (id && !DEV ? `https://hashscan.io/testnet/account/${id}` : null);

function pythonBin() {
  const candidates = [
    process.env.STEWARD_PYTHON,
    join(ROOT, 'hedera-steward', '.venv', 'bin', 'python'),
    '/workspace/utkarsh-hedera/.venv/bin/python',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? 'python3';
}

async function main() {
  log(`══ Fork the First Artist — ${LIVE ? 'LIVE (Hedera testnet, real HBAR, real 0G)' : `DEV${REAL_0G ? ' + real 0G' : ''} (mock settlement)`} ══`);
  log(`run dir: ${RUN_DIR}`);

  // ── accounts ────────────────────────────────────────────────────────────
  let roles;
  if (LIVE) {
    const env = readEnvFile(ACCOUNTS);
    if (!Object.keys(env).length) die(`accounts file not found or empty: ${ACCOUNTS}`);
    roles = {};
    for (const r of ['FAN', 'ARTIST', 'COMPUTE', 'METER']) roles[r.toLowerCase()] = await resolveRole(env, r);
    for (const r of Object.values(roles)) {
      log(`  ${r.role.padEnd(8)} ${r.id ?? 'NOT FOUND (unfunded alias)'}  ${r.tinybar === null ? '' : `${(r.tinybar / 1e8).toFixed(8)} HBAR`}`);
    }
    const missing = Object.values(roles).filter((r) => !r.id || !r.key);
    if (missing.length) die(`accounts not ready: ${missing.map((r) => r.role).join(', ')} — fund the EVM aliases (see docs/LIVE-E2E.md)`);
    const ids = new Set(Object.values(roles).map((r) => r.id));
    if (ids.size !== 4) die('fan, artist, compute and meter must be four distinct accounts');
    const need = Number(PRICE_ASK) * 1e8 + 20_000_000; // ask + fee headroom
    if (roles.fan.tinybar < need) die(`fan balance too low: needs ≥ ${need / 1e8} HBAR`);
    if (roles.compute.tinybar < 50_000_000) die('steward/compute balance too low: needs ≥ 0.5 HBAR for meter calls + fees');
  } else {
    const fake = (role, id) => ({ role, id, evm: null, tinybar: null, key: '' });
    roles = { fan: fake('fan', '0.0.7777'), artist: fake('artist', '0.0.5555'), compute: fake('compute', '0.0.6666'), meter: fake('meter', '0.0.8888') };
  }
  const zg = REAL_0G ? zeroGKey() : '';
  if (REAL_0G && !zg) die('real 0G requested but no ZEROG_API_KEY / ZEROG_API_KEY_FILE');

  const token = randomBytes(24).toString('hex');
  const common = {
    ...baseEnv(),
    PAYMENTS_MODE: LIVE ? 'live' : 'dev',
    HEDERA_NETWORK: 'hedera:testnet',
    HEDERA_ASSET: '0.0.0',
    HEDERA_ASSET_DECIMALS: '8',
    STEWARD_SERVICE_TOKEN: token,
  };

  // ── 1. payments (x402 rail, HBAR) ──────────────────────────────────────
  const payEnv = {
    ...common,
    PORT: String(PAY_PORT),
    FACILITATOR_URL: 'https://x402.org/facilitator',
    ASK_PAYEE: 'steward',
    HEDERA_ARTIST_ACCOUNT_ID: roles.artist.id,
    HEDERA_COMPUTE_ACCOUNT_ID: roles.compute.id,
    HEDERA_METER_ACCOUNT_ID: roles.meter.id,
    PRICE_ASK,
    PRICE_METER,
    BUDGET_TOTAL_USD: '10',
    BUDGET_HOURLY_USD: '1',
    BUDGET_MAX_PER_CALL_USD: '0.05',
    UPSTREAM_BASE_URL: 'https://router-api.0g.ai/v1',
    UPSTREAM_MODEL: process.env.UPSTREAM_MODEL ?? '0gm-1.0-35b-a3b',
    UPSTREAM_TRUST_MODE: process.env.UPSTREAM_TRUST_MODE ?? 'verified',
    ...(zg ? { UPSTREAM_API_KEY: zg } : {}),
    STEWARD_URL: `http://127.0.0.1:${AGENT_PORT}`,
    LEDGER_PATH: join(RUN_DIR, 'spend-log.jsonl'),
  };
  log('\n── 1. payments rail');
  const pay = start('payments', process.execPath, ['src/server.ts'], join(ROOT, 'payments'), payEnv);
  const payHealth = await waitHealth(`http://127.0.0.1:${PAY_PORT}`, 'payments', pay);
  log(`✔ payments mode=${payHealth.mode} gate=${payHealth.gate} asset=${payHealth.asset} (${payHealth.assetSymbol})`);
  if (payHealth.assetSymbol !== 'HBAR') die('payments is not on the HBAR asset');

  // ── 2. steward agent ───────────────────────────────────────────────────
  const agentEnv = {
    ...common,
    PORT: String(AGENT_PORT),
    HOST: '127.0.0.1',
    STEWARD_MODE: 'auto',
    INFERENCE_TRANSPORT: 'x402-meter',
    METER_URL: `http://127.0.0.1:${PAY_PORT}/meter/v1/chat/completions`,
    PAYMENTS_URL: `http://127.0.0.1:${PAY_PORT}`,
    METER_PRICE_PER_CALL_USD: PRICE_METER,
    BUDGET_PER_REQUEST_USD: '0.05',
    BUDGET_HOURLY_USD: '1',
    BUDGET_TOTAL_USD: '10',
    PAYER_MAX_PER_PAYMENT: '0.05',
    HEDERA_AGENT_ACCOUNT_ID: roles.compute.id,
    ...(LIVE ? { HEDERA_AGENT_PRIVATE_KEY: roles.compute.key } : {}),
  };
  log('\n── 2. artist steward agent');
  const agent = start('agent', process.execPath, ['src/server.ts'], join(ROOT, 'agent'), agentEnv);
  const agentHealth = await waitHealth(`http://127.0.0.1:${AGENT_PORT}`, 'agent', agent);
  log(`✔ steward provider=${agentHealth.provider} model=${agentHealth.model} transport=${agentHealth.transport}`);

  // ── 3. autonomous fan agent: 402 -> pay -> retry ───────────────────────
  log('\n── 3. autonomous fan agent (x402 402 → sign HBAR transfer → retry)');
  const fanEnv = {
    ...baseEnv(),
    PAYMENTS_URL: `http://127.0.0.1:${PAY_PORT}`,
    STEWARD_URL: `http://127.0.0.1:${AGENT_PORT}`,
    HEDERA_NETWORK: 'hedera:testnet',
    HEDERA_ASSET: '0.0.0',
    HEDERA_ASSET_DECIMALS: '8',
    HEDERA_FAN_MAX_PER_PAYMENT: String(Number(PRICE_ASK) * 2),
    HEDERA_FAN_ACCOUNT_ID: roles.fan.id,
    ...(LIVE ? { PAYMENTS_MODE: 'live', HEDERA_FAN_PRIVATE_KEY: roles.fan.key } : { PAYMENTS_MODE: 'dev' }),
  };
  const fan = await run('fan', process.execPath, ['scripts/demo.ts', QUESTION], join(ROOT, 'agent'), fanEnv);
  if (fan.code !== 0) die(`fan agent failed — see ${fan.file}`);

  const ledger = await fetch(`http://127.0.0.1:${PAY_PORT}/ledger/recent?n=50`).then((r) => r.json());
  const ask = ledger.entries.find((e) => e.kind === 'ask'); // newest first
  const meters = ledger.entries.filter((e) => e.kind === 'meter');
  if (!ask?.txId) die('no settled ask payment in the ledger');
  if (REAL_0G && !meters.some((m) => m.upstreamRequestId && !/^dev-/.test(m.upstreamRequestId))) {
    die('no real 0G request id recorded for the meter calls');
  }
  log(`✔ fan payment settled: ${ask.txId}`);

  // ── 4. Utkarsh's steward: post-settlement split ────────────────────────
  log(`\n── 4. hedera-steward split (${STEWARD_BRAIN}${LIVE ? '' : ', --dry-run'})`);
  const stewardJson = join(RUN_DIR, 'steward-proof.json');
  const amountHbar = (Number(ask.priceAtomic) / 1e8).toFixed(8).replace(/\.?0+$/, '');
  const pyArgs = [
    join(ROOT, 'hedera-steward', 'steward.py'),
    STEWARD_BRAIN,
    '--settled-tx',
    ask.txId,
    '--amount-hbar',
    amountHbar,
    '--artist-name',
    process.env.ARTIST_NAME ?? 'demo-artist.oso.eth',
    '--json-out',
    stewardJson,
    ...(LIVE ? [] : ['--dry-run']),
    ...(process.env.HCS_TOPIC_ID ? ['--topic-id', process.env.HCS_TOPIC_ID] : []),
  ];
  const pyEnv = {
    ...baseEnv(),
    HEDERA_MIRROR_NODE: MIRROR,
    ...(LIVE
      ? { STEWARD_ACCOUNTS_ENV: ACCOUNTS, ...(zg ? { ZEROG_API_KEY: zg } : {}) }
      : {
          STEWARD_ACCOUNTS_ENV: join(RUN_DIR, 'no-accounts.env'),
          STEWARD_ACCOUNT_ID: roles.compute.id,
          ARTIST_ACCOUNT_ID: roles.artist.id,
        }),
    ...(process.env.GROQ_API_KEY ? { OPENAI_API_KEY: process.env.GROQ_API_KEY } : {}),
  };
  const st = await run('steward', pythonBin(), pyArgs, join(ROOT, 'hedera-steward'), pyEnv);
  if (st.code !== 0 || !existsSync(stewardJson)) die(`steward split failed — see ${st.file}`);
  const steward = JSON.parse(readFileSync(stewardJson, 'utf8'));
  if (LIVE && steward.verified !== true) die('steward split not verified on the mirror node');

  // ── 5. proof ───────────────────────────────────────────────────────────
  const proof = {
    generatedAt: new Date().toISOString(),
    mode: LIVE ? 'live' : REAL_0G ? 'dev+real-0g' : 'dev',
    network: 'hedera:testnet',
    asset: { id: payHealth.asset, symbol: payHealth.assetSymbol, decimals: payHealth.assetDecimals },
    accounts: Object.fromEntries(Object.values(roles).map((r) => [r.role, r.id])),
    ask: { txId: ask.txId, priceAtomic: ask.priceAtomic, payer: ask.payer ?? null, hashscan: hashscanTx(ask.txId) },
    meter: meters.map((m) => ({
      txId: m.txId,
      priceAtomic: m.priceAtomic,
      upstreamRequestId: m.upstreamRequestId ?? null,
      teeVerified: m.teeVerified ?? null,
      model: m.model ?? null,
      hashscan: hashscanTx(m.txId),
    })),
    steward,
  };
  writeFileSync(join(RUN_DIR, 'proof.json'), JSON.stringify(proof, null, 2));
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, renderProof(proof));
  writeFileSync(OUT.replace(/\.md$/, '.json'), JSON.stringify(proof, null, 2));
  assertPublicSafe(OUT, Object.values(roles).map((r) => r.key).concat([zg, token]));
  log(`\n✔ proof written: ${OUT}`);
  cleanup();
}

function renderProof(p) {
  const row = (what, id, link) => `| ${what} | \`${id ?? '—'}\` | ${link ? `[HashScan](${link})` : '—'} |`;
  const s = p.steward ?? {};
  const lines = [
    '# Settled transaction proof',
    '',
    `Generated by \`scripts/live-e2e.mjs\` at ${p.generatedAt} — mode **${p.mode}**, ${p.network}, asset ${p.asset.symbol} (\`${p.asset.id}\`).`,
    p.mode === 'live'
      ? 'Every id below was settled on Hedera testnet and re-read from the mirror node.'
      : '> **DEV RUN — nothing here is on-chain.** Mock settlement ids; regenerate with `--live` for real proof.',
    '',
    '## Accounts (public ids)',
    '',
    '| Role | Account |',
    '|---|---|',
    ...Object.entries(p.accounts).map(([r, id]) => `| ${r} | ${hashscanAccount(id) ? `[\`${id}\`](${hashscanAccount(id)})` : `\`${id}\``} |`),
    '',
    '## Money loop',
    '',
    '| Step | Tx ID | Explorer |',
    '|---|---|---|',
    row(`1. fan → artist steward, x402 \`exact\` (${Number(p.ask.priceAtomic) / 1e8} ${p.asset.symbol})`, p.ask.txId, p.ask.hashscan),
    ...p.meter.map((m, i) =>
      row(`2.${i + 1} steward → 0G meter, x402 (${Number(m.priceAtomic) / 1e8} ${p.asset.symbol})`, m.txId, m.hashscan),
    ),
    row(
      `3. steward → artist, 96.31% forward (${s.split?.artist_hbar ?? '?'} ${p.asset.symbol})`,
      s.transfer_tx_id,
      s.hashscan?.transfer ?? hashscanTx(s.transfer_tx_id),
    ),
    row(
      `4. HCS split log (topic ${s.hashscan?.topic ? `[\`${s.hcs_topic_id}\`](${s.hashscan.topic})` : `\`${s.hcs_topic_id ?? '—'}\``}, seq ${s.hcs_sequence ?? '—'})`,
      s.hcs_tx_id,
      s.hashscan?.hcs_tx ?? hashscanTx(s.hcs_tx_id),
    ),
    '',
    `Steward split verified on mirror node: **${s.verified === true}** (steward mode \`${s.mode ?? '?'}\`).`,
    '',
    '## 0G inference bound to each meter payment',
    '',
    '| Meter tx | 0G request id | TEE verified | Model |',
    '|---|---|---|---|',
    ...p.meter.map((m) => `| \`${m.txId}\` | \`${m.upstreamRequestId ?? '—'}\` | ${m.teeVerified ?? '—'} | ${m.model ?? '—'} |`),
    '',
    'Credits: the post-settlement steward (`hedera-steward/`) is by Utkarsh Tiwari (@utkarshhs).',
    '',
  ];
  return lines.join('\n');
}

/** Fail the run if any secret value leaked into the proof files. */
function assertPublicSafe(path, secrets) {
  for (const f of [path, path.replace(/\.md$/, '.json'), join(RUN_DIR, 'proof.json')]) {
    const text = readFileSync(f, 'utf8');
    for (const s of secrets) {
      if (s && s.length >= 16 && text.includes(s)) die(`refusing: a secret value appeared in ${f}`);
    }
    if (/PRIVATE_KEY\s*[=:]\s*\S{16,}/i.test(text)) die(`refusing: private-key-like text in ${f}`);
  }
}

main().catch((err) => die(err?.stack ?? String(err)));
