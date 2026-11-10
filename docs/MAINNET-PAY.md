# Fan wallet · direct split · mainnet switch (plan steps 3–5)

Branch `mainnet-pay`. **Testnet only until Shaka's go** — `MAINNET_ENABLED` defaults to `"false"` and nothing here has
sent a mainnet transaction.

## What changed

| Before (judged demo, still available as a labelled DEMO on testnet) | Now (`POST /wallet/*`) |
|---|---|
| A server "demo fan" key pays | The **fan's own HashPack wallet** signs (WalletConnect, HIP-820 `hedera_signTransaction`) — no fan key on any server |
| Fan → steward 100%, steward **forwards** 96.31% (custody) | **Two x402 `exact` payments per tip**, fan → artist 96.31% and fan → steward 3.69%. Nothing is held or forwarded |
| HBAR only | HBAR **and USDC** (`0.0.456858` mainnet / `0.0.429274` testnet, Circle) |
| Testnet only, hard-coded | `network: "testnet" | "mainnet"`; mainnet refused unless the switch is on **and** fully configured |

The server demo fan (`POST /tip`) refuses any `network` other than `testnet` (`DEMO_FAN_TESTNET_ONLY`), whatever the switch says.

## Flow

```
browser (fan)                         oso-tip-loop Worker                          x402 facilitator / Hedera
POST /wallet/prepare {id,network,currency,amount,artist,fan}
                                      ENS <artist>.osoartist.eth -> payout (consent, network)
                                      mirror: can both payees receive the asset?
                                      build 2 unsigned TransferTransactions (one node, fees = facilitator feePayer)
                                      store tip record under idempotency key `id`
<- record { legs: [artist 96.31%, steward 3.69%] with TransactionBody bytes }
decode both bodies (hedera-body.mjs): exactly fan -x -> payee +x, nothing else — else REFUSE
HashPack: approve payment 1, approve payment 2 (hedera_signTransaction -> SignatureMap)
POST /wallet/settle {id, signatures}
                                      attach signature (must be the fan account's on-chain key, over that body)
                                      leg 1: /verify -> /settle ------------------------------------> artist paid
                                      leg 2: /verify -> /settle ------------------------------------> steward paid
                                      per-artist ledger line (Durable Object) + HCS message
<- { state: complete | partial, tx ids, HashScan links }
```

## Money rules (tested: `cloudflare/test/direct-split.test.ts`, `wallet-tip.test.ts`)

- **Split**: `steward = floor(total × 369 / 10000)`, `artist = total − steward` → the legs sum to exactly the tip; any rounding unit goes to the artist. Minimum 0.01 HBAR / 0.01 USDC.
- **Idempotency**: one `id` per tip. Same id → the same prepared transactions; same id + different tip → `409 IDEMPOTENCY_CONFLICT`. A settled leg is never settled again.
- **Recovery**: artist first, then steward. If leg 1 settles and leg 2 fails, the tip is `partial` (on the ledger); retrying settles **only leg 2**. Each leg's Hedera transaction id is fixed at prepare time (Hedera never executes one id twice). Before any resubmission the mirror node is asked about that id: `SUCCESS` → recorded as paid, nothing resent. A leg is re-built (new id, fan signs again) only once its old transaction **provably can't land** (validity window + 30 s passed and the mirror doesn't have it, or it reached consensus as failed). Unknown mirror state → wait, never guess. Concurrent settles are serialized by an atomic lease in the Durable Object.
- **USDC**: payee must have USDC associated, unlimited auto-association (`-1`), or a free auto-association slot — checked on the mirror (`/api/v1/accounts/{id}/tokens?token.id=`) before anything is signed. A payout that is only a wallet address (no `0.0.N` account yet) is refused: x402 facilitators reject alias `payTo`, and an alias can't hold USDC.

## The mainnet switch

`MAINNET_ENABLED` must be exactly `"true"`, **and** `MAINNET_FACILITATOR_URL` (https), `MAINNET_STEWARD_ACCOUNT_ID`,
`MAINNET_HCS_TOPIC_ID`, `MAINNET_DAILY_CAP` must be set — otherwise `403 MAINNET_DISABLED` / `503 MAINNET_NOT_CONFIGURED`
before any ENS read, mirror call or transaction build. Hard clamps: ≤ 5 USDC or ≤ 25 HBAR per tip, ≤ 20 tips/day. The
switch is re-checked at settle time (turning it off stops prepared mainnet tips). Secret `MAINNET_STEWARD_PRIVATE_KEY`
signs only the HCS ledger line. Mainnet ENS payouts are never served from the stored "last good" read.

### Facilitators that advertise `hedera:mainnet` (GET /supported, 8 Nov 2026)

| Facilitator | Mainnet URL | Fee payer | Access |
|---|---|---|---|
| Blocky402 | `https://api.blocky402.com` | `0.0.10571514` | open, no key |
| AMNT (open source, MIT) | `https://facilitator.amnt.io` | `0.0.10774954` | open, no key (self-host possible) |
| Launa (ex-Ax402) | dedicated `https://<sub>.facilitator.launa.dev` | `0.0.10789914` | free account needed |
| x402.org | — | — | **testnet only** (`0.0.9185802`) |

## Run it

- Tests: `npm --prefix cloudflare test`, `node --test frontend/test/*.test.mjs`, `npm --prefix frontend run test:browser`.
- Real testnet tip through the same code path, with a script standing in for the wallet:
  `FAN_PRIVATE_KEY=… STEWARD_PRIVATE_KEY=… node cloudflare/scripts/testnet-wallet-tip.ts shaka 0.1 HBAR [--recovery]`.
- Regenerate the SDK body fixtures for the browser decoder tests: `node cloudflare/scripts/gen-wallet-fixtures.mjs`.
- The HashPack button needs a public Reown (WalletConnect) project ID + the wallet runtime:
  `npm --prefix frontend run build:wallet && REOWN_PROJECT_ID=<32 hex> node frontend/scripts/build-static.mjs <out> --wallet-runtime`.
