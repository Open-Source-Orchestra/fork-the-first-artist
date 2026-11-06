#!/usr/bin/env node
// Build Shaka's signing kit from LIVE mainnet state (read-only):
//   ens/signing-kit/kit.json + kit.md   — exact to / value / data / chainId per tx, plain-language description
//   frontend/public/ens-sign.html       — tiny MetaMask page (/ens-sign) that sends ONLY these txs from 0x2596
//
//   node ens/scripts/build-signing-kit.mjs [--rpc URL] [--artists 5]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, formatEther, formatGwei, getAddress, http, parseEther, toHex } from 'viem';
import { mainnet } from 'viem/chains';
import { ADDR, PARENT } from '../src/constants.mjs';
import { lockSubregistryTx, setSubregistryTx } from '../src/plan.mjs';
import { parentState, predict, REGISTRY_SALT } from '../src/onboard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const RPC = opt('--rpc', process.env.ENS_RPC_URL ?? 'https://ethereum-rpc.publicnode.com');
const N = Number(opt('--artists', '5'));
const OPS = getAddress(readFileSync('/workspace/vault/ethglobal-mumbai/ens/oso-registrar.address', 'utf8').trim());

const pub = createPublicClient({ chain: mainnet, transport: http(RPC) });
const [parent, gasPrice, block, shakaBal, opsBal] = await Promise.all([
  parentState(pub), pub.getGasPrice(), pub.getBlock(), pub.getBalance({ address: PARENT.owner }), pub.getBalance({ address: OPS }),
]);
const registry = await predict(pub, OPS, REGISTRY_SALT);

// gas measured on the mainnet fork (ens/proof/fork-test.json)
const GAS = { registry: 228_311n + 80_783n, perArtist: 647_389n + 172_896n, setSubregistry: 57_520n, transfer: 21_000n, lock: 79_750n, stewardStatus: 69_269n };
const opsGas = GAS.registry + GAS.perArtist * BigInt(N);
// fund for the ops key: gas at 1.5× today's price (headroom for base-fee moves), rounded up to 0.00001 ETH,
// capped so Shaka keeps ≥ 0.00002 ETH for his own activation tx (~78.5k gas incl. this transfer).
const KEEP = parseEther('0.00002');
const wanted = ((opsGas * gasPrice * 3n) / 2n / 10_000_000_000_000n + 1n) * 10_000_000_000_000n;
const fundWei = wanted <= shakaBal - KEEP ? wanted : ((shakaBal - KEEP) / 10_000_000_000_000n) * 10_000_000_000_000n;
const fundCapped = fundWei < wanted;
const shakaNeeds = fundWei + (GAS.setSubregistry + GAS.transfer) * gasPrice * 3n;

const txs = [
  {
    id: 'fund-ops',
    required: false,
    order: 1,
    title: `Send ${formatEther(fundWei)} ETH to the OSO ops key (gas for ${N} artists)`,
    plain: `A normal ETH transfer from your wallet to the OSO registrar/ops key ${OPS}. It pays the gas to create the OSO artist registry and ${N} artist names + their own resolvers. Skip this if a teammate funds the ops key instead.`,
    from: PARENT.owner, to: OPS, value: toHex(fundWei), data: '0x', chainId: '0x1', gasEstimate: GAS.transfer.toString(),
  },
  {
    id: 'set-subregistry',
    required: true,
    order: 2,
    title: 'Activate osoartist.eth: point its subnames at the OSO artist registry',
    plain: `Calls ETHRegistry.setSubregistry on YOUR name osoartist.eth so that <artist>.osoartist.eth is looked up in the OSO UserRegistry ${registry}. Each artist's name in that registry is owned by the artist's own wallet; neither OSO nor you can take it back, change its resolver or its payout (fork-tested). You can later re-point osoartist.eth (that is the one power you keep) unless you also sign the optional lock.`,
    from: PARENT.owner, ...stringify(setSubregistryTx({ parentTokenId: parent.tokenId, registry })), chainId: '0x1', gasEstimate: GAS.setSubregistry.toString(),
  },
  {
    id: 'lock-subregistry',
    required: false,
    irreversible: true,
    order: 3,
    title: 'OPTIONAL · IRREVERSIBLE: give up re-pointing osoartist.eth forever',
    plain: 'Revokes your own SET_SUBREGISTRY role (and its admin) on osoartist.eth. After this nobody — not you, not OSO — can swap the artist registry out from under the artists. You keep ownership, renewal and resolver of osoartist.eth. Do NOT sign tonight unless you are sure; it cannot be undone.',
    from: PARENT.owner, ...stringify(lockSubregistryTx({ parentTokenId: parent.tokenId })), chainId: '0x1', gasEstimate: GAS.lock.toString(),
  },
];
function stringify(tx) {
  return { to: getAddress(tx.to), value: toHex(tx.value ?? 0n), data: tx.data };
}

