# Fork the First Artist — growth roadmap

This is the product roadmap **after the narrow Mumbai proof**. It is not a claim that these features exist. The guiding boundary remains: **artist holds value and identity · agent does useful work · OSO takes zero platform cut · consent is revocable · machines are labelled.**

## Stage 0 — prove one narrow demo (current)

Required before calling the project live:

- One synthetic or separately consenting artist.
- One autonomous fan x402 request with a real Hedera transaction and HashScan recipient evidence.
- One real 0G Private Computer answer in the main flow with request/model/provider/`ZG-Res-Key` evidence.
- One user-visible Arkiv write/read (already proven with synthetic invitation state).
- Public static frontend and a small, bounded backend; truthful failure/degraded states.
- Human-narrated 2:40 video and exact old/new/AI attribution.

Do not expand this stage with a second artist, full claiming, ENS issuance, HCS claims, or a custom token.

## Stage 1 — one excellent real artist home

### Artist-owned content

- Verified artist-provided name, bio, avatar, songs, media and social links; source and consent history visible.
- Durable private drafts with explicit preview→publish transition, draft recovery, schema versioning and delete/export.
- Real audio playback (or honest external embeds), useful song metadata, lyrics/chords where licensed, and no invented bio/discography.
- Separate public artist data from operator-only encrypted invitations and from private wallet/consent proofs.

### Fan experience

- Clear artist page, songbook, ask/tip action, network/asset/price, recipient and pending/success/failure state.
- Real explorer receipts and per-call inference provenance; no generic “success” toast.
- A steward that performs artist-specific useful tasks (song discovery, story/context, licensed chords, upcoming sets), not a generic chat wrapper.
- Free fallback content when inference/payment is unavailable; fans are never charged for templates/errors.
- Mobile wallet journey or an explicitly desktop-only label; accessibility, keyboard, reduced motion and low-bandwidth media.

### Operational baseline

- One stable backend host with HTTPS/security headers matching local policy, secrets management, rate limits and a status page.
- Persistent/durable accounting, not filesystem-only ledgers on ephemeral hosting.
- Automated tests in CI, one-command preview build/deploy, rollback, log redaction, backups and restore rehearsal.
- Dependency review/remediation for the current optional Hedera tree advisories; no blind force upgrades.

**Exit criteria:** a real artist can edit/publish safely, a returning fan can play/learn/support, and every success has independently checkable evidence.

## Stage 2 — repeatable, artist-owned onboarding and ENS

1. Steward invite with scoped role, expiry and one-time nonce; do not treat possession of a forwarded link as strong identity.
2. Server-issued Ethereum and Hedera challenges bound to artist, action, origin, payout, invite nonce, chain and expiry.
3. Verify both signatures server-side; reject replay, wrong account/network/chain, stale challenge, mismatched destination and late approval.
4. Atomically consume the invitation and create a pending claim with signed consent, then run activation checks. Never create an active profile from a local `consent:true` flag.
5. Add stronger identity where needed: known-social challenge, in-person verification or multiple vouches. Describe the actual assurance level, not “no impersonators.”
6. Write the claim/audit event to the selected public audit rail; do not confuse HCS spend logs with identity/consent logs.
7. Enforce active/unfrozen/unexpired state in agent, metadata, payment and publishing paths. Freeze/dispute must stop OSO services without rewriting artist ENS or payout authority.
8. Implement ENSv2 issuance only after verifying the full parent/registry/resolver/admin/upgrade chain, artist record isolation, delegated non-payout permissions, expiry/renewal and negative unauthorized-operation tests.
9. Build renewal, key rotation, Arkiv entity renewal, backup/recovery and consent revocation. Expiry is not erasure and non-revocation is not perpetual availability.

**Exit criteria:** a second consenting artist can complete the whole journey without developer intervention, and a disputed/expired claim fails closed everywhere.

## Stage 3 — sustainable payment and compute rails

### Payment correctness

- Prefer reviewed direct-stablecoin atomic splits or a supported multi-recipient mechanism. Do not launch a fan token merely to implement a fee.
- Bind recipients to verified artist state, never a request parameter. Show both recipient balance changes for any claimed split.
- Add idempotency, pending/unknown settlement reconciliation, replay protection and deliberate recovery across payment/inference failures.
- Keep fan revenue, compute allocation, actual compute spend, facilitator/network fees and remaining balances separate.

### Real self-funding (only if pursued)

The 0G prize-level loop is **money in → automatic credit in the agent’s own 0G Compute account → inference paid from that balance**, with no human top-up. A Hedera transfer to a meter operator plus a pre-funded 0G API key does not meet this bar.

- Implement the actual credit/deposit/bridge path or partner with the meter/0G provider; prove credit landing and subsequent debiting.
- Use actual-cost quotes and cross-process reservations for every initial/tool/repair call; persist per-call provenance and reconcile actual charges.
- Apply the arithmetic in [ECONOMICS.md](ECONOMICS.md): one \$0.002 call needs at least \$0.0542 fan revenue at 3.69% before other costs. Bootstrap cannot come from a later-settling share.
- Define unspent compute-allocation policy explicitly with artists/community; no silent retained margin.
- Expose capped/low-balance behavior: cheaper/shorter route, pause, or free template without charging the fan.

**Exit criteria:** the loop survives low balances, concurrent requests and provider failures without inventing revenue, charging for errors, or requiring a manual refill.

## Stage 4 — multi-artist scale and community trust

- Per-artist configuration/namespace/key/budget isolation; no shared consent, profile, payout or ledger state.
- Queue/worker architecture with bounded concurrency and global budgets; idempotent jobs and observable retries.
- Profile/media moderation, license/source display, takedown workflow, consent history, and a deliberate answer to immutable-media risk (default hash/metadata; full media only with explicit opt-in).
- Public artist directory/circle links into real artist homes; no false claim CTAs. Search, localization, discovery and share cards without indexing private/unclaimed drafts.
- Reown/HashPack pairing with atomic runtime/license deployment and origin restrictions; mobile wallet alternatives where appropriate.
- SLOs, alerts, privacy-safe analytics, accessibility regression, restore drills and public incident/takedown contact.

## Decisions that still need humans

- ENS parent controller, registry/resolver authority, renewal and agent delegation model.
- Artist identity-assurance level: steward familiarity, social proof, vouches, in-person, or a combination.
- Unspent 3.69% allocation policy and who pays bootstrap/facilitator/network costs.
- Backend host, durable database/ledger, secret custody, budget limits and incident ownership.
- Which artist media can be stored, embedded, archived or made immutable, and under which license/takedown policy.
- Whether any provider’s Continuity/partner eligibility is accepted by the event dashboard/organizers.

## Measure what matters

- Claim start→verified activation completion and time; failed/abandoned step.
- Publish→first real fan answer/payment success and latency.
- Artist-received amount and percentage; no OSO skim.
- Compute cost per answer, calls per answer, allocation deficit/surplus and free-degradation count.
- Settlement/inference failure, ambiguous receipt and replay counts.
- Returning fans, songs played/discovered and useful artist-specific answers—not raw chat volume.
- Consent revocations/takedowns honored within target time and recovery-test success.

## Immediate after-hackathon order

1. Finish real Hedera + 0G evidence and deploy the narrow slice.
2. Harden hosting/CI/persistent accounting and produce one excellent real artist home.
3. Implement signed claims + activation/freeze + renewal/recovery.
4. Implement artist-controlled ENS issuance.
5. Prove direct stablecoin split and only then attempt automatic 0G credit replenishment.
6. Onboard the second artist before scaling to forty.
