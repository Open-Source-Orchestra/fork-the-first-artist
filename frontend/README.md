# Frontend — public artist circle and local previews

**Front door (`/`) = the Open Source Orchestra garden circle** (3D, Three.js) with the *Fork the First Artist* layer (`fork.js`): a ribbon and panel with the live 0G steward ask, the settled Hedera x402 proof, the Arkiv proof and the ENS state, plus a per-artist fork card (`<name>.osoartist.eth`, 96.31% / 3.69% / OSO 0%) in each artist's detail panel. The simplified accessible circle described below now lives at **`/list`**. Provenance: [SOURCE.md](SOURCE.md#garden-circle-front-door--garden-front-door).

A buildless HTML/CSS/JavaScript frontend with a 40-artist public-preview circle, a separate sample artist home, a local draft editor, and separate unverified wallet adapters. The circle adapts the public OSO garden design/data; `/home` retains the `oso-storytelling/nodes/shaka` layout foundation. Public artist data is preview-only: this frontend does not establish consent, claim a seat, activate an artist, or simulate a successful payment. OSO takes zero cut; the planned steward compute share is 3.69%.

## Run locally

From the repository root, using Node.js 22.18 or newer:

```sh
npm run dev:frontend
```

Open `http://127.0.0.1:4173`. The circle, sample, draft editor, and MetaMask extension adapter need no dependency installation or backend. HashPack requires the optional setup below. The server binds only to loopback. Stop it with Ctrl+C; restart after editing assets because they are loaded at startup. To choose another port, use `PORT=4174 npm run dev:frontend`.

### Unit, data, and route tests

```sh
npm run test:frontend
```

This dependency-free suite has **27 passing tests**. It covers circle data invariants, combined day/query filters, multi-day and undated artists, reset, safe draft handoff, native/static HTML and no-JS fallback, draft validation, wallet adapters, public modules/routes, security headers, HEAD requests, rejected writes, and blocked repository/traversal paths. It requires permission to bind a temporary loopback port.

### Repeatable real-browser audit

Browser tests are separate so the basic suite does not require downloaded dependencies. From the repository root:

```sh
npm --prefix frontend ci --ignore-scripts
npm --prefix frontend exec playwright install chromium
npm run test:frontend:browser
```

Pinned development-only `playwright` and `axe-core` packages are used; they are not runtime dependencies. The suite has **11 passing tests** covering:

- every seat's center with `document.elementFromPoint` at **1280×800, 375×812, and 320×568** — **120/120 correct, 0 intercepted**;
- CTA obstruction and horizontal overflow at all three viewports;
- native list/button semantics, an accessible visible search label, search/filter DOM and tab order, `aria-pressed`, and semantic hiding;
- combined filters, multi-day results, and both reset controls at all three viewports;
- keyboard dialog opening, Escape/close, and focus return;
- exact public-name draft prefill, transient-slug removal, and rejection of arbitrary URL content;
- a useful 40-name no-JS list, routes, and disabled draft fields;
- axe WCAG 2 A/AA and 2.1/2.2 A/AA scans on `/`, `/home`, `/draft`, and `/wallets` at all three viewports — **12 scans, 0 violations**.

To save optional local evidence (ignored by Git), set absolute paths before the browser command:

```sh
CIRCLE_BROWSER_REPORT="$PWD/.audit-results/browser-hit-report.json" \
CIRCLE_BROWSER_ARTIFACTS="$PWD/.audit-results" \
npm run test:frontend:browser
```

The JSON report records every center hit and axe result; screenshots show the three layouts. These tests do not exercise real wallet extensions, a Reown project, claims, backend services, payments, ENS, or deployment.

## Circle interaction and public data

`/` renders native `<ul>/<li>/<button>` seats. Desktop uses a 2D-positioned ring; below 1000 pixels it switches to an ordinary one/two-column flow. No 3D-transformed button hit areas or fixed search overlay remain. Search and day filters are before seats in DOM and tab order. One state object combines both controls, so `Nov 3 + Alaska` is empty while `Nov 4 + Alaska` shows the Alaska × Subcult preview. Nonmatching list items are `hidden`/`aria-hidden` and their buttons leave tab order. The count is a polite atomic status; day buttons expose `aria-pressed`.

