/* SPDX-License-Identifier: GPL-3.0-or-later — made by the AI ʻohana for the Open Source Orchestra
   (Fork the First Artist · Zu Chiang Mai bubble).
   ── THE RIDER'S VOICES ──────────────────────────────────────────────────────────────
   Piano, electric drum kit, Kala U·BASS and Kala ukulele — synthesised from scratch in
   the Web Audio API. No samples, no CDN, no trackers. Engine lineage: the Devcon 8
   Virtual Sanctuary (rider/sanctuary/audio.js, CC0 — fork it like crazy 🍴), which is
   where the Karplus–Strong string came from. Its scar, kept verbatim:

   SCAR (2026-10-06): the live-graph version (DelayNode → BiquadFilter → feedback gain)
   DIVERGED — measured ×50 growth every 200 ms until it hit Infinity and killed the
   whole audio graph. A biquad inside a Web Audio feedback cycle does not behave like
   its steady-state magnitude response, so "loop gain 0.93" was a lie. Fixed by
   rendering the string offline with a one-zero averaging filter, whose gain is
   provably ≤ 1 at every frequency. Stable by construction. */

let AC = null, master = null, verb = null, comp = null;
export const state = { ready: false, muted: false };

export function ctx() { return AC; }

export function init() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return AC; }
  AC = new (window.AudioContext || window.webkitAudioContext)();
  comp = AC.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 22; comp.ratio.value = 3.4;
  comp.attack.value = 0.004; comp.release.value = 0.22;
  master = AC.createGain(); master.gain.value = 0.85;
  const limiter = AC.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.001; limiter.release.value = 0.12;
  verb = AC.createConvolver();
  verb.buffer = makeIR(2.2, 2.4);
  const verbGain = AC.createGain(); verbGain.gain.value = 0.24;
  verb.connect(verbGain); verbGain.connect(comp);
  master.connect(comp); comp.connect(limiter); limiter.connect(AC.destination);
  state.ready = true;
  return AC;
}
function makeIR(seconds, decay) {
  const rate = AC.sampleRate, len = Math.floor(rate * seconds);
  const buf = AC.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) { const t = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - t * 0.2); }
  }
  return buf;
}
/* a per-instrument bus: dry gain + reverb send */
function bus(sendAmt = 0.22, trim = 1) {
  const g = AC.createGain(); g.gain.value = trim;
  const send = AC.createGain(); send.gain.value = sendAmt;
  g.connect(master); g.connect(send); send.connect(verb);
  return g;
}
export function setMuted(m) { state.muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.85, AC.currentTime, 0.03); }

/* hit callback — the 3D animates in sync (jam notes schedule ahead, so we report `when`) */
const hitCbs = new Set();
export function onHit(cb) { hitCbs.add(cb); return () => hitCbs.delete(cb); }
function reportHit(id, part, when) { hitCbs.forEach(cb => { try { cb(id, part, when); } catch {} }); }

/* ── primitives ─────────────────────────────────────────────────────────── */
const noiseCache = {};
function noiseBuf(sec = 1) {
  const k = sec.toFixed(2);
  if (noiseCache[k]) return noiseCache[k];
  const len = Math.floor(AC.sampleRate * sec);
  const b = AC.createBuffer(1, len, AC.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return (noiseCache[k] = b);
}
function noise(dest, { dur = 0.2, gain = 0.4, type = 'bandpass', f = 2000, q = 1, fEnd = null, at = 0 }) {
  const t = at || AC.currentTime;
  const src = AC.createBufferSource(); src.buffer = noiseBuf(Math.max(0.3, dur + 0.1));
  const flt = AC.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
  if (fEnd) flt.frequency.exponentialRampToValueAtTime(Math.max(40, fEnd), t + dur);
  const g = AC.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(flt); flt.connect(g); g.connect(dest);
  src.start(t); src.stop(t + dur + 0.05);
}
function tone(dest, { f = 220, f2 = null, dur = 0.4, gain = 0.3, type = 'sine', at = 0, atk = 0.005 }) {
  const t = at || AC.currentTime;
  const o = AC.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur * 0.9);
  const g = AC.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.05);
  return o;
}
const n2f = (n) => 440 * Math.pow(2, (n - 69) / 12);

