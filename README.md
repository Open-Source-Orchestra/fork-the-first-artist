# 🎻 Fork the First Artist
*ETHGlobal Mumbai 2026 · Open Source Orchestra*

Any musician makes a profile and gets an **ENS name**, an **x402 payment rail on Hedera**, and their own **AI steward agent on 0G**. The agent takes payments; the money goes straight to the artist. **3.69%** pays the agent's own compute. **OSO takes zero cut, zero profit, no token.**

- 📋 Plan + live status: https://opensourceorchestra.org/ethglobalmumbai/
- 📄 Full plan: [docs/PLAN.md](docs/PLAN.md)
- Numbered coding workflow: [docs/IMPLEMENTATION-WORKFLOW.md](docs/IMPLEMENTATION-WORKFLOW.md)
- Prize strategy and confirmed decisions: [docs/PRIZE-STRATEGY.md](docs/PRIZE-STRATEGY.md)
- Implementation history and verification: [docs/IMPLEMENTATION-LOG.md](docs/IMPLEMENTATION-LOG.md)

## Layout
| Folder | What |
|---|---|
| `payments/` | x402 on Hedera + 96.31/3.69 split |
| `frontend/` | profile, claim, tip |
| `claims/` | Arkiv steward CLI: encrypted invites, revocation, freeze records |
| `ens/` | artist names + records |
| `agent/` | 0G steward agent, spend cap, HCS claim log |
| `docs/` | plan, tx proofs, demo script |

## Local frontend preview

Run `npm run dev:frontend` from this directory and open `http://127.0.0.1:4173`. Explore the sample OSO profile or open `/draft` to preview a name and bio in the current tab. Drafts are not saved or published; claim and payment integration are not active. See [frontend/README.md](frontend/README.md) for scope, verification, and source attribution.

Arkiv integration and pending testnet evidence: [arkiv/README.md](arkiv/README.md).

The [claims README](claims/README.md) documents the trusted steward CLI and database setup. Invite issuance and freeze records are implemented; wallet-proof redemption, service enforcement, and public claim routes are still pending.

## How we work
- Branch → pull request → **1 approval from a teammate** → merge. No direct pushes to `main`.
- Rules: nothing goes live for an artist without their consent · agent collects, artist holds · Hedera testnet for payments, ENS mainnet design with deployment review · no secrets/keys in the repo (use `.env`, never committed).
- Post progress in the team Telegram; the status page is updated from there.

## Continuity
Builds on Open Source Orchestra and OSO P.I.T. (ETHGlobal New Delhi). Reused source and new work must be distinguished in the implementation log and import notices. Prior 0G/Hedera integration evidence is unavailable; sponsor eligibility is tracked in the prize strategy.

## Team
Shaka (artist + demo lead) · teammates TBD · AI help disclosed (Agent Ohana).
