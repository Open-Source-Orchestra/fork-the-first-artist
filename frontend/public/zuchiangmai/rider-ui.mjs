/* SPDX-License-Identifier: GPL-3.0-or-later — made by the AI ʻohana for the Open Source Orchestra
   (Fork the First Artist · Zu Chiang Mai bubble).
   ── THE RIDER PANEL ───────────────────────────────────────────────────────────────────
   The plain-language rider of the 4Seas corner + four playable cards: the house piano
   (2-octave keyboard), the electric drum kit (8 pads), the Kala U·BASS (open strings +
   roots) and the Kala ukulele (chord strums) — and "all four together", the jam.
   Every string goes through t(key); the English source lives in RIDER_STRINGS_EN.
   Sounds: audio.mjs, synthesised live. Hits: rider.mjs animates in sync. */
'use strict';

export const RIDER_STRINGS_EN = {
  intro: `The 4Seas corner, in plain language. In the house: 🎹 <b>the piano</b> and 🥁 <b>the electric drum kit</b> — the community's own, in the open. Travelling with Shaka: 🎸 <b>the Kala U·BASS</b> and 🎶 <b>the Kala ukulele</b>, gifts from <b>Kala</b> that went the whole road — Tokyo → Shenzhen → Chiang Mai → Mumbai (Devcon 8, the Music Sanctuary) → home. At Devcon 8's closing ceremony the Kala uke was played plugged in. Everything here plugs into the little mixer, and <b>every instrument below plays</b> — synthesised live in your browser. Free music workshops in Chiang Mai, every three days, for the rest of the year.`,
  walk: '⌖ walk to it',
  play: 'play',
  piano: { name: '🎹 The piano', line: 'The house piano — a slim digital stage piano. It lives in the corner, in the open, for anyone.', hint: 'keys a w s e d f t g y h u j k · two octaves' },
  ekit: { name: '🥁 The electric drum kit', line: 'The house kit — mesh heads and rubber pads: the whole band, quiet-hours friendly. Headphones or the mixer, never the walls.', hint: 'keys z x c v b n m ,' },
  ubass: { name: '🎸 The Kala U·BASS', line: 'A gift from Kala. Mahogany, f-holes, fat polyurethane strings and a Hawaiian floral strap — it went the whole 2026 road and stood on the Devcon 8 stage every day.', hint: 'open strings E A D G · roots C F G A' },
  uke: { name: '🎶 The Kala ukulele', line: 'A gift from Kala. Pale flame figure, a cutaway, and a little preamp so she can plug in — played plugged in at Devcon 8\'s closing ceremony.', hint: 'keys 1 2 3 4 · C G Am F' },
  together: '🎶 all four together',
  stop: '⏹ let them rest',
  togetherLine: 'Piano, drums, U·BASS and ukulele: C · G · Am · F, at a resting-walk 92 bpm.',
  synth: 'Every sound is synthesised live in your browser — no samples, nothing leaves your device.',
  strings: 'open strings',
  roots: 'roots',
  strumDown: '↓ strum down',
  strumUp: '↑ strum up',
  noteNames: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'],
};

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const nn = (m) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);

/* computer-key maps */
const PIANO_KEYS = { a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, u: 70, j: 71, k: 72 };
const PAD_KEYS = { z: 'kick', x: 'snare', c: 'hat', v: 'openhat', b: 'tom1', n: 'tom2', m: 'floor', ',': 'crash' };
const UKE_KEYS = { 1: 'C', 2: 'G', 3: 'Am', 4: 'F' };
const PADS = [['kick', '🦵 kick'], ['snare', '🥁 snare'], ['hat', '🎩 hat'], ['openhat', '🎩 open'], ['tom1', '🪘 tom 1'], ['tom2', '🪘 tom 2'], ['floor', '🪘 floor'], ['crash', '💥 crash']];

