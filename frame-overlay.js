/*! artist frames resolver · Open Source Orchestra Frames overlays · GPL-3.0-or-later · built by frontend/scripts/artist-frames.mjs (do not edit)
 *  Rule: the frame is dressed ONCE per page load for the FIRST slug in ?who= (?who=everyone|all → the door frame), else ?artist=, else #slug.
 *  Only slugs with artists/<slug>/frame.json (listed here) are tried, so a page never asks for a file that is not there. */
(function () {
  var FRAMED = {"open-source-orchestra":1,"shaka":1};
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
