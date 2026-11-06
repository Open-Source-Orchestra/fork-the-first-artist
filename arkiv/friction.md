# Arkiv integration feedback

Observed during local implementation on 6 November 2026:

- Arkiv needs an explicit redesign of SQL assumptions: no row locks or unique application IDs are used here. We consume a prior immutable entity in an atomic replacement batch. The docs describe missing-entity rejection, but the concurrency guarantee still needs the supplied live stale-write test.
- Public storage means our private steward/claim records require application encryption. Queryable indexes therefore contain only namespace, kind, and opaque IDs. Names, dispute reasons, and wallet bindings are not public indexes.
- Expiry changes failure semantics. A missing claim cannot be interpreted as fresh/unclaimed state. Renewal and backup operations remain operational work.
- Schema queries skip mismatches by default in SDK 1.0.1. Authorization-sensitive reads explicitly use onMismatch: throw and reject duplicate records. This default is easy to miss when porting SQL code.
- The SDK documents inclusion-based write results. An RPC/receipt failure may leave a broadcast transaction unresolved; our CLI returns an uncertain-write warning, not a rollback claim. Structured retry/reconciliation examples would help backend migrations.

Local npm lookup initially failed due to this workspace's network sandbox; an approved retry succeeded. That is not reported as an Arkiv defect. No live RPC failure, network latency benchmark, or successful testnet write is claimed yet. SDK 1.0.1 and viem 2.57.16 install and import successfully; registry installation reported zero known vulnerabilities at that time.

Reproduction commands and eventual live evidence: [README](README.md). No feedback was sent externally.
