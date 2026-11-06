// HBAR (SLIP-44 coin type 3030) address <-> ENS bytes, matching @ensdomains/address-encoder 'hbar':
// 20 bytes = shard (uint32 BE) | realm (uint64 BE) | num (uint64 BE).

const ID_RE = /^(\d{1,10})\.(\d{1,20})\.(\d{1,20})$/;
const U32 = 0xffffffffn;
const U64 = 0xffffffffffffffffn;

export function isHederaAccountId(s) {
  return typeof s === 'string' && ID_RE.test(s);
}

/** "0.0.11345896" -> "0x0000000000000000000000000000000000ad1fe8" */
export function encodeHbar(accountId) {
  const m = ID_RE.exec(String(accountId ?? ''));
  if (!m) throw new Error(`not a Hedera account id (shard.realm.num): ${accountId}`);
  const [shard, realm, num] = m.slice(1).map(BigInt);
  if (shard > U32 || realm > U64 || num > U64) throw new Error(`Hedera account id out of range: ${accountId}`);
  return `0x${shard.toString(16).padStart(8, '0')}${realm.toString(16).padStart(16, '0')}${num.toString(16).padStart(16, '0')}`;
}

/** "0x…(20 bytes)" -> "0.0.N" */
export function decodeHbar(hex) {
  const h = String(hex ?? '').replace(/^0x/i, '');
  if (!/^[0-9a-f]{40}$/i.test(h)) throw new Error(`HBAR address record must be exactly 20 bytes, got ${hex}`);
  const shard = BigInt(`0x${h.slice(0, 8)}`);
  const realm = BigInt(`0x${h.slice(8, 24)}`);
  const num = BigInt(`0x${h.slice(24, 40)}`);
  return `${shard}.${realm}.${num}`;
}
