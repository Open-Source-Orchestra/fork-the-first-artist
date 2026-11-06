import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join, sep } from 'node:path';

// Exact routes keep repository files, credentials and runtime data out
// of the response path. This is a loopback-only preview, not a backend or deploy target.
const GARDEN_TYPES = { '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
async function gardenTree(dirs) {
  const out = [];
  for (const dir of dirs) {
    for (const entry of await readdir(new URL(`./public/${dir}/`, import.meta.url), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const rel = join(entry.parentPath ?? entry.path, entry.name).split(`${sep}public${sep}`).pop().split(sep).join('/');
      const ext = rel.slice(rel.lastIndexOf('.')).toLowerCase();
      if (!/^[A-Za-z0-9._/-]+$/.test(rel) || rel.includes('..') || !GARDEN_TYPES[ext]) continue;
      out.push([`/${rel}`, rel, GARDEN_TYPES[ext]]);
    }
  }
  return out;
}

const assets = new Map(await Promise.all([
  ['/', 'index.html', 'text/html; charset=utf-8'],
  ['/list', 'list.html', 'text/html; charset=utf-8'],
  // The Open Source Orchestra garden circle (front door) + the Fork the First Artist layer.
  ...['app.js', 'finder.js', 'keys.js', 'overlay.js', 'fork.js'].map((f) => [`/${f}`, f, 'text/javascript; charset=utf-8']),
  ...['finder.css', 'keys.css', 'ef.css', 'fork.css'].map((f) => [`/${f}`, f, 'text/css; charset=utf-8']),
  ...(await gardenTree(['data', 'fork', 'img', 'history', 'vendor'])),
  ['/home', 'home.html', 'text/html; charset=utf-8'],
  ['/circle.css', 'circle.css', 'text/css; charset=utf-8'],
  ['/circle.mjs', 'circle.mjs', 'text/javascript; charset=utf-8'],
  ['/circle-state.mjs', 'circle-state.mjs', 'text/javascript; charset=utf-8'],
  ['/circle/artists.mjs', 'circle/artists.mjs', 'text/javascript; charset=utf-8'],
  ['/draft', 'draft.html', 'text/html; charset=utf-8'],
  ['/wallets', 'wallets.html', 'text/html; charset=utf-8'],
  ['/arkiv', 'arkiv.html', 'text/html; charset=utf-8'],
  ['/arkiv.mjs', 'arkiv.mjs', 'text/javascript; charset=utf-8'],
  ['/arkiv-query.mjs', 'arkiv-query.mjs', 'text/javascript; charset=utf-8'],
  ['/arkiv-proof.json', 'arkiv-proof.json', 'application/json; charset=utf-8'],
  ['/arkiv.css', 'arkiv.css', 'text/css; charset=utf-8'],
  ['/steward', 'steward.html', 'text/html; charset=utf-8'],
  ['/steward.mjs', 'steward.mjs', 'text/javascript; charset=utf-8'],
  ['/styles.css', 'styles.css', 'text/css; charset=utf-8'],
  ['/draft.mjs', 'draft.mjs', 'text/javascript; charset=utf-8'],
  ['/profile-draft.mjs', 'profile-draft.mjs', 'text/javascript; charset=utf-8'],
  ['/wallets.mjs', 'wallets.mjs', 'text/javascript; charset=utf-8'],
  ['/ethereum-wallet.mjs', 'ethereum-wallet.mjs', 'text/javascript; charset=utf-8'],
  ['/hedera-wallet.mjs', 'hedera-wallet.mjs', 'text/javascript; charset=utf-8'],
  ['/hashpack-ui.mjs', 'hashpack-ui.mjs', 'text/javascript; charset=utf-8'],
  ...(await readdir(new URL('./public/circle/img/', import.meta.url))).filter((f) => /^[a-z0-9-]+\.jpg$/.test(f))
    .map((f) => [`/circle/img/${f}`, `circle/img/${f}`, 'image/jpeg']),
].map(async ([route, file, type]) => [route, {
  body: await readFile(new URL(`./public/${file}`, import.meta.url)),
  type,
}])));

let runtimeReady = true;
for (const [file, type] of [
  ['hashpack-runtime.mjs', 'text/javascript; charset=utf-8'],
  ['hashpack-runtime.mjs.LEGAL.txt', 'text/plain; charset=utf-8'],
  ['walletconnect-license.txt', 'text/plain; charset=utf-8'],
  ['qrcode-license.txt', 'text/plain; charset=utf-8'],
]) {
  try {
    assets.set(`/${file}`, { body: await readFile(new URL(`./generated/${file}`, import.meta.url)), type });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    runtimeReady = false;
  }
}

export function createPreviewServer({ projectId = process.env.REOWN_PROJECT_ID ?? '' } = {}) {
  if (typeof projectId !== 'string' || (projectId !== '' && !/^[a-f0-9]{32}$/i.test(projectId))) {
    throw new Error('REOWN_PROJECT_ID must be empty or a 32-character hexadecimal public project ID.');
  }
  const walletConfig = { type: 'application/json; charset=utf-8', body: Buffer.from(JSON.stringify({ projectId, runtimeReady, enabled: Boolean(projectId) && runtimeReady })) };
  return createServer({ requestTimeout: 10_000, headersTimeout: 10_000 }, (req, res) => {
    const route = req.url?.split('?')[0];
    const walletPolicy = route === '/wallets'
      ? " connect-src 'self' wss://relay.walletconnect.com wss://relay.walletconnect.org https://verify.walletconnect.com https://verify.walletconnect.org; frame-src https://verify.walletconnect.com https://verify.walletconnect.org;"
      : '';
    const arkivPolicy = route === '/arkiv'
      ? " connect-src 'self' https://rpc.rabdi.db-chain.testnet.arkiv.network;"
      : '';
    const stewardPolicy = route === '/steward'
      ? " connect-src 'self' https://oso-zerog-steward.shakaverse.workers.dev;"
      : '';
    // The garden circle front door carries inline style/script from the upstream OSO page and fetches
    // the live 0G steward + the garden's public keys; every other route keeps the strict policy.
    const gardenPolicy = route === '/'
      ? "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://oso-zerog-steward.shakaverse.workers.dev https://opensourceorchestra.org; base-uri 'none'; form-action 'none'; frame-ancestors 'none';"
      : null;
    res.setHeader('Content-Security-Policy', gardenPolicy ?? ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none';" + walletPolicy + arkivPolicy + stewardPolicy));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end('Method not allowed');
      return;
    }

    // Deliberately do not decode, normalize, or resolve a request path on disk.
    const asset = route === '/wallet-config.json' ? walletConfig : assets.get(route);
    if (!asset) {
      res.writeHead(404);
      res.end(req.method === 'HEAD' ? undefined : 'Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': asset.body.byteLength });
    res.end(req.method === 'HEAD' ? undefined : asset.body);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const portText = process.env.PORT ?? '4173';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const server = createPreviewServer();
  server.on('error', (error) => {
    console.error(`Frontend preview could not start (${error.code ?? 'unknown error'}).`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Artist home preview: http://127.0.0.1:${port}`);
    console.log('Local preview only. Stop with Ctrl+C; restart after editing assets.');
  });
}
