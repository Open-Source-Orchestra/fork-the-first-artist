# Implementation log

Each numbered entry corresponds to one commit in this implementation series. Tests and documentation travel with their feature. This log records observed results, not planned outcomes.

## 01 — Establish the numbered implementation workflow

Date: 6 November 2026 (Asia/Kolkata).

Author: configured Git identity `princekeshri00`. AI assistance: Codex.

### Purpose and changes

The owner requested a complete staged coding workflow, a numbered commit after every cohesive feature, accurate detailed commit descriptions, detailed implementation documentation, and clarification instead of assumptions about requirements.

- Read every README on current `main`, the product plan, transaction-proof file, and ignore rules.
- Checked the clean starting tree and existing commit history; searched for applicable `AGENTS.md` instructions and found none.
- Refreshed the open PR search. Agent/payments work already exists in PR #3 and must be considered before implementing overlapping functionality.
- Created the local `work/numbered-implementation` branch from `6fe2eec6c34f790000bb2fa0f4e0817b8c42aeed`.
- Added [IMPLEMENTATION-WORKFLOW.md](IMPLEMENTATION-WORKFLOW.md): commit conventions, pending decisions, implementation stages, completion evidence, and security requirements.
- Linked the workflow and log from the root README.

### Validation

- Read and reviewed all five tracked READMEs and both existing planning/proof documents.
- Checked the new documentation links against tracked or newly added files.
- Reviewed the staged diff and ran `git diff --cached --check` before commit; no whitespace errors.
- No application tests were run: this commit contains documentation only, and the starting project has no application or test runner.

### Pending decisions and limits

Asked the owner which components to own, whether to build from `main` or PR #3, and whether stack/wallet/deployment requirements already exist. Implementation stages remain provisional until those answers arrive. PR #3 tests and live integrations have not been independently verified. No PR was merged, no remote branch was pushed, and no artist resource was activated.

## 02 — Review PR #3 and record implementation ownership

Date: 6 November 2026 (Asia/Kolkata). AI assistance: Codex.

The owner selected PR #3 as the development base, assigned all non-payment work, and requested reuse of the frontend in `shakaleikaumaka/oso-storytelling`. Payments are review/report only; the teammate owns their fixes.

- Fetched PR head `855d08a`, created `work/pr3-integration`, and carried commit `01` onto it as `0174c3f`. Preserved all 12 original PR commits and their authorship.
- Read the additional build-log README, expanded payments README, agent/package contracts, runbook, and implementation code.
- Added [PR-3-REVIEW.md](PR-3-REVIEW.md) with six high-priority findings, affected source locations, ownership, proposed corrections, and verification limits.
- Updated the workflow with the owner's decisions.
- Baseline verification: 42 agent tests, 30 payments non-server tests, and 9 payments HTTP tests passed across separate runs. The initial sandboxed HTTP test process crashed; its approved retry passed. No live services or chain transactions were exercised.
- Frontend clone failed in the network sandbox and the escalation was rejected by the user. No alternative download was attempted. Frontend integration remains blocked on access.
- Application and payment code remain unchanged in this review commit. Dependency installation/type checking are not yet verified.

Reviewed staged documentation and checked whitespace before commit. Findings are reported locally; no GitHub comments or reviews were submitted.

## 03 — Require explicit consent and validate configured artist data

Date: 6 November 2026 (Asia/Kolkata). AI assistance: Codex.

### Behavior and implementation

- `loadArtist()` now reads the configured file directly. Missing/unreadable files fail instead of activating the demo artist.
- Validate the profile object, required name/bio/songs fields, optional identity strings, and boolean consent. Report invalid JSON without echoing its contents.
- Remove demo-profile merging, so an incomplete profile cannot inherit consent, songs, an ENS name, or a payout account.
- Require `consent === true` before the steward selects a provider. Request-level artist profiles replace the configured profile rather than partially overlaying it.
- Add six regression tests and document package behavior and remaining claim/authentication gaps. Payment code is unchanged.

### Validation and limitations

