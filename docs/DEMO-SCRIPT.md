# Demo video — target 2:40, human narrated

Official constraints checked 6 Nov 2026: ETHGlobal general video **2–4 minutes**, minimum **720p**; 0G requires **under 3 minutes**; Hedera allows at most 5 minutes. Use one clean **2:35–2:50**, 1080p if possible. Human voice only; no AI/TTS narration, no sped-up footage, no phone recording. Easiest safe choice: no music. Remove waiting time with normal edits, not speed-up.

## Before recording — hard gate

- [ ] Public live URL opens on a fresh browser and mobile-width viewport.
- [ ] One real fan-agent payment returns HTTP 200 with a non-mock Hedera transaction ID.
- [ ] HashScan shows that transaction and the intended recipient(s).
- [x] The answer is real 0G inference and displays its actual request ID; no `[dev-mock inference]` (see `/steward`: request `9e3a7a4e-b434-4ba8-9627-cf40c9312ab3`, verification chat `dd606f89-101e-48dd-b2ed-b7d5beaa79fb`).
- [x] Arkiv has a real synthetic invitation write/read and reproducible public query (issue `0xf5ac4a…09dd8`, revoke `0x88fa77…4c75`, both status `0x1`; see `arkiv/README.md`).
- [ ] Failed payment/inference does not produce a fake success; low-budget degradation is free and labelled.
- [ ] README contains the exact transaction/request/entity evidence shown in the video.
- [ ] No private key, bearer token, pairing URI, seed phrase, private artist datum, or secret `.env` is visible.
- [ ] Every claim below matches what is actually deployed. Delete any segment whose proof is missing; never substitute a mock and narrate it as real.

## Shot list

| Time | Visual | Human narration / purpose |
|---|---|---|
| 0:00–0:15 | Live artist front door | “Fork the First Artist gives a consenting musician a home where fans can pay them directly and an AI steward can answer from only what the artist chose to share. OSO takes zero cut and there is no token.” |
| 0:15–0:28 | Draft editor + source/continuity disclosure | “This Mumbai build extends the existing Open Source Orchestra design. The old design and every new integration are documented separately. This profile is a labelled demo fixture until an artist verifies a claim.” |
| 0:28–0:40 | One architecture slide: fan → x402 → artist; steward → meter → 0G | “There are two paid requests: the fan pays the artist; the steward pays a capped per-call meter for its own inference. The artist key is never a backend credential.” |
| 0:40–1:25 | Live question + unpaid 402 + autonomous fan agent retry + real answer | “First the fan agent discovers the price from HTTP 402. Without a human approving a wallet popup, it signs the exact Hedera payment and retries. The steward answers from the fenced artist profile through 0G Private Computer. If inference fails or only a template is available, the fan is not charged.” |
| 1:25–1:45 | HashScan transaction + response proof side by side | “This is the settled Hedera transaction, not a preview. Here are the payer, recipient, asset and amount. This is the linked 0G request ID and its reported verification metadata.” If HTS split/HCS is proven, show both recipients and HCS; otherwise do not claim them. |
| 1:45–2:10 | Arkiv invitation status + explorer/RPC query | “The steward’s synthetic invitation is encrypted application state on Arkiv. The app reads its current status; this public query returns the entity and expiry without revealing the bearer token or private profile data.” Show the actual user-facing read, not only a write log. |
| 2:10–2:25 | Spend-cap refusal/degraded free answer + ledger | “The compute budget is checked before quoting inference. At the cap the steward degrades gracefully and the fan pays nothing.” Only claim concurrency guarantees if actually tested. |
| 2:25–2:40 | Repo, live URL, next steps | “The repo includes setup, old/new attribution, tests and proof links. Next we finish signed two-wallet claims, artist-controlled ENS issuance, and an actual automated conversion from revenue to 0G credit. This is the first small rail for an artist-owned orchestra.” |

## What breaks without 0G? (required one sentence)

“Without 0G, the steward cannot produce a fresh artist-grounded answer with 0G request provenance; the paid route refuses or degrades without charging rather than pretending a template is AI inference.”

## Why this is not a generic chat wrapper

The model receives only the selected artist's explicitly shared profile and songs, with artist data and fan instructions fenced as untrusted data. Its answer is coupled to a direct artist-payment route, per-call compute budget, free degradation, and verifiable Hedera/0G provenance. Removing inference removes the steward's main useful action; removing the payment rail removes the artist's direct support flow.

## Recording checklist

1. Use a clean browser profile with no extensions/wallets popups unless deliberately shown.
2. Zoom terminal and browser text so IDs and statuses are readable at 720p.
3. Pre-open only: live app, HashScan, Arkiv proof, repo README. No private tabs/bookmarks.
4. Rehearse once with the exact deployed build; keep a second take only if it shows the same real evidence.
5. Verify final file: duration ≥2:00 and <3:00, resolution ≥720p, audible human speech, no prohibited music+text substitution, no secrets.
6. Upload early enough to watch the uploaded version before final submission.

## If the hard gate is not met

Submit the honest repository before the deadline for stake return, but do not claim sponsor qualification. A clear “implemented locally / live proof pending” video is better than fabricated evidence; it will not satisfy tracks requiring real settlement/inference.
