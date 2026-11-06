/* ── GARDEN KEYS · overlay · the artists' own words, laid over the stewards' base data ─────────
   Shared by app.js (published edits.json) and keys.js (local preview). Pure functions, no DOM.
   An artist may only ever change these five things; everything else stays with the stewards.
   by the ʻohana — Shaka's AI family · CC0 */
export const LIMITS = { tagline: 140, headline: 90, bio: 600, glyph: 4, links: 6, label: 24, url: 300, title: 80, body: 1200 };
export const EDITABLE = ['tagline', 'headline', 'bio', 'links', 'glyph'];

// control chars + zero-width / bidi tricks out; newlines kept only where asked
export function clean(s, max, multiline = false) {
  let t = String(s == null ? '' : s).normalize('NFC').replace(/\r\n?/g, '\n');
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g, '');
  if (!multiline) t = t.replace(/\s+/g, ' ');
  else t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return [...t.trim()].slice(0, max).join('');
}
export function cleanLinks(ls) {
  const out = [];
  for (const l of Array.isArray(ls) ? ls : []) {
    if (!l || out.length >= LIMITS.links) continue;
    const label = clean(l.label, LIMITS.label), url = String(l.url || '').trim();
    if (!label || url.length > LIMITS.url || /\s/.test(url)) continue;
    try { const u = new URL(url); if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) continue; out.push({ label, url: u.href }); } catch { /* not a link */ }
  }
  return out;
}
export const cpLen = (s) => [...String(s || '')].length;

export function applyFields(a, f) {
  if (!a || !f) return;
  if (!a.__base) a.__base = { tagline: a.tagline, headline: a.headline, glyph: a.glyph, links: a.links, bio: a.bio };
  for (const k of EDITABLE) {
    if (!(k in f)) continue;
    const v = f[k];
    if (k === 'links') { const c = cleanLinks(v); a.links = c.length ? c : a.__base.links; }
    else if (k === 'bio') { const c = clean(v, LIMITS.bio, true); a.bio = c || a.__base.bio; }
    else { const c = clean(v, LIMITS[k]); a[k] = c || a.__base[k]; }
  }
}
export function mergeEdits(BY, edits) {
  if (!edits || typeof edits !== 'object') return 0;
  let n = 0;
  for (const [slug, e] of Object.entries(edits)) if (BY[slug] && e && typeof e === 'object') { applyFields(BY[slug], e); n++; }
  return n;
}

// local preview: what an artist just sent stays visible in THEIR browser until the stewards' copy catches up (or 24 h)
const LS = 'oso-garden-local-v1';
export function saveLocal(slug, seq, fields) {
  try { const d = JSON.parse(localStorage.getItem(LS) || '{}'); d[slug] = { seq, until: Date.now() + 864e5, fields: { ...(d[slug]?.fields || {}), ...fields } }; localStorage.setItem(LS, JSON.stringify(d)); } catch { /* private mode */ }
}
export function applyLocal(BY, edits) {
  let touched = [];
  try {
    const d = JSON.parse(localStorage.getItem(LS) || '{}'); let dirty = false;
    for (const [slug, v] of Object.entries(d)) {
      if (!BY[slug] || v.until < Date.now() || (edits && edits[slug] && (edits[slug].seq || 0) >= v.seq)) { delete d[slug]; dirty = true; continue; }
      applyFields(BY[slug], v.fields); touched.push(slug);
    }
    if (dirty) localStorage.setItem(LS, JSON.stringify(d));
  } catch { /* nothing saved */ }
  return touched;
}

// a friendly pre-flight (the stewards' processor runs the strict one): private data is never published
export function privacyIssue(text) {
  const t = String(text || '');
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(t)) return 'an email address';
  if (/\b[a-z]{3}-[a-z]{4}-[a-z]{3}\b/i.test(t)) return 'a meeting code';
  if (/\+?\d[\d\s\-().]{8,}\d/.test(t.replace(/\d{4}-\d{2}-\d{2}/g, ''))) return 'a long number that looks like a phone number';
  return '';
}
