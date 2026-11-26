/* SPDX-License-Identifier: GPL-3.0-or-later — made by the AI ʻohana for the Open Source Orchestra
   (Fork the First Artist · Zu Chiang Mai bubble).
   ── THE WORLD AROUND THE CIRCLE ───────────────────────────────────────────────────────
   A Chiang Mai night for the Full Circle: the circle floats on an island in dark water,
   inside an iridescent bubble. Coconut palms lean out over the sea. Two Naga (พญานาค),
   the serpent guardians of the Lanna temple stairs, swim around the island and rear up
   at the far side to watch. Krathong candles drift, khom loi rise, fireflies blink.
   Everything procedural — no images, no network. three.js r169 (vendored, passed in).
   Cultural care: Lanna motifs drawn with respect — no Buddha images, no temple buildings,
   no royal symbols, no 4Seas brand marks. */
'use strict';

let THREE;   // vendored three r169, handed in by the caller

/* ── shared GLSL: the night sky as a function of direction ───────────────── */
const GLSL_SKY = /* glsl */`
vec3 skyColor(vec3 d){
  float h = clamp(d.y, -1.0, 1.0);
  vec3 zen = vec3(0.020, 0.024, 0.102);   // #05061a
  vec3 mid = vec3(0.070, 0.102, 0.275);   // #121a46
  vec3 hor = vec3(0.173, 0.137, 0.325);   // #2c2353
  vec3 c = mix(hor, mid, smoothstep(-0.02, 0.28, h));
  c = mix(c, zen, smoothstep(0.25, 0.85, h));
  // a last warm breath along the far horizon (where the sun went down over the hills)
  float az = atan(d.x, d.z);                                  // 0 = +z (gate), ±π = far side
  float far = smoothstep(1.1, 2.4, abs(az));
  float band = exp(-abs(h - 0.03) * 9.0) * far;
  c += vec3(0.42, 0.16, 0.07) * band * 0.55;
  c += vec3(0.10, 0.05, 0.16) * exp(-abs(h) * 5.0) * 0.28;     // violet haze all around the waterline
  return c;
}
`;