- Before the fix, the targeted artist/steward run had five failures demonstrating the missing-file fallback, inherited consent, invalid profile acceptance, non-boolean consent, and request-context inheritance bugs.
- After the fix, `npm test` from `agent/` passed all 48 tests.
- `npm ci --ignore-scripts` completed after approved escalation. Its audit summary reported 3 moderate and 1 high dependency advisory; these have not yet been assessed or repaired. An offline audit returned no findings, which is not treated as clearing the installation report.
- `npm run typecheck` failed on four unresolved `@x402/*` imports in the unchanged payer module; full type validation is not yet established. Investigation of the installed package exports continues separately.
- This change enforces configured consent only. Invite redemption, signed wallet claims, authenticated activation, and proof of actual artist consent remain pending. Existing fixtures are explicitly documented as fixtures.

The owner authorized another frontend clone attempt and deferred the agent deployment/authentication choice until that frontend is inspected. Those decisions do not alter the consent requirement fixed here.

## 04 — Prevent request budget overrides from raising operator limits

Date: 6 November 2026 (Asia/Kolkata). AI assistance: Codex.

- Clamp each request override to the configured per-request ceiling using the smaller value.
- Reject negative, non-finite, or non-numeric estimates/overrides before comparing budgets. Validate all configured ceilings and preserve zero as a valid refusal ceiling at the Budget API boundary.
- Copy and freeze configured ceilings so later mutation cannot silently increase the limit.
- Add three regression tests covering override escalation, NaN/infinity/negative values, and configuration mutation. Each failed before the implementation and passed afterward.
- `npm test` from `agent/`: 51 passed, 0 failed.
- Targeted strict TypeScript check passed: `./node_modules/.bin/tsc --noEmit --strict --target ES2023 --module nodenext --moduleResolution nodenext --allowImportingTsExtensions --skipLibCheck src/budget.ts test/fence-budget.test.ts`.
- Full package type checking remains blocked by missing optional x402 declarations. The installed `node_modules/@x402/` directory is empty even though `npm ls` reports the locked versions; do not treat that command as proof the modules are usable.

This addresses only the override/input portion of R5. Atomic reservations, per-call accounting, metered pricing, and ledger recovery remain open. No payment source files changed. Reviewed the staged change and whitespace before committing.

Frontend access update: the authorized retry failed with an RPC connection reset/early EOF. A shallow HTTP/1.1 retry is in progress. Agent authentication/deployment remains intentionally undecided until source inspection, as requested by the owner.

## 05 — Map the existing OSO frontend to the integration stages

Date: 6 November 2026 (Asia/Kolkata). AI assistance: Codex.

- After the shallow retry also failed, fetched the source commit/tree with a blob-filtered clone and checked out only relevant docs/HTML/CSS/JavaScript. Source: `shakaleikaumaka/oso-storytelling@b6be898f38df8fff7abc53334b5641a89e31939b`.
- Read the source documentation and inspected profile, garden, signing, overlay, and hackathon status code. Identified the static GitHub Pages architecture and distinguished garden-key signing from payout-wallet proof.
- Added [FRONTEND-INTEGRATION.md](FRONTEND-INTEGRATION.md) with the reusable areas, source boundaries, outstanding choices, and a feature-by-feature implementation sequence. Updated the main workflow's access/inspection status.
- Requested owner selection of frontend template/destination, deployment, wallet/account mapping, and ENS setup. These determine the next integration feature; no framework or backend host has been assumed.
- Retrieved online dependency audit details and documented the affected chain/advisories in the PR review. Investigated npm installation logs: optional-dependency failures removed the SDK subtree, explaining unresolved imports despite a successful install exit. Payment dependencies were not changed.

Validation: source commit and sparse-checkout status verified; relevant source references and local documentation links reviewed; staged whitespace checked. This documentation-only commit adds no executable behavior. Latest application result remains 51 passing agent tests and a passing targeted budget type check. Full package type checking and live integrations remain unverified/blocked as described above.

No source-site files were edited, no artist content was imported or published, and no GitHub comments, pushes, reviews, or merges were performed.

## 06 — Align prize targets and architecture with owner decisions

Date: 6 November 2026 (Asia/Kolkata). AI assistance: Codex.

- Checked official Mumbai ENS/Hedera/0G prize pages and ETHGlobal's pre-existing work rules. Recorded source links, qualification gaps, evidence requirements, and proposed ownership boundaries in PRIZE-STRATEGY.md.
- Owner approved ENS mainnet for the design while retaining Hedera testnet; deployment/gas review remains separate. Owner reports no prior 0G/Hedera integration evidence. Removed 0G Continuity from current targets and kept other unconfirmed eligibility explicit.
- Recorded the previously selected nodes/shaka adaptation into frontend/ and the still-unselected backend host. Updated the root/package READMEs and current plans to remove contradictory testnet-only and destination-pending instructions.
- Asked for the ENS parent/controller and artist-versus-parent revocation rights. No ownership model, wallet integration, deployment platform, or live transaction was assumed.