const kit = {
  generatedAt: new Date().toISOString(),
  readAtBlock: block.number.toString(),
  gasPriceGwei: formatGwei(gasPrice),
  parent: { name: PARENT.name, owner: PARENT.owner, tokenId: parent.tokenId.toString(), expiry: new Date(Number(parent.expiry) * 1000).toISOString(), currentSubregistry: parent.subregistry },
  opsKey: OPS,
  userRegistry: { address: registry, deployed: ((await pub.getCode({ address: registry })) ?? '0x') !== '0x', note: 'deterministic VerifiableFactory address for (ops key, salt); same before and after deployment' },
  balances: { shakaEth: formatEther(shakaBal), opsEth: formatEther(opsBal) },
  estimate: {
    artists: N,
    opsGas: opsGas.toString(),
    opsEthAtCurrentGas: formatEther(opsGas * gasPrice),
    recommendedFundEth: formatEther(fundWei),
    fundCappedByBalance: fundCapped,
    wantedFundEth: formatEther(wanted),
    shakaTotalNeedsEth: formatEther(shakaNeeds),
    shakaCanAfford: shakaBal >= shakaNeeds,
  },
  order: 'Ops key deploys the registry + artists first (agent-sent, needs funding), then Shaka signs set-subregistry. Order is safe either way: before activation the names simply do not resolve.',
  txs,
};
const kitDir = join(ROOT, 'ens', 'signing-kit');
mkdirSync(kitDir, { recursive: true });
writeFileSync(join(kitDir, 'kit.json'), JSON.stringify(kit, null, 2));
const md = [
  '# Shaka signing kit — osoartist.eth (ENSv2, Ethereum mainnet)',
  '',
  `Generated ${kit.generatedAt} from mainnet block ${kit.readAtBlock} (gas ${kit.gasPriceGwei} gwei). Sign from **${PARENT.owner}** in MetaMask, chain **Ethereum mainnet (1)**. Page: \`/ens-sign\` (frontend/public/ens-sign.html).`,
  '',
  `Your balance: ${kit.balances.shakaEth} ETH · needed for fund + activation: ~${kit.estimate.shakaTotalNeedsEth} ETH → ${kit.estimate.shakaCanAfford ? 'enough' : '**NOT enough** — a teammate should fund the ops key'}.`,
  '',
  ...txs.flatMap((t) => [
    `## ${t.order}. ${t.title}${t.required ? ' — **REQUIRED**' : ''}`,
    '',
    t.plain,
    '',
    '| field | value |',
    '|---|---|',
    `| from | \`${t.from}\` |`,
    `| to | \`${t.to}\` |`,
    `| value | \`${t.value}\` (${formatEther(BigInt(t.value))} ETH) |`,
    `| chainId | 1 |`,
    `| gas (fork-measured) | ${t.gasEstimate} |`,
    '',
    '```',
    t.data,
    '```',
    '',
  ]),
  '## Sent by agents (not you)',
  '',
  `- ops ${OPS}: VerifiableFactory.deployProxy(UserRegistryImpl) → ${registry}; setParent(ETHRegistry,"osoartist")`,
  '- ops, per artist: deployProxy(PermissionedResolverImpl, initialize(grants=artist ALL roles, records…)) + UserRegistry.register(label, owner=artist)',
  '- script: `node ens/scripts/onboard.mjs --consents <dir> --rpc <mainnet> --send --mainnet-yes "<your yes>"`',
  '',
].join('\n');
writeFileSync(join(kitDir, 'kit.md'), md);

const page = readFileSync(join(HERE, 'ens-sign.template.html'), 'utf8').replace('__KIT_JSON__', JSON.stringify(kit).replace(/</g, '\\u003c'));
writeFileSync(join(ROOT, 'frontend', 'public', 'ens-sign.html'), page);
console.log(md);
