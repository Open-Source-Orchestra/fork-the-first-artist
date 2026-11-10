/**
 * Spend budget for the steward.
 *
 * ## Three ceilings, all checked before money moves
 *
 * | Ceiling | Catches |
 * |---|---|
 * | `maxUsdPerRequest` | one expensive prompt |
 * | `maxUsdPerHour` | a burst that would drain the total in a minute |
 * | `maxUsdTotal` | the demo's overall budget |
 *
 * The per-request check runs **before any network call**, so a request that cannot
 * be afforded never costs anything. That is the "spending controls for agents"
 * requirement, and it is also the **graceful-degradation trigger**: the steward turns
 * a refusal into a template reply instead of an error the fan can see.
 *
 * ## State is a file, not memory
 *
 * A restart must not forget what was spent — otherwise a mid-demo crash resets the
 * budget and the spend cap becomes decorative.
 *
 * > The budget file and the payments spend log are separate on purpose. This one is
 * > the agent's *own* view of what it has spent (it also counts tool turns that cost
 * > nothing on-chain); the payments ledger is the *billing* record. They can differ by
 * > design, and neither is allowed to be the other's source of truth.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface BudgetCaps {
  maxUsdPerRequest: number;
  maxUsdPerHour: number;
  maxUsdTotal: number;
}

export interface BudgetEntry {
  at: string;
  // `template` entries are recorded at 0 cost so the file explains a free answer
  kind: 'inference' | 'tool' | 'template';
  spentUsd: number;
  note?: string;
}

/**
 * The answer to "can we afford this?".
 *
 * `scope` says **which** ceiling refused, so the caller can act intelligently: a
 * `request` refusal means "try a shorter/cheaper call", a `total`/`hourly` one means
 * "stop calling the model entirely".
 */
export type BudgetVerdict =
  | { ok: true; remainingUsd: number }
  | { ok: false; scope: 'request' | 'hourly' | 'total'; spentUsd: number; capUsd: number };

export interface BudgetReservation {
  readonly estimatedUsd: number;
  /** Record the completed call's cost and release its estimate. */
  commit(entry: Omit<BudgetEntry, 'at'> & { at?: string }): Promise<void>;
  /** Release an unused estimate when no provider response was obtained. */
  release(): void;
}

export type BudgetReservationVerdict =
  | { ok: true; reservation: BudgetReservation }
  | { ok: false; scope: 'request' | 'hourly' | 'total'; spentUsd: number; capUsd: number };

export class Budget {
  readonly caps: Readonly<BudgetCaps>;
  private readonly path: string;
  /** parsed cache; invalidated on every `record()` so totals cannot go stale */
  private cache: BudgetEntry[] | null = null;
  /**
   * Estimates for calls currently in flight in this Budget instance.
   *
   * This closes the check-then-call gap for concurrent requests sharing one
   * steward process. It is NOT a cross-process reservation: separate Budget
   * instances and separate hosts cannot see each other's pending calls.
   */
  private readonly pending = new Map<symbol, { estimatedUsd: number; atMs: number }>();
  private reservationQueue: Promise<void> = Promise.resolve();

  constructor(caps: BudgetCaps, path = process.env.BUDGET_LEDGER ?? 'data/budget.jsonl') {
    for (const key of ['maxUsdPerRequest', 'maxUsdPerHour', 'maxUsdTotal'] as const) {
      requireAmount(caps[key], key);
    }
    this.caps = Object.freeze({ ...caps });
    this.path = path;
  }

