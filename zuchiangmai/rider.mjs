/* SPDX-License-Identifier: GPL-3.0-or-later — made by the AI ʻohana for the Open Source Orchestra
   (Fork the First Artist · Zu Chiang Mai bubble).
   ── THE RIDER SANCTUARY ─────────────────────────────────────────────────────────────
   The real 4Seas music corner, modelled from life: a magenta shag rug under a violet
   wash, potted areca palms, Lanna tung flags on a stand, a pale paper lantern, a small
   mixer with tiny LEDs — and the gear:
   🎹 the house digital stage piano · 🥁 the house electric drum kit ·
   🎸 the Kala U·BASS (mahogany, f-holes, polyurethane strings, Hawaiian floral strap) ·
   🎶 the Kala ukulele (pale flame figure, cutaway, nylon strings, side preamp) —
   the two Kala gifts that travelled the whole road. Every instrument is playable:
   bubble.mjs raycasts pickables → audio.mjs voices, and hit() animates the mesh.
   Everything procedural — no images, no network. three.js r169 (vendored, passed in). */
'use strict';

let THREE;

/* ── small utils ─────────────────────────────────────────────────────────── */
function canvasTex(w, h, draw, { srgb = true } = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function mergeGeoms(list) { // [{geo, matrix}] → one BufferGeometry
  let vc = 0, ic = 0;
  list.forEach(({ geo }) => { vc += geo.attributes.position.count; ic += geo.index ? geo.index.count : geo.attributes.position.count; });
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), idx = new Uint32Array(ic);
  let vo = 0, io = 0;
  const nm = new THREE.Matrix3(), v = new THREE.Vector3();
  list.forEach(({ geo, matrix }) => {
    const p = geo.attributes.position, n = geo.attributes.normal, u = geo.attributes.uv;
    nm.getNormalMatrix(matrix);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix); pos.set([v.x, v.y, v.z], (vo + i) * 3);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], (vo + i) * 3);
      if (u) uv.set([u.getX(i), u.getY(i)], (vo + i) * 2);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) idx[io + i] = geo.index.getX(i) + vo;
    else for (let i = 0; i < p.count; i++) idx[io + i] = vo + i;
    vo += p.count; io += geo.index ? geo.index.count : p.count;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const M4 = () => new THREE.Matrix4();
const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const R = (ax, ang) => (ax === 'x' ? new THREE.Matrix4().makeRotationX(ang) : ax === 'y' ? new THREE.Matrix4().makeRotationY(ang) : new THREE.Matrix4().makeRotationZ(ang));
const mul = (...ms) => ms.reduce((a, b) => a.clone().multiply(b), M4());

