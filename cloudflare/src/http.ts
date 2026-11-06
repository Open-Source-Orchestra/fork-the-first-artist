export const MAX_BODY_BYTES = 2_048;
export const MAX_QUESTION_CHARS = 280;

export const ALLOWED_ORIGINS = new Set([
  'https://artist.opensourceorchestra.org',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:8787',
  'http://127.0.0.1:8787',
]);

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers?: Record<string, string>;

  constructor(status: number, code: string, message: string, headers?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function errorBody(code: string, message: string) {
  return { ok: false, error: code, message, answer: null, settled: false, proof: null };
}

async function readBytes(request: Request): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new HttpError(413, 'BODY_TOO_LARGE', `JSON body must be at most ${MAX_BODY_BYTES} bytes`);
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, 'BODY_TOO_LARGE', `JSON body must be at most ${MAX_BODY_BYTES} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Accept only the narrow public schema; payout/model/messages cannot be overridden. */
export async function readQuestion(request: Request): Promise<string> {
  if (new URL(request.url).search) {
    throw new HttpError(400, 'QUERY_NOT_ALLOWED', 'send only a JSON body with one question');
  }
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new HttpError(415, 'JSON_REQUIRED', 'Content-Type must be application/json');
  }
  const bytes = await readBytes(request);
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'send a valid JSON object');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'INVALID_JSON', 'send a JSON object with one question');
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => key !== 'question' && key !== 'instruction')) {
    throw new HttpError(
      400,
      'UNSUPPORTED_FIELDS',
      'only question (or instruction) is accepted; artist payout and model are server-configured',
    );
  }
  if (keys.length !== 1) {
    throw new HttpError(400, 'ONE_QUESTION_REQUIRED', 'send exactly one of question or instruction');
  }
  const raw = record.question ?? record.instruction;
  if (typeof raw !== 'string') throw new HttpError(400, 'INVALID_QUESTION', 'question must be a string');
  const question = raw.trim();
  if (!question) throw new HttpError(400, 'MISSING_QUESTION', 'question cannot be empty');
  if (question.length > MAX_QUESTION_CHARS || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(question)) {
    throw new HttpError(
      400,
      'INVALID_QUESTION',
      `question must be at most ${MAX_QUESTION_CHARS} characters and contain no control characters`,
    );
  }
  return question;
}

export function withCommonHeaders(response: Response, request: Request): Response {
  const origin = request.headers.get('origin');
  const out = new Response(response.body, response);
  out.headers.set('cache-control', 'no-store');
  out.headers.set('x-content-type-options', 'nosniff');
  out.headers.set('referrer-policy', 'no-referrer');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    out.headers.set('access-control-allow-origin', origin);
    out.headers.set('access-control-expose-headers', 'payment-required, x-payment-response, x-0g-request-id, ZG-Res-Key');
    out.headers.append('vary', 'origin');
  }
  return out;
}
