# 💸 payments — x402 on Hedera

Two x402-protected endpoints, one explicitly unverified split preview, one audit log.

| Endpoint | Who pays | Price | Goes to |
|---|---|---|---|
| `POST /ask` | a fan (or a fan's agent) | 0.10 USDC | the **artist's** own account |
| `POST /meter/v1/chat/completions` | the artist's **steward agent** | 0.002 USDC | the distinct meter-operator account |

The second one is the important one for the sponsor tracks: it is an
OpenAI-compatible inference proxy that charges **per call**, so the agent pays for
its own thinking out of its own wallet with no human in the loop.

```
fan ──POST /ask (402)──► payments ──► steward ──POST /meter/… (402)──► meter ──► 0G Router
         pay 0.10                │        pay 0.002                   │
         settle ◄────────────────┘        settle ◄────────────────────┘
            │                                 │
            ▼                                 ▼
     artist (full 0.10)              meter operator (0.002)
            └──── splitPreview only; not an on-chain split · HCS audit ────┘
```

---

## Quickstart — dev mode (no keys, nothing on chain)

```bash
npm install
cp .env.example .env          # PAYMENTS_MODE=dev is the default
npm start                     # :8402
npm test                      # 54 tests
```

`PAYMENTS_MODE=dev` uses a **mock gate**: 402 challenges are protocol-shaped and
every settlement id is `mock-…`. Nothing touches Hedera. This is what the test
suite and the offline demo run against — the repo is fully demoable with no
credentials and no chain SDKs installed (`npm install --omit=optional` still
passes every test).

Mock transaction ids stay prefixed `mock-…`. Dev-mock inference reports
`teeVerified: null` / `tee_verified: null`: no TEE attestation happened offline.

## Live mode (Hedera testnet, real settlement)

```bash
cp .env.example .env
# in .env:
#   PAYMENTS_MODE=live
#   HEDERA_ARTIST_ACCOUNT_ID / HEDERA_COMPUTE_ACCOUNT_ID / HEDERA_METER_ACCOUNT_ID
#   UPSTREAM_API_KEY                                       (real 0G inference)
# Optional HCS audit (both values required when enabled):
#   HCS_SPEND_TOPIC_ID / HEDERA_AGENT_PRIVATE_KEY
npm start
```

`live` **refuses to start** without the account ids or `UPSTREAM_API_KEY` and names
the missing variables. The meter account must differ from the compute payer, so a
live meter payment cannot be a compute-to-self transfer.

The `/ask` payout account is always `HEDERA_ARTIST_ACCOUNT_ID`. A conflicting
`?payTo=` is rejected with `400 PAY_TO_NOT_ALLOWED`; clients cannot redirect the
artist's payment.

### Split preview, not a verified split

An x402 `exact` payment is one transfer to one `payTo`. With the default USDC
asset, the full `/ask` payment goes to the configured artist account. The response
field is named `splitPreview` and every response carries `splitVerified: false`:
the 96.31 / 3.69 figures are local arithmetic, not evidence of two transfers.

`token:create` is **disabled**. The script has zero initial supply but no supply
key or mint path, and a custom asset would also need facilitator `allowedAssets`
support. Do not run it or describe a custom-fee split as working. Re-enable it only
after those issues are implemented and tested; base USDC settlement comes first.

---

## Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/ask` | POST, GET | x402 | fan pays the artist, steward answers |
| `/meter/v1/chat/completions` | POST | x402 | agent pays per inference call |
| `/meter/info` | GET | free | price, budget, upstream config |
| `/meter/v1/models` | GET | free | catalog — learn the model name *before* paying |
| `/.well-known/x402` | GET | free | machine-readable discovery: prices, payees, split preview |
| `/split-preview?amount=0.10` | GET | free | the split arithmetic for any amount |
| `/ledger/recent?n=20` | GET | free | tail of the spend ledger |
| `/health` | GET | free | liveness + **which mode/gate is live** |

---

## Design decisions (the parts worth arguing about)

### 1. `challenge → verify → serve → settle`, in that order

`gate.settle()` is the **last** call, made only after an answer exists. Every
failure path returns before it, so a fan is never charged for an answer that
failed or degraded:

| Failure | Status | Settled |
|---|---|---|
| steward unreachable | 502 | **no** |
| steward refuses (no consent, bad schema) | 422 | **no** |
| upstream inference fails | 502 | **no** |
| degraded template answer | 200, `charged: false` | **no** |
| budget exhausted | 403 | **no** |
| facilitator returns `success: false` | 502 `SETTLEMENT_FAILED` | **no** |
| settlement transport failure or missing tx id | 502 `SETTLEMENT_UNCONFIRMED` | **unknown — reconcile before retrying** |

Neither settlement failure path returns the paid answer, payment proof, or a
receipt header, and neither appends a paid ledger entry. Ambiguous settlement uses
`settled: null`, never a synthetic `unsent-…` transaction id.

### 2. The budget check happens **before** the 402

Never quote a payment we are not allowed to serve. If we quoted first and refused
after, a client would hold a signed payment for a call that can never be honoured.

Both handlers obtain the challenge first and reuse its exact `accepts[0]` object
for verify and settle. This preserves facilitator-added `extra.feePayer`; rebuilding
requirements without it makes the live facilitator reject the payment as mismatched.

The total and hourly ceilings sum only `kind: "meter"` compute payments. Fan
`kind: "ask"` revenue remains visible in the ledger totals but cannot exhaust the
compute budget. The fixed meter price is also checked against `maxPerCallUsd`
before a payment is quoted.

### 3. The spend cap returns **403**, not 402

A 402 means "pay me". Returning it when we mean "I am out of money and will refuse"
would invite a payment we cannot serve. `403 SPEND_CAP_EXCEEDED` is honest, and it
is a **signal**: the steward's degradation ladder turns it into a template reply and
the fan is not charged either. Budget exhaustion costs nobody.

### 4. Money is never a float

Every amount is a `bigint` in atomic units. `decimalToAtomic` **throws** rather than
truncating, because truncating `0.0000001` on a 6-decimal asset would make a paid
endpoint free.

The split preview **floors the agent share** and gives the remainder to the artist by
subtraction, so `artist + agent === total` holds for every amount — proven
exhaustively for all 0…100,000 atomic units in the tests.

### 5. One ledger line per paid call

Totals are a `reduce` over `data/spend-log.jsonl`. There is deliberately no second
in-memory set of books; two sets of books can disagree and then nobody knows which
one the cap was enforced against.

`totalUsd`/`lastHourUsd` retain all payment volume for reporting;
`computeTotalUsd`/`computeLastHourUsd` and
`revenueTotalUsd`/`revenueLastHourUsd` separate compute from artist revenue. A
missing ledger file means an empty first run. Any other read failure, malformed
JSON, or invalid entry fails closed rather than silently resetting the balance.

### 6. The chain SDKs are optional dependencies, loaded lazily

`@x402/*` and `@hiero-ledger/sdk` are imported only when `PAYMENTS_MODE=live`.
Dev mode boots with **none of them installed** — verified by running the whole test
suite after `npm install --omit=optional`.

---

## Environment

See `.env.example` for the full list with defaults. The ones that matter:

| Variable | Default | Note |
|---|---|---|
| `PAYMENTS_MODE` | `dev` | `dev` or `live`. There is no `prod` — this is a testnet demo |
| `HEDERA_NETWORK` | `hedera:testnet` | CAIP-2 style |
| `HEDERA_ASSET` | `0.0.429274` | testnet USDC. Taken from `@x402/core`'s `DEFAULT_ASSETS`, **not** the docs. `0.0.0` = native **HBAR** (see below) |
| `HEDERA_ASSET_DECIMALS` | `6` (USDC) / `8` (HBAR) | HBAR must be 8 (tinybars); anything else refuses to start |
| `HEDERA_ASSET_SYMBOL` | derived | display only: `HBAR` for `0.0.0`, `USDC` for testnet USDC |
| `ASK_PAYEE` | `artist` | `steward` = fan pays the artist's steward/compute account, which forwards 96.31% on-chain (`hedera-steward/`) |
| `FACILITATOR_URL` | `https://x402.org/facilitator` | public testnet facilitator |
| `SPLIT_ARTIST_BPS` / `SPLIT_AGENT_BPS` | `9631` / `369` | must total 10000 or the process refuses to start |
| `PRICE_ASK` (or `PRICE_ASK_<SYMBOL>`, e.g. `PRICE_ASK_USDC`) | `0.10` USDC / `1` HBAR | fan → artist, per question, in asset units |
| `PRICE_METER` (or `PRICE_METER_<SYMBOL>`) | `0.002` USDC / `0.01` HBAR | steward → meter, per inference call |
| `BUDGET_TOTAL_USD` | `5` USDC / `10` HBAR | demo budget, **in asset units** (name kept for compat) |
| `BUDGET_HOURLY_USD` | `0.05` USDC / `1` HBAR | rolling ceiling, asset units |
| `UPSTREAM_BASE_URL` | `https://router-api.0g.ai/v1` | 0G Compute Router |
| `UPSTREAM_TRUST_MODE` | `verified` | asks 0G for a TEE attestation |

### Native HBAR rail (no USDC association, no Circle faucet)

`cp .env.hbar.example .env` switches the rail to native HBAR: `HEDERA_ASSET=0.0.0`,
8 decimals, ask 1 HBAR, meter 0.01 HBAR. `@x402/hedera@2.30` signs `0.0.0` as a
plain `TransferTransaction` HBAR transfer, and `https://x402.org/facilitator`
advertises `hedera:testnet` `exact` with `feePayer 0.0.9185802`, so the fan only
needs a funded account. HBAR is not a *default* x402 asset, so the payer
(`agent/src/rails/payer.ts` → `spendControlsFor`) opts it in with an exact
tinybar cap (`PAYER_MAX_PER_PAYMENT`, default 2 HBAR); without that entry the SDK
refuses every HBAR quote. USDC remains the default and keeps its env names.

---

## Status: what is real and what is not

This table is the honest one. It is more useful to a judge than an unqualified
"works".

| Component | Status |
|---|---|
| split-preview arithmetic, atomic conversion, config validation | **real, tested exhaustively; not an on-chain split** |
| ledger, one-line invariant, hourly window, HCS mock | **real, tested** |
| 402 challenge shape, verify → serve → settle ordering | **real protocol shape, mock facilitator** |
| budget ceilings, 403 signalling, free-on-degradation | **real, tested** |
| HTTP server, CORS, discovery, health | **real, tested, and booted** |
| **Hedera settlement** | **written, never executed** — no credentials. `docs/TX-PROOF.md` stays empty until a real tx settles |
| **0G inference** | **written, never executed** — `fake`/dev stand-in is what ran |
| **HTS fractional-fee token** | **disabled and never executed** — no supply/mint path or facilitator asset support |

---

## Tests

```bash
npm test           # 54 tests, no network, no keys
npm run typecheck  # tsc --noEmit
```

| File | Covers |
|---|---|
| `config.test.ts` | live upstream requirements and optional-HCS validation |
| `split.test.ts` | exhaustive conservation 0…100,000 atomic, rounding direction, precision refusal |
| `gate.test.ts` | x402 v2 wire format literally, mock labelling, payee fallback |
| `spend-log.test.ts` | one line per call, compute/revenue totals, fail-closed history, hourly window |
| `payments.test.ts` | **the charging rules** — canonical `feePayer`, settlement failures, payout pinning, compute budgets |
| `server.test.ts` | routing, CORS/preflight, size ceiling, discovery, on port 0 |

---

## AI disclosure

Written with AI assistance (documented step by step in `docs/build-log/`). Every
claim in the status table above was checked by running the code; the three
"never executed" rows are the parts that could not be.

## Related docs

- [`../docs/build-log/PLAN.md`](../docs/build-log/PLAN.md) — the 12-step plan
- [`../docs/build-log/steps/`](../docs/build-log/steps/) — one doc per commit
- [`../docs/RUNBOOK.md`](../docs/RUNBOOK.md) — dev → live testnet
- [`../docs/TX-PROOF.md`](../docs/TX-PROOF.md) — settled transaction ids (empty until live)