  /**
   * Read the ledger. A missing file is `[]` (first run) and a malformed line is
   * skipped with a warning — refusing to boot over one truncated line mid-demo would
   * be the wrong trade.
   */
  private async readAll(): Promise<BudgetEntry[]> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.path, 'utf8');
      const entries: BudgetEntry[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line) as BudgetEntry);
        } catch {
          console.warn(`[budget] skipping malformed line: ${line.slice(0, 80)}`);
        }
      }
      this.cache = entries;
    } catch {
      this.cache = [];
    }
    return this.cache;
  }

  /** All-time and rolling-hour spend. `nowMs` is injectable so tests need not sleep. */
  async totals(
    nowMs = Date.now(),
  ): Promise<{ totalUsd: number; lastHourUsd: number; calls: number }> {
    const all = await this.readAll();
    const hourAgo = nowMs - 3_600_000;
    let total = 0;
    let hour = 0;
    for (const e of all) {
      const usd = Number(e.spentUsd);
      if (!Number.isFinite(usd)) continue;
      total += usd;
      if (Date.parse(e.at) >= hourAgo) hour += usd;
    }
    return { totalUsd: round6(total), lastHourUsd: round6(hour), calls: all.length };
  }

  /**
   * Can we afford `estimatedUsd`?
   *
   * @param estimatedUsd the pre-call estimate from the provider adapter.
   * @param overrides.maxUsd   a per-call cap that can only tighten the configured
   *                           per-request ceiling, never raise it.
   * @param overrides.nowMs    injectable clock for the hourly window.
   *
   * Checks run cheapest-first: the per-request ceiling needs no I/O, then the total,
   * then the hour. The first refusal wins so the reported `scope` is the most
   * specific one.
   */
  async check(
    estimatedUsd: number,
    overrides?: { maxUsd?: number; nowMs?: number },
  ): Promise<BudgetVerdict> {
    requireAmount(estimatedUsd, 'estimatedUsd');
    if (overrides?.maxUsd !== undefined) requireAmount(overrides.maxUsd, 'maxUsd');
    const perRequest = Math.min(
      overrides?.maxUsd ?? this.caps.maxUsdPerRequest,
      this.caps.maxUsdPerRequest,
    );
    if (estimatedUsd > perRequest) {
      return { ok: false, scope: 'request', spentUsd: estimatedUsd, capUsd: perRequest };
    }
    const t = await this.totals(overrides?.nowMs);
    const nowMs = overrides?.nowMs ?? Date.now();
    const pending = this.pendingTotals(nowMs);
    if (t.totalUsd + pending.totalUsd + estimatedUsd > this.caps.maxUsdTotal) {
      return { ok: false, scope: 'total', spentUsd: t.totalUsd, capUsd: this.caps.maxUsdTotal };
    }
    if (t.lastHourUsd + pending.lastHourUsd + estimatedUsd > this.caps.maxUsdPerHour) {
      return { ok: false, scope: 'hourly', spentUsd: t.lastHourUsd, capUsd: this.caps.maxUsdPerHour };
    }
    return {
      ok: true,
      remainingUsd: round6(this.caps.maxUsdTotal - t.totalUsd - pending.totalUsd),
    };
  }

  /**
   * Atomically check and reserve an estimate within this Budget instance.
   *
   * The queue prevents two async callers in one process from both passing the
   * same ledger total before either records its call. A committed reservation
   * replaces its estimate with the actual per-call cost; an unused reservation
   * must be released. Multiple processes still need an external transaction or
   * locking protocol — appending JSONL is not a distributed reservation system.
   */
  async reserve(
    estimatedUsd: number,
    overrides?: { maxUsd?: number; nowMs?: number },
  ): Promise<BudgetReservationVerdict> {
    return this.exclusiveReservation(async () => {
      const verdict = await this.check(estimatedUsd, overrides);
      if (!verdict.ok) return verdict;

      const id = Symbol('budget-reservation');
      this.pending.set(id, { estimatedUsd, atMs: overrides?.nowMs ?? Date.now() });
      let settled = false;
      const release = (): void => {
        if (settled) return;
        settled = true;
        this.pending.delete(id);
      };
      return {
        ok: true,
        reservation: {
          estimatedUsd,
          release,
          commit: async (entry) => {
            if (settled) throw new Error('budget reservation is already settled');
            try {
              await this.record(entry);
            } finally {
              release();
            }
          },
        },
      };
    });
  }

  /** Append one spend line. `at` is optional so a test can backdate a fixture. */
  async record(entry: Omit<BudgetEntry, 'at'> & { at?: string }): Promise<void> {
    requireAmount(entry.spentUsd, 'spentUsd');
    const full: BudgetEntry = { at: entry.at ?? new Date().toISOString(), ...entry } as BudgetEntry;
    await mkdir(dirname(this.path), { recursive: true }).catch(() => {});
    await appendFile(this.path, `${JSON.stringify(full)}\n`, 'utf8');
    // invalidate so the next check() sees this entry
    this.cache = null;
  }

  private pendingTotals(nowMs: number): { totalUsd: number; lastHourUsd: number } {
    const hourAgo = nowMs - 3_600_000;
    let totalUsd = 0;
    let lastHourUsd = 0;
    for (const reservation of this.pending.values()) {
      totalUsd += reservation.estimatedUsd;
      if (reservation.atMs >= hourAgo) lastHourUsd += reservation.estimatedUsd;
    }
    return { totalUsd, lastHourUsd };
  }

  private async exclusiveReservation<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.reservationQueue;
    let unlock!: () => void;
    this.reservationQueue = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      unlock();
    }
  }
}

/**
 * Round to 6 decimals (USDC precision).
 *
 * Applied only to **aggregates** compared against ceilings. Individual entries keep
 * their exact recorded value; this is a display/compare helper, not a rounding of
 * money that moves.
 */
const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

function requireAmount(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a finite non-negative number`);
  }
}
