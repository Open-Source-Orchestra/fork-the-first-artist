# 🤖 agent — artist steward on 0G
- answers fans only from what the artist shared
- serves paid requests via x402 (agent collects, artist holds)
- pays its own 0G inference from the 3.69% share, **spend cap ($5 demo total)**
- claims (invite + signature) logged to a Hedera Consensus Service topic

## Current implementation and limits

The TypeScript steward supports provider adapters, a tool loop, a local budget
ledger, and an HTTP service. The claim/invite/signature workflow and HCS claim
logging above remain product requirements, not implemented features. See
[the PR review](../docs/PR-3-REVIEW.md) for open integration and security findings.

Use Node 22.18 or newer. From `agent/`, `npm ci --ignore-scripts` installs the
locked dependencies, `npm test` runs offline unit tests, and `npm run typecheck`
checks TypeScript. Live SDK dependencies are optional at installation time, but
their declarations must be available for the complete type check.

## 0G configuration

The loader honors the variables advertised in `.env.example`:

- `ZEROG_NETWORK=testnet` selects `baseUrlTestnet`; `mainnet` retains the mainnet
  endpoint. `ZEROG_BASE_URL`, when non-empty, is an explicit operator override.
- `ZEROG_MODEL` sets the exact model sent to the provider. The existing default is
  retained for compatibility and is **not** represented as live catalog validation.
  Set `ZEROG_MODEL=0gm-1.0` when required by the current prize/catalog.
- `ZEROG_TRUST_MODE` sets `X-0G-Provider-Trust-Mode`.
- `INFERENCE_TRANSPORT=direct|x402-meter` selects the 0G transport. Direct calls
  need `ZEROG_API_KEY`; metered calls use the separate agent compute payer.

Invalid network/transport values fail startup. These are local configuration checks
only; no test performs a live model-catalog or provider request.

## Artist data and consent

`loadArtist()` reads `ARTIST_FILE` or `data/artist.json`. The file must contain a
JSON object with a non-empty string `name`, a string `bio`, and a string array
`songs`. Optional `ensName` and `hederaAccount` fields must be strings. If present,
`consent` must be a boolean.

Only literal `consent: true` allows the steward to answer. Missing consent and
`false` produce `NO_CONSENT` before provider calls. Missing/unreadable files and
malformed profiles fail loading; there is no fallback to another artist's data.
A request-level artist profile replaces the configured profile completely, so it
cannot inherit consent, songs, or identity fields from that profile.

The checked-in profile and `DEMO_ARTIST` constant are explicitly fictional:
`Demo Artist`, `Demo Song`, and a bio that says it is not a real activation or
verified claim. They deliberately have no ENS, Hedera, or social fields. Their
`consent: true` is synthetic test data, not evidence of a signed claim or
authorization to publish anyone. Replace the fixture only through the verified
activation flow; do not treat this local data check as wallet verification.

Regression coverage in `test/artist.test.ts` and `test/steward.test.ts` exercises
missing profiles, malformed values, inherited-consent prevention, and zero model
calls for unconsented requests.

## HTTP service and payments integration

`npm start` listens on `HOST` (default `127.0.0.1`) and `PORT` (default `8403`).
The loopback default prevents a fresh demo from exposing paid inference on every
interface. A non-loopback `HOST` is refused at startup unless
`STEWARD_SERVICE_TOKEN` is configured.

| Route | Access | Behavior |
|---|---|---|
| `GET /health` | public liveness | Reports the selected server provider/model/tools; no credentials or budget ceilings |
| `GET /agent-card` | public discovery | Reports fictional/configured artist facts and sanitized provider availability; no secret variable names or operator budget |
| `POST /ask` | service-to-service | Runs only the server-selected provider/model and fixed demo tools |

When `STEWARD_SERVICE_TOKEN` is set, every `POST /ask`—including loopback—must
send:

```http
Authorization: Bearer <STEWARD_SERVICE_TOKEN>
Content-Type: application/json
```

The comparison hashes both tokens and uses `timingSafeEqual`. Missing, malformed,
or incorrect credentials receive `401` before the request body or steward/provider
is invoked. The server has no wildcard CORS opt-in; CORS is not authentication.
Use a long random secret, for example `openssl rand -hex 32`, and store it only in
the two services' private environment files.

The JSON body accepts `instruction` (non-empty string) and optional `json`
(boolean). Client-supplied `provider`, `model`, and `tools` fields are ignored.
The demo server always uses its configured default provider/model and
`get_artist_profile`, `get_songs`, `quote_tip`.

