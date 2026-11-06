#!/usr/bin/env node
// Full ENSv2 flow on an anvil fork of Ethereum mainnet — nothing is broadcast to mainnet.
//
//   node ens/scripts/fork-test.mjs [--rpc http://127.0.0.1:8545] [--fork-url https://ethereum-rpc.publicnode.com]
//                                  [--artists 3] [--out ens/proof/fork-test.json]
//
// Shaka's wallet 0x2596…c934 is IMPERSONATED (anvil) — his key is never used or needed.
// Ops key + demo artist + steward keys come from the vault when present, else ephemeral.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient, createTestClient, createWalletClient, formatEther, formatGwei, getAddress, http, parseEther,
  BaseError, ContractFunctionRevertedError, decodeErrorResult, encodeFunctionData,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { ADDR, COIN, PARENT, TEXT } from '../src/constants.mjs';
import { ABI, dnsEncode, lockSubregistryTx, setAddressTx, setStewardStatusTx, setSubregistryTx, subname } from '../src/plan.mjs';
import { buildConsentMessage } from '../src/consent.mjs';
import { auditResolver, cheapFees, ensureRegistry, onboardArtists, parentState } from '../src/onboard.mjs';
import { resolvePayTo } from '../src/resolve-artist.mjs';
import { encodeHbar } from '../src/hbar.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const FORK_URL = opt('--fork-url', process.env.ENS_RPC_URL ?? 'https://ethereum-rpc.publicnode.com');
const N_ARTISTS = Number(opt('--artists', '3'));
const OUT = resolve(opt('--out', join(HERE, '..', 'proof', 'fork-test.json')));
const VAULT = '/workspace/vault/ethglobal-mumbai';
const HCS_TOPIC = process.env.HCS_TOPIC_ID ?? '0.0.11345907';
const DEMO_ARTIST_HEDERA = process.env.DEMO_ARTIST_ACCOUNT_ID ?? '0.0.11345896';

const log = (...a) => console.log(...a);
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, ...(detail !== undefined ? { detail } : {}) });
  log(`${ok ? '✔' : '✖'} ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}` : ''}`);
}

function readKey(file, envKey) {
  if (existsSync(file)) {
    const raw = readFileSync(file, 'utf8');
    if (envKey) {
      const line = raw.split(/\r?\n/).find((l) => l.startsWith(`${envKey}=`));
      if (line) return `0x${line.slice(envKey.length + 1).trim().replace(/^['"]|['"]$/g, '').replace(/^0x/i, '')}`;
      return null;
    }
    return `0x${raw.trim().replace(/^0x/i, '')}`;
  }
  return null;
}

