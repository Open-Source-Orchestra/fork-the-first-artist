/* ── OPEN SOURCE ORCHESTRA · THE FULL CIRCLE ────────────────────────────────
   The virtual sanctuary (Devcon 8 Music Space, Ø 6 m circle on the floor)
   with every artist of the garden in it. Add anyone. Add everyone.
   three.js r169 vendored locally · no CDN, no trackers · CC0.
   ------------------------------------------------------------------------- */
import * as THREE from './vendor/three.module.min.js';
import { initFinder } from './finder.js';
// import { initEF } from './ef.js?v=20261029e';
import { mergeEdits, applyLocal } from './overlay.js';

const C = { night: 0x0b0612, gold: 0xf0c464, goldBright: 0xffd97a, teal: 0x2dd4bf, rose: 0xe86a92, coral: 0xff8a5c, violet: 0xb48cff, rug: 0x6b2340, rug2: 0x8c3a24 };
const R_CIRCLE = 3.0;                 // Ø 6 m, per the rider — the rugs, not a riser
const WALL_R = 15.5, WALL_H = 7.2, WALL_N = 8;
const IS_TOUCH = matchMedia('(pointer:coarse)').matches;
const SMALL = innerWidth < 760;
const DEVCON = 'https://app.devcon.org';

const $ = (s) => document.querySelector(s);
let renderer, scene, camera, player, clock, raycaster;
let ARTISTS = [], BY = {}, ORDER = [], HISTORY = [];
const figures = new Map();            // slug → figure
let circle = [];                      // ordered slugs currently in the circle
let selected = null, yearFilter = 0, everyone = false;
const walls = [];
const texCache = new Map();           // history url → texture
const loader = new THREE.TextureLoader();
let ledRing = [], dust, threads, sparks, haloSprite, centreRing, pulseRing;
const orbit = { yaw: 0.0, h: 3.4, r: 9.6, targetYaw: null, auto: true, lastTouch: 0 };
const ptr = { down: false, x: 0, y: 0, moved: 0, pinch: 0 };
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
let hoverFig = null, bloomAt = -99, frontWall = -1, captionTimer = 0;
let qAccum = 0, qFrames = 0, qStep = 0;

/* ── boot ───────────────────────────────────────────────────────────────── */
async function boot() {
  const [a, h, edits] = await Promise.all([
    fetch('./data/artists.json').then(r => r.json()),
    fetch('./history/manifest.json').then(r => r.ok ? r.json() : { photos: [] }).catch(() => ({ photos: [] })),
    fetch('./data/edits.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null),   // 🗝️ the artists' own words (garden keys) — absent = no-op
  ]);
  ARTISTS = a.artists; ARTISTS.forEach(x => (BY[x.slug] = x));
  try { mergeEdits(BY, edits); applyLocal(BY, edits); } catch (e) { console.warn('garden edits skipped', e); }
  HISTORY = (h.photos || []).map(p => ({ ...p, url: './history/' + p.file }));
  // the full-circle order: the hosts, then every set in time order, then the garden, then the ones away this year
  const dayKey = (x) => (x.day || 9) * 10000 + t2m(x.time);
  ORDER = [
    ...ARTISTS.filter(x => x.kind === 'host').map(x => x.slug),
    ...ARTISTS.filter(x => x.kind === 'placed').sort((p, q) => dayKey(p) - dayKey(q)).map(x => x.slug),
    ...ARTISTS.filter(x => x.kind === 'garden').map(x => x.slug),
    ...ARTISTS.filter(x => x.kind === 'away').map(x => x.slug),
  ];
  $('#howmuch').max = ORDER.length;
  $('#howmuch-out').textContent = `0 / ${ORDER.length}`;
  buildScene();
  buildList();
  bindHud();
  initFinder({ ARTISTS, BY, ORDER, hueOf, initials, esc, refreshArtist, getCircle: () => circle, pick: (s) => { if (!circle.includes(s)) setCircle([...circle, s]); select(s); } });
  // 2026-10-31 (Shaka): EF Presents retired
  // initEF({ ARTISTS, BY, esc, pick: (s2) => { if (!circle.includes(s2)) setCircle([...circle, s2]); select(s2); } });
  applyUrl();
  tonightRibbon();
  $('#enter-label').textContent = 'Enter the circle'; window.__circleReady = true;
  $('#enter').addEventListener('click', () => { $('#loading').classList.add('gone'); orbit.auto = true; });
  renderer.setAnimationLoop(tick);
}
function t2m(t) { if (!t) return 0; const m = /(\d+):(\d+)([ap])/.exec(t); if (!m) return 0; let h = +m[1] % 12; if (m[3] === 'p') h += 12; return h * 60 + +m[2]; }

/* ── scene ──────────────────────────────────────────────────────────────── */
function buildScene() {
  clock = new THREE.Clock(); raycaster = new THREE.Raycaster();
  scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.fog = new THREE.FogExp2(0x160c24, 0.011);
  renderer = new THREE.WebGLRenderer({ antialias: !IS_TOUCH, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.5 : 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  $('#stage').appendChild(renderer.domElement);
  camera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.08, 120);
  player = new THREE.Group(); player.position.set(0, 0, 4.8); player.add(camera); scene.add(player);

  // light: warm house wash + the circle's own glow (sprites are unlit; this is for floor, rugs, cushions)
  scene.add(new THREE.HemisphereLight(0x8c6aa0, 0x241a2e, 0.95));
  scene.add(new THREE.AmbientLight(0xffd9a8, 0.3));
  const centre = new THREE.PointLight(C.gold, 3.2, 26, 2); centre.position.set(0, 3.6, 0); scene.add(centre);
  [[C.rose, 0], [C.teal, 1], [C.coral, 2], [C.violet, 3]].forEach(([col, i]) => {
    const l = new THREE.PointLight(col, 1.4, 20, 2); l.userData.i = i; l.position.set(0, 3.2, 0); scene.add(l); ledRing.lights = ledRing.lights || []; ledRing.lights.push(l);
  });

  // floor
  const floor = new THREE.Mesh(new THREE.CircleGeometry(WALL_R + 1, 64), new THREE.MeshStandardMaterial({ color: 0x1a1226, roughness: 0.92, metalness: 0.05, map: gridTexture() }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  // rugs — the circle is defined by rugs, not a riser (rider §1)
  const rug = new THREE.Mesh(new THREE.CircleGeometry(R_CIRCLE + 0.35, 72), new THREE.MeshStandardMaterial({ color: C.rug, roughness: 1 }));
  rug.rotation.x = -Math.PI / 2; rug.position.y = 0.014; scene.add(rug);
  const inner = new THREE.Mesh(new THREE.RingGeometry(R_CIRCLE - 1.5, R_CIRCLE - 0.2, 72), new THREE.MeshStandardMaterial({ color: C.rug2, roughness: 1 }));
  inner.rotation.x = -Math.PI / 2; inner.position.y = 0.018; scene.add(inner);
  // the low LED ring — the only thing that marks the edge
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.07), new THREE.MeshStandardMaterial({ color: C.teal, emissive: C.teal, emissiveIntensity: 1.4, roughness: 0.4 }));
    seg.position.set(Math.cos(a) * (R_CIRCLE + 0.5), 0.035, Math.sin(a) * (R_CIRCLE + 0.5)); seg.rotation.y = -a; scene.add(seg); ledRing.push({ m: seg, a });
  }
  // centre: no conductor stands here
  centreRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.012, 8, 48), new THREE.MeshStandardMaterial({ color: C.gold, emissive: C.gold, emissiveIntensity: 0.9 }));
  centreRing.rotation.x = Math.PI / 2; centreRing.position.y = 0.02; scene.add(centreRing);
  pulseRing = new THREE.Mesh(new THREE.RingGeometry(0.96, 1.0, 96), new THREE.MeshBasicMaterial({ color: C.violet, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  pulseRing.rotation.x = -Math.PI / 2; pulseRing.position.y = 0.03; scene.add(pulseRing);
  // Ξ — the mark of the house, inlaid and hovering
  const xi = xiTexture();
  const inlay = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: xi, transparent: true, opacity: 0.16, depthWrite: false }));
  inlay.rotation.x = -Math.PI / 2; inlay.position.y = 0.022; scene.add(inlay);
  haloSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: xi, transparent: true, opacity: 0.2, depthWrite: false }));
  haloSprite.scale.set(2.2, 2.2, 1); haloSprite.position.set(0, 4.4, 0); scene.add(haloSprite);

  buildWalls();
  buildDust();
  buildThreads();
  buildRadioTile();

  bindPointer();
  addEventListener('resize', onResize);
}

