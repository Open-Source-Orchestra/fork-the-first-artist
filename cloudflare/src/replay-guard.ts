interface Entry {
  state: 'inflight' | 'used';
  updatedAt: number;
}

export type PaymentClaim =
  | {
      ok: true;
      lease: {
        /** No settlement was authorized; permit a later retry of the signed payment. */
        release: () => Promise<void>;
        /** Persist compute consumption before settlement; reject replays. */
        seal: () => Promise<void>;
      };
    }
  | { ok: false; state: 'inflight' | 'used' };

/**
 * Isolate-local compute replay guard. This is not a global x402 ledger: the
 * facilitator remains the authority on duplicate settlement. Only a SHA-256
 * digest of the payment header is retained, never the signed payload itself.
 */
export class PaymentReplayGuard {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(now: () => number = Date.now, ttlMs = 3_600_000, maxEntries = 5_000) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  async begin(paymentHeader: string): Promise<PaymentClaim> {
    const key = await digest(paymentHeader);
    const now = this.now();
    this.prune(now);
    const existing = this.entries.get(key);
    if (existing) return { ok: false, state: existing.state };
    this.entries.set(key, { state: 'inflight', updatedAt: now });

    let sealed = false;
    return {
      ok: true,
      lease: {
        release: async () => {
          if (sealed) return;
          const current = this.entries.get(key);
          if (current?.state === 'inflight') this.entries.delete(key);
        },
        seal: async () => {
          if (sealed) return;
          sealed = true;
          const current = this.entries.get(key);
          if (current) this.entries.set(key, { state: 'used', updatedAt: this.now() });
        },
      },
    };
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.updatedAt >= this.ttlMs) this.entries.delete(key);
    }
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }
}

export interface ReplayNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(url: string, init?: RequestInit): Promise<Response> };
}

/** Production guard backed by one globally consistent Durable Object. */
export class DurablePaymentReplayGuard {
  private readonly stub: ReturnType<ReplayNamespace['get']>;
  constructor(namespace: ReplayNamespace) {
    this.stub = namespace.get(namespace.idFromName('global'));
  }
  async begin(paymentHeader: string): Promise<PaymentClaim> {
    const key = await digest(paymentHeader);
    const response = await this.stub.fetch('https://replay.internal/claim', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }),
    });
    const result = await response.json() as any;
    if (!response.ok || (result.ok !== false && result.ok !== true)) throw new Error('invalid replay claim');
    if (!result.ok) {
      if (result.state !== 'inflight' && result.state !== 'used') throw new Error('invalid replay state');
      return { ok: false, state: result.state };
    }
    return {
      ok: true,
      lease: {
        release: () => this.command('release', key),
        seal: () => this.command('seal', key),
      },
    };
  }
  private async command(command: 'release' | 'seal', key: string): Promise<void> {
    const response = await this.stub.fetch(`https://replay.internal/${command}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }),
    });
    if (!response.ok) throw new Error('replay lease update failed');
  }
}

interface StoredEntry { state: 'inflight' | 'used'; expiresAt: number }
interface ReplayStorage {
  get(key: string): Promise<StoredEntry | undefined>;
  put(key: string, value: StoredEntry): Promise<void>;
  delete(key: string): Promise<unknown>;
}
interface ReplayState {
  storage: ReplayStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

/** One-hour claim exceeds the 180-second signed-payment lifetime; this is not a spend ledger. */
export class PaymentReplayDurableObject {
  private readonly state: ReplayState;
  constructor(state: ReplayState) { this.state = state; }
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return Response.json({ error: 'method' }, { status: 405 });
    const command = new URL(request.url).pathname;
    if (!['/claim', '/release', '/seal'].includes(command)) return Response.json({ error: 'route' }, { status: 404 });
    const body = await request.json() as { key?: unknown };
    if (typeof body.key !== 'string' || !/^[a-f0-9]{64}$/.test(body.key)) {
      return Response.json({ error: 'key' }, { status: 400 });
    }
    const key = `payment:${body.key}`;
    return this.state.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const current = await this.state.storage.get(key);
      const active = current && current.expiresAt > now ? current : undefined;
      if (command === '/claim') {
        if (active) return Response.json({ ok: false, state: active.state });
        await this.state.storage.put(key, { state: 'inflight', expiresAt: now + 3_600_000 });
        return Response.json({ ok: true });
      }
      if (command === '/release') {
        if (current && (!active || current.state === 'inflight')) await this.state.storage.delete(key);
      } else {
        await this.state.storage.put(key, { state: 'used', expiresAt: now + 3_600_000 });
      }
      return Response.json({ ok: true });
    });
  }
}

async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
