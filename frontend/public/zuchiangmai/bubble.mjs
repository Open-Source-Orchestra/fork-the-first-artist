/* SPDX-License-Identifier: GPL-3.0-or-later — made by the AI ʻohana for the Open Source Orchestra
   (Fork the First Artist · Zu Chiang Mai bubble).
   ── THE FULL CIRCLE · IN THE 4SEAS BUBBLE ─────────────────────────────────────────────────
   The garden circle of artist.opensourceorchestra.org (app.js), re-housed for Chiang Mai:
   a bubble under the palms, two Naga on guard (world.mjs), and the Rider Sanctuary — the 4Seas
   corner with the house piano + electric drum kit and the Kala U·BASS + ukulele (rider.mjs,
   audio.mjs, rider-ui.mjs). Same artists, same garden keys, same fork + tip layers (fork.js,
   tip.mjs listen for 'fork:artist'). three.js r169 vendored · no CDN · no trackers.
   Every heavy piece is loaded defensively: if the world or the rider can't start on a device,
   the circle still stands. */
import * as THREE from '/vendor/three.module.min.js';
import { initFinder } from '/finder.js';
import { mergeEdits, applyLocal } from '/overlay.js';
import { t, captureEnglish, initialLang, setLang, getLang, onLang, bindLangButtons, applyI18n } from './i18n.mjs';

const V = '20261116a';
const C = { gold: 0xf0c464, goldBright: 0xffd97a, teal: 0x2dd4bf, rose: 0xe86a92, coral: 0xff8a5c, violet: 0xb48cff, lotus: 0xff7eb6 };
const R_CIRCLE = 3.0;                       // Ø 6 m — the rugs, not a riser
const CORNER = new THREE.Vector3(0, 0, -5.6);   // the 4Seas music corner (rider.mjs)
const IS_TOUCH = matchMedia('(pointer:coarse)').matches;
const CALM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SMALL = () => innerWidth < 760;
const DEVCON = 'https://app.devcon.org';

const $ = (s) => document.querySelector(s);
let renderer, scene, camera, player, clock, raycaster;
let ARTISTS = [], BY = {}, ORDER = [], HOSTS = [];
const figures = new Map();
let circle = [];
let selected = null, everyone = false, mode = 'circle';
let ledRing = null, ledLights = [], threads, sparks, centreRing, pulseRing, motes;
let world = null, rider = null, AU = null, RUI = null, riderMounted = false, muted = false;
const orbit = { yaw: 0.0, h: 3.4, r: 9.6, targetYaw: null, auto: true, lastTouch: 0, rTarget: null, hTarget: null,
  center: new THREE.Vector3(0, 0.9, 0), centerTarget: new THREE.Vector3(0, 0.9, 0), swayBase: 0 };
const ptr = { down: false, x: 0, y: 0, moved: 0, pinch: 0 };
const tmp = new THREE.Vector3(), camPos = new THREE.Vector3();
let hoverObj = null, bloomAt = -99, circleFade = 1, jamTimer = 0;
let qAccum = 0, qFrames = 0, qStep = 0;
const ledCol = new THREE.Color();

/* ── boot ───────────────────────────────────────────────────────────────── */
async function boot() {
  captureEnglish();
  setLang(initialLang(), { save: false });
  bindLangButtons();
  const [a, edits] = await Promise.all([
    fetch('/data/artists.json').then(r => r.json()),
    fetch('/data/edits.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null),
  ]);
  ARTISTS = a.artists; ARTISTS.forEach(x => (BY[x.slug] = x));
  try { mergeEdits(BY, edits); applyLocal(BY, edits); } catch (e) { console.warn('garden edits skipped', e); }
  // the garden's photo paths are relative to the root page; this page lives one level down
  ARTISTS.forEach(x => { if (x.photo && !/^(https?:|data:|\/)/.test(x.photo)) x.photo = '/' + x.photo; });
  const dayKey = (x) => (x.day || 9) * 10000 + t2m(x.time);
  HOSTS = ARTISTS.filter(x => x.kind === 'host').map(x => x.slug);
  ORDER = [
    ...HOSTS,
    ...ARTISTS.filter(x => x.kind === 'placed').sort((p, q) => dayKey(p) - dayKey(q)).map(x => x.slug),
    ...ARTISTS.filter(x => x.kind === 'garden').map(x => x.slug),
    ...ARTISTS.filter(x => x.kind === 'away').map(x => x.slug),
  ];
  $('#howmuch').max = ORDER.length;
  $('#howmuch-out').textContent = `0 / ${ORDER.length}`;
  buildScene();
  await dressScene();
  buildList();
  bindHud();
  initFinder({ ARTISTS, BY, ORDER, hueOf, initials, esc, refreshArtist, getCircle: () => circle, pick: (s) => { setMode('circle'); if (!circle.includes(s)) setCircle([...circle, s]); select(s); } });
  applyUrl();
  onLang(() => { figures.forEach(refreshCard); if (selected) select(selected, true); if (riderMounted) mountRider(true); updateSoundPill(); layoutCountText(); });
  $('#enter-label').textContent = t('load.enter', 'Enter the bubble'); window.__circleReady = true;
  $('#enter').addEventListener('click', () => {
    $('#loading').classList.add('gone'); orbit.auto = true;
    if (AU) { try { AU.init(); } catch {} }               // a user gesture: the only moment audio may wake
    if (mode === 'rider') openPanel('rider');
  });
  document.addEventListener('visibilitychange', () => renderer.setAnimationLoop(document.hidden ? null : tick));
  renderer.setAnimationLoop(tick);
  // a tiny debug hook (also used by the local test harness)
  window.__zcm = { orbit, setMode, focusInstrument, world: () => world, rider: () => rider, renderer: () => renderer, scene: () => scene, setCircle: () => circle, play };
}
function t2m(tm) { if (!tm) return 0; const m = /(\d+):(\d+)([ap])/.exec(tm); if (!m) return 0; let h = +m[1] % 12; if (m[3] === 'p') h += 12; return h * 60 + +m[2]; }

/* ── scene ──────────────────────────────────────────────────────────────── */
function buildScene() {
  clock = new THREE.Clock(); raycaster = new THREE.Raycaster();
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070b1c);           // world.mjs paints the real sky
  renderer = new THREE.WebGLRenderer({ antialias: !IS_TOUCH, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.5 : 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.06;
  $('#stage').appendChild(renderer.domElement);
  camera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.08, 400);
  player = new THREE.Group(); player.position.set(0, 3.4, 9.6); player.add(camera); scene.add(player);

  // light: a cool night wash + the circle's own warm glow (sprites are unlit; this is for rugs, gear, palms)
  scene.add(new THREE.HemisphereLight(0x7d8ad8, 0x1d1430, 0.85));
  scene.add(new THREE.AmbientLight(0xffd9a8, 0.22));
  const centre = new THREE.PointLight(C.gold, 3.0, 24, 2); centre.position.set(0, 3.6, 0); scene.add(centre);
  [[C.lotus, 0], [C.teal, 1], [C.coral, 2], [C.violet, 3]].forEach(([col, i]) => {
    const l = new THREE.PointLight(col, 1.3, 18, 2); l.userData.i = i; l.position.set(0, 3.2, 0); scene.add(l); ledLights.push(l);
  });
  // the 4Seas corner wears violet, like the real room at night
  const wash = new THREE.PointLight(0xa070ff, 5.5, 8.5, 2); wash.position.set(CORNER.x, 3.1, CORNER.z + 0.8); scene.add(wash);

  // the rug: a Lanna-woven circle (indigo, lotus, gold diamonds, jade)
  const rug = new THREE.Mesh(new THREE.CircleGeometry(R_CIRCLE + 0.35, 96), new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 0.96, metalness: 0 }));
  rug.rotation.x = -Math.PI / 2; rug.position.y = 0.016; scene.add(rug);
  // the low LED ring — one instanced draw, every bead its own colour
  const N = 72;
  ledRing = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.05, 0.07), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    q.setFromAxisAngle(up, -a); m4.compose(new THREE.Vector3(Math.cos(a) * (R_CIRCLE + 0.5), 0.035, Math.sin(a) * (R_CIRCLE + 0.5)), q, new THREE.Vector3(1, 1, 1));
    ledRing.setMatrixAt(i, m4); ledRing.setColorAt(i, ledCol.set(C.teal));
  }
  ledRing.userData.a = Float32Array.from({ length: N }, (_, i) => (i / N) * Math.PI * 2);
  scene.add(ledRing);
  // centre: no conductor stands here
  centreRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.012, 8, 48), new THREE.MeshStandardMaterial({ color: C.gold, emissive: C.gold, emissiveIntensity: 0.9 }));
  centreRing.rotation.x = Math.PI / 2; centreRing.position.y = 0.02; scene.add(centreRing);
  pulseRing = new THREE.Mesh(new THREE.RingGeometry(0.96, 1.0, 96), new THREE.MeshBasicMaterial({ color: C.lotus, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  pulseRing.rotation.x = -Math.PI / 2; pulseRing.position.y = 0.03; scene.add(pulseRing);
  // Ξ — the mark of the house, inlaid and hovering
  const xi = xiTexture();
  const inlay = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ map: xi, transparent: true, opacity: 0.16, depthWrite: false }));
  inlay.rotation.x = -Math.PI / 2; inlay.position.y = 0.022; scene.add(inlay);

  buildThreads();
  buildMotes();
  bindPointer();
  addEventListener('resize', onResize);
}