Each artist has an explicit `days` array. Daily artists/hosts declare `[3, 4, 5, 6]`; undated garden entries declare `[]` instead of inheriting a contradictory day. **Reset filters** and **Reset & show everyone** both clear the query, select all days, restore all results, and clear stale highlighting. The decorative celebration does not rotate or move hit targets.

Without JavaScript, `/` contains a static list of all 40 public names/set summaries and links to the original circle, `/home`, and `/draft`. It shows an honest 40-of-40 static roster count rather than an empty 0/0 interactive result. The local editor remains disabled without its script.

## Configure HashPack

The owner will create a Reown project ID; no real ID is configured yet. Prepare the local runtime:

```sh
npm --prefix frontend ci --ignore-scripts
npm run build:wallet
cp frontend/.env.example frontend/.env
```

Set `REOWN_PROJECT_ID` in `frontend/.env` to your own public project ID (32 hexadecimal characters), then restart `npm run dev:frontend`. The script reads that ignored file. No API secret or wallet key belongs in this configuration. Restrict production origins in the Reown dashboard when the domain is selected. Only that public ID and runtime-readiness flags are served by `/wallet-config.json`; environment files are never served.

The generated bundle and license files live in ignored `frontend/generated/`. Rebuild after dependency/runtime changes and restart the preview. Without a build and project ID, the HashPack button stays disabled; MetaMask and drafts remain usable. `npm run install:all` now also installs frontend dependencies, but the wallet build remains a separate explicit step.

## Draft your profile

Open `/draft`, choose **Start a local draft** in the filters/sample page, or open an artist preview and choose its local-draft CTA. Enter an artist name and bio, then select **Preview my draft**. Corrections show next to the fields; editing invalidates the previous preview so it cannot silently show stale information. **Discard draft** clears inputs, preview, and errors.

A circle CTA links only to `/draft?artist=<public-roster-slug>`. The editor resolves an exact slug against the bundled public roster, prefills only that public name, and immediately removes the query string with `history.replaceState`. Unknown slugs and markup/private-looking values prefill nothing. No bio, photo, link, wallet, consent, claim, or authority field crosses this handoff.

Draft edits exist only in the current page's form/DOM. The app clears them on reload and navigation, including return from back/forward cache. There is no browser-storage persistence, draft-content URL encoding, export, or server submission. These are application behavior guarantees, not secure memory erasure from the browser/OS. Copy text elsewhere yourself if you need to keep it.

The initial UI limits are 80 units for the name and 1,200 for the bio, counted as UTF-16 code units to match HTML `maxlength`; some emoji use two units. Both fields are required for a preview. Validation trims outer whitespace, normalizes bio line endings, rejects unsupported control characters, and never silently truncates. Artist display names are not ENS labels. User text is assigned with `textContent`, not HTML insertion or automatic linking.

No consent checkbox or claimed flag is generated. A local preview is not identity proof or permission to activate resources. Durable drafts, photos, public profiles, and signed consent are later stages.

## Current behavior and boundaries

- `/home` profile/songbook/onboarding sections, anchor navigation, and native disclosure controls work without JavaScript; `/` provides its static 40-artist fallback.
- Responsive rules, skip links, visible keyboard focus, native dialog behavior, and reduced-motion support are present.
- The editor uses same-origin JavaScript modules for validation, public-roster handoff, and local preview. Fields remain disabled until handlers are installed. The inputs have no serialization names, and CSP blocks native form submission; a script-loading failure does not send entered content through a form URL.
- Drafts make no wallet or network calls beyond loading same-origin static modules. Wallet connections are isolated on `/wallets`; neither adapter calls inference, signs a message, or sends a transaction.
- An exact route allowlist serves the circle, sample, draft, wallet pages, modules, and explicitly named images. Other paths return 404 and write methods return 405. CSP permits same-origin scripts/styles but blocks form submissions, inline scripts, and framing. Circle/sample/draft pages block network connections. Only `/wallets` additionally permits its configuration fetch and specific WalletConnect relay/verification endpoints. Repository files are not served.
- This server is a development preview, not the public backend. A future host must configure equivalent headers and separate static assets from private application data.

