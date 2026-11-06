# OSO frontend provenance

Imported/adapted on 6 November 2026. AI assistance: Codex.

- Repository: [shakaleikaumaka/oso-storytelling](https://github.com/shakaleikaumaka/oso-storytelling).
- Exact revision: `b6be898f38df8fff7abc53334b5641a89e31939b`.
- Template: [`nodes/shaka/index.html`](https://github.com/shakaleikaumaka/oso-storytelling/blob/b6be898f38df8fff7abc53334b5641a89e31939b/nodes/shaka/index.html).
- Preserved notices: [NOTICE](third-party/oso-storytelling/NOTICE), [LICENSE](third-party/oso-storytelling/LICENSE), [LICENSE-CONTENT](third-party/oso-storytelling/LICENSE-CONTENT), copied unchanged from that revision.

## Reused and changed

`public/styles.css` adapts the template's color palette, native serif/sans font stacks, gradients, centered hero, content width, section headings, bordered cards, pill links, and dashed onboarding panel. Its comment preserves source attribution and the GPL-3.0-or-later identifier. The container uses a 920-pixel outer maximum including padding; content is approximately the source width.

`public/home.html` (the original `public/index.html` in commit 07) adapts the source's hero/profile → songbook → build-your-node structure. New work adds semantic navigation, skip link, sample-state notice, empty songbook, planned onboarding explanation, and native disclosure controls. CSS adds visible focus, mobile stacking, and reduced-motion behavior.

For that commit-07 sample-home foundation only, real artist biography, photographs, songs, lyrics, media files, source `node.json`, third-party embeds, and the remote radio-player script were not imported. The later circle import is documented separately below; the original sentence must not be read as applying to the current circle. Sample copy remains newly written and explicitly labeled.

`server.mjs` and `test/server.test.mjs` are new work. The server serves an exact asset allowlist on loopback; it has no backend proxy, persistence, deployment, or payment behavior. Later wallet adapters are isolated static modules and do not make the server a wallet service. Source code and notices are kept outside the served directory.

This import is continuity provenance, not evidence of prior 0G/Hedera integration or proof that the source revision predates the event. Public submission must still disclose reused work and identify actual pre-event history where applicable.

## Subsequent work — commit 09

`public/draft.html`, `public/draft.mjs`, `public/profile-draft.mjs`, and `test/profile-draft.test.mjs` are new local-editor code. New form/preview styles extend the adapted stylesheet; the home page links to the editor. This does not import the upstream garden's signing or storage logic. The preview server now also serves the editor and its two modules from explicit routes. No new source-site content or vendor dependency was added.

## Subsequent work — commits 10–11

Wallet adapters, pages, tests, and runtime/build scripts are new project code. The HashPack bundle uses pinned npm dependencies under their own licenses; it is generated locally and not committed. WalletConnect Community License, qrcode MIT license, and generated package notices are copied/linked by the builder and served through explicit routes. They are not relicensed under the upstream OSO code license. Dependency distribution terms must be reviewed before publication.

## Public circle import — `design-circle` / PR #2

Commit `68184677584916941535fdca909e14ada8fe5e31` replaced the front door with a circle inspired by `https://opensourceorchestra.org/garden/circle/`. It imported public roster data from `garden/circle/data/artists.json` into `public/circle/artists.mjs`, including real artist names, public biographies/taglines/headlines, set descriptions, links, and 23 JPEGs under `public/circle/img/`. Perrie was omitted pending confirmation. The earlier `b6be898…` revision identifies the `nodes/shaka` template only; the exact upstream revision used for the later circle data/photos was not recorded in PR #2 and is not invented here.

The preserved source NOTICE licenses repository content as CC0 1.0 Universal unless a file or its maker says otherwise; makers' rights and carve-outs stand. CC0 does not waive every possible privacy/publicity right, and the preserved content license expressly does not obtain consent for every use. Public availability of a name, biography, photograph, or link is **not** consent to claim/activate a hackathon profile, issue an ENS name, assign a payout wallet, or bind a steward. All imported material remains public preview data only. Removal/consent concerns require a human review and source-level correction, not an automatic activation inference.

The circle CSS/HTML adapts the source's night/plum/ember/gold palette, photo arc, elliptical ring, seat pills, and profile-dialog motif. The interactive implementation is project code. No remote source script, third-party embed, font, or runtime media host is imported; images are served locally through exact routes.

## Demo correctness and accessible handoff — `fix/demo-frontend`

The circle repair replaces 3D-transformed button hit areas with reliable 2D desktop positions and an ordinary flowing grid/list below 1000 pixels. Native list items contain native buttons; search/day/reset controls precede seats, the search label remains visible, filters have `aria-pressed`, nonmatches are semantically hidden, and the result count is a polite status. A static 40-name/set no-JS fallback and project links remain in `index.html`.

The ambiguous scalar `day` field is replaced by explicit `days` arrays. This records genuine daily/multi-day appearances and leaves undated garden entries undated; it does not add new performance authority. One combined day/query state drives all results and both reset paths.

Profile CTAs now say **Start a local draft**, not **Claim this seat**. They pass only a roster slug; `draft.mjs` resolves an exact public name, prefills no other field, and removes the transient query from browser history. Arbitrary URL content is not rendered or imported. Copy states the planned 3.69% steward compute share and OSO's zero cut rather than “keeps every cent.” No claim/activation/backend/payment behavior was added.

`circle-state.mjs`, its unit tests, and `browser/circle.browser.test.mjs` are new project code. Playwright and axe-core are pinned development-only audit dependencies, not runtime application bundles. Verification commands and current results are in [README.md](README.md) and [../docs/FRONTEND-DEMO-READINESS.md](../docs/FRONTEND-DEMO-READINESS.md).
