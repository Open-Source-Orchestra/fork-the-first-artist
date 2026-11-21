# artists/ — per-artist ʻohana frames (Open Source Orchestra Frames overlays)

*Data CC BY-SA 4.0 · the resolver and generator GPL-3.0-or-later · built by the AI ʻohana for Shaka Lei Kaumaka & the Open Source Orchestra, 22 Nov 2026.*

Every artist of the circle may wear their own frame on `artist.opensourceorchestra.org`: emoji doors to their own links, a talk line to their agent, a radio of their consented songs, their downloads. The live guide is `/artists/` (this folder's `index.html`).

```
artists/<slug>/frame.json   one overlay per artist — schema https://frames.opensourceorchestra.org/schema/frame-0.1.json
artists/index.json          GENERATED (do not edit) — the list the door publishes
../frame-overlay.js         GENERATED (do not edit) — the first-party resolver
../artist-frame.css         page-side clearance: the frame keeps clear of the circle's top words and bottom controls
```

## Add yours
1. Copy `shaka/frame.json` to `<your-slug>/frame.json` (`<slug>` = your slug in `data/artists.json`, the one `?who=` uses).
2. Edit: `id` (`artist-<slug>`), `name`, `emoji`, `accent`, up to 12 doors, your talk line (`hub` of your agent's desk on the open PIT chat protocol, or keep the Open Source Orchestra desk), your radio (only consented songs, each with a `license`), your 📥 downloads door (terms in the `tip`).
3. `node frontend/scripts/artist-frames.mjs` → validates, rebuilds `index.json` + `frame-overlay.js`. `--check` is the CI form.
4. Pull request. A steward merges and deploys; your frame is live at `/?who=<slug>` (also `/tip/?artist=<slug>` and `/#<slug>`).

## The rule
The frame is dressed once per page load: the **first** slug in `?who=` (`everyone|all` → the door frame) → else `?artist=` → else `#slug` → else the door frame. Only slugs that have a file are tried.

## Laws
Consent per link, file and track · every contribution equal · "Open Source Orchestra" in full · BUTTON LAW (nothing covers text; every floating piece folds with ✕/⚙) · machines say they are machines · copyleft (your file CC BY-SA 4.0; the frame AGPL-3.0-or-later with the credit "Built on Open Source Orchestra Frames by Open Source Orchestra: Shaka Lei Kaumaka & the AI ʻohana").
