# Cloudflare Worker — narrow Hedera + 0G demo host

> **Status: built and mock-tested, not deployed and not live-validated.** No real Hedera transaction, 0G response, workers.dev hostname, custom domain, or sponsor qualification is claimed here.

The `cloudflare/` package is one small Worker for the core demo only:

```text
public click                    any x402 client
    │                                │
    ▼                                ▼
POST /demo ── dedicated fan payer ──► POST /ask
                                         │ 402 challenge (artist payTo + facilitator feePayer)
                                         │ verify the signed payment
                                         ▼
                                   real 0G completion
                                   bounded fictional profile
                                         │ only a usable answer proceeds
                                         ▼
                                   settle same challenge
                                         │ only confirmed tx proceeds
                                         ▼
                              answer + HashScan + 0G provenance

GET /health = non-sensitive configuration and route summary
```

This is **not** the unfinished 96.31/3.69 split, agent-pays-0G meter loop, HCS logging, ENS issuance, claims, or a durable global budget. The fan pays the server-configured artist account. The Worker's ordinary 0G API credential pays for/authorizes inference; this package does not claim an autonomous agent-to-0G payment.

## Implemented guarantees

- Reuses `payments/src/gate/hedera.ts` and `agent/src/rails/payer.ts`; no second implementation of the x402 wire protocol.
- The exact same requirements object, including facilitator `extra.feePayer`, is passed to `/verify` and `/settle`. Facilitator validity/settlement statuses must be literal booleans; malformed values fail closed.
- One globally consistent SQLite Durable Object claims each SHA-256 payment-header digest before 0G. Concurrent/sequential replays receive 409 without repeated compute. Failed 0G calls release the claim; a usable answer seals it before any settlement attempt. Claims expire after one hour (the payment lifetime is 180 seconds). No signed payload or spend amount is stored.
- `payTo` is always `HEDERA_ARTIST_ACCOUNT_ID`. Request bodies and query strings cannot override payout, artist data, messages, or model.
- `/demo` constructs the dedicated Hedera fan payer server-side. It never uses an artist private key and refuses a mock payer or an account mismatch.
- The payer makes two sequential public `/ask` calls (quote, then signed retry). `global_fetch_strictly_public` is enabled as required for Worker-to-Worker global `fetch()`; these are sequential, not a recursive inference loop.
- Input is one `question` (or `instruction`) string, maximum 280 characters, JSON maximum 2,048 bytes. The 0G response is capped at 65,536 bytes and 160 output tokens.
- The model receives only a neutral **fictional** artist fixture (`Mira Modal`). Do not put private artist data in its source, environment, prompts, or logs.
- Empty, malformed, oversized, truncated, mocked, tool-call, missing-request-ID, non-`stop` finish-reason, or otherwise degraded answers do not settle. A router-reported `tee_verified: false` is untrusted and does not settle.
- Settlement `success: false` returns HTTP 502 with `settled: false`, `answer: null`, and `proof: null`.
- Missing transaction ID, settlement transport failure, or a missing/mismatched settlement network returns HTTP 502 with `settled: null` and `reconciliationRequired: true`. It never invents either success or “definitely not charged.”
- A `/demo` transport interruption after a possible signed retry likewise uses `settled: null`.
- A 200 response includes the answer, real settlement transaction/HashScan URL, and 0G provenance only after confirmed settlement. Failure responses do not carry the paid answer or proof.
- CORS allows exactly `https://artist.opensourceorchestra.org`, the frontend preview on loopback port 4173, and the Worker preview on loopback port 8787. Other browser origins are rejected. Requests without an `Origin` remain available to agents/curl; CORS is not authentication.

## 0G provenance: what is and is not verified

The request explicitly sets `verify_tee: true` and `X-0G-Provider-Trust-Mode` (default `verified`). The provenance block preserves:

- `requestId` from `x-0g-request-id`, falling back to `x_0g_trace.request_id`;
- `providerAddress` from the trace (or `X-Provider` fallback) and the actual response `model`, when supplied;
- the raw **`ZG-Res-Key` response header**, also returned as `ZG-Res-Key` on a successful `/ask` response;
- `verificationChatId`, using `ZG-Res-Key` first and the OpenAI body `id` second, following the [official 0G verifiable-execution guide](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/features/verifiable-execution);
- `routerReportedTeeVerified`, whose value is only the Router's report; and
- `independentlyVerified: false`.

