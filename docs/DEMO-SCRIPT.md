# Demo video — the garden flow · target 2:45 · human voice, NO music

**Rules (checked 6 Nov 2026):** ETHGlobal wants **2–4 min**, **≥720p**; 0G asks for **under 3 min** → aim for **2:40–2:50**.
Human voice only (no AI/TTS), no music, no sped-up footage, no phone-filmed screen. Cut waiting time with
normal edits. Record at **1600×900 or 1920×1080**, browser zoom 110–125 % so IDs are readable.
Every claim below is backed by something live; if a step fails on the day, **cut it — never narrate a mock as real.**

Live site: **https://artist.opensourceorchestra.org/** (production). `/trust` is on the preview
`https://artist-preview-kzu6ctlpau-ffieyo32.taur.link/trust/` until PR #6 is merged; after that use `/trust` on production.
Reference stills for every shot: `/shared/ethglobal-mumbai-2026/media/garden/` (numbers below match the file names).

## Before you press record (2 min)

- [ ] Fresh browser profile, no extensions/bookmarks bar, window 1600×900 (or full-HD). Close chat apps.
- [ ] Open these tabs in order: ① the live site ② HashScan artist forward
      `https://hashscan.io/testnet/transaction/0.0.11345897-1794000798-406931877` (click **Reject** on the cookie banner once)
      ③ `/arkiv/` ④ `/trust/` (preview link above) ⑤ `/admin/?artist=shaka` ⑥ `/consent/`.
- [ ] On tab ① open the fork panel once and check the 0G badge says **LIVE · MAINNET** (if it says *unavailable*, wait a minute
      and reload; if it stays down, cut shot 4 and say nothing about a live answer).
- [ ] No wallet popups, private keys, `.env`, invite links with real names, or personal inboxes on screen.

## Shot list (clicks · what you say · timing)

