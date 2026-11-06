# ENS — artist names

Planned: ENSv2 on Ethereum mainnet, approved by the owner on 6 November 2026 for the integration design. This directory has no implementation yet.

## Confirmed ownership requirement

Artists control their records. OSO must not be able to revoke or reassign their subnames. Any agent authority is limited to explicitly delegated non-payout records. A disputed-claim freeze affects OSO-hosted services, not ENS ownership or payout records.

`osoartist.eth` was subsequently reported as the intended parent, but this repository has not verified its controller, registry path, issuance method, or suitability. Do not label a name as non-revocable before verification. Transferability, expiry/renewal policy, wallet adapters, and exact agent permissions remain unspecified. ENS implementation is deferred behind the core Hedera/0G/Arkiv demo.

## Acceptance criteria before issuance

- Verify the claim and explicit artist consent; bind both ENS authority and the Hedera payout destination to verified proofs.
- Inspect the deployed registry implementations and authority along the full parent chain. Root-scoped permissions, their administrators, pointer changes, and upgrades must not give OSO an indirect revocation/reassignment route. Do not trust an arbitrary contract's `isEmancipated()` result by itself.
- Verify artist control and record isolation in the resolver. No shared record bundle or default may redirect another artist's payout. Agent grants must not permit payout changes, relinking, upgrades, or privilege escalation.
- Document expiry, renewal rights, parent expiry effects, and who can renew. Non-revocation does not imply a perpetual name; do not choose an expiry policy silently.
- Demonstrate artist-authorized updates and rejected OSO/agent unauthorized operations, including indirect admin routes. Verify actual resolution for the approved payout, profile URL, and agent URL.
- Prepare exact deployment/registration actions and estimated gas for review. Approval of the design does not execute those actions. No transactions have been sent.

ENSv2's registry permissions and emancipation depend on implementation and hierarchy; its resolver supports permissioned record bundles. These criteria are our interpretation of the owner requirement applied to the official [registry](https://docs.ens.domains/ensv2/permissioned-registry/), [hierarchy](https://docs.ens.domains/ensv2/registry-hierarchy/), and [resolver](https://docs.ens.domains/ensv2/permissioned-resolver/) documentation, checked 6 November 2026.

See [prize strategy](../docs/PRIZE-STRATEGY.md) and [implementation workflow](../docs/IMPLEMENTATION-WORKFLOW.md). AI assistance: Codex.
