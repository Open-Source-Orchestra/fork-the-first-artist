/**
 * The steward's HTTP face. `/ask` is the only route the payments service needs.
 *
 * Note the trust boundary: this service answers because payments/ verified and
 * will settle. It does not itself take money - there is exactly one place that
 * settles x402 on this project, and it is payments/.
 *
 * ## The three routes
 *
 * | Route | Purpose |
 * |---|---|
 * | `GET /health` | liveness + which provider/model/tools are actually live |
 * | `GET /agent-card` | machine-readable description: artist, agent, every provider with a `usable` flag and the reason it is not |
 * | `POST /ask` | the one route the paywall uses |
 *
 * `/agent-card` reporting `usable: false` **with a reason** is deliberate: a demo that
 * silently degraded to the fake provider would look identical to one that works.
 */
import { createServer, type Server } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP, type AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { createSteward, loadArtist } from './index.ts';
import { loadAgentConfig, providerAvailability } from './config.ts';
import { readBody, parseJson, sendJson, log } from './http.ts';
import type { AgentConfig, AgentInterface, ArtistProfile, OutputSchema } from './types.ts';

export interface StewardServerOptions {
  port?: number;
  host?: string;
  /** Required for every /ask call when set; mandatory on a non-loopback bind. */
  serviceToken?: string;
  forceFake?: boolean;
  /** Test/integration injection; production normally uses createSteward(). */
  steward?: AgentInterface;
  config?: AgentConfig;
  artist?: ArtistProfile;
}

export interface StewardServerHandle {
  server: Server;
  host: string;
  port: number;
  origin: string;
  close(): Promise<void>;
}

export async function startServer(opts: StewardServerOptions = {}): Promise<StewardServerHandle> {
  const host = opts.host ?? process.env.HOST ?? '127.0.0.1';
  const configuredToken = opts.serviceToken ?? process.env.STEWARD_SERVICE_TOKEN;
  const serviceToken = configuredToken?.trim() || undefined;
  if (!isLoopbackHost(host) && !serviceToken) {
    throw new Error('STEWARD_SERVICE_TOKEN is required when HOST is not loopback');
  }

  const steward = opts.steward ?? (await createSteward({ forceFake: opts.forceFake }));
  const cfg = opts.config ?? loadAgentConfig();
  const artist = opts.artist ?? (await loadArtist());
  const port = opts.port ?? Number(process.env.PORT ?? 8403);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('PORT must be an integer from 0 to 65535');
  }

  const server = createServer((req, res) => {
    void (async () => {
      // This is a service-to-service API, not a browser endpoint. No wildcard
      // CORS opt-in: browser preflights fail instead of exposing localhost spend.
      if (req.method === 'OPTIONS') return void res.writeHead(204, { allow: 'GET,POST,OPTIONS' }).end();

      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

      try {
        if (url.pathname === '/health') {
          return sendJson(res, 200, { ok: true, ...steward.describe(), uptimeSec: Math.round(process.uptime()) });
        }

        // Every configured provider, with why it is or is not usable. The reason string
        // is the difference between "the demo works" and "the demo works because it
        // silently fell back to the fake".
        if (url.pathname === '/agent-card') {
          const providers = Object.entries(cfg.providers)
            .filter(([, p]) => p.kind === 'inference')
            .map(([id, p]) => {
              const avail = providerAvailability(p);
              return {
                id,
                label: p.label,
                model: p.defaultModel,
                transport: p.transport,
                capabilities: p.capabilities,
                usable: avail.usable,
                note: publicProviderNote(avail),
                isDefault: id === cfg.default,
              };
            });
          return sendJson(res, 200, {
            artist: { name: artist.name, ensName: artist.ensName, bio: artist.bio, songs: artist.songs },
            agent: steward.describe(),
            providers,
            rail: cfg.rail,
          });
        }

        if (url.pathname === '/ask' && req.method === 'POST') {
          if (serviceToken && !validBearer(req.headers.authorization, serviceToken)) {
            return sendJson(
              res,
              401,
              { ok: false, error: { code: 'UNAUTHORIZED', message: 'valid service bearer token required' } },
              { 'www-authenticate': 'Bearer realm="steward"' },
            );
          }
          const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
          if (contentType !== 'application/json') {
            // Requiring JSON forces browser cross-origin callers through a
            // preflight (which receives no CORS grant), and rejects simple forms.
            return sendJson(res, 415, {
              ok: false,
              error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'application/json required' },
            });
          }
          const body = parseJson(await readBody(req)) as
            | { instruction?: string; json?: boolean }
            | undefined;
          if (typeof body?.instruction !== 'string' || !body.instruction.trim()) {
            return sendJson(res, 400, { ok: false, error: { code: 'BAD_REQUEST', message: 'instruction required' } });
          }

          const output: OutputSchema<{ text: string }> | undefined = body.json
            ? {
                jsonSchema: {
                  type: 'object',
                  properties: { text: { type: 'string' } },
                  required: ['text'],
                  additionalProperties: false,
                },
                parse: (v) => {
                  const o = v as { text?: unknown };
                  if (typeof o?.text !== 'string') throw new Error('expected { text: string }');
                  return { text: o.text };
                },
              }
            : undefined;

          // Provider, model, and tools are operator-controlled. Ignore any
          // client-supplied override fields rather than letting a caller choose
          // a more expensive backend or a different capability set.
          const result = await steward.run({
            instruction: body.instruction,
            tools: ['get_artist_profile', 'get_songs', 'quote_tip'],
            output,
            context: { artist },
          });
          // 422, not 500: a steward refusal (bad request, no consent, unsupported
          // capability) is the client's problem, not a server fault.
          return sendJson(res, result.ok ? 200 : 422, result);
        }

        sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'try /health, /agent-card, POST /ask' } });
      } catch (err) {
        log.error('ask failed', { err: (err as Error).message });
        if (!res.headersSent) {
          sendJson(res, 500, { ok: false, error: { code: 'INTERNAL', message: 'steward request failed' } });
        }
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const d = steward.describe();
  log.info('steward listening', {
    host,
    port: address.port,
    provider: d.provider,
    model: d.model,
    transport: d.transport,
    rail: d.rail,
    tools: d.tools.length,
    serviceAuth: Boolean(serviceToken),
  });
  const originHost = host.includes(':') ? `[${host}]` : host;
  return {
    server,
    host,
    port: address.port,
    origin: `http://${originHost}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function validBearer(header: string | undefined, expectedToken: string): boolean {
  const match = /^Bearer ([^\s]+)$/i.exec(header ?? '');
  if (!match) return false;
  // Hash both sides so timingSafeEqual always receives equal-length buffers,
  // including when the presented token has a different length.
  const presented = createHash('sha256').update(match[1]!, 'utf8').digest();
  const expected = createHash('sha256').update(expectedToken, 'utf8').digest();
  return timingSafeEqual(presented, expected);
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === 'localhost' || normalized === '::1') return true;
  const mappedV4 = normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
  if (isIP(mappedV4) !== 4) return false;
  return mappedV4.split('.')[0] === '127';
}

function publicProviderNote(avail: { usable: boolean; reason?: string }): string | undefined {
  if (!avail.usable) return 'required provider credentials are not configured';
  if (avail.reason) return 'development/mock payment configuration';
  return undefined;
}

// Only listen when executed directly (`node src/server.ts`), so importing this module
// from a test does not open a socket. Compared via pathToFileURL to stay correct on
// Windows, where a naive string compare of paths fails.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startServer();
}
