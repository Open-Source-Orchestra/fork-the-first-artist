import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
await mkdir(new URL('generated/', root), { recursive: true });
await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: ['src/hashpack-runtime.mjs'],
  outfile: 'generated/hashpack-runtime.mjs',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  legalComments: 'linked',
});
await copyFile(new URL('node_modules/@walletconnect/sign-client/LICENSE.md', root), new URL('generated/walletconnect-license.txt', root));
await copyFile(new URL('node_modules/qrcode/license', root), new URL('generated/qrcode-license.txt', root));
console.log('Built the local HashPack runtime and third-party license notices. No project ID is embedded.');