Validation: reviewed official source pages and local documentation links, inspected the diff, and checked whitespace. Documentation only; no application tests rerun. Payment source unchanged. No deployment, purchase, push, merge, or external message.

## 07 — Add the local OSO artist-home foundation

Date: 6 November 2026 (Asia/Kolkata). AI assistance: Codex.

### Behavior and source

- Adapted the selected OSO node's palette, fonts, gradients, hero, songbook/card layout, and onboarding panel into buildless HTML/CSS. Added semantic navigation, native disclosures, visible focus, reduced-motion support, and mobile stacking rules.
- Used explicitly labeled sample content. No real artist biography/media, external scripts, fonts, wallet calls, paid chat, or simulated transaction success. Consent and live activation remain separate features.
- Documented source revision and exact adaptation boundaries in frontend/SOURCE.md. Copied upstream NOTICE, GPL license, and content license unchanged; attributed adapted styles.
- Added a dependency-free loopback preview with exact public-asset routes, GET/HEAD only, restrictive security headers, and no directory serving. Added root dev:frontend/test:frontend commands and included the HTTP check in the aggregate test script. This does not select or implement a public backend.

### Verification

- Node syntax checks passed for frontend/server.mjs and frontend/test/server.test.mjs.
- Initial HTTP test failed with sandbox EPERM on binding loopback. Approved retry of `npm run test:frontend` passed: one integration test covering HTML/CSS responses, HEAD, headers, rejected write methods, missing files, encoded traversal, and sensitive repository paths.
- Local preview started at 127.0.0.1:4173 after approved escalation for the same sandbox restriction.
- Browser handoff failed because the browser access host was unavailable. Native Chrome selection then timed out. No screenshots or desktop/mobile/keyboard verification are claimed; manual checks are listed in the frontend README.
- One-off HTML parser check verified unique IDs, all internal anchor targets, and absence of scripts. All three preserved source notice/license files match upstream bytes exactly.
- Reviewed the staged changes and whitespace. Existing agent/payment behavior was not changed, so their tests were not rerun. Previously documented full agent typecheck/dependency issues remain unresolved.

### Next dependencies

ENS parent/controller and subname rights are awaiting owner input; wallet proof, claim persistence, backend authentication/hosting, and the payment API contract remain open. No deployment, artist activation, push, merge, or payment-code modification occurred.

## 08 — Record artist control and non-revocable ENS requirements

Date: 6 November 2026 (Asia/Kolkata). AI assistance: Codex.

- Owner selected artist-controlled records with no OSO revocation/reassignment. Parent is not yet chosen and will be supplied later; no repeat request is needed now.
- Updated current plans and ENS README with the decision, application-freeze boundary, and acceptance criteria for full hierarchy/admin/upgrade checks, isolated resolver records, and renewal/expiry disclosure.
- Reviewed official ENSv2 registry, hierarchy, and resolver documentation. Parent checks and actual permission design remain pending; no permanent ownership or deployed guarantee is claimed.

Validation: reviewed the documentation diff and relative references; whitespace check passed. Documentation-only change; no application tests rerun or chain operations performed.

## 09 — Add a local artist draft editor

Date: 6 November 2026 (Asia/Kolkata). AI assistance: Codex.

### Behavior and boundaries

- Added `/draft` with name/bio inputs, explicit local-only disclosure, validation errors, text preview, and discard. The sample home links to it. Editing hides stale output; discard clears inputs/errors/preview. Initialization and page lifecycle handlers clear browser-restored values.
- Added a field-whitelisting validator: 80/1,200 UTF-16-unit limits matching HTML capacity, required values, trimmed outer whitespace, normalized bio newlines, and unsupported-control rejection. International text and markup-looking strings remain literal text. Limits are local UI choices, not a finalized backend schema.
- Rendering uses textContent. No browser persistence, network submission, URL-encoded draft, wallet connection, consent record, claim state, or payment destination is created. No photo storage/upload behavior was assumed.
- Extended the preview server's exact allowlist for the editor and modules. CSP permits only same-origin scripts/styles and still denies native form submission and network connections. Inputs are disabled until handlers are installed and have no serialization names.
- Documented source boundaries, local usage, validation behavior, and unverified browser checks. No new dependency or payment source change.

