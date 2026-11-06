# Circle frontend demo-readiness repair

Date: 6 November 2026. Branch: `fix/demo-frontend`. Base: `design-circle` at `68184677584916941535fdca909e14ada8fe5e31` (PR #2). AI assistance: Taurus `sysadmin 🫡`.

## Scope and result

This is a tightly scoped frontend correctness repair. It does **not** implement backend claims, payments, ENS, activation, or deployment, and it does not modify `payments/` or `agent/`. Public artist profiles/photos remain preview data, not consent or activated resources.

The local circle now passes its dependency-free regressions and real-browser audit. This is evidence for the **frontend interaction demo only**, not a claim that the full project or wallet integrations are production-ready.

| Audit finding | Repair / regression evidence |
|---|---|
| Wrong-seat center interception: desktop 14/40, mobile 35/40, 320px 39/40 | Replaced transformed 3D buttons with a 2D desktop ring and normal-flow mobile list/grid. Browser hit test: **40/40 correct at each viewport; 120/120 overall; 0 intercepted**. |
| Buttons overridden with `role=listitem` | Native `<ul>/<li>/<button>` structure; browser and static tests reject role overrides. |
| Unnamed mobile search; 40 seat tab stops before search | Visible label remains at every width; search/day/reset precede seats in DOM and tab order. Search is the second Tab stop after the skip link. |
| Fixed finder obstructs CTA | Finder is in normal flow; CTA center hit and horizontal-overflow checks pass at all three viewports. |
| Day and query overwrite each other | One combined state: Nov 3 + Alaska = 0; Nov 4 + Alaska = only Alaska × Subcult. Tested at all three viewports. |
| Spin/reset leaves stale query/highlight | Both reset controls clear query, select all days with `aria-pressed`, restore 40 results, and preserve stable hit geometry. |
| Multi-day artist appears only on day 3 | Explicit `days` arrays; 0xMentalist and daily hosts match every declared day. Undated garden entries use `[]`. |
| No-JS produces zero seats and 0/0 | Static 40-name/set list and source/project links are present; static count is honest, and draft controls remain disabled. |
| Generic “Claim this seat” CTA | **Start a local draft** passes only an exact public roster slug, prefills only that public name, then removes the query. Unknown/arbitrary input prefills nothing. |
| “keeps every cent” conflicts with compute share | Copy states **OSO takes zero cut; planned steward compute share is 3.69%**. |
| Provenance says no real bios/photos imported | `frontend/SOURCE.md` distinguishes the original sample foundation from the later real public circle import, preserves license/maker-rights boundaries, and states that public availability is not activation consent. |
| Existing 20 tests missed frontend behavior | **27/27** unit/data/HTTP tests plus **11/11** browser tests, including 12 axe scans. |

## Hosted review preview + static build — integrated update

Integrated static review: **https://artist-preview-kzu6ctlpau-ffieyo32.taur.link/**. This is separate from the production artist domain and does not imply a PR merge or production deployment.

`node frontend/scripts/build-static.mjs OUTPUT_DIR [--wallet-runtime] [--cname=example.org]` creates `/home`, `/draft`, `/wallets`, and `/arkiv` route directories, copies only public assets, refuses to clean an unmarked output, and writes disabled wallet configuration unless deliberately built otherwise. Two regressions cover routes/assets/disabled config and refusal to erase an unmarked directory. Integrated frontend suite: **33/33** (27 circle repair + 4 Arkiv + 2 static-build tests).

Hosted checks on 6 Nov: `/`, `/home/`, `/draft/`, `/wallets/`, `/arkiv/`, config/modules/photos all returned 200; wallet config remained `{projectId:"",runtimeReady:false,enabled:false}`. A real `/arkiv` read from this public origin confirmed one readonly entity at block **302205**, with no console errors or 375px overflow. No wallet runtime or secret was published.

## Reproduce

From the repository root with Node.js 22.18 or newer:

```sh
npm run test:frontend
npm --prefix frontend ci --ignore-scripts
npm --prefix frontend exec playwright install chromium
npm run test:frontend:browser
```

Optional ignored evidence:

```sh
CIRCLE_BROWSER_REPORT="$PWD/.audit-results/browser-hit-report.json" \
CIRCLE_BROWSER_ARTIFACTS="$PWD/.audit-results" \
npm run test:frontend:browser
```

The JSON contains each viewport's 40 individual center hits and every axe result. Screenshots are saved for desktop 1280×800, mobile 375×812, and small mobile 320×568. Playwright 1.60.0 and axe-core 4.14.0 are pinned development-only dependencies. The browser suite starts and stops its own ephemeral loopback preview server.

### Final observed results

- `npm run test:frontend`: **27 passed, 0 failed**.
- `npm run test:frontend:browser`: **11 passed, 0 failed**.
- Center hit testing: **desktop 40/40, mobile 40/40, 320px 40/40; 0 wrong-seat hits**.
- axe on `/`, `/home`, `/draft`, `/wallets` at all three viewports: **12 scans, 0 violations** for the configured WCAG 2/2.1/2.2 A/AA rules.
- No browser page errors, console errors, failed local requests, or horizontal overflow in the audited flows.
- `git diff --check`: no whitespace errors.

## Explicit remaining boundaries

1. **Static-host headers:** the local Node server sends CSP, `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, and no-store. A 6 November 2026 header check of `https://artist.opensourceorchestra.org/` found that GitHub Pages did not emit the same CSP, nosniff, referrer, or frame headers. This branch does not fix or deploy host headers. Configure an appropriate host/CDN and audit the deployed response separately; do not represent static file deployment alone as a header fix.
2. **Real wallets:** browser tests load `/wallets`, but no real MetaMask extension, Reown project, HashPack pairing, QR/clipboard flow, signature, or chain transaction was exercised. Accounts remain unverified.
3. **No claim authority:** local drafts do not establish identity, consent, ENS ownership, payout ownership, steward activation, persistence, or publication. Unknown slugs are ignored and the transient slug is removed from history.
4. **No full-project certification:** payments/agent/claims behavior and real ENS/Hedera/0G/Arkiv integrations were outside this repair and were not retested here.
5. **Content governance:** public source data may still need human freshness, permission, takedown, and license review. The exact upstream revision for PR #2's circle data/photos was not recorded and is not fabricated.

The original repair opened/approved/merged no PR and deployed nothing. The later integrated review preview is publicly hosted as documented above; production `artist.opensourceorchestra.org` remains unchanged, and PR #3 still requires human review/approval before merge or production deployment.