## Deployment and security-header boundary

The loopback Node server emits a restrictive Content-Security-Policy, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, and `X-Frame-Options: DENY`. A response-header check of `https://artist.opensourceorchestra.org/` on 6 November 2026 found GitHub Pages serving the static page **without the local CSP, X-Content-Type-Options, Referrer-Policy, or X-Frame-Options**. Merging this branch or copying static files to GitHub Pages does not itself install those response headers. Equivalent protection requires explicit hosting/CDN configuration and a separate deployed-header audit; this branch does not promise or perform that deployment fix.

## Files and attribution

| Path | Purpose |
|---|---|
| `public/index.html`, `public/circle.css`, `public/circle.mjs` | Semantic circle, static fallback, 2D desktop/mobile layouts, filters, and native dialog |
| `public/circle-state.mjs` | Pure combined-filter and exact-public-slug handoff helpers |
| `public/circle/artists.mjs`, `public/circle/img/` | Public preview roster/photos with explicit `days` data; not activation consent |
| `public/home.html`, `public/styles.css` | Separate sample artist-home layout and adapted OSO styles |
| `public/draft.html`, `public/draft.mjs` | Local editor, public-name prefill, error/preview/discard states, and lifecycle cleanup |
| `public/profile-draft.mjs` | Field validation without claim authority |
| `server.mjs` | Dependency-free local preview with exact routes and local security headers |
| `test/circle-state.test.mjs` | Circle data/filter/static-page/handoff regressions |
| `test/server.test.mjs` | HTTP boundary regression check |
| `test/profile-draft.test.mjs` | Draft validation regression checks |
| `browser/circle.browser.test.mjs` | Optional Playwright geometry/interaction/no-JS and axe audits |
| `SOURCE.md` | Exact source revision, reused elements, and modifications |
| `third-party/oso-storytelling/` | Preserved upstream notices and licenses |

See [SOURCE.md](SOURCE.md) before reusing or publishing the adaptation.

## Verification and next features

Current circle verification is the 27-test dependency-free suite and 11-test real-browser suite described above, with saved center-hit/axe evidence when requested. This supersedes earlier notes that browser automation was unavailable for the circle. Real wallet extension/HashPack pairing remains separately unverified, as detailed below.

Wallet proof, consent submission, durable private profile persistence, ENS issuance, steward chat, and tipping remain unimplemented. Their contracts depend on the selected wallets, ENS parent/permissions, backend host/authentication, and payment teammate. See [integration plan](../docs/FRONTEND-INTEGRATION.md), [demo-readiness record](../docs/FRONTEND-DEMO-READINESS.md), and [prize strategy](../docs/PRIZE-STRATEGY.md).

## Wallet connection — commit 10

Open `/wallets`. MetaMask extension discovery uses EIP-6963 and only requests account access when you click **Connect MetaMask**. It reads the current account/network, requires Ethereum mainnet for the intended ENS flow, and never requests a signature, payment, or network switch. All displayed addresses remain unverified. Account/network changes clear the selection; stale asynchronous results cannot restore a forgotten or disconnected selection. Forgetting affects this page only, not the wallet's website permissions. No account/session persistence is added.

This first adapter supports desktop injected MetaMask, not mobile relay connections. Provider metadata is self-reported and cannot authenticate the extension; a future server-side signature check is still essential. Provider icons/HTML are never rendered. The initial commit 10 left HashPack unavailable; commit 11 adds the separately configured pairing flow described below.

Added routes: `/wallets`, `/wallets.mjs`, `/ethereum-wallet.mjs`. Commit 11 extends the wallet page policy and exact routes as described below. The draft editor still does not connect wallets; the wallet page does not activate or publish drafts.

