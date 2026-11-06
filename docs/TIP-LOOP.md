# ⚡ Tip the artist — the live x402 loop, one click for anyone

**Page:** `/pay` (also linked from the ⚡ tile in the garden's fork panel) ·
**Endpoint:** `POST https://oso-tip-loop.shakaverse.workers.dev/tip` (NDJSON stream) ·
`GET https://oso-tip-loop.shakaverse.workers.dev/health`

Judges don't have to trust our CLI proof (`docs/TX-PROOF.md`): the button runs the **same money
loop as `scripts/live-e2e.mjs`, for real, on Hedera testnet**, and the page shows each step with
its HashScan link as it lands.

| # | Step | How | On-chain |
|---|---|---|---|
| 1 | fan agent asks the artist's steward | in-Worker HTTP `POST /ask` → **402** x402 `exact`, 0.1 HBAR (asset `0.0.0`), `payTo` = steward | — |
| 2 | fan agent pays | `@x402/hedera` client signs an HBAR `TransferTransaction` for exactly the 402 requirements → `X-PAYMENT` → facilitator `/verify` | — |
| 3 | steward pays its own inference | steward calls the 0G meter → **402** → pays **0.00369 HBAR (the 3.69%)** via x402 → **real 0G inference** (`0gm-1.0-35b-a3b`, router-api.0g.ai) → meter settles | meter tx + 0G request id |
| 4 | fan payment settles | facilitator `/settle` (fees sponsored by facilitator `0.0.9185802`) | fan → steward tx |
| 5 | steward forwards 96.31% | own-key `TransferTransaction` steward → artist, 0.09631 HBAR, SUCCESS receipt | forward tx |
| 6 | split logged | `TopicMessageSubmitTransaction` to HCS topic `0.0.11345907` (JSON: settled tx, forward tx, meter tx, 0G request id, 0% OSO) | HCS tx + sequence |
| 7 | re-read | mirror node lookup of the fan payment and the forward (`SUCCESS`) | — |

Order matters and is tested (`cloudflare/test/tip-loop.test.ts`): compute only runs after both
payments are *verified*; the fan's payment is *settled* only after the steward answered; a refused
payment or a 0G failure settles nothing; any failure after settlement emits an `error` step that
states exactly which transfers already landed. The page never shows a success it did not receive,
and links only to `https://hashscan.io/testnet/...`.

## Accounts and money (testnet, synthetic)

| Role | Account | Per run |
|---|---|---|
| fan | `0.0.11345895` | −0.1 HBAR (facilitator pays the fee) |
| steward (artist's steward wallet) | `0.0.11345897` | +0.1 −0.00369 −0.09631 − own tx/HCS fees |
| meter (0G compute) | `0.0.11345898` | +0.00369 |
| artist (`demo-artist.oso.eth`, fictional Mira Modal) | `0.0.11345896` | +0.09631 |

No real artist is paid. Keys live only as Worker secrets (`FAN_PRIVATE_KEY`,
`STEWARD_PRIVATE_KEY`, `UPSTREAM_API_KEY`); amounts are fixed server-side (hard ceilings 0.5 HBAR
tip / 0.05 HBAR meter) and the x402 client's spend control caps each payment at exactly the
configured price.

**Fair use:** a single Durable Object (`TipGate`) allows **one run per 60 s globally** and
**20 runs per UTC day** (`/health` shows what's left). Busy → HTTP 429 with `retryAfterSeconds`
and a link to the recorded proof. CORS: `https://artist.opensourceorchestra.org`,
`https://artist-preview-kzu6ctlpau-ffieyo32.taur.link` (+ localhost:4173 for the preview server).

## Live evidence (runs triggered through the public endpoint)

**6 Nov 2026 23:22:01Z — `curl` with the production Origin:**

| Step | Tx |
|---|---|
| fan → steward (x402, 0.1 HBAR) | [`0.0.9185802@1794007315.772507168`](https://hashscan.io/testnet/transaction/0.0.9185802-1794007315-772507168) |
| steward → 0G meter (x402, 0.00369 HBAR), 0G request `4287b17d-e5bd-46ad-a80b-5cc405697565` | [`0.0.9185802@1794007316.895018127`](https://hashscan.io/testnet/transaction/0.0.9185802-1794007316-895018127) |
| steward → artist 96.31% (0.09631 HBAR) | [`0.0.11345897@1794007320.053355411`](https://hashscan.io/testnet/transaction/0.0.11345897-1794007320-053355411) |
| HCS split log, topic `0.0.11345907` seq 6 | [`0.0.11345897@1794007323.537716317`](https://hashscan.io/testnet/transaction/0.0.11345897-1794007323-537716317) |

**6 Nov 2026 23:27:57Z — clicked the button on `/pay` in a browser:**

| Step | Tx |
|---|---|
| fan → steward | [`0.0.9185802@1794007671.501350226`](https://hashscan.io/testnet/transaction/0.0.9185802-1794007671-501350226) |
| steward → 0G meter, 0G request `f5846c68-a51d-4544-b271-028447251184` | [`0.0.9185802@1794007671.617955892`](https://hashscan.io/testnet/transaction/0.0.9185802-1794007671-617955892) |
| steward → artist 96.31% | [`0.0.11345897@1794007678.587417393`](https://hashscan.io/testnet/transaction/0.0.11345897-1794007678-587417393) |
| HCS seq 8 | [`0.0.11345897@1794007681.397030802`](https://hashscan.io/testnet/transaction/0.0.11345897-1794007681-397030802) |

Both runs: mirror node re-read `SUCCESS` for the fan payment and the forward; ~10 s end to end.

Honest note: one local rehearsal (23:19Z, `wrangler dev`) settled fan → steward
(`0.0.9185802@1794007172.020092703`) and the meter, then failed at the forward (workerd memo bug,
below). The steward's 96.31% for it was reconciled by hand: forward
[`0.0.11345897@1794007614.588389743`](https://hashscan.io/testnet/transaction/0.0.11345897-1794007614-588389743),
HCS seq 7 labelled as a reconciliation.

## Running it on Cloudflare Workers — what it took

- `@hiero-ledger/sdk`'s browser build (`WebClient`, gRPC-web over `fetch`) works in workerd for
  `TransferTransaction` and `TopicMessageSubmitTransaction` — **with a one-line shim**:
  `sha384.browser.js` calls `window.crypto.subtle`, so `src/window-shim.ts` sets `globalThis.window`.
- **No transaction memo:** protobufjs' Buffer string path (`utf8Write`) throws
  `ERR_OUT_OF_RANGE` in workerd for any memo string; the HCS record carries the link instead.
- Deploy: `cd cloudflare && npx wrangler deploy -c wrangler.tip.jsonc`, then
  `npx wrangler secret bulk <json>` with `FAN_PRIVATE_KEY`, `STEWARD_PRIVATE_KEY`, `UPSTREAM_API_KEY`.
- Free-plan CPU limits were not hit (signing + protobuf are a few ms; the rest is I/O wait).

Code: `cloudflare/src/tip-loop.ts` (orchestration, injected side effects),
`cloudflare/src/tip-worker.ts` (Worker, real deps, `TipGate`), `frontend/public/pay.{html,mjs,css}`.
Credits: the steward split design is Utkarsh Tiwari's (`hedera-steward/`, @utkarshhs); this Worker
follows the same forward-then-log-to-HCS shape as his deterministic `direct` path, in TypeScript so it runs at the edge.