function skyTexture() {
  const cv = document.createElement('canvas'); cv.width = 16; cv.height = 256; const x = cv.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#120a1f'); g.addColorStop(0.45, '#2c1640'); g.addColorStop(0.72, '#6a3050'); g.addColorStop(0.88, '#c46a42'); g.addColorStop(1, '#f0b06a');
  x.fillStyle = g; x.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(cv); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
function gridTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const x = cv.getContext('2d');
  x.fillStyle = '#1a1226'; x.fillRect(0, 0, 256, 256); x.strokeStyle = 'rgba(240,196,100,.07)'; x.lineWidth = 1;
  for (let i = 0; i <= 256; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.moveTo(0, i); x.lineTo(256, i); x.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(18, 18); return t;
}
function xiTexture() {
  // Ξ drawn by hand (three bars) — no font fallback surprises
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const x = cv.getContext('2d');
  x.fillStyle = '#ffd97a';
  [[48, 52, 160, 26], [66, 115, 124, 24], [48, 178, 160, 26]].forEach(([a, b, w, h]) => { roundRect(x, a, b, w, h, 8); x.fill(); });
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* ── the living slideshow: photo walls around the room ──────────────────── */
function buildWalls() {
  const n = IS_TOUCH ? 6 : WALL_N;
  const w = (2 * Math.PI * WALL_R) / n * 0.985;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    const g = new THREE.Group();
    g.position.set(Math.sin(a) * WALL_R, WALL_H / 2 + 0.4, Math.cos(a) * WALL_R);
    g.lookAt(0, WALL_H / 2 + 0.4, 0);
    const layers = [];
    for (let k = 0; k < 2; k++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, WALL_H), new THREE.MeshBasicMaterial({ color: 0xc9bdd8, transparent: true, opacity: k ? 0 : 0.0, depthWrite: false, fog: true }));
      m.position.z = k * 0.02; g.add(m); layers.push(m);
    }
    // a thin gold frame line on the floor side so the wall reads as a wall
    const sill = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: C.gold, emissive: C.gold, emissiveIntensity: 0.5 }));
    sill.position.y = -WALL_H / 2; g.add(sill);
    scene.add(g);
    walls.push({ g, a, layers, cur: -1, next: null, fade: 0, timer: 2 + i * 1.7, aspect: w / WALL_H, photo: null, photoNext: null });
  }
}
function pool() {
  const p = yearFilter ? HISTORY.filter(h => h.year === yearFilter) : HISTORY;
  return p.length ? p : HISTORY;
}
function loadTex(url) {
  if (texCache.has(url)) return Promise.resolve(texCache.get(url));
  return new Promise((res) => loader.load(url, (t) => {
    t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 2;
    texCache.set(url, t);
    if (texCache.size > 14) { const [k, v] = texCache.entries().next().value; if (!walls.some(w => (w.photo && w.photo.url === k) || (w.photoNext && w.photoNext.url === k))) { texCache.delete(k); v.dispose(); } }
    res(t);
  }, undefined, () => res(null)));
}
function fit(mat, tex, aspect) {
  const t = tex.clone(); t.needsUpdate = true;
  const ia = (tex.image.width || 1) / (tex.image.height || 1);
  if (ia > aspect) { const f = aspect / ia; t.repeat.set(f, 1); t.offset.set((1 - f) / 2, 0); }
  else { const f = ia / aspect; t.repeat.set(1, f); t.offset.set(0, (1 - f) / 2); }
  mat.map = t; mat.needsUpdate = true;
}
let busy = 0;
function wallStep(w, dt) {
  if (!HISTORY.length) return;
  if (w.fade > 0) {                                  // crossfading next (layer 1) over cur (layer 0)
    w.fade = Math.min(1, w.fade + dt / 1.8);
    const e = w.fade < 0.5 ? 2 * w.fade * w.fade : 1 - Math.pow(-2 * w.fade + 2, 2) / 2;
    w.layers[1].material.opacity = e * 0.92;
    if (w.fade >= 1) {                               // promote
      const [a, b] = w.layers; a.material.map = b.material.map; a.material.opacity = 0.92; a.material.needsUpdate = true; b.material.opacity = 0;
      w.photo = w.photoNext; w.photoNext = null; w.fade = 0; w.timer = 6.5 + Math.random() * 4;
      if (frontWall === walls.indexOf(w)) showCaption(w.photo);
    }
    return;
  }
  w.timer -= dt;
  if (w.timer > 0 || busy > 2) return;
  const p = pool(); if (!p.length) return;
  let pick = p[Math.floor(Math.random() * p.length)];
  if (p.length > 2 && walls.some(o => o.photo === pick || o.photoNext === pick)) pick = p[(p.indexOf(pick) + 1) % p.length];
  w.timer = 99; busy++;
  loadTex(pick.url).then((tex) => {
    busy--; if (!tex) { w.timer = 2; return; }
    w.photoNext = pick; fit(w.layers[1].material, tex, w.aspect); w.fade = 0.0001;
  });
}
function showCaption(p) {
  if (!p) return;
  $('#caption').innerHTML = `<b>${p.year}</b> · ${esc(p.event)}${p.caption ? ' · ' + esc(p.caption) : ''}`;
}

