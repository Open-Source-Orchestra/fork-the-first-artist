// Rebuild public/vendor/viem-ens.min.js from the viem copy pinned in ens/package-lock.json.
//   node frontend/scripts/build-viem-ens.mjs
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const viemDir = fileURLToPath(new URL('../ens/node_modules/', root));
const version = JSON.parse(readFileSync(new URL('../ens/node_modules/viem/package.json', root), 'utf8')).version;
await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: ['src/viem-ens-entry.mjs'],
  outfile: 'public/vendor/viem-ens.min.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  nodePaths: [viemDir],
  legalComments: 'none',
  banner: { js: `/*! viem ${version} (MIT, https://github.com/wevm/viem) — browser bundle of encodeFunctionData/decodeFunctionResult/decodeErrorResult/namehash/getAddress/isAddress only, built with esbuild (frontend/scripts/build-viem-ens.mjs) for the OSO /payout page. */` },
});
console.log(`built public/vendor/viem-ens.min.js from viem ${version}`);
