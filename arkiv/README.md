# Arkiv migration and Mumbai evidence

Checked 6 November 2026 (Asia/Kolkata). AI assistance: Codex.

Target: **Build on Arkiv (existing projects)**, the $4,000 Continuity category ($3,000 / $1,000). This category accepts a new Arkiv integration into an existing product. Eligibility depends on acceptance into the event's Continuity batch. [Official requirements](https://ethglobal.com/events/mumbai/prizes/arkiv).

Required evidence: real current-testnet writes, a feature reading those entities, public writer addresses and a reproducible query, schema/feedback documentation, and the criterion files linked below. The SDK alone or an unread log is insufficient. The repository must be public/open-source and distinguish prior work and AI assistance. **Synthetic live evidence is now recorded below; final prize qualification still depends on Continuity acceptance, deployment/review of the user-facing viewer, and the complete submission.**

- [schema.md](schema.md): queryable fields, ownership, expiry, encryption.
- [friction.md](friction.md): observed integration friction and pending verification.
- [reach.md](reach.md): intended users and actual evidence gaps.
- [why-arkiv.md](why-arkiv.md): benefits and tradeoffs.
- [how-you-use-arkiv.md](how-you-use-arkiv.md): operational reads/writes.

## Prior versus new work

Prior OSO profile design is adapted from source revision `b6be898f38df8fff7abc53334b5641a89e31939b`, documented in [frontend/SOURCE.md](../frontend/SOURCE.md). PR #3 supplies agent/payment groundwork. Local commit `0017db1` added a PostgreSQL steward prototype during this event; it was not the pre-event production database. Part 13 adds the Arkiv replacement. No prior Arkiv integration is claimed and no real artist data was migrated.

## Reproduce

Follow [claims/README.md](../claims/README.md). The operational read is:

```sh
npm run steward -- invite-status --invite UUID
```

It queries the configured writer/namespace on Rabdi, authenticates/decrypts the record, and returns current invitation status. Use a real ID from the live verification output. Without the encryption key, public queries can inspect metadata/ciphertext but cannot read private records. The owner address can be obtained safely with `npm run steward -- check`.

Equivalent public query, replacing OWNER, NAMESPACE, and UUID with the recorded evidence values:

```text
arkiv.schema = str('oso.claims.v1') AND $owner = addr(OWNER) AND $creator = addr(OWNER) AND namespace = str('NAMESPACE') AND kind = str('invite') AND id = str('UUID')
```

Read it through `arkiv_query` on the documented Rabdi RPC. `claims/src/arkiv.mjs` also builds this query with the SDK rather than interpolating user input.

## Verified synthetic live evidence — 6 Nov 2026, 18:05–18:19 UTC

- Network: **Rabdi testnet**, chain `7794095`; schema `oso.claims.v1`; namespace `oso-mumbai-synthetic-8e9d4dec`.
- Writer: **`0x8e9d4dEc12bc9Da62daB72304659ef1eE6B200f2`** (dedicated throwaway test writer).
- Synthetic invite: **`55a4a16c-45c5-4bf4-9853-620a49b1cb26`**; current readonly entity **`0x11b5bb0e5e2771ab7363d506ea2334a336f42ad3271bb22a32aabdda170fa267`**.
- [Issue transaction `0xf5ac4a…09dd8`](https://rabdi.explorer.arkiv.network/tx/0xf5ac4a62b1af1bdc066c46c825e325cd4485d377b951d8c777450e5771b09dd8): success `0x1`, block `301610`.
- [Revoke transaction `0x88fa77…4c75`](https://rabdi.explorer.arkiv.network/tx/0x88fa7783995c065bf2088aea99e812bed3391b5d91c98b88aed1448b0b2e4c75): success `0x1`, block `301613`.
- `npm run steward -- check` and `npm run test:claims:arkiv` passed: **write, read, revoke, idempotency, stale-batch rejection**. The operational decrypted read returned `state: revoked`.
- Exactly **two audit entities** exist (issue + revoke). Idempotent retry and rejected stale batch created no transaction/audit entity. Public `kind = claim` count is **zero**.
- A real Chromium page at `https://artist.opensourceorchestra.org` successfully ran the keyless `arkiv_query` cross-origin: HTTP 200, one matching entity, safe metadata only. No browser encryption/access key or ciphertext was used.

The [`/arkiv` viewer](../frontend/public/arkiv.html) performs that current public query on demand and links the successful transactions. It deliberately does **not** infer the encrypted `revoked` label from public metadata; that label is established by the trusted CLI. This is synthetic proof, not artist activation.

Exact public query:

```text
arkiv.schema = str('oso.claims.v1') AND $owner = addr(0x8e9d4dEc12bc9Da62daB72304659ef1eE6B200f2) AND $creator = addr(0x8e9d4dEc12bc9Da62daB72304659ef1eE6B200f2) AND namespace = str('oso-mumbai-synthetic-8e9d4dec') AND kind = str('invite') AND id = str('55a4a16c-45c5-4bf4-9853-620a49b1cb26')
```

RPC: `https://rpc.rabdi.db-chain.testnet.arkiv.network`, method `arkiv_query`. Use the safe projection in [`arkiv-query.mjs`](../frontend/public/arkiv-query.mjs); limit `0x2`. The keyless endpoint is rate-limited, so the viewer queries only on a manual click and never substitutes cached success.

Full verification boundaries and public entity/audit identifiers are in `/shared/ethglobal-mumbai-2026/ARKIV-LIVE-PROOF.md` (team evidence archive). No secrets or ciphertext are included there.

**Still pending:** public deployment/review of the viewer, real two-wallet claim redemption, artist activation, HCS/ENS binding, and final Continuity/dashboard acceptance. Arkiv is one of the recommended three partners (Hedera + 0G + Arkiv); no dashboard selection was changed by this work. Swarm is not integrated or targeted.