/* ══════════════════════════════ THE BUILD ═══════════════════════════════ */
export function buildRider(THREE_, scene, opts = {}) {
  THREE = THREE_;
  const at = opts.at || new THREE.Vector3(0, 0, -5.6);
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };
  const group = new THREE.Group();
  group.position.copy(at);
  scene.add(group);
  const pickables = [];
  const pulses = [];               // {mesh, t0, kind, base} — one-frame-key / pad / string animations

  /* ── materials ── */
  const blackMat = track(new THREE.MeshStandardMaterial({ color: 0x141417, roughness: 0.55, metalness: 0.25 }));
  const darkMetal = track(new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.4, metalness: 0.8 }));
  const rubberMat = track(new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.9 }));
  const meshHeadMat = track(new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.95 }));
  const whiteKeyMat = track(new THREE.MeshStandardMaterial({ color: 0xf2eee4, roughness: 0.4 }));
  const blackKeyMat = track(new THREE.MeshStandardMaterial({ color: 0x121216, roughness: 0.35 }));
  const cymbalMat = track(new THREE.MeshStandardMaterial({ color: 0x232328, roughness: 0.5, metalness: 0.6 }));
  const mahogTex = track(canvasTex(128, 128, (x) => {
    x.fillStyle = '#5e3319'; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 44; i++) {
      x.strokeStyle = `rgba(${90 + Math.random() * 40 | 0},${50 + Math.random() * 22 | 0},${24 + Math.random() * 12 | 0},${0.25 + Math.random() * 0.3})`;
      x.lineWidth = 1 + Math.random() * 2;
      x.beginPath(); x.moveTo(Math.random() * 128, 0);
      x.bezierCurveTo(Math.random() * 128, 42, Math.random() * 128, 86, Math.random() * 128, 128); x.stroke();
    }
  }));
  mahogTex.wrapS = mahogTex.wrapT = THREE.RepeatWrapping;
  const mahogMat = track(new THREE.MeshStandardMaterial({ map: mahogTex, roughness: 0.42, metalness: 0.08 }));
  const paleTex = track(canvasTex(128, 128, (x) => {
    x.fillStyle = '#cfa76a'; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 30; i++) {                    // the flame figure: soft wavy bands
      const y = i * 4.4 + Math.random() * 2;
      const g = x.createLinearGradient(0, y, 128, y + 3);
      g.addColorStop(0, 'rgba(255,230,170,.16)'); g.addColorStop(0.5, 'rgba(120,80,30,.20)'); g.addColorStop(1, 'rgba(255,230,170,.16)');
      x.fillStyle = g;
      x.beginPath(); x.moveTo(0, y);
      for (let px = 0; px <= 128; px += 16) x.lineTo(px, y + Math.sin(px * 0.22 + i) * 2.2);
      x.lineTo(128, y + 4); x.lineTo(0, y + 4); x.closePath(); x.fill();
    }
  }));
  paleTex.wrapS = paleTex.wrapT = THREE.RepeatWrapping;
  const paleMat = track(new THREE.MeshStandardMaterial({ map: paleTex, roughness: 0.38, metalness: 0.05 }));
  const strapTex = track(canvasTex(128, 32, (x) => {
    x.fillStyle = '#1d1420'; x.fillRect(0, 0, 128, 32);
    for (let i = 0; i < 5; i++) {                     // simple hibiscus: 5 petals + a heart
      const cx = 12 + i * 26, cy = 16;
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2 + i;
        x.fillStyle = p % 2 ? '#d93a4a' : '#f05548';
        x.beginPath(); x.ellipse(cx + Math.cos(a) * 6.4, cy + Math.sin(a) * 6.4, 5, 3.2, a, 0, 7); x.fill();
      }
      x.fillStyle = '#ffd94a'; x.beginPath(); x.arc(cx, cy, 2.6, 0, 7); x.fill();
      x.strokeStyle = '#ffd94a'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + 7, cy - 7); x.stroke();
      x.fillStyle = '#ffd94a'; x.beginPath(); x.arc(cx + 7.5, cy - 7.5, 1.4, 0, 7); x.fill();
    }
  }));
  strapTex.wrapS = THREE.RepeatWrapping; strapTex.repeat.set(3, 1);
  const strapMat = track(new THREE.MeshStandardMaterial({ map: strapTex, roughness: 0.85 }));
  const stringMat = track(new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.5, metalness: 0.3 }));
  const nylonMat = track(new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.6 }));

  /* ── the magenta shag rug ── */
  const shagTex = track(canvasTex(512, 512, (x) => {
    x.fillStyle = '#a1275e'; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 5200; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * 256;
      const px = 256 + Math.cos(a) * rr, py = 256 + Math.sin(a) * rr;
      x.strokeStyle = `rgba(${190 + Math.random() * 60 | 0},${40 + Math.random() * 40 | 0},${110 + Math.random() * 50 | 0},${0.25 + Math.random() * 0.4})`;
      x.lineWidth = 1 + Math.random() * 1.6;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + (Math.random() - 0.5) * 7, py + (Math.random() - 0.5) * 7); x.stroke();
    }
    // a quiet lotus ring woven into the shag
    x.strokeStyle = 'rgba(255,217,122,.5)'; x.lineWidth = 3;
    x.beginPath(); x.arc(256, 256, 196, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = 'rgba(45,212,191,.4)';
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      x.beginPath(); x.ellipse(256 + Math.cos(a) * 168, 256 + Math.sin(a) * 168, 9, 4.5, a, 0, 7); x.stroke();
    }
  }));
  const rug = new THREE.Mesh(track(new THREE.CircleGeometry(2.35, 48)), track(new THREE.MeshStandardMaterial({ map: shagTex, roughness: 1 })));
  rug.rotation.x = -Math.PI / 2; rug.position.y = 0.012; group.add(rug);

  /* ── the piano (slim black stage piano, 88 keys, on a stand) ── */
  const piano = new THREE.Group();
  piano.position.set(-1.35, 0, -0.42); piano.rotation.y = 0.5; piano.userData.rider = 'piano';
  group.add(piano); pickables.push(piano);
  const keyH = 0.78;
  {
    const body = new THREE.Mesh(track(box(1.34, 0.10, 0.34)), blackMat); body.position.y = keyH; piano.add(body);
    const back = new THREE.Mesh(track(box(1.34, 0.05, 0.05)), blackMat); back.position.set(0, keyH + 0.06, -0.155); piano.add(back);
    // Z stand
    const legs = [];
    [-0.5, 0.5].forEach(sx => {
      legs.push({ geo: track(box(0.05, keyH - 0.05, 0.05)), matrix: T(sx, (keyH - 0.05) / 2, 0.02) });
      legs.push({ geo: track(box(0.05, 0.05, 0.5)), matrix: T(sx, 0.025, 0.02) });
    });
    piano.add(new THREE.Mesh(track(mergeGeoms(legs)), darkMetal));
    const bench = new THREE.Mesh(track(box(0.62, 0.07, 0.26)), blackMat); bench.position.set(0, 0.42, 0.62); piano.add(bench);
    const blegs = [];
    [-0.25, 0.25].forEach(sx => [-0.08, 0.08].forEach(sz => blegs.push({ geo: track(box(0.04, 0.4, 0.04)), matrix: T(sx, 0.2, 0.62 + sz) })));
    piano.add(new THREE.Mesh(track(mergeGeoms(blegs)), darkMetal));
  }
  // 88 keys: A0 (21) … C8 (108)
  const WHITE_STEPS = [0, 2, 4, 5, 7, 9, 11];
  const keyWGeo = track(box(0.0235, 0.008, 0.30));
  const keyBGeo = track(box(0.013, 0.012, 0.19));
  const whiteIdx = {}, blackIdx = {};
  let wCount = 0, bCount = 0;
  for (let m = 21; m <= 108; m++) {
    const n = m % 12;
    if (WHITE_STEPS.includes(n)) whiteIdx[m] = wCount++; else blackIdx[m] = bCount++;
  }
  const keysW = new THREE.InstancedMesh(keyWGeo, whiteKeyMat, wCount);
  const keysB = new THREE.InstancedMesh(keyBGeo, blackKeyMat, bCount);
  keysW.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  keysB.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const KW = 1.30 / wCount;
  const whiteBase = [], blackBase = [];
  for (let m = 21; m <= 108; m++) {
    if (whiteIdx[m] !== undefined) {
      const x = -0.65 + KW / 2 + whiteIdx[m] * KW;
      whiteBase[m] = { x, y: keyH + 0.052, z: 0.045 };
    } else {
      const wi = whiteIdx[m - 1] !== undefined ? whiteIdx[m - 1] : whiteIdx[m + 1] - 1;
      const x = -0.65 + KW / 2 + wi * KW + KW / 2;
      blackBase[m] = { x, y: keyH + 0.062, z: -0.02 };
    }
  }
  const _m = M4();
  function layKeys() {
    for (let m = 21; m <= 108; m++) {
      if (whiteBase[m]) _m.makeTranslation(whiteBase[m].x, whiteBase[m].y - (keyDip[m] ? 0.006 : 0), whiteBase[m].z), keysW.setMatrixAt(whiteIdx[m], _m);
      else _m.makeTranslation(blackBase[m].x, blackBase[m].y - (keyDip[m] ? 0.007 : 0), blackBase[m].z), keysB.setMatrixAt(blackIdx[m], _m);
    }
    keysW.instanceMatrix.needsUpdate = true; keysB.instanceMatrix.needsUpdate = true;
  }
  const keyDip = {};
  layKeys();
  keysW.userData = { rider: 'piano', keys: 'white' };
  keysB.userData = { rider: 'piano', keys: 'black' };
  piano.add(keysW, keysB);
  pickables.push(keysW, keysB);
  // piano pick → midi from a key's x position
  function pianoHitFromPoint(localPoint) {
    const p = piano.worldToLocal(localPoint.clone());
    let best = 60, bd = 99;
    for (let m = 21; m <= 108; m++) {
      const b = whiteBase[m] || blackBase[m];
      const d = Math.abs(b.x - p.x);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  /* ── the electric drum kit ── */
  const ekit = new THREE.Group();
  ekit.position.set(1.32, 0, -0.55); ekit.rotation.y = -0.42; ekit.userData.rider = 'ekit';
  group.add(ekit); pickables.push(ekit);
  const pads = {};
  function pad(name, geo, mat, x, y, z, tilt = 0) {
    const m = mat.clone();                      // per-pad material, for the hit flash
    m.emissive = new THREE.Color(0x000000);
    const p = new THREE.Mesh(track(geo), m);
    p.position.set(x, y, z); p.rotation.x = tilt;
    p.userData = { rider: 'ekit', part: name };
    ekit.add(p); pads[name] = p; pickables.push(p);
    return p;
  }
  {
    const padGeo = track(new THREE.CylinderGeometry(0.155, 0.16, 0.075, 24));
    const padGeoS = track(new THREE.CylinderGeometry(0.115, 0.12, 0.07, 20));
    const cymGeo = track(new THREE.CylinderGeometry(0.165, 0.175, 0.018, 24));
    pad('snare', padGeo, meshHeadMat, -0.28, 0.62, 0.18, -0.18);
    pad('tom1', padGeoS, rubberMat, -0.13, 0.88, -0.10, -0.3);
    pad('tom2', padGeoS, rubberMat, 0.13, 0.88, -0.10, -0.3);
    pad('floor', padGeo, rubberMat, 0.42, 0.52, 0.16, -0.1);
    pad('hat', cymGeo, cymbalMat, -0.52, 0.78, 0.02, -0.12);
    pad('crash', cymGeo, cymbalMat, -0.34, 1.06, -0.18, -0.35);
    pad('ride', cymGeo, cymbalMat, 0.36, 1.02, -0.16, -0.3);
    pad('kick', track(new THREE.CylinderGeometry(0.19, 0.19, 0.07, 24)), rubberMat, 0.02, 0.26, 0.42, Math.PI / 2 - 0.22);
    // rack + stands + throne + module
    const stands = [];
    const post = (x, z, h) => stands.push({ geo: track(box(0.035, h, 0.035)), matrix: T(x, h / 2, z) });
    post(-0.52, 0.02, 0.78); post(-0.34, -0.18, 1.06); post(0.36, -0.16, 1.02); post(0.42, 0.16, 0.5); post(-0.28, 0.18, 0.6);
    stands.push({ geo: track(box(0.75, 0.04, 0.04)), matrix: T(0, 0.99, -0.17) });
    // kick pedal
    stands.push({ geo: track(box(0.09, 0.02, 0.24)), matrix: T(0.02, 0.012, 0.58) });
    ekit.add(new THREE.Mesh(track(mergeGeoms(stands)), darkMetal));
    const module = new THREE.Mesh(track(box(0.24, 0.10, 0.07)), blackMat);
    module.position.set(-0.52, 0.62, -0.12); module.rotation.y = 0.3; ekit.add(module);
    const screen = new THREE.Mesh(track(box(0.16, 0.05, 0.002)), track(new THREE.MeshStandardMaterial({ color: 0x0a2a22, emissive: 0x1de9b6, emissiveIntensity: 0.9 })));
    screen.position.set(-0.5, 0.65, -0.085); screen.rotation.y = 0.3; ekit.add(screen);
    const throne = new THREE.Mesh(track(new THREE.CylinderGeometry(0.16, 0.16, 0.07, 20)), blackMat);
    throne.position.set(0.05, 0.52, 0.78); ekit.add(throne);
    ekit.add(new THREE.Mesh(track(mergeGeoms([{ geo: track(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8)), matrix: T(0.05, 0.26, 0.78) }])), darkMetal));
  }

  /* ── stringed things share builders ── */
  function bodyShape(scale = 1, cutaway = false) {
    const s = new THREE.Shape();
    // a small-guitar outline: lower bout, waist, upper bout
    s.moveTo(0, -0.24 * scale);
    s.bezierCurveTo(0.13 * scale, -0.24 * scale, 0.155 * scale, -0.15 * scale, 0.115 * scale, -0.07 * scale);
    s.bezierCurveTo(0.095 * scale, -0.03 * scale, 0.095 * scale, 0.01 * scale, 0.10 * scale, 0.03 * scale);
    s.bezierCurveTo(0.115 * scale, 0.09 * scale, 0.10 * scale, 0.15 * scale, 0.055 * scale, 0.165 * scale);
    s.bezierCurveTo(0.02 * scale, 0.175 * scale, 0.0, 0.16 * scale, 0.0, 0.16 * scale);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.065 * scale, bevelEnabled: true, bevelThickness: 0.012 * scale, bevelSize: 0.012 * scale, bevelSegments: 2, curveSegments: 14 });
    g.translate(0, 0, -0.0325 * scale);
    return g;
  }
  function aframe(mat) { // a little A-stand
    const parts = [];
    parts.push({ geo: track(box(0.04, 0.4, 0.04)), matrix: mul(T(-0.13, 0.19, 0.06), R('x', -0.35), R('z', 0.3)) });
    parts.push({ geo: track(box(0.04, 0.4, 0.04)), matrix: mul(T(0.13, 0.19, 0.06), R('x', -0.35), R('z', -0.3)) });
    parts.push({ geo: track(box(0.04, 0.45, 0.04)), matrix: mul(T(0, 0.2, -0.09), R('x', 0.4)) });
    parts.push({ geo: track(box(0.2, 0.03, 0.03)), matrix: mul(T(0, 0.06, 0.13), R('x', -0.3)) });
    return new THREE.Mesh(track(mergeGeoms(parts)), mat);
  }

  /* ── 🎸 the Kala U·BASS (mahogany, f-holes, fat polyurethane strings, floral strap) ── */
  const ubass = new THREE.Group();
  ubass.position.set(-0.42, 0, 0.82); ubass.rotation.y = 0.3; ubass.userData.rider = 'ubass';
  group.add(ubass); pickables.push(ubass);
  let ubassStrings;
  {
    const holder = new THREE.Group(); holder.position.set(0, 0.52, 0.02); holder.rotation.x = -0.22; holder.rotation.z = 0.06; ubass.add(holder);
    const body = new THREE.Mesh(track(bodyShape(1.05)), mahogMat); holder.add(body);
    // f-holes: two slim S-curves drawn on the face
    const fholeTex = track(canvasTex(128, 128, (x) => {
      x.clearRect(0, 0, 128, 128);
      x.strokeStyle = 'rgba(10,6,4,.92)'; x.lineWidth = 5; x.lineCap = 'round';
      [[46, 0.12], [82, -0.12]].forEach(([cx, tilt]) => {
        x.save(); x.translate(cx, 62); x.rotate(tilt);
        x.beginPath(); x.moveTo(0, -18); x.bezierCurveTo(7, -8, -7, 8, 0, 18); x.stroke();
        x.beginPath(); x.arc(1.5, -19, 3.2, 0, 7); x.fillStyle = 'rgba(10,6,4,.92)'; x.fill();
        x.beginPath(); x.arc(-1.5, 19, 3.2, 0, 7); x.fill();
        x.restore();
      });
    }));
    const fholes = new THREE.Mesh(track(new THREE.PlaneGeometry(0.24, 0.24)), track(new THREE.MeshStandardMaterial({ map: fholeTex, transparent: true, roughness: 0.5 })));
    fholes.position.set(0, -0.03, 0.046); holder.add(fholes);
    // neck + fretboard + headstock
    const neck = new THREE.Mesh(track(box(0.045, 0.42, 0.03)), mahogMat); neck.position.set(0, 0.36, 0.012); holder.add(neck);
    const board = new THREE.Mesh(track(box(0.05, 0.42, 0.008)), blackMat); board.position.set(0, 0.36, 0.032); holder.add(board);
    const head = new THREE.Mesh(track(box(0.055, 0.12, 0.025)), mahogMat); head.position.set(0, 0.62, 0.012); holder.add(head);
    // 4 fat rubber strings
    const sg = [];
    [-0.015, -0.005, 0.005, 0.015].forEach(sx => {
      sg.push({ geo: track(new THREE.CylinderGeometry(0.0032, 0.0032, 0.62, 5)), matrix: mul(T(sx, 0.22, 0.042), R('x', 0)) });
    });
    ubassStrings = new THREE.Mesh(track(mergeGeoms(sg)), stringMat); holder.add(ubassStrings);
    // bridge + tuners
    const bridge = new THREE.Mesh(track(box(0.07, 0.02, 0.015)), blackMat); bridge.position.set(0, -0.09, 0.045); holder.add(bridge);
    const tuners = [];
    [[-0.045, 0.60], [0.045, 0.60], [-0.045, 0.66], [0.045, 0.66]].forEach(([tx2, ty]) => tuners.push({ geo: track(new THREE.CylinderGeometry(0.011, 0.011, 0.03, 8)), matrix: mul(T(tx2, ty, 0.012), R('z', Math.PI / 2)) }));
    holder.add(new THREE.Mesh(track(mergeGeoms(tuners)), darkMetal));
    // the Hawaiian floral strap, draped from headstock over the shoulder
    const strapCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.02, 0.62, 0), new THREE.Vector3(0.16, 0.4, -0.05), new THREE.Vector3(0.19, 0.12, -0.06), new THREE.Vector3(0.10, -0.16, -0.02),
    ]);
    const strap = new THREE.Mesh(track(new THREE.TubeGeometry(strapCurve, 12, 0.016, 5)), strapMat);
    holder.add(strap);
    ubass.add(aframe(darkMetal));
    // Kala mark on the headstock (proud, small)
    const kalaTex = track(canvasTex(64, 32, (x) => {
      x.clearRect(0, 0, 64, 32); x.fillStyle = 'rgba(255,217,122,.95)'; x.font = 'bold 18px Georgia, serif'; x.textAlign = 'center'; x.fillText('Kala', 32, 22);
    }));
    const mark = new THREE.Mesh(track(new THREE.PlaneGeometry(0.05, 0.025)), track(new THREE.MeshBasicMaterial({ map: kalaTex, transparent: true })));
    mark.position.set(0, 0.62, 0.026); holder.add(mark);
  }

  /* ── 🎶 the Kala ukulele (pale flame, cutaway, nylon, preamp) ── */
  const uke = new THREE.Group();
  uke.position.set(0.42, 0, 0.82); uke.rotation.y = -0.28; uke.userData.rider = 'uke';
  group.add(uke); pickables.push(uke);
  let ukeStrings;
  {
    const holder = new THREE.Group(); holder.position.set(0, 0.47, 0.02); holder.rotation.x = -0.2; holder.rotation.z = -0.05; uke.add(holder);
    const body = new THREE.Mesh(track(bodyShape(0.62)), paleMat); holder.add(body);
    // sound hole + rosette
    const holeTex = track(canvasTex(64, 64, (x) => {
      x.clearRect(0, 0, 64, 64);
      x.fillStyle = 'rgba(16,10,6,.95)'; x.beginPath(); x.arc(32, 32, 15, 0, 7); x.fill();
      x.strokeStyle = 'rgba(90,60,25,.9)'; x.lineWidth = 3; x.beginPath(); x.arc(32, 32, 19, 0, 7); x.stroke();
      x.strokeStyle = 'rgba(255,220,150,.55)'; x.lineWidth = 1.4; x.beginPath(); x.arc(32, 32, 22, 0, 7); x.stroke();
    }));
    const hole = new THREE.Mesh(track(new THREE.PlaneGeometry(0.11, 0.11)), track(new THREE.MeshStandardMaterial({ map: holeTex, transparent: true, roughness: 0.6 })));
    hole.position.set(0, 0.01, 0.03); holder.add(hole);
    const neck = new THREE.Mesh(track(box(0.03, 0.26, 0.02)), mahogMat); neck.position.set(0, 0.235, 0.008); holder.add(neck);
    const board = new THREE.Mesh(track(box(0.033, 0.26, 0.006)), blackMat); board.position.set(0, 0.235, 0.02); holder.add(board);
    const head = new THREE.Mesh(track(box(0.038, 0.085, 0.018)), mahogMat); head.position.set(0, 0.40, 0.008); holder.add(head);
    const sg = [];
    [-0.0105, -0.0035, 0.0035, 0.0105].forEach(sx => {
      sg.push({ geo: track(new THREE.CylinderGeometry(0.0016, 0.0016, 0.40, 4)), matrix: T(sx, 0.13, 0.028) });
    });
    ukeStrings = new THREE.Mesh(track(mergeGeoms(sg)), nylonMat); holder.add(ukeStrings);
    const bridge = new THREE.Mesh(track(box(0.05, 0.014, 0.01)), blackMat); bridge.position.set(0, -0.065, 0.03); holder.add(bridge);
    const tuners = [];
    [[-0.03, 0.38], [0.03, 0.38], [-0.03, 0.43], [0.03, 0.43]].forEach(([tx2, ty]) => tuners.push({ geo: track(new THREE.CylinderGeometry(0.008, 0.008, 0.022, 8)), matrix: mul(T(tx2, ty, 0.008), R('z', Math.PI / 2)) }));
    holder.add(new THREE.Mesh(track(mergeGeoms(tuners)), darkMetal));
    // the side preamp (the give-away that she plugs in)
    const preamp = new THREE.Mesh(track(box(0.05, 0.035, 0.012)), blackMat);
    preamp.position.set(0.085, 0.07, 0.015); preamp.rotation.z = -0.2; holder.add(preamp);
    const preLed = new THREE.Mesh(track(new THREE.SphereGeometry(0.004, 6, 5)), track(new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff3020, emissiveIntensity: 2 })));
    preLed.position.set(0.085, 0.075, 0.024); holder.add(preLed);
    const kalaTex = track(canvasTex(64, 32, (x) => {
      x.clearRect(0, 0, 64, 32); x.fillStyle = 'rgba(60,35,12,.95)'; x.font = 'bold 18px Georgia, serif'; x.textAlign = 'center'; x.fillText('Kala', 32, 22);
    }));
    const mark = new THREE.Mesh(track(new THREE.PlaneGeometry(0.034, 0.017)), track(new THREE.MeshBasicMaterial({ map: kalaTex, transparent: true })));
    mark.position.set(0, 0.40, 0.019); holder.add(mark);
    uke.add(aframe(darkMetal));
  }

  /* ── the little mixer everything plugs into ── */
  {
    const stand = new THREE.Mesh(track(mergeGeoms([
      { geo: track(box(0.3, 0.03, 0.24)), matrix: T(0, 0.42, 0) },
      { geo: track(box(0.04, 0.42, 0.04)), matrix: T(-0.12, 0.21, -0.09) },
      { geo: track(box(0.04, 0.42, 0.04)), matrix: T(0.12, 0.21, -0.09) },
      { geo: track(box(0.04, 0.42, 0.04)), matrix: T(-0.12, 0.21, 0.09) },
      { geo: track(box(0.04, 0.42, 0.04)), matrix: T(0.12, 0.21, 0.09) },
    ])), darkMetal);
    stand.position.set(0.02, 0, -0.28); group.add(stand);
    const mixer = new THREE.Mesh(track(box(0.34, 0.06, 0.26)), blackMat);
    mixer.position.set(0.02, 0.46, -0.28); mixer.rotation.x = -0.12; group.add(mixer);
    // tiny LEDs: 2 rows of channel lights
    const ledGeo = track(new THREE.SphereGeometry(0.005, 6, 5));
    const leds = new THREE.InstancedMesh(ledGeo, track(new THREE.MeshStandardMaterial({ color: 0x081008, emissive: 0x3dff70, emissiveIntensity: 1.6 })), 12);
    for (let i = 0; i < 12; i++) {
      _m.makeTranslation(-0.12 + (i % 6) * 0.045, 0.495, -0.36 + Math.floor(i / 6) * 0.05);
      leds.setMatrixAt(i, _m);
    }
    group.add(leds); group.userData.leds = leds;
    // knobs
    const knobGeo = track(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 8));
    const knobs = new THREE.InstancedMesh(knobGeo, darkMetal, 18);
    for (let i = 0; i < 18; i++) { _m.makeTranslation(-0.12 + (i % 6) * 0.045, 0.49, -0.26 + Math.floor(i / 6) * 0.04); knobs.setMatrixAt(i, _m); }
    group.add(knobs);
  }

  /* ── two potted areca palms ── */
  const arecaTex = track(canvasTex(128, 128, (x) => {
    x.clearRect(0, 0, 128, 128);
    x.strokeStyle = '#3f8a48'; x.lineWidth = 2;
    for (let i = 0; i < 22; i++) {
      const u = i / 22, bx = 8 + u * 116;
      x.strokeStyle = i % 2 ? '#4fae57' : '#2f7a42'; x.lineWidth = 2.4 - u;
      x.beginPath(); x.moveTo(bx, 64); x.quadraticCurveTo(bx + 3, 30, bx + 1, 4); x.stroke();
      x.beginPath(); x.moveTo(bx, 64); x.quadraticCurveTo(bx + 3, 98, bx + 1, 124); x.stroke();
    }
  }));
  const arecaGeo = (() => {
    const g = track(new THREE.PlaneGeometry(0.055, 0.7, 1, 6));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, Math.pow((y + 0.35) / 0.7, 2) * 0.30); } // arch back
    g.computeVertexNormals();
    return g;
  })();
  const arecaMat = track(new THREE.MeshStandardMaterial({ map: arecaTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.85, color: 0xd8ecc0, emissive: 0x16280f, emissiveIntensity: 0.5 }));
  const arecaGroups = [];
  [[-1.95, 0, 0.55, 0.5], [1.92, 0, 0.35, 0.42]].forEach(([px, , pz, ph]) => {
    const pot = new THREE.Group(); pot.position.set(px, 0, pz); group.add(pot);
    const potMesh = new THREE.Mesh(track(new THREE.CylinderGeometry(0.14, 0.10, 0.24, 12)), track(new THREE.MeshStandardMaterial({ color: 0x7a4a30, roughness: 0.9 })));
    potMesh.position.y = 0.12; pot.add(potMesh);
    const fronds = new THREE.Group(); fronds.position.y = 0.22; pot.add(fronds);
    for (let i = 0; i < 15; i++) {
      const f = new THREE.Mesh(arecaGeo, arecaMat);
      f.rotation.y = (i / 15) * Math.PI * 2 + ph;
      f.rotation.x = -0.5 - Math.random() * 0.5;
      f.position.y = 0.28 + Math.random() * 0.08;
      f.scale.setScalar(0.8 + Math.random() * 0.5);
      fronds.add(f);
    }
    arecaGroups.push({ fronds, ph });
  });

  /* ── tung flags on a stand + a pale paper lantern ── */
  const tungFlags = [];
  {
    const standM = new THREE.Mesh(track(mergeGeoms([
      { geo: track(new THREE.CylinderGeometry(0.02, 0.03, 1.7, 8)), matrix: T(0, 0.85, 0) },
      { geo: track(new THREE.CylinderGeometry(0.015, 0.015, 0.7, 8)), matrix: mul(T(0, 1.62, 0), R('z', Math.PI / 2)) },
    ])), darkMetal);
    standM.position.set(1.78, 0, -1.15); group.add(standM);
    const tungTex = (c1, c2, c3) => track(canvasTex(32, 128, (x) => {
      const bands = [c1, c2, c3, c2, c1, c3, c1, c2];
      bands.forEach((c, i) => { x.fillStyle = c; x.fillRect(0, i * 14, 32, 14); });
      x.fillStyle = 'rgba(255,217,122,.8)';
      for (let i = 0; i < 8; i++) { x.beginPath(); x.moveTo(16, i * 14 + 4); x.lineTo(21, i * 14 + 9); x.lineTo(16, i * 14 + 14); x.lineTo(11, i * 14 + 9); x.closePath(); x.fill(); }
    }));
    const cols = [['#e0408a', '#2dd4bf', '#f0c464'], ['#2dd4bf', '#f0c464', '#e0408a'], ['#f0c464', '#e0408a', '#2dd4bf']];
    [-0.22, 0, 0.22].forEach((dx, i) => {
      const flag = new THREE.Mesh(track(new THREE.PlaneGeometry(0.13, 0.85, 1, 8)), track(new THREE.MeshStandardMaterial({ map: tungTex(...cols[i]), side: THREE.DoubleSide, roughness: 0.9 })));
      // taper to the tung point
      const pp = flag.geometry.attributes.position;
      for (let v = 0; v < pp.count; v++) { const y = pp.getY(v); pp.setX(v, pp.getX(v) * (1 - Math.max(0, (-y + 0.42) / 0.9) * 0.75)); }
      flag.geometry.computeVertexNormals();
      flag.position.set(1.78 + dx, 1.16, -1.15);
      group.add(flag); tungFlags.push({ flag, ph: i * 2.1 });
    });
  }
  const lanternLight = track(new THREE.MeshStandardMaterial({ color: 0xf5ead0, emissive: 0xffe9b8, emissiveIntensity: 0.85, roughness: 0.9 }));
  const paperLantern = new THREE.Mesh(track(new THREE.SphereGeometry(0.15, 14, 12)), lanternLight);
  paperLantern.scale.set(1, 1.25, 1);
  paperLantern.position.set(-1.72, 1.15, -1.05); group.add(paperLantern);
  {
    const post = new THREE.Mesh(track(mergeGeoms([
      { geo: track(new THREE.CylinderGeometry(0.015, 0.022, 1.35, 8)), matrix: T(0, 0.67, 0) },
      { geo: track(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8)), matrix: mul(T(-0.13, 1.33, 0), R('z', Math.PI / 2)) },
    ])), darkMetal);
    post.position.set(-1.6, 0, -1.05); group.add(post);
    const glow = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: track(canvasTex(64, 64, (x) => {
      const g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,240,200,.5)'); g.addColorStop(1, 'rgba(255,240,200,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    })), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
    glow.scale.set(0.8, 0.8, 1); glow.position.copy(paperLantern.position); group.add(glow);
  }

  /* ── highlight ring (shared) ── */
  const hiRing = new THREE.Mesh(track(new THREE.RingGeometry(0.5, 0.58, 40)), track(new THREE.MeshBasicMaterial({ color: 0xff7eb6, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
  hiRing.rotation.x = -Math.PI / 2; hiRing.position.y = 0.02; group.add(hiRing);
  let hiTarget = 0;

  /* ── contract ── */
  const centers = { piano: new THREE.Vector3(), ekit: new THREE.Vector3(), ubass: new THREE.Vector3(), uke: new THREE.Vector3() };
  function resolve(hit) {
    let o = hit.object;
    while (o && !o.userData?.rider) o = o.parent;
    if (!o) return null;
    const id = o.userData.rider;
    if (id === 'piano') return { id, part: pianoHitFromPoint(hit.point) };
    if (id === 'ekit') return { id, part: o.userData.part || 'snare' };
    if (id === 'ubass') return { id, part: [36, 38, 41, 43][Math.floor(Math.random() * 4)] };
    if (id === 'uke') return { id, part: ['C', 'G', 'Am', 'F'][Math.floor(Math.random() * 4)] };
    return { id, part: null };
  }
  function hit(id, part, strength = 1) {
    const t0 = performance.now();
    if (id === 'piano' && typeof part === 'number') { keyDip[part] = true; layKeys(); pulses.push({ kind: 'key', midi: part, t0 }); }
    else if (id === 'ekit' && pads[part]) { pulses.push({ kind: 'pad', mesh: pads[part], t0, base: pads[part].position.y }); }
    else if (id === 'ubass') pulses.push({ kind: 'str', mesh: ubassStrings, t0 });
    else if (id === 'uke') pulses.push({ kind: 'str', mesh: ukeStrings, t0 });
  }
  function highlight(id) {
    hiTarget = id ? 0.55 : 0;
    if (id && centers[id]) { hiRing.position.set(centers[id].x, 0.02, centers[id].z); }
  }
  function update(t, dt, beat) {
    // key dips release
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i], age = performance.now() - p.t0;
      if (p.kind === 'key') { if (age > 130) { delete keyDip[p.midi]; layKeys(); pulses.splice(i, 1); } }
      else if (p.kind === 'pad') {
        const k = Math.max(0, 1 - age / 240);
        p.mesh.material.emissive.setRGB(0.5 * k, 0.9 * k, 0.8 * k);
        p.mesh.position.y = p.base - 0.006 * k;
        if (!k) pulses.splice(i, 1);
      }
      else if (p.kind === 'str') {
        const k = Math.max(0, 1 - age / 300);
        p.mesh.scale.x = 1 + 0.8 * k * Math.sin(age * 0.09);
        if (!k) { p.mesh.scale.x = 1; pulses.splice(i, 1); }
      }
    }
    // living props
    tungFlags.forEach(({ flag, ph }) => { flag.rotation.x = Math.sin(t * 0.9 + ph) * 0.08; flag.rotation.y = Math.sin(t * 0.6 + ph) * 0.1; });
    arecaGroups.forEach(({ fronds, ph }) => { fronds.rotation.y = Math.sin(t * 0.4 + ph) * 0.05; });
    lanternLight.emissiveIntensity = 0.75 + beat * 0.2 + Math.sin(t * 6.3) * 0.05;
    if (group.userData.leds) group.userData.leds.material.emissiveIntensity = 1.2 + beat * 0.8;
    hiRing.material.opacity += (hiTarget - hiRing.material.opacity) * Math.min(1, dt * 6);
    hiRing.scale.setScalar(1 + Math.sin(t * 3) * 0.04);
  }
  // cache world-space centers for the highlight + the camera
  group.updateMatrixWorld(true);
  centers.piano.setFromMatrixPosition(piano.matrixWorld);
  centers.ekit.setFromMatrixPosition(ekit.matrixWorld);
  centers.ubass.setFromMatrixPosition(ubass.matrixWorld);
  centers.uke.setFromMatrixPosition(uke.matrixWorld);

  function dispose() { scene.remove(group); disposables.forEach(d => { if (d.dispose) d.dispose(); }); }

  return {
    group,
    center: at.clone().add(new THREE.Vector3(0, 0, 0.1)),
    camSpot: at.clone().add(new THREE.Vector3(0, 2.3, 4.3)),
    pickables, resolve, hit, highlight, update, dispose,
    stats: { drawCalls: '≈30', triangles: '≈40k' },
  };
}
