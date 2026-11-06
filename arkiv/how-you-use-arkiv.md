# How this feature uses Arkiv

- `claims/src/arkiv.mjs` defines the schema and performs actual SDK queries/batches. It is used by the production CLI, not an unused dependency.
- `claims/src/steward.mjs` issues/revokes invitations, freezes claims, and reads status. Its state comes from Arkiv. `invite-status` lets a steward determine whether an invitation was revoked or logically expired.
- Schema/namespace/kind/UUID filters locate records; owner/creator filters establish the expected writer. Duplicate, stale, malformed, undecryptable, or expired state rejects the operation.
- Wallet ownership limits writes to the backend signer. The artist's ENS control remains independent. Readonly attributes plus consuming the prior entity are used to reject stale state transitions.
- A state replacement and its encrypted audit entry use one batch. Tests model the all-or-nothing property; the opt-in live script validates it against Rabdi before live guarantees can be claimed.
- Storage lifetime is bounded and separately tracked from invitation expiry. Future service authorization must deny missing/expired claim state. Automatic renewal is not implemented.

User-visible scope is currently the steward CLI. The wallet/draft UI remains separate and unverified; no public profile or artist activation is implied. [Live test instructions and evidence status](README.md).
