import { callZeroG, DEFAULT_STEWARD, STEWARDS, ZeroGError, type StewardMode, type ZeroGConfig } from './zero-g.ts';
import { DemoLimiter } from './limiter.ts';

interface ZeroGPublicEnv {
  UPSTREAM_API_KEY?: string;
  UPSTREAM_BASE_URL?: string;
  UPSTREAM_MODEL?: string;
  UPSTREAM_TRUST_MODE?: string;
  DEMO_MAX_OUTPUT_TOKENS?: string;
}

const ALLOWED_ORIGINS = new Set([
  'https://artist.opensourceorchestra.org',
  'https://artist-preview-kzu6ctlpau-ffieyo32.taur.link',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
]);
const GROUNDING: Record<StewardMode, string> = {
  demo: 'fictional demo profile',
  asked: 'public garden profile only',
  preview: 'public garden profile only · preview, the artist has not activated their own steward',
};

/** Counts only: the roster itself is public on the garden, the Worker need not echo 40 slugs. */
function stewardCounts() {
  const all = Object.values(STEWARDS);
  return {
    total: all.length,
    demo: all.filter((s) => s.mode === 'demo').length,
    asked: all.filter((s) => s.mode === 'asked').length,
    preview: all.filter((s) => s.mode === 'preview').length,
    default: DEFAULT_STEWARD,
  };
}

const limiter = new DemoLimiter({ ip: 4, global: 12, inflight: 2 });

function config(env: ZeroGPublicEnv): ZeroGConfig {
  if (!env.UPSTREAM_API_KEY || !env.UPSTREAM_MODEL) throw new Error('0G is not configured');
  const maxOutputTokens = Number(env.DEMO_MAX_OUTPUT_TOKENS ?? '512');
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 64 || maxOutputTokens > 768) throw new Error('invalid output limit');
  const base = (env.UPSTREAM_BASE_URL ?? 'https://router-api.0g.ai/v1').replace(/\/+$/, '');
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('invalid upstream URL');
  return {
    upstreamApiKey: env.UPSTREAM_API_KEY,
    upstreamBaseUrl: base,
    upstreamModel: env.UPSTREAM_MODEL,
    upstreamTrustMode: env.UPSTREAM_TRUST_MODE ?? 'verified',
    maxOutputTokens,
  };
}

function cors(origin: string | null): Record<string, string> {
  return origin && ALLOWED_ORIGINS.has(origin)
    ? {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
        vary: 'Origin',
      }
    : { vary: 'Origin' };
}

function json(data: unknown, status = 200, origin: string | null = null, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors(origin), ...extra },
  });
}

export default {
  async fetch(request: Request, env: ZeroGPublicEnv): Promise<Response> {
    const origin = request.headers.get('origin');
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (url.pathname === '/health') {
      return json({
        ok: true,
        provider: '0g',
        model: env.UPSTREAM_MODEL ?? null,
        network: (env.UPSTREAM_BASE_URL ?? 'https://router-api.0g.ai/v1').includes('testnet') ? 'testnet' : 'mainnet',
        inference: 'live 0G Private Computer',
        payment: false,
        selfFunding: false,
        stewards: stewardCounts(),
        rateLimit: 'best-effort isolate-local; tiny capped credit is the final ceiling',
      }, 200, origin);
    }
    if (url.pathname !== '/ask') return json({ ok: false, error: { code: 'NOT_FOUND', message: 'use GET /health or POST /ask' } }, 404, origin);
    if (request.method !== 'POST') return json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, 405, origin, { allow: 'POST' });
    if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      return json({ ok: false, error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'application/json required' } }, 415, origin);
    }
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const permit = limiter.acquire(ip);
    if (!permit.ok) return json({ ok: false, error: { code: 'RATE_LIMITED', message: 'please retry shortly' } }, 429, origin, { 'retry-after': String(permit.retryAfterSeconds) });
    try {
      const text = await request.text();
      if (text.length > 8_192) return json({ ok: false, error: { code: 'BODY_TOO_LARGE', message: 'question body is too large' } }, 413, origin);
      const body = JSON.parse(text) as { instruction?: unknown; artist?: unknown } | null;
      if (!body || typeof body !== 'object' || typeof body.instruction !== 'string' || !body.instruction.trim() || body.instruction.trim().length > 280) {
        return json({ ok: false, error: { code: 'BAD_REQUEST', message: 'instruction must be 1–280 characters' } }, 400, origin);
      }
      const slug = body.artist === undefined || body.artist === null ? DEFAULT_STEWARD : body.artist;
      const steward = typeof slug === 'string' && Object.hasOwn(STEWARDS, slug) ? STEWARDS[slug] : undefined;
      if (!steward) {
        return json({ ok: false, error: { code: 'UNKNOWN_ARTIST', message: 'artist must be the slug of an artist in the Open Source Orchestra garden (omit it for the fictional demo steward)' } }, 400, origin);
      }
      const result = await callZeroG(body.instruction.trim(), config(env), fetch, steward);
      return json({
        ok: true,
        artist: { slug: steward.slug, name: steward.label, fictional: steward.fictional, mode: steward.mode, grounding: GROUNDING[steward.mode] },
        reply: { text: result.answer },
        usage: result.usage,
        charged: false,
        proof: result.provenance,
      }, 200, origin);
    } catch (error) {
      if (error instanceof SyntaxError) return json({ ok: false, error: { code: 'BAD_JSON', message: 'invalid JSON' } }, 400, origin);
      if (error instanceof ZeroGError) {
        return json({ ok: false, error: { code: error.kind === 'degraded' ? 'ZERO_G_DEGRADED' : 'ZERO_G_UNAVAILABLE', message: 'real 0G inference is temporarily unavailable; no mock answer was substituted', charged: false } }, 502, origin);
      }
      return json({ ok: false, error: { code: 'BAD_CONFIGURATION', message: 'the steward is not configured' } }, 503, origin);
    } finally {
      if (permit.ok) permit.release();
    }
  },
};
