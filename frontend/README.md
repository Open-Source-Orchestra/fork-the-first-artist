# Frontend — OSO artist home

A buildless HTML/CSS/JavaScript adaptation of `oso-storytelling/nodes/shaka`. It preserves the existing OSO visual language and offers a sample profile plus a local name/bio draft editor. It does not activate a real artist or simulate a successful claim/payment.

## Run locally

From the repository root, using Node.js 22.18 or newer:

```sh
npm run dev:frontend
```

Open `http://127.0.0.1:4173`. No dependency installation, wallet, API key, or backend is needed. The server binds only to loopback. Stop it with Ctrl+C; restart after editing HTML/CSS because assets are loaded at startup. To choose another port, use `PORT=4174 npm run dev:frontend`.

```sh
npm run test:frontend
```

The HTTP test checks public assets/modules, response headers, HEAD requests, rejected write methods, and blocked repository/traversal paths. It requires permission to bind a temporary loopback port. Five additional tests cover draft validation, limits, field whitelisting, Unicode, controls, and literal markup-looking text. The root `npm test` also includes these tests after the existing payments and agent tests.

## Draft your profile

Open `/draft` or choose **Try your profile draft** on the sample page. Enter an artist name and bio, then select **Preview my draft**. Corrections show next to the fields; editing invalidates the previous preview so it cannot silently show stale information. **Discard draft** clears inputs, preview, and errors.

Drafts exist only in the current page's form/DOM. The app clears them on reload and navigation, including return from back/forward cache. There is no browser-storage persistence, URL encoding, export, or server submission. These are application behavior guarantees, not secure memory erasure from the browser/OS. Copy text elsewhere yourself if you need to keep it.

The initial UI limits are 80 units for the name and 1,200 for the bio, counted as UTF-16 code units to match HTML `maxlength`; some emoji use two units. Both fields are required for a preview. Validation trims outer whitespace, normalizes bio line endings, rejects unsupported control characters, and never silently truncates. Artist display names are not ENS labels. User text is assigned with `textContent`, not HTML insertion or automatic linking.

No consent checkbox or claimed flag is generated. A local preview is not identity proof or permission to activate resources. Durable drafts, photos, public profiles, and signed consent are later stages.

## Current behavior and boundaries

- Profile/songbook/onboarding sections, anchor navigation, and native disclosure controls use native HTML without JavaScript.
- Responsive rules, a skip link, visible keyboard focus, and reduced-motion support are present.
- The editor uses two same-origin JavaScript modules. Fields remain disabled until handlers are installed. The inputs have no serialization names, and CSP blocks native form submission; a script-loading failure does not send entered content through a form URL.
- No persistent browser storage, remote scripts/fonts/media, cookies, wallet calls, inference calls, or transactions.
- An exact route allowlist serves `/`, `/draft`, `/styles.css`, `/draft.mjs`, and `/profile-draft.mjs`. Other paths return 404 and write methods return 405. CSP permits same-origin scripts/styles but blocks network connections, form submissions, inline scripts, and framing. Repository files are not served.
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