| # | Time | Do exactly this | Say (≈ words) |
|---|---|---|---|
| 1 | 0:00–0:15 | Tab ①, landing card visible (still `01`). Click **ENTER THE CIRCLE** (`#enter`). Let the circle settle 2 s (still `02`). | "This is the Open Source Orchestra garden circle — the artists of the Devcon 8 music space here in Mumbai. The circle existed before this hackathon. This weekend we *forked* it: every artist can now have a name they own, an AI steward, and a tip jar that pays them directly." |
| 2 | 0:15–0:35 | Click **Shaka**'s card in the circle (or use **FIND AN ARTIST** → Shaka). The detail panel opens; scroll it to the **🍴 FORK SHAKA** card (still `03`). Hover the split bar. | "Tap any artist. Shaka's fork card: **shaka.osoartist.eth**. Ninety-six point three one percent of every tip goes to him, three point six nine runs his steward's compute, Open Source Orchestra takes zero. *Not issued* — nothing happens in an artist's name until they sign." |
| 3 | 0:35–0:50 | In the fork card click **⚡ SEE A REAL X402 PAYMENT** → the fork panel opens (still `04`). Slowly point at the 5 numbered steps. | "The loop: a fan's agent asks the steward, gets HTTP 402, and pays with x402 on Hedera — no human click. The steward thinks on 0G, forwards 96.31 percent to the artist, and logs the split on Hedera Consensus Service." |
| 4 | 0:50–1:15 | Scroll to **🧠 Ask a steward · 0G Private Computer**. Click the chip **What does Mira make music from?** Wait for the answer (~2–5 s, cut the wait). Point at **0G request** id + cost (still `05`). | "Live 0G Private Computer inference, from the browser. This demo steward speaks for Mira Modal, a fictional artist; a real artist's steward wakes only after consent. Every answer carries its 0G request ID and cost. **Without 0G, the steward cannot give a fresh, artist-grounded answer with 0G request provenance — the paid route refuses or degrades for free instead of faking it.**" |
| 5 | 1:15–1:45 | Scroll to **⚡ x402 on Hedera** (still `06`). Click the **96.31% → artist** link → HashScan (tab ②, still `12`): point at **SUCCESS**, memo *OSO steward*, and the transfer **0.0.11345896 +0.9631 ℏ**. *(Optional 5 s cutaway: terminal running `node scripts/live-e2e.mjs --live` — only if you recorded a real run; keys live on the demo box only.)* | "And it settled on Hedera testnet. A fan agent paid one HBAR through x402; the steward paid the 0G meter per inference, each payment bound to a 0G request ID. On HashScan: 0.9631 HBAR landed in the artist's account, split logged to HCS by Utkarsh's Hedera Agent Kit steward." |
| 6 | 1:45–2:10 | Tab ③ `/arkiv/` → click **Read current Arkiv entity** → query block, entity key, expiry, read-only appear (still `07`). Then tab ④ `/trust/` → scroll to **02 / REHEARSAL**, 3 records (still `10`). | "Invitations live on Arkiv as encrypted, expiring, revocable entities — this reads the current one live, no key. And the circle's trust ledger: every invitation, consent and approval stored on Arkiv, every signature re-verified in your browser. This rehearsal used a throwaway key, and the page says so." |
| 7 | 2:10–2:32 | Tab ⑤ `/admin/?artist=shaka` (still `08`): point at the 6-step chain (root → stewards → invitation → consent → approval → name). **If Shaka records with his own wallet:** Connect wallet → *Welcome, root steward* → sign the invite → open the copied link. **Anyone else:** don't connect. Then tab ⑥ `/consent/` → red **Invitation needed** box (still `09`). | "Who decides who joins? The steward desk. Shaka owns osoartist.eth, so he is the root of trust and can grant stewards. A steward invites, the artist signs consent with their own wallet, a steward approves — free signatures. Without an invitation, the consent page won't let you sign." |
| 8 | 2:32–2:48 | Back to tab ①, fork panel → **🏷 A name the artist owns** tile (still `06d`). Optional: open `app.ens.domains/osoartist.eth`. End on the circle. | "Only then does our issuer re-check the chain and create the name on ENS v2, owned by the artist's wallet, pointing at their Hedera account. No name is issued yet — the first goes to the first artist who says yes. Fork the first artist. Open Source Orchestra takes zero." |

Spoken total ≈ 390 words → about 2:35 of speech + ~15 s of clicks ≈ 2:45. If you run long, shorten shot 3 first, then shot 6's second sentence.

## The required 0G sentence ("what breaks without 0G")

> "Without 0G, the steward cannot give a fresh, artist-grounded answer with 0G request provenance — the paid
> route refuses or degrades for free instead of faking it."

## Why this is not a generic chat wrapper (for Q&A)

The model only receives the selected artist's explicitly shared profile, with artist data and fan text fenced as
untrusted. Its answer is coupled to a direct artist-payment route (x402 → 96.31 % forward → HCS), a per-call compute
meter bound to 0G request IDs, free degradation when inference is unavailable, and a consent gate (steward invite →
artist signature → steward approval) before anything runs in a real artist's name.

## What is live vs. not (say only what is true)

| Live / proven | Proof |
|---|---|
| Garden circle + fork layer on production | https://artist.opensourceorchestra.org/ |
| 0G Private Computer answers with request IDs | fork panel / `/steward`; `ZEROG-LIVE-PROOF.md` |
| x402 HBAR loop, 96.31 % forward, HCS log (testnet, synthetic accounts) | `docs/TX-PROOF.md` |
| Arkiv invitation write/read/revoke + trust-ledger rehearsal (Rabdi testnet) | `/arkiv`, `/trust`, `docs/TRUST.md` |
| Steward desk + consent gate (signatures verified by pages and issuer) | `/admin`, `/consent`, `npm run test:ens` |
| **Not yet:** any real artist's name issued on ENS mainnet; registry activation (`setSubregistry`) | fork-tested only (`ens/proof/fork-test.json`) |

## Final file check

Duration 2:00–2:59 · ≥720p · human voice audible · no music · no secrets · watch the uploaded copy once before submitting.