### Validation

- Node syntax checks passed for both browser modules and the preview server.
- Five validator tests passed, including invalid inputs, boundary lengths, Unicode, control characters, extra authority fields, and markup-looking text. These are not a browser XSS test.
- `npm run test:frontend` passed all six tests with approved loopback access. The HTTP test now verifies the new page/module routes, disabled initial fields, JavaScript MIME types, and CSP form/script rules alongside sensitive-path/write rejection.
- A one-off HTML parser check passed for unique IDs, label/description targets, local routes/anchors, and no native input serialization on both pages.
- Source reviewed for data sinks and lifecycle handling; staged whitespace checked. Browser interaction, mobile layout, error/focus announcements, and lifecycle behavior remain unverified because browser infrastructure failed during commit 07 and no recovery is established. Manual steps are in frontend/README.md; no replacement browser stack was installed.

Next: await wallet-flow selection (MetaMask plus HashPack proposed), parent details when available, and backend/storage/authentication choices before implementing signed claims or publication. This feature does not complete the persistent-draft or claim stage. Existing agent typecheck/dependency limitations remain unchanged.

## 10 — Connect MetaMask without treating connection as ownership proof

Date: 6 November 2026 (Asia/Kolkata). AI assistance: Codex.

- Owner approved MetaMask for ENS authority and HashPack for native Hedera payout proof. Subsequently approved a persistent Node + PostgreSQL backend; project ID will be created later. Recorded these decisions without inventing a host or parent.
- Added `/wallets` and an EIP-6963 discovery/EIP-1193 connection adapter. Explicit click requests accounts; fresh reads select the address/network. Mainnet is required for the intended ENS flow, but even mainnet connections remain unverified. No signing, transaction, switch-chain, storage, or automatic permission request.
- Clear identity on account/network events and disconnect. Ignore late results after forgetting/disconnection; prevent duplicate prompts while one attempt is active. Handle initial account events, mid-read changes, refusal, pending wallet requests, malformed replies, and missing providers. Do not render provider-supplied icons, HTML, or raw error messages.
- Added seven mocked-provider/discovery regression tests. All 13 frontend tests passed, including the updated exact-route HTTP check, with approved loopback access. Module syntax and whitespace checks passed. Browser/real-extension verification remains unavailable, not claimed.
- Checked official MetaMask/EIP docs, HashPack WalletConnect support, the connector's current README, and npm metadata. Hedera connector 2.1.3 recommends AppKit; DAppConnector is legacy. Initial npm metadata lookup failed on sandbox DNS; approved retry succeeded. No dependency installed in this commit.

HashPack is accurately marked unavailable until its next feature. Payment code remains unchanged. No wallet prompt was operated by the agent, no signature/transaction was requested, and no deployment/push/merge occurred.

## 11 — Add configurable native HashPack pairing

Date: 6 November 2026 (Asia/Kolkata). AI assistance: Codex.

- Added a native Hedera testnet WalletConnect adapter and UI with locally rendered QR/copy pairing, explicit numeric-account selection, and unverified status. Requested permission is hedera_signMessage only; no signing or transaction method is invoked. Mainnet/EVM/alias/checksummed IDs and invalid/expired sessions cannot become selected payouts.
- Cancellation clears local state immediately, attempts session/pairing cleanup, and discards late approval. Session changes clear selections. Concurrent initialization shares one client and listener set. Failures expose sanitized messages, not provider data or pairing secrets.
- Added an optional pinned SignClient 2.26.0 + qrcode 1.5.4 runtime bundled by esbuild 0.28.2. Used the direct SignClient API to scope permissions to native message claims, instead of importing the broader AppKit example. SDK storage is in-memory, telemetry disabled, and loading/relay initialization occur only after explicit connection. No project ID is invented or embedded in the bundle.
- Added ignored frontend/.env support and a public-config route exposing only the project ID/readiness. Missing ID/build disables HashPack without breaking drafts/MetaMask. Wallet-page CSP explicitly permits relay/verification domains; draft/sample restrictions remain. Generated files and licenses use explicit routes only.
- Preserved SDK/qrcode licenses and bundle notices in generated assets. WalletConnect Community License is separate from the project GPL; publication must review applicable distribution/use terms. No external code was relicensed.
- Owner confirmed steward CLI commands for invite issuance and service freezes; recorded this as the next backend boundary.