/* Karplus–Strong plucked string, rendered offline (see the scar note above). */
const ksCache = new Map();
function ksBuffer(f, dur, bright) {
  const key = Math.round(f * 2) + '|' + dur.toFixed(1) + '|' + bright.toFixed(2);
  if (ksCache.has(key)) return ksCache.get(key);
  const sr = AC.sampleRate;
  const N = Math.max(2, Math.round(sr / f));
  const len = Math.floor(sr * dur);
  const buf = AC.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const ring = new Float32Array(N);
  for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
  const pre = 1 - bright;
  for (let p = 0; p < 2; p++)
    for (let i = 0; i < N; i++) ring[i] = ring[i] * (1 - pre * 0.5) + ring[(i + 1) % N] * pre * 0.5;
  const s = 0.5 - bright * 0.28;
  const loss = Math.pow(0.001, 1 / Math.max(1, dur * f));
  let idx = 0;
  for (let n = 0; n < len; n++) {
    const cur = ring[idx], nxt = ring[(idx + 1) % N];
    d[n] = cur;
    ring[idx] = (cur * (1 - s) + nxt * s) * loss;
    idx = (idx + 1) % N;
  }
  ksCache.set(key, buf);
  return buf;
}
function pluck(dest, { f = 196, dur = 2.0, gain = 0.5, damp = 3200, bright = 0.5, at = 0, a = 0.004 }) {
  const t = at || AC.currentTime;
  const src = AC.createBufferSource();
  src.buffer = ksBuffer(f, dur, Math.max(0.05, Math.min(0.95, bright)));
  const body = AC.createBiquadFilter();
  body.type = 'lowpass'; body.frequency.value = damp; body.Q.value = 0.7;
  const g = AC.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + a);
  g.gain.setTargetAtTime(0.0001, t + dur * 0.8, dur * 0.1);
  src.connect(body); body.connect(g); g.connect(dest);
  src.start(t); src.stop(t + dur + 0.1);
}

/* ── the four voices ────────────────────────────────────────────────────── */
let pianoBus = null, drumBus = null, bassBus = null, ukeBus = null;
function buses() {
  if (!pianoBus) {
    pianoBus = bus(0.26, 0.9); drumBus = bus(0.10, 1.0); bassBus = bus(0.14, 1.05); ukeBus = bus(0.3, 0.85);
  }
  return { pianoBus, drumBus, bassBus, ukeBus };
}

/** 🎹 the house piano — a clean digital-piano tone: hammer + six partials, fast attack, singing decay */
export function pianoNote(midi = 60, vel = 0.8, at = 0) {
  if (!AC) return;
  const { pianoBus } = buses();
  const t = at || AC.currentTime;
  const f = n2f(midi);
  const low = midi < 48 ? 1 : 0;
  [1, 2, 3, 4.02, 5.4, 6.8].forEach((h, k) => {
    tone(pianoBus, { f: f * h * (1 + low * 0.0006 * k), dur: (2.8 - k * 0.38) * (0.7 + vel * 0.5), gain: (0.16 + vel * 0.1) / (1 + k * 1.4), type: k < 2 ? 'triangle' : 'sine', at: t, atk: 0.002 });
  });
  noise(pianoBus, { dur: 0.03, gain: 0.028 + vel * 0.02, type: 'highpass', f: 3800, at: t });   // the hammer
  reportHit('piano', midi, t);
}

/** 🥁 the electric drum kit — Roland-style pads: tight, quiet-hours friendly */
const EKIT = {
  kick:   (b, v, t) => { tone(b, { f: 145, f2: 44, dur: 0.30, gain: 0.9 * v, type: 'sine', at: t }); noise(b, { dur: 0.04, gain: 0.20 * v, f: 1400, at: t }); },
  snare:  (b, v, t) => { noise(b, { dur: 0.16, gain: 0.5 * v, f: 1900, q: 0.8, at: t }); tone(b, { f: 215, f2: 175, dur: 0.11, gain: 0.36 * v, type: 'triangle', at: t }); },
  hat:    (b, v, t) => { noise(b, { dur: 0.05, gain: 0.26 * v, type: 'highpass', f: 8200, at: t }); },
  openhat:(b, v, t) => { noise(b, { dur: 0.34, gain: 0.24 * v, type: 'highpass', f: 7600, fEnd: 5400, at: t }); },
  tom1:   (b, v, t) => { tone(b, { f: 235, f2: 150, dur: 0.24, gain: 0.5 * v, type: 'sine', at: t }); noise(b, { dur: 0.05, gain: 0.12 * v, f: 900, at: t }); },
  tom2:   (b, v, t) => { tone(b, { f: 190, f2: 122, dur: 0.27, gain: 0.52 * v, type: 'sine', at: t }); noise(b, { dur: 0.05, gain: 0.12 * v, f: 800, at: t }); },
  floor:  (b, v, t) => { tone(b, { f: 145, f2: 82, dur: 0.34, gain: 0.56 * v, type: 'sine', at: t }); noise(b, { dur: 0.06, gain: 0.12 * v, f: 650, at: t }); },
  crash:  (b, v, t) => { noise(b, { dur: 1.1, gain: 0.30 * v, type: 'highpass', f: 5200, at: t }); noise(b, { dur: 0.5, gain: 0.16 * v, f: 2900, q: 2, at: t }); },
  ride:   (b, v, t) => { noise(b, { dur: 0.5, gain: 0.16 * v, type: 'bandpass', f: 6600, q: 3.5, at: t }); tone(b, { f: 512, dur: 0.22, gain: 0.05 * v, type: 'square', at: t }); },
};
export function ekit(pad = 'snare', vel = 0.9, at = 0) {
  if (!AC) return;
  const { drumBus } = buses();
  const t = at || AC.currentTime;
  (EKIT[pad] || EKIT.snare)(drumBus, Math.min(1, vel), t);
  reportHit('ekit', pad, t);
}

