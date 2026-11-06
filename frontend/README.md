# Frontend — OSO artist home

A buildless HTML/CSS/JavaScript adaptation of `oso-storytelling/nodes/shaka`. It preserves the existing OSO visual language and offers a sample profile, local draft editor, and separate wallet connections. It does not activate a real artist or simulate a successful claim/payment.

## Run locally

From the repository root, using Node.js 22.18 or newer:

```sh
npm run dev:frontend
```

Open `http://127.0.0.1:4173`. The sample, draft editor, and MetaMask extension adapter need no dependency installation or backend. HashPack requires the optional setup below. The server binds only to loopback. Stop it with Ctrl+C; restart after editing HTML/CSS because assets are loaded at startup. To choose another port, use `PORT=4174 npm run dev:frontend`.

```sh
npm run test:frontend
```

The HTTP test checks public assets/modules, response headers, HEAD requests, rejected write methods, and blocked repository/traversal paths. It requires permission to bind a temporary loopback port. Five additional tests cover draft validation, limits, field whitelisting, Unicode, controls, and literal markup-looking text. The root `npm test` also includes these tests after the existing payments and agent tests.

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

Open `/draft` or choose **Try your profile draft** on the sample page. Enter an artist name and bio, then select **Preview my draft**. Corrections show next to the fields; editing invalidates the previous preview so it cannot silently show stale information. **Discard draft** clears inputs, preview, and errors.

Drafts exist only in the current page's form/DOM. The app clears them on reload and navigation, including return from back/forward cache. There is no browser-storage persistence, URL encoding, export, or server submission. These are application behavior guarantees, not secure memory erasure from the browser/OS. Copy text elsewhere yourself if you need to keep it.

The initial UI limits are 80 units for the name and 1,200 for the bio, counted as UTF-16 code units to match HTML `maxlength`; some emoji use two units. Both fields are required for a preview. Validation trims outer whitespace, normalizes bio line endings, rejects unsupported control characters, and never silently truncates. Artist display names are not ENS labels. User text is assigned with `textContent`, not HTML insertion or automatic linking.

No consent checkbox or claimed flag is generated. A local preview is not identity proof or permission to activate resources. Durable drafts, photos, public profiles, and signed consent are later stages.

## Current behavior and boundaries

- Profile/songbook/onboarding sections, anchor navigation, and native disclosure controls use native HTML without JavaScript.
- Responsive rules, a skip link, visible keyboard focus, and reduced-motion support are present.
- The editor uses two same-origin JavaScript modules. Fields remain disabled until handlers are installed. The inputs have no serialization names, and CSP blocks native form submission; a script-loading failure does not send entered content through a form URL.
- Drafts make no wallet or network calls. Wallet connections are isolated on `/wallets`; neither adapter calls inference, signs a message, or sends a transaction.
- An exact route allowlist serves `/`, `/draft`, `/styles.css`, `/draft.mjs`, and `/profile-draft.mjs`. Other paths return 404 and write methods return 405. CSP permits same-origin scripts/styles but blocks form submissions, inline scripts, and framing. Sample/draft pages block network connections. Only `/wallets` additionally permits its configuration fetch and specific WalletConnect relay/verification endpoints. Repository files are not served.
- This server is a development preview, not the public backend. A future host must configure equivalent headers and separate static assets from private application data.

## Files and attribution

| Path | Purpose |
|---|---|
| `public/index.html` | Semantic, sample artist-home layout |
| `public/styles.css` | Adapted OSO styles and responsive/accessibility additions |
| `public/draft.html`, `public/draft.mjs` | Local editor, error/preview/discard states, and lifecycle cleanup |
| `public/profile-draft.mjs` | Field validation without claim authority |
| `server.mjs` | Dependency-free local preview |
| `test/server.test.mjs` | HTTP boundary regression check |
| `test/profile-draft.test.mjs` | Draft validation regression checks |
| `SOURCE.md` | Exact source revision, reused elements, and modifications |
| `third-party/oso-storytelling/` | Preserved upstream notices and licenses |

See [SOURCE.md](SOURCE.md) before reusing or publishing the adaptation.

## Verification and next features

Syntax and HTTP checks pass. Browser automation was unavailable during implementation: the browser access host failed and native Chrome selection timed out. Desktop/mobile appearance, keyboard navigation, and disclosure interaction still need visual verification. Manual checks: view at desktop and 375-pixel widths; follow every navigation link; Tab to the skip link and disclosures; use Enter/Space to open them; confirm readable wrapping and no horizontal overflow.

Editor manual checks still pending: empty submission focuses the first invalid field; valid multiline text previews literally (including `<img src=x onerror=alert(1)>`); editing hides stale output; discard/reload/back navigation clears data; disabled JavaScript leaves fields disabled. Verify focus/error announcements, mobile layout, and that the network panel contains only local assets and no entered text. Unit tests and source inspection do not substitute for these browser checks.

Wallet proof, consent submission, private profile persistence, ENS issuance, steward chat, and tipping remain unimplemented. Their contracts depend on the selected wallets, ENS parent/permissions, backend host/authentication, and payment teammate. See [integration plan](../docs/FRONTEND-INTEGRATION.md) and [prize strategy](../docs/PRIZE-STRATEGY.md).

