// Batch onboarding of OSO artists under osoartist.eth (ENSv2). The ops key pays gas; artists sign only
// the free consent message; Shaka signs only setSubregistry (once, ever) on his parent name.
import { decodeFunctionResult, encodeFunctionData, getAddress, keccak256, namehash, toBytes, zeroAddress } from 'viem';
import { ADDR, PARENT, RES, TEXT, RESOLVER_OWNER_ROLES } from './constants.mjs';
import { ABI, deployArtistResolverTx, deployUserRegistryTx, dnsEncode, registerTx, saltFor, setParentTx, subname } from './plan.mjs';
import { verifyConsent } from './consent.mjs';

export const REGISTRY_SALT = saltFor('user-registry', PARENT.name);

export async function parentState(pub) {
  const read = (functionName, args) => pub.readContract({ address: ADDR.ETHRegistry, abi: ABI.ethRegistry, functionName, args });
  const [owner, expiry, tokenId, subregistry, resolver] = await Promise.all([
    read('findOwner', [PARENT.label]),
    read('findExpiry', [PARENT.label]),
    read('findTokenId', [PARENT.label]),
    read('getSubregistry', [PARENT.label]),
    read('getResolver', [PARENT.label]),
  ]);
  return { owner, expiry: BigInt(expiry), tokenId: BigInt(tokenId), subregistry, resolver };
}

export async function predict(pub, deployer, salt) {
  return pub.readContract({ address: ADDR.VerifiableFactory, abi: ABI.factory, functionName: 'predictProxyAddress', args: [getAddress(deployer), salt] });
}

async function hasCode(pub, address) {
  const code = await pub.getCode({ address });
  return !!code && code !== '0x';
}

/** Low-but-safe EIP-1559 fees: 2×base + small tip (mainnet blocks are far from full at ~0.05 gwei). */
export async function cheapFees(pub, tipWei = BigInt(process.env.ENS_TIP_WEI ?? 20_000_000)) {
  const block = await pub.getBlock();
  const base = block.baseFeePerGas ?? 0n;
  return { maxFeePerGas: base * 2n + tipWei, maxPriorityFeePerGas: tipWei };
}

/** Send one prepared tx from the ops wallet and return a gas record. */
export async function send(pub, wallet, label, tx, gasLog) {
  const fees = await cheapFees(pub);
  const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ?? 0n, account: wallet.account, chain: wallet.chain, ...fees });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== 'success') throw new Error(`${label} reverted (${hash})`);
  gasLog?.push({ step: label, from: wallet.account.address, to: tx.to, gasUsed: rcpt.gasUsed, hash });
  return rcpt;
}

/** Deploy (idempotently) the osoartist.eth UserRegistry from the ops key and set its parent pointer. */
export async function ensureRegistry({ pub, ops, parentOwner = PARENT.owner, gasLog }) {
  const registry = await predict(pub, ops.account.address, REGISTRY_SALT);
  if (!(await hasCode(pub, registry))) {
    await send(pub, ops, 'ops: deploy UserRegistry (VerifiableFactory)', deployUserRegistryTx({ registrar: ops.account.address, parentOwner, salt: REGISTRY_SALT }), gasLog);
  }
  const [p, l] = await pub.readContract({ address: registry, abi: ABI.userRegistry, functionName: 'getParent' });
  if (getAddress(p) !== getAddress(ADDR.ETHRegistry) || l !== PARENT.label) {
    await send(pub, ops, 'ops: UserRegistry.setParent(ETHRegistry, "osoartist")', setParentTx({ registry }), gasLog);
  }
  return registry;
}

const ERC1155_RECEIVED = '0xf23a6e61';
const RECEIVER_ABI = [{ type: 'function', name: 'onERC1155Received', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }], outputs: [{ type: 'bytes4' }] }];
const ADDR_ABI = [{ type: 'function', name: 'addr', stateMutability: 'view', inputs: [{ type: 'bytes32' }, { type: 'uint256' }], outputs: [{ type: 'bytes' }] }];
const isDelegation = (code) => /^0xef0100[0-9a-f]{40}$/i.test(code ?? '');

