# Arkiv migration and Mumbai evidence

Checked 6 November 2026 (Asia/Kolkata). AI assistance: Codex.

Target: **Build on Arkiv (existing projects)**, the $4,000 Continuity category ($3,000 / $1,000). This category accepts a new Arkiv integration into an existing product. Eligibility depends on acceptance into the event's Continuity batch. [Official requirements](https://ethglobal.com/events/mumbai/prizes/arkiv).

Required evidence: real current-testnet writes, a feature reading those entities, public writer addresses and a reproducible query, schema/feedback documentation, and the criterion files linked below. The SDK alone or an unread log is insufficient. The repository must be public/open-source and distinguish prior work and AI assistance. Qualification is **not yet demonstrated**.

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

## Evidence status

- Writer address: **pending local signer configuration and successful check**.
- Entity key and issue/revoke transaction hashes: **pending live verification**.
- Read/status demo: **offline tests pass; live run pending**.
- Artist-facing claim UI/HCS/ENS activation: **not implemented by this migration**.

Run `npm run test:claims:arkiv` after local configuration. It writes synthetic encrypted invitations, checks read/revocation and stale-batch rejection, and emits public evidence without bearer tokens. Record real output here only after success. Do not submit this checklist as proof of completed qualification.

Arkiv adds a fourth possible partner alongside ENS, Hedera, and 0G. The final three-partner selection remains to be decided; no dashboard selection was changed. Swarm is not integrated or targeted by this change.
