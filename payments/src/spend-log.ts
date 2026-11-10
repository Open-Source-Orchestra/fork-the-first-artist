/**
 * Spend ledger + Hedera Consensus Service (HCS) audit log.
 *
 * ## One source of truth
 *
 * Every paid call appends **exactly one** line to `data/spend-log.jsonl`. Budget
 * totals are a `reduce` over that file. There is deliberately no second in-memory
 * set of books, because two sets of books can disagree and then nobody knows which
 * one the spend cap was enforced against.
 *
 * The recorder used to keep a summary in memory as well; that double-counted. It
 * was removed — this file is it.
 *
 * ## Where the lines end up
 *
 * | Mode | Line in `spend-log.jsonl` | `hcsTxId` |
 * |---|---|---|
 * | `dev`  | yes | `hcs-mock-<sha256 prefix>` — a stable synthetic id, clearly synthetic |
 * | `live` | yes | the real HCS topic message id, `"<txId>@<status>"`; `null` when HCS is disabled or fails |
 *
 * Writing to HCS is Hedera's "topic as a tamper-evident audit log" bonus point, and
 * it is best-effort on purpose: an unhappy audit topic must never fail a payment
 * that has already settled. A failure is logged and recorded as `null`.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { atomicToDecimal, type Config } from './config.ts';

/**
 * One paid call.
 *
 * `kind` distinguishes the two pricing paths so the hourly and total ceilings can
 * be computed against the right numbers:
 *  - `ask`      a fan paid the artist through the paywall
 *  - `meter`    the steward paid for its own inference
 *  - `template` a degraded answer; recorded so the ledger explains itself, but it
 *               must be written with `priceAtomic: '0'` because nothing was charged
 */
export interface SpendEntry {
  /** ISO-8601, always UTC. Every ceiling computation parses this. */
  at: string;
  kind: 'ask' | 'meter' | 'template';
  /** Hedera x402 settlement transaction id, or its mock equivalent */
  txId: string;
  /** atomic units as string — the authoritative amount for arithmetic */
  priceAtomic: string;
  /** the same amount in USD, for ceilings and display only */
  priceUsd: string;
  payer?: string;
  /** 0G router request id, captured from the `x_0g_trace`/`X-0G-Request-Id` response field */
  upstreamRequestId?: string;
  upstreamCostUsd?: string;
  /** 0G TEE attestation result; `null` means 0G did not report one */
  teeVerified?: boolean | null;
  model?: string;
  /** preview of the 96.31% share, not proof of a recipient transfer */
  artistAtomic?: string;
  /** preview of the 3.69% share, not proof of a recipient transfer */
  agentAtomic?: string;
  /** whether the asset's custom-fee split was verified; currently always false */
  splitVerified?: boolean;
  /** HCS topic message id, or `null` when the audit write failed */
  hcsTxId?: string | null;
  /** free-text reason for a degraded or unusual entry */
  note?: string;
}

/**
 * Ledger aggregates. Legacy `totalUsd`/`lastHourUsd` remain total payment volume
 * for reporting; only the explicit compute fields are used for meter ceilings.
 * `calls` counts every line, including templates.
 */
export interface Totals {
  totalUsd: number;
  lastHourUsd: number;
  computeTotalUsd: number;
  computeLastHourUsd: number;
  revenueTotalUsd: number;
  revenueLastHourUsd: number;
  calls: number;
}

/** Reject syntactically valid JSON that cannot be trusted for spend accounting. */
function isSpendEntry(value: unknown): value is SpendEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    (entry.kind === 'ask' || entry.kind === 'meter' || entry.kind === 'template') &&
    typeof entry.at === 'string' &&
    Number.isFinite(Date.parse(entry.at)) &&
    typeof entry.txId === 'string' &&
    entry.txId.trim().length > 0 &&
    typeof entry.priceAtomic === 'string' &&
    /^\d+$/.test(entry.priceAtomic) &&
    typeof entry.priceUsd === 'string' &&
    entry.priceUsd.trim().length > 0 &&
    Number.isFinite(Number(entry.priceUsd)) &&
    Number(entry.priceUsd) >= 0
  );
}

export class SpendLog {
  private readonly cfg: Config;
  /** parsed ledger cache; invalidated on every append so totals cannot go stale */
  private cache: SpendEntry[] | null = null;

  constructor(cfg: Config) {
    this.cfg = cfg;
  }