/**
 * Can this artist wallet RECEIVE the name token? The UserRegistry mints an ERC-1155; a wallet with code — a smart-contract
 * wallet or an EIP-7702-delegated EOA — only gets it if it answers onERC1155Received. Checked BEFORE any gas is spent.
 */
export async function receiverPreflight(pub, { registry, artist }) {
  const code = (await pub.getCode({ address: artist })) ?? '0x';
  if (code === '0x') return { ok: true, kind: 'eoa' };
  const kind = isDelegation(code) ? 'EIP-7702-delegated wallet' : 'smart-contract wallet';
  try {
    const data = encodeFunctionData({ abi: RECEIVER_ABI, functionName: 'onERC1155Received', args: [getAddress(registry), zeroAddress, 1n, 1n, '0x'] });
    const r = await pub.call({ account: getAddress(registry), to: getAddress(artist), data });
    if ((r?.data ?? '').slice(0, 10).toLowerCase() === ERC1155_RECEIVED) return { ok: true, kind };
  } catch { /* falls through */ }
  return { ok: false, kind, message: `${artist} is a ${kind} that cannot receive the ENS name token (it does not accept ERC-1155 transfers). Ask the artist for a plain key-held address they control as the name owner — tips can still go to the smart wallet through a per-chain address record — or have them switch the wallet's delegation to one with a token receiver, then retry.` };
}

/** Is an already-deployed resolver at `resolver` really configured for THIS artist (all root roles + ETH record = artist)? */
export async function resolverMatchesArtist(pub, { resolver, name, artist }) {
  const roles = BigInt(await pub.readContract({ address: resolver, abi: ABI.resolver, functionName: 'roles', args: [0n, getAddress(artist)] }));
  let eth = null;
  try {
    const inner = encodeFunctionData({ abi: ADDR_ABI, functionName: 'addr', args: [namehash(name), 60n] });
    const out = await pub.readContract({ address: resolver, abi: ABI.resolver, functionName: 'resolve', args: [dnsEncode(name), inner] });
    const bytes = decodeFunctionResult({ abi: ADDR_ABI, functionName: 'addr', data: out });
    eth = bytes && bytes !== '0x' ? getAddress(bytes) : null;
  } catch { eth = undefined; }
  const ok = roles === RESOLVER_OWNER_ROLES && eth != null && getAddress(eth) === getAddress(artist);
  return { ok, roles, eth };
}

/**
 * artists[i] = consent JSON { label, ethAddress, hederaPayout: '0.0.N'|'alias', timestamp, chainId, signature, message? }
 *              (+ optional url, stewardUrl)
 */
