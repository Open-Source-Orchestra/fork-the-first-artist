# ETHGlobal submission draft — human review required

Do not submit until every bracketed evidence field is replaced with a real value or the corresponding claim is removed. Recommended category: **Continuity**. Recommended partner limit (3): **Hedera, 0G, Arkiv**.

## Proof-freeze decision gate

- Keep **Arkiv** only with Continuity acceptance + the verified write/read/query/viewer evidence below.
- Keep **Hedera** only after a real autonomous x402 transaction and HashScan link are inserted below; otherwise remove that partner and all live-payment claims.
- Keep **0G Private Computer** only after a real judge-accessible 0G answer and request ID are inserted below; otherwise remove that partner and all live-inference claims.
- Do not select ENS, 0G Keep Building, or Agents That Pay for Themselves without their separate required proof. One working integration is stronger than three unsupported selections.

## Project name

**Fork the First Artist — Open Source Orchestra**

## Short description

A Continuity artist-home prototype with 40 public artist previews, a transient local draft, real 0G Private Computer inference with request IDs, and a live Arkiv synthetic-invitation reader. Hedera x402 settlement remains a proof gate, not a claimed success. The intended 96.31% / 3.69% split directs a small share toward agent compute; OSO takes zero cut and there is no token.

## What exists / what was added at Mumbai

**Pre-existing:** Open Source Orchestra's public visual language and artist-circle/profile design, imported from `shakaleikaumaka/oso-storytelling@b6be898f38df8fff7abc53334b5641a89e31939b` with notices in `frontend/SOURCE.md` and `frontend/third-party/`.

**New during ETHGlobal Mumbai:** buildless artist preview and transient draft editor; MetaMask/HashPack connection adapters; x402 Hedera payment gate and autonomous fan/steward payment clients; exact 96.31/3.69 arithmetic and HTS custom-fee token script; HCS spend logging; provider/fencing/budget/degradation logic for a 0G steward; encrypted Arkiv invitation/revocation/freeze state and reads; integration fixes, testnet evidence and demo materials. Detailed incremental history is in `docs/IMPLEMENTATION-LOG.md`, `docs/build-log/`, and the git commits.

**Not claimed as complete:** production artist activation, two-wallet signed claim redemption, ENS issuance, automated conversion of Hedera revenue into 0G Compute credit, or a second-artist fork. Update this list before submission if any becomes genuinely functional.

## Live links and proof

