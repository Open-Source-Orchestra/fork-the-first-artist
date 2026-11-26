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
  // 🖼️ Open Source Orchestra Frames on this door: the first-party resolver + page-side clearance + per-artist overlays (artists/<slug>/frame.json).
  ['/frame-overlay.js', 'frame-overlay.js', 'text/javascript; charset=utf-8'],
  ['/artist-frame.css', 'artist-frame.css', 'text/css; charset=utf-8'],
  ['/artists', 'artists/index.html', 'text/html; charset=utf-8'],
  ...(await gardenTree(['artists'])),
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
  // ⚡ tip the artist: judges trigger the real x402 loop on Hedera testnet (oso-tip-loop Worker).
  ['/pay', 'pay.html', 'text/html; charset=utf-8'],
  ['/pay.mjs', 'pay.mjs', 'text/javascript; charset=utf-8'],
  ['/pay.css', 'pay.css', 'text/css; charset=utf-8'],
  // 💸 tip the artist on any Ethereum chain: the fan's own wallet, two plain transfers, kill switch in tip-config.json.
  ['/tip', 'tip.html', 'text/html; charset=utf-8'],
  ...['tip.mjs', 'tip-core.mjs', 'tip-ens.mjs'].map((f) => [`/${f}`, f, 'text/javascript; charset=utf-8']),
  ['/tip.css', 'tip.css', 'text/css; charset=utf-8'],
  ...['tip-config.json', 'tip-chains.json'].map((f) => [`/${f}`, f, 'application/json; charset=utf-8']),
  // The circle's chain of trust: steward desk (invite/approve/grant), invited artist consent, ENS signing kit.
  ['/admin', 'admin.html', 'text/html; charset=utf-8'],
  ['/trust', 'trust.html', 'text/html; charset=utf-8'],
  ['/consent', 'consent.html', 'text/html; charset=utf-8'],
  ['/ens-sign', 'ens-sign.html', 'text/html; charset=utf-8'],
  // An artist changes the Hedera payout on their OWN osoartist.eth name (their wallet signs; OSO can't).
  ['/payout', 'payout.html', 'text/html; charset=utf-8'],
  ['/payout.mjs', 'payout.mjs', 'text/javascript; charset=utf-8'],
  ['/payout-plan.mjs', 'payout-plan.mjs', 'text/javascript; charset=utf-8'],
  ['/payout.css', 'payout.css', 'text/css; charset=utf-8'],
  ...['admin.mjs', 'consent.mjs', 'consent-message.mjs', 'trust-message.mjs', 'wallet-connect.mjs', 'trust-ledger.mjs', 'ens-sign.mjs'].map((f) => [`/${f}`, f, 'text/javascript; charset=utf-8']),
  ['/trust.css', 'trust.css', 'text/css; charset=utf-8'],
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
    const trustPolicy = route === '/admin' || route === '/consent'
      ? " connect-src 'self';"
      : route === '/trust' ? " connect-src 'self' https://rpc.rabdi.db-chain.testnet.arkiv.network;" : '';
    const stewardPolicy = route === '/steward'
      ? " connect-src 'self' https://oso-zerog-steward.shakaverse.workers.dev;"
      : '';
    // /payout reads public ENS records straight from the same public Ethereum RPCs as PUBLIC_RPCS in payout-plan.mjs.
    const payoutPolicy = route === '/payout'
      ? " connect-src 'self' https://ethereum-rpc.publicnode.com https://eth.drpc.org https://1rpc.io;"
      : '';
    const payPolicy = route === '/pay'
      ? " connect-src 'self' https://oso-tip-loop.shakaverse.workers.dev;"
      : '';
    // The garden circle front door carries inline style/script from the upstream OSO page and fetches
    // the live 0G steward + the garden's public keys; every other route keeps the strict policy.
    const gardenPolicy = route === '/'
      ? "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://oso-zerog-steward.shakaverse.workers.dev https://opensourceorchestra.org https://ethereum-rpc.publicnode.com https://eth.drpc.org https://1rpc.io; base-uri 'none'; form-action 'none'; frame-ancestors 'none';"
      : route === '/tip'
        // 💸 multichain tip: ENS reads on the same public Ethereum RPCs as /payout; the fan's wallet does the rest.
        ? "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://ethereum-rpc.publicnode.com https://eth.drpc.org https://1rpc.io; base-uri 'none'; form-action 'none'; frame-ancestors 'none';"
        : null;
    // 🖼️ Pages that wear Open Source Orchestra Frames (the same widening as the pages' own <meta> CSP; the signing lane
    // /pay /payout /wallets /consent /ens-sign /admin keeps script-src 'self' with no third-party runtime).
    const FRAME_ROUTES = new Set(['/', '/tip', '/arkiv', '/trust', '/steward', '/artists']);   // not /home /list /draft: those preview pages make no network connections by design
    const withFrames = (policy) => {
      if (!FRAME_ROUTES.has(route)) return policy;
      const FR = 'https://frames.opensourceorchestra.org', add = {
        'script-src': [FR, 'https://lang.opensourceorchestra.org'],
        'connect-src': [FR, 'https://chat.opensourceorchestra.org', 'https://ohana-chat.shakaverse.workers.dev', 'https://chat.shakaleikaumaka.com', 'https://osodaomeet.opensourceorchestra.org', 'https://live.zuchiangmai.app'],
        'img-src': [FR, 'https://opensourceorchestra.org', 'https://osodaomeet.opensourceorchestra.org', 'https://theater.opensourceorchestra.org', 'https://archive.org'],
        'media-src': [FR, 'https://shakaleikaumaka.com', 'https://theater.opensourceorchestra.org', 'https://archive.org', 'https://osodaomeet.opensourceorchestra.org'],
        'frame-src': ['https://www.youtube-nocookie.com'],
      };
      const dirs = policy.split(';').map((d) => d.trim()).filter(Boolean).map((d) => d.split(/\s+/));
      const byName = new Map(dirs.map((d) => [d[0], d]));
      for (const [name, hosts] of Object.entries(add)) {
        if (!byName.has(name)) { const d = [name, ...(name === 'media-src' || name === 'frame-src' ? [] : ["'self'"])]; dirs.push(d); byName.set(name, d); }
        for (const h of hosts) if (!byName.get(name).includes(h)) byName.get(name).push(h);
      }
      const style = byName.get('style-src');
      if (style && !style.includes("'unsafe-inline'")) style.push("'unsafe-inline'");
      return dirs.map((d) => d.join(' ')).join('; ') + ';';
    };
    res.setHeader('Content-Security-Policy', withFrames(gardenPolicy ?? ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none';" + walletPolicy + arkivPolicy + stewardPolicy + trustPolicy + payPolicy + payoutPolicy)));
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
