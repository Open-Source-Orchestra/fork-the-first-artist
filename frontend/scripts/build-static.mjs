#!/usr/bin/env node
/** Build only the public static app. Never include .env, secrets, repository files, or runtime state. */
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { resolve, dirname, basename, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const generatedRoot = fileURLToPath(new URL('../generated/', import.meta.url));
const args = process.argv.slice(2);
const out = resolve(args.find((arg) => !arg.startsWith('--')) ?? '');
if (!args[0] || out === publicRoot || out.startsWith(`${publicRoot}${sep}`) || out === resolve('/') || out === dirname(publicRoot)) {
  throw new Error('Usage: node frontend/scripts/build-static.mjs OUTPUT_DIR [--wallet-runtime] [--cname=example.org]');
}
const walletRuntime = args.includes('--wallet-runtime');
const cnameArg = args.find((arg) => arg.startsWith('--cname='))?.slice('--cname='.length);
if (cnameArg && !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(cnameArg)) throw new Error('Invalid CNAME');
const projectId = process.env.REOWN_PROJECT_ID ?? '';
if (projectId && !/^[a-f0-9]{32}$/i.test(projectId)) throw new Error('REOWN_PROJECT_ID must be empty or 32 hexadecimal characters');

const marker = join(out, '.fork-artist-static.json');
const exists = async (path) => { try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
if (await exists(out)) {
  if (!await exists(marker)) throw new Error(`Refusing to clean ${out}: no .fork-artist-static.json marker`);
  const parsed = JSON.parse(await readFile(marker, 'utf8'));
  if (parsed.format !== 1) throw new Error('Unknown static-build marker');
  await rm(out, { recursive: true, force: false });
}
await mkdir(out, { recursive: true });
await cp(publicRoot, out, { recursive: true, dereference: true, errorOnExist: false });

// GitHub Pages and the preview host route /draft to /draft/index.html, etc.
for (const entry of await readdir(out, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.html') || entry.name === 'index.html') continue;
  const route = basename(entry.name, '.html');
  await mkdir(join(out, route), { recursive: true });
  await rename(join(out, entry.name), join(out, route, 'index.html'));
}

if (walletRuntime) {
  for (const file of ['hashpack-runtime.mjs', 'hashpack-runtime.mjs.LEGAL.txt', 'walletconnect-license.txt', 'qrcode-license.txt']) {
    await cp(join(generatedRoot, file), join(out, file), { dereference: true, errorOnExist: false });
  }
}
await writeFile(join(out, 'wallet-config.json'), `${JSON.stringify({
  projectId: walletRuntime ? projectId : '',
  runtimeReady: walletRuntime,
  enabled: walletRuntime && Boolean(projectId),
})}\n`, { flag: 'wx' });
await writeFile(join(out, '.nojekyll'), '', { flag: 'wx' });
if (cnameArg) await writeFile(join(out, 'CNAME'), `${cnameArg}\n`, { flag: 'wx' });
await writeFile(marker, `${JSON.stringify({ format: 1, source: 'frontend/public', walletRuntime })}\n`, { flag: 'wx' });
console.log(`Static app built at ${out}; wallet runtime ${walletRuntime ? 'included' : 'disabled'}.`);
