# 🏃 Runbook — from a fresh clone to a settled transaction

Two services, no framework, no build step (Node 22.18+ runs the TypeScript
directly). If something here does not work, that is a bug in the repo, not in
your machine.

## 0. Prerequisites

- Node **22.18+** (or 24). `node -v`
- Separate Hedera **testnet** fan, artist, compute and meter accounts with ECDSA keys as needed. Only needed for live mode; use the official faucet or event support, never real funds.
- A 0G Private Computer API key is optional for labelled dev-mock inference and **required for live mode**. Use the current sponsor/team-credit flow and verify the model catalog. On 6 Nov the testnet self-service credit/faucet flow was not available to this workspace; do not invent a key or use mainnet spend.

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
Dev inference reports `teeVerified: null`: the offline mock performs no TEE
attestation.

Anything else: `curl localhost:8402/health` and `curl localhost:8403/health`.

## 2. Live mode — real Hedera testnet settlement

### 2a. Accounts

| Account | Purpose | Key needed by |
|---|---|---|
| artist payout | receives the full default-USDC fan payment | nobody at runtime (payee only) |
| agent compute | pays the meter from the agent wallet, writes optional HCS audit | `payments/` (HCS when enabled) and `agent/` (x402 payer) |
| meter operator | receives meter payments; must differ from compute | nobody at runtime (payee only) |
| demo fan | pays the fan `/ask` challenge | `agent/scripts/demo.ts` only; never the compute key |
| treasury | reserved for a future fixed token implementation | disabled `scripts/create-tip-token.ts` only |

```bash
cp payments/.env.example payments/.env
cp agent/.env.example agent/.env
```

Fill in `PAYMENTS_MODE=live`, `HEDERA_ARTIST_ACCOUNT_ID`,
`HEDERA_COMPUTE_ACCOUNT_ID`, `HEDERA_METER_ACCOUNT_ID`, and `UPSTREAM_API_KEY`.
The meter account must differ from compute. HCS audit is optional; to enable it,
also set `HCS_SPEND_TOPIC_ID` and `HEDERA_AGENT_PRIVATE_KEY`. In `agent/.env`:
`HEDERA_AGENT_ACCOUNT_ID`, `HEDERA_AGENT_PRIVATE_KEY`,
`HEDERA_FAN_ACCOUNT_ID`, `HEDERA_FAN_PRIVATE_KEY`, `PAYMENTS_MODE=live`,
`STEWARD_MODE=auto`, `METER_URL=http://localhost:8402/meter/v1/chat/completions`.
Keep `METER_PRICE_PER_CALL_USD` equal to payments' `PRICE_METER_USDC` (default
`0.002`). The fan and agent compute accounts must be distinct; live fan payment
never silently uses mock or the compute key.
Set `ZEROG_NETWORK=testnet` for the configured testnet router and set
`ZEROG_MODEL=0gm-1.0` when required by the current prize/catalog. The shipped model
default is only a compatibility value, not proof of catalog availability.

The agent defaults to `HOST=127.0.0.1`. For a remote bind, generate a strong
`STEWARD_SERVICE_TOKEN` and configure the same value in both services. Payments
sends `Authorization: Bearer <token>`; non-loopback agent startup without the token
is refused. The agent ignores caller-supplied provider/model/tool overrides.

### 2b. HCS topics

HCS does not block base settlement when left unconfigured. To enable the spend
audit, create a topic in the portal or with the SDK and paste its id into
`HCS_SPEND_TOPIC_ID` together with the compute account's key. Every paid call then
appends one message there — that is the tamper-evident audit log. The separate
claims workflow is not implemented by this spend log.

### 2c. Default USDC and split previews

One x402 payment is one transfer to one `payTo`. With default USDC, `/ask` returns
`splitPreview` plus `splitVerified: false`; its 96.31/3.69 arithmetic is not an
actual two-recipient split. The full payment goes to the artist account.

