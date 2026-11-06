# OSO frontend provenance

Imported/adapted on 6 November 2026. AI assistance: Codex.

- Repository: [shakaleikaumaka/oso-storytelling](https://github.com/shakaleikaumaka/oso-storytelling).
- Exact revision: `b6be898f38df8fff7abc53334b5641a89e31939b`.
- Template: [`nodes/shaka/index.html`](https://github.com/shakaleikaumaka/oso-storytelling/blob/b6be898f38df8fff7abc53334b5641a89e31939b/nodes/shaka/index.html).
- Preserved notices: [NOTICE](third-party/oso-storytelling/NOTICE), [LICENSE](third-party/oso-storytelling/LICENSE), [LICENSE-CONTENT](third-party/oso-storytelling/LICENSE-CONTENT), copied unchanged from that revision.

## Reused and changed

`public/styles.css` adapts the template's color palette, native serif/sans font stacks, gradients, centered hero, content width, section headings, bordered cards, pill links, and dashed onboarding panel. Its comment preserves source attribution and the GPL-3.0-or-later identifier. The container uses a 920-pixel outer maximum including padding; content is approximately the source width.

`public/index.html` adapts the source's hero/profile → songbook → build-your-node structure. New work adds semantic navigation, skip link, sample-state notice, empty songbook, planned onboarding explanation, and native disclosure controls. CSS adds visible focus, mobile stacking, and reduced-motion behavior.

Real artist biography, photographs, songs, lyrics, media files, source `node.json`, third-party embeds, and the remote radio-player script are not imported. They are unnecessary for a local layout foundation and do not establish consent to activate an artist. Sample copy is newly written and explicitly labeled.

`server.mjs` and `test/server.test.mjs` are new work. The server serves an exact asset allowlist on loopback; it has no wallet, backend proxy, persistence, deployment, or payment behavior. Source code and notices are kept outside the served directory.

This import is continuity provenance, not evidence of prior 0G/Hedera integration or proof that the source revision predates the event. Public submission must still disclose reused work and identify actual pre-event history where applicable.

## Subsequent work — commit 09

`public/draft.html`, `public/draft.mjs`, `public/profile-draft.mjs`, and `test/profile-draft.test.mjs` are new local-editor code. New form/preview styles extend the adapted stylesheet; the home page links to the editor. This does not import the upstream garden's signing or storage logic. The preview server now also serves the editor and its two modules from explicit routes. No new source-site content or vendor dependency was added.

## Subsequent work — commits 10–11

Wallet adapters, pages, tests, and runtime/build scripts are new project code. The HashPack bundle uses pinned npm dependencies under their own licenses; it is generated locally and not committed. WalletConnect Community License, qrcode MIT license, and generated package notices are copied/linked by the builder and served through explicit routes. They are not relicensed under the upstream OSO code license. Dependency distribution terms must be reviewed before publication.
