// Entry for public/vendor/viem-tip.min.js (built by scripts/build-viem-tip.mjs): what the 💸 multichain
// tip needs to READ ENS on Ethereum mainnet (Universal Resolver, ENSIP-11/19 coin types) and to encode /
// decode plain ERC-20 calls. No wallet client, no keys: the fan's own wallet signs every transfer.
export { createPublicClient, http, fallback, getAddress, isAddress, encodeFunctionData, decodeFunctionResult, toCoinType } from 'viem';
export { normalize } from 'viem/ens';
export { mainnet } from 'viem/chains';
