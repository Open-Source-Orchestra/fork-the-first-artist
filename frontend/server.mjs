import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Exact routes keep repository files, credentials and runtime data out
// of the response path. This is a loopback-only preview, not a backend or deploy target.
const assets = new Map(await Promise.all([
  ['/', 'index.html', 'text/html; charset=utf-8'],
  ['/styles.css', 'styles.css', 'text/css; charset=utf-8'],
].map(async ([route, file, type]) => [route, {
  body: await readFile(new URL(`./public/${file}`, import.meta.url)),
  type,
}])));

export function createPreviewServer() {
  return createServer({ requestTimeout: 10_000, headersTimeout: 10_000 }, (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
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
    const asset = assets.get(req.url?.split('?')[0]);
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
    console.log('Sample content only. Stop with Ctrl+C; restart after editing assets.');
  });
}
