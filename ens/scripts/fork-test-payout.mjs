#!/usr/bin/env node
// /payout on an anvil fork of Ethereum mainnet — nothing is broadcast to mainnet.
//
//   node ens/scripts/fork-test-payout.mjs [--rpc http://127.0.0.1:8545] [--fork-url https://ethereum-rpc.publicnode.com]
//                                         [--out ens/proof/fork-test-payout.json]
//
// Runs against TODAY's mainnet state (osoartist.eth → live UserRegistry, shaka.osoartist.eth issued).
// The OSO registrar address and Shaka's address are IMPERSONATED on the fork; no real key is loaded.
// A fresh throwaway "artist" key gets a test name, then — using the EXACT helpers the /payout page
// runs in the browser (frontend/public/payout-plan.mjs) — sets a Hedera MAINNET payout on its own name:
//   1. Hedera account: addr(3030) + hedera.network=mainnet  → resolvePayTo(mainnet) returns that account
//   2. "my wallet address": clears 3030, sets ENSIP-11 0x80000127 → resolvePayTo(mainnet) returns the alias
// and a stranger, the OSO registrar and the parent owner are all refused by the artist's resolver.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createTestClient, createWalletClient, getAddress, http, parseEther, keccak256, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { ADDR, PARENT, REG } from '../src/constants.mjs';
import { ABI } from '../src/plan.mjs';
import { buildConsentMessage } from '../src/consent.mjs';
import { cheapFees, onboardArtists, parentState } from '../src/onboard.mjs';
import { resolvePayTo } from '../src/resolve-artist.mjs';
import { buildTx, checkSigner, makeRpc, planPayout, readRecords, simulate } from '../../frontend/public/payout-plan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const FORK_URL = opt('--fork-url', process.env.ENS_RPC_URL ?? 'https://ethereum-rpc.publicnode.com');
const OUT = resolve(opt('--out', join(HERE, '..', 'proof', 'fork-test-payout.json')));
const REGISTRY_JSON = join(HERE, '..', '..', 'frontend', 'public', 'fork', 'registry.json');
/** The OSO registrar (ops) address on mainnet — public, see ens/ENS-PROOF.md. Impersonated, never its key. */
const OPS = getAddress(process.env.OSO_REGISTRAR_ADDRESS ?? '0xe70050DF1587aA0E5CBD5735D448E5A9C9392293');
const TESTNET_ACCOUNT = '0.0.11345896'; // the synthetic demo artist account on Hedera testnet
const MAINNET_ACCOUNT = '0.0.7777777';  // a made-up mainnet account id: never paid, only written on the fork