export async function onboardArtists({ pub, ops, registry, artists, steward, hcsTopic, network = 'testnet', expiry, gasLog, verify = verifyConsent }) {
  const results = [];
  for (const a of artists) {
    const label = a.label;
    const name = subname(label);
    const proof = await verify(a);
    const status = await pub.readContract({ address: registry, abi: ABI.userRegistry, functionName: 'findOwner', args: [label] });
    if (status !== zeroAddress) {
      if (getAddress(status) === getAddress(a.ethAddress)) {
        // already theirs — but say so loudly if the name's resolver still points tips at someone else
        let warning = null;
        try {
          const r = await pub.readContract({ address: registry, abi: ABI.userRegistry, functionName: 'getResolver', args: [label] });
          if (r && r !== zeroAddress && !(await resolverMatchesArtist(pub, { resolver: r, name, artist: a.ethAddress })).ok) warning = `resolver ${r} is NOT configured for ${a.ethAddress} — tips would go elsewhere; the artist must fix their records (or set a new resolver) before tips are switched on`;
        } catch { warning = 'could not verify the existing resolver — check by hand'; }
        results.push({ label, name, skipped: 'already registered to this artist', ...(warning ? { warning } : {}) });
        continue;
      }
      throw new Error(`${name} is already owned by ${status}; refusing`);
    }
    // 1 · the wallet must be able to receive the name token — refuse before any gas is spent
    const rec = await receiverPreflight(pub, { registry, artist: a.ethAddress });
    if (!rec.ok) throw new Error(`${name}: ${rec.message}`);
    // 2 · a resolver left by an earlier, half-finished attempt is only reused if it belongs to THIS artist;
    //     otherwise a fresh one is deployed at an artist-keyed salt (deterministic, so retries land on it again)
    let salt = saltFor('resolver', name);
    let resolver = await predict(pub, ops.account.address, salt);
    if (await hasCode(pub, resolver)) {
      const m = await resolverMatchesArtist(pub, { resolver, name, artist: a.ethAddress });
      if (!m.ok) {
        salt = saltFor(`resolver:${getAddress(a.ethAddress).toLowerCase()}`, name);
        resolver = await predict(pub, ops.account.address, salt);
        if (await hasCode(pub, resolver) && !(await resolverMatchesArtist(pub, { resolver, name, artist: a.ethAddress })).ok) {
          throw new Error(`${name}: existing resolvers are configured for a different wallet; refusing (check by hand)`);
        }
      }
    }
    // 3 · simulate the registration first: if it would revert, stop before deploying anything
    try {
      await pub.call({ account: ops.account.address, ...registerTx({ registry, label, owner: a.ethAddress, resolver, expiry }) });
    } catch (e) {
      throw new Error(`${name}: registration would fail (${String(e?.shortMessage ?? e?.message ?? e).slice(0, 160)}); nothing was sent`);
    }
    if (!(await hasCode(pub, resolver))) {
      const tx = deployArtistResolverTx({
        name,
        artist: a.ethAddress,
        steward,
        hederaAccountId: a.hederaPayout && a.hederaPayout !== 'alias' ? a.hederaPayout : undefined,
        network,
        hcsTopic,
        url: a.url ?? `https://artist.opensourceorchestra.org/?artist=${encodeURIComponent(label)}`,
        stewardUrl: a.stewardUrl,
        consentHash: proof.messageHash,
        salt,
      });
      await send(pub, ops, `ops: deploy ${name} PermissionedResolver (records+grants in initialize)`, tx, gasLog);
    }
    await send(pub, ops, `ops: register ${name} → owner ${a.ethAddress}`, registerTx({ registry, label, owner: a.ethAddress, resolver, expiry }), gasLog);
    results.push({ label, name, owner: getAddress(a.ethAddress), resolver, consentHash: proof.messageHash, salt: `0x${salt.toString(16)}` });
  }
  return results;
}

/** On-chain role audit of one artist resolver: proves OSO keeps nothing. */
export async function auditResolver(pub, { resolver, artist, steward, ops }) {
  const rootRoles = (account) => pub.readContract({ address: resolver, abi: ABI.resolver, functionName: 'roles', args: [0n, account] });
  const textRes = BigInt(keccak256(toBytes(TEXT.stewardStatus)));
  const [artistRoot, stewardRoot, stewardStatusRes, factoryRoot, opsRoot] = await Promise.all([
    rootRoles(artist),
    rootRoles(steward),
    pub.readContract({ address: resolver, abi: ABI.resolver, functionName: 'roles', args: [textRes, steward] }),
    rootRoles(ADDR.VerifiableFactory),
    rootRoles(ops),
  ]);
  return {
    artistHasAllRoles: BigInt(artistRoot) === RESOLVER_OWNER_ROLES,
    stewardRootRoles: BigInt(stewardRoot),
    stewardStatusRoles: BigInt(stewardStatusRes),
    stewardOnlyStatusSetter: BigInt(stewardRoot) === 0n && BigInt(stewardStatusRes) === RES.SET_TEXT,
    factoryRoles: BigInt(factoryRoot),
    opsRoles: BigInt(opsRoot),
    osoHoldsNothing: BigInt(factoryRoot) === 0n && BigInt(opsRoot) === 0n,
  };
}