/* the world + the rider corner + the band: each loaded on its own, each allowed to fail alone */
async function dressScene() {
  const lite = IS_TOUCH || innerWidth * innerHeight < 500000;
  const [W, R, A, U] = await Promise.all([
    import(`./world.mjs?v=${V}`).catch((e) => { console.warn('world skipped', e); return null; }),
    import(`./rider.mjs?v=${V}`).catch((e) => { console.warn('rider skipped', e); return null; }),
    import(`./audio.mjs?v=${V}`).catch((e) => { console.warn('audio skipped', e); return null; }),
    import(`./rider-ui.mjs?v=${V}`).catch((e) => { console.warn('rider ui skipped', e); return null; }),
  ]);
  if (W?.buildWorld) { try { world = W.buildWorld(THREE, scene, { lite, calm: CALM }); } catch (e) { console.warn('world failed', e); world = null; } }
  if (!world) { scene.fog = new THREE.FogExp2(0x0b1030, 0.01); const fl = new THREE.Mesh(new THREE.CircleGeometry(16, 48), new THREE.MeshStandardMaterial({ color: 0x141a3f, roughness: 0.95 })); fl.rotation.x = -Math.PI / 2; scene.add(fl); }
  if (R?.buildRider) { try { rider = R.buildRider(THREE, scene, { lite, calm: CALM, at: CORNER.clone() }); } catch (e) { console.warn('rider failed', e); rider = null; } }
  if (A) {
    AU = A;
    try { AU.onHit?.((id, part, when) => { const ac = AU.ctx?.(); const ms = ac && when ? Math.max(0, (when - ac.currentTime) * 1000) : 0; setTimeout(() => rider?.hit?.(id, part, 1), ms); }); } catch {}
  }
  if (U?.mountRiderUI) RUI = U;
  if (!rider) { $('#m-rider').hidden = true; }
  if (!world) { $('#m-naga').hidden = true; $('#btn-lantern').hidden = true; }
  if (AU) addSoundPill();
}

function rugTexture() {
  const S = 1024, cv = document.createElement('canvas'); cv.width = cv.height = S; const x = cv.getContext('2d');
  const c = S / 2, R = S / 2;
  x.fillStyle = '#121838'; x.fillRect(0, 0, S, S);
  const ring = (r0, r1, col) => { x.beginPath(); x.arc(c, c, r1 * R, 0, Math.PI * 2); x.arc(c, c, r0 * R, 0, Math.PI * 2, true); x.fillStyle = col; x.fill(); };
  // woven ground: faint warp lines
  x.globalAlpha = 0.07; x.strokeStyle = '#b48cff'; x.lineWidth = 1;
  for (let i = 0; i < 160; i++) { x.beginPath(); x.arc(c, c, (i / 160) * R, 0, Math.PI * 2); x.stroke(); }
  x.globalAlpha = 1;
  ring(0.955, 0.995, '#e0408a'); ring(0.905, 0.955, '#1b2350'); ring(0.885, 0.905, '#f0c464');
  ring(0.70, 0.73, '#2dd4bf'); ring(0.44, 0.47, '#e0408a'); ring(0.16, 0.175, '#f0c464');
  // gold diamond chain (Lanna tin-jok-like), two rounds
  const chain = (rr, n, size, col, alt) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2; x.save(); x.translate(c + Math.cos(a) * rr * R, c + Math.sin(a) * rr * R); x.rotate(a);
      x.beginPath(); x.moveTo(0, -size); x.lineTo(size * 0.62, 0); x.lineTo(0, size); x.lineTo(-size * 0.62, 0); x.closePath();
      x.fillStyle = (alt && i % 2) ? alt : col; x.fill();
      x.beginPath(); x.moveTo(0, -size * 0.45); x.lineTo(size * 0.28, 0); x.lineTo(0, size * 0.45); x.lineTo(-size * 0.28, 0); x.closePath(); x.fillStyle = '#121838'; x.fill();
      x.restore();
    }
  };
  chain(0.93, 72, 13, '#ffd97a', '#ff7eb6');
  chain(0.585, 44, 18, '#f0c464', '#2dd4bf');
  // a lotus at the heart (eight petals), very faint — the Ξ sits on top of it
  x.save(); x.translate(c, c); x.globalAlpha = 0.5;
  for (let i = 0; i < 8; i++) { x.rotate(Math.PI / 4); x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(34, -60, 0, -128); x.quadraticCurveTo(-34, -60, 0, 0); x.strokeStyle = '#ff7eb6'; x.lineWidth = 3; x.stroke(); }
  x.restore(); x.globalAlpha = 1;
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8; return tx;
}
function xiTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const x = cv.getContext('2d');
  x.strokeStyle = '#ffd97a'; x.lineWidth = 6; x.beginPath(); x.arc(128, 128, 118, 0, Math.PI * 2); x.stroke();
  x.fillStyle = '#ffd97a'; x.font = 'bold 170px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('Ξ', 128, 136);
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; return tx;
}

