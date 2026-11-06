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

The checked-in Shaka profile and `DEMO_ARTIST` constant are demo fixtures. Their
consent values are not evidence of a signed claim or authorization to publish an
artist. The existing service is still awaiting authenticated activation and
deployment boundaries; do not treat this local data check as wallet verification.

Regression coverage in `test/artist.test.ts` and `test/steward.test.ts` exercises
missing profiles, malformed values, inherited-consent prevention, and zero model
calls for unconsented requests. See the
[implementation log](../docs/IMPLEMENTATION-LOG.md) for actual results.

AI assistance for the integration fixes and this documentation: Codex.

## Budget input limits

Operator ceilings must be finite, non-negative numbers. `Budget` copies and
freezes them at construction. Request-level `maxUsd` can tighten the configured
per-request ceiling, including setting it to zero; it cannot increase that ceiling.
Invalid estimates or overrides throw before an affordability comparison.

These input checks do not fix the remaining budget integration findings: concurrent
calls need reservations, each paid tool/repair turn needs accounting, and the
meter's actual price must be the source for metered-call estimates. See R5 in the
PR review before relying on the overall spending limit.
