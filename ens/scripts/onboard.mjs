#!/usr/bin/env node
// Batch-onboard OSO artists as <label>.osoartist.eth (ENSv2). Artists sign ONLY the free consent message.
//
//   node ens/scripts/onboard.mjs --consents <file.json|dir> [--rpc URL]            # PLAN ONLY (default)
//   node ens/scripts/onboard.mjs --consents <…> --rpc http://127.0.0.1:8545 --send  # anvil fork rehearsal
//   node ens/scripts/onboard.mjs --consents <…> --rpc <mainnet> --send --mainnet-yes "<Shaka's relayed yes>"
//
// consent JSON (one object or an array; output of frontend/public/consent/):
//   { label, ethAddress, hederaPayout: "0.0.N" | "alias", timestamp, chainId: 1, message, signature, url? }
//
// Ops key: /workspace/vault/ethglobal-mumbai/ens/oso-registrar.key (never printed). Steward = the agent's
// EVM address (only gets the oso.steward.status text setter). Every consent is verified (EIP-191) before
// ANY transaction, copied to the vault consents dir (0600) and summarised in ens/proof/onboard-<ts>.json.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, formatEther, getAddress, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { PARENT } from '../src/constants.mjs';
import { deployArtistResolverTx, deployUserRegistryTx, registerTx, saltFor, setParentTx, setSubregistryTx, subname } from '../src/plan.mjs';
import { verifyConsent } from '../src/consent.mjs';
import { loadTrusted, verifyTrustChain } from '../src/trust.mjs';
import { ensureRegistry, onboardArtists, parentState, predict, REGISTRY_SALT } from '../src/onboard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const flag = (k) => args.includes(k);
const VAULT = process.env.OSO_ENS_VAULT ?? '/workspace/vault/ethglobal-mumbai/ens';
const RPC = opt('--rpc', process.env.ENS_RPC_URL ?? 'https://ethereum-rpc.publicnode.com');
const SEND = flag('--send');
const MAINNET_YES = opt('--mainnet-yes');
const STEWARD = opt('--steward', process.env.OSO_STEWARD_EVM ?? '0x3ED964927a6aA93367B6A7fF8922dd6960ed5434');
const HCS_TOPIC = opt('--hcs-topic', process.env.HCS_TOPIC_ID ?? '0.0.11345907');
const SRC = opt('--consents');
const die = (m) => {
  console.error(`✖ ${m}`);
  process.exit(1);
};
if (!SRC) die('--consents <file.json|dir> is required');

function loadConsents(p) {
  const st = statSync(p);
  const files = st.isDirectory() ? readdirSync(p).filter((f) => f.endsWith('.json')).map((f) => join(p, f)) : [p];
  return files.flatMap((f) => {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return Array.isArray(j) ? j : [j];
  });
}

const isLocal = /127\.0\.0\.1|localhost/.test(RPC);
const consents = loadConsents(resolve(SRC));
const labels = new Set();
for (const c of consents) {
  if (labels.has(c.label)) die(`duplicate label ${c.label}`);
  labels.add(c.label);
}
console.log(`${consents.length} consent(s) · rpc ${isLocal ? RPC : RPC.replace(/\/\/([^/]+).*/, '//$1')} · ${SEND ? 'SEND' : 'PLAN ONLY'}`);

