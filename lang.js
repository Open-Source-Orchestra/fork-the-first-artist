/*! ʻŌLELO · the ʻohana language bridge · v1.3 · CC0 · built by the ʻohana (machines, not people)
 *
 *  One line on any door:
 *    <script src="https://lang.opensourceorchestra.org/lang.js" async></script>
 *
 *  Choose a language ONCE — on shakaleikaumaka.com or any other ʻohana door — and it travels with you:
 *    · links to every family door carry ?olelo=<code> (added the moment a language is chosen)
 *    · doors opened inside a door (iframes, the open-road overlay) are told by postMessage, both ways
 *    · each door remembers it (localStorage 'olelo'); the old 🌐 corner button (otr / googtrans cookie) is adopted
 *  Translation: hand-made versions first (native EN/中文 toggles), otherwise Google Translate —
 *  which is loaded ONLY after a visitor has chosen a language. Default visitors make zero extra requests.
 *  No trackers. Respects prefers-reduced-motion. Per-door options on the script tag:
 *    data-top="120"  data-left="10"  data-side="right"  data-family="extra.host other.host"  data-button="off"
 */
(function () {
  'use strict';
  if (window.__olelo) return;
  window.__olelo = 1;

  var VERSION = '1.3.1';
  var KEY = 'olelo';          // localStorage key (per door)
  var PARAM = 'olelo';        // URL parameter that carries the choice between doors
  var HOME = 'https://lang.opensourceorchestra.org/';
  var GT_SRC = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
  var doc = document, html = doc.documentElement;
  var me = doc.currentScript || (function () { var s = doc.querySelectorAll('script[src*="lang.js"]'); return s[s.length - 1]; })();
  function opt(name) { return me && me.getAttribute ? me.getAttribute('data-' + name) : null; }

  // ── languages ── [code (Google Translate code), native label, flag, chip]
  var MAIN = [
    ['haw', 'ʻŌlelo Hawaiʻi', '🌺', 'ʻŌ'],
    ['en', 'English', '🇺🇸', 'EN'],
    ['zh-CN', '中文（简体）', '🇨🇳', '中'],
    ['es', 'Español', '🇪🇸', 'ES'],
    ['hi', 'हिन्दी', '🇮🇳', 'हि'],
    ['th', 'ไทย', '🇹🇭', 'ไท'],
    ['ja', '日本語', '🇯🇵', '日'],
    ['ar', 'العربية', '🇸🇦', 'ع'],
    ['fr', 'Français', '🇫🇷', 'FR'],
    ['pt', 'Português', '🇧🇷', 'PT'],
    ['de', 'Deutsch', '🇩🇪', 'DE'],
    ['ko', '한국어', '🇰🇷', '한']
  ];
  var MORE = [
    ['zh-TW', '中文（繁體）', '', '繁'], ['ru', 'Русский', '', 'RU'], ['it', 'Italiano', '', 'IT'],
    ['vi', 'Tiếng Việt', '', 'VI'], ['id', 'Bahasa Indonesia', '', 'ID'], ['ms', 'Bahasa Melayu', '', 'MS'],
    ['tl', 'Filipino', '', 'TL'], ['tr', 'Türkçe', '', 'TR'], ['pl', 'Polski', '', 'PL'],
    ['nl', 'Nederlands', '', 'NL'], ['sv', 'Svenska', '', 'SV'], ['uk', 'Українська', '', 'UK'],
    ['sw', 'Kiswahili', '', 'SW'], ['iw', 'עברית', '', 'HE'], ['fa', 'فارسی', '', 'FA'],
    ['ur', 'اردو', '', 'UR'], ['bn', 'বাংলা', '', 'BN'], ['ta', 'தமிழ்', '', 'TA'],
    ['ne', 'नेपाली', '', 'NE'], ['my', 'မြန်မာ', '', 'MY'], ['km', 'ខ្មែរ', '', 'KM'],
    ['lo', 'ລາວ', '', 'LO'], ['el', 'Ελληνικά', '', 'EL'], ['mi', 'Te Reo Māori', '', 'MI'],
    ['sm', 'Gagana Sāmoa', '', 'SM'], ['to', 'Lea faka-Tonga', '', 'TO'], ['ty', 'Reo Tahiti', '', 'TY']
  ];
  var ALL = MAIN.concat(MORE), BY = {};
  for (var i = 0; i < ALL.length; i++) BY[ALL[i][0].toLowerCase()] = ALL[i];
  var ALIAS = { zh: 'zh-CN', cn: 'zh-CN', 'zh-hans': 'zh-CN', 'zh-sg': 'zh-CN', 'zh-hant': 'zh-TW', 'zh-hk': 'zh-TW', 'zh-mo': 'zh-TW',
    he: 'iw', jp: 'ja', fil: 'tl', 'in': 'id', kr: 'ko', 'pt-br': 'pt', 'pt-pt': 'pt', 'en-us': 'en', 'en-gb': 'en' };
  function norm(c) {
    if (!c || typeof c !== 'string') return null;
    c = c.trim().replace(/_/g, '-').toLowerCase();
    if (c.length > 12) return null;
    if (ALIAS[c]) return ALIAS[c];
    if (BY[c]) return BY[c][0];
    var p = c.split('-')[0];
    if (ALIAS[p]) return ALIAS[p];
    return BY[p] ? BY[p][0] : null;
  }
  function same(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.indexOf('zh') === 0 || b.indexOf('zh') === 0) return false; // 简体 ≠ 繁體
    return a.split('-')[0] === b.split('-')[0];
  }
  // the language the door is written in — NOT what Google already turned it into (an older 🌐 gadget on the page
  // may have translated it from its cookie before we arrived; Google then rewrites <html lang>)
  var BASE = (function () {
    if (/\btranslated-(ltr|rtl)\b/.test(html.className)) {
      var m = (doc.cookie.match(/(?:^|;\s*)googtrans=\/([^\/;]*)\//) || [])[1];
      return norm(m) || 'en';
    }
    return norm(html.getAttribute('lang')) || 'en';
  })();
  function info(c) { return BY[(c || '').toLowerCase()] || ['en', 'English', '', 'EN']; }

  // ── the family: every door we run and operate ──
  var FAMILY = ['4seas.org', '4seaspit.com', '4seaspit.org', 'affordagents.com', 'agentohana.org', 'agentpartys.com', 'agentscraving.com',
    'agentsraving.com', 'agentsreading.com', 'aquariusagents.org', 'ariesagents.org', 'blessingpool.com', 'canceragents.org',
    'capricornagents.com', 'capricornagents.org', 'creationology369.com', 'dashboardpad.app', 'devconpit.com', 'edgecitypit.org',
    'edgepit.org', 'eefpit.com', 'eefpod.com', 'esmeraldapit.com', 'ethereumbard.com', 'geminiagents.club', 'geminisagents.com',
    'globyagent.com', 'grantmagnet.org', 'imsorryjeremy.com', 'infinitepit.com', 'islpoap.xyz', 'jordanham.com',
    'kaleikaumaka.org', 'karaokeprotocol.com', 'learnfromagents.com', 'leoagents.org', 'libraagents.com', 'libraagents.org',
    'myagentfamily.com', 'myagentohana.com', 'myagentsparty.com', 'ohanapit.com', 'ology369.com', 'opensourceorchestra.com',
    'opensourceorchestra.org', 'osodao.app', 'osodao.com', 'osodao.org', 'osopit.com', 'osopit.org', 'piscesagents.com',
    'piscesagents.org', 'piscesinstitute.com', 'piscisagents.com', 'piscisagents.org', 'piscisinstitute.com', 'piscispit.com',
    'pitfans.com', 'pitgoa.com', 'pitlip.com', 'pitprovides.com', 'pitprovides.org', 'privateinform.com', 'privateinform.org',
    'privatepit.com', 'publicinform.com', 'publicinform.org', 'sagittariusagents.com', 'sagittariusagents.org', 'scorpioagents.com',
    'scorpioagents.org', 'shakafans.com', 'shakaleikaumaka.com', 'shakaleikaumaka.org', 'shakapit.com', 'shakaverse.com',
    'shanhaipit.com', 'spectoragent.com', 'spectorgadget.com', 'tauroagents.com', 'tauroinstitute.com', 'taurusagents.org',
    'taurusdashboard.com', 'taurusinstitute.com', 'taurusinstitute.org', 'tauruspit.com', 'tauruspod.com', 'teleprompit.com',
    'terribleagents.com', 'theinfinitegard.org', 'theshellpit.com', 'tracewaste.org', 'virgoagents.com', 'virgoagents.org',
    'vlogprompting.com', 'wastetrace.org', 'zodiacagents.org', 'zodiacpit.com', 'zuchiangmai.app', 'zupit.org',
    'zuzaluagents.com', 'zuzaluagents.org', 'shakaleikaumaka.github.io', 'shakalei.github.io', 'open-source-orchestra.github.io'];
  (opt('family') || '').split(/[\s,]+/).forEach(function (h) { if (h) FAMILY.push(h.toLowerCase()); });
  function isFamily(host) {
    host = (host || '').toLowerCase().replace(/^www\./, '');
    if (/-ffieyo32\.taur\.link$/.test(host)) return true;   // the ʻohana's hosted doors on taur.link
    for (var i = 0; i < FAMILY.length; i++) {
      var d = FAMILY[i];
      if (host === d || host.slice(-(d.length + 1)) === '.' + d) return true;
    }
    return false;
  }

  // ── small helpers ──
  function store(c) { try { localStorage.setItem(KEY, c); } catch (e) {} }
  function stored() { try { return norm(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function cookie(name) { var m = doc.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; }
  function legacyChoice() {           // the old 🌐 corner wrote googtrans=/en/<code> on this door
    var v = cookie('googtrans'); if (!v) return null;
    var p = v.split('/'); return norm(p[p.length - 1]);
  }
  function regDomain() { var p = location.hostname.split('.'); return p.length > 2 && !/taur\.link$/.test(location.hostname) ? p.slice(-2).join('.') : null; }
  function setGTCookie(c) { try { doc.cookie = 'googtrans=/' + gtBase() + '/' + c + ';path=/;SameSite=Lax'; } catch (e) {} }
  function clearGTCookie() {
    var e = 'googtrans=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
    try {
      doc.cookie = e; doc.cookie = e + ';domain=' + location.hostname; doc.cookie = e + ';domain=.' + location.hostname;
      var r = regDomain(); if (r) doc.cookie = e + ';domain=.' + r;
    } catch (x) {}
  }
  function gtBase() { var b = nat0 ? nat0.base : BASE; return b === 'zh-CN' || b === 'zh-TW' ? b : b.split('-')[0]; }
  function isFile(u) { return /\.(?!html?$|php$)[a-z0-9]{2,5}$/i.test(u.pathname); }
  function translated() { return /\btranslated-(ltr|rtl)\b/.test(html.className); }
  function fire(el, type) { var ev; try { ev = new Event(type, { bubbles: true }); } catch (e) { ev = doc.createEvent('HTMLEvents'); ev.initEvent(type, true, true); } el.dispatchEvent(ev); }
  var FRAMED = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── the choice ──
  var chosen = null;     // explicit choice (carried) — null = nobody chose; the door shows its own language
  var fromURL = null;
  try {
    var u0 = new URL(location.href);
    fromURL = norm(u0.searchParams.get(PARAM));
    if (u0.searchParams.has(PARAM)) {                     // keep shared links clean: the door remembers instead
      u0.searchParams.delete(PARAM);
      history.replaceState(history.state, '', u0.pathname + (u0.search || '') + u0.hash);
    }
  } catch (e) {}
  chosen = fromURL || stored() || legacyChoice();
  if (chosen) store(chosen);

  // ── native, hand-made translations come first ──
  // Pages with their own toggle: window.setLang('en'|'zh') + [data-zh] (the totem family), or any page that sets
  // window.oleloNative = { langs: ['en','zh-CN',…], set: function(code){…} }
  var nativeBusy = 0;
  function nativeAdapter() {
    var n = window.oleloNative;
    if (n && typeof n.set === 'function' && n.langs) return { base: n.base || 'en', has: function (c) { return n.langs.indexOf(c) >= 0; }, set: n.set };
    if (typeof window.setLang === 'function' && doc.querySelector('[data-zh]')) {
      return {
        base: 'en',
        has: function (c) { return c === 'en' || c === 'zh-CN'; },
        set: function (c) { nativeBusy++; try { window.setLang(c === 'zh-CN' ? 'zh' : 'en'); } catch (e) {} nativeBusy--; }
      };
    }
    var modes = modeButtons();                       // 4seas-style <button data-mode="th" lang="th"> toggles
    if (modes) {
      return {
        base: 'en',
        has: function (c) { return !!modes[c]; },
        set: function (c) {
          var btn = modes[c];
          if (btn && btn.getAttribute('aria-pressed') !== 'true' && !btn.classList.contains('on')) { nativeBusy++; try { btn.click(); } catch (e) {} nativeBusy--; }
        }
      };
    }
    return null;
  }
  function modeButtons() {
    var bs = doc.querySelectorAll('button[data-mode][lang]'), m = {}, n = 0;
    for (var i = 0; i < bs.length; i++) { var c = norm(bs[i].getAttribute('data-mode')); if (c && !m[c]) { m[c] = bs[i]; n++; } }
    return m.en && n >= 2 ? m : null;
  }
  function hookNative() {
    if (modeButtons()) doc.addEventListener('click', function (ev) {   // the door's own language buttons carry too
      var btn = ev.target && ev.target.closest ? ev.target.closest('button[data-mode][lang]') : null;
      if (!btn || nativeBusy || !ev.isTrusted) return;
      var c = norm(btn.getAttribute('data-mode'));
      if (c) setTimeout(function () { if (c !== chosen) choose(c, 'user'); }, 0);
    }, true);
    var orig = window.setLang;
    if (typeof orig !== 'function' || orig.__olelo || !doc.querySelector('[data-zh]')) return;
    var wrapped = function (l) {
      var r = orig.apply(this, arguments);
      if (!nativeBusy) { var c = l === 'zh' ? 'zh-CN' : 'en'; if (c !== chosen) choose(c, 'user'); }
      return r;
    };
    wrapped.__olelo = 1;
    window.setLang = wrapped;
  }

  // ── Google Translate engine (loaded only after a visitor has chosen a language) ──
  var gt = { state: 'idle', combo: null, waiters: [], foreign: false, inited: 0 };
  function gtFlush() { var w = gt.waiters; gt.waiters = []; for (var i = 0; i < w.length; i++) w[i](gt.state === 'ready'); }
  function gtReady(cb) { if (gt.state === 'ready' || gt.state === 'failed') return cb(gt.state === 'ready'); gt.waiters.push(cb); gtLoad(); }
  function gtBox() {
    var box = doc.getElementById('olelo-gt');
    if (!box) {
      box = doc.createElement('div'); box.id = 'olelo-gt'; box.className = 'notranslate';
      box.setAttribute('inert', '');                 // engine room: off-screen, unfocusable, not announced (no aria-hidden-focus)
      box.style.cssText = 'position:absolute!important;left:-9999px!important;top:0!important;width:1px;height:1px;overflow:hidden';
      doc.body.appendChild(box);
    }
    return box;
  }
  function gtInit(preexisting) {
    // preexisting = an older 🌐 script on this page already started Google Translate before we arrived
    if (gt.inited++) return;
    var late = gt.state === 'failed';               // Google arrived after we gave up — use it after all
    if (gt.state === 'idle') gt.state = 'loading';
    try { new window.google.translate.TranslateElement({ pageLanguage: gtBase(), autoDisplay: false }, gtBox().id); }
    catch (e) { if (preexisting) gt.foreign = true; gt.state = 'failed'; gtFlush(); return; }
    var t0 = Date.now();
    (function wait() {
      var c = doc.querySelector('#olelo-gt select.goog-te-combo') || doc.querySelector('select.goog-te-combo');
      if (c) {
        gt.combo = c; gt.state = 'ready'; gt.foreign = false;
        if (gtBox().contains(c)) { var fz = gtBox().querySelectorAll('a,select,button,input,[tabindex]'); for (var z = 0; z < fz.length; z++) fz[z].setAttribute('tabindex', '-1'); }
        c.addEventListener('change', function (ev) { if (ev.isTrusted && c.value) choose(c.value, 'user'); });
        gtFlush();
        if (late) { hinted = false; ui.setHint(false); if (toastEl) { toastEl.remove(); } apply(); }
        return;
      }
      // an old "SIMPLE" gadget got there first: Google won't hand us a second, drivable one
      if (Date.now() - t0 > (preexisting ? 3000 : 8000)) { if (preexisting) gt.foreign = true; gt.state = 'failed'; gtFlush(); return; }
      setTimeout(wait, 60);
    })();
  }
  function gtFail() { if (gt.state === 'loading') { gt.state = 'failed'; gtFlush(); } }
  function gtInject(n) {                             // one quiet retry before we call Google unreachable
    var s = doc.createElement('script'); s.src = GT_SRC + (n ? '&r=' + n : ''); s.async = true;
    s.onerror = function () { if (gt.state !== 'loading') return; if (!gt.retried) { gt.retried = 1; setTimeout(function () { gtInject(1); }, 1200); } else gtFail(); };
    (doc.head || html).appendChild(s);
  }
  function gtLoad() {
    if (gt.state !== 'idle') return;
    gt.state = 'loading';
    if (window.google && window.google.translate && window.google.translate.TranslateElement) { gtInit(true); return; }
    var pending = !!doc.querySelector('script[src*="translate_a/element.js"]');   // an old static tag is already fetching it
    if (!pending) gtInject(0);
    setTimeout(function () {
      if (gt.state !== 'loading') return;
      if (!gt.retried) { gt.retried = 1; gtInject(2); setTimeout(gtFail, 10000); } else gtFail();
    }, pending ? 15000 : 10000);
  }
  // Every door now drives ONE engine the same way: whoever loads element.js, its callback lands here.
  window.googleTranslateElementInit = function () { gtInit(false); };
  // An older 🌐 gadget that initialised Google first can't be driven live — let it read the cookie on a reload (once).
  function foreignReload(c) {
    var k = 'olelo-reload', v = c + '@' + location.pathname, done = null;
    try { done = sessionStorage.getItem(k); } catch (e) {}
    if (done === v) {                                 // we already reloaded for this: give Google a moment, then be honest
      var t0 = Date.now();
      (function watch() {
        if (translated()) { try { sessionStorage.removeItem(k); } catch (e) {} return; }
        if (Date.now() - t0 > 9000) { hint(); return; }
        setTimeout(watch, 300);
      })();
      return;
    }
    try { sessionStorage.setItem(k, v); } catch (e) {}
    setGTCookie(c);
    location.reload();
  }
  var cssOn = false;
  function gtCSS() {
    if (cssOn) return; cssOn = true;
    var st = doc.createElement('style'); st.id = 'olelo-gt-css';
    st.textContent = 'iframe.skiptranslate,.goog-te-banner-frame,#goog-gt-tt,.goog-te-balloon-frame,.VIpgJd-ZVi9od-ORHb-OEVmcd,' +
      '.VIpgJd-yAWNEb-L7lbkb,.VIpgJd-ZVi9od-aZ2wEe-wOHMyf,.VIpgJd-ZVi9od-aZ2wEe-OiiCO{display:none!important}' +
      'body{top:0!important}.VIpgJd-yAWNEb-VIpgJd-fmcmS-sn54Q{background:none!important;box-shadow:none!important}' +
      '#olelo-gt .goog-logo-link,#olelo-gt .goog-te-gadget span{display:none!important}';
    (doc.head || html).appendChild(st);
  }
  // Names are never translated (law, 31 Oct + MING 15 Nov): "Open Source Orchestra" and "ʻohana" stay as written.
  // Wrapped in translate="no" spans only when a machine translation is about to run; default visits are untouched.
  var PROTECT = /(^|[^A-Za-z0-9_])(Open Source Orchestra|[ʻ'‘’`]?[Oo]hana)(?![A-Za-z0-9_])/g;
  var XHTML = 'http://www.w3.org/1999/xhtml';
  function protectNames(root) {
    if (!root || !doc.createTreeWalker) return;
    try {
      var w = doc.createTreeWalker(root, 4 /* SHOW_TEXT */, null), list = [], n;
      while ((n = w.nextNode())) {
        var par = n.parentNode, v = n.nodeValue;
        if (!par || !v || v.length < 4 || par.namespaceURI !== XHTML) continue;
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|CODE|PRE|TITLE|OPTION)$/.test(par.nodeName)) continue;
        if (par.closest && par.closest('.notranslate,[translate="no"],#olelo')) continue;
        PROTECT.lastIndex = 0;
        if (PROTECT.test(v)) list.push(n);
      }
      for (var i = 0; i < list.length; i++) {
        var t = list[i], s = t.nodeValue, frag = doc.createDocumentFragment(), last = 0, m;
        PROTECT.lastIndex = 0;
        while ((m = PROTECT.exec(s))) {
          var at = m.index + m[1].length;
          if (at > last) frag.appendChild(doc.createTextNode(s.slice(last, at)));
          var sp = doc.createElement('span'); sp.className = 'notranslate olelo-name'; sp.setAttribute('translate', 'no'); sp.textContent = m[2];
          frag.appendChild(sp); last = at + m[2].length;
        }
        if (last < s.length) frag.appendChild(doc.createTextNode(s.slice(last)));
        if (t.parentNode) t.parentNode.replaceChild(frag, t);
      }
      // a name split across tags (<h1>Open Source<br><em>Orchestra</em></h1>) — keep the whole element as written
      var els = root.querySelectorAll ? root.querySelectorAll('h1,h2,h3,h4,h5,a,span,strong,em,b,p,div,li,figcaption,button,label') : [];
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        if (el.children.length > 6 || el.namespaceURI !== XHTML || el.classList.contains('notranslate')) continue;
        var tx = el.textContent || '';
        if (tx.length > 60) continue;
        tx = (el.innerText || tx).replace(/[\s\u200b\u00a0]+/g, ' ').trim();   // innerText: <br> counts as a space
        if (/^(the )?open source orchestra$|^[ʻ'‘’`]?ohana$/i.test(tx) && !(el.closest && el.closest('#olelo'))) { el.classList.add('notranslate'); el.setAttribute('translate', 'no'); }
      }
    } catch (e) {}
  }
  function gtApply(c) {
    gtCSS(); setGTCookie(c); protectNames(doc.body); protecting = true;
    if (translated() && html.getAttribute('lang') === c) return;        // already showing it (the cookie did it)
    gtReady(function (ok) {
      if (!ok) { if (gt.foreign && chosen === c) foreignReload(c); else hint(); return; }
      if (chosen !== c) return;                      // the visitor changed their mind meanwhile
      var tries = 0;
      (function go() {
        if (chosen !== c) return;
        if (translated() && html.getAttribute('lang') === c) return;
        var cb = gt.combo;
        if (!cb || !doc.contains(cb)) { cb = gt.combo = doc.querySelector('select.goog-te-combo'); if (!cb) return; }
        cb.value = c; fire(cb, 'change');
        if (++tries < 4) setTimeout(go, 700);
      })();
    });
  }
  function gtRestore() {
    clearGTCookie();
    if (!translated()) return;
    var want = chosen;
    var done = false, fs = doc.querySelectorAll('iframe');
    for (var i = 0; i < fs.length && !done; i++) {
      var f = fs[i];
      if (!/skiptranslate|goog-te|VIpgJd/.test(f.className + ' ' + f.id) && !/container$/.test(f.id)) continue;
      try {
        var d = f.contentDocument || (f.contentWindow && f.contentWindow.document);
        var b = d && d.querySelector('[id$="restore"]');
        if (b) { b.click(); done = true; }
      } catch (e) {}
    }
    setTimeout(function () { if (translated() && chosen === want) location.reload(); }, done ? 900 : 50);
  }
  var protecting = false;
  var hinted = false;
  function hint() {
    if (hinted || !chosen || same(chosen, BASE)) return; hinted = true;
    ui.setHint(true);
    toast(t('gfw'));
  }

  // ── apply the choice to this door ──
  function apply() {
    var c = chosen;
    if (!c) return;
    var nat = nativeAdapter();
    if (nat && nat.has(c)) { if (translated()) gtRestore(); nat.set(c); return; }
    if (nat) nat.set(nat.base);                      // Google translates from the door's own base text
    if (same(c, nat ? nat.base : BASE)) { gtRestore(); return; }
    gtApply(c);
  }

  // ── carry it: links, new windows, framed doors ──
  function decorate(a) {
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#' || /^(mailto|tel|sms|javascript|data|blob):/i.test(href)) return;
    if (a.hasAttribute('download') || a.getAttribute('data-olelo') === 'off') return;
    var u; try { u = new URL(href, location.href); } catch (e) { return; }
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.origin === location.origin || !isFamily(u.hostname) || isFile(u)) return;
    if (u.searchParams.get(PARAM) === chosen) return;
    u.searchParams.set(PARAM, chosen);
    a.setAttribute('href', u.toString());
  }
  function decorateIn(root) {
    if (!chosen || !root) return;
    if (root.tagName === 'A') decorate(root);
    if (root.querySelectorAll) { var as = root.querySelectorAll('a[href]'); for (var i = 0; i < as.length; i++) decorate(as[i]); }
  }
  function frameIsFamily(f) {
    var s = f.getAttribute('src'); if (!s) return false;
    try { var u = new URL(s, location.href); return u.origin === location.origin || isFamily(u.hostname); } catch (e) { return false; }
  }
  function tell(f) { if (!chosen) return; try { if (frameIsFamily(f) && f.contentWindow) f.contentWindow.postMessage({ olelo: chosen, v: 1 }, '*'); } catch (e) {} }
  function tellAll() { var fs = doc.getElementsByTagName('iframe'); for (var i = 0; i < fs.length; i++) tell(fs[i]); }
  function watchFrame(f) { if (f.__olelo) return; f.__olelo = 1; f.addEventListener('load', function () { tell(f); }); }
  function scanFrames(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.tagName === 'IFRAME') watchFrame(root);
    var fs = root.querySelectorAll('iframe'); for (var i = 0; i < fs.length; i++) watchFrame(fs[i]);
  }
  try {                                           // window.open('https://another.door/') carries it too
    var nativeOpen = window.open;
    window.open = function (url) {
      try {
        if (chosen && url) {
          var u = new URL(url, location.href);
          if (u.origin !== location.origin && isFamily(u.hostname) && !isFile(u)) { u.searchParams.set(PARAM, chosen); arguments[0] = u.toString(); }
        }
      } catch (e) {}
      return nativeOpen.apply(this, arguments);
    };
  } catch (e) {}
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object' || !('olelo' in d)) return;
    if (d.olelo === '?') { if (chosen && ev.source) try { ev.source.postMessage({ olelo: chosen, v: 1 }, '*'); } catch (e) {} return; }
    var c = norm(d.olelo); if (!c) return;
    if (FRAMED && ev.source === window.parent) { parentAnswered = true; if (c !== chosen) choose(c, 'parent'); return; }
    var fs = doc.getElementsByTagName('iframe');
    for (var i = 0; i < fs.length; i++) if (fs[i].contentWindow === ev.source) { if (c !== chosen) choose(c, 'child'); return; }
  });
  window.addEventListener('storage', function (ev) {      // another tab of this door changed it
    if (ev.key === KEY) { var c = norm(ev.newValue); if (c && c !== chosen) choose(c, 'tab'); }
  });

  function choose(c, from) {
    c = norm(c); if (!c) return;
    var changed = c !== chosen;
    chosen = c; store(c);
    decorateIn(doc.body);
    if (from === 'user' && FRAMED) try { window.parent.postMessage({ olelo: c, v: 1 }, '*'); } catch (e) {}
    tellAll();
    apply();
    ui.refresh();
    if (changed) try { doc.dispatchEvent(new CustomEvent('olelo:change', { detail: { lang: c, from: from } })); } catch (e) {}
  }

  // ── words for the button itself (the panel is never machine-translated) ──
  var WORDS = {
    en: ['every language', 'Your choice travels with you through every ʻohana door.', 'more languages', 'Machine translation by Google — it loads only after you choose a language.', 'Google Translate can’t be reached here. In mainland China, use your browser’s built-in translate (e.g. Edge) or a VPN.', 'Language'],
    haw: ['nā ʻōlelo a pau', 'Hele pū kou koho ʻōlelo me ʻoe ma nā puka a pau o ka ʻohana.', 'nā ʻōlelo hou aku'],
    'zh-CN': ['所有语言', '你选的语言会陪你走过 ʻohana 的每一扇门。', '更多语言', '机器翻译由 Google 提供——只在你选择语言之后才加载。', '这里连不上 Google 翻译。在中国大陆，请用浏览器自带的翻译（例如 Edge）或 VPN。', '语言'],
    'zh-TW': ['所有語言', '你選的語言會陪你走過 ʻohana 的每一扇門。', '更多語言', '機器翻譯由 Google 提供——只在你選擇語言之後才載入。', '這裡連不上 Google 翻譯。請改用瀏覽器內建的翻譯（例如 Edge）或 VPN。', '語言'],
    es: ['todos los idiomas', 'Tu elección viaja contigo por todas las puertas de la ʻohana.', 'más idiomas', 'Traducción automática de Google: solo se carga cuando eliges un idioma.', 'Aquí no se puede acceder a Google Translate. Usa el traductor integrado de tu navegador o una VPN.', 'Idioma'],
    hi: ['हर भाषा', 'आपकी चुनी हुई भाषा ʻohana के हर दरवाज़े पर आपके साथ चलती है।', 'और भाषाएँ', 'Google का मशीनी अनुवाद — यह तभी लोड होता है जब आप भाषा चुनते हैं।', 'यहाँ Google Translate नहीं खुल रहा। ब्राउज़र का अपना अनुवाद या VPN इस्तेमाल करें।', 'भाषा'],
    th: ['ทุกภาษา', 'ภาษาที่คุณเลือกจะเดินทางไปกับคุณทุกประตูของ ʻohana', 'ภาษาอื่น ๆ', 'แปลด้วยเครื่องโดย Google — โหลดหลังจากคุณเลือกภาษาเท่านั้น', 'เข้าถึง Google Translate ไม่ได้ที่นี่ ลองใช้ตัวแปลในเบราว์เซอร์หรือ VPN', 'ภาษา'],
    ja: ['すべての言語', '選んだ言語は、ʻohana のすべての扉であなたと一緒に旅します。', 'その他の言語', 'Google による機械翻訳 — 言語を選んだ後にだけ読み込まれます。', 'ここでは Google 翻訳に接続できません。ブラウザー内蔵の翻訳か VPN をお使いください。', '言語'],
    ar: ['كل اللغات', 'يرافقك اختيارك عبر كل أبواب ʻohana.', 'لغات أخرى', 'ترجمة آلية من Google — لا تُحمَّل إلا بعد أن تختار لغة.', 'لا يمكن الوصول إلى ترجمة Google هنا. استخدم الترجمة المدمجة في متصفحك أو VPN.', 'اللغة'],
    fr: ['toutes les langues', 'Votre choix vous accompagne à travers toutes les portes de la ʻohana.', 'autres langues', 'Traduction automatique par Google — chargée seulement après votre choix.', 'Google Traduction est inaccessible ici. Utilisez la traduction intégrée du navigateur ou un VPN.', 'Langue'],
    pt: ['todos os idiomas', 'Sua escolha viaja com você por todas as portas da ʻohana.', 'mais idiomas', 'Tradução automática do Google — só carrega depois que você escolhe um idioma.', 'O Google Tradutor não está acessível aqui. Use a tradução do navegador ou uma VPN.', 'Idioma'],
    de: ['alle Sprachen', 'Deine Wahl reist mit dir durch jede Tür der ʻohana.', 'weitere Sprachen', 'Maschinelle Übersetzung von Google – wird erst nach deiner Wahl geladen.', 'Google Übersetzer ist hier nicht erreichbar. Nutze die Übersetzung deines Browsers oder ein VPN.', 'Sprache'],
    ko: ['모든 언어', '선택한 언어가 ʻohana의 모든 문으로 함께 갑니다.', '더 많은 언어', 'Google 기계 번역 — 언어를 고른 뒤에만 불러옵니다.', '여기서는 Google 번역에 연결할 수 없습니다. 브라우저 내장 번역이나 VPN을 사용하세요.', '언어']
  };
  var IDX = { title: 0, note: 1, more: 2, privacy: 3, gfw: 4, label: 5 };
  function t(k) { var w = WORDS[chosen] || WORDS.en; var v = w[IDX[k]]; return v || WORDS.en[IDX[k]]; }

  // ── the button (same corner on every door; the old 🌐 is adopted where it exists) ──
  var ui = { refresh: function () {}, setHint: function () {} };
  var toastEl = null;
  function toast(msg) {
    if (!doc.body || toastEl) return;
    toastEl = doc.createElement('div');
    toastEl.setAttribute('translate', 'no'); toastEl.className = 'notranslate'; toastEl.setAttribute('role', 'status');
    toastEl.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483000;max-width:min(520px,92vw);background:rgba(12,11,28,.96);color:#e8e6ff;border:1px solid rgba(124,211,255,.45);border-radius:12px;padding:10px 14px;font:13px/1.45 Georgia,serif;box-shadow:0 8px 30px rgba(0,0,0,.5)';
    toastEl.textContent = '🌐 ' + msg;
    doc.body.appendChild(toastEl);
    setTimeout(function () { if (toastEl) { toastEl.remove(); } }, 9000);
  }

  function legacyUI(ol) {
    var st = doc.createElement('style'); st.id = 'olelo-legacy-css';
    // beat the old corner's own "!important" dimming (mobile .5) by specificity: the 🌐 must be seen, its chip readable
    st.textContent = 'html body #olang{opacity:.95!important}html body #olang:hover,html body #olang:focus-visible{opacity:1!important}' +
      '#olang .olelo-chip{position:absolute;right:-7px;bottom:-5px;min-width:20px;height:18px;padding:0 5px;border-radius:9px;' +
      'background:#7cd3ff;color:#0c0b1c;font:700 10px/18px system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;letter-spacing:0;' +
      'box-shadow:0 1px 4px rgba(0,0,0,.45);pointer-events:none;white-space:nowrap}' +
      '#olangp .olelo-note{font-size:11px;color:#7ee2a0;margin:-4px 0 10px;line-height:1.4}' +
      '#olangp .lb.olelo-on{outline:2px solid #7cd3ff;outline-offset:-2px}' +
      '#olangp .olelo-more{display:block;width:100%;margin:2px 0 6px;min-height:30px;background:rgba(124,211,255,.08);color:#e8e6ff;' +
      'border:1px solid rgba(124,211,255,.35);border-radius:10px;padding:5px 8px;font:12px Georgia,serif;cursor:pointer}' +
      '#olangp .olelo-more option{background:#0c0b1c;color:#e8e6ff}#google_translate_element{display:none!important}';
    (doc.head || html).appendChild(st);
    if (getComputedStyle(ol).position === 'static') ol.style.position = 'relative';
    var chip = doc.createElement('span'); chip.className = 'olelo-chip notranslate'; chip.setAttribute('translate', 'no'); chip.setAttribute('aria-hidden', 'true');
    ol.appendChild(chip);
    ol.setAttribute('role', 'button'); ol.setAttribute('tabindex', ol.getAttribute('tabindex') || '0');
    ol.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ol.click(); } });
    var panel = doc.getElementById('olangp');
    if (panel && !panel.querySelector('.olelo-note')) {
      var note = doc.createElement('div'); note.className = 'olelo-note';
      note.textContent = '🌊 ' + WORDS.en[1];
      var lt = panel.querySelector('.lt');
      if (lt && lt.nextSibling) panel.insertBefore(note, lt.nextSibling); else panel.appendChild(note);
    }
    if (panel && !panel.querySelector('.olelo-more')) {   // "+90 more" no longer loads Google up front: our own list instead
      var sel = doc.createElement('select');
      sel.className = 'olelo-more notranslate'; sel.setAttribute('translate', 'no'); sel.setAttribute('aria-label', '+ more languages');
      var oh = '<option value="">+ ' + MORE.length + ' more ↓</option>';
      for (var k = 0; k < MORE.length; k++) oh += '<option value="' + MORE[k][0] + '">' + MORE[k][1] + '</option>';
      sel.innerHTML = oh;
      sel.addEventListener('change', function () { var v = sel.value; if (!v) return; sel.value = ''; panel.classList.remove('open'); choose(v, 'user'); });
      var slot = doc.getElementById('google_translate_element'), gtDiv = panel.querySelector('.gt');
      if (gtDiv) {
        for (var n = gtDiv.firstChild; n && n !== slot && n.nodeName !== 'BR';) { var nx = n.nextSibling; if (n.nodeType === 3) gtDiv.removeChild(n); n = nx; }
        gtDiv.insertBefore(sel, gtDiv.firstChild);
      } else panel.appendChild(sel);
    }
    if (typeof window.otr === 'function' && !window.otr.__olelo) {   // the old buttons now switch live and carry
      var mine = function (l) { if (panel) panel.classList.remove('open'); choose(l, 'user'); };
      mine.__olelo = 1; window.otr = mine;
    }
    ui.refresh = function () {
      var c = chosen || BASE, inf = info(c);
      chip.textContent = inf[3];
      ol.setAttribute('aria-label', inf[3] + ' · 🌐 ' + t('label') + ': ' + inf[1]);   // visible chip text first (WCAG 2.5.3)
      ol.setAttribute('title', '🌐 ' + inf[1] + ' — ' + WORDS.en[1]);
      if (panel) {
        var bs = panel.querySelectorAll('.lb');
        for (var i = 0; i < bs.length; i++) {
          var m = (bs[i].getAttribute('onclick') || '').match(/otr\('([^']+)'\)/);
          var on = !!(m && norm(m[1]) === c);
          bs[i].classList.toggle('olelo-on', on); bs[i].setAttribute('aria-pressed', on ? 'true' : 'false');
        }
      }
    };
    ui.refresh();
  }

  function ownUI() {
    var host = doc.createElement('div');
    host.id = 'olelo'; host.className = 'notranslate'; host.setAttribute('translate', 'no');
    host.style.cssText = 'all:initial;position:fixed;z-index:99980;top:0;left:0;width:0;height:0';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var css = ':host{all:initial}' +
      '.b{position:fixed;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:54px;height:54px;padding:0;margin:0;border-radius:50%;' +
      'background:rgba(20,18,45,.88);border:1px solid rgba(124,211,255,.6);color:#fff;font:25px/1 "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif;' +
      'cursor:pointer;opacity:.9;box-shadow:0 4px 18px rgba(0,0,0,.35);transition:opacity .3s,transform .3s;-webkit-tap-highlight-color:transparent}' +
      '.b:hover,.b:focus-visible,.b[aria-expanded=true]{opacity:1;transform:scale(1.06)}' +
      '.b:focus-visible{outline:2px solid #7cd3ff;outline-offset:3px}' +
      '.chip{position:absolute;right:-7px;bottom:-5px;min-width:20px;height:18px;padding:0 5px;border-radius:9px;background:#7cd3ff;color:#0c0b1c;' +
      'font:700 10px/18px system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.45);white-space:nowrap}' +
      '@keyframes bob{0%,100%{translate:0 0}50%{translate:0 -4px}}.b.bob{animation:bob 6.1s ease-in-out infinite}' +
      '.p{position:fixed;display:none;box-sizing:border-box;width:min(280px,calc(100vw - 16px));max-height:calc(100vh - 24px);overflow:auto;' +
      'background:rgba(12,11,28,.97);border:1px solid rgba(124,211,255,.45);border-radius:16px;padding:14px 14px 12px;color:#e8e6ff;' +
      'font:13px/1.45 Georgia,"Times New Roman",serif;box-shadow:0 10px 40px rgba(0,0,0,.6);text-align:left}' +
      '.p.open{display:block}' +
      '.tt{color:#7ee2a0;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin:0 26px 6px 0}' +
      '.nt{font-size:12px;color:#c9c4ee;margin:0 0 10px}' +
      '.x{position:absolute;top:6px;right:8px;width:28px;height:28px;border:0;border-radius:50%;background:transparent;color:#9d97c9;font:16px/28px system-ui,sans-serif;cursor:pointer}' +
      '.x:hover,.x:focus-visible{color:#fff;background:rgba(124,211,255,.15)}' +
      '.l{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;box-sizing:border-box;text-align:left;background:rgba(124,211,255,.08);border:1px solid transparent;' +
      'color:#e8e6ff;font:13px/1.3 Georgia,"Times New Roman",serif;padding:7px 10px;border-radius:10px;cursor:pointer;margin:3px 0}' +
      '.l:hover,.l:focus-visible{background:rgba(124,211,255,.2);outline:none;border-color:rgba(124,211,255,.5)}' +
      '.l.haw{background:rgba(126,226,160,.15);border-color:rgba(126,226,160,.4)}' +
      '.l[aria-pressed=true]{border-color:#7cd3ff;background:rgba(124,211,255,.25)}' +
      '.l[aria-pressed=true]::after{content:"✓";margin-left:auto;color:#7cd3ff}' +
      '.f{width:1.4em;text-align:center}' +
      'details{margin-top:8px;border-top:1px solid rgba(124,211,255,.2);padding-top:8px}' +
      'summary{cursor:pointer;color:#9d97c9;font-size:12px;min-height:24px;line-height:24px}' +
      '.g{display:grid;grid-template-columns:1fr 1fr;gap:0 6px}.g .l{font-size:12px;min-height:30px;padding:5px 8px}' +
      '.pv{margin-top:10px;font-size:10.5px;color:#9d97c9}.pv a{color:#7cd3ff}' +
      '.hint{display:none;margin-top:8px;font-size:11.5px;color:#ffd97a}.hint.on{display:block}' +
      '@media (max-width:700px){.b{width:38px;height:38px;font-size:17px}.b.bob{animation:none}.chip{min-width:18px;height:16px;font-size:9px;line-height:16px;right:-6px;bottom:-5px}}' +
      '@media (prefers-reduced-motion:reduce){.b,.b.bob{animation:none!important;transition:none}}';
    function btnHTML(L, cls) {
      return '<button type="button" class="l ' + (cls || '') + '" data-c="' + L[0] + '" lang="' + (L[0] === 'iw' ? 'he' : L[0]) + '"' +
        (L[0] === 'ar' || L[0] === 'iw' || L[0] === 'fa' || L[0] === 'ur' ? ' dir="rtl"' : '') + ' aria-pressed="false"><span class="f" aria-hidden="true">' + (L[2] || '·') + '</span>' + L[1] + '</button>';
    }
    var h = '<style>' + css + '</style>' +
      '<button type="button" class="b" id="b" aria-haspopup="dialog" aria-expanded="false" aria-controls="p"><span aria-hidden="true">🌐</span><span class="chip" id="chip" aria-hidden="true"></span></button>' +
      '<div class="p" id="p" role="dialog" aria-modal="false" aria-labelledby="tt">' +
      '<button type="button" class="x" id="x" aria-label="Close">✕</button>' +
      '<div class="tt" id="tt"></div><div class="nt" id="nt"></div><div id="main">';
    for (var i = 0; i < MAIN.length; i++) h += btnHTML(MAIN[i], MAIN[i][0] === 'haw' ? 'haw' : '');
    h += '</div><details id="more"><summary id="ms"></summary><div class="g">';
    for (i = 0; i < MORE.length; i++) h += btnHTML(MORE[i]);
    h += '</div></details><div class="hint" id="hint"></div><div class="pv" id="pv"></div></div>';
    root.innerHTML = h;
    doc.body.appendChild(host);
    var $ = function (id) { return root.getElementById ? root.getElementById(id) : root.querySelector('#' + id); };
    var b = $('b'), p = $('p'), chip = $('chip');
    if (!reduced) b.classList.add('bob');

    function open(v) {
      p.classList.toggle('open', v); b.setAttribute('aria-expanded', v ? 'true' : 'false');
      if (v) {
        place();
        var on = p.querySelector('.l[aria-pressed=true]') || p.querySelector('.l');
        if (on) try { on.focus({ preventScroll: true }); } catch (e) { on.focus(); }
        if (on && on.closest('details')) $('more').open = true;
      }
    }
    b.addEventListener('click', function () { open(!p.classList.contains('open')); });
    $('x').addEventListener('click', function () { open(false); b.focus(); });
    p.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('.l') : null;
      if (!el) return;
      choose(el.getAttribute('data-c'), 'user');
      open(false); b.focus();
    });
    root.addEventListener('keydown', function (e) { if (e.key === 'Escape' && p.classList.contains('open')) { open(false); b.focus(); } });
    doc.addEventListener('click', function (e) { if (p.classList.contains('open') && e.target !== host && !(e.composedPath && e.composedPath().indexOf(host) >= 0)) open(false); }, true);

    // placement: top-left like the 🌐 everywhere; step below any small fixed bar that already lives there
    function obstacle(x, y, s) {
      var pts = [[x + s / 2, y + s / 2], [x + 3, y + 3], [x + s - 3, y + s - 3], [x + s - 3, y + 3], [x + 3, y + s - 3]];
      for (var k = 0; k < pts.length; k++) {
        if (pts[k][0] >= innerWidth || pts[k][1] >= innerHeight) continue;
        var els = doc.elementsFromPoint ? doc.elementsFromPoint(pts[k][0], pts[k][1]) : [];
        for (var j = 0; j < els.length; j++) {
          var el = els[j];
          if (el === host || el === html || el === doc.body) continue;
          for (var a = el; a && a !== doc.body && a !== html; a = a.parentElement) {
            var cs = getComputedStyle(a);
            if (cs.position === 'fixed' || cs.position === 'sticky') {
              var r = a.getBoundingClientRect();
              if (r.width * r.height > innerWidth * innerHeight * 0.35) break;   // a background layer, not a control
              if (cs.visibility === 'hidden' || +cs.opacity < 0.05 || cs.pointerEvents === 'none' && r.height > 160) break;
              return r;
            }
          }
        }
      }
      return null;
    }
    function px(v, d, total, s) {                    // "120" = px · "50%" = centred at that share of the viewport
      var n = parseFloat(v); if (isNaN(n)) return d;
      return /%\s*$/.test(String(v)) ? Math.round(total * n / 100 - s / 2) : n;
    }
    function place() {
      var mob = innerWidth <= 700, s = mob ? 38 : 54;
      var x = px(opt('left'), mob ? 8 : 10, innerWidth, s), y = px(opt('top'), mob ? 52 : 74, innerHeight, s);
      var right = opt('side') === 'right';
      if (right) x = innerWidth - s - x;
      if (!opt('top')) {
        for (var k = 0; k < 6; k++) { var r = obstacle(x, y, s); if (!r) break; y = Math.ceil(r.bottom) + 8; }
        if (y + s > innerHeight - 70) y = Math.max(8, Math.round(innerHeight * 0.42));
      }
      b.style.top = y + 'px'; b.style.left = x + 'px';
      var py = y + s + 8, pw = Math.min(280, innerWidth - 16);
      if (py + 260 > innerHeight) py = Math.max(8, innerHeight - Math.min(innerHeight - 16, 520));
      p.style.top = py + 'px';
      p.style.left = (right ? Math.max(8, innerWidth - pw - 8) : Math.min(x, innerWidth - pw - 8)) + 'px';
      p.style.maxHeight = (innerHeight - py - 12) + 'px';
    }
    var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(place, 150); });
    place(); setTimeout(place, 1200);              // once more after the door's own late UI settles

    ui.refresh = function () {
      var c = chosen || BASE, inf = info(c);
      chip.textContent = inf[3];
      b.setAttribute('aria-label', inf[3] + ' · 🌐 ' + t('label') + ': ' + inf[1]);    // visible chip text first (WCAG 2.5.3)
      b.title = '🌐 ' + inf[1] + ' · ' + t('title');
      $('tt').textContent = '🌐 ʻŌlelo · ' + t('title');
      $('nt').textContent = t('note');
      $('ms').textContent = '+ ' + t('more');
      $('pv').innerHTML = '';
      $('pv').appendChild(doc.createTextNode(t('privacy') + ' '));
      var a = doc.createElement('a'); a.href = HOME; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'ʻŌlelo ↗'; $('pv').appendChild(a);
      $('hint').textContent = t('gfw');
      var ls = p.querySelectorAll('.l');
      for (var i = 0; i < ls.length; i++) ls[i].setAttribute('aria-pressed', ls[i].getAttribute('data-c') === c ? 'true' : 'false');
    };
    ui.setHint = function (v) { $('hint').classList.toggle('on', !!v); };
    ui.refresh();
  }

  // ── start ──
  var parentAnswered = false;
  function start() {
    hookNative();
    var ol = doc.getElementById('olang');
    var tiny = FRAMED && (innerWidth < 320 || innerHeight < 260);   // a thumbnail/preview of a door: carry, but no button
    if (opt('button') !== 'off' && !tiny) { try { if (ol) legacyUI(ol); else ownUI(); } catch (e) { if (window.console) console.warn('ʻŌlelo button', e); } }
    scanFrames(doc.body);
    if (chosen) { decorateIn(doc.body); tellAll(); apply(); }
    if (FRAMED && !fromURL) {                       // a door inside a door: ask the outer door what we speak
      try { window.parent.postMessage({ olelo: '?', v: 1 }, '*'); } catch (e) {}
    }
    if (window.MutationObserver) {
      var q = [], tm = null;
      new MutationObserver(function (ms) {
        for (var i = 0; i < ms.length; i++) {
          var m = ms[i];
          if (m.type === 'attributes') { if (m.target.tagName === 'A') q.push(m.target); else if (m.target.tagName === 'IFRAME') q.push(m.target); continue; }
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType === 1 && n.tagName !== 'FONT' && (n.tagName === 'A' || n.tagName === 'IFRAME' || n.firstElementChild || protecting)) q.push(n);
          }
        }
        if (q.length && !tm) tm = setTimeout(function () {
          var list = q; q = []; tm = null;
          for (var k = 0; k < list.length; k++) { decorateIn(list[k]); scanFrames(list[k]); if (list[k].tagName === 'IFRAME') tell(list[k]); if (protecting) protectNames(list[k]); }
        }, 120);
      }).observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'src'] });
    }
  }
  // a stale old-corner cookie must not translate a door whose visitor never chose (or chose its own language)
  var nat0 = nativeAdapter();
  if (!chosen || same(chosen, BASE) || (nat0 && nat0.has(chosen))) clearGTCookie(); else setGTCookie(chosen);
  window.addEventListener('pageshow', function (ev) {   // back/forward cache: another page of this door may have changed it
    if (ev.persisted) { var c = stored(); if (c && c !== chosen) choose(c, 'tab'); }
  });

  window.olelo = {
    version: VERSION,
    get: function () { return chosen; },
    set: function (c) { choose(c, 'user'); },
    base: BASE,
    langs: ALL.map(function (L) { return { code: L[0], name: L[1] }; }),
    isFamily: isFamily,
    engine: function () { return { state: gt.state, foreign: gt.foreign, inited: gt.inited, combo: !!gt.combo, translated: translated() }; }
  };
  if (doc.body) start(); else doc.addEventListener('DOMContentLoaded', start);
})();