/* ── small utils ─────────────────────────────────────────────────────────── */
function canvasTex(w, h, draw, { srgb = true } = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/* a tube with a radius profile, from a point list (finite-difference frames) */
function taperedTube(points, radiusAt, radial = 10, closed = false) {
  const n = points.length;
  const pos = new Float32Array(n * radial * 3), nor = new Float32Array(n * radial * 3), uv = new Float32Array(n * radial * 2);
  const idx = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    T.subVectors(b, a).normalize();
    N.crossVectors(up, T); if (N.lengthSq() < 1e-6) N.set(1, 0, 0); N.normalize();
    B.crossVectors(T, N).normalize();
    const r = radiusAt(u);
    for (let j = 0; j < radial; j++) {
      const th = (j / radial) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
      const k = (i * radial + j) * 3;
      p.copy(points[i]).addScaledVector(N, cs * r).addScaledVector(B, sn * r);
      pos[k] = p.x; pos[k + 1] = p.y; pos[k + 2] = p.z;
      p.set(0, 0, 0).addScaledVector(N, cs).addScaledVector(B, sn);
      nor[k] = p.x; nor[k + 1] = p.y; nor[k + 2] = p.z;
      const k2 = (i * radial + j) * 2; uv[k2] = u; uv[k2 + 1] = j / radial;
      if (i < n - 1) { const a0 = i * radial + j, a1 = i * radial + (j + 1) % radial, b0 = (i + 1) * radial + j, b1 = (i + 1) * radial + (j + 1) % radial; idx.push(a0, b0, a1, a1, b0, b1); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
/* merge simple geometries (same material) after baking matrices */
function mergeGeoms(list) { // list: [{geo, matrix}]
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
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

/* ── kranok flame: the Lanna flame motif, as an extruded Shape ───────────── */
function flameGeo(h = 1, w = 0.34, depth = 0.045) {
  const k = new THREE.Shape();
  k.moveTo(0, 0);
  k.bezierCurveTo(w * 0.9, h * 0.06, w * 1.02, h * 0.30, w * 0.60, h * 0.47);
  k.bezierCurveTo(w * 0.30, h * 0.60, w * 0.46, h * 0.76, w * 0.92, h * 0.84);
  k.bezierCurveTo(w * 0.66, h * 0.74, w * 0.92, h * 0.70, w * 1.04, h * 0.74);
  k.bezierCurveTo(w * 1.22, h * 0.82, w * 1.04, h * 0.97, w * 0.55, h * 1.04);
  k.bezierCurveTo(w * 0.30, h * 1.08, w * 0.06, h * 1.04, -w * 0.12, h * 0.96);
  k.bezierCurveTo(w * 0.12, h * 0.94, w * 0.24, h * 0.88, w * 0.18, h * 0.80);
  k.bezierCurveTo(w * 0.06, h * 0.66, -w * 0.18, h * 0.56, -w * 0.30, h * 0.42);
  k.bezierCurveTo(-w * 0.44, h * 0.26, -w * 0.32, h * 0.08, 0, 0);
  const g = new THREE.ExtrudeGeometry(k, { depth, bevelEnabled: true, bevelThickness: depth * 0.5, bevelSize: depth * 0.5, bevelSegments: 1, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/* ══════════════════════════════ THE BUILD ═══════════════════════════════ */
export function buildWorld(THREE_, scene, opts = {}) {
  THREE = THREE_;
  const lite = !!opts.lite, calm = !!opts.calm;
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };
  const mood = { v: 0.5 };
  const T0 = { t: 0 };

  /* ── sky ── */
  const skyMat = track(new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uT: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: GLSL_SKY + `varying vec3 vDir; uniform float uT;
      void main(){ vec3 d = normalize(vDir); vec3 c = skyColor(d);
        // a slow, deep aurora of violet — barely there
        c += vec3(0.05, 0.02, 0.10) * (0.5 + 0.5 * sin(d.x * 3.0 + uT * 0.05)) * exp(-abs(d.y - 0.5) * 3.0) * 0.5;
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  const sky = new THREE.Mesh(track(new THREE.SphereGeometry(300, 32, 16)), skyMat);
  sky.renderOrder = -10; scene.add(sky);

  /* stars: twinkling points */
  const NS = lite ? 380 : 700;
  {
    const p = new Float32Array(NS * 3), ph = new Float32Array(NS), sz = new Float32Array(NS);
    for (let i = 0; i < NS; i++) {
      const az = Math.random() * Math.PI * 2, el = Math.asin(Math.random() * 0.96 + 0.03);
      const r = 290;
      p[i * 3] = Math.sin(az) * Math.cos(el) * r; p[i * 3 + 1] = Math.sin(el) * r; p[i * 3 + 2] = Math.cos(az) * Math.cos(el) * r;
      ph[i] = Math.random() * 20; sz[i] = 0.7 + Math.random() * 1.9;
    }
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    const m = track(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 } },
      vertexShader: `attribute float aPhase; attribute float aSize; uniform float uT; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * 2.1; vA = 0.45 + 0.55 * sin(uT * (0.5 + fract(aPhase * 0.37) * 1.6) + aPhase * 19.0); }`,
      fragmentShader: `varying float vA; void main(){ vec2 q = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.05, length(q));
        gl_FragColor = vec4(0.92, 0.94, 1.0, a * vA * 0.9); }`,
    }));
    const pts = new THREE.Points(g, m); pts.renderOrder = -9; pts.frustumCulled = false; scene.add(pts);
    T0.stars = m;
  }

  /* moon: disc + glow, far side, left of the Naga */
  const moonDir = V3(Math.sin(Math.PI - 0.38) * Math.cos(0.5), Math.sin(0.5), Math.cos(Math.PI - 0.38) * Math.cos(0.5)).normalize();
  const moonPos = moonDir.clone().multiplyScalar(250);
  const moonTex = track(canvasTex(128, 128, (x) => {
    const g = x.createRadialGradient(64, 64, 10, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,250,235,1)'); g.addColorStop(0.55, 'rgba(250,240,214,.95)'); g.addColorStop(0.72, 'rgba(240,226,196,.28)'); g.addColorStop(1, 'rgba(240,226,196,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    x.fillStyle = 'rgba(210,200,180,.25)'; [[48, 50, 9], [74, 68, 6], [58, 82, 5]].forEach(([a, b, r]) => { x.beginPath(); x.arc(a, b, r, 0, 7); x.fill(); });
  }));
  const moon = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: moonTex, transparent: true, depthWrite: false, fog: false })));
  moon.scale.set(30, 30, 1); moon.position.copy(moonPos); scene.add(moon);
  const moonGlowTex = track(canvasTex(128, 128, (x) => {
    const g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,240,205,.5)'); g.addColorStop(0.4, 'rgba(255,225,180,.16)'); g.addColorStop(1, 'rgba(255,225,180,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  }));
  const moonGlow = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: moonGlowTex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })));
  moonGlow.scale.set(95, 95, 1); moonGlow.position.copy(moonPos); scene.add(moonGlow);
  const moonlight = new THREE.DirectionalLight(0xbfd0ff, 0.8); moonlight.position.copy(moonDir.clone().multiplyScalar(40)); scene.add(moonlight); scene.add(moonlight.target);

  /* ── Doi Suthep: an abstract ridge on the far horizon + one temple glint ── */
  {
    const pts = [];
    const AZ0 = Math.PI - 1.05, AZ1 = Math.PI + 1.05, N = 56;
    const ridge = (a) => 14 + 13 * Math.exp(-Math.pow((a - Math.PI) / 0.34, 2)) + 4.5 * Math.sin(a * 6.3) + 2 * Math.sin(a * 17.7);
    for (let i = 0; i <= N; i++) { const a = AZ0 + (AZ1 - AZ0) * (i / N); pts.push([a, ridge(a)]); }
    const pos = [], idx = [];
    pts.forEach(([a, h], i) => {
      const r = 150, x = Math.sin(a) * r, z = Math.cos(a) * r;
      pos.push(x, -4, z, x, h, z);
      if (i < pts.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    });
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx); g.computeVertexNormals();
    const ridgeMesh = new THREE.Mesh(g, track(new THREE.MeshBasicMaterial({ color: 0x0a0f2e, fog: true })));
    scene.add(ridgeMesh);
    // the golden chedi near the summit: one warm glint, breathing slowly
    const topA = Math.PI; const topR = 150;
    const glint = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: moonGlowTex, color: 0xffc76a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
    glint.scale.set(4.5, 4.5, 1); glint.position.set(Math.sin(topA) * topR, ridge(topA) + 2.2, Math.cos(topA) * topR); scene.add(glint);
    T0.chedi = glint;
  }

  /* ── water ── */
  const waterUniforms = { uT: { value: 0 }, uMoon: { value: moonDir }, uMood: { value: 0.5 } };
  const waterMat = track(new THREE.ShaderMaterial({
    fog: false, transparent: false,
    uniforms: waterUniforms,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: GLSL_SKY + `
      varying vec3 vW; uniform float uT; uniform vec3 uMoon; uniform float uMood;
      vec3 waterNormal(vec2 p, float t){
        float a = sin(p.x * 0.55 + t * 0.8) * 0.5 + sin(p.y * 0.42 - t * 0.6) * 0.5;
        float b = sin(p.x * 1.7 - t * 1.1 + p.y * 1.3) * 0.35;
        float c = sin((p.x + p.y) * 3.4 + t * 1.7) * 0.2;
        return normalize(vec3(a * 0.14 + b * 0.08 + c * 0.04, 1.0, b * 0.12 - a * 0.06 + c * 0.05));
      }
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        vec3 N = waterNormal(vW.xz, uT);
        vec3 R = reflect(-V, N);
        vec3 sky = skyColor(normalize(vec3(R.x, abs(R.y) * 0.6 + 0.05, R.z)));
        float fres = pow(1.0 - max(dot(V, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
        vec3 deep = vec3(0.012, 0.075, 0.105);
        vec3 c = mix(deep, sky, 0.25 + fres * 0.55);
        // moon glitter path
        float spec = pow(max(dot(R, uMoon), 0.0), 240.0) * 2.4 + pow(max(dot(R, uMoon), 0.0), 36.0) * 0.28;
        c += vec3(1.0, 0.93, 0.78) * spec;
        // soft teal breathing near the island
        float d = length(vW.xz);
        c += vec3(0.02, 0.10, 0.10) * exp(-(d - 13.0) * 0.16) * (0.5 + 0.5 * sin(uT * 0.4 + d * 0.8)) * (0.5 + uMood);
        // fade far water into the sky haze
        c = mix(c, skyColor(normalize(vec3(vW.x, 2.0, vW.z))), smoothstep(45.0, 85.0, d));
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  const water = new THREE.Mesh(track(new THREE.CircleGeometry(95, 80)), waterMat);
  water.rotation.x = -Math.PI / 2; water.position.y = -0.15; scene.add(water);

  /* ── island: ground, sand shore, underwater skirt ── */
  const groundTex = track(canvasTex(512, 512, (x) => {
    x.fillStyle = '#171226'; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(${40 + Math.random() * 30 | 0},${34 + Math.random() * 26 | 0},${52 + Math.random() * 30 | 0},${0.25 + Math.random() * 0.3})`; x.fillRect(Math.random() * 512, Math.random() * 512, 1.6, 1.6); }
    for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(${20 + Math.random() * 20 | 0},${70 + Math.random() * 40 | 0},${58 + Math.random() * 30 | 0},${0.12 + Math.random() * 0.2})`; const a = Math.random() * 7, r = 150 + Math.random() * 110; x.fillRect(256 + Math.cos(a) * r, 256 + Math.sin(a) * r, 2, 2); }
  }));
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping; groundTex.repeat.set(3, 3);
  const island = new THREE.Mesh(track(new THREE.CircleGeometry(12.6, 72)), track(new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0.02 })));
  island.rotation.x = -Math.PI / 2; island.position.y = 0.0; scene.add(island);
  const shoreTex = track(canvasTex(256, 64, (x) => {
    const g = x.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, '#4a3d33'); g.addColorStop(0.45, '#33291f'); g.addColorStop(1, '#0a1e26');
    x.fillStyle = g; x.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 500; i++) { x.fillStyle = `rgba(${120 + Math.random() * 60 | 0},${100 + Math.random() * 40 | 0},${70 + Math.random() * 30 | 0},${Math.random() * 0.16})`; x.fillRect(Math.random() * 256, Math.random() * 34, 1.4, 1.4); }
  }));
  shoreTex.wrapS = THREE.RepeatWrapping; shoreTex.repeat.set(6, 1);
  const shore = new THREE.Mesh(track(new THREE.RingGeometry(11.7, 12.85, 96)), track(new THREE.MeshStandardMaterial({ map: shoreTex, roughness: 1 })));
  shore.rotation.x = -Math.PI / 2; shore.position.y = 0.004; scene.add(shore);
  const skirt = new THREE.Mesh(track(new THREE.RingGeometry(12.8, 17.5, 96)), track(new THREE.MeshBasicMaterial({ color: 0x06222b, transparent: true, opacity: 0.85 })));
  skirt.rotation.x = -Math.PI / 2; skirt.position.y = -0.13; scene.add(skirt);

  /* ── the bubble ── */
  const bubbleUniforms = { uT: { value: 0 }, uMood: { value: 0.5 } };
  const bubbleMat = track(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: bubbleUniforms,
    vertexShader: `varying vec3 vN; varying vec3 vW; uniform float uT;
      void main(){
        vec3 p = position + normal * (sin(uT * 1.1 + position.y * 2.0 + position.x * 0.8) * 0.045);
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `varying vec3 vN; varying vec3 vW; uniform float uT; uniform float uMood;
      vec3 hsv(float h, float s, float v){
        vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        return v * mix(vec3(1.0), k, s);
      }
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        vec3 N = normalize(vN);
        float ndv = abs(dot(V, N));
        float fres = pow(1.0 - ndv, 2.4);
        float hue = 0.55 + 0.14 * sin(uT * 0.21 + vW.y * 0.33 + vW.x * 0.12)
                         + 0.09 * sin(uT * 0.13 - vW.z * 0.21 + 1.7);
        float swirl = sin(vW.x * 1.9 + uT * 0.6) * sin(vW.y * 2.7 - uT * 0.8) * sin(vW.z * 2.3 + uT * 0.5);
        vec3 col = hsv(hue, 0.75, 1.0);
        float a = 0.06 + fres * 0.65 + abs(swirl) * 0.06 + uMood * 0.03;
        // faint vertical sheen near the top
        a += smoothstep(6.0, 8.6, vW.y) * 0.05;
        gl_FragColor = vec4(col, a);
      }`,
  }));
  const bubble = new THREE.Mesh(track(new THREE.SphereGeometry(8.6, lite ? 40 : 56, lite ? 20 : 28, 0, Math.PI * 2, 0, Math.PI * 0.585)), bubbleMat);
  bubble.renderOrder = 8; scene.add(bubble);
  // the glowing rim where the bubble meets the ground
  const rimTex = track(canvasTex(64, 16, (x) => {
    const g = x.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, 'rgba(45,212,191,0)'); g.addColorStop(0.5, 'rgba(255,126,182,.9)'); g.addColorStop(1, 'rgba(45,212,191,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 16);
  }));
  const bubbleRim = new THREE.Mesh(track(new THREE.RingGeometry(8.42, 8.8, 128)), track(new THREE.MeshBasicMaterial({ map: rimTex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })));
  bubbleRim.rotation.x = -Math.PI / 2; bubbleRim.position.y = 0.025; bubbleRim.renderOrder = 8; scene.add(bubbleRim);

  /* floating bubbles inside the dome: sprite-points rising and swaying */
  const bubTex = track(canvasTex(64, 64, (x) => {
    x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 2.2;
    x.beginPath(); x.arc(32, 32, 24, 0, Math.PI * 2); x.stroke();
    const g = x.createRadialGradient(26, 24, 2, 32, 32, 26);
    g.addColorStop(0, 'rgba(255,255,255,.5)'); g.addColorStop(0.35, 'rgba(200,180,255,.10)'); g.addColorStop(0.8, 'rgba(45,212,191,.12)'); g.addColorStop(1, 'rgba(255,126,182,.22)');
    x.fillStyle = g; x.fill();
    x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 3;
    x.beginPath(); x.arc(32, 32, 24, Math.PI * 1.05, Math.PI * 1.45); x.stroke();
  }));
  const NB = lite ? 26 : 60;
  const bubP = new Float32Array(NB * 3), bubPh = new Float32Array(NB), bubSz = new Float32Array(NB), bubVy = new Float32Array(NB);
  for (let i = 0; i < NB; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 7.6;
    bubP.set([Math.cos(a) * r, 0.2 + Math.random() * 7.6, Math.sin(a) * r], i * 3);
    bubPh[i] = Math.random() * 20; bubSz[i] = 0.1 + Math.random() * 0.42; bubVy[i] = 0.10 + Math.random() * 0.16;
  }
  const bubGeo = track(new THREE.BufferGeometry());
  bubGeo.setAttribute('position', new THREE.BufferAttribute(bubP, 3));
  bubGeo.setAttribute('aPhase', new THREE.BufferAttribute(bubPh, 1));
  bubGeo.setAttribute('aSize', new THREE.BufferAttribute(bubSz, 1));
  const bubMat = track(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uT: { value: 0 }, uTex: { value: bubTex } },
    vertexShader: `attribute float aPhase; attribute float aSize; uniform float uT; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * 900.0 / max(1.0, -mv.z); vA = 0.5 + 0.5 * sin(uT * 1.7 + aPhase * 13.0); }`,
    fragmentShader: `uniform sampler2D uTex; varying float vA;
      void main(){ vec4 c = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(c.rgb, c.a * (0.55 + 0.45 * vA)); }`,
  }));
  const bubs = new THREE.Points(bubGeo, bubMat); bubs.renderOrder = 7; bubs.frustumCulled = false; scene.add(bubs);

  /* ── palms ── */
  const frondTex = track(canvasTex(256, 128, (x) => {
    x.clearRect(0, 0, 256, 128);
    x.strokeStyle = '#2a5c33'; x.lineWidth = 5;
    x.beginPath(); x.moveTo(0, 64); x.quadraticCurveTo(128, 60, 256, 66); x.stroke();
    for (let i = 0; i < 46; i++) {
      const u = i / 46, bx = 8 + u * 244, by = 64 - Math.sin(u * Math.PI) * 3;
      const len = 46 * (1 - u * 0.55) + 8, droop = 14 + u * 22;
      const g = x.createLinearGradient(bx, by, bx + 6, by - len);
      g.addColorStop(0, '#2f7a42'); g.addColorStop(1, '#5fae57');
      x.strokeStyle = g; x.lineWidth = 2.6 - u * 1.2;
      x.beginPath(); x.moveTo(bx, by); x.quadraticCurveTo(bx + len * 0.25, by - len * 0.7, bx + len * 0.3, by - len); x.stroke();
      x.beginPath(); x.moveTo(bx, by); x.quadraticCurveTo(bx + len * 0.2, by + len * 0.55 + droop * 0.2, bx + len * 0.24, by + len * 0.8); x.stroke();
    }
  }));
  frondTex.wrapS = frondTex.wrapT = THREE.ClampToEdgeWrapping;
  const frondGeo = (() => {
    const SEG = 9, pos = [], nor = [], uv = [], idx = [];
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG, L = 2.7;
      const z = -L * u, y = L * 0.16 * Math.sin(u * 2.5) - L * 0.42 * u * u;
      const w = 0.38 * (1 - Math.pow(u, 1.6)) + 0.04;
      pos.push(-w, y, z, w, y, z);
      nor.push(0, 1, 0, 0, 1, 0);
      uv.push(0, 1 - u, 1, 1 - u);
      if (i < SEG) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    g.setIndex(idx);
    return track(g);
  })();
  const frondMat = track(new THREE.MeshStandardMaterial({ map: frondTex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.85, color: 0xe8f4cc, emissive: 0x223d1a, emissiveIntensity: 0.6 }));
  const trunkTex = track(canvasTex(64, 256, (x) => {
    x.fillStyle = '#4c3a2c'; x.fillRect(0, 0, 64, 256);
    for (let y = 0; y < 256; y += 13) { x.fillStyle = 'rgba(20,12,6,.5)'; x.fillRect(0, y, 64, 4); x.fillStyle = 'rgba(140,110,80,.28)'; x.fillRect(0, y + 4, 64, 2); }
    for (let i = 0; i < 260; i++) { x.fillStyle = `rgba(${30 + Math.random() * 40 | 0},${22 + Math.random() * 30 | 0},${14 + Math.random() * 20 | 0},.25)`; x.fillRect(Math.random() * 64, Math.random() * 256, 1.5, 1.5); }
  }));
  trunkTex.wrapS = trunkTex.wrapT = THREE.RepeatWrapping;
  const palmAngles = [];
  {
    const N = lite ? 8 : 13;
    for (let i = 0; i < N; i++) {
      const a = ((i / N) * Math.PI * 2 + 0.24) % (Math.PI * 2);
      const dGate = Math.min(a, Math.PI * 2 - a);           // distance to +z (the gate)
      const dFar = Math.abs(a - Math.PI);                    // distance to -z (the Naga)
      if (dGate < 0.30 || dFar < 0.19) continue;
      palmAngles.push(a);
    }
  }
  const NP = palmAngles.length;
  const trunkCurve = [];
  for (let i = 0; i <= 10; i++) { const u = i / 10; trunkCurve.push(V3(0.9 * u * u, 5.0 * u, 0)); } // leans +x, 5 m tall
  const trunkGeo = track(taperedTube(trunkCurve, (u) => 0.17 - 0.06 * u, 7));
  const trunkMat = track(new THREE.MeshStandardMaterial({ map: trunkTex, roughness: 0.95 }));
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, NP);
  const NFR = 10;
  const fronds = new THREE.InstancedMesh(frondGeo, frondMat, NP * NFR);
  const cocoGeo = track(new THREE.SphereGeometry(0.09, 8, 6));
  const cocoMat = track(new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.8 }));
  const cocos = new THREE.InstancedMesh(cocoGeo, cocoMat, NP * 3);
  trunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fronds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(trunks, fronds, cocos);
  const palmData = palmAngles.map((a, i) => ({
    a, r: 9.7 + Math.sin(a * 3.7) * 1.3 + Math.random() * 0.9,
    h: 0.82 + Math.random() * 0.4, lean: 0.5 + Math.random() * 0.7, rot: a + Math.PI + (Math.random() - 0.5) * 0.9,
    ph: Math.random() * 20,
  }));
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  function layPalms(t, swayK) {
    palmData.forEach((pd, i) => {
      const sway = Math.sin(t * 0.7 + pd.ph) * 0.022 * swayK;
      _e.set(0, pd.rot, sway * 0.3, 'YXZ'); _q.setFromEuler(_e);
      _p.set(Math.sin(pd.a) * pd.r, 0, Math.cos(pd.a) * pd.r);
      _s.set(1, pd.h, 1);
      _m.compose(_p, _q, _s); trunks.setMatrixAt(i, _m);
      // trunk tip in local space is (0.9·lean?, 5, 0) — the lean is baked into the geometry
      const tip = V3(0.9, 5.0, 0).applyEuler(_e).multiply(_s).add(_p);
      for (let f = 0; f < NFR; f++) {
        const fa = (f / NFR) * Math.PI * 2 + pd.ph + Math.sin(t * 0.5 + pd.ph + f) * 0.03 * swayK;
        const fd = -0.5 - 0.55 * Math.sin(f * 2.4 + pd.ph) - 0.12 * Math.sin(t * 0.9 + pd.ph * 2 + f * 1.7) * swayK;
        _e.set(fd, fa, 0, 'YXZ'); _q.setFromEuler(_e);
        _s.set(0.85, 0.85, 0.85);
        _m.compose(tip, _q, _s); fronds.setMatrixAt(i * NFR + f, _m);
      }
      for (let cN = 0; cN < 3; cN++) {
        _p.set(tip.x + Math.sin(cN * 2.1) * 0.16, tip.y - 0.22, tip.z + Math.cos(cN * 2.1) * 0.16);
        _q.identity(); _s.set(1, 1, 1); _m.compose(_p, _q, _s); cocos.setMatrixAt(i * 3 + cN, _m);
      }
    });
    trunks.instanceMatrix.needsUpdate = true; fronds.instanceMatrix.needsUpdate = true; cocos.instanceMatrix.needsUpdate = true;
  }
  layPalms(0, 0);

  /* ── the two Naga (พญานาค) ── */
  const scaleTex = track(canvasTex(256, 256, (x) => {
    x.fillStyle = '#0b6b4a'; x.fillRect(0, 0, 256, 256);
    const R = 22;
    for (let row = 0; row < 13; row++) {
      for (let col = -1; col < 8; col++) {
        const cx = col * R * 1.55 + (row % 2) * R * 0.77, cy = row * R * 0.98;
        const g = x.createRadialGradient(cx, cy + R * 0.4, 2, cx, cy + R * 0.4, R);
        g.addColorStop(0, '#149a6b'); g.addColorStop(0.75, '#0b6b4a'); g.addColorStop(1, '#07472f');
        x.fillStyle = g;
        x.beginPath(); x.arc(cx, cy + R * 0.4, R * 0.72, Math.PI, 0); x.lineTo(cx + R * 0.72, cy + R * 0.4); x.closePath(); x.fill();
        x.strokeStyle = 'rgba(45,212,191,.35)'; x.lineWidth = 1.4;
        x.beginPath(); x.arc(cx, cy + R * 0.4, R * 0.72, Math.PI, 0); x.stroke();
        if ((row + col) % 5 === 0) { x.fillStyle = 'rgba(255,217,122,.5)'; x.beginPath(); x.arc(cx, cy + R * 0.18, 1.8, 0, 7); x.fill(); }
      }
    }
  }));
  scaleTex.wrapS = scaleTex.wrapT = THREE.RepeatWrapping; scaleTex.repeat.set(64, 7);
  const nagaMat = track(new THREE.MeshStandardMaterial({ map: scaleTex, roughness: 0.55, metalness: 0.18, emissive: 0x0a4a34, emissiveIntensity: 0.85 }));
  const goldMat = track(new THREE.MeshStandardMaterial({ color: 0xf0c464, metalness: 0.85, roughness: 0.3, emissive: 0x6a4d12, emissiveIntensity: 0.6 }));
  const mouthMat = track(new THREE.MeshStandardMaterial({ color: 0x571828, roughness: 0.7 }));
  const fangMat = track(new THREE.MeshStandardMaterial({ color: 0xf5e6c8, roughness: 0.4 }));
  const eyeMat = track(new THREE.MeshStandardMaterial({ color: 0xffb04a, emissive: 0xff9020, emissiveIntensity: 2.6 }));
  const flameFlareTex = moonGlowTex;

  function nagaPath(mirror) { // mirror: +1 = west guardian (A), -1 = east (B)
    const pts = [];
    const headAz = Math.PI + 0.21 * mirror;
    // neck: a cobra's rearing S — rises, leans back a breath, then the head lunges toward the island
    const neck = [
      [15.9, -1.2], [15.15, -0.1], [14.5, 0.95], [14.05, 1.95], [13.75, 2.9], [13.6, 3.8], [13.6, 4.55], [13.35, 5.15],
    ];
    neck.forEach(([r, y]) => pts.push(V3(Math.sin(headAz) * r, y, Math.cos(headAz) * r)));
    // body: humps swimming away around the island
    const HUMPS = 5, STEPS = 130;
    const tailAz = mirror > 0 ? Math.PI * 2 - 0.62 : 0.62;
    for (let i = 1; i <= STEPS; i++) {
      const u = i / STEPS;
      let az;
      if (mirror > 0) az = headAz + (Math.PI * 2 - 0.62 - headAz) * u;      // west: azimuth increases
      else az = headAz - (headAz - 0.62) * u;                                 // east: azimuth decreases
      const r = 15.4 + Math.sin(u * 7.1 + mirror) * 1.2;
      let y = Math.sin(u * Math.PI * HUMPS + mirror * 2.0);
      y = y > 0 ? y * 1.35 : y * 2.3;                                       // dive deeper than it humps
      y *= Math.min(1, u * 14);                                             // ease out of the neck
      pts.push(V3(Math.sin(az) * r, y, Math.cos(az) * r));
    }
    // tail curls up out of the water with a flame tip
    const [tx, , tz] = [Math.sin(tailAz) * 15.2, 0, Math.cos(tailAz) * 15.2];
    pts.push(V3(tx * 1.01, 0.5, tz * 1.01), V3(tx * 0.99, 1.05, tz * 0.99));
    return { pts, headAz, tailAz };
  }

  const nagas = [];
  [1, -1].forEach((mirror) => {
    const { pts, tailAz } = nagaPath(mirror);
    const g = new THREE.Group(); scene.add(g);
    // body: thick neck and mid-body, tapering to a whip tail
    const radiusAt = (u) => 0.06 + 0.5 * Math.pow(Math.sin(Math.PI * (0.10 + u * 0.90)), 0.55);
    const bodyGeo = track(taperedTube(pts, radiusAt, 12));
    const body = new THREE.Mesh(bodyGeo, nagaMat); g.add(body);
    // spine fins: a tight dorsal ridge of small sharp gold flames where the body breaks the water
    const finGeo = track(flameGeo(0.5, 0.11, 0.025));
    const finSpots = [];
    for (let i = 4; i < pts.length - 3; i += 2) {
      if (pts[i].y < 0.25) continue;
      finSpots.push(i);
    }
    const fins = new THREE.InstancedMesh(finGeo, goldMat, finSpots.length);
    const T = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), N = new THREE.Vector3();
    finSpots.forEach((pi, k) => {
      T.subVectors(pts[Math.min(pts.length - 1, pi + 1)], pts[Math.max(0, pi - 1)]).normalize();
      const yaw = Math.atan2(T.x, T.z);
      const u = pi / (pts.length - 1);
      const sc = 0.55 + 0.45 * Math.sin(Math.PI * u);
      // fins lean back along the body
      const lean = Math.min(0.5, Math.max(-0.5, T.y * -0.6)) - 0.35;
      _e.set(0, yaw, 0, 'YXZ'); _q.setFromEuler(_e);
      const qb = new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, 0, 0)); _q.multiply(qb);
      _s.set(sc, sc, sc);
      _m.compose(V3(pts[pi].x, pts[pi].y + radiusAt(u) * 0.92, pts[pi].z), _q, _s);
      fins.setMatrixAt(k, _m);
    });
    g.add(fins);
    // tail flame finial
    const tailFlame = new THREE.Mesh(track(flameGeo(0.85, 0.3, 0.05)), goldMat);
    const tp = pts[pts.length - 1];
    tailFlame.position.set(tp.x, tp.y - 0.1, tp.z);
    tailFlame.rotation.y = Math.atan2(-tp.x, -tp.z);
    g.add(tailFlame);
    // ── the head ──
    const head = new THREE.Group();
    head.position.copy(pts[7]);   // top of the neck's S
    head.scale.setScalar(1.45);
    g.add(head);
    // skull + snout (scaled spheres/cylinder), scale-mapped
    const skullParts = [];
    const skull = new THREE.SphereGeometry(0.5, 20, 14); skull.scale(0.46, 0.4, 0.62);
    skullParts.push({ geo: skull, matrix: new THREE.Matrix4().makeTranslation(0, 0, -0.05) });
    const snout = new THREE.CylinderGeometry(0.15, 0.33, 0.55, 10); snout.rotateX(Math.PI / 2); snout.scale(1.25, 0.62, 1);
    skullParts.push({ geo: snout, matrix: new THREE.Matrix4().makeTranslation(0, -0.03, 0.42) });
    const nost = new THREE.SphereGeometry(0.035, 6, 5);
    skullParts.push({ geo: nost, matrix: new THREE.Matrix4().makeTranslation(0.075, 0.05, 0.66) });
    skullParts.push({ geo: nost.clone(), matrix: new THREE.Matrix4().makeTranslation(-0.075, 0.05, 0.66) });
    const skullMesh = new THREE.Mesh(track(mergeGeoms(skullParts)), nagaMat); head.add(skullMesh);
    // lower jaw, slightly open
    const jaw = new THREE.Mesh(track(new THREE.BoxGeometry(0.30, 0.07, 0.52)), mouthMat);
    jaw.position.set(0, -0.185, 0.38); jaw.rotation.x = 0.22; head.add(jaw);
    // fangs (4) as one instanced cone
    const fangGeo = track(new THREE.ConeGeometry(0.034, 0.17, 6));
    const fangs = new THREE.InstancedMesh(fangGeo, fangMat, 4);
    [[0.10, -0.145, 0.60, 1], [-0.10, -0.145, 0.60, 1], [0.075, -0.115, 0.66, -1], [-0.075, -0.115, 0.66, -1]].forEach(([fx, fy, fz, dir], i) => {
      _e.set(dir > 0 ? Math.PI : 0, 0, 0); _q.setFromEuler(_e); _s.set(1, 1, 1);
      _m.compose(V3(fx, fy, fz), _q, _s); fangs.setMatrixAt(i, _m);
    });
    head.add(fangs);
    // forked tongue
    const tongueMat = track(new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5, emissive: 0x4a0d08, emissiveIntensity: 0.7 }));
    [-1, 1].forEach((s2) => {
      const tng = new THREE.Mesh(track(new THREE.ConeGeometry(0.014, 0.24, 5)), tongueMat);
      tng.position.set(s2 * 0.035, -0.17, 0.75); tng.rotation.set(Math.PI / 2 + 0.35, 0, s2 * -0.28);
      head.add(tng);
    });
    // eyes + glow
    const eyeGlows = [];
    [-1, 1].forEach((s2) => {
      const eye = new THREE.Mesh(track(new THREE.SphereGeometry(0.052, 10, 8)), eyeMat);
      eye.position.set(s2 * 0.165, 0.10, 0.30); head.add(eye);
      const glow = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: flameFlareTex, color: 0xffa030, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
      glow.scale.set(0.5, 0.5, 1); glow.position.copy(eye.position).multiplyScalar(1.06); head.add(glow); eyeGlows.push(glow);
    });
    // the golden regalia: crest flames, brow flames, chin flame, whiskers, beads — merged
    const goldParts = [];
    const crestC = flameGeo(0.95, 0.34, 0.05);
    goldParts.push({ geo: crestC, matrix: new THREE.Matrix4().makeRotationX(-0.32).setPosition(0, 0.30, -0.30) });
    const crestS = flameGeo(0.6, 0.24, 0.04);
    [[1, 0.16], [-1, -0.16]].forEach(([s2, off]) => {
      goldParts.push({ geo: crestS.clone(), matrix: new THREE.Matrix4().makeRotationY(s2 * 0.2).multiply(new THREE.Matrix4().makeRotationX(-0.5)).setPosition(off * 1.6, 0.22, -0.38) });
    });
    const brow = flameGeo(0.22, 0.09, 0.025);
    [[1], [-1]].forEach(([s2]) => {
      goldParts.push({ geo: brow.clone(), matrix: new THREE.Matrix4().makeRotationZ(s2 * -0.5).setPosition(s2 * 0.17, 0.19, 0.22) });
    });
    const chin = flameGeo(0.3, 0.12, 0.03);
    goldParts.push({ geo: chin, matrix: new THREE.Matrix4().makeRotationX(Math.PI - 0.5).setPosition(0, -0.24, 0.30) });
    const bead = new THREE.SphereGeometry(0.035, 8, 6);
    for (let i = 0; i < 5; i++) { const a = (i - 2) * 0.36; goldParts.push({ geo: bead.clone(), matrix: new THREE.Matrix4().makeTranslation(Math.sin(a) * 0.22, 0.245 + Math.cos(a) * 0.05, -0.26 - Math.cos(a) * 0.04) }); }
    // whiskers: curled flame tubes from the snout
    [-1, 1].forEach((s2) => {
      const wpts = [V3(s2 * 0.13, -0.02, 0.55), V3(s2 * 0.30, -0.06, 0.42), V3(s2 * 0.42, -0.02, 0.22), V3(s2 * 0.46, 0.08, 0.02)];
      const wg = taperedTube(wpts, (u) => 0.022 - 0.015 * u, 5);
      goldParts.push({ geo: wg, matrix: new THREE.Matrix4() });
    });
    const regalia = new THREE.Mesh(track(mergeGeoms(goldParts)), goldMat); head.add(regalia);
    // face the island; one guardian turns its head a touch, like they're watching different doors
    head.lookAt(mirror * 1.2, 2.0, 0);
    const baseY = head.position.y, baseRotZ = head.rotation.z;
    nagas.push({ g, head, tailFlame, eyeGlows, baseY, baseRotZ, ph: mirror > 0 ? 0 : 2.6 });
    return null;
  });

  /* ── krathong: candle floats on the water ── */
  const NK = lite ? 10 : 22;
  const kBaseGeo = track(new THREE.CylinderGeometry(0.27, 0.19, 0.07, 9));
  const kBaseMat = track(new THREE.MeshStandardMaterial({ color: 0x1d4a2a, roughness: 0.9 }));
  const kBases = new THREE.InstancedMesh(kBaseGeo, kBaseMat, NK);
  const petalGeo = track(new THREE.ConeGeometry(0.042, 0.11, 5));
  const petalMat = track(new THREE.MeshStandardMaterial({ color: 0xd94f7c, roughness: 0.7, emissive: 0x531228, emissiveIntensity: 0.5 }));
  const kPetals = new THREE.InstancedMesh(petalGeo, petalMat, NK * 6);
  const kFlameP = new Float32Array(NK * 3), kPh = new Float32Array(NK);
  const flameGeoPts = track(new THREE.BufferGeometry());
  flameGeoPts.setAttribute('position', new THREE.BufferAttribute(kFlameP, 3));
  flameGeoPts.setAttribute('aPhase', new THREE.BufferAttribute(kPh, 1));
  const flameTex = track(canvasTex(32, 48, (x) => {
    const g = x.createRadialGradient(16, 30, 2, 16, 26, 20);
    g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.35, 'rgba(255,200,90,.9)'); g.addColorStop(0.7, 'rgba(255,120,40,.35)'); g.addColorStop(1, 'rgba(255,100,30,0)');
    x.fillStyle = g; x.fillRect(0, 0, 32, 48);
  }));
  const flamesMat = track(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uT: { value: 0 }, uTex: { value: flameTex } },
    vertexShader: `attribute float aPhase; uniform float uT; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        float fl = 0.8 + 0.35 * sin(uT * 9.0 + aPhase * 31.0) * sin(uT * 5.3 + aPhase * 17.0);
        gl_PointSize = 11.0 * fl * 22.0 / max(1.0, -mv.z); vA = fl; }`,
    fragmentShader: `uniform sampler2D uTex; varying float vA;
      void main(){ vec4 c = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(c.rgb, c.a * vA); }`,
  }));
  const kFlames = new THREE.Points(flameGeoPts, flamesMat); kFlames.renderOrder = 6; kFlames.frustumCulled = false; scene.add(kFlames);
  const kData = [];
  for (let i = 0; i < NK; i++) {
    let a = 0, dGate = 0, dFar = 0, guard = 0;
    do {
      a = Math.random() * Math.PI * 2;
      dGate = Math.min(a, Math.PI * 2 - a);
      dFar = Math.abs(a - Math.PI);
    } while ((dGate < 0.45 || dFar < 0.5) && ++guard < 40);
    kData.push({ a, r: 13.6 + Math.random() * 8.5, ph: Math.random() * 20, dr: 0.014 + Math.random() * 0.02 });
    kPh[i] = kData[i].ph;
  }
  scene.add(kBases, kPetals);
  function layKrathong(t) {
    kData.forEach((k, i) => {
      k.a += k.dr * 0.016;
      const x = Math.sin(k.a) * k.r, z = Math.cos(k.a) * k.r, y = -0.06 + Math.sin(t * 0.7 + k.ph) * 0.045;
      _e.set(Math.sin(t * 0.5 + k.ph) * 0.05, k.a, Math.cos(t * 0.6 + k.ph) * 0.05); _q.setFromEuler(_e); _s.set(1, 1, 1);
      _m.compose(_p.set(x, y, z), _q, _s); kBases.setMatrixAt(i, _m);
      for (let p2 = 0; p2 < 6; p2++) {
        const pa = (p2 / 6) * Math.PI * 2;
        const px = x + Math.sin(pa) * 0.21, pz = z + Math.cos(pa) * 0.21;
        _e.set(-0.5, pa, 0, 'YXZ'); _q.setFromEuler(_e);
        _m.compose(_p.set(px, y + 0.09, pz), _q, _s); kPetals.setMatrixAt(i * 6 + p2, _m);
      }
      kFlameP[i * 3] = x; kFlameP[i * 3 + 1] = y + 0.16; kFlameP[i * 3 + 2] = z;
    });
    kBases.instanceMatrix.needsUpdate = true; kPetals.instanceMatrix.needsUpdate = true;
    flameGeoPts.attributes.position.needsUpdate = true;
  }
  layKrathong(0);

  /* ── khom loi: sky lanterns, far ones + released ones ── */
  const NL = (lite ? 9 : 14) + 6; // last 6 = release slots
  const lanP = new Float32Array(NL * 3), lanPh = new Float32Array(NL), lanA = new Float32Array(NL), lanSz = new Float32Array(NL);
  const lanData = [];
  for (let i = 0; i < NL; i++) {
    const ambient = i < NL - 6;
    lanData.push(ambient
      ? { x: (Math.random() - 0.5) * 110, z: -30 - Math.random() * 60, y: 2 + Math.random() * 30, vy: 0.22 + Math.random() * 0.2, drift: 0.1 + Math.random() * 0.25, life: Math.random(), ambient: true }
      : { x: 0, y: -10, z: 0, vy: 0, drift: 0, life: 0, ambient: false });
    lanPh[i] = Math.random() * 20; lanSz[i] = ambient ? 0.9 + Math.random() * 0.9 : 1.5;
  }
  const lanGeo = track(new THREE.BufferGeometry());
  lanGeo.setAttribute('position', new THREE.BufferAttribute(lanP, 3));
  lanGeo.setAttribute('aPhase', new THREE.BufferAttribute(lanPh, 1));
  lanGeo.setAttribute('aAlpha', new THREE.BufferAttribute(lanA, 1));
  lanGeo.setAttribute('aSize', new THREE.BufferAttribute(lanSz, 1));
  const lanTex = track(canvasTex(48, 64, (x) => {
    const g = x.createRadialGradient(24, 30, 3, 24, 32, 28);
    g.addColorStop(0, 'rgba(255,246,214,1)'); g.addColorStop(0.3, 'rgba(255,190,90,.95)'); g.addColorStop(0.65, 'rgba(255,140,50,.4)'); g.addColorStop(1, 'rgba(255,120,40,0)');
    x.fillStyle = g; x.fillRect(0, 0, 48, 64);
  }));
  const lanMat = track(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uT: { value: 0 }, uTex: { value: lanTex } },
    vertexShader: `attribute float aPhase; attribute float aAlpha; attribute float aSize; uniform float uT; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        float fl = 0.9 + 0.18 * sin(uT * 6.0 + aPhase * 23.0);
        gl_PointSize = aSize * fl * 62.0 / max(1.0, -mv.z); vA = aAlpha * fl; }`,
    fragmentShader: `uniform sampler2D uTex; varying float vA;
      void main(){ vec4 c = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(c.rgb, c.a * vA); }`,
  }));
  const lanterns = new THREE.Points(lanGeo, lanMat); lanterns.renderOrder = 6; lanterns.frustumCulled = false; scene.add(lanterns);
  function releaseLantern(az = 0) {
    const slot = lanData.find(l => !l.ambient && l.life <= 0);
    if (!slot) return false;
    slot.x = Math.sin(az) * 11.2; slot.z = Math.cos(az) * 11.2; slot.y = 0.5;
    slot.vy = 0.55; slot.drift = 0.3; slot.life = 1; slot.az = az;
    return true;
  }
  function stepLanterns(t, dt, k) {
    lanData.forEach((l, i) => {
      if (!l.ambient && l.life <= 0) { lanA[i] = 0; lanP[i * 3 + 1] = -30; return; }
      l.y += l.vy * dt * (l.ambient ? 1 : 1.4);
      l.x += Math.sin(t * 0.3 + lanPh[i]) * l.drift * dt;
      l.z += Math.cos(t * 0.23 + lanPh[i] * 1.3) * l.drift * dt * 0.6;
      if (l.ambient) {
        if (l.y > 55) { l.y = 1.5; l.x = (Math.random() - 0.5) * 110; l.z = -25 - Math.random() * 65; }
        lanA[i] = Math.min(1, lanA[i] + dt) * (l.y > 40 ? Math.max(0.1, 1 - (l.y - 40) / 16) : 1) * (0.5 + 0.5 * k);
      } else {
        l.life -= dt / 26;
        lanA[i] = Math.max(0, Math.min(1, (1 - l.life) * 3) * Math.min(1, l.life * 2));
        if (l.life <= 0) lanA[i] = 0;
      }
      lanP[i * 3] = l.x; lanP[i * 3 + 1] = l.y; lanP[i * 3 + 2] = l.z;
    });
    lanGeo.attributes.position.needsUpdate = true; lanGeo.attributes.aAlpha.needsUpdate = true;
  }

  /* ── fireflies ── */
  {
    const NF = lite ? 70 : 180;
    const p = new Float32Array(NF * 3), ph = new Float32Array(NF);
    for (let i = 0; i < NF; i++) {
      const a = Math.random() * Math.PI * 2, r = 8.2 + Math.random() * 6.8;
      p[i * 3] = Math.sin(a) * r; p[i * 3 + 1] = 0.3 + Math.random() * 3.4; p[i * 3 + 2] = Math.cos(a) * r;
      ph[i] = Math.random() * 20;
    }
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    const m = track(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uT: { value: 0 }, uMood: { value: 0.5 } },
      vertexShader: `attribute float aPhase; uniform float uT; varying float vA;
        void main(){ vec3 p = position; p.x += sin(uT * 0.4 + aPhase * 7.0) * 0.5; p.y += sin(uT * 0.55 + aPhase * 11.0) * 0.35;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          float blink = smoothstep(0.35, 0.9, sin(uT * (0.7 + fract(aPhase * 0.29) * 0.8) + aPhase * 29.0));
          gl_PointSize = 30.0 / max(1.0, -mv.z); vA = blink; }`,
      fragmentShader: `varying float vA; void main(){ vec2 q = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(q));
        gl_FragColor = vec4(0.72, 1.0, 0.55, a * vA * 0.8); }`,
    }));
    const f = new THREE.Points(g, m); f.frustumCulled = false; scene.add(f);
    T0.fireflies = m;
  }

  /* ── frame ── */
  function update(t, dt, beat, camPos) {
    const k = calm ? 0.45 : 1;
    skyMat.uniforms.uT.value = t; T0.stars.uniforms.uT.value = t;
    waterUniforms.uT.value = t * k; waterUniforms.uMood.value = mood.v;
    bubbleUniforms.uT.value = t * k; bubbleUniforms.uMood.value = mood.v;
    bubMat.uniforms.uT.value = t; flamesMat.uniforms.uT.value = t; lanMat.uniforms.uT.value = t;
    T0.fireflies.uniforms.uT.value = t; T0.fireflies.uniforms.uMood.value = mood.v;
    if (T0.chedi) T0.chedi.material.opacity = 0.7 + 0.3 * Math.sin(t * 0.8);
    bubbleRim.material.opacity = 0.35 + mood.v * 0.3 + beat * 0.12;
    layPalms(t, calm ? 0.35 : 1);
    layKrathong(t);
    stepLanterns(t, dt * (calm ? 0.6 : 1), 0.5 + mood.v * 0.5);
    scaleTex.offset.x = (t * 0.014 * k) % 1;
    nagas.forEach((n, i) => {
      const ph = t * (calm ? 0.32 : 0.5) + n.ph;
      n.head.position.y = n.baseY + Math.sin(ph) * 0.14;
      n.head.rotation.z = n.baseRotZ + Math.sin(ph * 0.7) * 0.05;
      const blink = 0.75 + 0.25 * Math.sin(t * 1.3 + n.ph * 3.1);
      n.eyeGlows.forEach(gl => { gl.material.opacity = blink * 0.85; });
      const fl = 1 + Math.sin(t * 5.2 + i * 2.0) * 0.1;
      n.tailFlame.scale.set(fl, 1 + Math.sin(t * 4.4 + i) * 0.12, 1);
    });
  }
  function setMood(m) { mood.v = Math.max(0, Math.min(1, m)); }
  function dispose() {
    scene.remove(sky, water, island, shore, skirt, bubble, bubbleRim, bubs, trunks, fronds, cocos, kBases, kPetals, kFlames, lanterns, moon, moonGlow, moonlight, moonlight.target);
    nagas.forEach(n => scene.remove(n.g));
    disposables.forEach(d => { if (d.dispose) d.dispose(); });
  }

  return {
    update, releaseLantern, setMood, dispose,
    focus: { naga: V3(0, 4.5, -14.2), nagaCam: V3(0, 3.6, -3.6) },
    stats: { drawCalls: '≈40', triangles: '≈150k' },
  };
}
