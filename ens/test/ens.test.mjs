import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, getAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { getCoderByCoinName } from '@ensdomains/address-encoder';
import { encodeHbar, decodeHbar, isHederaAccountId } from '../src/hbar.mjs';
import { resolvePayTo, PayToError } from '../src/resolve-artist.mjs';
import { ADDR, COIN, RES, REG, RESOLVER_OWNER_ROLES, ARTIST_TOKEN_ROLES, USER_REGISTRY_ROOT } from '../src/constants.mjs';
import { ABI, artistResolverInit, deployArtistResolverTx, dnsEncode, registerTx, setSubregistryTx, userRegistryInit, saltFor } from '../src/plan.mjs';
import { buildConsentMessage, verifyConsent } from '../src/consent.mjs';

// ───────────── hbar coin type 3030
test('encodeHbar matches @ensdomains/address-encoder hbar coder', () => {
  const coder = getCoderByCoinName('hbar');
  assert.equal(coder.coinType, 3030);
  for (const id of ['0.0.11345896', '0.0.1', '1.2.3', '0.0.9185802']) {
    const mine = encodeHbar(id);
    assert.equal(mine, `0x${Buffer.from(coder.decode(id)).toString('hex')}`);
    assert.equal(decodeHbar(mine), id);
    assert.equal(coder.encode(Uint8Array.from(Buffer.from(mine.slice(2), 'hex'))), id);
  }
});

test('hbar helpers reject junk', () => {
  assert.throws(() => encodeHbar('0.0'));
  assert.throws(() => encodeHbar('0x611123ad22bb242f05d1f23d58753c48e0825e46'));
  assert.throws(() => decodeHbar('0x1234'));
  assert.equal(isHederaAccountId('0.0.5'), true);
  assert.equal(isHederaAccountId('alias'), false);
});

// ───────────── resolvePayTo with a mock client
const HBAR_ID = '0.0.11345896';
const EVM = getAddress('0x611123ad22bb242f05d1f23d58753c48e0825e46');
const OTHER = getAddress('0x9e76e582ecf8eafcc1e0803d742d23a88eb3e281');
const RESOLVER = '0x56a46B36841305968811304d69D5B07D7Aa5BB2e';

function mockClient({ addrs = {}, texts = {}, recordId = 7n, resolver = RESOLVER } = {}) {
  const calls = [];
  return {
    calls,
    async getEnsAddress({ name, coinType, universalResolverAddress }) {
      calls.push(['addr', name, coinType, universalResolverAddress]);
      const v = addrs[String(coinType ?? 60n)];
      return v ?? null;
    },
    async getEnsText({ name, key }) {
      calls.push(['text', name, key]);
      return texts[key] ?? null;
    },
    async getEnsResolver() {
      return resolver;
    },
    async readContract({ functionName }) {
      assert.equal(functionName, 'getRecordId');
      return recordId;
    },
  };
}
const active = { 'oso.consent': 'active', 'hedera.network': 'testnet', 'hedera.hcs.topic': '0.0.11345907' };

test('path 1: addr(3030) wins over every other record', async () => {
  const c = mockClient({ addrs: { 3030: encodeHbar(HBAR_ID), [String(COIN.HEDERA_TESTNET_EVM)]: OTHER, 60: EVM }, texts: active });
  const r = await resolvePayTo('demo-artist.osoartist.eth', { client: c });
  assert.equal(r.path, 'hbar');
  assert.equal(r.payTo, HBAR_ID);
  assert.equal(r.hederaAccountId, HBAR_ID);
  assert.equal(r.hcsTopic, '0.0.11345907');
  assert.equal(r.resolver, RESOLVER);
  assert.equal(r.recordId, '7');
  assert.ok(c.calls.every((x) => x[0] !== 'addr' || x[3] === ADDR.UniversalResolver), 'always via the ENSv2 Universal Resolver');
});

test('path 2: ENSIP-11 Hedera EVM (0x80000128) when no HBAR record', async () => {
  const c = mockClient({ addrs: { [String(COIN.HEDERA_TESTNET_EVM)]: OTHER.toLowerCase(), 60: EVM }, texts: active });
  const r = await resolvePayTo('artist.eth', { client: c });
  assert.equal(r.path, 'hedera-evm');
  assert.equal(r.payTo, OTHER);
  assert.equal(r.coinType, String(0x80000128n));
});

test('path 3: plain ETH addr(60) paid as Hedera alias — works for ANY .eth name', async () => {
  const c = mockClient({ addrs: { 60: EVM }, texts: { 'oso.consent': 'active' } });
  const r = await resolvePayTo('someartist.eth', { client: c });
  assert.equal(r.path, 'eth-alias');
  assert.equal(r.hederaAlias, EVM);
});

test('mainnet network uses ENSIP-11 chain 295', async () => {
  const c = mockClient({ addrs: { [String(COIN.HEDERA_MAINNET_EVM)]: OTHER }, texts: { 'oso.consent': 'active', 'hedera.network': 'mainnet' } });
  const r = await resolvePayTo('a.eth', { client: c, network: 'mainnet' });
  assert.equal(r.coinType, String(0x80000127n));
});