async function startAnvil() {
  const rpc = opt('--rpc');
  if (rpc) return { rpc, stop: () => {} };
  const port = 18545 + Math.floor(Math.random() * 1000);
  const bin = existsSync('/workspace/.foundry/bin/anvil') ? '/workspace/.foundry/bin/anvil' : 'anvil';
  const child = spawn(bin, ['--fork-url', FORK_URL, '--port', String(port), '--silent', '--no-mining=false'].filter((x) => x !== '--no-mining=false'), { stdio: 'ignore' });
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

/** Run fn expecting a revert; return the decoded custom error name. */
async function expectRevert(fn, abi) {
  try {
    await fn();
    return { reverted: false };
  } catch (e) {
    let errorName = null;
    let args;
    if (e instanceof BaseError) {
      const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
      if (r?.data?.errorName) {
        errorName = r.data.errorName;
        args = r.data.args;
      }
      if (!errorName) {
        const raw = e.walk((x) => typeof x?.data === 'string' && x.data.startsWith('0x'))?.data;
        if (raw) {
          try {
            const d = decodeErrorResult({ abi, data: raw });
            errorName = d.errorName;
            args = d.args;
          } catch {}
        }
      }
    }
    return { reverted: true, errorName, args, message: e.shortMessage ?? e.message };
  }
}

async function main() {
  const anvil = await startAnvil();
  const transport = http(anvil.rpc, { timeout: 60_000 });
  const pub = createPublicClient({ chain: mainnet, transport });
  const test = createTestClient({ chain: mainnet, mode: 'anvil', transport });
  const mainnetPub = createPublicClient({ chain: mainnet, transport: http(FORK_URL) });
  const forkBlock = await pub.getBlockNumber();
  const gasPrice = await mainnetPub.getGasPrice();
  log(`fork @ block ${forkBlock}, mainnet gas price ${formatGwei(gasPrice)} gwei`);

  const opsKey = readKey(`${VAULT}/ens/oso-registrar.key`) ?? generatePrivateKey();
  const accountsEnv = `${VAULT}/fork-first-artist-hedera-demo-20261106/accounts.env`;
  const demoArtistKey = readKey(accountsEnv, 'FORK_DEMO_ARTIST_PRIVATE_KEY') ?? generatePrivateKey();
  const stewardKey = readKey(accountsEnv, 'FORK_DEMO_COMPUTE_PRIVATE_KEY') ?? generatePrivateKey();
  const ops = privateKeyToAccount(opsKey);
  const demoArtist = privateKeyToAccount(demoArtistKey);
  const steward = privateKeyToAccount(stewardKey);
  const mkWallet = (account) => createWalletClient({ chain: mainnet, transport, account });
  const opsW = mkWallet(ops);
  const stewardW = mkWallet(steward);
  const artistW = mkWallet(demoArtist);
  log(`ops ${ops.address} · demo artist ${demoArtist.address} · steward ${steward.address}`);

  const gasLog = [];

  // ── 0. parent state as on mainnet
  const parent = await parentState(pub);
  check('osoartist.eth owner is Shaka 0x2596', getAddress(parent.owner) === getAddress(PARENT.owner), parent.owner);
  check('osoartist.eth has no subregistry yet', /^0x0{40}$/i.test(parent.subregistry), parent.subregistry);
  const shakaRoles = await pub.readContract({ address: ADDR.ETHRegistry, abi: ABI.ethRegistry, functionName: 'roles', args: [parent.tokenId, PARENT.owner] });
  log(`  parent tokenId ${parent.tokenId}, expiry ${new Date(Number(parent.expiry) * 1000).toISOString()}, Shaka token roles 0x${BigInt(shakaRoles).toString(16)}`);

  // ── 1. Shaka funds the ops key (impersonated; on mainnet this is tx F, his signature)
  await test.impersonateAccount({ address: PARENT.owner });
  const shakaW = createWalletClient({ chain: mainnet, transport, account: PARENT.owner });
  const fundAmount = parseEther(opt('--fund', '0.0002'));
  {
    const hash = await shakaW.sendTransaction({ to: ops.address, value: fundAmount, ...(await cheapFees(pub)) });
    const r = await pub.waitForTransactionReceipt({ hash });
    gasLog.push({ step: 'SHAKA: fund ops key (plain ETH transfer)', from: PARENT.owner, to: ops.address, gasUsed: r.gasUsed, hash, signer: 'shaka' });
  }
  // steward needs a little gas for its own status write (in production funded by ops)
  {
    const hash = await opsW.sendTransaction({ to: steward.address, value: parseEther('0.00002'), ...(await cheapFees(pub)) });
    const r = await pub.waitForTransactionReceipt({ hash });
    gasLog.push({ step: 'ops: fund steward key (plain ETH transfer)', from: ops.address, to: steward.address, gasUsed: r.gasUsed, hash });
  }

  // ── 2. ops deploys the UserRegistry + parent pointer
  const registry = await ensureRegistry({ pub, ops: opsW, gasLog });
  const emancipated = await pub.readContract({ address: registry, abi: ABI.userRegistry, functionName: 'isEmancipated' });
  check('UserRegistry deployed via VerifiableFactory', true, registry);
  check('UserRegistry.isEmancipated() == true (no UPGRADE / unregister / re-point roles at root)', emancipated === true);

  // ── 3. artists sign consent (free, off-chain) — demo-artist + synthetic fixtures standing in for real artists
  const fixtures = [{ label: 'demo-artist', account: demoArtist, hederaPayout: DEMO_ARTIST_HEDERA }];
  for (let i = 2; i <= N_ARTISTS; i++) fixtures.push({ label: `demo-artist-${i}`, account: privateKeyToAccount(generatePrivateKey()), hederaPayout: 'alias' });
  const consents = [];
  for (const f of fixtures) {
    const fields = { label: f.label, ethAddress: f.account.address, hederaPayout: f.hederaPayout, timestamp: new Date().toISOString(), chainId: 1 };
    const message = buildConsentMessage(fields);
    consents.push({ ...fields, message, signature: await f.account.signMessage({ message }) });
  }
  // a forged consent (signed by the wrong key) must be refused before any tx
  {
    const fields = { label: 'forged-artist', ethAddress: demoArtist.address, hederaPayout: 'alias', timestamp: new Date().toISOString(), chainId: 1 };
    const sig = await steward.signMessage({ message: buildConsentMessage(fields) });
    const r = await onboardArtists({ pub, ops: opsW, registry, artists: [{ ...fields, signature: sig }], steward: steward.address, hcsTopic: HCS_TOPIC, expiry: parent.expiry, gasLog: [] }).then(() => null, (e) => e.message);
    check('NEG forged consent (wrong signer) refused before any transaction', r && /recovers to/.test(r), r);
  }

  // ── 4. ops onboards every artist: per-artist resolver (records + grants in initialize) + register
  const onboarded = await onboardArtists({ pub, ops: opsW, registry, artists: consents, steward: steward.address, hcsTopic: HCS_TOPIC, expiry: parent.expiry, gasLog });
  for (const o of onboarded) {
    const audit = await auditResolver(pub, { resolver: o.resolver, artist: o.owner, steward: steward.address, ops: ops.address });
    check(`${o.name}: artist holds ALL resolver roles + admins`, audit.artistHasAllRoles);
    check(`${o.name}: steward holds ONLY setText(oso.steward.status)`, audit.stewardOnlyStatusSetter, { root: audit.stewardRootRoles, status: audit.stewardStatusRoles });
    check(`${o.name}: OSO ops key + factory hold NO resolver roles`, audit.osoHoldsNothing, { ops: audit.opsRoles, factory: audit.factoryRoles });
    const owner = await pub.readContract({ address: registry, abi: ABI.userRegistry, functionName: 'findOwner', args: [o.label] });
    check(`${o.name}: owner = artist's own address`, getAddress(owner) === o.owner, owner);
  }

  // ── 5. before Shaka's tx the names do not resolve (subregistry not linked)
  const before = await resolvePayTo('demo-artist.osoartist.eth', { client: pub }).then((r) => r.payTo, (e) => e.code);
  check('before activation demo-artist.osoartist.eth does not resolve (fails closed)', before !== DEMO_ARTIST_HEDERA, before);

  // ── 6. SHAKA's single activation tx: setSubregistry
  {
    const tx = setSubregistryTx({ parentTokenId: parent.tokenId, registry });
    const hash = await shakaW.sendTransaction({ ...tx, ...(await cheapFees(pub)) });
    const r = await pub.waitForTransactionReceipt({ hash });
    check('SHAKA setSubregistry(osoartist.eth → UserRegistry) succeeds', r.status === 'success');
    gasLog.push({ step: 'SHAKA: ETHRegistry.setSubregistry(osoartist.eth, UserRegistry)', from: PARENT.owner, to: tx.to, gasUsed: r.gasUsed, hash, signer: 'shaka' });
  }

  // ── 7. resolution through the ENS Universal Resolver (what any wallet / x402 rail does)
  const demoName = subname('demo-artist');
  const hbar = await pub.getEnsAddress({ name: demoName, coinType: COIN.HBAR, universalResolverAddress: ADDR.UniversalResolver });
  check(`viem getEnsAddress(${demoName}, coinType 3030) = HBAR ${DEMO_ARTIST_HEDERA}`, hbar?.toLowerCase() === encodeHbar(DEMO_ARTIST_HEDERA), hbar);
  const pay = await resolvePayTo(demoName, { client: pub });
  check(`resolvePayTo(${demoName}) → path hbar, payTo ${DEMO_ARTIST_HEDERA}`, pay.path === 'hbar' && pay.payTo === DEMO_ARTIST_HEDERA, { path: pay.path, payTo: pay.payTo, topic: pay.hcsTopic, resolver: pay.resolver, recordId: pay.recordId });
  check('hedera.hcs.topic text resolves', pay.hcsTopic === HCS_TOPIC, pay.hcsTopic);
  for (const o of onboarded.slice(1)) {
    const r = await resolvePayTo(o.name, { client: pub });
    check(`resolvePayTo(${o.name}) → path hedera-evm alias = artist's own ETH address`, r.path === 'hedera-evm' && r.payTo === o.owner, { path: r.path, payTo: r.payTo });
  }
  const eth60 = await pub.getEnsAddress({ name: demoName, universalResolverAddress: ADDR.UniversalResolver });
  check(`addr(60) of ${demoName} = artist's own address`, getAddress(eth60) === demoArtist.address, eth60);

  // ── 8. steward agent: CAN write oso.steward.status, CANNOT touch payout
  const demo = onboarded[0];
  {
    const r = await stewardW.sendTransaction({ ...setStewardStatusTx({ resolver: demo.resolver, name: demoName, status: 'live' }), ...(await cheapFees(pub)) });
    const rc = await pub.waitForTransactionReceipt({ hash: r });
    gasLog.push({ step: 'steward: setText(oso.steward.status, "live")', from: steward.address, to: demo.resolver, gasUsed: rc.gasUsed, hash: r });
    const v = await pub.getEnsText({ name: demoName, key: TEXT.stewardStatus, universalResolverAddress: ADDR.UniversalResolver });
    check('steward CAN set oso.steward.status', rc.status === 'success' && v === 'live', v);
  }
  const resolverAbi = ABI.resolver;
  const sim = (account, tx) => pub.call({ account, to: tx.to, data: tx.data });
  const negatives = {};
  const attacker = '0x000000000000000000000000000000000000dEaD';
  negatives.stewardSetHbar = await expectRevert(() => sim(steward.address, setAddressTx({ resolver: demo.resolver, name: demoName, coinType: COIN.HBAR, value: encodeHbar('0.0.666') })), resolverAbi);
  check('NEG steward CANNOT set addr(3030) payout', negatives.stewardSetHbar.reverted && negatives.stewardSetHbar.errorName === 'EACUnauthorizedAccountRoles', negatives.stewardSetHbar.errorName ?? negatives.stewardSetHbar.message);
  negatives.stewardSetUrl = await expectRevert(() => sim(steward.address, { to: demo.resolver, data: encodeFunctionData({ abi: resolverAbi, functionName: 'setText', args: [dnsEncode(demoName), TEXT.url, 'https://evil.example'] }) }), resolverAbi);
  check('NEG steward CANNOT set any other text (url)', negatives.stewardSetUrl.reverted && negatives.stewardSetUrl.errorName === 'EACUnauthorizedAccountRoles', negatives.stewardSetUrl.errorName);
  negatives.opsSetHbar = await expectRevert(() => sim(ops.address, setAddressTx({ resolver: demo.resolver, name: demoName, coinType: COIN.HBAR, value: encodeHbar('0.0.666') })), resolverAbi);
  check('NEG OSO ops key CANNOT set addr(3030) payout', negatives.opsSetHbar.reverted && negatives.opsSetHbar.errorName === 'EACUnauthorizedAccountRoles', negatives.opsSetHbar.errorName);
  negatives.shakaSetHbar = await expectRevert(() => sim(PARENT.owner, setAddressTx({ resolver: demo.resolver, name: demoName, coinType: COIN.HBAR, value: encodeHbar('0.0.666') })), resolverAbi);
  check('NEG parent owner (Shaka) CANNOT set an artist\'s payout', negatives.shakaSetHbar.reverted && negatives.shakaSetHbar.errorName === 'EACUnauthorizedAccountRoles', negatives.shakaSetHbar.errorName);
  const regAbi = ABI.userRegistry;
  const tokenId = await pub.readContract({ address: registry, abi: regAbi, functionName: 'findTokenId', args: ['demo-artist'] });
  const regCall = (fn, a) => ({ to: registry, data: encodeFunctionData({ abi: regAbi, functionName: fn, args: a }) });
  negatives.opsReRegister = await expectRevert(() => sim(ops.address, regCall('register', ['demo-artist', attacker, '0x0000000000000000000000000000000000000000', attacker, 0n, parent.expiry])), regAbi);
  check('NEG OSO registrar CANNOT re-register a live artist name', negatives.opsReRegister.reverted, negatives.opsReRegister.errorName);
  for (const [who, acct] of [['OSO registrar', ops.address], ['Shaka (parent owner)', PARENT.owner]]) {
    for (const [fn, a] of [['unregister', [tokenId]], ['setResolver', [tokenId, attacker]], ['setSubregistry', [tokenId, attacker]]]) {
      const r = await expectRevert(() => sim(acct, regCall(fn, a)), regAbi);
      negatives[`${who}:${fn}`] = r;
      check(`NEG ${who} CANNOT ${fn} the artist's subname`, r.reverted, r.errorName);
    }
    const g = await expectRevert(() => sim(acct, regCall('grantRootRoles', [1n << 124n, acct])), regAbi);
    check(`NEG ${who} CANNOT grant itself UPGRADE on the UserRegistry`, g.reverted, g.errorName);
  }
  // artist sovereignty: the artist CAN change their own payout (then we restore it)
  {
    const tx = setAddressTx({ resolver: demo.resolver, name: demoName, coinType: COIN.HBAR, value: encodeHbar('0.0.424242') });
    const r = await pub.call({ account: demoArtist.address, to: tx.to, data: tx.data }).then(() => true, () => false);
    check('artist CAN change their own addr(3030) payout (simulated)', r);
  }
  // steward pausing the OSO service makes resolvePayTo fail closed (artist records untouched)
  {
    const snap = await test.snapshot();
    const h = await stewardW.sendTransaction({ ...setStewardStatusTx({ resolver: demo.resolver, name: demoName, status: 'paused' }), ...(await cheapFees(pub)) });
    await pub.waitForTransactionReceipt({ hash: h });
    const r = await resolvePayTo(demoName, { client: pub }).then(() => 'resolved', (e) => e.code);
    check('steward status "paused" → resolvePayTo fails closed (steward-paused)', r === 'steward-paused', r);
    await test.revert({ id: snap });
  }

  // ── 9. OPTIONAL irreversible lock: Shaka gives up re-pointing osoartist.eth (tested in a snapshot)
  {
    const snap = await test.snapshot();
    const tx = lockSubregistryTx({ parentTokenId: parent.tokenId });
    const h = await shakaW.sendTransaction({ ...tx, ...(await cheapFees(pub)) });
    const rc = await pub.waitForTransactionReceipt({ hash: h });
    gasLog.push({ step: 'SHAKA (optional, irreversible): revoke own SET_SUBREGISTRY(+admin) on osoartist.eth', from: PARENT.owner, to: tx.to, gasUsed: rc.gasUsed, hash: h, signer: 'shaka', optional: true });
    const newTokenId = await pub.readContract({ address: ADDR.ETHRegistry, abi: ABI.ethRegistry, functionName: 'findTokenId', args: [PARENT.label] });
    const r = await expectRevert(() => sim(PARENT.owner, setSubregistryTx({ parentTokenId: newTokenId, registry: attacker })), ABI.ethRegistry);
    check('OPTIONAL LOCK: after revoke, even Shaka CANNOT re-point osoartist.eth subregistry', rc.status === 'success' && r.reverted, r.errorName);
    const still = await resolvePayTo(demoName, { client: pub }).then((x) => x.payTo, (e) => e.code);
    check('OPTIONAL LOCK: artist name still resolves after lock', still === DEMO_ARTIST_HEDERA, still);
    await test.revert({ id: snap });
  }

  // ── 10. costs
  const rows = gasLog.map((g) => ({ ...g, gasUsed: g.gasUsed.toString(), ethAtCurrentGas: formatEther(g.gasUsed * gasPrice) }));
  const sum = (f) => gasLog.filter(f).reduce((s, g) => s + g.gasUsed, 0n);
  const shakaGas = sum((g) => g.signer === 'shaka' && !g.optional);
  const opsGas = sum((g) => !g.signer);
  const perArtist = onboarded.length ? sum((g) => /^ops: (deploy .* PermissionedResolver|register )/.test(g.step)) / BigInt(onboarded.length) : 0n;
  const fixed = sum((g) => /UserRegistry/.test(g.step) && !g.signer);
  const cost = {
    gasPriceGwei: formatGwei(gasPrice),
    shakaRequiredGas: shakaGas.toString(),
    shakaRequiredEth: formatEther(shakaGas * gasPrice),
    opsGas: opsGas.toString(),
    opsEth: formatEther(opsGas * gasPrice),
    perArtistGas: perArtist.toString(),
    perArtistEth: formatEther(perArtist * gasPrice),
    registryFixedGas: fixed.toString(),
    estimate: Object.fromEntries([3, 4, 5].map((n) => {
      const g = fixed + perArtist * BigInt(n);
      return [`${n}_artists`, { gas: g.toString(), eth: formatEther(g * gasPrice), ethAt1gwei: formatEther(g * 1_000_000_000n), ethAt5xGas: formatEther(g * gasPrice * 5n) }];
    })),
  };
  log('\n── gas');
  for (const r of rows) log(`  ${r.gasUsed.padStart(8)} gas  ${r.ethAtCurrentGas.padEnd(22)} ETH  ${r.step}`);
  log(JSON.stringify(cost, null, 2));

  const failed = checks.filter((c) => !c.ok);
  const proof = {
    generatedAt: new Date().toISOString(),
    mode: 'anvil fork of Ethereum mainnet (nothing broadcast)',
    forkBlock: forkBlock.toString(),
    addresses: { ...ADDR, registry, ops: ops.address, steward: steward.address, demoArtist: demoArtist.address, parentOwner: PARENT.owner },
    parent: { name: PARENT.name, tokenId: parent.tokenId.toString(), expiry: new Date(Number(parent.expiry) * 1000).toISOString() },
    onboarded,
    resolvePayTo: pay,
    negatives: Object.fromEntries(Object.entries(negatives).map(([k, v]) => [k, { reverted: v.reverted, errorName: v.errorName ?? null }])),
    gas: rows,
    cost,
    checks,
    passed: checks.length - failed.length,
    failed: failed.length,
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