Validation: install with lifecycle scripts disabled added 135 packages; npm's install-time audit reported zero known vulnerabilities. Browser bundle build passed (479,263 bytes). All 20 frontend tests passed with approved loopback access, including six native-session regressions and served runtime/notices/configuration checks. Syntax, HTML route/ID/accessibility references, and whitespace checks passed. Real HashPack pairing, QR/clipboard/CSP behavior, and browser layout remain unverified because no project ID exists yet and browser automation is unavailable. No signatures, payments, live claims, deployment, push, or merge occurred.

## 12 — Persist steward invitations and service-freeze records

Date: 6 November 2026 (Asia/Kolkata). AI assistance: Codex.

### Behavior and boundaries

- Owner approved server-side steward commands without a public admin endpoint. Added a Node CLI for migration, invitation issuance, unused-invite revocation, freeze recording, and status. Host/database access authorizes operators; the actor label is attribution, not cryptographic authentication.
- Added a PostgreSQL schema and pinned pg 8.23.1. Store only hashes of random 256-bit invitation tokens. Tokens return once after the issuance transaction commits; TTL defaults to 24 hours with a 1–72-hour bound. No message is sent or claim link generated.
- Revocation takes the invite row lock; future redemption must use that same lock and verify expiry, both wallet proofs, and consent. Unique invite linkage prevents multiple claim rows. There is no application/CLI path that inserts a verified claim yet.
- Freeze changes only freeze metadata and writes an audit event in the same transaction. Concurrent repeats are idempotent; audit failure rolls back state. No ENS/payout identity fields are changed. Existing services do not yet enforce this flag; the README explicitly marks that limitation.
- Serialized migration application with an advisory lock, checksum validation, and transactional schema changes. Added explicit connection parsing, parameterized operator inputs, verified TLS for remote hosts, timeouts, sanitized CLI errors, and separate root commands for unit versus real database tests.
- Documented operational setup, private token handling, restricted role privileges, migration behavior, future redemption/enforcement requirements, and test isolation. Database audit is private and mutable by database owners; it is not an HCS receipt.

### Validation

- Installed PostgreSQL 18 through approved Homebrew execution (18.6_1). Homebrew initialized its default cluster; this work did not start or enable a background/startup service. Tests used a separate private temporary cluster bound only to loopback with a random SCRAM password and no Unix socket.
- Installed the claims dependency with lifecycle scripts disabled; `npm --prefix claims ls --depth=0` confirmed pg 8.23.1. Lockfile uses registry.npmjs.org package URLs. No new dependency-audit result is claimed in this entry.
- Three database-free configuration/input tests passed. All nine tests then passed against real PostgreSQL, including concurrent migration, tokens/parameterized input, ten concurrent freezes, transactional rollback, incomplete-freeze constraint rejection, revocation, and CLI behavior. Added an explicit checksum-drift rejection case and reran all nine successfully.
- `npm run steward -- --help` passed without database configuration and verified root argument forwarding. Reviewed source/schema, setup documentation, lockfile URLs, and staged whitespace. Existing frontend/agent/payment code is unchanged, so those suites were not rerun for this feature; their previously documented results and limitations still apply.
- Both test clusters stopped after verification. Private temporary test data is retained for diagnosis. No production database, public endpoint, wallet signature, chain write, HCS event, payment source change, push, or merge occurred.

Next: implement consent-bound wallet challenges and atomic redemption, then enforce verified/active/unfrozen claim state at service boundaries. Parent, Reown project ID, host/origin, and the pending public-data/permission decisions remain requirements for live integration; no placeholder is represented as configured.

## 13 — Replace PostgreSQL steward persistence with Arkiv Rabdi

Date: 6 November 2026 (Asia/Kolkata). AI assistance: Codex.

### Decision and scope

