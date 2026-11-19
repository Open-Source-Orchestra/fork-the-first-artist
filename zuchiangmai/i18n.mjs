/* SPDX-License-Identifier: GPL-3.0-or-later — made by the AI ʻohana for the Open Source Orchestra
   (Fork the First Artist · Zu Chiang Mai bubble). Words: CC BY-SA 4.0.
   ── three voices for the bubble: English · ภาษาไทย · 中文 ─────────────────────────
   English is read straight from the page (the HTML is the source), so it is never duplicated.
   Thai is reviewed by MALI 🇹🇭 and Chinese by MING 🇨🇳 (the ʻohana's language desks).
   Names stay as they are: Open Source Orchestra, ʻohana, 4Seas, Zu Chiang Mai, Kala, U·BASS.
   Also honours the fleet-wide ʻŌlelo choice: ?olelo=th / ?olelo=zh-CN arrive as Thai / Chinese. */
import { TH, ZH } from './i18n-strings.mjs';

const TABLES = { en: {}, th: TH, zh: ZH };
const LANGS = ['en', 'th', 'zh'];
const HTML_LANG = { en: 'en', th: 'th', zh: 'zh-Hans' };
const KEY = 'zcm_lang_v1';
let lang = 'en';
const listeners = new Set();

/** Pick the starting language: ?lang= → ?olelo= → saved choice → the browser's own language → English. */
export function initialLang() {
  const p = new URLSearchParams(location.search);
  const norm = (v) => {
    v = String(v || '').toLowerCase();
    if (v.startsWith('th')) return 'th';
    if (v.startsWith('zh')) return 'zh';
    if (v.startsWith('en')) return 'en';
    return null;
  };
  let saved = null; try { saved = localStorage.getItem(KEY); } catch {}
  return norm(p.get('lang')) || norm(p.get('olelo')) || norm(saved)
    || norm((navigator.languages || [navigator.language || ''])[0]) || 'en';
}

/** Read the English source straight out of the page, once, before any switch. */
export function captureEnglish(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { const k = el.dataset.i18n; if (!(k in TABLES.en)) TABLES.en[k] = el.textContent; });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { const k = el.dataset.i18nHtml; if (!(k in TABLES.en)) TABLES.en[k] = el.innerHTML; });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { const k = 'aria.' + el.dataset.i18nAria; if (!(k in TABLES.en)) TABLES.en[k] = el.getAttribute('aria-label') || ''; });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { const k = el.dataset.i18nPh; if (!(k in TABLES.en)) TABLES.en[k] = el.getAttribute('placeholder') || ''; });
}

/** t(key, englishFallback, vars) — vars fill {name} slots. */
export function t(key, fallback = '', vars = null) {
  let s = TABLES[lang]?.[key] ?? TABLES.en[key] ?? fallback ?? key;
  if (TABLES.en[key] === undefined && fallback) TABLES.en[key] = fallback;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

export function getLang() { return lang; }

export function applyI18n(root = document) {
  const pick = (k) => TABLES[lang]?.[k] ?? TABLES.en[k];
  root.querySelectorAll('[data-i18n]').forEach((el) => { const v = pick(el.dataset.i18n); if (v != null) el.textContent = v; });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { const v = pick(el.dataset.i18nHtml); if (v != null) el.innerHTML = v; });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { const v = pick('aria.' + el.dataset.i18nAria); if (v != null) el.setAttribute('aria-label', v); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { const v = pick(el.dataset.i18nPh); if (v != null) el.setAttribute('placeholder', v); });
  document.documentElement.lang = HTML_LANG[lang];
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
}

export function setLang(next, { save = true } = {}) {
  if (!LANGS.includes(next)) next = 'en';
  lang = next;
  if (save) { try { localStorage.setItem(KEY, next); } catch {} }
  applyI18n();
  listeners.forEach((fn) => { try { fn(lang); } catch (e) { console.warn(e); } });
}

export function onLang(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** wire every [data-lang] button on the page */
export function bindLangButtons() {
  document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
}
