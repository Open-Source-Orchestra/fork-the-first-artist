// Entry for public/vendor/viem-ens.min.js (built by scripts/build-viem-ens.mjs): the few pure viem
// helpers the /payout page needs to read ENS records and build the artist's own resolver calldata.
// No clients, no transports, no keys: the page does its own JSON-RPC fetches and the wallet signs.
export { decodeErrorResult, decodeFunctionResult, encodeFunctionData, getAddress, isAddress, namehash } from 'viem';