const refuse = async (opts, code, name = 'demo-artist.osoartist.eth') => {
  await assert.rejects(resolvePayTo(name, opts), (e) => e instanceof PayToError && e.code === code);
};

test('fails closed: no payout record at all', () => refuse({ client: mockClient({ texts: active }) }, 'no-payout'));
test('fails closed: no consent text', () => refuse({ client: mockClient({ addrs: { 3030: encodeHbar(HBAR_ID) } }) }, 'no-consent'));
test('fails closed: consent revoked', () => refuse({ client: mockClient({ addrs: { 3030: encodeHbar(HBAR_ID) }, texts: { ...active, 'oso.consent': 'revoked' } }) }, 'no-consent'));
test('fails closed: steward status paused/frozen', async () => {
  for (const s of ['paused', 'FROZEN', 'disputed']) {
    await refuse({ client: mockClient({ addrs: { 3030: encodeHbar(HBAR_ID) }, texts: { ...active, 'oso.steward.status': s } }) }, 'steward-paused');
  }
});
test('steward status "live" does not block', async () => {
  const r = await resolvePayTo('x.eth', { client: mockClient({ addrs: { 3030: encodeHbar(HBAR_ID) }, texts: { ...active, 'oso.steward.status': 'live' } }) });
  assert.equal(r.stewardStatus, 'live');
});
test('fails closed: hedera.network mismatch', () => refuse({ client: mockClient({ addrs: { 3030: encodeHbar(HBAR_ID) }, texts: { ...active, 'hedera.network': 'mainnet' } }) }, 'network-mismatch'));
test('fails closed: malformed addr(3030)', () => refuse({ client: mockClient({ addrs: { 3030: '0x1234' }, texts: active }) }, 'bad-record'));
test('fails closed: expected account mismatch', () => refuse({ client: mockClient({ addrs: { 3030: encodeHbar(HBAR_ID) }, texts: active }), expectAccount: '0.0.1' }, 'mismatch'));
test('fails closed: external claim check says inactive', () =>
  refuse({ client: mockClient({ addrs: { 3030: encodeHbar(HBAR_ID) }, texts: active }), claimCheck: async () => ({ active: false, reason: 'disputed on Arkiv' }) }, 'claim-inactive'));
test('fails closed: invalid / bare names', async () => {
  await refuse({ client: mockClient() }, 'bad-name', 'nodot');
  await refuse({ client: mockClient() }, 'bad-name', 'bad name!.eth');
});
test('requireConsent:false allows dev lookups of names without the opt-in text', async () => {
  const r = await resolvePayTo('vitalik.eth', { client: mockClient({ addrs: { 60: EVM } }), requireConsent: false });
  assert.equal(r.path, 'eth-alias');
});
test('non-PermissionedResolver: recordId is null, still resolves', async () => {
  const c = mockClient({ addrs: { 3030: encodeHbar(HBAR_ID) }, texts: active });
  c.readContract = async () => { throw new Error('no getRecordId'); };
  assert.equal((await resolvePayTo('a.eth', { client: c })).recordId, null);
});

// ───────────── transaction plans
const artist = privateKeyToAccount(generatePrivateKey());
const steward = privateKeyToAccount(generatePrivateKey());
const ops = privateKeyToAccount(generatePrivateKey());

test('artist resolver initialize(): artist gets everything, steward only oso.steward.status, factory revoked last', () => {
  const name = 'demo-artist.osoartist.eth';
  const { data } = artistResolverInit({ name, artist: artist.address, steward: steward.address, hederaAccountId: HBAR_ID, hcsTopic: '0.0.11345907' });
  const { functionName, args } = decodeFunctionData({ abi: ABI.resolver, data });
  assert.equal(functionName, 'initialize');
  const [grants, calls] = args;
  assert.deepEqual(grants.map((g) => [getAddress(g.account), g.roleBitmap]), [
    [artist.address, RESOLVER_OWNER_ROLES],
    [getAddress(ADDR.VerifiableFactory), RES.admin(RES.SET_TEXT)],
  ]);
  const decoded = calls.map((c) => decodeFunctionData({ abi: ABI.resolver, data: c }));
  const addrCalls = decoded.filter((d) => d.functionName === 'setAddress');
  assert.deepEqual(addrCalls.map((d) => d.args[1]), [COIN.ETH, COIN.HBAR]);
  assert.equal(addrCalls[1].args[2], encodeHbar(HBAR_ID));
  for (const d of decoded.filter((x) => ['setAddress', 'setText'].includes(x.functionName))) assert.equal(d.args[0], dnsEncode(name));
  const grant = decoded.at(-2);
  assert.equal(grant.functionName, 'grantSetterRoles');
  const setter = decodeFunctionData({ abi: ABI.resolver, data: grant.args[0] });
  assert.deepEqual([setter.functionName, setter.args[1]], ['setText', 'oso.steward.status']);
  assert.equal(getAddress(grant.args[1]), steward.address);
  const last = decoded.at(-1);
  assert.deepEqual([last.functionName, last.args[0], getAddress(last.args[1])], ['revokeRootRoles', RES.admin(RES.SET_TEXT), getAddress(ADDR.VerifiableFactory)]);
  // OSO's ops key appears nowhere in the resolver
  assert.ok(!data.toLowerCase().includes(ops.address.slice(2).toLowerCase()));
});

