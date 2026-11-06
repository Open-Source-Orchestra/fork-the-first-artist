# 🎻 Fork the First Artist
*ETHGlobal Mumbai 2026 · Open Source Orchestra*

Any musician makes a profile and gets an **ENS name**, an **x402 payment rail on Hedera**, and their own **AI steward agent on 0G**. The agent takes payments; the money goes straight to the artist. **3.69%** pays the agent's own compute. **OSO takes zero cut, zero profit, no token.**

- 📋 Plan + live status: https://opensourceorchestra.org/ethglobalmumbai/
- 📄 Full plan: [docs/PLAN.md](docs/PLAN.md)

## Layout
| Folder | What |
|---|---|
| `payments/` | x402 on Hedera + 96.31/3.69 split |
| `frontend/` | profile, claim, tip |
| `ens/` | artist names + records |
| `agent/` | 0G steward agent, spend cap, HCS claim log |
| `docs/` | plan, tx proofs, demo script |

## How we work
- Branch → pull request → **1 approval from a teammate** → merge. No direct pushes to `main`.
- Rules: nothing goes live for an artist without their consent · agent collects, artist holds · testnet for the demo · no secrets/keys in the repo (use `.env`, never committed).
- Post progress in the team Telegram; the status page is updated from there.

## Continuity
Builds on Open Source Orchestra and OSO P.I.T. (ETHGlobal New Delhi). Everything in this repo was written during ETHGlobal Mumbai (5–7 Nov 2026) unless marked otherwise.

## Team
Shaka (artist + demo lead) · teammates TBD · AI help disclosed (Agent Ohana).
