// Onboarding guards (video-lane findings, 9 Nov 2026): a half-made resolver from an earlier attempt is never reused
// for a different wallet, and a wallet that can't receive the ERC-1155 name token is refused before any gas is spent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionResult, getAddress, zeroAddress } from 'viem';
import { onboardArtists, receiverPreflight } from '../src/onboard.mjs';
import { RESOLVER_OWNER_ROLES } from '../src/constants.mjs';

const OLD = getAddress('0x1111111111111111111111111111111111111111');
const NEW = getAddress('0x2222222222222222222222222222222222222222');
const REG = getAddress('0x3333333333333333333333333333333333333333');
const R1 = getAddress('0x4444444444444444444444444444444444444444'); // resolver at the name-only salt
const R2 = getAddress('0x5555555555555555555555555555555555555555'); // resolver at the artist-keyed salt
const ADDR_ABI = [{ type: 'function', name: 'addr', stateMutability: 'view', inputs: [{ type: 'bytes32' }, { type: 'uint256' }], outputs: [{ type: 'bytes' }] }];

function mockPub({ codes = {}, resolverOwner = {}, receiverOk = false, registerReverts = false }) {
  const sent = [];
  const pub = {
    async getCode({ address }) { return codes[getAddress(address)] ?? '0x'; },
    async call({ to, data }) {
      if (data.startsWith('0xf23a6e61')) { if (receiverOk) return { data: '0xf23a6e61' + '0'.repeat(56) }; throw new Error('execution reverted'); }
      if (getAddress(to) === REG && registerReverts) throw Object.assign(new Error('reverted'), { shortMessage: 'ERC1155InvalidReceiver' });
      return { data: '0x' };
    },
    async readContract({ address, functionName, args }) {
      if (functionName === 'findOwner') return zeroAddress;
      if (functionName === 'predictProxyAddress') return sent.length >= 0 && String(args[1]).length && pub.saltMap(args[1]);
      if (functionName === 'roles') return getAddress(args[1]) === resolverOwner[getAddress(address)] ? RESOLVER_OWNER_ROLES : 0n;
      if (functionName === 'resolve') return encodeFunctionResult({ abi: ADDR_ABI, functionName: 'addr', result: resolverOwner[getAddress(address)] ?? '0x' });
      throw new Error(`unexpected read ${functionName}`);
    },
    async getBlock() { return { baseFeePerGas: 1n }; },
    async waitForTransactionReceipt() { return { status: 'success', gasUsed: 1n }; },
  };
  let first = null;
  pub.saltMap = (salt) => { first ??= salt; return salt === first ? R1 : R2; };
  const ops = { account: { address: getAddress('0x6666666666666666666666666666666666666666') }, chain: null, async sendTransaction(tx) { sent.push(tx); return '0x' + 'ab'.repeat(32); } };
  return { pub, ops, sent };
}
const artist = (eth) => ({ label: 'aniket-gundewar', ethAddress: eth, hederaPayout: 'alias' });
const verify = async () => ({ messageHash: '0x' + '00'.repeat(32) });

test('a half-made resolver from an earlier attempt for ANOTHER wallet is not reused: a fresh artist-keyed resolver is deployed', async () => {
  const { pub, ops, sent } = mockPub({ codes: { [R1]: '0x60' }, resolverOwner: { [R1]: OLD } });
  const [r] = await onboardArtists({ pub, ops, registry: REG, artists: [artist(NEW)], steward: OLD, hcsTopic: '0.0.1', expiry: 2_000_000_000, verify });
  assert.equal(r.resolver, R2, 'registered with the NEW, artist-keyed resolver');
  assert.equal(sent.length, 2, 'deploy resolver + register');
  assert.ok(!sent.some((t) => JSON.stringify(t, (k, v) => (typeof v === 'bigint' ? v.toString() : v)).includes(R1.slice(2).toLowerCase())), 'the old resolver is never attached to the new owner');
});

test('a half-made resolver that DOES belong to this artist is reused (retry is idempotent)', async () => {
  const { pub, ops, sent } = mockPub({ codes: { [R1]: '0x60' }, resolverOwner: { [R1]: NEW } });
  const [r] = await onboardArtists({ pub, ops, registry: REG, artists: [artist(NEW)], steward: OLD, hcsTopic: '0.0.1', expiry: 2_000_000_000, verify });
  assert.equal(r.resolver, R1);
  assert.equal(sent.length, 1, 'register only — no second resolver');
});

test('an EIP-7702-delegated wallet without an ERC-1155 receiver is refused BEFORE any gas is spent, with a clear reason', async () => {
  const { pub, ops, sent } = mockPub({ codes: { [NEW]: '0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b' } });
  await assert.rejects(onboardArtists({ pub, ops, registry: REG, artists: [artist(NEW)], steward: OLD, hcsTopic: '0.0.1', expiry: 2_000_000_000, verify }), /EIP-7702-delegated wallet that cannot receive the ENS name token/);
  assert.equal(sent.length, 0);
  const ok = mockPub({ codes: { [NEW]: '0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b' }, receiverOk: true });
  assert.equal((await receiverPreflight(ok.pub, { registry: REG, artist: NEW })).ok, true, 'a delegate WITH a receiver hook is fine');
  assert.equal((await receiverPreflight(ok.pub, { registry: REG, artist: OLD })).kind, 'eoa');
});

test('a registration that would revert is caught by simulation before the resolver is deployed', async () => {
  const { pub, ops, sent } = mockPub({ registerReverts: true });
  await assert.rejects(onboardArtists({ pub, ops, registry: REG, artists: [artist(NEW)], steward: OLD, hcsTopic: '0.0.1', expiry: 2_000_000_000, verify }), /registration would fail \(ERC1155InvalidReceiver\); nothing was sent/);
  assert.equal(sent.length, 0);
});
