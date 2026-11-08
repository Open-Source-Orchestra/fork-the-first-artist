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

## 💸 Pay this artist (real artist, testnet HBAR)

The fork card of every **issued** artist (name issued on mainnet, payout on their ENS name) shows two buttons:

- **⚡ see an example x402 payment** — the recorded/example loop below (fictional Mira Modal, synthetic artist account).
- **💸 pay <artist> · x402 testnet** → `/pay?artist=<slug>` — the same loop, but the steward forwards **96.31% to the artist's own account**.

**Who gets paid is never taken from the browser.** `POST /tip {artist:"shaka", amountHbar:"1"}` only carries a garden slug. Before
every payment the Worker resolves `<slug>.osoartist.eth` **live on Ethereum mainnet** through the artist's own resolver
(`ens/src/resolve-artist.mjs`) and refuses (HTTP 404, nothing paid) unless the name has `oso.consent=active`, no paused steward
status, no network mismatch and a payout record. Payout order: `addr(3030)` Hedera account → ENSIP-11 Hedera-testnet EVM address →
ETH address; an EVM address is paid as a Hedera **alias** (mapped to its existing `0.0.N` via the mirror node, else auto-created —
only the artist's key can spend it). `GET /artist?name=<slug>` shows the same resolution to the page before paying.

**Amount:** any amount from 0.01 to 10 testnet HBAR per run. The 0G meter price is the 3.69% compute share of that tip; the
artist gets 96.31%; OSO 0%. Spend controls (global Durable Object): one run per 30 s, 80 runs and **100 HBAR** per UTC day.
The fan wallet (0.0.11345895) was topped up with 200 testnet HBAR from a teammate's testnet account on 7 Nov 2026.

**Live proof, 7 Nov 2026 01:56Z (pay Shaka 1 HBAR):** fan→steward settled `0.0.9185802@1794015789.333874366`; 0G meter
`0.0.9185802@1794015789.852442311` (0.0369 HBAR, real 0G answer); steward→**Shaka 0.0.11347291** `0.0.11345897@1794015798.079972902`
(0.9631 HBAR); HCS topic 0.0.11345907 sequence 11 carries `payout_from: ENS shaka.osoartist.eth`.

### How an artist adds (or changes) their testnet ID

1. A steward invites them; on `/consent` they sign with their own wallet. The **Hedera testnet payout** field is optional:
   **leave it empty (recommended)** → fans pay their own wallet address on Hedera (no Hedera account needed); or paste `0.0.N`.
2. A steward approves; `ens/scripts/onboard.mjs` issues `<label>.osoartist.eth` to their wallet with that payout in the record.
3. The pay button appears on their fork card; every payment re-reads their ENS name, so **they** stay in control.
4. To change it later they edit their own name's record (they own it; OSO can't) — on **`/payout`** (below) or any ENS tool.

### How an artist changes their payout (`/payout`, branch `mainnet`, not deployed yet)

`/payout?artist=<label>` is a static page; it never signs or sends anything itself.

1. **Read.** It reads `<label>.osoartist.eth` from Ethereum mainnet over public RPCs (publicnode → drpc → 1rpc): the owner
   (`UserRegistry.findOwner`), the artist's own resolver (`UniversalResolver.findResolver`) and every payout record exactly as
   ENS resolves them (`addr` 3030 / 0x80000128 / 0x80000127 / 60, `hedera.network`, `oso.consent`, `oso.steward.status`),
   plus who a testnet and a mainnet tip would pay today.
2. **Choose.** Network **testnet | mainnet**, and either **a Hedera account `0.0.N`** → `addr(3030)` (same bytes as
   `ens/src/hbar.mjs`), or **my wallet address** → the ENSIP-11 Hedera EVM record for that network (`0x80000128` testnet,
   `0x80000127` mainnet) = the connected owner wallet, paid as an alias. Always also `text hedera.network=<network>`.
   Because `addr(3030)` outranks the EVM record in `resolvePayTo`, "my wallet address" **clears an old `addr(3030)`** first.
3. **Review.** It shows every record it will write, the resulting payout, warnings (network flip, USDC needs an activated
   account, consent not active) and the raw `to / value / calldata`: **one** `multicall` to the artist's own resolver.
4. **Sign.** It connects the wallet (EIP-1193), sends nothing unless the connected address **is the name's owner**, dry-runs the
   exact tx from that address (`eth_call`), then asks the wallet to send it on chain 1. The artist pays the gas (~74k gas for
   an account, ~101k for wallet mode incl. the clear, measured on the fork).

Proof: `node ens/scripts/fork-test-payout.mjs` (anvil fork of today's mainnet, **26/26**, `ens/proof/fork-test-payout.json`):
a throwaway artist key sets a mainnet `addr(3030)` + `hedera.network=mainnet` on its own test name with the page's own helpers
(`frontend/public/payout-plan.mjs`), `resolve-artist.mjs --network mainnet` then returns that account (and testnet refuses);
switching to wallet mode clears 3030 and resolves to the alias; a stranger, the OSO registrar and the parent owner are refused
by the resolver (`EACUnauthorizedAccountRoles`), and Shaka's real address dry-runs successfully on `shaka.osoartist.eth`.

⚠️ `hedera.network` is one value. Setting **mainnet** today makes the **testnet** tip loop refuse that artist
(`network-mismatch`) until the mainnet loop ships (plan step 5) — the page warns about it. `frontend/public/fork/registry.json`
(`hedera:` field) is informational and is not updated by `/payout`; payments always re-read ENS.

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
