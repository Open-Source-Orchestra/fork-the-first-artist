# 🎻 Fork the First Artist
*ETHGlobal Mumbai 2026 · Open Source Orchestra · Continuity project*

**Product goal:** give each consenting musician an **ENS name**, an **x402 payment rail on Hedera**, and an **AI steward using 0G Private Computer**. Fans pay the artist directly; the intended **96.31% / 3.69%** split assigns a small share toward agent compute. **OSO takes zero cut, zero profit, no token.**

- 🌺 Public preview: https://artist.opensourceorchestra.org/
- 📋 Status: https://opensourceorchestra.org/ethglobalmumbai/
- 🎬 [Video script](docs/DEMO-SCRIPT.md) · [Submission draft/checklist](docs/SUBMISSION.md)
- 🔗 [Hedera transaction proof](docs/TX-PROOF.md) · [Arkiv evidence](arkiv/README.md)
- 📄 [Product target](docs/PLAN.md) · [Prize strategy](docs/PRIZE-STRATEGY.md)
- 🧾 [Implementation history](docs/IMPLEMENTATION-LOG.md) · [Payment/agent review](docs/PR-3-REVIEW.md)
- ✅ [Frontend demo-readiness evidence](docs/FRONTEND-DEMO-READINESS.md)

## Current reality — read before demoing

The repository contains a static artist preview, a transient local draft editor, wallet connection adapters, offline-tested payment/agent/Arkiv scaffolding, and integration documentation. **A mock ID, split preview, fixture, or offline test is not chain/provider evidence.**

| Layer | Current boundary |
|---|---|
| Frontend | 40 public artist previews + local draft; no public claim, paid chat, or publishing |
| Hedera x402 | Live-mode code exists; see [TX-PROOF](docs/TX-PROOF.md) for actual settled IDs |
| 96.31/3.69 | Exact arithmetic exists; only an HTS transaction proves the on-chain split |
| 0G | Provider/meter code exists; only a real response/request ID proves inference |
| Arkiv | Real synthetic Rabdi write/read evidence + `/arkiv` viewer; no real artist claim |
| Claims | Wallet-proof redemption, consent activation and service-freeze enforcement remain pending |
| ENS | Ownership requirements only; no issuer implementation or artist subname claimed |

The checked-in artist JSON is a **demo fixture**, not verified biographical, song, ENS, payout, or consent evidence. Do not activate a real artist from it.

## Run the local preview

Requires Node **22.18+** (Node 24 also works).

```sh
npm run install:all
npm test
npm run dev:frontend
# open http://127.0.0.1:4173
```

Browse 40 public artist previews, visit `/home` for the sample OSO profile, open `/draft` for a transient local draft, or read `/arkiv` for the live synthetic Rabdi proof. Public roster/photos are not activation consent. Drafts are not saved or published; claim and payment integration are not active. HashPack additionally requires the generated runtime and a public Reown project ID. See [frontend/README.md](frontend/README.md) for unit/route tests, the optional browser/axe audit, scope, and attribution.

For the two-service dev demo and the credentialed Hedera/0G path, follow [docs/RUNBOOK.md](docs/RUNBOOK.md). Dev mode deliberately returns `mock-…`, `dev-…`, and `[dev-mock inference]` values. Live mode requires separate fan, artist, compute, and meter-operator accounts and must never silently substitute the mock fan header.

## Architecture

```text
fan agent ── HTTP 402 / X-PAYMENT ──► payments /ask ──► artist payout
                                          │
                                          ▼
                                    artist steward
                                          │ capped per-call x402 meter
                                          ▼
                                  0G Private Computer

Arkiv: encrypted, expiring invitation/service state + explicit reads
HCS: spend audit when configured; claim logging is a separate unfinished flow
ENS: artist-controlled identity target; not implemented by this scaffold
```

| Folder | Contents |
|---|---|
| `payments/` | x402 resource server, inference meter, exact split arithmetic, HTS/HCS live adapters |
| `agent/` | steward, fenced artist data, provider adapters, autonomous payer, budgets and demo client |
| `frontend/` | static artist preview, local draft editor, wallet connection adapters |
| `claims/` + `arkiv/` | encrypted Arkiv steward CLI, schema and judging evidence |
| `ens/` | ownership/permission acceptance criteria; no issuer yet |
| `docs/` | setup, implementation history, review, proof and submission materials |

## Continuity and AI attribution

This extends Open Source Orchestra / OSO P.I.T. The adapted frontend source is pinned to `shakaleikaumaka/oso-storytelling@b6be898f38df8fff7abc53334b5641a89e31939b`; exact reused paths and licenses are in [frontend/SOURCE.md](frontend/SOURCE.md) and its third-party notices. New Mumbai work is recorded incrementally in git, [IMPLEMENTATION-LOG](docs/IMPLEMENTATION-LOG.md), and [build-log](docs/build-log/). Prior 0G/Hedera integration evidence is not claimed.

AI assisted implementation, review, tests and documentation as disclosed in those files and commit messages. Human contributors supplied product/consent decisions, integration review, live account operation and the narrated demo. Include this attribution and the planning artifacts in the ETHGlobal submission.

## Team

- **Shaka** — artist + product/demo lead.
- **Prince Keshri** — frontend, wallets, claims/Arkiv.
- **Rajarshi Roy** — payments, agent and Hedera integration.
- Additional accepted contributors must be listed with their actual contribution and Telegram/X contact in [SUBMISSION.md](docs/SUBMISSION.md); AI agents are not human teammates.

## Contribution and safety rules

Branch → pull request → required human/code-owner review → merge. No direct pushes to `main`.

Nothing goes live for an artist without consent and verified activation. The artist's key is never a backend credential; payout destinations are server-bound to verified configuration. Hedera/Arkiv demo setup is testnet-only. ENS deployment/spend needs separate review. Never commit `.env`, keys, bearer tokens, pairing URIs, ledgers containing private data, or seed phrases.