/* ── figures: one billboard card per artist ─────────────────────────────── */
function hueOf(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }
function initials(a) { return a.name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '♪'; }
function roundRect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
function wrap(x, text, maxW, size) { x.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`; const words = text.split(' '); const lines = []; let cur = '';
  for (const w of words) { const tt = cur ? cur + ' ' + w : w; if (x.measureText(tt).width > maxW && cur) { lines.push(cur); cur = w; } else cur = tt; } if (cur) lines.push(cur); return lines.slice(0, 2); }
function cardLine(a) {
  if (a.kind === 'host') return t('card.host', 'in the bubble · Chiang Mai');
  if (a.kind === 'placed') return t('card.placed', 'Devcon 8 · {set}', { set: (a.set || '').replace(/ · \d+ min$/, '') });
  if (a.kind === 'away') return t('card.away', 'in the garden');
  return t('card.garden', 'the garden · OSO Open');
}
function cardTexture(a, img, sel) {
  const W = 400, H = 520, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d');
  x.fillStyle = sel ? 'rgba(14,40,46,.92)' : 'rgba(9,13,34,.88)'; roundRect(x, 6, 6, W - 12, H - 12, 34); x.fill();
  x.strokeStyle = sel ? 'rgba(45,212,191,.95)' : a.kind === 'host' ? 'rgba(255,217,122,.88)' : a.kind === 'placed' ? 'rgba(240,196,100,.6)' : a.kind === 'away' ? 'rgba(255,126,182,.55)' : 'rgba(45,212,191,.5)';
  x.lineWidth = sel ? 6 : 3; x.stroke();
  const cx = W / 2, cy = 150, r = 112;
  x.save(); x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.closePath(); x.clip();
  if (img) x.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  else { const h = hueOf(a.slug); const g = x.createLinearGradient(cx - r, cy - r, cx + r, cy + r); g.addColorStop(0, `hsl(${h} 52% 42%)`); g.addColorStop(1, `hsl(${h + 55} 58% 28%)`); x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
    x.fillStyle = 'rgba(255,255,255,.95)'; x.font = '800 86px ui-sans-serif, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(initials(a), cx, cy + 4); }
  x.restore();
  x.beginPath(); x.arc(cx, cy, r + 3, 0, Math.PI * 2); x.strokeStyle = 'rgba(255,255,255,.25)'; x.lineWidth = 3; x.stroke();
  x.font = '44px ui-sans-serif, system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = 'rgba(9,13,34,.92)'; x.beginPath(); x.arc(cx + 84, cy + 84, 36, 0, Math.PI * 2); x.fill(); x.fillText((a.glyph || '🎶').slice(0, 2), cx + 84, cy + 88);
  x.fillStyle = '#ffd97a'; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  const nm = a.name.replace(/\s*—.*$/, '');
  let lines = wrap(x, nm, W - 50, 34); if (lines.length > 1) lines = wrap(x, nm, W - 50, 30);
  lines.forEach((l, i) => x.fillText(l, cx, 318 + i * 36));
  x.fillStyle = 'rgba(247,236,217,.76)'; x.font = '300 21px ui-sans-serif, system-ui, sans-serif';
  const role = (a.role || a.tagline || '').split(' · ')[0];
  x.fillText(role.length > 34 ? role.slice(0, 33) + '…' : role, cx, 318 + lines.length * 36 + 4);
  x.fillStyle = '#2dd4bf'; x.font = '600 22px ui-sans-serif, system-ui, "Noto Sans Thai", "Noto Sans SC", sans-serif';
  const line = cardLine(a);
  x.fillText(getLang() === 'en' ? line.toUpperCase() : line, cx, H - 40, W - 40);
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; return tx;
}
function auraTexture(col) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d');
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 64); g.addColorStop(0, col + 'cc'); g.addColorStop(0.5, col + '44'); g.addColorStop(1, col + '00'); x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}
const AURA = {};
function aura(kind) { const col = kind === 'host' ? '#ffd97a' : kind === 'away' ? '#ff7eb6' : kind === 'garden' ? '#2dd4bf' : '#b48cff'; return AURA[col] || (AURA[col] = auraTexture(col)); }

function makeFigure(a) {
  const g = new THREE.Group(); g.visible = false;
  const card = new THREE.Sprite(new THREE.SpriteMaterial({ map: cardTexture(a, null, false), transparent: true, depthWrite: false }));
  card.scale.set(1.0, 1.3, 1); card.position.y = a.seated ? 0.98 : 1.5; card.renderOrder = 5; card.userData.slug = a.slug; g.add(card);
  const au = new THREE.Sprite(new THREE.SpriteMaterial({ map: aura(a.kind), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  au.scale.set(1.9, a.seated ? 1.7 : 2.6, 1); au.position.y = a.seated ? 0.75 : 1.25; au.renderOrder = 2; g.add(au);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.4, 32), new THREE.MeshBasicMaterial({ color: a.kind === 'host' ? C.gold : C.teal, transparent: true, opacity: 0.22, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.026; g.add(disc);
  if (a.seated) {
    const cu = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 10), new THREE.MeshStandardMaterial({ color: hueOf(a.slug) % 2 ? 0xb3405a : 0xd98c3a, roughness: 1 }));
    cu.scale.y = 0.4; cu.position.y = 0.13; g.add(cu);
  }
  scene.add(g);
  const f = { a, g, card, au, disc, target: new THREE.Vector3(), ph: Math.random() * 6.28, arrive: 0, img: null, sel: false };
  if (a.photo) { const im = new Image(); im.onload = () => { f.img = im; refreshCard(f); }; im.src = a.photo; }
  return f;
}
function refreshCard(f) { const old = f.card.material.map; f.card.material.map = cardTexture(f.a, f.img, f.sel); f.card.material.needsUpdate = true; old && old.dispose(); }

/* ── layout: hosts near the middle, everyone else in rings on the floor ─── */
function layout() {
  const n = circle.length, tt = clock.elapsedTime;
  const hosts = circle.filter(s => BY[s].kind === 'host'), rest = circle.filter(s => BY[s].kind !== 'host');
  hosts.forEach((s, i) => { const a = (i / Math.max(hosts.length, 1)) * Math.PI * 2 + Math.PI; const r = hosts.length === 1 ? 0.9 : 1.05; placeFig(s, Math.sin(a) * r, Math.cos(a) * r, tt); });
  const rings = rest.length <= 9 ? [[2.3, 99]] : rest.length <= 22 ? [[1.85, 9], [3.0, 99]] : [[1.75, 8], [2.8, 14], [3.85, 99]];
  let i = 0;
  rings.forEach(([r, cap], ri) => {
    const grp = rest.slice(i, i + cap); i += cap;
    grp.forEach((s, k) => { const a = (k / grp.length) * Math.PI * 2 + ri * 0.21 + 0.1; placeFig(s, Math.sin(a) * r, Math.cos(a) * r, tt); });
  });
  const sc = n > 28 ? 0.86 : n > 16 ? 0.94 : 1;
  figures.forEach(f => { f.scaleTarget = sc; });
  if (mode === 'circle') { orbit.rTarget = n > 28 ? 12.2 : n > 16 ? 10.6 : n > 6 ? 9.6 : 9.2; orbit.hTarget = n > 28 ? 5.2 : n > 16 ? 4.3 : 3.6; }
  layoutCountText();
  $('#howmuch').value = n;
  $('#howmuch-out').textContent = `${n} / ${ORDER.length}`;
  const all = n >= ORDER.length;
  $('#btn-everyone').classList.toggle('playing', all);
  $('#btn-everyone').textContent = all ? t('act.everyone.on', '🎻 everyone is playing together') : t('act.everyone', 'Everyone plays together 🎻');
  document.querySelectorAll('#list .row').forEach(r => r.classList.toggle('in', circle.includes(r.dataset.slug)));
  document.querySelectorAll('#list .row .st').forEach(e => { e.textContent = circle.includes(e.parentElement.dataset.slug) ? '✓' : '+'; });
  rebuildThreads();
  writeUrl();
}
function layoutCountText() { $('#count-n').textContent = circle.length; }
function placeFig(s, x, z, tt) {
  let f = figures.get(s); if (!f) { f = makeFigure(BY[s]); figures.set(s, f); }
  f.target.set(x, 0, z);
  if (!f.g.visible) { f.g.visible = true; f.g.position.set(x * 0.2, 0, z * 0.2); f.arrive = tt + (everyone ? Math.random() * 1.6 : 0); f.g.scale.setScalar(0.001); }
}
function sameSet(a, b) { return a.length === b.length && a.every(s => b.includes(s)); }
function dayCircle(d) {
  if (d === 6) return [...HOSTS, ...ORDER.filter(s => BY[s].kind === 'placed')];
  return [...HOSTS, ...ORDER.filter(s => BY[s].kind === 'placed' && (BY[s].day === d || BY[s].slug === '0xmentalist'))];
}
function setCircle(list, opts = {}) {
  everyone = !!opts.everyone;
  const next = [...new Set(list)].filter(s => BY[s]);
  figures.forEach((f, s) => { if (!next.includes(s)) { f.g.visible = false; } });
  circle = next; layout();
  if (everyone) { bloomAt = clock.elapsedTime; }
  world?.setMood?.(everyone ? 1 : Math.min(0.85, 0.35 + circle.length / 60));
}

/* ── threads of light between the players ───────────────────────────────── */
const MAXL = 70 * 4;
function buildThreads() {
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXL * 2 * 3), 3));
  threads = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: C.violet, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  threads.frustumCulled = false; scene.add(threads);
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXL * 2 * 3), 3));
  sparks = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffe9b0, size: 0.07, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  sparks.frustumCulled = false; sparks.userData.t = new Float32Array(MAXL * 2).map(() => Math.random()); scene.add(sparks);
  threads.userData.links = [];
}
function rebuildThreads() {
  const L = [];
  const list = circle.map(s => figures.get(s));
  const centre = { target: new THREE.Vector3(0, 0, 0), y: 0.5 };
  list.forEach((f, i) => {
    L.push([f, list[(i + 1) % list.length]]);
    if (list.length > 5) L.push([f, list[(i + Math.floor(list.length / 3)) % list.length]]);
    if (list.length < 6 || i % 2 === 0) L.push([f, centre]);
  });
  threads.userData.links = L.slice(0, MAXL);
  threads.geometry.setDrawRange(0, threads.userData.links.length * 2);
  sparks.geometry.setDrawRange(0, threads.userData.links.length * 2);
}
function updateThreads(dt, beat) {
  const L = threads.userData.links; const P = threads.geometry.attributes.position.array; const S = sparks.geometry.attributes.position.array; const T = sparks.userData.t;
  const hy = (f) => f.y !== undefined ? f.y : (f.a.seated ? 0.95 : 1.45);
  for (let i = 0; i < L.length; i++) {
    const [a, b] = L[i];
    const pa = a.g ? a.g.position : a.target, pb = b.g ? b.g.position : b.target;
    const ya = hy(a), yb = hy(b);
    P[i * 6] = pa.x; P[i * 6 + 1] = ya; P[i * 6 + 2] = pa.z; P[i * 6 + 3] = pb.x; P[i * 6 + 4] = yb; P[i * 6 + 5] = pb.z;
    for (let k = 0; k < 2; k++) { const j = i * 2 + k; T[j] = (T[j] + dt * (0.18 + k * 0.11)) % 1; const u = T[j];
      S[j * 3] = pa.x + (pb.x - pa.x) * u; S[j * 3 + 1] = ya + (yb - ya) * u + Math.sin(u * Math.PI) * 0.25; S[j * 3 + 2] = pa.z + (pb.z - pa.z) * u; }
  }
  threads.geometry.attributes.position.needsUpdate = true; sparks.geometry.attributes.position.needsUpdate = true;
  threads.material.opacity = (0.18 + beat * 0.3) * circleFade; sparks.material.opacity = 0.9 * circleFade; sparks.material.size = 0.06 + beat * 0.05;
}
/* a few warm motes inside the bubble (the fireflies outside belong to world.mjs) */
function buildMotes() {
  const n = IS_TOUCH ? 90 : 180, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * 7.6; p[i * 3] = Math.cos(a) * r; p[i * 3 + 1] = Math.random() * 5.5 + 0.3; p[i * 3 + 2] = Math.sin(a) * r; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  motes = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffd9a0, size: 0.035, transparent: true, opacity: 0.45, depthWrite: false })); scene.add(motes);
}

/* ── modes: the circle · the rider sanctuary · the Naga ─────────────────── */
function setMode(next, { quiet = false } = {}) {
  if (next === 'rider' && !rider) next = 'circle';
  if (next === 'naga' && !world?.focus?.naga) next = 'circle';
  mode = next;
  document.querySelectorAll('#modes [data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  orbit.targetYaw = null; orbit.auto = true; orbit.lastTouch = clock.elapsedTime;
  if (mode === 'circle') {
    orbit.centerTarget.set(0, 0.9, 0); orbit.swayBase = 0; layout();
    rider?.highlight?.(null);
  } else if (mode === 'rider') {
    const c = rider.center || CORNER; orbit.centerTarget.set(c.x, 0.85, c.z);
    orbit.swayBase = 0; orbit.targetYaw = 0; orbit.rTarget = SMALL() ? 5.4 : 4.6; orbit.hTarget = 2.35;
    if (!quiet) toast(t('toast.rider', '<b>The Rider Sanctuary.</b> The 4Seas corner — tap an instrument: every one plays.'));
  } else if (mode === 'naga') {
    const f = world.focus.naga, cp = world.focus.nagaCam;
    orbit.centerTarget.copy(f);
    orbit.swayBase = Math.atan2(cp.x - f.x, cp.z - f.z); orbit.targetYaw = orbit.swayBase;
    orbit.rTarget = Math.hypot(cp.x - f.x, cp.z - f.z); orbit.hTarget = cp.y;
    if (!quiet) toast(t('toast.naga', '<b>Two Naga keep watch.</b> On the temple stairs of Lanna they guard the way up; here they guard the bubble.'));
  }
  writeUrl();
}
function focusInstrument(id) {
  if (!rider) return;
  if (mode !== 'rider') setMode('rider', { quiet: true });
  rider.highlight?.(id);
  const box = new THREE.Box3();
  (rider.pickables || []).forEach(o => { if (o.userData?.rider === id) box.expandByObject(o); });
  if (!box.isEmpty()) { box.getCenter(tmp); orbit.centerTarget.set(tmp.x, Math.max(0.6, tmp.y), tmp.z); orbit.rTarget = SMALL() ? 3.6 : 3.0; orbit.hTarget = Math.max(1.6, tmp.y + 1.3); orbit.targetYaw = Math.atan2(tmp.x - (rider.center || CORNER).x, 2.2); }
}

/* ── the band ───────────────────────────────────────────────────────────── */
function soundReady() { if (!AU || muted) return false; try { AU.init(); return true; } catch { return false; } }
function play(id, part) {
  if (!soundReady()) { rider?.hit?.(id, part, 1); return; }
  try {
    if (id === 'piano') AU.pianoNote(typeof part === 'number' ? part : 60, 0.8);
    else if (id === 'ekit') AU.ekit(typeof part === 'string' ? part : 'snare', 0.9);
    else if (id === 'ubass') AU.ubass(typeof part === 'number' ? part : 36);
    else if (id === 'uke') AU.uke(part || 'C', 'down');
  } catch (e) { console.warn(e); }
  rider?.hit?.(id, part, 1);
}
function addSoundPill() {
  const b = document.createElement('button'); b.className = 'pill'; b.id = 'btn-sound'; b.type = 'button';
  b.addEventListener('click', () => { muted = !muted; try { AU.init(); AU.setMuted(muted); } catch {} updateSoundPill(); });
  $('#actions').insertBefore(b, $('#btn-help')); updateSoundPill();
}
function updateSoundPill() { const b = $('#btn-sound'); if (!b) return; b.textContent = muted ? t('act.sound.off', '🔇 sound off') : t('act.sound.on', '🔊 sound on'); b.setAttribute('aria-pressed', String(!muted)); }
function startJam(bars = 16) {
  if (!soundReady() || !AU.jam) return false;
  try { AU.jam.start(); } catch { return false; }
  clearTimeout(jamTimer); jamTimer = setTimeout(() => { try { AU.jam.stop(); } catch {} }, Math.round(bars * 4 * 60000 / 92));
  return true;
}
function mountRider(remount = false) {
  if (!RUI || !rider || !AU) { $('#rider-body').innerHTML = `<p style="color:var(--cream-dim);line-height:1.6">${t('rider.unavailable', 'The Rider Sanctuary needs 3D and Web Audio, and this device said no to one of them. The 4Seas corner holds the house piano and electric drum kit, and the Kala U·BASS and ukulele.')}</p>`; return; }
  if (riderMounted && !remount) return;
  const el = $('#rider-body'); el.innerHTML = '';
  try {
    // RIDER_STRINGS_EN is nested ({piano:{name:…}}) but keys arrive dotted ('piano.name') — resolve by path.
    const enFor = (k) => k.split('.').reduce((o, p) => (o == null ? o : o[p]), RUI.RIDER_STRINGS_EN);
    RUI.mountRiderUI(el, { audio: AU, rider, t: (k, fb, vars) => t('rider.' + k, fb ?? enFor(k) ?? k, vars), onFocus: focusInstrument, onPlay: (id, part) => rider.hit?.(id, part, 1), isMuted: () => muted });
    riderMounted = true;
  } catch (e) { console.warn('rider ui failed', e); el.textContent = 'The rider panel could not start on this device.'; }
}

/* ── the HUD ────────────────────────────────────────────────────────────── */
function buildList() {
  const groups = [['host', t('list.host', '🎼 always in the circle')], ['placed', t('list.placed', '🗓 played Devcon 8 · Mumbai')], ['garden', t('list.garden', '🌱 the garden · OSO Open')], ['away', t('list.away', '🌺 in the garden this year, on the floor next time')]];
  const el = $('#list'); el.innerHTML = '';
  groups.forEach(([k, title]) => {
    const items = ORDER.filter(s => BY[s].kind === k); if (!items.length) return;
    const h = document.createElement('div'); h.className = 'grp'; h.textContent = title; el.appendChild(h);
    items.forEach(s => { const a = BY[s]; const b = document.createElement('button'); b.className = 'row'; b.dataset.slug = s; b.dataset.q = (a.name + ' ' + (a.role || '') + ' ' + (a.tagline || '') + ' ' + (a.set || '') + ' ' + (a.day ? 'nov ' + a.day : '')).toLowerCase();
      b.innerHTML = (a.photo ? `<img class="av" src="${esc(a.photo)}" alt="" loading="lazy">` : `<div class="av mono" style="background:linear-gradient(140deg,hsl(${hueOf(s)} 52% 42%),hsl(${hueOf(s) + 55} 58% 28%))">${esc(initials(a))}</div>`) +
        `<div class="nm">${esc(a.name)}<small>${esc(a.kind === 'placed' ? (a.set || '') : (a.role || a.tagline || '').split(' · ').slice(0, 2).join(' · '))}</small></div><span class="st">+</span>`;
      b.addEventListener('click', () => { setMode('circle', { quiet: true }); if (circle.includes(s)) { setCircle(circle.filter(x => x !== s)); if (selected === s) select(null); } else { setCircle([...circle, s]); select(s); } });
      el.appendChild(b); });
  });
  $('#search').addEventListener('input', (e) => { const q = e.target.value.trim().toLowerCase(); document.querySelectorAll('#list .row').forEach(r => { r.style.display = !q || r.dataset.q.includes(q) ? '' : 'none'; }); });
}
function bindHud() {
  document.querySelectorAll('#modes [data-mode]').forEach(b => b.addEventListener('click', () => {
    const m = b.dataset.mode; setMode(m);
    if (m === 'rider') { mountRider(); openPanel('rider'); select(null); }
    else if (m !== 'rider') $('#rider').classList.remove('open');
    if (m === 'naga') select(null);
  }));
  $('#btn-lantern').addEventListener('click', () => {
    camera.getWorldPosition(camPos);
    world?.releaseLantern?.(Math.atan2(camPos.x, camPos.z));
    toast(t('toast.lantern', '<b>A khom loi rises.</b> One light for everyone who ever played in the circle.'));
  });
  $('#btn-add').addEventListener('click', () => openPanel('picker'));
  $('#btn-clear').addEventListener('click', () => { setCircle([]); select(null); });
  $('#howmuch').addEventListener('input', (e) => { const k = +e.target.value; setMode('circle', { quiet: true }); setCircle(ORDER.slice(0, k), { everyone: k >= ORDER.length }); });
  $('#btn-everyone').addEventListener('click', () => {
    if (circle.length >= ORDER.length && AU?.jam?.running) { try { AU.jam.stop(); } catch {} clearTimeout(jamTimer); toast(t('toast.rest', '<b>The band rests.</b> Everyone is still here.')); return; }
    setMode('circle', { quiet: true });
    setCircle(ORDER, { everyone: true });
    const band = startJam(16);
    toast(t(band ? 'toast.everyone.band' : 'toast.everyone', band ? '<b>{n} voices, one bubble — and the band is playing.</b> Piano, drums, U·BASS and ukulele: C · G · Am · F. Tap again to let them rest.' : '<b>{n} voices, one bubble.</b> Not a stage — a circle on the floor, and everyone is on it.', { n: circle.length }));
  });
  $('#btn-share').addEventListener('click', share);
  $('#btn-help').addEventListener('click', () => { $('#help').classList.add('open'); $('#help-close').focus(); });
  $('#help-close').addEventListener('click', () => $('#help').classList.remove('open'));
  $('#help').addEventListener('click', (e) => { if (e.target.id === 'help') $('#help').classList.remove('open'); });
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { const id = b.dataset.close; $('#' + id).classList.remove('open'); if (id === 'detail') select(null); updateViewOffset(); }));
  addEventListener('hashchange', () => { const s = location.hash.slice(1); if (s && BY[s]) { setMode('circle', { quiet: true }); if (!circle.includes(s)) setCircle([...circle, s]); select(s); } else if (s === 'rider' || s === 'naga') { setMode(s); if (s === 'rider') { mountRider(); openPanel('rider'); } } });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { select(null); document.querySelectorAll('.panel.open').forEach(p => p.classList.remove('open')); $('#help').classList.remove('open'); updateViewOffset(); } });
}
function openPanel(id) {
  document.querySelectorAll('.panel.open').forEach(p => { if (p.id !== id) p.classList.remove('open'); });
  $('#' + id).classList.add('open');
  if (id === 'picker') setTimeout(() => !IS_TOUCH && $('#search').focus(), 300);
  updateViewOffset();
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
let toastT;
function toast(html) { const el = $('#toast'); el.innerHTML = html; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 4800); }

/* when a panel covers part of the screen, slide the camera's frame so what you look at stays in view */
function updateViewOffset() {
  const open = document.querySelector('.panel.open');
  const w = innerWidth, h = innerHeight;
  if (!open) { camera.clearViewOffset(); return; }
  const r = open.getBoundingClientRect();
  if (SMALL()) { const covered = Math.max(0, h - Math.max(r.top, 0)); camera.setViewOffset(w, h, 0, Math.round(covered * 0.42), w, h); }
  else { camera.setViewOffset(w, h, Math.round(Math.min(r.width, w * 0.5) * 0.5), 0, w, h); }
}

function refreshArtist(s) { const f = figures.get(s); if (f) refreshCard(f); if (selected === s) select(s, true); }
function select(s, quiet = false) {
  if (selected && figures.get(selected)) { const f = figures.get(selected); f.sel = false; refreshCard(f); }
  selected = s;
  if (!s) { $('#detail').classList.remove('open'); updateViewOffset(); writeUrl(); return; }
  if (mode !== 'circle') setMode('circle', { quiet: true });
  const f = figures.get(s); if (f) { f.sel = true; refreshCard(f); if (!quiet) { orbit.targetYaw = Math.atan2(f.target.x, f.target.z); orbit.auto = false; orbit.lastTouch = clock.elapsedTime; } }
  const a = BY[s];
  $('#detail-title').textContent = a.name;
  const links = [];
  if (a.profile) links.push(`<a class="pill" href="${esc(a.profile)}" target="_blank" rel="noopener">🖼 ${esc(t('detail.profile', 'profile'))}</a>`);
  if (a.rider) links.push(`<a class="pill" href="${esc(a.rider)}" target="_blank" rel="noopener">🎚 ${esc(t('detail.rider', 'rider'))}</a>`);
  if (a.code) links.push(`<a class="pill teal" href="${DEVCON}/schedule/${esc(a.code)}" target="_blank" rel="noopener">📱 ${esc(t('detail.session', 'their Devcon 8 session (archive)'))}</a>`);
  (Array.isArray(a.links) ? a.links : []).forEach(l => { if (l && /^https?:/.test(l.url || '')) links.push(`<a class="pill violet" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`); });
  const setLine = a.kind === 'placed' ? '🗓 ' + esc(t('detail.played', 'played Devcon 8 · {set}', { set: a.set || '' })) : a.kind === 'host' ? '🌴 ' + esc(t('detail.host', 'always in the circle — and in the bubble, in Chiang Mai')) : a.kind === 'away' ? '🌺 ' + esc(t('detail.away', 'in the garden this year, on the floor next time')) : '🌱 ' + esc(t('detail.garden', 'OSO Open · the garden — no set time yet, a place in the circle always'));
  $('#detail-body').innerHTML = `
    <div class="hero">${a.photo ? `<img src="${esc(a.photo)}" alt="">` : `<div class="mono" style="background:linear-gradient(140deg,hsl(${hueOf(s)} 52% 42%),hsl(${hueOf(s) + 55} 58% 28%))">${esc(initials(a))}</div>`}
      <div><h3>${esc(a.name)}</h3><div class="role">${esc(a.glyph || '')} ${esc(a.role || (a.tagline || '').split(' · ')[0])}</div></div></div>
    <div class="set">${setLine}</div>
    ${a.headline ? `<div class="head">${esc(a.headline)}</div>` : ''}
    ${a.tagline ? `<div class="tag">${esc(a.tagline)}</div>` : ''}
    ${a.bio ? `<div class="bio">${esc(a.bio)}</div>` : ''}
    <div class="links">${links.join('')}</div>
    <div class="links" style="margin-top:10px"><button class="pill rose" id="detail-remove">− ${esc(t('detail.remove', 'take out of the circle'))}</button><button class="pill" id="detail-share">🔗 ${esc(t('detail.share', 'link to this artist'))}</button></div>
  `;
  $('#detail-remove').addEventListener('click', () => { setCircle(circle.filter(x => x !== s)); select(null); });
  $('#detail-share').addEventListener('click', () => { const u = location.origin + location.pathname + '?who=' + circle.join(',') + '#' + s; copy(u, t('toast.copied.artist', 'link to {name} copied', { name: a.name })); });
  document.dispatchEvent(new CustomEvent('fork:artist', { detail: { slug: s, artist: a } }));   // 🍴 fork.js + 💸 tip.mjs
  if (!quiet) openPanel('detail'); writeUrl();
}
function isDefaultCircle() { return sameSet(circle, HOSTS); }
function writeUrl() {
  const p = new URLSearchParams(location.search);
  if (circle.length && !isDefaultCircle()) p.set('who', circle.length >= ORDER.length ? 'everyone' : circle.join(',')); else p.delete('who');
  p.delete('day');
  const hash = selected ? '#' + selected : (mode !== 'circle' ? '#' + mode : '');
  const qs = p.toString();
  const u = location.pathname + (qs ? '?' + qs.replace(/%2C/g, ',') : '') + hash;
  if (u !== location.pathname + location.search + location.hash) history.replaceState(null, '', u);
}
function applyUrl() {
  const p = new URLSearchParams(location.search);
  const who = p.get('who'); const day = p.get('day'); const hash = location.hash.slice(1);
  if (who === 'everyone' || who === 'all') setCircle(ORDER, { everyone: true });
  else if (who) { const ids = who.split(',').map(s => s.trim()).filter(Boolean), ok = ids.filter(s => BY[s]); setCircle(ok.length ? ok : HOSTS); if (ok.length < ids.length) setTimeout(() => toast(t('toast.missing', '<b>{k} name(s) in this link aren’t in the garden</b> (renamed or removed) — showing the rest.', { k: ids.length - ok.length })), 600); }
  else if (day) setCircle(dayCircle(+day));
  else setCircle(HOSTS);                            // the bubble opens with the hosts on the floor + open seats for anyone
  if (hash && BY[hash]) { if (!circle.includes(hash)) setCircle([...circle, hash]); select(hash, false); }
  else if (hash === 'rider' || hash === 'naga') { setMode(hash, { quiet: true }); if (hash === 'rider') mountRider(); }
}
function share() {
  const p = new URLSearchParams();
  if (circle.length >= ORDER.length) p.set('who', 'everyone'); else if (circle.length && !isDefaultCircle()) p.set('who', circle.join(','));
  if (getLang() !== 'en') p.set('lang', getLang());
  const u = location.origin + location.pathname + (p.toString() ? '?' + p.toString().replace(/%2C/g, ',') : '') + (mode !== 'circle' ? '#' + mode : '');
  const title = t('share.title', 'The Full Circle · in the 4Seas bubble');
  if (navigator.share) navigator.share({ title, text: t('share.text', 'A circle on the floor, under the palms of Chiang Mai. {n} in the bubble.', { n: circle.length }), url: u }).catch(() => copy(u));
  else copy(u);
}
function copy(u, msg) { navigator.clipboard?.writeText(u).then(() => toast(`<b>${esc(msg || t('toast.copied', 'link copied'))}</b> — ${esc(t('toast.copied.tail', 'this bubble, exactly as it is: {n} in it.', { n: circle.length }))}`)).catch(() => toast(esc(u))); }

/* ── input ──────────────────────────────────────────────────────────────── */
function pickables() {
  const list = [...figures.values()].filter(f => f.g.visible && (mode !== 'rider')).map(f => f.card);
  if (rider?.pickables) for (const o of rider.pickables) list.push(o);
  return list;
}
function pickAt(cx, cy) {
  raycaster.setFromCamera({ x: (cx / innerWidth) * 2 - 1, y: -(cy / innerHeight) * 2 + 1 }, camera);
  const hits = raycaster.intersectObjects(pickables(), true);
  return hits.length ? hits[0] : null;
}
function bindPointer() {
  const el = renderer.domElement;
  const pts = new Map();
  el.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, [e.clientX, e.clientY]); ptr.down = true; ptr.x = e.clientX; ptr.y = e.clientY; ptr.moved = 0; orbit.auto = false; orbit.targetYaw = null; orbit.lastTouch = clock.elapsedTime; el.setPointerCapture?.(e.pointerId);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; ptr.pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
  el.addEventListener('pointermove', (e) => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, [e.clientX, e.clientY]);
    const lim = mode === 'rider' ? [1.6, 8] : mode === 'naga' ? [3, 22] : [3.5, 16];
    if (ptr.down && pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (ptr.pinch) { orbit.rTarget = orbit.r = THREE.MathUtils.clamp(orbit.r * (ptr.pinch / d), lim[0], lim[1]); } ptr.pinch = d; ptr.moved += 10; return; }
    if (ptr.down) { const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y; ptr.moved += Math.abs(dx) + Math.abs(dy); orbit.yaw -= dx * 0.0052; orbit.h = THREE.MathUtils.clamp(orbit.h + dy * 0.012, mode === 'rider' ? 0.9 : 0.8, mode === 'naga' ? 12 : 8); orbit.hTarget = null; ptr.x = e.clientX; ptr.y = e.clientY; }
    else if (!IS_TOUCH) { const h = pickAt(e.clientX, e.clientY); setHover(h); }
  });
  const up = (e) => {
    pts.delete(e.pointerId);
    if (ptr.down && ptr.moved < 9) {
      const h = pickAt(e.clientX, e.clientY);
      const o = h?.object;
      const r = h && rider?.resolve ? rider.resolve(h) : null;
      if (r) {
        play(r.id, r.part);
        if (mode !== 'rider') { setMode('rider', { quiet: true }); mountRider(); if (!SMALL()) openPanel('rider'); toast(t('toast.rider', '<b>The Rider Sanctuary.</b> The 4Seas corner — tap an instrument: every one plays.')); }
      } else if (o?.userData?.slug) select(o.userData.slug);
      else if (!o && !SMALL() && mode === 'circle') select(null);
    }
    if (!pts.size) { ptr.down = false; ptr.pinch = 0; }
  };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => { e.preventDefault(); const lim = mode === 'rider' ? [1.6, 8] : mode === 'naga' ? [3, 22] : [3.5, 16]; orbit.rTarget = orbit.r = THREE.MathUtils.clamp(orbit.r * (1 + Math.sign(e.deltaY) * 0.08), lim[0], lim[1]); orbit.lastTouch = clock.elapsedTime; }, { passive: false });
}
function setHover(h) { const o = h?.object || null; if (hoverObj === o) return; hoverObj = o; renderer.domElement.classList.toggle('hand', !!o); }
function onResize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); updateViewOffset(); }
function lerpAngle(a, b, k) { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * k; }

/* ── every frame ────────────────────────────────────────────────────────── */
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05), tt = clock.elapsedTime;
  const beat = 0.5 + 0.5 * Math.sin(tt * Math.PI * 2 * (72 / 60));
  // honesty check: step the quality down if the room stutters
  qAccum += dt; qFrames++;
  if (qAccum >= 2.5 && qStep < 2) { const fps = qFrames / qAccum; if (fps < 24) { qStep++; renderer.setPixelRatio(qStep === 1 ? 1 : 0.75); renderer.setSize(innerWidth, innerHeight); if (qStep === 2) motes.visible = false; } else if (qFrames > 60) qStep = 3; qAccum = 0; qFrames = 0; }
  else if (qAccum >= 2.5) { qAccum = 0; qFrames = 0; }

  // camera
  orbit.center.lerp(orbit.centerTarget, Math.min(1, dt * 2.0));
  if (!ptr.down && !orbit.auto && tt - orbit.lastTouch > 9) orbit.auto = true;
  if (orbit.targetYaw !== null) { const before = orbit.yaw; orbit.yaw = lerpAngle(orbit.yaw, orbit.targetYaw, Math.min(1, dt * 2.6)); if (Math.abs(orbit.yaw - before) < 0.0004) orbit.targetYaw = null; }
  else if (orbit.auto) {
    if (mode === 'circle') orbit.yaw += dt * (CALM ? 0.025 : 0.055);
    else orbit.yaw = lerpAngle(orbit.yaw, orbit.swayBase + Math.sin(tt * (CALM ? 0.05 : 0.11)) * (mode === 'rider' ? 0.42 : 0.22), Math.min(1, dt * 0.6));
  }
  if (orbit.rTarget) orbit.r += (orbit.rTarget - orbit.r) * Math.min(1, dt * 1.6);
  if (orbit.hTarget && !ptr.down) orbit.h += (orbit.hTarget - orbit.h) * Math.min(1, dt * 1.2);
  player.position.set(orbit.center.x + Math.sin(orbit.yaw) * orbit.r, orbit.h, orbit.center.z + Math.cos(orbit.yaw) * orbit.r);
  camera.position.set(0, 0, 0);
  camera.lookAt(orbit.center.x, orbit.center.y + (mode === 'circle' ? (orbit.h - 3.4) * 0.12 : 0), orbit.center.z);

  // the circle steps back while you look at the gear
  circleFade += ((mode === 'rider' ? 0.14 : 1) - circleFade) * Math.min(1, dt * 3);

  figures.forEach((f) => {
    if (!f.g.visible) return;
    const g = f.g;
    g.position.lerp(f.target, Math.min(1, dt * 2.4));
    const since = tt - f.arrive, grow = since < 0 ? 0 : Math.min(1, since / 0.9), e = 1 - Math.pow(1 - grow, 3);
    const sc = (f.scaleTarget || 1) * e; g.scale.setScalar(Math.max(0.001, sc));
    g.position.y = (1 - e) * -0.6;
    const ph = f.ph + tt * 1.1;
    f.card.position.y = (f.a.seated ? 0.98 : 1.5) + Math.sin(ph) * 0.035 + (f.sel ? 0.1 : 0);
    const hov = hoverObj === f.card;
    f.card.scale.set(1.0 + Math.sin(ph) * 0.012 + (hov || f.sel ? 0.1 : 0), 1.3 + Math.sin(ph) * 0.016 + (hov || f.sel ? 0.13 : 0), 1);
    f.card.material.opacity = circleFade;
    f.au.material.opacity = (0.22 + beat * 0.22 + (f.sel ? 0.2 : 0)) * circleFade;
    f.disc.material.opacity = (0.14 + beat * 0.16) * circleFade;
  });
  updateThreads(dt, beat);
  const mood = everyone ? 1 : 0.6;
  const A = ledRing.userData.a;
  for (let i = 0; i < A.length; i++) {
    const a = A[i]; const v = 0.55 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(tt * 2.2 - a * 3), 2) * mood + beat * 0.25;
    ledCol.setHSL((0.48 + Math.sin(tt * 0.15 + a) * 0.12 + 1) % 1, 0.85, Math.min(0.75, 0.32 * v));
    ledRing.setColorAt(i, ledCol);
  }
  ledRing.instanceColor.needsUpdate = true;
  ledLights.forEach((l) => { const a = tt * 0.25 + l.userData.i * Math.PI / 2; l.position.set(Math.cos(a) * 6.0, 3.4, Math.sin(a) * 6.0); l.intensity = 1.0 + beat * 0.8 * mood; });
  centreRing.material.emissiveIntensity = 0.6 + beat * 1.2; centreRing.rotation.z += dt * 0.3;
  if (motes.visible) motes.rotation.y += dt * 0.01;
  const bs = tt - bloomAt; if (bs >= 0 && bs < 3.2) { const u = bs / 3.2; pulseRing.scale.setScalar(1 + u * 5.5); pulseRing.material.opacity = (1 - u) * 0.9; } else pulseRing.material.opacity = 0;

  camera.getWorldPosition(camPos);
  if (world) world.update(tt, dt, beat, camPos);
  if (rider) rider.update(tt, dt, beat);
  renderer.render(scene, camera);
}

boot().catch((e) => { console.error(e); $('#enter-label').textContent = 'something broke — ' + e.message; window.__circleFallback && window.__circleFallback('The 3D bubble hit an error on this device, so here is everyone as a simple list.'); });

export { t, setLang, applyI18n };
