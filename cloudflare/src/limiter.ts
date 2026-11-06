interface Bucket {
  startedAt: number;
  count: number;
}

export type DemoPermit =
  | { ok: true; release: () => void }
  | { ok: false; retryAfterSeconds: number };

/**
 * Best-effort isolate-local abuse control, not a global spend ledger.
 * The tiny dedicated fan balance is the final financial ceiling.
 */
export class DemoLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private inflight = 0;
  private readonly limits: { ip: number; global: number; inflight: number };
  private readonly now: () => number;

  constructor(limits: { ip: number; global: number; inflight: number }, now: () => number = Date.now) {
    this.limits = limits;
    this.now = now;
  }

  acquire(ip: string): DemoPermit {
    const now = this.now();
    this.prune(now);
    if (this.inflight >= this.limits.inflight) return { ok: false, retryAfterSeconds: 1 };

    const globalKey = 'global';
    const ipKey = `ip:${ip.slice(0, 64)}`;
    const global = this.freshBucket(globalKey, now);
    const perIp = this.freshBucket(ipKey, now);
    this.prune(now, [globalKey, ipKey]);
    if (global.count >= this.limits.global || perIp.count >= this.limits.ip) {
      const oldestRelevantStart = Math.max(global.startedAt, perIp.startedAt);
      return {
        ok: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldestRelevantStart + 60_000 - now) / 1000)),
      };
    }

    global.count += 1;
    perIp.count += 1;
    this.inflight += 1;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.inflight = Math.max(0, this.inflight - 1);
      },
    };
  }

  private freshBucket(key: string, now: number): Bucket {
    const existing = this.buckets.get(key);
    if (existing && now - existing.startedAt < 60_000) return existing;
    const bucket = { startedAt: now, count: 0 };
    this.buckets.set(key, bucket);
    return bucket;
  }

  private prune(now: number, protectedKeys: string[] = []): void {
    if (this.buckets.size < 1_000) return;
    for (const [key, bucket] of this.buckets) {
      if (!protectedKeys.includes(key) && now - bucket.startedAt >= 60_000) this.buckets.delete(key);
    }
    // Bound memory even under a continuously rotating source-IP flood.
    if (this.buckets.size > 1_500) {
      const excess = this.buckets.size - 1_500;
      let removed = 0;
      for (const key of this.buckets.keys()) {
        if (key === 'global' || protectedKeys.includes(key)) continue;
        this.buckets.delete(key);
        if (++removed >= excess) break;
      }
    }
  }
}