  /**
   * Read and parse the whole ledger.
   *
   * A missing file is `[]` (first run). Every other read failure and every damaged
   * line is fatal: treating unknown history as zero would let spend resume against
   * an unknown balance.
   */
  private async readAll(): Promise<SpendEntry[]> {
    if (this.cache) return this.cache;
    let raw: string;
    try {
      raw = await readFile(this.cfg.ledgerPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = [];
        return this.cache;
      }
      throw new Error(`Spend ledger is unreadable: ${this.cfg.ledgerPath}`, { cause: err });
    }

    const entries: SpendEntry[] = [];
    const lines = raw.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        throw new Error(`Spend ledger is corrupt at line ${index + 1}: invalid JSON`, {
          cause: err,
        });
      }
      if (!isSpendEntry(parsed)) {
        throw new Error(`Spend ledger is corrupt at line ${index + 1}: invalid entry`);
      }
      entries.push(parsed);
    }
    this.cache = entries;
    return entries;
  }

  /**
   * Append one paid call and return the stored entry (with its `at` and `hcsTxId`).
   *
   * @param entry everything except `at`; a caller may supply `at` to backdate a
   *              test fixture.
   */
  async append(entry: Omit<SpendEntry, 'at'> & { at?: string }): Promise<SpendEntry> {
    // Do not append to history that could not be accounted for.
    await this.readAll();
    const full: SpendEntry = { at: entry.at ?? new Date().toISOString(), ...entry } as SpendEntry;

    // Audit first so the stored line already carries its HCS id. A failure here is
    // swallowed on purpose: the payment has already settled, and losing the book
    // entry would be worse than losing the audit pointer to it.
    full.hcsTxId = await this.submitToHcs(full).catch((err: unknown) => {
      console.warn(`[hcs] submit failed: ${(err as Error).message}`);
      return null;
    });

    await mkdir(dirname(this.cfg.ledgerPath), { recursive: true }).catch(() => {});
    await appendFile(this.cfg.ledgerPath, `${JSON.stringify(full)}\n`, 'utf8');
    // invalidate so the next totals() sees this line
    this.cache = null;
    return full;
  }

  /**
   * Publish the entry to the HCS spend topic.
   *
   * @returns a topic message id, or a `hcs-mock-…` synthetic id in dev mode.
   * @throws  when live mode is missing a key or the SDK call fails — the caller
   *          catches and records `null`.
   */
  private async submitToHcs(entry: SpendEntry): Promise<string | null> {
    if (this.cfg.mode === 'dev') {
      // Synthetic, but derived from the entry, so the same entry always yields the
      // same id and a test can assert on it deterministically.
      return `hcs-mock-${createHash('sha256').update(JSON.stringify(entry)).digest('hex').slice(0, 16)}`;
    }
    if (!this.cfg.hcsSpendTopicId) return null;

    // Dynamic import: dev mode must run with the Hedera SDK absent (see step 03).
    const { Client, PrivateKey, TopicMessageSubmitTransaction } = await import('@hiero-ledger/sdk');
    if (!this.cfg.agentPrivateKey) throw new Error('HEDERA_AGENT_PRIVATE_KEY required for HCS');

    // `Client.forName` wants `testnet`/`mainnet`, not the CAIP-2 `hedera:testnet`.
    const client = Client.forName(this.cfg.network.replace('hedera:', '')) as never as {
      setOperator(id: string, key: unknown): unknown;
    };
    client.setOperator(
      this.cfg.accounts.compute,
      PrivateKey.fromStringECDSA(this.cfg.agentPrivateKey),
    );

    const resp = await new TopicMessageSubmitTransaction()
      .setTopicId(this.cfg.hcsSpendTopicId)
      .setMessage(JSON.stringify(entry))
      .execute(client as never);
    const receipt = await resp.getReceipt(client as never);
    return `${resp.transactionId.toString()}@${receipt.status.toString()}`;
  }

  /**
   * All-time and rolling-hour spend.
   *
   * @param now injectable timestamp so the hourly-window test does not have to
   *            sleep for an hour.
   */
  async totals(now = Date.now()): Promise<Totals> {
    const all = await this.readAll();
    const oneHourAgo = now - 60 * 60 * 1000;
    let total = 0;
    let lastHour = 0;
    let computeTotal = 0;
    let computeLastHour = 0;
    let revenueTotal = 0;
    let revenueLastHour = 0;
    for (const e of all) {
      const usd = Number(e.priceUsd);
      total += usd;
      const inLastHour = Date.parse(e.at) >= oneHourAgo;
      if (inLastHour) lastHour += usd;
      if (e.kind === 'meter') {
        computeTotal += usd;
        if (inLastHour) computeLastHour += usd;
      } else if (e.kind === 'ask') {
        revenueTotal += usd;
        if (inLastHour) revenueLastHour += usd;
      }
    }
    return {
      totalUsd: round6(total),
      lastHourUsd: round6(lastHour),
      computeTotalUsd: round6(computeTotal),
      computeLastHourUsd: round6(computeLastHour),
      revenueTotalUsd: round6(revenueTotal),
      revenueLastHourUsd: round6(revenueLastHour),
      calls: all.length,
    };
  }

  /** Newest-first slice, for the demo output and any future admin page. */
  async recent(n = 20): Promise<SpendEntry[]> {
    const all = await this.readAll();
    return all.slice(-n).reverse();
  }
}

/**
 * Round to 6 decimals (USDC precision).
 *
 * Used only for the *aggregate* numbers shown to humans and compared to ceilings.
 * The per-entry `priceAtomic` string is the authoritative value and is never
 * rounded — this is why the two are stored separately.
 */
const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** Format an atomic amount for display, e.g. `2000n` on 6 decimals → `"0.002000"`. */
export function describePrice(atomic: bigint, decimals: number): string {
  return atomicToDecimal(atomic, decimals);
}
