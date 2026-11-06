# Frontend — OSO artist home

A buildless HTML/CSS adaptation of `oso-storytelling/nodes/shaka`. It preserves the existing OSO visual language and currently shows a clearly labeled sample profile. It does not activate a real artist or simulate a successful claim/payment.

## Run locally

From the repository root, using Node.js 22.18 or newer:

```sh
npm run dev:frontend
```

Open `http://127.0.0.1:4173`. No dependency installation, wallet, API key, or backend is needed. The server binds only to loopback. Stop it with Ctrl+C; restart after editing HTML/CSS because assets are loaded at startup. To choose another port, use `PORT=4174 npm run dev:frontend`.

```sh
npm run test:frontend
```

The HTTP test checks public assets, response headers, HEAD requests, rejected write methods, and blocked repository/traversal paths. It requires permission to bind a temporary loopback port. The root `npm test` also includes this test after the existing payments and agent tests.

## Current behavior and boundaries

- Profile/songbook/onboarding sections, anchor navigation, and native disclosure controls use native HTML without JavaScript.
- Responsive rules, a skip link, visible keyboard focus, and reduced-motion support are present.
- No form data, local storage, remote scripts/fonts/media, cookies, wallet calls, inference calls, or transactions.
- An exact route allowlist serves only `/` and `/styles.css`. Other paths return 404 and write methods return 405. The preview sends a restrictive Content Security Policy and does not serve repository files.
- This server is a development preview, not the public backend. A future host must configure equivalent headers and separate static assets from private application data.

## Files and attribution

| Path | Purpose |
|---|---|
| `public/index.html` | Semantic, sample artist-home layout |
| `public/styles.css` | Adapted OSO styles and responsive/accessibility additions |
| `server.mjs` | Dependency-free local preview |
| `test/server.test.mjs` | HTTP boundary regression check |
| `SOURCE.md` | Exact source revision, reused elements, and modifications |
| `third-party/oso-storytelling/` | Preserved upstream notices and licenses |

See [SOURCE.md](SOURCE.md) before reusing or publishing the adaptation.

## Verification and next features

Syntax and HTTP checks pass. Browser automation was unavailable during implementation: the browser access host failed and native Chrome selection timed out. Desktop/mobile appearance, keyboard navigation, and disclosure interaction still need visual verification. Manual checks: view at desktop and 375-pixel widths; follow every navigation link; Tab to the skip link and disclosures; use Enter/Space to open them; confirm readable wrapping and no horizontal overflow.

Wallet proof, consent submission, private profile persistence, ENS issuance, steward chat, and tipping remain unimplemented. Their contracts depend on the selected wallets, ENS parent/permissions, backend host/authentication, and payment teammate. See [integration plan](../docs/FRONTEND-INTEGRATION.md) and [prize strategy](../docs/PRIZE-STRATEGY.md).