const log = (...a) => console.log(...a);
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, ...(detail !== undefined ? { detail } : {}) });
  log(`${ok ? '✔' : '✖'} ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}` : ''}`);
}

async function startAnvil() {
  const rpc = opt('--rpc');
  if (rpc) return { rpc, stop: () => {} };
  const port = 19545 + Math.floor(Math.random() * 1000);
  const bin = existsSync('/workspace/.foundry/bin/anvil') ? '/workspace/.foundry/bin/anvil' : 'anvil';
  const child = spawn(bin, ['--fork-url', FORK_URL, '--port', String(port), '--silent'], { stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) });
      if (r.ok) return { rpc: url, stop: () => child.kill('SIGTERM') };
    } catch {}
  }
  child.kill('SIGTERM');
  throw new Error('anvil did not start');
}

const outcome = (p) => p.then((r) => ({ path: r.path, payTo: r.payTo, network: r.network }), (e) => ({ error: e.code ?? e.message }));

async function main() {
  const anvil = await startAnvil();
  const transport = http(anvil.rpc, { timeout: 60_000 });
  const pub = createPublicClient({ chain: mainnet, transport });
  const testClient = createTestClient({ chain: mainnet, mode: 'anvil', transport });
  const forkBlock = await pub.getBlockNumber();
  log(`fork @ block ${forkBlock}`);
  const pageRpc = makeRpc([anvil.rpc]); // the page's own JSON-RPC reader, pointed at the fork
  const gas = [];

  // ── 0. today's mainnet state, as the page sees it
  const registry = getAddress(JSON.parse(readFileSync(REGISTRY_JSON, 'utf8')).registry);
  const parent = await parentState(pub);
  check('osoartist.eth subregistry = the live OSO UserRegistry (registry.json)', getAddress(parent.subregistry) === registry, parent.subregistry);
  const opsIsRegistrar = await pub.readContract({ address: registry, abi: ABI.userRegistry, functionName: 'hasRootRoles', args: [REG.REGISTRAR, OPS] });
  check('OSO registrar address holds REGISTRAR on the live registry', opsIsRegistrar === true, OPS);
  const shaka = await readRecords('shaka', { rpc: pageRpc, registry });
  check('page reads shaka.osoartist.eth: owner = Shaka 0x2596', shaka.owner === getAddress(PARENT.owner), shaka.owner);
  check('page reads shaka.osoartist.eth: his own resolver + testnet alias payout', !!shaka.resolver && shaka.records.network === 'testnet' && shaka.records.evmTestnet === getAddress(PARENT.owner), { resolver: shaka.resolver, records: shaka.records });

  // Shaka himself could switch to a mainnet account from /payout: dry run from his (impersonated) address only.
  {
    const plan = planPayout({ label: 'shaka', network: 'mainnet', mode: 'account', accountId: MAINNET_ACCOUNT, current: shaka });
    const sim = await simulate(pageRpc, buildTx(plan, shaka.resolver), PARENT.owner);
    check('DRY RUN: Shaka\'s own address may set a mainnet payout on shaka.osoartist.eth (not sent)', sim.ok, sim.reason);
    const opsSim = await simulate(pageRpc, buildTx(plan, shaka.resolver), OPS);
    check('NEG DRY RUN: the OSO registrar cannot change Shaka\'s payout', !opsSim.ok && /does not hold the record roles/.test(opsSim.reason), opsSim.reason);
  }

  // ── 1. a throwaway test artist gets a name (impersonated registrar on the fork)
  await testClient.impersonateAccount({ address: OPS });
  await testClient.setBalance({ address: OPS, value: parseEther('1') });
  const opsW = createWalletClient({ chain: mainnet, transport, account: OPS });
  const artist = privateKeyToAccount(generatePrivateKey());
  await testClient.setBalance({ address: artist.address, value: parseEther('0.05') });
  const artistW = createWalletClient({ chain: mainnet, transport, account: artist });
  const label = `payout-test-${keccak256(toHex(`${Date.now()}-${artist.address}`)).slice(2, 10)}`;
  const fields = { label, ethAddress: artist.address, hederaPayout: TESTNET_ACCOUNT, timestamp: new Date().toISOString(), chainId: 1 };
  const message = buildConsentMessage(fields);
  const [onboarded] = await onboardArtists({
    pub, ops: opsW, registry, artists: [{ ...fields, message, signature: await artist.signMessage({ message }) }],
    steward: privateKeyToAccount(generatePrivateKey()).address, hcsTopic: '0.0.11345907', expiry: parent.expiry, gasLog: gas,
  });
  const name = onboarded.name;
  log(`test artist ${artist.address} · ${name} · resolver ${onboarded.resolver}`);

  const before = await readRecords(label, { rpc: pageRpc, registry });
  check('page reads the test name: owner = the artist, resolver = their own', before.owner === artist.address && before.resolver === getAddress(onboarded.resolver), { owner: before.owner, resolver: before.resolver });
  check('page reads the test name: testnet account + hedera.network=testnet', before.records.hbarAccount === TESTNET_ACCOUNT && before.records.network === 'testnet', before.records);
  check('before: resolvePayTo(testnet) → the testnet account', (await outcome(resolvePayTo(name, { client: pub }))).payTo === TESTNET_ACCOUNT);
  check('before: resolvePayTo(mainnet) refuses (network-mismatch)', (await outcome(resolvePayTo(name, { client: pub, network: 'mainnet' }))).error === 'network-mismatch');

  // ── 2. the artist sets a Hedera MAINNET account on their own name, with the page's exact tx
  const planA = planPayout({ label, network: 'mainnet', mode: 'account', accountId: MAINNET_ACCOUNT, current: before });
  const txA = buildTx(planA, before.resolver);
  const stranger = privateKeyToAccount(generatePrivateKey());
  await testClient.setBalance({ address: stranger.address, value: parseEther('0.05') });
  check('NEG page gate: a stranger\'s wallet is not offered the send button', !checkSigner({ owner: before.owner, account: stranger.address }).ok);
  for (const [who, from] of [['a stranger', stranger.address], ['the OSO registrar', OPS], ['the parent owner (Shaka)', PARENT.owner]]) {
    const sim = await simulate(pageRpc, txA, from);
    check(`NEG ${who} cannot set this artist's payout (resolver refuses)`, !sim.ok && /does not hold the record roles/.test(sim.reason), sim.reason);
  }
  {
    // and if a stranger sends it anyway, it reverts on chain and nothing changes
    const h = await createWalletClient({ chain: mainnet, transport, account: stranger }).sendTransaction({ ...txA, value: 0n, gas: 300_000n, ...(await cheapFees(pub)) }).catch((e) => e);
    const status = typeof h === 'string' ? (await pub.waitForTransactionReceipt({ hash: h })).status : 'rejected';
    const still = await readRecords(label, { rpc: pageRpc, registry });
    check('NEG a stranger\'s sent tx reverts and the payout is unchanged', status !== 'success' && still.records.hbarAccount === TESTNET_ACCOUNT, status);
  }
  check('page gate: the artist\'s own wallet may sign', checkSigner({ owner: before.owner, account: artist.address.toLowerCase() }).ok);
  check('DRY RUN from the artist succeeds', (await simulate(pageRpc, txA, artist.address)).ok);
  {
    const hash = await artistW.sendTransaction({ ...txA, value: 0n, ...(await cheapFees(pub)) });
    const r = await pub.waitForTransactionReceipt({ hash });
    gas.push({ step: 'ARTIST: multicall(setAddress 3030, setText hedera.network=mainnet)', gasUsed: r.gasUsed, hash, signer: 'artist' });
    check('ARTIST tx 1 (mainnet Hedera account) succeeds', r.status === 'success', `gas ${r.gasUsed}`);
  }
  const afterA = await readRecords(label, { rpc: pageRpc, registry });
  check('page re-read: addr(3030) = mainnet account, hedera.network=mainnet', afterA.records.hbarAccount === MAINNET_ACCOUNT && afterA.records.network === 'mainnet', afterA.records);
  const payA = await outcome(resolvePayTo(name, { client: pub, network: 'mainnet' }));
  check(`resolve-artist.mjs (mainnet) → path hbar, payTo ${MAINNET_ACCOUNT}`, payA.path === 'hbar' && payA.payTo === MAINNET_ACCOUNT, payA);
  check('resolve-artist.mjs (testnet) now refuses (network-mismatch)', (await outcome(resolvePayTo(name, { client: pub, network: 'testnet' }))).error === 'network-mismatch');
  check('page plan predicted exactly this payout', planA.expected.payTo === MAINNET_ACCOUNT && planA.expected.path === 'hbar');

  // ── 3. the artist switches to "my wallet address" on mainnet: the old 3030 must be cleared
  const planB = planPayout({ label, network: 'mainnet', mode: 'wallet', walletAddress: artist.address, current: afterA });
  check('page plan clears the old addr(3030) first', planB.writes[0].coinType === 3030n && planB.writes[0].value === '0x');
  {
    const hash = await artistW.sendTransaction({ ...buildTx(planB, afterA.resolver), value: 0n, ...(await cheapFees(pub)) });
    const r = await pub.waitForTransactionReceipt({ hash });
    gas.push({ step: 'ARTIST: multicall(clear 3030, setAddress 0x80000127, setText hedera.network=mainnet)', gasUsed: r.gasUsed, hash, signer: 'artist' });
    check('ARTIST tx 2 (mainnet wallet alias) succeeds', r.status === 'success', `gas ${r.gasUsed}`);
  }
  const afterB = await readRecords(label, { rpc: pageRpc, registry });
  check('page re-read: 3030 cleared, 0x80000127 = artist address', afterB.records.hbarAccount === null && afterB.records.evmMainnet === artist.address, afterB.records);
  const payB = await outcome(resolvePayTo(name, { client: pub, network: 'mainnet' }));
  check('resolve-artist.mjs (mainnet) → path hedera-evm, payTo = the artist\'s own address', payB.path === 'hedera-evm' && payB.payTo === artist.address, payB);

  const failed = checks.filter((c) => !c.ok);
  const proof = {
    generatedAt: new Date().toISOString(),
    mode: 'anvil fork of Ethereum mainnet (nothing broadcast); OSO registrar + Shaka impersonated, throwaway artist key',
    forkBlock: forkBlock.toString(),
    registry, ops: OPS, testName: name, artist: artist.address, resolver: onboarded.resolver,
    payout: { accountMode: payA, walletMode: payB },
    gas: gas.map((g) => ({ ...g, gasUsed: g.gasUsed.toString() })),
    checks, passed: checks.length - failed.length, failed: failed.length,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(proof, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  log(`\n${failed.length ? '✖' : '✔'} ${proof.passed}/${checks.length} checks passed — proof ${OUT}`);
  anvil.stop();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