- Owner requested Arkiv instead of PostgreSQL after checking ETHGlobal Mumbai partner prizes. Reviewed the official Arkiv prize page and current create/query/batch/expiry documentation, then inspected the installed SDK source. Targeted the existing-project Continuity category; qualification is not claimed without live evidence and confirmed event eligibility. Added the required schema and judging documents under `arkiv/` and noted the unresolved final three-partner selection.
- Replaced the part-12 backend implementation, SQL schema, pg dependency, and PostgreSQL test harness. No real PostgreSQL claim data or production connection was configured by this work. This is a code replacement, not a production-data transfer. Existing PostgreSQL installation/test directories remain untouched; old implementation is preserved in commit `0017db1`.

### Behavior and security

- Pinned Arkiv SDK 1.0.1 and viem 2.57.16 on Rabdi chain 7794095. CLI writes now use actual SDK batches; invitation/claim status reads query Arkiv by schema, namespace, kind, UUID, owner, and creator. Added invite-status and read-only check; removed the SQL migrate command.
- Encrypt private payloads with AES-256-GCM and fresh 96-bit nonces. Authentication binds chain/schema/owner/namespace/kind/ID. Names, operator labels, reasons, wallet bindings, and token hashes stay encrypted. Raw bearer tokens are never persisted. Public metadata/ciphertext/timing remain visible and are documented.
- Create state with readonly attributes. A transition creates replacement state and audit and deletes the exact prior entity in one batch. This relies on documented atomic batching and rejection of a missing prior entity. Reads reject ambiguity, malformed schema, wrong ownership, stale head/query blocks, invalid authentication, and expiry. Concurrent failure is explicit rather than silently overwriting state.
- Classify only a decoded EntityNotFound revert for the exact consumed key as a state conflict. Other failed/unconfirmed writes remain uncertain; raw provider messages/URLs are not printed, and writes are not blindly retried. The live test requires this specific conflict classification so an RPC outage cannot pass the concurrency check.
- Added a live synthetic-invitation test for issuance/read/revocation/idempotency/stale-write rejection. It prints public writer/transaction/entity evidence only, never tokens or decrypted private records. No production claim insertion or artist activation path was added.
- Generated a separate encryption key in ignored claims/.env with exclusive creation and mode 0600, without printing it or overwriting user configuration. Owner will configure their test signer/access key locally. The template contains empty secret values. No secret entered source control.

### Verification

- Initial sandbox npm metadata lookup failed with DNS ENOTFOUND; approved retry succeeded. Approved dependency installation with lifecycle scripts disabled reported zero known vulnerabilities. Removed pg and its transitive dependencies via an offline install after updating the manifest.
- All **12 offline tests passed**: config/input validation, encryption randomness/authentication/context/tampering, encrypted token storage, concurrent freeze modeling, batch-failure rollback modeling, revocation/expiry, absent/duplicate/wrong-owner/stale records, real-SDK query construction and RPC decoding, malformed schema rejection, precise decoded-conflict classification, and sanitized CLI/help behavior.
- SDK module import and root help command passed. Reviewed source, lockfile changes, documentation, local-secret exclusion, and whitespace. Frontend application and agent/payment source are unchanged; their suites were not rerun for this migration.
- **Live Rabdi verification has not run:** the local signer and access-key fields were still empty at the final configuration-presence check. Offline fake transports/batch models are not reported as chain evidence. No entity, transaction, writer address, or prize qualification was fabricated.

Remaining: configure test wallet/access key and run the opt-in live script; implement wallet proof/redemption, consent, service freeze enforcement, retention renewal/recovery, and artist-facing activation. Host/origin, ENS parent, and Reown setup remain pending. Arkiv expiry is not erasure, application state remains operator-owned, and cross-process signer nonce coordination is not implemented. No payment changes, push, merge, or deployment occurred.

## 14 — Close demo-critical agent trust, payment, and accounting gaps

Date: 6 November 2026 (UTC). Author: configured Git identity `ohana-sysadmin`. AI assistance: Kimi (Moonshot AI).

### Behavior and boundaries