test('artist without Hedera account → ENSIP-11 alias = own ETH address, no 3030 record', () => {
  const { calls } = artistResolverInit({ name: 'x.osoartist.eth', artist: artist.address, steward: steward.address });
  const coins = calls.map((c) => decodeFunctionData({ abi: ABI.resolver, data: c })).filter((d) => d.functionName === 'setAddress').map((d) => [d.args[1], getAddress(d.args[2])]);
  assert.deepEqual(coins, [[COIN.ETH, artist.address], [COIN.HEDERA_TESTNET_EVM, artist.address]]);
});

test('UserRegistry root grants contain no UPGRADE and no emancipation-breaking role', () => {
  const data = userRegistryInit({ registrar: ops.address });
  const [grants] = decodeFunctionData({ abi: ABI.userRegistry, data }).args;
  const all = grants.reduce((m, g) => m | g.roleBitmap, 0n);
  const forbidden = REG.UPGRADE | REG.admin(REG.UPGRADE) | REG.UNREGISTER | REG.admin(REG.UNREGISTER) | REG.SET_RESOLVER | REG.admin(REG.SET_RESOLVER) | REG.SET_SUBREGISTRY | REG.admin(REG.SET_SUBREGISTRY) | REG.CAN_TRANSFER_ADMIN;
  assert.equal(all & forbidden, 0n);
  assert.equal(grants[0].roleBitmap, USER_REGISTRY_ROOT.registrar);
});

test('register(): owner is the artist, artist gets token admin roles, resolver is theirs', () => {
  const tx = registerTx({ registry: ops.address, label: 'Demo-Artist', owner: artist.address, resolver: steward.address, expiry: 1_825_000_000 });
  const { args } = decodeFunctionData({ abi: ABI.userRegistry, data: tx.data });
  assert.equal(args[0], 'demo-artist');
  assert.equal(getAddress(args[1]), artist.address);
  assert.equal(args[4], ARTIST_TOKEN_ROLES);
  assert.ok((ARTIST_TOKEN_ROLES & REG.CAN_TRANSFER_ADMIN) !== 0n);
});

test('Shaka setSubregistry calldata targets the ETHRegistry, value 0', () => {
  const tx = setSubregistryTx({ parentTokenId: 123n, registry: ops.address });
  assert.equal(tx.to, ADDR.ETHRegistry);
  assert.equal(tx.value, 0n);
  const { functionName, args } = decodeFunctionData({ abi: ABI.ethRegistry, data: tx.data });
  assert.equal(functionName, 'setSubregistry');
  assert.deepEqual([args[0], getAddress(args[1])], [123n, ops.address]);
});

test('salts are deterministic per name', () => {
  assert.equal(saltFor('resolver', 'a.osoartist.eth'), saltFor('resolver', 'A.osoartist.eth'));
  assert.notEqual(saltFor('resolver', 'a.osoartist.eth'), saltFor('resolver', 'b.osoartist.eth'));
  assert.equal(deployArtistResolverTx({ name: 'a.osoartist.eth', artist: artist.address }).to, ADDR.VerifiableFactory);
});

test('dnsEncode', () => {
  assert.equal(dnsEncode('a.eth'), '0x016103657468' + '00');
});

// ───────────── consent
test('consent: exact text, verify ok, wrong signer / edited text / stale refused', async () => {
  const fields = { label: 'shaka', ethAddress: artist.address, hederaPayout: 'alias', timestamp: new Date().toISOString(), chainId: 1 };
  const message = buildConsentMessage(fields);
  assert.match(message, /^Open Source Orchestra — artist consent\nname: shaka\.osoartist\.eth\nlabel: shaka\nethAddress: 0x[0-9a-f]{40}\nhedera payout: alias\nI consent to OSO listing me and routing fan payments to this address\ntimestamp: .+Z\nchainId: 1$/);
  const signature = await artist.signMessage({ message });
  const ok = await verifyConsent({ ...fields, signature, message });
  assert.equal(ok.signer, artist.address);
  await assert.rejects(verifyConsent({ ...fields, signature: await steward.signMessage({ message }) }), /recovers to/);
  await assert.rejects(verifyConsent({ ...fields, signature, message: message.replace('alias', '0.0.1') }), /differs/);
  await assert.rejects(verifyConsent({ ...fields, hederaPayout: '0.0.5', signature }), /recovers to/);
  const old = { ...fields, timestamp: new Date(Date.now() - 40 * 86_400_000).toISOString() };
  await assert.rejects(verifyConsent({ ...old, signature: await artist.signMessage({ message: buildConsentMessage(old) }) }), /older than/);
  assert.throws(() => buildConsentMessage({ ...fields, chainId: 296 }), /chainId/);
  assert.throws(() => buildConsentMessage({ ...fields, label: 'Bad.Label' }), /label/);
  assert.throws(() => buildConsentMessage({ ...fields, hederaPayout: 'whatever' }), /hedera payout/);
});
