# Steward operations on Arkiv

Part 13 replaces the PostgreSQL package from commit `0017db1` with Arkiv Rabdi (chain **7794095**). The server-side CLI still issues/revokes invitations, records service freezes, and reads claim status. `invite-status` reads encrypted authoritative state from Arkiv. There is no public admin endpoint, PostgreSQL runtime, SQL migration, or fallback local database.

**Freeze enforcement in agent/payment services and wallet-proof redemption remain unimplemented.** A freeze changes OSO service metadata only. ENS ownership and the Hedera payout account are independent and are never changed by this package. Connection to MetaMask/HashPack is not claim verification.

## Setup

Use Node 22.18+. From the repository root:

```sh
npm --prefix claims ci --ignore-scripts
```

Configure an ignored `claims/.env` using `.env.example`. If it does not exist, copy the example first; never overwrite a configured file. It needs:

- `ARKIV_PRIVATE_KEY`: a dedicated server-side Rabdi test account with tGLM. Never use the artist's wallet or a mainnet treasury.
- `ARKIV_ACCESS_KEY`: obtain from [Arkiv Hub](https://hub.arkiv.network/access-keys). This stays server-side; the SDK includes it in the RPC URL.
- `ARKIV_ENCRYPTION_KEY`: an independent random 32-byte secret, encoded as 64 hex characters. Back it up securely; changing or losing it makes old records unreadable. The development setup generated this locally in the ignored file, without printing it.
- `ARKIV_NAMESPACE`: a stable, unique lowercase identifier per environment, default example `oso-mumbai-demo`. Changing namespace or writer switches the visible record set.
- `ARKIV_RETENTION_DAYS`: 4–180, default 30. Storage expiry is distinct from invitation validity. Budget and renewal policy still need deployment configuration.

Keep `.env` readable only by the backend operator. Do not enable `DEBUG`; the CLI rejects it to avoid verbose SDK diagnostics. Do not expose this file through the frontend. Keys have no checked-in defaults. The RPC host is fixed to the approved Rabdi testnet; commands validate chain ID and recent block time before data operations.

```sh
npm run steward -- check
npm run steward -- invite --artist "Demo artist" --actor "Steward label" --ttl-hours 24
npm run steward -- invite-status --invite UUID
npm run steward -- revoke-invite --invite UUID --actor "Steward label" --reason "Invitation withdrawn"
npm run steward -- freeze --claim UUID --actor "Steward label" --reason "Claim disputed"
npm run steward -- status --claim UUID
```

`check` reads the chain and reports public writer/namespace/block information. Other mutation commands spend test GLM. `--help` needs no credentials. `migrate` is removed: Arkiv schemas describe typed entities rather than provisioning SQL tables. There is no command to forge a verified claim, activate an artist, or change payout identity.

The invitation response contains the raw bearer token once, only after a confirmed SDK write. Deliver it privately; do not capture that output in public CI logs. Only SHA-256(token) is stored, inside encrypted data. A token is valid for 1–72 hours, default 24, regardless of how long the entity is retained. Losing output requires inspecting/revoking the invitation by its ID and issuing another; tokens cannot be recovered from storage.

## Storage and concurrency

`@arkiv-network/sdk` 1.0.1 and viem 2.57.16 are pinned. The schema and privacy details are in [arkiv/schema.md](../arkiv/schema.md).

Each state entity is created with immutable attributes (`readonly`). A transition creates its replacement and an encrypted audit event and deletes the exact prior entity key in one atomic batch. Per Arkiv's documented all-or-nothing batches and rejection of operations on missing entities, two writers attempting to consume the same prior entity cannot both commit. A stale contender fails; it must read again before deciding whether anything remains to do. This is not an SQL transaction or a distributed lock. Local tests model these semantics; the live script explicitly checks stale-entity rejection on Rabdi.

Reads filter schema, namespace, kind, UUID, owner, and creator. They reject duplicate matches, invalid schema, a stale query block, non-readonly entities, expired entities, and failed authentication. Absence never means an artist is active or an invite is unused. The SDK has an in-process nonce manager; run one backend signer process. Do not use the same signer concurrently from separate CLI processes/hosts: competing Ethereum nonces can produce failed/replaced transactions. Entity consumption protects record transitions, not nonce allocation across processes.

A state mutation and its audit share one transaction. Failed or uncertain writes return no success/token. Errors include only safe record IDs and a transaction hash when available. A timeout is **not proof of rollback**: inspect the transaction and read state before retrying. There is no blind retry of state-changing calls. RPC transport timeouts are 15 seconds; receipt waiting uses the SDK behavior. A receipt establishes inclusion, not an irreversible finality guarantee.

Authorization is possession of the server signer and host access. `--actor` is an audit label, not a verified steward identity. The writer can delete its entities and controls encryption; this is operator-controlled application storage, not artist-owned ENS authority or an immutable audit ledger. The read path also trusts the configured RPC's chain view.

## Privacy and retention

Arkiv is public. Names, steward labels, reasons, token hashes, and wallet bindings are AES-256-GCM encrypted with random nonces. Authentication binds ciphertext to chain, schema, owner, namespace, kind, and UUID. Public metadata still reveals the writer, record kinds/IDs, transaction timing, ciphertext size, and expiry. Raw invitation tokens, wallet signatures, and signing/encryption keys are never sent to Arkiv.

Entities expire in blocks. Deleted/expired content may remain in transaction history or independent copies; expiry is not a promise of erasure. This change adds no public artist profile or new publication consent. [Arkiv docs](https://docs.arkiv.network/writing/expiration/) explain lifetime and extension behavior.

There is no automatic renewal yet. Monitor expiry and implement reviewed renewal before depending on long-lived claims. Missing/expired claim state must suspend OSO access; it must never resurrect an invitation or alter ENS/payout ownership. Future redemption must consume the same invitation entity in its atomic batch, verify both wallets and consent, and create the claim there. Do not implement redemption as a query followed by an independent create.

## Migration boundary

The previous PostgreSQL implementation was exercised only in temporary synthetic databases; no production database or real claims were configured by this work. This is a **code/backend replacement**, not a claimed transfer of existing user data. SQL files, pg dependency, and PostgreSQL test harness are removed; commit `0017db1` preserves them. Existing Homebrew binaries/default cluster and private test directories are untouched. No destructive database command was run.

If someone populated PostgreSQL independently, stop before cutover: export privately, validate consent and identity, encrypt/import with stable IDs, reconcile counts/state/audit, and review a rollback plan. No automatic export/import tool is included because there is no known production dataset to migrate.

## Tests and live evidence

```sh
npm run test:claims
npm run test:claims:arkiv
```

The first command is offline: crypto/config/domain tests, a model of atomic batch behavior, and a real-SDK query over a fake transport. It does not prove network behavior. The second is an explicit live script that spends tGLM, issues/reads/revokes an encrypted synthetic invitation, verifies idempotency and stale-batch rejection, and prints only public evidence. The fixture expires after roughly four days; it never creates an artist claim or activation. On partial failure, inspect chain state before repeating.

Live verification status and real writer/transaction/entity evidence belong in [arkiv/README.md](../arkiv/README.md). Do not replace missing evidence with fabricated hashes or call prize qualification complete from offline tests.