`token:create` is disabled: it has no supply key/mint path, and custom assets also
need facilitator `allowedAssets` support. Do not run it. Base USDC settlement is
the demo path until a complete custom-fee asset flow is implemented and verified.

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
| `403 SPEND_CAP_EXCEEDED` | the agent's compute budget is spent, or its fixed price exceeds the per-call cap | review the ledger, wait for the hourly window, or explicitly adjust `BUDGET_*`; never delete real ledger history to bypass a cap |
| `502 UPSTREAM_FAILED` | 0G key missing/expired, or provider down | `node agent/scripts/smoke.ts --direct` to isolate; 0G returns `503 no_providers_available` rather than swapping models |
| `502 SETTLEMENT_FAILED` | facilitator explicitly refused settlement | no paid response or ledger entry was produced; inspect the facilitator reason |
| `502 SETTLEMENT_UNCONFIRMED` | transport failure, or success without a transaction id | status is unknown: reconcile with the facilitator before retrying; no paid response or ledger entry was produced |
| ledger is unreadable/corrupt | service refuses to trust an unknown balance | restore a valid backup or repair it deliberately; do not replace it with an empty ledger |
| `401` from the agent `/ask` | missing/incorrect service bearer | send the same `STEWARD_SERVICE_TOKEN` from payments as `Authorization: Bearer …` |
| agent refuses non-loopback startup | missing service token | configure `STEWARD_SERVICE_TOKEN`, or keep the safe `HOST=127.0.0.1` |
| live demo refuses fan payer setup | fan account/key absent | set both `HEDERA_FAN_*`; do not substitute the agent compute credentials |
| 402 on every request in live mode | payer has no token balance/association | associate the configured default USDC asset + fund it from the Circle testnet faucet |
| `facilitator … does not advertise hedera:testnet` | wrong `FACILITATOR_URL` | `curl $FACILITATOR_URL/supported` |
| steward answers `[dev-mock inference]` | `UPSTREAM_API_KEY` empty and `PAYMENTS_MODE=dev` | expected in dev; set the key for real answers |
| `EADDRINUSE` | a previous run is alive | `netstat -ano \| grep 8402` then `taskkill //PID <pid> //F` (Windows) |

## 4. Build the static app without hand-copying routes

```bash
# Default: no wallet runtime, blank project ID, enabled=false
npm run build:static -- /absolute/path/to/static-output

# Production-shaped output after approval; does not push/deploy by itself
npm run build:static -- /absolute/path/to/gh-pages --cname=artist.opensourceorchestra.org

# Only after a real Reown setup: build runtime + include its license notices
npm run build:wallet
REOWN_PROJECT_ID=<32-hex-public-id> npm run build:static -- /absolute/path/to/gh-pages --wallet-runtime --cname=artist.opensourceorchestra.org
```

The builder creates `/home`, `/draft`, `/wallets`, and `/arkiv` route directories, includes only public files, and refuses to clean an output without its own `.fork-artist-static.json` marker. Never put `.env` or private configuration in the output. Static-host headers still need separate verification; this build does not claim to fix GitHub Pages headers or publish anything.

## 5. What is real vs mocked — say this out loud on stage

| Real | Mocked in dev mode |
|---|---|
| the 96.31/3.69 **preview** arithmetic (`splitVerified: false`) | settlement (`mock-…` ids, no chain) |
| the x402 protocol shape (402 + `accepts[]` + `PAYMENT-REQUIRED`) | the facilitator |
| budget enforcement, degradation ladder, spend ledger | HCS message submission (`hcs-mock-…`) |
| provider abstraction + 0G request-id capture | inference (deterministic `[dev-mock inference]` text) |

Budget reservations coordinate concurrent calls in one steward process only; they
are not atomic across multiple processes/hosts. The default USDC asset has no
fractional-fee split, so the displayed 96.31/3.69 amounts remain a preview unless
recipient transfers are independently verified on chain.

The sponsor requirement is a **settled** payment, so the demo must run
`PAYMENTS_MODE=live` with a real `paymentTxId` in `TX-PROOF.md`.
