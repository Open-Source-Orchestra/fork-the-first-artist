// Rebuild public/vendor/viem-tip.min.js from the viem copy pinned in ens/package-lock.json.
//   node frontend/scripts/build-viem-tip.mjs
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const viemDir = fileURLToPath(new URL('../ens/node_modules/', root));
const version = JSON.parse(readFileSync(new URL('../ens/node_modules/viem/package.json', root), 'utf8')).version;
await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: ['src/viem-tip-entry.mjs'],
  outfile: 'public/vendor/viem-tip.min.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  nodePaths: [viemDir],
  legalComments: 'none',
  banner: { js: `/*! viem ${version} (MIT, https://github.com/wevm/viem) — browser bundle of createPublicClient/http/fallback/normalize/toCoinType/getAddress/isAddress/encodeFunctionData/decodeFunctionResult, built with esbuild (frontend/scripts/build-viem-tip.mjs) for the OSO multichain tip (ENS reads on mainnet only). */` },
});
console.log(`built public/vendor/viem-tip.min.js from viem ${version}`);
