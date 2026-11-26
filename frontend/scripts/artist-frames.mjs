#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
/** Artist frames (Open Source Orchestra Frames overlays) for the artist door.
 *  Reads  <public>/artists/<slug>/frame.json  → checks each file (structure, https-only, no scripts, sizes)
 *  Writes <public>/artists/index.json          (the list the door publishes)
 *         <public>/frame-overlay.js            (first-party resolver: ?who= first slug → ?artist= → #slug → window.__framesOverlay)
 *  Usage: node frontend/scripts/artist-frames.mjs [publicDir=frontend/public] [--check]
 *  Never fetches anything. Rules: https only · at most 12 doors per overlay · Open Source Orchestra written in full. */
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const check = args.includes('--check');
const pub = resolve(args.find((a) => !a.startsWith('--')) ?? fileURLToPath(new URL('../public/', import.meta.url)));
const root = join(pub, 'artists');
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const KINDS = new Set(['door', 'pill', 'globe', 'theater', 'totem', 'chat', 'radio', 'signature', 'tour', 'spot']);
const SLOTS = new Set(['top-left', 'left', 'bottom-left', 'bottom-right', 'right', 'top-right', 'overlay']);
const errors = [];
const err = (slug, m) => errors.push(`${slug}: ${m}`);

function checkUrl(slug, where, u) {
  if (typeof u !== 'string') return err(slug, `${where}: url must be a string`);
  if (!/^https:\/\/[^\s"'<>]+$/.test(u) && !/^\/[^\s"'<>]*$/.test(u)) err(slug, `${where}: only https:// or same-origin /paths (${u.slice(0, 60)})`);
}
function checkItems(slug, slot, items) {
  let doors = 0;
  for (const it of items) {
    if (!it || typeof it !== 'object') { err(slug, `${slot}: item is not an object`); continue; }
    if (!KINDS.has(it.kind)) err(slug, `${slot}: unknown kind "${it.kind}"`);
    if (it.id != null && !/^[a-z0-9][a-z0-9-]{0,31}$/.test(String(it.id))) err(slug, `${slot}: bad id "${it.id}"`);
    if (it.kind === 'door') { doors++; checkUrl(slug, `${slot}/${it.id || '?'}.href`, it.href); if (typeof it.label !== 'string' || !it.label.trim()) err(slug, `${slot}/${it.id}: door needs a label`); }
    if (it.kind === 'chat') checkUrl(slug, `${slot}/chat.hub`, it.hub);
    if (it.kind === 'radio') {
      if (!Array.isArray(it.tracks) || !it.tracks.length) err(slug, `${slot}/radio: tracks[] required`);
      else for (const t of it.tracks) { checkUrl(slug, `radio track "${t.title}".src`, t.src); if (!t.license) err(slug, `radio track "${t.title}": license required (consent law)`); if (!t.artist && !t.credit) err(slug, `radio track "${t.title}": artist or credit required`); }
    }
    if (it.kind === 'signature' && it.src) checkUrl(slug, `${slot}/signature.src`, it.src);
    for (const k of ['tip', 'label', 'greeting']) if (typeof it[k] === 'string' && /\bOSO\b/.test(it[k])) err(slug, `${slot}/${it.id}: write "Open Source Orchestra" in full (found "OSO" in ${k})`);
  }
  return doors;
}

const found = [];
let dirs = [];
try { dirs = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
for (const slug of dirs) {
  const file = join(root, slug, 'frame.json');
  try { await stat(file); } catch { continue; }
  if (!SLUG.test(slug)) { err(slug, 'folder name must be a garden slug (a-z 0-9 -)'); continue; }
  const raw = await readFile(file, 'utf8');
  if (raw.length > 40_000) err(slug, `frame.json is ${raw.length} bytes (> 40 KB)`);
  if (/<script|javascript:|on[a-z]+=/i.test(raw)) err(slug, 'no scripts or handlers in a frame (it is data)');
  let d; try { d = JSON.parse(raw); } catch (e) { err(slug, `invalid JSON: ${e.message}`); continue; }
  if (d.frame !== 'osoframes/0.1') err(slug, '"frame" must be "osoframes/0.1"');
  if (typeof d.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(d.id)) err(slug, '"id" required (a-z 0-9 -)');
  if (d.accent != null && !/^#[0-9a-fA-F]{6}$/.test(d.accent)) err(slug, '"accent" must be #rrggbb');
  if (d.credit && Array.isArray(d.credit.add) === false) err(slug, '"credit.add" must be a list of names');
  if (d.extends != null) checkUrl(slug, 'extends', d.extends);
  let doors = 0;
  if (d.slots && typeof d.slots === 'object') {
    for (const [slot, v] of Object.entries(d.slots)) {
      if (!SLOTS.has(slot)) { err(slug, `unknown slot "${slot}"`); continue; }
      if (Array.isArray(v)) doors += checkItems(slug, slot, v);
      else if (v && typeof v === 'object') {
        for (const op of ['prepend', 'append', 'replace']) if (Array.isArray(v[op])) doors += checkItems(slug, `${slot}.${op}`, v[op]);
        if (v.set && typeof v.set === 'object') for (const [id, patch] of Object.entries(v.set)) { if (patch && typeof patch.href === 'string') checkUrl(slug, `${slot}.set.${id}.href`, patch.href); if (patch && typeof patch.hub === 'string') checkUrl(slug, `${slot}.set.${id}.hub`, patch.hub); }
      } else err(slug, `slot "${slot}" must be a list or an ops object`);
    }
  } else err(slug, '"slots" required');
  if (doors > 12) err(slug, `${doors} doors (max 12 — the rails are a frame, not a menu)`);
  found.push({ slug, id: d.id, name: d.name ?? slug, emoji: d.emoji ?? '', accent: d.accent ?? '', doors, file: `/artists/${slug}/frame.json`, bytes: raw.length });
}

if (errors.length) { console.error('✗ artist frames:\n  ' + errors.join('\n  ')); process.exit(1); }

const index = {
  frame: 'osoframes/0.1',
  built: 'by frontend/scripts/artist-frames.mjs — do not edit; add artists/<slug>/frame.json instead',
  license: 'CC-BY-SA-4.0',
  credit: 'Built on Open Source Orchestra Frames by Open Source Orchestra: Shaka Lei Kaumaka & the AI ʻohana (https://opensourceorchestra.org)',
  how: 'https://artist.opensourceorchestra.org/artists/',
  rule: 'the frame is dressed once per page load: ?who= first slug → ?artist= → #slug → the door frame; ?who=everyone|all = the door frame',
  count: found.length,
  artists: found,
};
const framed = Object.fromEntries(found.map((f) => [f.slug, 1]));
const resolver = `/*! artist frames resolver · Open Source Orchestra Frames overlays · GPL-3.0-or-later · built by frontend/scripts/artist-frames.mjs (do not edit)
 *  Rule: the frame is dressed ONCE per page load for the FIRST slug in ?who= (?who=everyone|all → the door frame), else ?artist=, else #slug.
 *  Only slugs with artists/<slug>/frame.json (listed here) are tried, so a page never asks for a file that is not there. */
(function () {
  var FRAMED = ${JSON.stringify(framed)};
  try {
    var p = new URLSearchParams(location.search), who = (p.get('who') || '').split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean), slug = '';
    if (who.length) slug = (who[0] === 'everyone' || who[0] === 'all') ? '' : who[0];
    else if (p.get('artist')) slug = String(p.get('artist')).trim().toLowerCase();
    else if (location.hash.length > 1) slug = location.hash.slice(1).toLowerCase();
    if (/^[a-z0-9-]{1,60}$/.test(slug) && FRAMED[slug] === 1 && window.__framesOverlay == null) window.__framesOverlay = '/artists/' + slug + '/frame.json';
  } catch (e) {}
  // The circle's own chrome is two full-width fixed decks (#top words, #bottom controls). The frame keeps clear of small corner
  // widgets by itself, not of full-width bars — so the page tells it where they are: --artist-top / --artist-deck (read by
  // /artist-frame.css, which lifts the frame's corner slots, and with them the rails, clear of both decks). Pages without decks → 0.
  function decks() {
    try {
      var top = document.getElementById('top'), bot = document.getElementById('bottom'), rs = document.documentElement.style;
      var th = top && getComputedStyle(top).position === 'fixed' ? Math.ceil(top.getBoundingClientRect().bottom) : 0;
      var bh = bot && getComputedStyle(bot).position === 'fixed' ? Math.ceil(innerHeight - bot.getBoundingClientRect().top) : 0;
      rs.setProperty('--artist-top', (th > 0 && th < innerHeight * 0.45 ? th : 0) + 'px');
      rs.setProperty('--artist-deck', (bh > 0 && bh < innerHeight * 0.45 ? bh : 0) + 'px');
    } catch (e) {}
  }
  decks(); addEventListener('resize', decks); addEventListener('load', decks); setTimeout(decks, 600);
  // BUTTON LAW nudge: the circle opens right-side drawers (.panel.open) by class; the frame re-measures on resize, so send one.
  try {
    if (!window.MutationObserver) return;
    var t = 0;
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) { var el = ms[i].target; if (el === document.body || (el.classList && el.classList.contains('panel'))) { clearTimeout(t); t = setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 380); return; } }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'], subtree: true });
  } catch (e) {}
})();
`;
const idxPath = join(root, 'index.json'), resPath = join(pub, 'frame-overlay.js');
const idxText = JSON.stringify(index, null, 1) + '\n';
if (check) {
  let same = true;
  try { same = (await readFile(idxPath, 'utf8')) === idxText && (await readFile(resPath, 'utf8')) === resolver; } catch { same = false; }
  if (!same) { console.error('✗ artists/index.json or frame-overlay.js is stale — run node frontend/scripts/artist-frames.mjs'); process.exit(1); }
  console.log(`✓ ${found.length} artist frame(s) valid; index + resolver up to date`);
} else {
  await writeFile(idxPath, idxText);
  await writeFile(resPath, resolver);
  console.log(`✓ ${found.length} artist frame(s): ${found.map((f) => f.slug).join(', ') || '—'} → artists/index.json + frame-overlay.js`);
}
