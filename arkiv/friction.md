# Arkiv integration feedback

## Live verification update — 6 Nov 2026, 18:05–18:19 UTC

The official Hub SIWE + CAPTCHA flow supplied 10 tGLM and a Rabdi access key. The repository's synthetic write/read/revoke/idempotency/stale-write test passed on chain 7794095; public RPC independently confirmed both transaction receipts and the current readonly entity. Browser `arkiv_query` also worked cross-origin without an access key. The keyless endpoint is rate-limited, so the user-facing viewer uses a manual read rather than polling. Public metadata cannot expose encrypted operational status; a trusted backend or deliberately public non-sensitive status attribute is needed for a human-readable `revoked` label. Never ship the encryption key to the browser.

A separate public audit query found exactly two audit entities (issue/revoke), so the rejected stale batch and idempotent revoke created no additional audit entity. Exact evidence and reproduction are in [README](README.md).

## Earlier local implementation observations

Observed during local implementation on 6 November 2026:

- Arkiv needs an explicit redesign of SQL assumptions: no row locks or unique application IDs are used here. We consume a prior immutable entity in an atomic replacement batch. The docs describe missing-entity rejection, but the concurrency guarantee still needs the supplied live stale-write test.
- Public storage means our private steward/claim records require application encryption. Queryable indexes therefore contain only namespace, kind, and opaque IDs. Names, dispute reasons, and wallet bindings are not public indexes.
- Expiry changes failure semantics. A missing claim cannot be interpreted as fresh/unclaimed state. Renewal and backup operations remain operational work.
- Schema queries skip mismatches by default in SDK 1.0.1. Authorization-sensitive reads explicitly use onMismatch: throw and reject duplicate records. This default is easy to miss when porting SQL code.
- The SDK documents inclusion-based write results. An RPC/receipt failure may leave a broadcast transaction unresolved; our CLI returns an uncertain-write warning, not a rollback claim. Structured retry/reconciliation examples would help backend migrations.

Local npm lookup initially failed due to this workspace's network sandbox; an approved retry succeeded. That is not reported as an Arkiv defect. SDK 1.0.1 and viem 2.57.16 installed and imported successfully; registry installation reported zero known vulnerabilities at that time. Live verification later succeeded as documented above; no network latency benchmark is claimed.

Reproduction commands and eventual live evidence: [README](README.md). No feedback was sent externally.