- Based on `origin/main` `8fe84bdf227b636bda69534c939815040c9b6a6f` in a dedicated clone and `fix/demo-agent` branch. No payment source files were edited.
- Bind the HTTP service to `127.0.0.1` by default with configurable `HOST`. Refuse non-loopback startup without `STEWARD_SERVICE_TOKEN`; when configured, require a SHA-256-normalized `timingSafeEqual` bearer check before reading `/ask` bodies or invoking the steward. Require JSON content type, remove wildcard CORS, lock provider/model/tools to server configuration, preserve health/agent-card, and omit budget ceilings and credential-variable names from public metadata.
- Reserve every initial/tool/schema-repair call, enforce a cumulative per-question cap, immediately record each completed call, and retain earlier spend on later refusal/failure. Add fixed per-call meter pricing via `METER_PRICE_PER_CALL_USD` and `provenance.calls[]` for every payment/request ID. Reservations explicitly coordinate only one Budget instance; no cross-process atomicity is claimed. Unknown usage/settlement after an unusable provider response is not invented.
- Replace the fan demo's unconditional mock header with `createPayer()` and the real 402/sign/retry handshake. Live requires distinct `HEDERA_FAN_ACCOUNT_ID`/`HEDERA_FAN_PRIVATE_KEY` and rejects missing/mock credentials without borrowing agent compute credentials. Dev remains explicitly mock. Split output is arithmetic-preview-only and multi-call evidence is not collapsed into a false 1:1 claim.
- Replace real-person/placeholder artist facts with the synthetic `Demo Artist`/`Demo Song` fixture. Use a neutral deterministic smoke prompt and package-local dotenv loading.
- Implement advertised `ZEROG_NETWORK`, `ZEROG_BASE_URL`, `ZEROG_MODEL`, `ZEROG_TRUST_MODE`, and `INFERENCE_TRANSPORT` overrides. Testnet selects `baseUrlTestnet`; the prior model default remains for compatibility and is not represented as live catalog validation.

### Validation

- Clean `npm ci --ignore-scripts`: passed, installing the locked optional x402/Hedera declarations. The install report retained 3 moderate and 1 high dependency advisories; no force-fix or dependency rewrite was attempted.
- `npm test` from `agent/`: **70 passed, 0 failed**, including unauthorized-no-provider-call, allowed bearer, override locking, media-type boundary, loopback/non-loopback behavior, fan/compute credential separation, fixed meter pricing, concurrent in-process reservations, tool/repair cutoffs, failure-path accounting, per-call provenance, and all 0G override paths. No live provider or chain calls occurred.
- `npm run typecheck` from `agent/`: passed with the complete source/test/script program.
- Real loopback server + fake-provider smoke: unauthenticated `/ask` 401, authorized request 200, synthetic agent-card, four calls/four provenance entries/four zero-cost ledger entries. External provider used: false.
- `git diff --check` passed and the changed-path review confirmed no files outside `agent/` and `docs/`, with no `payments/` changes.

### Remaining risks and integration contract

Payments must send `Authorization: Bearer <STEWARD_SERVICE_TOKEN>` when the token is enabled and should forward `provenance.calls` as `proof.upstream.calls`; this branch deliberately leaves that integration to the payments owner. Multiple processes/hosts need an external atomic reservation/ledger protocol. Ambiguous failed-call settlement, unreadable/corrupt ledger recovery, live catalog availability, actual Hedera/0G settlement, on-chain split verification, claims/activation, dependency advisory remediation, and deployment remain unverified or open. No PR, approval, merge, deployment, live provider call, or spend was performed by this entry.
## 15 — Repair the public circle for the frontend demo

Date: 6 November 2026. Author: configured Git identity `ohana-sysadmin`. AI assistance: Taurus `sysadmin 🫡`.

### Behavior and scope

- Based on `design-circle` at `68184677584916941535fdca909e14ada8fe5e31`; changed only frontend code/tests, root/frontend documentation, and the browser-test scripts/dependencies. No `payments/` or `agent/` files changed.
- Replaced overlapping 3D-transformed seat buttons with a 2D desktop ring and normal-flow small-screen layout. Restored native list/button semantics, visible search naming, early DOM/tab order, `aria-pressed`, polite result counts, semantic hiding, and unobstructed CTA targets. Native dialog Escape/close/focus behavior remains intact.
- Added a single combined day/query filter state and complete reset paths. Replaced scalar `day` data with explicit `days` arrays for genuine daily/multi-day and undated artists.
- Replaced claim/every-cent copy with honest local-draft and 3.69% compute-share language. Circle CTAs resolve only an exact public roster slug to a public name, prefill nothing else, and remove the transient query. Unknown/arbitrary URL values are not rendered.
- Added a static 40-name/set no-JS list and project links. Corrected source provenance to disclose the real public biographies/photos imported by PR #2 while preserving maker-rights/license and activation-consent boundaries.
- Documented that the current GitHub Pages deployment does not reproduce the local security headers; no host-header fix or deployment is claimed. See [FRONTEND-DEMO-READINESS.md](FRONTEND-DEMO-READINESS.md).

