# Numbered implementation workflow

Status: owner confirmed PR #3 as the implementation base and ownership of all non-payment work. Review payment code and report issues; the teammate owns payment fixes. Adapt the existing OSO node frontend in this repository. ENS mainnet is approved for the design; live deployment is not yet authorized.

This document describes how we will implement and review the project. Product requirements remain in [PLAN.md](PLAN.md). A proposed stage below is not an approved architecture decision or a claim that a feature exists.

## Source review and current state

Read on 6 November 2026: the root README, all four package READMEs (`frontend/`, `ens/`, `agent/`, `payments/`), `docs/PLAN.md`, and `docs/TX-PROOF.md`. No `AGENTS.md` was found in the checkout or its ancestor directories.

The starting local `main` commit is `6fe2eec6c34f790000bb2fa0f4e0817b8c42aeed`. It contains documentation and directory scaffolding, with no application implementation or test runner.

- [PR #1](https://github.com/princekeshri00/fork-the-first-artist/pull/1): small Python agent demo; changes requested by the owner.
- [PR #2](https://github.com/princekeshri00/fork-the-first-artist/pull/2): closed without merging.
- [PR #3](https://github.com/princekeshri00/fork-the-first-artist/pull/3): open agent/payments implementation. Its description reports 81 passing tests, but explicitly says live Hedera settlement, 0G/TEE, and other provider integrations have not been executed. Those results have not been independently verified here.

PRs are dependencies to evaluate, not implicitly accepted code. Recheck their current heads before integrating. Preserve contributor attribution when reusing their commits.

## Decisions needed before dependent code

| Decision | Why it matters | Status |
|---|---|---|
| Ownership: frontend/claims/ENS, PR review, or whole application | Avoid conflicting implementations of teammate-owned features | Confirmed: review PR #3; implement non-payment work; report payment issues to owner |
| Base: current main or PR #3 | Determines APIs, package layout, and integration work | Confirmed: PR #3 without merging; local branch `work/pr3-integration` based on `855d08a` |
| Frontend/backend stack and deployment target | Determines runtime, persistence, routing, and build constraints | Confirmed: adapt nodes/shaka into frontend/ using static HTML/CSS/JS; persistent Node + PostgreSQL approved; backend host/domain remain undecided |
| Supported wallets and payout identifier | The signature must prove control of the exact payout destination, including any Hedera account/EVM-address mapping | Confirmed: MetaMask for ENS mainnet authority and HashPack for native Hedera testnet account proof; one claim binds both |
| ENS parent, network, issuer, and onchain/offchain approach | Determines ownership checks, registration, and resolution | ENSv2 mainnet; artist-controlled records and no OSO revocation/reassignment confirmed. Parent supplied later; exact permissions/renewal pending |
| Payment asset, decimals, facilitator, and split method | Needed to validate actual settlement and recipient amounts | Unresolved; inspect PR #3 before proposing choices |
| Invite issuer, freeze authority, and authentication | Needed before implementing privileged claim operations | Confirmed: server-side steward CLI, no public admin endpoint; freezes affect OSO services only |
| Profile storage, photos, and public claim-log contents | Determines persistence, upload controls, and personal-data exposure | Unresolved |
| 0G funding path and enforcement of the $5 demo cap | Compute earnings and inference costs may use different assets/networks | Unresolved; requires live integration evidence |
| Consenting demo artists and approved public content | Required before publishing or activating artist resources | Not supplied |

Ask decisions when their stage approaches. Record the owner's answer, date, rationale, and affected stages here before dependent implementation. Never put private keys, tokens, invitation secrets, or full environment values in documentation, commits, or chat.

Owner decisions recorded on 6 November 2026: the source frontend is [oso-storytelling](https://github.com/shakaleikaumaka/oso-storytelling). After an initially rejected clone request, the owner authorized a retry. A partial clone and selective source checkout succeeded after two connection resets. See [FRONTEND-INTEGRATION.md](FRONTEND-INTEGRATION.md) for inspected features, reuse boundaries, pending decisions, and the next feature sequence. Commit `01` was carried onto the PR-based branch as `0174c3f`; the original planning branch remains available. No remote merge or push occurred.

Updated owner decisions and verified partner requirements are recorded in [PRIZE-STRATEGY.md](PRIZE-STRATEGY.md). No prior 0G/Hedera integration evidence was supplied; 0G Continuity is excluded from current targets.

## Commit and review contract

Current stage C progress: commit 12 implements steward issuance/revocation and freeze persistence with real PostgreSQL concurrency/rollback tests. Claims cannot yet be created through an application path; private drafts, consent, dual-wallet verification, service enforcement, and activation remain outstanding. The operational boundary and setup are in [claims/README.md](../claims/README.md).

1. Work on a feature branch. Use a PR and obtain the teammate approval required by the root README before merging; never push directly to `main`.
2. Number our commits consecutively within this implementation series: `01`, `02`, `03`, and so on. Preserve existing contributor commit messages and history.
3. Make one cohesive feature or prerequisite per commit. Include its tests and documentation in that same commit. Do not combine unrelated completed features.
4. Assign the next number when the commit is ready. Stage identifiers below are planning references, not reserved commit numbers. If a feature needs several independent changes, give each its own commit and log entry.
5. Use a precise subject: `NN type(scope): observable change`. Use `docs`, `chore`, `feat`, `fix`, or `test` according to the actual diff.
6. Explain why the change is needed, its behavior and boundaries, important implementation decisions, exact verification and results, and any remaining limitations in the commit body. Never describe an unexecuted check as passing.
7. Before committing, inspect the entire staged diff for accidental files, secrets, misleading claims, and unrelated changes. Run relevant checks and `git diff --cached --check`.
8. Update [IMPLEMENTATION-LOG.md](IMPLEMENTATION-LOG.md) in every commit. Record dependencies and manual reproduction steps when applicable. Add deeper design documentation only where the feature needs it.
9. Disclose AI assistance. Keep author identity from the configured repository environment; do not impersonate another contributor.
10. Report the completed commit, verified behavior, and any blocking decision to the owner. Ask when a requirement is unclear or evidence contradicts the plan.

Commit body structure:

```text
Why:
<problem or requirement>

Changes:
<specific behavior, main files, and significant decisions>

Validation:
<commands actually run and observed results>

Limitations / follow-up:
<remaining dependencies, unverified behavior, or none>

AI assistance: Codex.
```

## Implementation stages

The order below follows feature dependencies. Confirm ownership and architecture before converting stages into coding commits. A teammate's accepted implementation can satisfy a stage after review and verification; do not rewrite it merely to create another commit.

| Stage | Deliverable | Completion evidence |
|---|---|---|
| A — Decisions and integration review | Record scope, base commit, stack, runtime, contracts, and responsibilities; inspect any adopted PR | Explicit decisions; concrete compatibility findings; independently run relevant existing tests |
| B — Runnable foundation | Minimal application/package setup, validated configuration, development commands, and environment examples | Clean install and start using documented commands; missing configuration fails clearly; no credentials committed |
| C — Claim domain and persistence | Invite, draft submission, verified claim, activation, and freeze states with explicit permissions | State-transition and persistence tests; duplicate claims rejected; unclaimed submissions cannot become public resources |
| D — Wallet proof | Server-issued signing challenge bound to invite, intended action, origin, payout destination, nonce, and expiry | Valid proof accepted; tampering, replay, expiry, wrong wallet, and concurrent consumption rejected |
| E — Artist onboarding | Name, bio, photo handling, payout selection, consent, and wallet claim UI | Field validation and accessible errors; no activation without verified consent; successful claim flow tested |
| F — HCS claim audit | Record approved public claim information and freeze events; define failure/retry behavior | Testnet receipt and documented proof; retries do not create inconsistent claim state; no private invite data logged |
| G — ENS identity | Approved subname issuance and payout/agent/profile records, gated on the verified claim | Name validation and authorization tests; Ethereum mainnet resolution evidence after deployment review; safe handling of retries and conflicts |
| H — Agent activation | Bind the steward to the claimed artist and approved content; enforce provider readiness and compute budget | Artist isolation and budget tests; real provider request evidence; unavailable providers do not appear live |
| I — Payment integration | Connect the approved x402 flow, recipient split, and inference funding; validate existing PR code if adopted | Integer amount tests; replay/concurrency/failure tests; settled testnet transaction with actual recipient amounts |
| J — Fan experience | Public artist profile, supported paid interactions, wallet payment states, and transaction links | Successful payment journey plus rejected, failed, and pending states; no false success or duplicate charge |
| K — Integrated verification | First artist and consenting second-artist flows, freeze behavior, service failures, and spending limit | Reproducible integration checks, real transaction/request IDs, documented gaps and recovery steps |
| L — Handoff and submission | Accurate package READMEs, setup/runbook, architecture notes, contributor credit, and demo script | Fresh setup rehearsal; links and evidence checked; mock and live behavior clearly distinguished |

## Security and verification requirements

Apply these controls where their implementation becomes relevant, and test the failure cases rather than merely documenting the intended behavior:

- Consent and wallet control precede public profile/name/agent activation. An unchecked client-side checkbox or supplied address is not proof.
- Invite redemption and challenge consumption need atomic handling, expiry, and replay protection. Privileged invite/freeze operations require server-side authorization.
- Keep artist payouts bound to the verified destination. Specify and verify the account mapping rather than treating different address formats as interchangeable.
- Scope every profile, agent, claim, and spend record to the correct artist. Bound request sizes, timeouts, and abuse-sensitive operations.
- Render artist content safely. Validate URL schemes; constrain uploads if supported; prevent arbitrary server-side fetching of user-supplied URLs.
- Keep signing keys and service credentials server-side. Provide sanitized environment examples without secret defaults. Do not log payment authorization material or claim secrets.
- Treat money as exact atomic units. Verify the configured asset, network, amount, recipients, settlement status, and rounding. Demonstrate the split on settled transactions, not just a local calculation.
- Enforce spending limits before paid work, including simultaneous requests and retries. Model output must not authorize arbitrary transfers.
- Treat artist text and fan prompts as untrusted input. Fencing is defense in depth, not proof that prompt injection is impossible; restrict tool capabilities independently.
- Define recovery when an external action succeeds but a later write fails. Do not report a failed or pending transaction as completed.
- Separate offline tests, mock integration tests, and actual testnet evidence. Use only authentic transaction/request IDs in proof files.

For each code change, run the checks appropriate to its behavior: targeted tests, type checks/build where configured, and integration or browser verification when the affected flow needs them. Record skipped or blocked checks with their reason. Documentation-only commits require content review and whitespace/link checks, not an invented application test result.