**A `tee_verified` boolean alone is not independent proof.** This Worker does not run the 0G SDK's independent `processResponse` verification. Use the preserved provider address and verification chat ID for that separate check. A missing/`null` Router verification value remains explicitly `null`; it is never presented as `true`.

## Configuration

### Secrets — `wrangler secret put`

| Name | Purpose |
|---|---|
| `HEDERA_FAN_PRIVATE_KEY` | ECDSA key for a **dedicated testnet fan account**, never the artist key |
| `UPSTREAM_API_KEY` | 0G testnet Router credential; currently not available in the build lane |

Never put either value in `wrangler.jsonc`, frontend code, git, a dashboard, a test fixture, or a log. `cloudflare/.dev.vars` is gitignored; `.dev.vars.example` contains placeholders only.

### Public variables

Required with no silent model/account fallback:

| Name | Meaning |
|---|---|
| `HEDERA_ARTIST_ACCOUNT_ID` | Sole artist payout destination, e.g. `0.0.…` |
| `HEDERA_FAN_ACCOUNT_ID` | Autonomous demo payer; must differ from artist |
| `UPSTREAM_MODEL` | Currently available testnet model; **required because no model has been live-validated** |

Optional defaults:

| Name | Default / constraint |
|---|---|
| `HEDERA_NETWORK` | `hedera:testnet`; other networks are refused |
| `HEDERA_ASSET` | `0.0.429274` (testnet USDC) |
| `HEDERA_ASSET_DECIMALS` | `6` |
| `FACILITATOR_URL` | `https://x402.org/facilitator` |
| `UPSTREAM_BASE_URL` | `https://router-api-testnet.integratenetwork.work/v1` |
| `UPSTREAM_TRUST_MODE` | `verified` |
| `DEMO_PRICE_ATOMIC` | `1000` (0.001 USDC at six decimals); server refuses values above `10000` |
| `DEMO_MAX_OUTPUT_TOKENS` | `160`; maximum allowed `160` |
| `DEMO_IP_LIMIT_PER_MINUTE` | `2` |
| `DEMO_GLOBAL_LIMIT_PER_MINUTE` | `6` **per isolate**, not global |
| `DEMO_MAX_INFLIGHT` | `2` per isolate |

The payer SDK separately gets `maxAmountPerPayment: '$0.01'`. The default asset/amount configuration is the only intended public-demo configuration; changing token or decimals requires a fresh review of price and spend-cap semantics.

## Exposure limits — read before making `/demo` public

1. Fund `HEDERA_FAN_ACCOUNT_ID` with only a tiny test balance—enough for a handful of calls, not a mainnet treasury. Keep other tokens and keys elsewhere. Confirm its test-USDC association and x402 facilitator flow in a controlled test first.
2. Per-IP/global fixed-window counters and the in-flight cap are **memory-only and isolate-local**. Isolates restart, scale, and run in multiple locations. They are not durable, not globally synchronized, and not a global \$5 ledger.
3. The Durable Object stores only one-hour payment-claim hashes for replay prevention; it is not a budget or durable spend counter. The tiny dedicated fan balance remains the final financial backstop. Add and verify an account-level Cloudflare rate-limit/WAF control before a high-visibility launch; none is claimed to be enabled here.
4. `/demo` intentionally spends without a human wallet approval. Treat every public call as a possible real testnet payment and 0G charge. CORS does not stop curl, bots, or server-to-server requests.
5. Application code does not log prompts, payment headers, keys, or upstream error bodies, and Wrangler observability is disabled in this config. Facilitator, Router, and Cloudflare operational metadata still have their own retention policies.
6. Ask users not to submit sensitive questions. Questions go to 0G; the artist fixture is fictional, but the fan's question may still contain sensitive text.

## Local verification (no live credentials)

```bash
npm --prefix cloudflare ci
npm --prefix cloudflare test
npm --prefix cloudflare run typecheck
npm --prefix cloudflare run build   # wrangler deploy --dry-run, not a deploy
npm --prefix cloudflare audit
```

Build-lane results:

