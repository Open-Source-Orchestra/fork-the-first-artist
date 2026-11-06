# Existing frontend inspection and integration plan

Source: [shakaleikaumaka/oso-storytelling](https://github.com/shakaleikaumaka/oso-storytelling), revision `b6be898f38df8fff7abc53334b5641a89e31939b` on `main`, inspected 6 November 2026. AI assistance: Codex.

## What is available

The source README and CONTRIBUTING describe a static site deployed through GitHub Pages at `opensourceorchestra.org`; merging there publishes the site. The repository tree has no application-level package manifest or frontend build pipeline. Its relevant pages use HTML, CSS, JavaScript modules, and static JSON. The only package manifest in the inspected tree belongs to vendored `forge-std`.

A partial clone is available beside this repo at `../oso-storytelling`. Two attempts to fetch all current blobs failed with connection resets. A blob-filtered clone succeeded, followed by a sparse checkout of the relevant source and documentation. Large media files and unrelated pages were intentionally not downloaded. The source checkout has no local changes.

Read: root README, CONTRIBUTING, GIFT, NOTICE, LICENSE-CONTENT, the license header, garden/keys README and HOW-IT-WORKS, and the node profile specification. Inspected the profile template, garden signing/overlay code, project status page, and relevant file tree. No AGENTS.md exists in that source revision's tree.

| Existing area | Implemented behavior | Reuse candidate / limit |
|---|---|---|
| `nodes/shaka/index.html` | Artist profile, songs/media sections, responsive cards, OSO palette and typography | Closest template for the hackathon artist page; contains real identity/content that must not imply a new signed claim |
| `nodes/shaka/node.json`, `nodes/node-spec.md` | Structured artist/song/media metadata with per-item visibility/licensing | Candidate input format; current agent expects song strings, not these song objects |
| `garden/circle/app.js` and related modules | Three.js garden and artist discovery | Existing immersive experience; a separate integration choice from the simple profile template |
| `garden/circle/keys.js` | Browser-derived Ed25519 key, signed edit/proposal messages, email/copy delivery | Existing profile-edit workflow; does not prove control of a Hedera/Ethereum payout wallet |
| `garden/circle/overlay.js` | Editable field limits, text/link cleanup, published/local edit overlays | Useful reference for profile editing; local previews must not become authoritative claim or payment records |
| `garden/keys/HOW-IT-WORKS.md` | Describes a steward-operated external message processor | That processor is not present in the inspected repository tree; no claim API can be inferred from its documentation |
| `ethglobalmumbai/index.html` and `status.json` | Hackathon plan and progress display | Planning content, not an implemented wallet/ENS/payment application |

## Boundaries to preserve

- Keep the existing visual language if the profile template is selected; no replacement framework has been selected or introduced.
- Keep source attribution and notices with any copied code. The source NOTICE describes code as GPL-3.0-or-later and content separately; vendored assets retain their notices. No source content has been imported by this inspection commit.
- Do not publish changes to the original website implicitly. The owner must select where integration work belongs; a merge there is a deployment.
- Do not infer wallet control from garden keys or public profile JSON. The new claim flow must bind its wallet proof to the requested action and payout destination.
- Do not reuse the source's artist list as automatically opted-in hackathon participants. Consent, invite redemption, and activation are separate requirements.
- Preserve per-item visibility when adapting songs/media; only approved public facts belong in agent context.
- Browser storage and editable URL parameters cannot be authoritative for recipients, spending limits, claims, or activation.

## Decisions currently with the owner

1. Adapt the node profile into this repo's `frontend/`, adapt the 3D garden here, or modify `oso-storytelling` directly.
2. Local demo first, a new public backend, or an existing deployment. The owner deferred the agent authentication choice until this inspection; it must now be settled with deployment.
3. Supported wallet, payout identifier/account mapping, ENS parent, and ENS network. If these remain undecided, research and propose concrete supported options before coding their integration.

The owner's selected template and destination will determine the next feature commit. Do not import a whole live site or invent a new backend host while these decisions are pending.

## Proposed feature sequence after those decisions

Each item is a cohesive commit, with tests and documentation as applicable. Numbers are assigned when work completes, continuing after the latest entry in IMPLEMENTATION-LOG; prerequisite fixes may insert additional commits.

1. **Import the selected frontend foundation.** Preserve the chosen source appearance, isolate relevant assets, document source revision/notices, and provide one reproducible local start command. Verify desktop/mobile layout and keyboard navigation.
2. **Define the integration contracts.** Specify claim states, artist DTOs, public/private fields, wallet proof inputs, agent activation, and payment-service boundaries. Agree recipient and settlement contracts with the payments owner before wiring the UI.
3. **Implement private profile drafts and validation.** Enforce field limits and safe rendering; keep unclaimed profiles private. Test malformed content, ownership, and persistence failures.
4. **Implement invites and wallet challenges.** Authenticated invite issuance, expiration, single use, action/origin/destination binding, signature checks, and atomic redemption. Test replay, wrong wallet, expired invite, and simultaneous claims.
5. **Connect the onboarding UI.** Add consent, wallet connection, signature request, submission, and clear error/retry states. Verify account/network changes and cancellation without accidental activation.
6. **Record and activate the claim.** HCS claim evidence, approved ENS registration/records, and a recoverable activation state machine. Keep external operations idempotent and do not claim completion while any required step is pending.
7. **Bind the agent to the claimed artist.** Enforce service access, trusted artist context, provider availability, and the agreed budget contract. Complete outstanding agent review findings in separately numbered fixes.
8. **Connect fan interactions to the teammate's payment API.** Consume trusted artist identity, challenge, receipt, and failure states. Report payment implementation defects to the teammate; do not modify their payment code.
9. **Verify the full demo and hand off.** Two consenting artists, actual testnet evidence, spend-cap/failure cases, a clean setup rehearsal, and updated package documentation/demo script.

Live ENS/Hedera/0G verification requires the selected setup and locally configured credentials. No credentials should be posted in chat or committed. Tests and UI must label simulated behavior distinctly from actual settlement or activation.