Verification at commit 10 was seven new mocked-provider/discovery tests plus the then-existing suite (13 total); the current totals are above. Real MetaMask extension interaction remains unverified even though static wallet-page browser/axe checks now run. Manual checks still required: no permission popup on load; explicit connect opens MetaMask; decline/pending request/wrong network are explained; changing accounts or chain clears the address; Forget while approval is pending prevents a late result from restoring it. No live wallet signature or chain transaction has been performed.

Selected next steps: HashPack native Hedera testnet connection and two server-verified proofs bound to one claim, using Node + Arkiv (owner-selected replacement in part 13). The owner will create a Reown project ID. ENS parent, host/domain, authentication configuration, and renewal policy remain pending.

Reference APIs checked for this feature: [EIP-6963 discovery](https://eips.ethereum.org/EIPS/eip-6963), [EIP-1193 provider events](https://eips.ethereum.org/EIPS/eip-1193), [MetaMask integration guidance](https://docs.metamask.io/metamask-connect/), [HashPack WalletConnect support](https://docs.hashpack.app/dapp-developers/walletconnect), and [Hedera connector README](https://github.com/hashgraph/hedera-wallet-connect/blob/main/README.md).

## HashPack pairing — commit 11

On `/wallets`, explicitly choose **Connect HashPack** after configuration. A locally rendered QR code or copied `wc:` URI pairs with HashPack. Do not share pairing URIs: they contain session material. The SDK is loaded only on connect, telemetry is disabled, and its key/value store is held in memory rather than IndexedDB/localStorage. A relay connection is still required; this is not offline pairing.

The requested namespace is native `hedera:testnet`, with only `hedera_signMessage` permission and account/network events. No transfer or transaction method is requested, and this version does not invoke message signing either. After approval, explicitly select a numeric testnet account. EVM addresses, mainnet accounts, aliases/checksummed IDs, expired sessions, and missing message capability are rejected. Numeric account IDs are retained as strings. Connected selections are unverified and are never copied into authoritative payout records.

Cancel/disconnect clears local selection and QR immediately, attempts session/pairing cleanup, and rejects late approvals. Session changes clear selection and require reconnection. Remote disconnect on tab close is best-effort; check HashPack to revoke any remaining connection. A wallet's brand metadata is not proof that the scanned wallet is HashPack; use your intended wallet and verify its prompts. No signer private keys are handled by this app.

The direct SignClient transport is used to keep native claim permissions limited to message signing; the higher-level Hedera AppKit example offers broader wallet functionality we do not need here. Dependencies are pinned: SignClient 2.26.0, qrcode 1.5.4, esbuild 0.28.2. The install-time npm audit found zero known vulnerabilities on 6 November 2026; that is not a security certification. Lifecycle install scripts are disabled.

WalletConnect's current SDK ships under its **WalletConnect Community License**, not this repository's GPL. It remains separately licensed. The builder preserves its full license, qrcode license, and bundle notices; the wallet page exposes them when built and includes the required Reown notice. Review its distribution/use terms before public release; no license compatibility conclusion or relicensing is implied. References: [SDK license](https://github.com/WalletConnect/walletconnect-monorepo/blob/v2.0/LICENSE.md), [Reown project/origin setup](https://docs.reown.com/cloud/relay), [native Hedera RPC](https://docs.reown.com/advanced/multichain/rpc-reference/hedera-rpc).

Additional routes: `/hedera-wallet.mjs`, `/hashpack-ui.mjs`, `/wallet-config.json`, and the four explicit generated runtime/license files. No arbitrary generated-directory access is permitted. The CSP allowlist includes only the configured WalletConnect relay and verify domains, not wildcard Internet access. Production hosting must reproduce the policy. Live CSP compatibility is unverified until an actual pairing can be exercised.

Verification at commit 11 was 20 frontend tests; the current dependency-free and browser totals are above. Real HashPack pairing, mobile/extension behavior, QR rendering, and clipboard/CSP interaction remain unverified because no project ID is configured. Test these after configuration before calling the wallet integration demo-ready. Both cryptographic ownership proofs and the public claim API remain to be implemented. The server-side steward CLI uses Arkiv; see ../claims/README.md.
