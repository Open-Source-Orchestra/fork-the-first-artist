// Batch onboarding of OSO artists under osoartist.eth (ENSv2). The ops key pays gas; artists sign only
// the free consent message; Shaka signs only setSubregistry (once, ever) on his parent name.
import { getAddress, keccak256, toBytes, zeroAddress } from 'viem';
import { ADDR, PARENT, RES, TEXT, RESOLVER_OWNER_ROLES } from './constants.mjs';
import { ABI, deployArtistResolverTx, deployUserRegistryTx, registerTx, saltFor, setParentTx, subname } from './plan.mjs';
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
        results.push({ label, name, skipped: 'already registered to this artist' });
        continue;
      }
      throw new Error(`${name} is already owned by ${status}; refusing`);
    }
    const salt = saltFor('resolver', name);
    const resolver = await predict(pub, ops.account.address, salt);
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