## Wallet connection — commit 10

Open `/wallets`. MetaMask extension discovery uses EIP-6963 and only requests account access when you click **Connect MetaMask**. It reads the current account/network, requires Ethereum mainnet for the intended ENS flow, and never requests a signature, payment, or network switch. All displayed addresses remain unverified. Account/network changes clear the selection; stale asynchronous results cannot restore a forgotten or disconnected selection. Forgetting affects this page only, not the wallet's website permissions. No account/session persistence is added.

This first adapter supports desktop injected MetaMask, not mobile relay connections. Provider metadata is self-reported and cannot authenticate the extension; a future server-side signature check is still essential. Provider icons/HTML are never rendered. The initial commit 10 left HashPack unavailable; commit 11 adds the separately configured pairing flow described below.

Added routes: `/wallets`, `/wallets.mjs`, `/ethereum-wallet.mjs`. Commit 11 extends the wallet page policy and exact routes as described below. The draft editor still does not connect wallets; the wallet page does not activate or publish drafts.

Verification: seven new mocked-provider/discovery tests plus the existing suite pass (13 total). Browser extension interaction remains unverified due unavailable browser infrastructure. Manual checks: no permission popup on load; explicit connect opens MetaMask; decline/pending request/wrong network are explained; changing accounts or chain clears the address; Forget while approval is pending prevents a late result from restoring it. No live wallet signature or chain transaction has been performed.

Selected next steps: HashPack native Hedera testnet connection and two server-verified proofs bound to one claim, using Node + PostgreSQL. The owner will create a Reown project ID. ENS parent, host/domain, authentication configuration, and renewal policy remain pending.

Reference APIs checked for this feature: [EIP-6963 discovery](https://eips.ethereum.org/EIPS/eip-6963), [EIP-1193 provider events](https://eips.ethereum.org/EIPS/eip-1193), [MetaMask integration guidance](https://docs.metamask.io/metamask-connect/), [HashPack WalletConnect support](https://docs.hashpack.app/dapp-developers/walletconnect), and [Hedera connector README](https://github.com/hashgraph/hedera-wallet-connect/blob/main/README.md).

## HashPack pairing — commit 11

On `/wallets`, explicitly choose **Connect HashPack** after configuration. A locally rendered QR code or copied `wc:` URI pairs with HashPack. Do not share pairing URIs: they contain session material. The SDK is loaded only on connect, telemetry is disabled, and its key/value store is held in memory rather than IndexedDB/localStorage. A relay connection is still required; this is not offline pairing.

The requested namespace is native `hedera:testnet`, with only `hedera_signMessage` permission and account/network events. No transfer or transaction method is requested, and this version does not invoke message signing either. After approval, explicitly select a numeric testnet account. EVM addresses, mainnet accounts, aliases/checksummed IDs, expired sessions, and missing message capability are rejected. Numeric account IDs are retained as strings. Connected selections are unverified and are never copied into authoritative payout records.

Cancel/disconnect clears local selection and QR immediately, attempts session/pairing cleanup, and rejects late approvals. Session changes clear selection and require reconnection. Remote disconnect on tab close is best-effort; check HashPack to revoke any remaining connection. A wallet's brand metadata is not proof that the scanned wallet is HashPack; use your intended wallet and verify its prompts. No signer private keys are handled by this app.

The direct SignClient transport is used to keep native claim permissions limited to message signing; the higher-level Hedera AppKit example offers broader wallet functionality we do not need here. Dependencies are pinned: SignClient 2.26.0, qrcode 1.5.4, esbuild 0.28.2. The install-time npm audit found zero known vulnerabilities on 6 November 2026; that is not a security certification. Lifecycle install scripts are disabled.

WalletConnect's current SDK ships under its **WalletConnect Community License**, not this repository's GPL. It remains separately licensed. The builder preserves its full license, qrcode license, and bundle notices; the wallet page exposes them when built and includes the required Reown notice. Review its distribution/use terms before public release; no license compatibility conclusion or relicensing is implied. References: [SDK license](https://github.com/WalletConnect/walletconnect-monorepo/blob/v2.0/LICENSE.md), [Reown project/origin setup](https://docs.reown.com/cloud/relay), [native Hedera RPC](https://docs.reown.com/advanced/multichain/rpc-reference/hedera-rpc).

Additional routes: `/hedera-wallet.mjs`, `/hashpack-ui.mjs`, `/wallet-config.json`, and the four explicit generated runtime/license files. No arbitrary generated-directory access is permitted. The CSP allowlist includes only the configured WalletConnect relay and verify domains, not wildcard Internet access. Production hosting must reproduce the policy. Live CSP compatibility is unverified until an actual pairing can be exercised.

Verification: the bundle builds locally; all 20 frontend tests pass, including six new mocked native-session regressions and configuration/path checks. Real HashPack pairing, mobile/extension behavior, QR rendering, and clipboard/CSP interaction remain unverified: a project ID is unavailable and browser automation is down. Test these after configuration before calling this integration demo-ready. Both cryptographic ownership proofs and the Node/PostgreSQL claim backend remain to be implemented.