### Validation

- `npm run test:frontend`: **27 passed, 0 failed**. New self-contained tests cover roster invariants, combined/reset filters, multi-day/undated data, exact slug handoff, native/static HTML, no-JS fallback, and routes.
- Optional pinned Playwright/axe browser suite: **11 passed, 0 failed**. All **120/120 seat centers** hit their own buttons at 1280×800, 375×812, and 320×568; no wrong-seat interception or horizontal overflow. CTA, keyboard/dialog, filter combinations/reset, no-JS, and safe CTA handoff checks passed.
- Twelve axe scans across four public routes × three viewports reported **0 violations** under the configured WCAG 2/2.1/2.2 A/AA rules. Browser listeners reported no page/console/local-request errors.
- Real wallet pairing/extensions, claims, activation, backend/payment integration, deployment, and host-header remediation remain unverified or unimplemented as explicitly listed in the readiness record. No artist was activated.

## 16 — Close the payment facilitator path and prove Arkiv live

Date: 6 November 2026 (UTC). Authors: `ohana-sysadmin` and synthetic test wallets. AI assistance: Taurus `sysadmin 🫡`; source/payment base by the named human contributors.

### Payment and service integration

- `fix/demo-payments@ce5e34c` made challenge requirements canonical, including facilitator `extra.feePayer`, across challenge/verify/settle. An offline contract test runs the real Hedera gate against a mocked facilitator for both resource paths.
- Explicit settlement failure and uncertain/missing-transaction results no longer return paid content/proof or append paid ledger entries. Caller `?payTo=` cannot redirect the configured artist recipient. Compute spending excludes fan revenue; per-call ceilings and distinct compute→meter recipients are enforced. Only `ENOENT` creates an empty ledger; unreadable/malformed/invalid history fails closed. Dev TEE claims are null. The incomplete custom-token script is disabled before any chain action.
- Payments now reads `STEWARD_SERVICE_TOKEN`, authenticates its steward call, ignores attempted caller provider/model/tool selection, and forwards `provenance.calls[]` as `proof.upstream.calls`. Documentation closes R2/R3/R4/R6 and records the remaining distributed-reservation and reconciliation boundaries.

### Real Arkiv evidence and user-facing read

- Dedicated synthetic Rabdi writer `0x8e9d4dEc12bc9Da62daB72304659ef1eE6B200f2`, chain `7794095`, namespace `oso-mumbai-synthetic-8e9d4dec`, invitation `55a4a16c-45c5-4bf4-9853-620a49b1cb26`.
- Issue `0xf5ac4a62b1af1bdc066c46c825e325cd4485d377b951d8c777450e5771b09dd8` (block 301610) and revoke `0x88fa7783995c065bf2088aea99e812bed3391b5d91c98b88aed1448b0b2e4c75` (block 301613) both returned status `0x1`. The live repository test passed write/read/revoke/idempotency/stale-write rejection. Exactly two audit entities exist; public claim count is zero.
- `/arkiv` performs a manual keyless current-entity read with no encryption/access key, ciphertext, or polling. Real browser responses use an array of `{name,type,value}` attributes; the parser validates them strictly and never infers encrypted status. The trusted CLI separately returned `revoked`. Real reads were verified at 375px without overflow, including final integrated block 302024. Exact query and evidence: `arkiv/README.md`.

### Integrated verification

- Clean dependency install completed after moving temporary data/cache off the small root overlay; this was an environment fix, not an application workaround.
- **168/168 tests passed:** payments 55, agent 70, frontend 31, claims 12. Payments and agent typechecks passed. HashPack runtime/license build passed.
- Optional Playwright suite: **11/11 passed**, 120/120 seat centers correct, 12 axe scans with zero violations. Final integrated Arkiv browser read: HTTP/query success at block 302024, one readonly entity, no console errors.
- Still not proven: real Hedera settlement, real 0G inference, HCS, on-chain split, Reown wallet pairing, claims/ENS activation, production hosting. Hedera accounts remained unfunded and 0G credentials were blocked by official CAPTCHA/team-credit provisioning; no mock was substituted for live evidence.