/* ── figures: one billboard card per artist ─────────────────────────────── */
function hueOf(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }
function initials(a) { return a.name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '♪'; }
function roundRect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
function wrap(x, text, maxW, size) { x.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`; const words = text.split(' '); const lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur); return lines.slice(0, 2); }

function cardTexture(a, img, sel) {
  const W = 400, H = 520, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d');
  x.fillStyle = sel ? 'rgba(20,34,40,.9)' : 'rgba(11,6,18,.86)'; roundRect(x, 6, 6, W - 12, H - 12, 34); x.fill();
  x.strokeStyle = sel ? 'rgba(45,212,191,.95)' : a.kind === 'host' ? 'rgba(255,217,122,.85)' : a.kind === 'placed' ? 'rgba(240,196,100,.6)' : a.kind === 'away' ? 'rgba(232,106,146,.5)' : 'rgba(180,140,255,.55)';
  x.lineWidth = sel ? 6 : 3; x.stroke();
  // portrait
  const cx = W / 2, cy = 150, r = 112;
  x.save(); x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.closePath(); x.clip();
  if (img) x.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  else { const h = hueOf(a.slug); const g = x.createLinearGradient(cx - r, cy - r, cx + r, cy + r); g.addColorStop(0, `hsl(${h} 52% 42%)`); g.addColorStop(1, `hsl(${h + 55} 58% 28%)`); x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
    x.fillStyle = 'rgba(255,255,255,.95)'; x.font = '800 86px ui-sans-serif, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(initials(a), cx, cy + 4); }
  x.restore();
  x.beginPath(); x.arc(cx, cy, r + 3, 0, Math.PI * 2); x.strokeStyle = 'rgba(255,255,255,.25)'; x.lineWidth = 3; x.stroke();
  // glyph badge
  x.font = '44px ui-sans-serif, system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = 'rgba(11,6,18,.9)'; x.beginPath(); x.arc(cx + 84, cy + 84, 36, 0, Math.PI * 2); x.fill(); x.fillText((a.glyph || '🎶').slice(0, 2), cx + 84, cy + 88);
  // name
  x.fillStyle = '#ffd97a'; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  const nm = a.name.replace(/\s*—.*$/, '');
  let lines = wrap(x, nm, W - 50, 34); if (lines.length > 1) lines = wrap(x, nm, W - 50, 30);
  lines.forEach((l, i) => x.fillText(l, cx, 318 + i * 36));
  // role / tagline
  x.fillStyle = 'rgba(247,236,217,.74)'; x.font = '300 21px ui-sans-serif, system-ui, sans-serif';
  const role = (a.role || a.tagline || '').split(' · ')[0];
  x.fillText(role.length > 34 ? role.slice(0, 33) + '…' : role, cx, 318 + lines.length * 36 + 4);
  // set
  x.fillStyle = '#2dd4bf'; x.font = '600 22px ui-sans-serif, system-ui, sans-serif';
  const set = a.kind === 'placed' ? (a.set || '').replace(/ · \d+ min$/, '') : a.kind === 'host' ? 'every day · Nov 3–6' : a.kind === 'away' ? 'in the garden this year' : 'OSO Open · the garden';
  x.fillText(set.toUpperCase(), cx, H - 40);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function auraTexture(col) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d');
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 64); g.addColorStop(0, col + 'cc'); g.addColorStop(0.5, col + '44'); g.addColorStop(1, col + '00'); x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}
const AURA = {};
function aura(kind) { const col = kind === 'host' ? '#ffd97a' : kind === 'away' ? '#e86a92' : kind === 'garden' ? '#b48cff' : '#2dd4bf'; return AURA[col] || (AURA[col] = auraTexture(col)); }

function makeFigure(a) {
  const g = new THREE.Group(); g.visible = false;
  const card = new THREE.Sprite(new THREE.SpriteMaterial({ map: cardTexture(a, null, false), transparent: true, depthWrite: false }));
  card.scale.set(1.0, 1.3, 1); card.position.y = a.seated ? 0.98 : 1.5; card.renderOrder = 5; card.userData.slug = a.slug; g.add(card);
  const au = new THREE.Sprite(new THREE.SpriteMaterial({ map: aura(a.kind), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  au.scale.set(1.9, a.seated ? 1.7 : 2.6, 1); au.position.y = a.seated ? 0.75 : 1.25; au.renderOrder = 2; g.add(au);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.4, 32), new THREE.MeshBasicMaterial({ color: a.kind === 'host' ? C.gold : C.violet, transparent: true, opacity: 0.22, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.026; g.add(disc);
  if (a.seated) {                                      // floor-seating cushion: the classical side sits down
    const cu = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 10), new THREE.MeshStandardMaterial({ color: hueOf(a.slug) % 2 ? 0xb3405a : 0xd98c3a, roughness: 1 }));
    cu.scale.y = 0.4; cu.position.y = 0.13; g.add(cu);
  }
  scene.add(g);
  const f = { a, g, card, au, disc, target: new THREE.Vector3(), ph: Math.random() * 6.28, arrive: 0, img: null, sel: false };
  if (a.photo) { const im = new Image(); im.onload = () => { f.img = im; refreshCard(f); }; im.src = a.photo; }
  return f;
}
function refreshCard(f) { const old = f.card.material.map; f.card.material.map = cardTexture(f.a, f.img, f.sel); f.card.material.needsUpdate = true; old && old.dispose(); }

/* radio tile — the circle is a station (Alaska × Subcult · patio.fm) */
let radioTile;
function buildRadioTile() {
  const W = 400, H = 300, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d');
  x.fillStyle = 'rgba(14,8,26,.9)'; roundRect(x, 6, 6, W - 12, H - 12, 30); x.fill(); x.strokeStyle = 'rgba(180,140,255,.8)'; x.lineWidth = 3; x.stroke();
  x.textAlign = 'center'; x.fillStyle = '#e6d9ff'; x.font = '64px ui-sans-serif, system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; x.fillText('📻', W / 2, 92);
  x.font = '600 30px ui-sans-serif, system-ui, sans-serif'; x.fillStyle = '#ffd97a'; x.fillText('the circle is a station', W / 2, 150);
  x.font = '300 21px ui-sans-serif, system-ui, sans-serif'; x.fillStyle = 'rgba(247,236,217,.74)'; x.fillText('Alaska × Subcult · mdrn.music', W / 2, 190); x.fillText('Ethereum is the radio · patio.fm', W / 2, 220);
  x.font = '600 19px ui-sans-serif, system-ui, sans-serif'; x.fillStyle = '#2dd4bf'; x.fillText('TAP TO LISTEN · NO WALLET NEEDED', W / 2, 262);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  radioTile = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  radioTile.scale.set(1.15, 0.8625, 1); radioTile.position.set(Math.sin(0.42) * 4.7, 1.0, Math.cos(0.42) * 4.7); radioTile.userData.radio = true; radioTile.renderOrder = 5; scene.add(radioTile);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.6, 8), new THREE.MeshStandardMaterial({ color: 0x3a2a55, emissive: C.violet, emissiveIntensity: 0.3 }));
  pole.position.set(radioTile.position.x, 0.3, radioTile.position.z); scene.add(pole);
}

/* ── layout: hosts in the middle, everyone else in rings on the floor ───── */
function layout() {
  const n = circle.length, t = clock.elapsedTime;
  const hosts = circle.filter(s => BY[s].kind === 'host'), rest = circle.filter(s => BY[s].kind !== 'host');
  // hosts near the centre, never at it (no conductor stands there)
  hosts.forEach((s, i) => { const a = (i / Math.max(hosts.length, 1)) * Math.PI * 2 + Math.PI; const r = hosts.length === 1 ? 0.9 : 1.05; placeFig(s, Math.sin(a) * r, Math.cos(a) * r, t); });
  // rings, sized to the crowd; the circle grows past the rugs when everyone comes — it is all floor, there is no front
  const rings = rest.length <= 9 ? [[2.3, 99]] : rest.length <= 22 ? [[1.85, 9], [3.0, 99]] : [[1.75, 8], [2.8, 14], [3.9, 99]];
  let i = 0;
  rings.forEach(([r, cap], ri) => {
    const grp = rest.slice(i, i + cap); i += cap;
    grp.forEach((s, k) => { const a = (k / grp.length) * Math.PI * 2 + ri * 0.21 + 0.1; placeFig(s, Math.sin(a) * r, Math.cos(a) * r, t); });
  });
  const sc = n > 28 ? 0.86 : n > 16 ? 0.94 : 1;
  figures.forEach(f => { f.scaleTarget = sc; });
  orbit.rTarget = n > 28 ? 12.2 : n > 16 ? 10.4 : n > 6 ? 9.4 : 8.4; orbit.hTarget = n > 28 ? 5.2 : n > 16 ? 4.2 : 3.4;
  $('#count-n').textContent = n;
  $('#howmuch').value = n;
  $('#howmuch-out').textContent = `${n} / ${ORDER.length}`;
  $('#btn-everyone').classList.toggle('playing', n >= ORDER.length);
  $('#btn-everyone').textContent = n >= ORDER.length ? '🎻 everyone is playing together' : 'Everyone plays together 🎻';
  document.querySelectorAll('#days [data-day]').forEach(b => b.classList.toggle('on', sameSet(dayCircle(+b.dataset.day), circle)));
  document.querySelectorAll('#list .row').forEach(r => r.classList.toggle('in', circle.includes(r.dataset.slug)));
  document.querySelectorAll('#list .row .st').forEach(e => { e.textContent = circle.includes(e.parentElement.dataset.slug) ? '✓' : '+'; });
  rebuildThreads();
  updateDevconLinks();
  writeUrl();
}
function placeFig(s, x, z, t) {
  let f = figures.get(s); if (!f) { f = makeFigure(BY[s]); figures.set(s, f); }
  f.target.set(x, 0, z);
  if (!f.g.visible) { f.g.visible = true; f.g.position.set(x * 0.2, 0, z * 0.2); f.arrive = t + (everyone ? Math.random() * 1.6 : 0); f.g.scale.setScalar(0.001); }
}
function circleIsPrefix() { return circle.every((s, i) => ORDER[i] === s); }
function sameSet(a, b) { return a.length === b.length && a.every(s => b.includes(s)); }
function dayCircle(d) {
  const hosts = ARTISTS.filter(x => x.kind === 'host').map(x => x.slug);
  if (d === 6) return [...hosts, ...ORDER.filter(s => BY[s].kind === 'placed')];   // the long goodbye: every voice that showed up this week, one more time
  return [...hosts, ...ORDER.filter(s => BY[s].kind === 'placed' && (BY[s].day === d || BY[s].slug === '0xmentalist'))];
}
function setCircle(list, opts = {}) {
  everyone = !!opts.everyone;
  const next = [...new Set(list)].filter(s => BY[s]);
  figures.forEach((f, s) => { if (!next.includes(s)) { f.g.visible = false; } });
  circle = next; layout();
  if (everyone) { bloomAt = clock.elapsedTime; toast(`<b>${circle.length} voices, one circle.</b> Not a stage — a circle on the floor, and everyone is on it.`); }
}

/* ── threads of light between the players ───────────────────────────────── */
const MAXL = 70 * 4;
function buildThreads() {
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXL * 2 * 3), 3));
  threads = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: C.violet, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  threads.frustumCulled = false; scene.add(threads);
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXL * 2 * 3), 3));
  sparks = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xe6d9ff, size: 0.07, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  sparks.frustumCulled = false; sparks.userData.t = new Float32Array(MAXL * 2).map(() => Math.random()); scene.add(sparks);
  threads.userData.links = [];
}
function rebuildThreads() {
  const L = [];
  const list = circle.map(s => figures.get(s));
  const centre = { target: new THREE.Vector3(0, 0, 0), y: 0.5 };
  list.forEach((f, i) => {
    L.push([f, list[(i + 1) % list.length]]);                       // neighbour
    if (list.length > 5) L.push([f, list[(i + Math.floor(list.length / 3)) % list.length]]);   // a chord across the circle
    if (list.length < 6 || i % 2 === 0) L.push([f, centre]);        // to the centre — no conductor, just the middle of the floor
  });
  threads.userData.links = L.slice(0, MAXL);
  threads.geometry.setDrawRange(0, threads.userData.links.length * 2);
  sparks.geometry.setDrawRange(0, threads.userData.links.length * 2);
}
function updateThreads(dt, beat) {
  const L = threads.userData.links; const P = threads.geometry.attributes.position.array; const S = sparks.geometry.attributes.position.array; const T = sparks.userData.t;
  const hy = (f) => f.y !== undefined ? f.y : (f.a.seated ? 0.95 : 1.45);
  L.forEach(([a, b], i) => {
    const pa = a.g ? a.g.position : a.target, pb = b.g ? b.g.position : b.target;
    const ya = hy(a), yb = hy(b);
    P[i * 6] = pa.x; P[i * 6 + 1] = ya; P[i * 6 + 2] = pa.z; P[i * 6 + 3] = pb.x; P[i * 6 + 4] = yb; P[i * 6 + 5] = pb.z;
    for (let k = 0; k < 2; k++) { const j = i * 2 + k; T[j] = (T[j] + dt * (0.18 + k * 0.11)) % 1; const u = T[j];
      S[j * 3] = pa.x + (pb.x - pa.x) * u; S[j * 3 + 1] = ya + (yb - ya) * u + Math.sin(u * Math.PI) * 0.25; S[j * 3 + 2] = pa.z + (pb.z - pa.z) * u; }
  });
  threads.geometry.attributes.position.needsUpdate = true; sparks.geometry.attributes.position.needsUpdate = true;
  threads.material.opacity = 0.18 + beat * 0.3; sparks.material.size = 0.06 + beat * 0.05;
}
function buildDust() {
  const n = IS_TOUCH ? 220 : 420, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { p[i * 3] = (Math.random() - 0.5) * 22; p[i * 3 + 1] = Math.random() * 6 + 0.2; p[i * 3 + 2] = (Math.random() - 0.5) * 22; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  dust = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffd9a0, size: 0.035, transparent: true, opacity: 0.5, depthWrite: false })); scene.add(dust);
}

/* ── the HUD ────────────────────────────────────────────────────────────── */
function buildList() {
  const groups = [['host', '🎼 always in the circle'], ['placed', '🗓 with a set time'], ['garden', '🌱 the garden · OSO Open'], ['away', '🌺 in the garden this year, on the floor next time']];
  const el = $('#list'); el.innerHTML = '';
  groups.forEach(([k, title]) => {
    const items = ORDER.filter(s => BY[s].kind === k); if (!items.length) return;
    const h = document.createElement('div'); h.className = 'grp'; h.textContent = title; el.appendChild(h);
    items.forEach(s => { const a = BY[s]; const b = document.createElement('button'); b.className = 'row'; b.dataset.slug = s; b.dataset.q = (a.name + ' ' + (a.role || '') + ' ' + (a.tagline || '') + ' ' + (a.set || '') + ' ' + (a.day ? 'nov ' + a.day : '')).toLowerCase();
      b.innerHTML = (a.photo ? `<img class="av" src="${a.photo}" alt="" loading="lazy">` : `<div class="av mono" style="background:linear-gradient(140deg,hsl(${hueOf(s)} 52% 42%),hsl(${hueOf(s) + 55} 58% 28%))">${initials(a)}</div>`) +
        `<div class="nm">${esc(a.name)}<small>${esc(a.kind === 'placed' ? (a.set || '') : (a.role || a.tagline || '').split(' · ').slice(0, 2).join(' · '))}</small></div><span class="st">+</span>`;
      b.addEventListener('click', () => { if (circle.includes(s)) { setCircle(circle.filter(x => x !== s)); if (selected === s) select(null); } else { setCircle([...circle, s]); select(s); } });
      el.appendChild(b); });
  });
  $('#search').addEventListener('input', (e) => { const q = e.target.value.trim().toLowerCase(); document.querySelectorAll('#list .row').forEach(r => { r.style.display = !q || r.dataset.q.includes(q) ? '' : 'none'; }); });
}
function bindHud() {
  document.querySelectorAll('#days [data-day]').forEach(b => b.addEventListener('click', () => { const d = +b.dataset.day; setCircle(dayCircle(d)); toast(d === 6 ? '<b>Nov 6 · the long goodbye.</b> Every voice that showed up this week, one more time.' : `<b>Nov ${d}.</b> ${circle.length - ARTISTS.filter(x => x.kind === 'host').length} sets, the hosts, and the floor.`); }));
  $('#btn-add').addEventListener('click', () => openPanel('picker'));
  $('#btn-radio').addEventListener('click', () => openPanel('radio'));
  $('#btn-clear').addEventListener('click', () => { setCircle([]); select(null); });
  $('#howmuch').addEventListener('input', (e) => { const k = +e.target.value; setCircle(ORDER.slice(0, k), { everyone: k >= ORDER.length }); });
  $('#btn-everyone').addEventListener('click', () => { setCircle(ORDER, { everyone: true }); });
  $('#btn-share').addEventListener('click', share);
  $('#btn-help').addEventListener('click', () => $('#help').classList.add('open'));
  $('#help-close').addEventListener('click', () => $('#help').classList.remove('open'));
  $('#help').addEventListener('click', (e) => { if (e.target.id === 'help') $('#help').classList.remove('open'); });
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $('#' + b.dataset.close).classList.remove('open')));
  document.querySelectorAll('[data-select]').forEach(b => b.addEventListener('click', (e) => { e.preventDefault(); const s = b.dataset.select; if (!circle.includes(s)) setCircle([...circle, s]); select(s); }));
  document.querySelectorAll('#timeline .yr').forEach(b => b.addEventListener('click', () => { yearFilter = +b.dataset.year; document.querySelectorAll('#timeline .yr').forEach(x => x.classList.toggle('on', x === b)); walls.forEach((w, i) => { w.timer = Math.min(w.timer, 0.3 + i * 0.5); }); }));
  addEventListener('hashchange', () => { const s = location.hash.slice(1); if (s && BY[s]) { if (!circle.includes(s)) setCircle([...circle, s]); select(s); } });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { select(null); document.querySelectorAll('.panel.open').forEach(p => p.classList.remove('open')); $('#help').classList.remove('open'); } });
}
function openPanel(id) { document.querySelectorAll('.panel.open').forEach(p => { if (p.id !== id) p.classList.remove('open'); }); $('#' + id).classList.add('open'); if (id === 'picker') setTimeout(() => !IS_TOUCH && $('#search').focus(), 300); }
function esc(s) { return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
let toastT;
function toast(html) { const t = $('#toast'); t.innerHTML = html; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 4200); }
function tonightRibbon() { const ist = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); $('#tonight').classList.toggle('on', ist === '2026-10-27'); }

function refreshArtist(s) {            // an artist just changed their own words → repaint their card (+ the open detail panel without closing others)
  const f = figures.get(s); if (f) refreshCard(f);
  if (selected === s) select(s, true);
}
function select(s, quiet = false) {
  if (selected && figures.get(selected)) { const f = figures.get(selected); f.sel = false; refreshCard(f); }
  selected = s;
  if (!s) { $('#detail').classList.remove('open'); writeUrl(); return; }
  const f = figures.get(s); if (f) { f.sel = true; refreshCard(f); if (!quiet) { orbit.targetYaw = Math.atan2(f.target.x, f.target.z); orbit.auto = false; orbit.lastTouch = clock.elapsedTime; } }
  const a = BY[s];
  $('#detail-title').textContent = a.name;
  const links = [];
  if (a.profile) links.push(`<a class="pill" href="${a.profile}" target="_blank" rel="noopener">🖼 profile</a>`);
  if (a.rider) links.push(`<a class="pill" href="${a.rider}" target="_blank" rel="noopener">🎚 rider</a>`);
  if (a.code) links.push(`<a class="pill teal" href="${DEVCON}/schedule/${a.code}" target="_blank" rel="noopener">📱 in the Devcon app</a>`);
  else if (a.kind === 'placed') links.push(`<span class="pill" style="opacity:.6">📱 Devcon app · session being added</span>`);
  (a.links || []).forEach(l => links.push(`<a class="pill violet" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`));
  if (s === 'alaska-x-subcult') links.push(`<button class="pill violet" data-open="radio">📻 the circle is a station</button>`);
  $('#detail-body').innerHTML = `
    <div class="hero">${a.photo ? `<img src="${a.photo}" alt="">` : `<div class="mono" style="background:linear-gradient(140deg,hsl(${hueOf(s)} 52% 42%),hsl(${hueOf(s) + 55} 58% 28%))">${initials(a)}</div>`}
      <div><h3>${esc(a.name)}</h3><div class="role">${esc(a.glyph || '')} ${esc(a.role || (a.tagline || '').split(' · ')[0])}</div></div></div>
    <div class="set">${a.kind === 'placed' ? '🗓 ' + esc(a.set) + (s === 'alaska-x-subcult' ? ' · live coding' : '') : a.kind === 'host' ? '🎼 ' + esc(a.set) : a.kind === 'away' ? '🌺 in the garden this year, on the floor next time' : '🌱 OSO Open · the garden — no set time yet, a place in the circle always'}</div>
    ${a.headline ? `<div class="head">${esc(a.headline)}</div>` : ''}
    ${a.tagline ? `<div class="tag">${esc(a.tagline)}</div>` : ''}
    ${a.bio ? `<div class="bio">${esc(a.bio)}</div>` : ''}
    <div class="links">${links.join('')}</div>
    <div class="links" style="margin-top:10px"><button class="pill rose" id="detail-remove">− take out of the circle</button><button class="pill" id="detail-share">🔗 link to this artist</button></div>
  `;
  $('#detail-remove').addEventListener('click', () => { setCircle(circle.filter(x => x !== s)); select(null); });
  $('#detail-share').addEventListener('click', () => { const u = location.origin + location.pathname + '?who=' + circle.join(',') + '#' + s; copy(u, 'link to ' + a.name + ' copied'); });
  document.querySelectorAll('#detail [data-open]').forEach(b => b.addEventListener('click', () => openPanel(b.dataset.open)));
  document.dispatchEvent(new CustomEvent('fork:artist', { detail: { slug: s, artist: a } }));   // 🍴 Fork the First Artist layer (fork.js)
  if (!quiet) openPanel('detail'); writeUrl();
}
function updateDevconLinks() {
  const codes = [...new Set(circle.flatMap(s => BY[s].codes || []))];
  const url = codes.length ? `${DEVCON}/my-interests?add=${codes.join(',')}` : `${DEVCON}/ai/devcon8/search?room=Music%20stage`;
  $('#btn-devcon').href = url; $('#radio-devcon').href = url;
  $('#btn-devcon').textContent = codes.length ? `📱 star this circle in the Devcon app (${codes.length})` : '📱 open the Devcon app';
}
function writeUrl() {
  const q = circle.length ? '?who=' + circle.join(',') : location.pathname;
  const u = (circle.length ? location.pathname + q : location.pathname) + (selected ? '#' + selected : '');
  if (u !== location.pathname + location.search + location.hash) history.replaceState(null, '', u);
}
function applyUrl() {
  const p = new URLSearchParams(location.search);
  const who = p.get('who'); const day = p.get('day'); const hash = location.hash.slice(1);
  if (who === 'everyone' || who === 'all') setCircle(ORDER, { everyone: true });
  else if (who) { const ids = who.split(',').map(s => s.trim()).filter(Boolean), ok = ids.filter(s => BY[s]); setCircle(ok.length ? ok : dayCircle(3)); if (ok.length < ids.length) setTimeout(() => toast(`<b>${ids.length - ok.length} name${ids.length - ok.length > 1 ? 's' : ''} in this link ${ids.length - ok.length > 1 ? 'aren’t' : 'isn’t'} in the garden</b> (renamed or removed) — showing the rest.`), 600); }
  else if (day) setCircle(dayCircle(+day));
  else setCircle(dayCircle(3));                         // the opening day, so the floor is never empty on arrival
  if (hash && BY[hash]) { if (!circle.includes(hash)) setCircle([...circle, hash]); select(hash); }
  else if (hash && hash !== 'fork' && hash.length < 60 && /^[a-z0-9-]+$/.test(hash)) setTimeout(() => toast('<b>That artist isn’t in the garden</b> — here’s the circle. Try 🌸 find an artist.'), 900);
}
function share() {
  const u = location.origin + location.pathname + (circle.length >= ORDER.length ? '?who=everyone' : circle.length ? '?who=' + circle.join(',') : '');
  if (navigator.share) navigator.share({ title: 'The Full Circle — Devcon 8 Music Space', text: 'Not a stage. A circle on the floor. ' + circle.length + ' in the circle.', url: u }).catch(() => copy(u));
  else copy(u);
}
function copy(u, msg) { navigator.clipboard?.writeText(u).then(() => toast(`<b>${msg || 'link copied'}</b> — this circle, exactly as it is: ${circle.length} in it.`)).catch(() => toast(u)); }

/* ── input ──────────────────────────────────────────────────────────────── */
function bindPointer() {
  const el = renderer.domElement;
  const pick = (cx, cy) => { raycaster.setFromCamera({ x: (cx / innerWidth) * 2 - 1, y: -(cy / innerHeight) * 2 + 1 }, camera);
    const cards = [...figures.values()].filter(f => f.g.visible).map(f => f.card); cards.push(radioTile);
    const hits = raycaster.intersectObjects(cards, false); return hits.length ? hits[0].object : null; };
  const pts = new Map();
  el.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, [e.clientX, e.clientY]); ptr.down = true; ptr.x = e.clientX; ptr.y = e.clientY; ptr.moved = 0; orbit.auto = false; orbit.targetYaw = null; orbit.lastTouch = clock.elapsedTime; el.setPointerCapture?.(e.pointerId);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; ptr.pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
  el.addEventListener('pointermove', (e) => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptr.down && pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (ptr.pinch) { orbit.rTarget = orbit.r = THREE.MathUtils.clamp(orbit.r * (ptr.pinch / d), 3.5, 16); } ptr.pinch = d; ptr.moved += 10; return; }
    if (ptr.down) { const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y; ptr.moved += Math.abs(dx) + Math.abs(dy); orbit.yaw -= dx * 0.0052; orbit.h = THREE.MathUtils.clamp(orbit.h + dy * 0.012, 0.8, 8); orbit.hTarget = null; ptr.x = e.clientX; ptr.y = e.clientY; }
    else if (!IS_TOUCH) { const o = pick(e.clientX, e.clientY); setHover(o); }
  });
  const up = (e) => { pts.delete(e.pointerId); if (ptr.down && ptr.moved < 9) { const o = pick(e.clientX, e.clientY); if (o && o.userData.radio) openPanel('radio'); else if (o && o.userData.slug) select(o.userData.slug); else if (!o && !SMALL) select(null); } if (!pts.size) { ptr.down = false; ptr.pinch = 0; } };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => { e.preventDefault(); orbit.rTarget = orbit.r = THREE.MathUtils.clamp(orbit.r * (1 + Math.sign(e.deltaY) * 0.08), 3.5, 16); orbit.lastTouch = clock.elapsedTime; }, { passive: false });
}
function setHover(o) { const f = o && o.userData.slug ? figures.get(o.userData.slug) : null; if (hoverFig === f && !(o && o.userData.radio)) return; hoverFig = f; renderer.domElement.classList.toggle('hand', !!o); }
function onXRSelect(c) { tmp.set(0, 0, 0); c.getWorldPosition(tmp); tmp2.set(0, 0, -1).applyQuaternion(c.getWorldQuaternion(new THREE.Quaternion())); raycaster.set(tmp, tmp2);
  const cards = [...figures.values()].filter(f => f.g.visible).map(f => f.card); const hits = raycaster.intersectObjects(cards, false); if (hits.length) select(hits[0].object.userData.slug); }
function onResize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); }

/* ── every frame ────────────────────────────────────────────────────────── */
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  const beat = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * (72 / 60));      // 72 bpm, a resting heart
  // honesty check: step the quality down if the room stutters
  qAccum += dt; qFrames++;
  if (qAccum >= 2.5 && qStep < 2) { const fps = qFrames / qAccum; if (fps < 24) { qStep++; renderer.setPixelRatio(qStep === 1 ? 1 : 0.75); renderer.setSize(innerWidth, innerHeight); if (qStep === 2) dust.visible = false; } else if (qFrames > 60) qStep = 3; qAccum = 0; qFrames = 0; }
  else if (qAccum >= 2.5) { qAccum = 0; qFrames = 0; }

  // camera: a slow walk around the circle unless someone is holding it
  if (!renderer.xr.isPresenting) {
    if (!ptr.down && !orbit.auto && t - orbit.lastTouch > 9) orbit.auto = true;
    if (orbit.targetYaw !== null) { let d = ((orbit.targetYaw - orbit.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; orbit.yaw += d * Math.min(1, dt * 3); if (Math.abs(d) < 0.01) orbit.targetYaw = null; }
    else if (orbit.auto) orbit.yaw += dt * 0.055;
    if (orbit.rTarget) orbit.r += (orbit.rTarget - orbit.r) * Math.min(1, dt * 1.6);
    if (orbit.hTarget && !ptr.down) orbit.h += (orbit.hTarget - orbit.h) * Math.min(1, dt * 1.2);
    player.position.set(Math.sin(orbit.yaw) * orbit.r, orbit.h, Math.cos(orbit.yaw) * orbit.r);
    camera.position.set(0, 0, 0); camera.lookAt(0, 0.9 + (orbit.h - 3.4) * 0.12, 0);
  } else { player.position.set(0, 0, 4.6); camera.position.set(0, 0, 0); }

  // figures: arrive, breathe, sway
  figures.forEach((f) => {
    if (!f.g.visible) return;
    const g = f.g;
    g.position.lerp(f.target, Math.min(1, dt * 2.4));
    const since = t - f.arrive, grow = since < 0 ? 0 : Math.min(1, since / 0.9), e = 1 - Math.pow(1 - grow, 3);
    const sc = (f.scaleTarget || 1) * e; g.scale.setScalar(Math.max(0.001, sc));
    g.position.y = (1 - e) * -0.6;
    const ph = f.ph + t * 1.1;
    f.card.position.y = (f.a.seated ? 0.98 : 1.5) + Math.sin(ph) * 0.035 + (f.sel ? 0.1 : 0);
    f.card.scale.set(1.0 + Math.sin(ph) * 0.012 + (f === hoverFig || f.sel ? 0.1 : 0), 1.3 + Math.sin(ph) * 0.016 + (f === hoverFig || f.sel ? 0.13 : 0), 1);
    f.au.material.opacity = 0.22 + beat * 0.22 + (f.sel ? 0.2 : 0);
    f.disc.material.opacity = 0.14 + beat * 0.16;
  });
  // the web
  updateThreads(dt, beat);
  // the room breathes
  const mood = everyone ? 1 : 0.6;
  ledRing.forEach(({ m, a }, i) => { const v = 0.6 + 0.9 * Math.pow(0.5 + 0.5 * Math.sin(t * 2.2 - a * 3), 2) * mood; m.material.emissiveIntensity = v + beat * 0.5; m.material.emissive.setHSL((0.48 + Math.sin(t * 0.15 + a) * 0.12 + 1) % 1, 0.8, 0.55); });
  ledRing.lights?.forEach((l) => { const a = t * 0.25 + l.userData.i * Math.PI / 2; l.position.set(Math.cos(a) * 6.5, 3.4, Math.sin(a) * 6.5); l.intensity = 1.1 + beat * 0.9 * mood; });
  centreRing.material.emissiveIntensity = 0.6 + beat * 1.2; centreRing.rotation.z += dt * 0.3;
  haloSprite.material.opacity = 0.14 + beat * 0.14; haloSprite.position.y = 4.4 + Math.sin(t * 0.6) * 0.15; 
  if (dust && dust.visible) { dust.rotation.y += dt * 0.012; }
  // bloom when everyone arrives
  const bs = t - bloomAt; if (bs >= 0 && bs < 3.2) { const u = bs / 3.2; pulseRing.scale.setScalar(1 + u * 5.5); pulseRing.material.opacity = (1 - u) * 0.9; } else pulseRing.material.opacity = 0;
  // the walls: crossfade, and tell the caption which wall is in front of us
  walls.forEach(w => wallStep(w, dt));
  captionTimer -= dt;
  if (captionTimer <= 0 && walls.length) {
    captionTimer = 0.6; camera.getWorldDirection(tmp); const want = Math.atan2(tmp.x, tmp.z);
    let best = -1, bd = 99; walls.forEach((w, i) => { let d = Math.abs(((w.a - want + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI); if (d < bd) { bd = d; best = i; } });
    if (best !== frontWall) { frontWall = best; showCaption(walls[best].photo); }
  }
  renderer.render(scene, camera);
}

boot().catch((e) => { console.error(e); $('#enter-label').textContent = 'something broke — ' + e.message; window.__circleFallback && window.__circleFallback('The 3D circle hit an error on this device, so here is every artist as a simple list.'); });