- Current production preview: https://artist.opensourceorchestra.org/ (older static sample)
- Integrated review preview: https://artist-preview-kzu6ctlpau-ffieyo32.taur.link/ (repaired circle + live Arkiv read; wallets disabled)
- Repo: https://github.com/Open-Source-Orchestra/fork-the-first-artist
- Hedera x402 fan payment (1 HBAR, autonomous): [`0.0.9185802@1794000789.476065413`](https://hashscan.io/testnet/transaction/0.0.9185802-1794000789-476065413); steward → 0G meter ×3 (0.01 HBAR each); 96.31% artist forward [`0.0.11345897-1794000798-406931877`](https://hashscan.io/testnet/transaction/0.0.11345897-1794000798-406931877); HCS split log [topic `0.0.11345907`](https://hashscan.io/testnet/topic/0.0.11345907) seq 2. Full table: `docs/TX-PROOF.md`
- Live 0G steward: https://artist-preview-kzu6ctlpau-ffieyo32.taur.link/steward/ (real judge-accessible answer path)
- 0G model + request ID: `0gm-1.0-35b-a3b` · `9e3a7a4e-b434-4ba8-9627-cf40c9312ab3`; verification chat `dd606f89-101e-48dd-b2ed-b7d5beaa79fb`; provider `0xf4FB8d2bD856e672b5f9848b0eD235A20079B250`; actual compute cost `207` micro-USD; no independent TEE claim
- Arkiv writer: `0x8e9d4dEc12bc9Da62daB72304659ef1eE6B200f2` (dedicated synthetic Rabdi writer)
- Arkiv current entity: `0x11b5bb0e5e2771ab7363d506ea2334a336f42ad3271bb22a32aabdda170fa267`; [issue](https://rabdi.explorer.arkiv.network/tx/0xf5ac4a62b1af1bdc066c46c825e325cd4485d377b951d8c777450e5771b09dd8) block 301610 / [revoke](https://rabdi.explorer.arkiv.network/tx/0x88fa7783995c065bf2088aea99e812bed3391b5d91c98b88aed1448b0b2e4c75) block 301613, both status `0x1`
- Arkiv viewer/query: https://artist-preview-kzu6ctlpau-ffieyo32.taur.link/arkiv (live manual public read verified at block 302205) + exact keyless query/projection in `arkiv/README.md` and `frontend/public/arkiv-query.mjs`
- Video: **[2:35–2:50 HUMAN-NARRATED 720p+ VIDEO URL]**

## Hedera partner answer

An autonomous fan agent reads the x402 v2 `accepts` requirements, signs the exact Hedera testnet payment without a human wallet approval, and retries the artist resource. The resource verifies, obtains the artist-grounded answer, settles last, and returns the transaction/provenance envelope. Failed inference/settlement and degraded template responses are not charged. Live proof: fan `0.0.11345895` paid 1 HBAR to the steward `0.0.11345897` via the x402.org facilitator (fee payer `0.0.9185802`); the steward paid 0.01 HBAR per 0G inference call to the meter `0.0.11345898` (agent pays for its own thinking); Utkarsh's Hedera Agent Kit steward then forwarded exactly 96,310,000 tinybar (96.31%) to the artist `0.0.11345896` and logged the split to HCS topic `0.0.11345907`, all re-read from the mirror node (`docs/TX-PROOF.md`). Separately describe HTS custom-fee split and HCS only if their real transactions/messages are shown.

Feedback: (1) accounts auto-created by sending HBAR to an EVM alias are *hollow* and the facilitator returns `invalid_exact_hedera_payload_signature_invalid` until each has paid one own-key transaction — worth a loud note in the x402 Hedera docs and a clearer error; (2) `@x402/hedera` refuses HBAR quotes unless the payer opts into non-default assets with spend caps — sensible, but undocumented; (3) the portal faucet's CAPTCHA/Cloudflare gate blocks agent-driven setup, a PAT-only testnet path that works from cloud IPs would help agent builders.

## 0G partner answer

0G Private Computer is in the steward's main answer path, not an optional chat sidecar. Artist data and fan instructions are fenced; the public `/steward` page returns a real 0G answer, actual model/request ID, provider, verification chat ID and micro-USD compute cost. Without 0G, the fresh artist-grounded answer is unavailable and the app returns an honest error rather than a mock. Current proof: `9e3a7a4e-b434-4ba8-9627-cf40c9312ab3`, verification chat `dd606f89-101e-48dd-b2ed-b7d5beaa79fb`, cost 207 micro-USD. This is a free public 0G path; Hedera payment and self-funding are separate unfinished flows.

We are targeting **Private Computer**, not claiming Agents That Pay for Themselves unless automatic Hedera-revenue-to-0G-credit funding is actually demonstrated.

Feedback: **[Add actual model catalog/request-ID/TEE/credit setup observations.]**

## Arkiv partner answer

The new Mumbai integration stores encrypted, expiring synthetic steward invitations on Rabdi. State transitions atomically replace the prior entity and append an encrypted audit event; the status feature reads and authenticates current state rather than treating Arkiv as a write-only log. Raw bearer tokens, wallet proofs and private artist data are never written as public plaintext. Real writer `0x8e9d4dEc12bc9Da62daB72304659ef1eE6B200f2`, current entity `0x11b5bb0e…a267`, successful issue/revoke transactions and the exact query are linked above. The `/arkiv` user view performs a manual current public-metadata read; the trusted CLI separately verifies encrypted `revoked` state. Public `kind = claim` count is zero.

See `arkiv/schema.md`, `arkiv/friction.md`, `arkiv/reach.md`, `arkiv/why-arkiv.md`, and `arkiv/how-you-use-arkiv.md`.

## Team and meaningful human contribution

- **Shaka** — product vision, artist/community context, consent and ownership boundaries, demo/pitch and final human decisions.
- **Prince Keshri** — frontend/wallet/claims implementation, reviews and integration decisions.
- **Rajarshi Roy** — payment/agent architecture and implementation, testing and live payment work.
- **Utkarsh Tiwari** — Hedera Agent Kit steward in `hedera-steward/` (verifies settlement, forwards 96.31%, logs the split to HCS); his testnet account funded the live demo accounts.
- **Yuuki Shimizu** — main hacker on the ENS integration (osoartist.eth on ENSv2: artist-owned names, resolvers and payout records).

The ETHGlobal team has five members: Shaka Lei Kaumaka, Rajarshi Roy, Prince Keshri, Utkarsh Tiwari, Yuuki Shimizu.

Required 0G contacts: **[each submitted team member's Telegram and X; do not guess]**.

## AI attribution

AI assistance was used for scaffolding, implementation, review, tests and documentation. It is recorded in commit messages, `docs/IMPLEMENTATION-LOG.md`, `docs/build-log/`, and package notices. Human teammates supplied the product/consent requirements, made design and integration decisions, reviewed changes, operated live accounts, and must perform the narrated demo/final submission. Do not describe AI agents as human team members.

## Final dashboard checklist

- [ ] Continuity selected and prior OSO work disclosed.
- [ ] No more than three partners: Hedera + 0G + Arkiv.
- [ ] Repo public and all prompt/spec/planning artifacts required by AI rules included.
- [ ] Live app works for a judge, not only on the presenter's machine.
- [ ] Video 2:00–2:59, at least 720p, human narration, no prohibited recording/editing.
- [ ] Team roster max five; each member accepted/staked individually; Telegram/X contacts filled.
- [ ] Exact real transaction/request/entity IDs match README and video.
- [ ] Submitted by **08:00 IST target**, hard deadline **09:00 IST**, and uploaded page/video verified.
