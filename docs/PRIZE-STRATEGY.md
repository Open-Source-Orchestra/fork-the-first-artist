# Mumbai prize strategy and architecture decisions

Checked 6 November 2026 (Asia/Kolkata). AI assistance: Codex.

## Confirmed owner decisions

- Design ENS integration for Ethereum mainnet. This is design authorization, not permission to deploy, buy a name, or spend gas. Prepare concrete transactions and estimated costs before deployment review.
- Keep Hedera payments on testnet. MetaMask + HashPack and a persistent Node backend are approved; Arkiv replaces the initial PostgreSQL prototype at the owner’s request. The parent `osoartist.eth` was subsequently reported secured, but its controller/permissions and issuance path still require verification. Backend host/domain and a Reown project ID remain unconfigured.
- The owner reports no prior 0G or Hedera integration evidence. Do not describe OSO's existing frontend as evidence of either integration.
- Adapt `oso-storytelling/nodes/shaka` into this repository's `frontend/` with source attribution; do not alter the source design. During the later demo-readiness request, only the separate `ethglobalmumbai/` status page was updated to describe actual evidence and prize focus.
- Use PR #3 as the local implementation base without merging. Payments remain teammate-owned; review and report their defects.

## Prize selection

Amounts below are category pools, not guaranteed awards. Partner eligibility for Continuity submissions must be checked against the dashboard or confirmed with organizers where the public rules do not settle it.

| Category | Requirements that drive the build | Decision |
|---|---|---|
| Arkiv: Build on Arkiv (existing projects) — $4,000, Continuity | New functional Arkiv integration with live read/write evidence and required judging documents | Owner-selected migration; live evidence and Continuity batch acceptance remain unverified; see [Arkiv evidence](../arkiv/README.md) |
| ENS: Existing Project Integration — $3,000, Continuity | Meaningful ENSv2 on Ethereum mainnet, functional live demo, public source | Design target; requires an approved parent and ownership model |
| ENS: Best Use — $7,000 | ENSv2 on mainnet or Sepolia, central functionality | Secondary only if Continuity eligibility is confirmed |
| Hedera: AI Agents That Pay — $6,500 | Autonomous x402 settlement on testnet/mainnet, real transaction ID, HashScan evidence, video at most five minutes | Strong product fit; Continuity category eligibility still needs confirmation |
| Hedera: Built on Hedera — $1,500, Continuity | Significant new functionality, prior/new separation | Unconfirmed: description says existing Hedera project; qualification also mentions previous hackathon projects. No prior integration evidence is available |
| 0G: Private Computer — $5,000 | Inference in the core experience, request IDs, useful live app, video under three minutes; generic chat wrappers excluded | Technical target, pending Continuity eligibility |
| 0G: Keep Building — $3,000, Continuity | Existing 0G project, dated baseline/changelog, new 0G evidence | Excluded from current targets: owner reports no prior integration |
| 0G: Agents That Pay for Themselves — $2,000 | Earnings automatically reach actual compute credit and fund inference; transaction/request evidence, spend cap, low-fund behavior | Stretch only; PR #3 does not establish this funding loop. Token launch is optional |

**Recommended three-partner focus:** Hedera + 0G + Arkiv. Defer ENS unless a functional implementation and live evidence arrive before the proof freeze. This is a technical recommendation; Continuity acceptance and final dashboard selections still require human confirmation. No submission choices have been changed by this document.

Sources: [Arkiv prizes](https://ethglobal.com/events/mumbai/prizes/arkiv), [ENS prizes](https://ethglobal.com/events/mumbai/prizes/ens), [Hedera prizes](https://ethglobal.com/events/mumbai/prizes/hedera), [0G prizes](https://ethglobal.com/events/mumbai/prizes/0g), [pre-existing work rules](https://ethglobal.com/rules).

## Ownership boundary — owner decision recorded 6 November 2026

Separate the artist's ENS authority, verified Hedera payout account, and capped autonomous payer. Artist onboarding signatures must not become a requirement to approve every agent payment. Never use the artist's private key as a backend credential.

Confirmed: artists control their records; OSO must not be able to revoke or reassign their subnames. Any agent delegation must be limited to specific non-payout records; exact grants remain to be specified. Application-level freezing may suspend OSO-hosted services, but must not revoke, transfer, redirect, or rewrite an artist’s ENS name.

This is an implementation requirement, not an onchain guarantee already achieved. `osoartist.eth` is only a reported parent; control and suitability are not yet verified. Verify the full registry chain, effective/admin permissions, upgrades, resolver isolation, and expiry/renewal before issuance. Do not equate non-revocation with perpetual availability. See [ENS acceptance criteria](../ens/README.md).

ENSv2 has separate registry and resolver permissions; an owner address alone does not describe every effective authority. References: [Permissioned Registry](https://docs.ens.domains/ensv2/permissioned-registry/), [Permissioned Resolver](https://docs.ens.domains/ensv2/permissioned-resolver/).

## Evidence and implementation sequence

1. Preserve the OSO import revision, notices, and exact reused paths. Record subsequent changes in numbered commits.
2. Build the local frontend foundation independently of wallet and hosting decisions. Use sample content until an artist's consent and claim are verified.
3. Settle the parent, revocation/renewal model, wallet proofs, deployment/authentication, and durable storage before implementing dependent flows.
4. Implement and verify consent/claim activation, ENS resolution, actual inference, and the teammate's payment contract. Clearly distinguish planned behavior from demonstrated behavior.
5. Capture genuine transactions, request IDs, before/after history, and a short demo. Disclose pre-existing work in the submission and to ETHGlobal as required; no disclosure has been sent by this agent.

Current evidence is local code/tests and source inspection, not live chain or provider execution. Existing OSO/OSO P.I.T. references are project context; they do not establish prior sponsor integration or confirmed prize eligibility.