export function mountRiderUI(el, { audio, rider, t, onFocus, onPlay } = {}) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  el.innerHTML = `
  <div class="rider-ui">
    <p class="ri-intro">${t('intro')}</p>

    <section class="ri-card" data-inst="piano">
      <header><h3>${esc(t('piano.name'))}</h3><button class="pill" data-walk="piano">${esc(t('walk'))}</button></header>
      <p>${esc(t('piano.line'))}</p>
      <div class="ri-kbd" role="group" aria-label="piano keyboard, two octaves"></div>
      <small>${esc(t('piano.hint'))}</small>
    </section>

    <section class="ri-card" data-inst="ekit">
      <header><h3>${esc(t('ekit.name'))}</h3><button class="pill" data-walk="ekit">${esc(t('walk'))}</button></header>
      <p>${esc(t('ekit.line'))}</p>
      <div class="ri-pads" role="group" aria-label="drum pads"></div>
      <small>${esc(t('ekit.hint'))}</small>
    </section>

    <section class="ri-card" data-inst="ubass">
      <header><h3>${esc(t('ubass.name'))}</h3><button class="pill" data-walk="ubass">${esc(t('walk'))}</button></header>
      <p>${esc(t('ubass.line'))}</p>
      <div class="ri-row"><span class="ri-lab">${esc(t('strings'))}</span><span class="ri-btns" data-ubass-open></span></div>
      <div class="ri-row"><span class="ri-lab">${esc(t('roots'))}</span><span class="ri-btns" data-ubass-roots></span></div>
    </section>

    <section class="ri-card" data-inst="uke">
      <header><h3>${esc(t('uke.name'))}</h3><button class="pill" data-walk="uke">${esc(t('walk'))}</button></header>
      <p>${esc(t('uke.line'))}</p>
      <div class="ri-row"><span class="ri-btns" data-uke-chords></span></div>
      <div class="ri-row ri-strums"><span class="ri-btns"><button class="pill" data-strum="down">${esc(t('strumDown'))}</button><button class="pill" data-strum="up">${esc(t('strumUp'))}</button></span></div>
      <small>${esc(t('uke.hint'))}</small>
    </section>

    <section class="ri-together">
      <button class="big" id="ri-jam">${esc(t('together'))}</button>
      <p>${esc(t('togetherLine'))}</p>
      <p class="ri-synth">${esc(t('synth'))}</p>
    </section>
  </div>`;

  const ui = el.querySelector('.rider-ui');
  let strumDir = 'down';

  function press(id, part, btn) {
    if (!audio) return;
    try {
      audio.init();
      if (id === 'piano') audio.pianoNote(part, 0.85);
      else if (id === 'ekit') audio.ekit(part, 0.95);
      else if (id === 'ubass') audio.ubass(part);
      else if (id === 'uke') audio.uke(part, strumDir);
    } catch (e) { console.warn(e); }
    rider?.hit?.(id, part, 1);
    if (btn) { btn.classList.add('on'); setTimeout(() => btn.classList.remove('on'), 160); }
  }

  /* piano keyboard, C4–B5 (60–71) + high C (72) */
  const kbd = ui.querySelector('.ri-kbd');
  const whites = [60, 62, 64, 65, 67, 69, 71, 72];
  const BLACK_AFTER = { 60: 61, 62: 63, 64: null, 65: 66, 67: 68, 69: 70, 71: null, 72: null };
  whites.forEach((m) => {
    const w = document.createElement('button');
    w.className = 'wk'; w.dataset.midi = m; w.setAttribute('aria-label', 'piano key ' + nn(m)); w.innerHTML = `<span>${nn(m)}</span>`;
    const bk = BLACK_AFTER[m];
    if (bk) { const b = document.createElement('button'); b.className = 'bk'; b.dataset.midi = bk; b.setAttribute('aria-label', 'piano key ' + nn(bk)); w.appendChild(b); }
    kbd.appendChild(w);
  });
  kbd.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-midi]'); if (!b) return;
    e.preventDefault(); press('piano', +b.dataset.midi, b);
  });

  /* drum pads */
  const padBox = ui.querySelector('.ri-pads');
  PADS.forEach(([id, label]) => {
    const b = document.createElement('button');
    b.className = 'ri-pad'; b.dataset.pad = id; b.textContent = label; b.setAttribute('aria-label', 'drum pad ' + id);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); press('ekit', id, b); });
    padBox.appendChild(b);
  });

  /* U·BASS: open strings E1 A1 D2 G2 · roots C2 F2 G2 A2 */
  const open = ui.querySelector('[data-ubass-open]');
  [[28, 'E₁'], [33, 'A₁'], [38, 'D₂'], [43, 'G₂']].forEach(([m, lab]) => {
    const b = document.createElement('button'); b.className = 'pill ri-note'; b.textContent = lab; b.setAttribute('aria-label', 'U·BASS open string ' + nn(m));
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); press('ubass', m, b); }); open.appendChild(b);
  });
  const roots = ui.querySelector('[data-ubass-roots]');
  [[36, 'C'], [41, 'F'], [43, 'G'], [45, 'A']].forEach(([m, lab]) => {
    const b = document.createElement('button'); b.className = 'pill ri-note'; b.textContent = lab; b.setAttribute('aria-label', 'U·BASS root ' + nn(m));
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); press('ubass', m, b); }); roots.appendChild(b);
  });

  /* uke chords */
  const chords = ui.querySelector('[data-uke-chords]');
  ['C', 'G', 'Am', 'F'].forEach((ch, i) => {
    const b = document.createElement('button'); b.className = 'pill ri-chord'; b.textContent = ch; b.setAttribute('aria-label', 'ukulele chord ' + ch);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); press('uke', ch, b); }); chords.appendChild(b);
  });
  ui.querySelectorAll('[data-strum]').forEach(b => b.addEventListener('click', () => {
    strumDir = b.dataset.strum;
    ui.querySelectorAll('[data-strum]').forEach(x => x.classList.toggle('on', x === b));
  }));
  ui.querySelector('[data-strum="down"]').classList.add('on');

  /* walk-to buttons */
  ui.querySelectorAll('[data-walk]').forEach(b => b.addEventListener('click', () => onFocus?.(b.dataset.walk)));

  /* the jam */
  const jamBtn = ui.querySelector('#ri-jam');
  jamBtn.addEventListener('click', () => {
    if (!audio?.jam) return;
    try {
      audio.init();
      if (audio.jam.running) audio.jam.stop(); else audio.jam.start();
    } catch (e) { console.warn(e); }
    jamBtn.textContent = audio.jam.running ? t('stop') : t('together');
    jamBtn.classList.toggle('playing', audio.jam.running);
  });

  /* computer keys — only while this panel is open */
  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!el.closest('.panel')?.classList.contains('open')) return;
    const tag = document.activeElement?.tagName || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    const k = e.key.toLowerCase();
    if (PIANO_KEYS[k]) { e.preventDefault(); press('piano', PIANO_KEYS[k], kbd.querySelector(`[data-midi="${PIANO_KEYS[k]}"]`)); }
    else if (PAD_KEYS[k]) { e.preventDefault(); press('ekit', PAD_KEYS[k], padBox.querySelector(`[data-pad="${PAD_KEYS[k]}"]`)); }
    else if (UKE_KEYS[k]) { e.preventDefault(); press('uke', UKE_KEYS[k]); }
  }
  addEventListener('keydown', onKey);
  return { unmount() { removeEventListener('keydown', onKey); } };
}
