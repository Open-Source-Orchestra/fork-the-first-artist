# PR #3 review and integration handoff

Reviewed revision: `855d08ac0ec115f4c5d5271a80d3a15d9a646dcd`, [PR #3](https://github.com/princekeshri00/fork-the-first-artist/pull/3). Review date: 6 November 2026. AI assistance: Codex.

Recommendation: use this revision as a development base, as requested, but address the findings below before exposing paid services or treating it as a working testnet demo. This is a source review and offline test run, not a complete security audit or live integration certification. The PR has not been merged or given a GitHub review by this agent.

The owner assigned non-payment implementation to Codex. Payment findings remain for the payments teammate; no payment source files were changed during this review.

## High-priority findings

### R1 — Missing consent defaults to permission

Locations at reviewed revision: `agent/src/index.ts:62`, `agent/src/steward.ts:94`.

`loadArtist()` returns the consenting demo artist when the profile file is absent and merges its `consent: true` into incomplete files. `Steward.run()` rejects only literal `false`; absent, null, and incorrectly typed values do not fail that check. This contradicts both the product plan and `ArtistProfile`'s documented rule that absent consent must stop answering.

Fix direction: require an explicit boolean opt-in, do not inherit another artist's consent or facts, and distinguish configured artist data from offline fixtures. Tests must demonstrate zero provider calls when consent is missing or malformed. This local gate still cannot replace the planned invite, wallet proof, and activation record.

Owner: non-payment implementation. Follow-up: commit `03` fixes missing/non-boolean consent, profile inheritance, and missing-file fallback with regression tests. Verified claim/activation and demo-fixture publication controls remain outstanding.

### R2 — Public agent endpoint bypasses the payment gate

Locations: `agent/src/server.ts:83` (request handling), `agent/src/server.ts:129` (listen).

The comment says payments verifies requests before the agent answers, but `/ask` performs no caller authentication or payment verification. `server.listen(port)` does not restrict the bind address to loopback, and CORS permits every origin. A caller that can reach this service can invoke inference directly and consume the agent's budget without paying the artist. Provider/model selection is also caller-controlled.

Fix direction: establish an authenticated service-to-service contract or an explicitly enforced private-network boundary. CORS is not authentication. Coordinate the caller change with the payments teammate; adding an agent-only shared-secret check would otherwise break the current payments call.

Owner: agent implementation plus payment integration contract. Status: open; deployment/authentication choice required.

### R3 — Failed settlement produces a successful paid response

Locations: `payments/src/paywall.ts:193`, `payments/src/meter.ts:181`, `payments/src/gate/hedera.ts:209`.

The live gate can return `success: false` without throwing. Both handlers continue to append a paid ledger entry and send HTTP 200. They substitute an `unsent-*` ID when no settled transaction exists. The receipt header carries the failure flag, but the JSON still presents an answer and payment proof/paid amount. Consumers and budget calculations can therefore treat failed payments as completed payments.

Fix direction: branch on verified settlement success before recording paid amounts or claiming success. Define how pending/ambiguous settlement is reconciled, and test a facilitator response with `success: false` as well as transport errors.

Owner: payments teammate. Status: open.

### R4 — A caller chooses the artist's payout destination

Location: `payments/src/paywall.ts:117`.

The request's `?payTo=` overrides the configured artist account. The server does not resolve or authenticate an ENS record and does not bind this destination to a verified artist claim. A caller can request the artist's answer while directing the transfer to a caller-controlled account; valid payment to that account is not payment to the artist.

Fix direction: derive the recipient server-side from the verified artist identity. Reject conflicting client-supplied destinations. Test that a different recipient cannot receive an accepted payment for the configured artist.

Owner: payments teammate, with claim/ENS contract supplied by non-payment implementation. Status: open.

### R5 — The spending ceiling does not cover every paid call

Locations: `agent/src/steward.ts:151`, `:199`, `:228`, `:315`; `agent/src/budget.ts:109`; `agent/src/providers/openai-compatible.ts:81`; `payments/src/meter.ts:113`.

The steward checks affordability before entering the tool loop, then makes additional tool and schema-repair calls without repeating the check. Spend is recorded only after the whole run succeeds, so earlier paid calls are not recorded when a later turn fails. Metered adapter estimates use token-price fallbacks rather than the meter's fixed per-call price. The per-request override can also raise the configured ceiling. Separately, simultaneous requests can all pass the same ledger-total check before any of them records spending; neither service reserves funds atomically.

Fix direction: define authoritative per-call pricing, reserve budget before each paid call, prevent overrides from raising operator limits, record already-incurred costs on failure paths, and cover concurrent requests. Do not claim that the current checks enforce the $5 demo limit under these conditions.

Owner: agent budget logic; payments teammate owns meter reservations and settlement accounting. Status: open; requires agreement on pricing/reservation contract.

### R6 — Payment revenue is counted as inference spend

Locations: `payments/src/spend-log.ts:180`, `payments/src/meter.ts:113`.

`SpendLog.totals()` sums every entry's `priceUsd`, including `kind: 'ask'` artist revenue. The meter uses this total for its compute cap. With the default $0.05 hourly ceiling, one $0.10 fan payment exhausts the reported hourly budget even though a metered call costs $0.002. The next inference call can be refused while actual compute spend remains below the cap.

Fix direction: calculate compute expenditure separately from artist revenue and scope it to the correct compute wallet/artist. Test a fan payment followed by another metered call.

Owner: payments teammate. Status: open.

## Additional integration gaps

- Split amounts returned by the API are local arithmetic, not verified recipient transfers. The default asset is not modified by this code, and the custom-fee token script has not been executed. Do not equate a split preview with proof that both accounts received their share.
- Both ledgers catch all read failures and use an empty history; malformed lines are skipped. Missing-file initialization needs to be distinguished from unreadable/corrupt history so spending does not resume against an unknown balance.
- The claim, invite, wallet-signature, HCS claim-event, and ENS-activation workflows are absent. The HCS spend log is not an implementation of the identity/consent claim log.
- The checked-in artist profile contains demo identity, song, and consent data. Its presence is not evidence of an actual signed claim or permission to publish it.
- `agent/README.md` is still the short scaffold. The new agent API and setup instructions need a package-level explanation as fixes land.

## Independently observed validation

Environment: Node `v24.7.0`.

| Check | Result |
|---|---|
| `npm test` from repository root | Payments' non-server tests passed; server test process crashed under sandbox restrictions; root command stopped before agent tests |
| `npm test` from `agent/` | 42 passed, 0 failed |
| `node --test test/server.test.ts` from `payments/`, with approved local-socket access | 9 passed, 0 failed |
| Payments non-server tests in the initial root run | 30 passed |
| Baseline tests accounted for across runs | 81 passed; not a single uninterrupted root run |
| Hedera settlement, 0G inference/TEE, HTS custom-fee token | Not run; no live proof produced |

Existing tests verify useful happy paths, protocol shapes, and several refusal paths. They do not disprove the findings above: for example, the settlement doubles return success, consent coverage tests explicit `false`, and budget checks do not exercise concurrent paid work.

Type checking and dependency installation are recorded separately in the implementation log as their results become available. Do not infer type-check success from Node's TypeScript execution, which strips types at runtime.
