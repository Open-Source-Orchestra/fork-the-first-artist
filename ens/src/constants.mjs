// ENSv2 Ethereum-mainnet constants for Fork the First Artist.
// Source: ensdomains/contracts-v2 @ 4f47cbcc11462fb413196e6b5c0f8090247a6c08
// contracts/deployments/mainnet/addresses.md (deployed 2026-10-26, ENSv2 live 2026-10-27).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const CHAIN_ID = 1;

export const ADDR = Object.freeze({
  ETHRegistry: '0xf60aba43e1f7f3dab1186ff03b561401c9df85e2',
  ETHRegistrar: '0xd6d8369e55c94ae8afa714e6cf7ab5be54d5cc81',
  RootRegistry: '0x2553c09be6447beffdb86fa622ad41fb8f77a91e',
  VerifiableFactory: '0x77510ba162dfea3d8989e3f0928a691b345730d2',
  UserRegistryImpl: '0xfaa23592aca10a6d8875b18ea86954e8eb6d8d72',
  PermissionedResolverImpl: '0x565b0f456a04ac9b48758190e90030623cff57c5',
  UniversalResolver: '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe',
});

/** The OSO parent name and its owner (Shaka's own wallet — only he can sign for it). */
export const PARENT = Object.freeze({
  label: 'osoartist',
  name: 'osoartist.eth',
  owner: '0x25965899f4600b3AA5362ee4f34be95E5E62c934',
});

/** Coin types. */
export const COIN = Object.freeze({
  ETH: 60n,
  HBAR: 3030n, // SLIP-44 HBAR; address-encoder 'hbar' = 20 bytes shard(u32)|realm(u64)|num(u64)
  HEDERA_TESTNET_EVM: 0x80000000n | 296n, // ENSIP-11 for EVM chain id 296 = 0x80000128
  HEDERA_MAINNET_EVM: 0x80000000n | 295n, // ENSIP-11 for EVM chain id 295 = 0x80000127
});

/** Text keys this project reads/writes. */
export const TEXT = Object.freeze({
  network: 'hedera.network',
  hcsTopic: 'hedera.hcs.topic',
  url: 'url',
  stewardUrl: 'oso.steward.url',
  stewardStatus: 'oso.steward.status', // the ONLY key the steward agent may write
  consent: 'oso.consent', // artist-written opt-in: "active" = pay me through OSO
});

// ── EnhancedAccessControl role bits (contracts-v2 RegistryRolesLib / PermissionedResolverLib) ──
const A = (r) => r << 128n; // admin counterpart

export const REG = Object.freeze({
  REGISTRAR: 1n << 0n,
  REGISTER_RESERVED: 1n << 4n,
  SET_PARENT: 1n << 8n,
  UNREGISTER: 1n << 12n,
  RENEW: 1n << 16n,
  SET_SUBREGISTRY: 1n << 20n,
  SET_RESOLVER: 1n << 24n,
  CAN_TRANSFER_ADMIN: A(1n << 28n),
  SET_URI: 1n << 36n,
  CAN_NAME: 1n << 120n,
  UPGRADE: 1n << 124n,
  admin: A,
});

export const RES = Object.freeze({
  SET_ADDRESS: 1n << 0n,
  SET_TEXT: 1n << 4n,
  SET_CONTENTHASH: 1n << 8n,
  SET_ABI: 1n << 12n,
  SET_INTERFACE: 1n << 16n,
  SET_NAME: 1n << 20n,
  SET_DATA: 1n << 24n,
  LINK: 1n << 28n,
  CAN_NAME: 1n << 120n,
  UPGRADE: 1n << 124n,
  admin: A,
});

const both = (r) => r | A(r);

/** Every PermissionedResolver role + its admin: the artist owns their resolver completely. */
export const RESOLVER_OWNER_ROLES = [
  RES.SET_ADDRESS, RES.SET_TEXT, RES.SET_CONTENTHASH, RES.SET_ABI, RES.SET_INTERFACE,
  RES.SET_NAME, RES.SET_DATA, RES.LINK, RES.UPGRADE,
].reduce((m, r) => m | both(r), 0n);

/**
 * Token roles given to the artist on their own subname at registration.
 * Admin token roles can ONLY be assigned at registration in PermissionedRegistry, so this is the
 * moment the artist receives full control: resolver, subregistry, renew, unregister, transfer.
 */
export const ARTIST_TOKEN_ROLES =
  both(REG.SET_RESOLVER) | both(REG.SET_SUBREGISTRY) | both(REG.RENEW) | both(REG.UNREGISTER) | REG.CAN_TRANSFER_ADMIN;

/**
 * Root roles on the osoartist.eth UserRegistry.
 * Nobody receives UPGRADE/UPGRADE_ADMIN or any UNEMANCIPATED role at root → isEmancipated() == true,
 * the implementation is frozen, and no root holder can unregister, re-point or move an artist's name.
 */
export const USER_REGISTRY_ROOT = Object.freeze({
  // OSO registrar agent: may only create NEW names (register reverts on REGISTERED), extend expiry, set the parent pointer.
  registrar: REG.REGISTRAR | REG.RENEW | REG.SET_PARENT,
  // Shaka (parent owner): may replace/revoke the registrar agent; cannot touch existing names.
  parentOwner: A(REG.REGISTRAR) | A(REG.RENEW) | A(REG.SET_PARENT) | both(REG.SET_URI),
});

export function loadAbi(name) {
  return require(`../abi/${name}.json`);
}
