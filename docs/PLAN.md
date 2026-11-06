# 🎻 Fork the First Artist — Team Brief
*ETHGlobal Mumbai 2026 · Open Source Orchestra · lead: Shaka*

> This is the product target, not a report of completed integrations. Current decisions, prize eligibility, and evidence gaps: [PRIZE-STRATEGY.md](PRIZE-STRATEGY.md).

## One paragraph
**Fork the First Artist** is a free, zero-cut home for musicians built on Open Source Orchestra. Any artist who makes a profile instantly gets an **ENS name**, an **x402 payment rail on Hedera**, and their own **AI steward agent running on 0G**. The agent is like a merch table that never sleeps — it greets fans, shares songs, and takes tips, while every payment flows straight to the artist's own wallet. A transparent on-chain split sends just **3.69%** to pay for the agent's own compute; **OSO takes zero cut and zero profit**. Shaka is the first human artist on these rails — anyone can "fork" him in one click.

## The demo (what judges see)
1. Artist opens the OSO profile page → fills name/bio/photo + **own payout address** + ✅ consent box.
2. Clicks **Claim your name** → gets `artist.<parent>.eth` (records: Hedera payout account + agent URL).
3. Their **steward agent** goes live on 0G (answers fans about the artist's public bio/songs).
4. A fan (or a fan's agent) asks for a song / tips → agent answers with **HTTP 402** → payment settles on **Hedera testnet** → **96.31% artist / 3.69% agent compute wallet**, verifiable on HashScan.
5. The agent pays for its own 0G inference from its 3.69%, under a **spend cap**.
6. **Live fork:** a second (consenting) artist does steps 1–5 on stage.

## Design rules (non-negotiable)
- **Agent collects, artist holds.** Money never sits in the agent's wallet except its 3.69% compute share.
- **Consent first.** No name, agent or profile for any artist until they opt in.
- **Zero cut, no token.**
- **Spend cap** on agent compute (demo budget: $5 total).
- **Hedera testnet** for demo payments; **ENSv2 Ethereum mainnet** for identity (owner-approved design, deployment/cost review still required). 0G environment/funding remains to be verified.
- **Open source**, every contributor credited (AI help disclosed).
- Prior OSO work = Continuity; everything built this weekend clearly marked new.

## Verification — how an artist claims their rail + agent
Two things to verify: **wallet** (they control the payout address) and **identity** (they are really that artist).
1. **Steward invite** — an OSO steward who knows the artist sends a one-time claim link (Telegram / email / in person).
2. **Wallet signature** — artist connects a wallet and signs "I am [name], claiming [name].<parent>.eth". No keys shared.
3. **Logged on Hedera** — the claim (inviter, artist, wallet, time) is written to a **Hedera Consensus Service (HCS) topic**: public, tamper-evident audit log.
4. **Then activate** — ENS name + x402 rail + 0G steward agent switch on.

Protections: no profile/name/agent exists until claimed · payouts only to the wallet that signed · steward can freeze OSO services for a disputed claim (also logged on HCS), but cannot revoke/reassign the artist’s ENS name or change their payout records · agent uses only what the artist provides.
Later: social proof (code posted from known X/IG/SoundCloud), two-vouch co-sign, proof-of-personhood, existing ENS/socials.

> "Artists are invited by people who know them, sign with their own wallet, and every claim is logged on Hedera — no impersonators, no middleman."

## Architecture
```
Fan / fan's agent
   │  GET /tip or /song  →  402 Payment Required
   ▼
Artist Steward Agent (0G inference)  ── x402 server (@x402/hedera)
   │  pays via facilitator (x402.org testnet or Launa)
   ▼
Hedera testnet ── split (HTS custom fee or split contract)
   ├── 96.31% → artist's own account
   └──  3.69% → agent compute wallet → pays 0G Compute (capped)
ENS: artist.<parent>.eth → text/addr records: hedera account, agent URL, profile
```

## Roles
| Role | Who | Builds |
|---|---|---|
| Artist + demo lead | Shaka | vision, artist consent, live fork, pitch |
| Payments (Hedera) | _teammate_ | x402 endpoint, split, HashScan tx proof, tests |
| Frontend | _teammate_ | profile page, wallet connect, Claim-your-name, tip button |
| ENS + agent | _teammate(s)_ + Shaka's AI agents | subname issuing, records, 0G steward agent template, spend cap |
| Pitch / video / README | _teammate_ | ≤3 min demo video, README, submission |

## Sponsor tracks we can target (from the event prize pages — verify on Hacker Dashboard)
- **Hedera — "AI Agents That Pay: x402 on Hedera"**: x402 endpoint settling on Hedera; an agent completes a paid request end-to-end with no human approving; README with a settled **Hedera transaction ID**. Extra points: spending controls, **HTS custom fees to split revenue**, HCS topic as audit log. Docs: https://docs.hedera.com/solutions/ai/x402 · npm `@x402/hedera`
- **0G — "Agents That Pay for Themselves"**: agent earns money and pays its own inference on 0G Compute, no human top-up, spend cap, graceful degradation when funds are low, tx hashes + request IDs.
- **0G — "Keep Building on 0G (Continuity)"** excluded: owner reports no prior 0G integration evidence.
- **ENS — Existing Project Integration (Continuity)** — substantive ENSv2 identity on Ethereum mainnet; parent and permissions pending. See prize strategy for category eligibility and requirements.

## Timeline
- **Deadline: Sat 7 Nov, 09:00 IST** (per official start page — confirm on dashboard).
- Tonight: agree roles, repo, testnet accounts (Hedera portal, 0G faucet), hello-world x402 payment.
- Fri: profile page + ENS claim + agent live + split working.
- Fri night: full end-to-end, second artist rehearsal, video.
- Sat morning: README, tx IDs, submit.

## Open questions
- ENS mainnet parent (owner will supply), controlling signer, renewal/expiry policy, and exact artist/agent permissions. Confirmed: artist controls records; OSO cannot revoke/reassign names.
- Which second artist forks live (consent required).
- Split method: HTS custom fee vs small split contract.

Team plan + live status: https://opensourceorchestra.org/ethglobalmumbai/

## Context / continuity
- Open Source Orchestra: https://opensourceorchestra.org
- OSO P.I.T. (ETHGlobal New Delhi) — artist ENS subnames.
- Devcon Music Sanctuary community (Mumbai, this week).

Contact: Shaka 🤙