/** 🎸 the Kala U·BASS — fat polyurethane strings: round, thumpy, sings at the low end */
export function ubass(midi = 36, at = 0, when = null) {
  if (!AC) return;
  const { bassBus } = buses();
  const t = at || AC.currentTime;
  const f = n2f(midi);
  pluck(bassBus, { f, dur: 1.7, gain: 0.62, damp: 950, bright: 0.16, at: t, a: 0.012 });
  tone(bassBus, { f: f / 2, dur: 0.6, gain: 0.24, type: 'sine', at: t, atk: 0.02 });       // the sub-bloom
  tone(bassBus, { f: f * 2.01, dur: 0.3, gain: 0.05, type: 'triangle', at: t, atk: 0.01 }); // a little fretless mwah
  reportHit('ubass', midi, when || t);
}

/** 🎶 the Kala ukulele — GCEA re-entrant, bright nylon, strummed */
const UKE_CHORDS = {
  C:  [60, 64, 67, 72],   // 0003
  G:  [55, 59, 62, 67],   // 0232
  Am: [57, 60, 64, 69],   // 2000
  F:  [53, 57, 60, 65],   // 2010 (re-entrant voicing)
  D:  [62, 66, 69, 74],   // 2220-ish, friendly
  Em: [52, 55, 59, 64],
};
export function uke(chordOrNotes = 'C', dir = 'down', at = 0) {
  if (!AC) return;
  const { ukeBus } = buses();
  const t = at || AC.currentTime;
  const notes = Array.isArray(chordOrNotes) ? chordOrNotes : (UKE_CHORDS[chordOrNotes] || UKE_CHORDS.C);
  const seq = dir === 'up' ? [...notes].reverse() : notes;
  seq.forEach((n, k) => {
    pluck(ukeBus, { f: n2f(n), dur: 1.5, gain: 0.30, damp: 3400, bright: 0.6, at: t + k * 0.016, a: 0.003 });
  });
  reportHit('uke', chordOrNotes, t);
}

/** 🏮 a tiny lantern chime — one soft khom-loi bell (used by the lantern button) */
export function chime() {
  if (!AC) return;
  const b = bus(0.5, 0.5);
  const t = AC.currentTime;
  [660, 990, 1320].forEach((f, k) => tone(b, { f, dur: 1.4 - k * 0.3, gain: 0.07 / (k + 1), type: 'sine', at: t + k * 0.02, atk: 0.004 }));
}

/* ── 🎶 the jam: all four together, I–V–vi–IV in C, ~92 bpm ───────────────
   A look-ahead scheduler keeps it sample-accurate; every note reports a hit
   with its performance time so the 3D plays along. */
export const jam = (() => {
  const BPM = 92, SPB = 60 / BPM, BAR = SPB * 4;
  const CHORDS = [
    { name: 'C', bass: 36, uke: 'C', roots: [36, 43, 48] },
    { name: 'G', bass: 43, uke: 'G', roots: [43, 50, 55] },
    { name: 'Am', bass: 45, uke: 'Am', roots: [45, 52, 57] },
    { name: 'F', bass: 41, uke: 'F', roots: [41, 48, 53] },
  ];
  let running = false, timer = 0, nextBar = 0, bar = 0;
  function scheduleBar(b, t0) {
    const ch = CHORDS[b % 4];
    // drums
    for (let s = 0; s < 8; s++) {
      const t = t0 + s * SPB / 2;
      if (s % 2 === 0) ekit('hat', s === 4 ? 0.5 : 0.34, t);
      if (s === 0 || s === 3 || s === 5) ekit('kick', 0.9, t);
      if (s === 2 || s === 6) ekit('snare', 0.85, t);
      if (s === 7 && b % 4 === 3) ekit('openhat', 0.5, t);
    }
    if (b % 8 === 7) { ekit('crash', 0.7, t0); ekit('floor', 0.7, t0 + SPB * 3.5); }
    // U·BASS: roots on 1 and 3, a fifth walk on 4
    ubass(ch.bass, t0);
    ubass(ch.bass, t0 + SPB * 2);
    ubass(ch.bass + (b % 2 ? 7 : 12), t0 + SPB * 3, t0 + SPB * 3);
    // piano: chord stabs on the off-beats (2&, 4&)
    ch.roots.forEach(n => { pianoNote(n + 12, 0.5, t0 + SPB * 1.5); pianoNote(n + 12, 0.42, t0 + SPB * 3.5); });
    // uke: down-up strums through the bar
    uke(ch.uke, 'down', t0 + SPB * 1);
    uke(ch.uke, 'up', t0 + SPB * 2.5);
    if (b % 2) uke(ch.uke, 'down', t0 + SPB * 3.75);
  }
  function pump() {
    if (!running) return;
    const ahead = AC.currentTime + 0.35;
    while (nextBar < ahead) { scheduleBar(bar, nextBar); bar++; nextBar += BAR; }
    timer = setTimeout(pump, 90);
  }
  return {
    start() {
      if (!AC || running) return;
      buses();
      running = true; bar = 0; nextBar = AC.currentTime + 0.08;
      pump();
    },
    stop() { running = false; clearTimeout(timer); },
    get running() { return running; },
  };
})();