// 1. verify every consent first — nothing is sent if any is bad
// Trust chain (invitation + approval by stewards in frontend/public/fork/stewards.json) is REQUIRED,
// except for local anvil rehearsals with synthetic fixtures that pass --rehearsal-no-trust explicitly.
const SKIP_TRUST = flag('--rehearsal-no-trust');
if (SKIP_TRUST && !/127\.0\.0\.1|localhost/.test(RPC)) die('--rehearsal-no-trust is only allowed against a local fork');
const trusted = await loadTrusted();
const verified = [];
for (const c of consents) {
  const v = await verifyConsent(c).catch((e) => die(e.message));
  const t = SKIP_TRUST ? null : await verifyTrustChain(c, trusted).catch((e) => die(e.message));
  if (t) c.slug = t.slug;
  verified.push({ c, v, t });
  console.log(`✔ consent ${subname(c.label)} signed by ${v.signer} · payout ${c.hederaPayout} · ${v.messageHash.slice(0, 18)}…${t ? ` · invited by ${t.inviter.name}, approved by ${t.approver.name}` : ' · (rehearsal: trust chain skipped)'}`);
}
const isLocalRpc = /127\.0\.0\.1|localhost/.test(RPC);
const CONSENT_DIR = join(VAULT, isLocalRpc ? 'consents-fork-rehearsal' : 'consents');
mkdirSync(CONSENT_DIR, { recursive: true, mode: 0o700 });
for (const { c, v } of verified) {
  const f = join(CONSENT_DIR, `${c.label}.json`);
  writeFileSync(f, JSON.stringify({ ...c, messageHash: v.messageHash, verifiedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  chmodSync(f, 0o600);
}

// 2. chain state + plan
const keyFile = join(VAULT, 'oso-registrar.key');
if (!existsSync(keyFile)) die(`ops key missing: ${keyFile}`);
const ops = privateKeyToAccount(`0x${readFileSync(keyFile, 'utf8').trim().replace(/^0x/, '')}`);
const transport = http(RPC, { timeout: 60_000 });
const pub = createPublicClient({ chain: mainnet, transport });
const chainId = await pub.getChainId();
if (chainId !== 1) die(`expected chainId 1 (mainnet or a mainnet fork), got ${chainId}`);
const parent = await parentState(pub);
if (getAddress(parent.owner) !== getAddress(PARENT.owner)) die(`osoartist.eth owner changed: ${parent.owner}`);
const registry = await predict(pub, ops.address, REGISTRY_SALT);
const hasCode = async (a) => ((await pub.getCode({ address: a })) ?? '0x') !== '0x';
const registryLive = await hasCode(registry);
const linked = getAddress(parent.subregistry) === getAddress(registry);
console.log(`parent ${PARENT.name} tokenId ${parent.tokenId} expiry ${new Date(Number(parent.expiry) * 1000).toISOString()}`);
console.log(`UserRegistry ${registry} ${registryLive ? 'deployed' : 'NOT deployed yet'} · ${linked ? 'LINKED by Shaka' : 'not yet linked (Shaka setSubregistry pending)'}`);

const plan = [];
if (!registryLive) {
  plan.push({ who: 'ops', what: 'deploy UserRegistry via VerifiableFactory', ...deployUserRegistryTx({ registrar: ops.address, salt: REGISTRY_SALT }) });
  plan.push({ who: 'ops', what: 'UserRegistry.setParent(ETHRegistry, "osoartist")', ...setParentTx({ registry }) });
}
for (const { c, v } of verified) {
  const name = subname(c.label);
  const salt = saltFor('resolver', name);
  const resolver = await predict(pub, ops.address, salt);
  plan.push({
    who: 'ops', what: `deploy ${name} PermissionedResolver (artist owns all roles)`, resolver,
    ...deployArtistResolverTx({ name, artist: c.ethAddress, steward: STEWARD, hederaAccountId: c.hederaPayout !== 'alias' ? c.hederaPayout : undefined, hcsTopic: HCS_TOPIC, url: c.url ?? `https://artist.opensourceorchestra.org/?artist=${encodeURIComponent(c.label)}`, consentHash: v.messageHash, salt }),
  });
  plan.push({ who: 'ops', what: `register ${name} → ${getAddress(c.ethAddress)}`, ...registerTx({ registry, label: c.label, owner: c.ethAddress, resolver, expiry: parent.expiry }) });
}
if (!linked) plan.push({ who: 'SHAKA (0x2596…c934, MetaMask)', what: 'ETHRegistry.setSubregistry(osoartist.eth → UserRegistry) — activation', ...setSubregistryTx({ parentTokenId: parent.tokenId, registry }) });
const GAS = { 'deploy UserRegistry': 228_311n, 'UserRegistry.setParent': 80_783n, PermissionedResolver: 647_389n, register: 172_896n, setSubregistry: 57_520n };
const est = (w) => Object.entries(GAS).find(([k]) => w.includes(k))?.[1] ?? 0n;
const gasPrice = await pub.getGasPrice();
const opsGas = plan.filter((p) => p.who === 'ops').reduce((s, p) => s + est(p.what), 0n);
console.log('\nplan:');
for (const p of plan) console.log(`  [${p.who}] ${p.what}  (~${est(p.what)} gas)`);
console.log(`ops total ≈ ${opsGas} gas ≈ ${formatEther(opsGas * gasPrice)} ETH at current gas; ops balance ${formatEther(await pub.getBalance({ address: ops.address }))} ETH`);

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(HERE, '..', 'proof', `onboard-${isLocal ? 'fork' : 'mainnet'}-${ts}.json`);
mkdirSync(dirname(out), { recursive: true });
const record = { generatedAt: new Date().toISOString(), rpc: isLocal ? 'anvil fork' : 'mainnet', registry, ops: ops.address, steward: STEWARD, sent: false, plan: plan.map((p) => ({ ...p, value: String(p.value ?? 0n) })), consents: verified.map(({ c, v }) => ({ label: c.label, name: subname(c.label), ethAddress: getAddress(c.ethAddress), hederaPayout: c.hederaPayout, messageHash: v.messageHash, timestamp: c.timestamp })) };

// Garden panel feed (frontend/public/fork/registry.json) — mainnet state only, never fork rehearsals.
const GARDEN = resolve(HERE, '..', '..', 'frontend', 'public', 'fork', 'registry.json');
function updateGarden(entries) {
  if (isLocal) return;
  const g = existsSync(GARDEN) ? JSON.parse(readFileSync(GARDEN, 'utf8')) : { parent: PARENT.name, artists: {} };
  g.parent = PARENT.name;
  g.registry = registry;
  g.activated = linked;
  g.updatedAt = new Date().toISOString();
  for (const e of entries) g.artists[e.slug] = { ...(g.artists[e.slug] ?? {}), ...e.data };
  writeFileSync(GARDEN, `${JSON.stringify(g, null, 2)}\n`);
}
updateGarden(verified.map(({ c, t }) => ({ slug: c.slug ?? c.label, data: { ens: subname(c.label), status: 'approved', ...(t ? { invitedBy: t.inviter.name, approvedBy: t.approver.name } : {}), owner: getAddress(c.ethAddress), hedera: c.hederaPayout } })));

if (!SEND) {
  writeFileSync(out, JSON.stringify(record, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2));
  console.log(`\nPLAN ONLY — nothing sent. ${out}`);
  process.exit(0);
}
if (!isLocal && !MAINNET_YES) die('refusing to send to Ethereum mainnet without --mainnet-yes "<Shaka\'s explicit yes, relayed>"');
const opsW = createWalletClient({ chain: mainnet, transport, account: ops });
const gasLog = [];
const reg = await ensureRegistry({ pub, ops: opsW, gasLog });
const results = await onboardArtists({ pub, ops: opsW, registry: reg, artists: consents, steward: STEWARD, hcsTopic: HCS_TOPIC, expiry: parent.expiry, gasLog });
record.sent = true;
record.mainnetYes = isLocal ? null : MAINNET_YES;
record.results = results;
record.gas = gasLog.map((g) => ({ ...g, gasUsed: g.gasUsed.toString() }));
writeFileSync(out, JSON.stringify(record, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2));
for (const r of results) console.log(`✔ ${r.name} ${r.skipped ?? `owner ${r.owner} resolver ${r.resolver}`}`);
const regTx = (name) => gasLog.find((g) => g.step.startsWith(`ops: register ${name}`))?.hash;
updateGarden(results.map((r) => {
  const c = consents.find((x) => x.label === r.label);
  return { slug: c.slug ?? c.label, data: { ens: r.name, status: 'issued', owner: getAddress(c.ethAddress), hedera: c.hederaPayout, resolver: r.resolver, ...(regTx(r.name) ? { tx: regTx(r.name) } : {}) } };
}));
console.log(`\n${gasLog.length} tx sent · ${out}`);
if (!linked) console.log('NEXT: Shaka signs setSubregistry (ens/signing-kit/) — names resolve only after that.');