**Payments contract:** after the payments teammate integrates authentication, its
existing steward fetch must add the same bearer header:

```ts
headers: {
  'content-type': 'application/json',
  ...(process.env.STEWARD_SERVICE_TOKEN
    ? { authorization: `Bearer ${process.env.STEWARD_SERVICE_TOKEN}` }
    : {}),
}
```

This branch intentionally does not edit `payments/`. The existing same-host dev
integration works with a blank token. Do not enable a token on the agent until the
caller sends it; a remote/non-loopback agent cannot start without one.

## Budget enforcement and provenance

Operator ceilings must be finite, non-negative numbers. `Budget` copies and freezes
them at construction. Request-level `maxUsd` can only tighten the configured
per-question ceiling. The default per-question cap is `$0.01`, hourly cap `$0.05`,
and total demo cap `$5`.

- Every initial, tool-loop, and schema-repair call reserves its estimated cost
  before provider invocation. The per-question cap is cumulative across those calls.
- Every completed call immediately commits its own actual cost to the JSONL ledger.
  A later refusal, schema mismatch, tool failure, or provider error does not erase
  earlier completed spend.
- The meter uses a fixed per-call price, not token-price fallback accounting.
  `METER_PRICE_PER_CALL_USD` defaults to `0.002` and **must match** the payments
  service's `PRICE_METER_USDC`. Direct providers retain token-based estimates.
- Reservations close the concurrent check-then-call gap for requests sharing one
  `Budget` instance. They are **process-local only**. Separate Budget instances,
  processes, and hosts do not have atomic cross-process reservations; use an
  external transactional ledger/lock before scaling horizontally.
- If a provider request fails without a usable response, actual usage and settlement
  are unknown. The agent releases that reservation rather than inventing a cost;
  previously committed calls remain recorded. Ambiguous settlement reconciliation
  and ledger corruption/read-error handling remain integration work.

Successful responses retain the existing top-level provenance fields for
compatibility and add one entry per model call:

```json
{
  "provenance": {
    "requestId": "latest-call-request-id",
    "calls": [
      {
        "sequence": 1,
        "phase": "initial",
        "requestId": "first-call-request-id",
        "paymentTxId": "first-meter-payment",
        "costUsd": 0.002
      },
      {
        "sequence": 2,
        "phase": "tool",
        "requestId": "second-call-request-id",
        "paymentTxId": "second-meter-payment",
        "costUsd": 0.002
      }
    ]
  }
}
```

`phase` is `initial`, `tool`, or `schema-repair`. Payments should preserve this
array as `proof.upstream.calls`; the demo script also prints every meter ledger
entry when an older payments response has not forwarded the array. Do not present
one top-level request/payment pair as proof for several meter calls.

## Offline demo and live fan payer

`node agent/scripts/demo.ts` loads `agent/.env` regardless of the caller's working
directory. It reads the payments health mode and uses `createPayer()` for the fan's
402/sign/retry handshake:

- `dev`: an explicit mock fan payer is allowed; no chain payment occurs.
- `live`: `HEDERA_FAN_ACCOUNT_ID` and `HEDERA_FAN_PRIVATE_KEY` are both required.
  Missing credentials, an unknown mode, or a mock payer result fails closed.

Fan credentials are distinct from `HEDERA_AGENT_ACCOUNT_ID` and
`HEDERA_AGENT_PRIVATE_KEY`, which pay only for agent compute. Neither live path can
borrow the other account or silently degrade to mock. Set `PAYMENTS_MODE=live` in
both services for the real integration.

The demo labels `split`/`splitPreview` as an **arithmetic preview only**. It does
not claim the artist/agent split settled on chain without explicit verification.

`node agent/scripts/smoke.ts` makes a real provider/meter call when invoked and
uses the neutral deterministic prompt `Reply with exactly SMOKE_OK and nothing
else.` It does not ask for ungrounded artist facts. Tests never invoke these live
scripts or a real provider.

## Verification and remaining limits

From `agent/`:

```bash
npm ci --ignore-scripts
npm test
npm run typecheck
```

The locked clean install supplies the optional x402/Hedera declarations needed by
the full typecheck; no permissive stubs replace them. The HTTP tests bind an
ephemeral loopback port with an injected counting steward and make no external
network calls. Dependency audit warnings, live Hedera/0G settlement, wallet
claims, activation, and deployment are separate verification steps, not claims of
this offline suite.

AI assistance for these security/demo fixes and documentation: Kimi (Moonshot AI),
operating as `ohana-sysadmin`.