- 25/25 mock tests pass: 402 and canonical feePayer reuse; successful response shape; 0G failure/degradation/no-settle; settlement false/missing-tx/transport ambiguity; autonomous `/demo` retry; CORS/input; configuration and rate limits; ZG-Res-Key and body-ID fallback; health.
- Strict TypeScript passes.
- Wrangler 4.158.0 dry-run bundle passes with `nodejs_compat` and `global_fetch_strictly_public`, including the `PAYMENT_REPLAY_GUARD` SQLite Durable Object binding: approximately 4.6 MiB uncompressed / 622 KiB gzip. Aliases point to the pinned x402 ESM entrypoints, as recommended by Wrangler's bundling documentation.
- A local `workerd` health smoke test passed with dummy values; an untrusted Origin returned 403. No live upstream was called.
- A narrow transitive `ws` override to patched 8.21.0 leaves the canonical x402/Hiero versions pinned and makes `npm audit` report zero vulnerabilities at build time.

## Deployment steps for the main integration lane

Do not deploy until real test accounts, a currently available model, the 0G credential, the fan's tiny balance, and SQLite Durable Object capability on the intended plan have been checked by the operator. Wrangler declares the binding/migration but no capability was changed or verified live in this lane.

```bash
cd cloudflare
npm ci

# Use a scoped token and the intended account; never commit them.
export CLOUDFLARE_ACCOUNT_ID='<account-id>'
export CLOUDFLARE_API_TOKEN='<workers-write-token>'

npx wrangler secret put HEDERA_FAN_PRIVATE_KEY
npx wrangler secret put UPSTREAM_API_KEY

# workers.dev only; no custom route/domain is configured in this branch.
npx wrangler deploy \
  --var HEDERA_ARTIST_ACCOUNT_ID:0.0.ARTIST \
  --var HEDERA_FAN_ACCOUNT_ID:0.0.FAN \
  --var UPSTREAM_MODEL:CURRENT_TESTNET_MODEL \
  --var UPSTREAM_BASE_URL:https://router-api-testnet.integratenetwork.work/v1
```

Then:

1. Open `GET https://oso-artist-demo.<verified-subdomain>.workers.dev/health`; confirm the intended model, network, asset, and limits.
2. From the allowed frontend origin, send `POST /demo` with `Content-Type: application/json` and `{"question":"Name one song."}`. No wallet key or payment header belongs in browser code.
3. Exercise `POST /ask` without payment and confirm the 402 body and `payment-required` header contain identical requirements and facilitator `feePayer`.
4. Make one controlled live call. Require HTTP 200, a non-empty real transaction, the intended artist recipient on HashScan, a real 0G request ID/provider/model, and preserved `ZG-Res-Key` when supplied. Independently verify the 0G response separately if claiming independent verification.
5. Test a 0G failure and a settlement failure against controlled mocks/staging again before recording. Do not narrate a mock or dry-run as a live transaction.
6. Attach the frontend to `/demo` only after those checks. This branch deliberately does not touch `frontend/` or configure a custom domain.

## Cloudflare read-only capability check (6 Nov 2026)

No mutation or paid-plan action was performed.

- `CF_API_TOKEN` verified **active** through `GET /user/tokens/verify`.
- `GET /accounts/:id/workers/scripts` succeeded and returned an empty page, demonstrating Workers Scripts read capability for the configured account.
- Account details, Workers account settings, Workers subdomain, and billing subscription reads were denied with authentication/permission errors. The legacy `/workers/subscription` endpoint returned 404. Therefore this token **could not verify the account plan, billing state, or workers.dev subdomain**.
- Cloudflare documents a Free plan by default, but this account's actual plan was not inferred from that general statement. Confirm plan/subdomain in the dashboard with an appropriately privileged human session before deploying. No paid plan was enabled.

## Honest limitations / next gates

- No real 0G key was available (faucet/CAPTCHA/team-credit blocker), so model availability, live request shape, response headers, settlement, account association, and free-plan runtime behavior remain unverified.
- The bundle builds, but a dry-run does not prove a cold `/demo` invocation on the account's actual Workers plan. Test cold starts and SDK signing in the deployed environment before a public launch.
- In-memory rate limits are not a durable financial control. There is no global \$5 ledger. Replay claims are durable hashes only; actual Durable Object behavior/capability still requires deployed-environment verification.
- The public demo pays only the artist; it does not prove a split, HCS entry, ENS name, signed claim, or agent-funded 0G payment.
- Router-reported TEE metadata is not independent verification. `ZG-Res-Key` is preserved so a verifier can perform that separate step.
- A paid answer is computed before settlement. If settlement is ambiguous/fails, the Worker withholds that answer and returns a non-200; compute cost may already have been incurred even though no paid response is released.
