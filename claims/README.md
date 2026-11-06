# Steward operations and claim persistence

Part 12 implements the owner-approved Node/PostgreSQL steward CLI. There is no public administration endpoint. It issues expiring invitations, revokes unused invitations, records service freezes, and reads claim status. Wallet verification, invitation redemption, the public claim API, HCS logging, and activation are not implemented here.

**A freeze currently records database state only. Existing agent/payment services do not yet consult it.** Future service authorization must reject frozen or non-active claims before performing work. A freeze must never alter ENS ownership, ENS records, or the verified Hedera payout account. This package makes no chain calls.

## Setup and commands

Use Node 22.18+ and PostgreSQL (integration-tested with PostgreSQL 18.6). From the repository root:

```sh
npm --prefix claims ci --ignore-scripts
cp claims/.env.example claims/.env
```

Configure `DATABASE_URL` in the ignored file or the host's secret store. Create a dedicated application database and operator role first. No database, role, default password, remote host, or production service is provisioned by these commands. Percent-encode special characters in URL credentials. URLs require a host, user, and database name; query parameters/fragments are rejected. Loopback connections use PostgreSQL authentication without TLS; remote connections require certificate-verified TLS. A private CA can be supplied through Node's `NODE_EXTRA_CA_CERTS`; do not disable verification.

```sh
npm run steward -- migrate
npm run steward -- invite --artist "Demo artist" --actor "Steward label" --ttl-hours 24
npm run steward -- revoke-invite --invite UUID --actor "Steward label" --reason "Invitation withdrawn"
npm run steward -- freeze --claim UUID --actor "Steward label" --reason "Claim disputed"
npm run steward -- status --claim UUID
```

Replace `UUID` with an existing record ID. There is deliberately no CLI command to create a verified claim, activate an artist, change a payout, or bypass signatures. The freeze/status commands become useful once verified claims exist. `--help` works without a database.

The operator's host access and database credentials authorize these commands. `--actor` is a human-readable audit label, **not proof of a steward's identity**. Restrict credentials and shell access to trusted operators. Use a dedicated migration owner; a runtime steward role needs schema USAGE, SELECT/INSERT on invites, UPDATE on invites.revoked_at, SELECT on claims, UPDATE on claims.frozen_at/frozen_by/freeze_reason, INSERT on audit_events, and USAGE on its identity sequence. Do not give the future public service migration ownership or steward privileges. Role provisioning depends on the chosen host and is not automated yet.

## Invitation and freeze behavior

- Invitation output contains a fresh 256-bit bearer token, ID, and expiry. Treat stdout as private: do not run issuance in publicly logged CI or paste its output into an issue. Deliver the token privately to the intended artist. Delivery/link generation is not automated.
- The database stores only SHA-256(token), never the raw token. Tokens are returned only after the invite and audit event commit. Lifetime defaults to 24 hours and can be 1–72 hours. If output is lost, revoke that invite and issue another; the token cannot be recovered from storage.
- Revocation locks the invitation row and checks for an existing claim. Repeated revocation is a no-op; an already claimed invite must use a service freeze instead. Future redemption must lock this same row, check revocation/expiry, verify both wallet proofs and consent, and insert the claim atomically. The unique invite-to-claim constraint prevents duplicate claim rows; it does not implement proof verification.
- Freezing changes only freeze metadata. Concurrent calls produce one change and one audit event; later calls preserve the original reason. Audit insertion failure rolls back the change. ENS authority, payout, and activation fields stay intact. No unfreeze policy or command has been selected.
- Audit events are private database records, not tamper-evident HCS receipts. Database owners can alter them. Avoid sensitive personal details in actor/reason fields.

Claims reserve separate fields for Ethereum owner and native Hedera testnet account. These fields are not populated by wallet connection or by arbitrary CLI input. `verified_at` must be supplied by the future verification transaction; `activation_state` starts pending. Account-key verification, consent snapshots, profile storage, challenge state, ENS provisioning, and recoverable external activation will need subsequent migrations.

## Migrations and failures

`migrate` applies `schema/001_steward.sql` transactionally under a PostgreSQL advisory lock. Concurrent calls apply it once. A checksum mismatch fails rather than silently changing an applied migration. Add a new migration for subsequent schema changes; the runner currently supports version 001 only.

Queries use parameters for operator input and a 10-second statement timeout. Connection attempts time out after five seconds. CLI failures return nonzero status and sanitized messages without connection URLs or database error contents. Inspect restricted database logs when diagnosing infrastructure failures. Transactions commit state and audit together using one checked-out client, following [node-postgres transaction guidance](https://node-postgres.com/features/transactions). Revocation serialization uses [PostgreSQL row locking](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS).

## Verification

```sh
npm run test:claims
npm run test:claims:local
```

The first command runs configuration/input tests without PostgreSQL. The second initializes a fresh private temporary cluster, chooses a loopback TCP port, uses a random SCRAM password, runs real database tests, and stops the cluster. It never opens the host's default cluster. Test files remain in the private OS temporary directory for diagnosis; no production data is used. By default binaries are read from `/opt/homebrew/opt/postgresql@18/bin`; set `PG_BIN` to the PostgreSQL bin directory on other installations. Run as a non-root OS user. Abrupt process termination such as SIGKILL cannot execute cleanup.

Alternatively, set `TEST_DATABASE_URL` to a dedicated empty test database and run `npm --prefix claims run test:integration`. The suite refuses an existing `artist_claims` schema and does not reset it. Tests create fixtures, including synthetic verified claims, inside that test database only.

Nine tests cover configuration, invalid input, concurrent migrations/checksum drift, hashed tokens and parameterized input, concurrent freezes, audit rollback, schema constraints, revocation, and CLI behavior. These tests do not establish wallet verification or enforcement in other services. The aggregate root test command includes only the three database-free tests; real PostgreSQL tests are explicit.

On the development machine, PostgreSQL 18 was installed through Homebrew with approval. Homebrew initialized its normal default cluster, but no background/startup service was enabled or started by this work. Verification used the isolated temporary cluster above. No production database or backend host is configured.
