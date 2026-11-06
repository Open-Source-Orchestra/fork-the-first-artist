# 🏃 Runbook — from a fresh clone to a settled transaction

Two services, no framework, no build step (Node 22.18+ runs the TypeScript
directly). If something here does not work, that is a bug in the repo, not in
your machine.

## 0. Prerequisites

- Node **22.18+** (or 24). `node -v`
- A Hedera **testnet** account with an ECDSA key (portal.hedera.com → create
  account → faucet). Only needed for live mode.
- Optional: a 0G Private Computer API key (pc.0g.ai → link email → $1 credit).

## 1. Dev mode — nothing on chain, 60 seconds

```bash
npm --prefix payments install
npm --prefix agent install
npm --prefix payments start &                  # :8402
npm --prefix agent start &                     # :8403 (loopback only)
node agent/scripts/demo.ts "who are you?"
```

Expected: a `402`, then an answer, then a `proof` block with a `mock-…` payment
tx, a `dev-req-…` request id and an `hcs-mock-…` log entry. The ledger shows two
lines — the fan's `ask` and the steward's own `meter` payment.

Anything else: `curl localhost:8402/health` and `curl localhost:8403/health`.

## 2. Live mode — real Hedera testnet settlement

### 2a. Accounts

| Account | Purpose | Key needed by |
|---|---|---|
| artist payout | receives 96.31% | nobody at runtime (payee only) |
| agent compute | receives 3.69%, pays the meter, writes HCS | `payments/` (HCS) and `agent/` (x402 payer) |
| demo fan | pays the fan `/ask` challenge | `agent/scripts/demo.ts` only; never the compute key |
| treasury | creates the tip token | `scripts/create-tip-token.ts` only |

```bash
cp payments/.env.example payments/.env
cp agent/.env.example agent/.env
```

Fill in `PAYMENTS_MODE=live`, `HEDERA_ARTIST_ACCOUNT_ID`,
`HEDERA_COMPUTE_ACCOUNT_ID`, `HEDERA_AGENT_PRIVATE_KEY`, `HCS_SPEND_TOPIC_ID`.
In `agent/.env`: `HEDERA_AGENT_ACCOUNT_ID`, `HEDERA_AGENT_PRIVATE_KEY`,
`HEDERA_FAN_ACCOUNT_ID`, `HEDERA_FAN_PRIVATE_KEY`, `PAYMENTS_MODE=live`,
`STEWARD_MODE=auto`, `METER_URL=http://localhost:8402/meter/v1/chat/completions`.
Keep `METER_PRICE_PER_CALL_USD` equal to payments' `PRICE_METER_USDC` (default
`0.002`). The fan and agent compute accounts must be distinct; live fan payment
never silently uses mock or the compute key.
Set `ZEROG_NETWORK=testnet` for the configured testnet router and set
`ZEROG_MODEL=0gm-1.0` when required by the current prize/catalog. The shipped model
default is only a compatibility value, not proof of catalog availability.

The agent defaults to `HOST=127.0.0.1`. For a remote bind, generate a strong
`STEWARD_SERVICE_TOKEN`, configure the same value in both services, and update the
payments steward call to send `Authorization: Bearer <token>` before starting the
agent. Non-loopback startup without the token is refused. The agent ignores
caller-supplied provider/model/tool overrides.

### 2b. HCS topics

Two topics, created in the portal or with the SDK: one for **claims**
(inviter + wallet signature) and one for **spend**. Paste the spend topic id into
`HCS_SPEND_TOPIC_ID`. Every paid call appends one message there — that is the
tamper-evident audit log.

### 2c. The tip token (for the 96.31/3.69 split)

```bash
cd payments && npm run token:create
# → HEDERA_ASSET=0.0.xxxxxxx   put this in payments/.env, restart
```

One x402 payment is one transfer to one `payTo`, so the split lives on the asset:
a fractional custom fee of 369/10000 routes 3.69% to the compute account and the
artist gets the rest in the same atomic transfer.

### 2d. Prove it settled

```bash
curl -s localhost:8402/health                 # mode must be "live"
curl -s localhost:8402/.well-known/x402       # prices + payees
node agent/scripts/smoke.ts                   # one paid inference call
node agent/scripts/demo.ts "what do you play?"
```

Take the `paymentTxId` from the output (never the mock one), open
`https://hashscan.io/testnet/transaction/<txId>`, then add a row to
[`TX-PROOF.md`](./TX-PROOF.md). **The submission form needs at least one real
transaction id, and the demo video has to show it on HashScan.**
The split printed by the demo is only an arithmetic preview, not proof of two
recipient transfers. One fan question can produce several meter calls; inspect
`provenance.calls[]`/each meter ledger entry rather than presenting one request ID
as evidence for all of them.

## 3. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `403 SPEND_CAP_EXCEEDED` | the agent's budget is spent | review the ledger, wait for the hourly window, or explicitly adjust `BUDGET_*`; do not delete the ledger to hide spend |
| `502 UPSTREAM_FAILED` | 0G key missing/expired, or provider down | `node agent/scripts/smoke.ts --direct` to isolate; 0G returns `503 no_providers_available` rather than swapping models |
| `401` from the agent `/ask` | missing/incorrect service bearer | send the same `STEWARD_SERVICE_TOKEN` from payments as `Authorization: Bearer …` |
| agent refuses non-loopback startup | missing service token | configure `STEWARD_SERVICE_TOKEN`, or keep the safe `HOST=127.0.0.1` |
| live demo refuses fan payer setup | fan account/key absent | set both `HEDERA_FAN_*`; do not substitute the agent compute credentials |
| 402 on every request in live mode | payer has no token balance/association | associate the tip token + fund USDC from the Circle testnet faucet |
| `facilitator … does not advertise hedera:testnet` | wrong `FACILITATOR_URL` | `curl $FACILITATOR_URL/supported` |
| steward answers `[dev-mock inference]` | `UPSTREAM_API_KEY` empty and `PAYMENTS_MODE=dev` | expected in dev; set the key for real answers |
| `EADDRINUSE` | a previous run is alive | `netstat -ano \| grep 8402` then `taskkill //PID <pid> //F` (Windows) |

## 4. What is real vs mocked — say this out loud on stage

| Real | Mocked in dev mode |
|---|---|
| the 96.31/3.69 arithmetic (`/split-preview`, every `/ask`) | settlement (`mock-…` ids, no chain) |
| the x402 protocol shape (402 + `accepts[]` + `PAYMENT-REQUIRED`) | the facilitator |
| budget enforcement, degradation ladder, spend ledger | HCS message submission (`hcs-mock-…`) |
| provider abstraction + 0G request-id capture | inference (deterministic `[dev-mock inference]` text) |

Budget reservations coordinate concurrent calls in one steward process only; they
are not atomic across multiple processes/hosts. The default USDC asset has no
fractional-fee split, so the displayed 96.31/3.69 amounts remain a preview unless
recipient transfers are independently verified on chain.

The sponsor requirement is a **settled** payment, so the demo must run
`PAYMENTS_MODE=live` with a real `paymentTxId` in `TX-PROOF.md`.
