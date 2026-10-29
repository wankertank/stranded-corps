import * as THREE from 'three';

const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const cv = $('game');
const rc = $('radar'), rctx = rc.getContext('2d');
const cc = $('compass'), cctx = cc.getContext('2d');

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(rand(a, b + 1));
const chance = p => Math.random() < p;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// Hex strings are sRGB; Three's color management converts them to linear.
const col = h => new THREE.Color(h);

// ---------- world constants (metres) ----------
const WORLD = 280, GRID = 2, DAY = 90, NIGHT = 70;
const BASE = { x: 140, z: 145 }, BENCH = { x: 146, z: 150 }, HIVE = { x: 250, z: 35 };
const DOMES = [
  { x: 75, z: 85, n: 'HALDANE DOME A' }, { x: 200, z: 170, n: 'HALDANE DOME B' }, { x: 60, z: 215, n: 'HALDANE DOME C' },
  { x: 180, z: 75, n: 'HALDANE DOME D' }, { x: 130, z: 245, n: 'HALDANE DOME E' }, { x: 45, z: 35, n: 'HALDANE DOME F' },
];
const RIGS = [{ x: 240, z: 235 }, { x: 25, z: 145 }, { x: 235, z: 115 }, { x: 110, z: 30 }, { x: 175, z: 260 }];
const TIER_NAMES = ['', 'Survivor', 'Scavenger', 'Engineer', 'Veteran'];
const WIND = { x: -2.2, z: 1.0 };

const ED = {
  crawler: { hp: 18, spd: 8, dmg: 8, r: .45, armor: 0, col: '#3d3628', cd: .6 },
  drone:   { hp: 52, spd: 5.5, dmg: 13, r: .75, armor: 0, col: '#1a1f27', cd: .8 },
  spitter: { hp: 60, spd: 4.5, dmg: 12, r: .75, armor: 0, col: '#212a1e', cd: 1.4, range: 16 },
  warrior: { hp: 300, spd: 5, dmg: 30, r: 1.0, armor: 6, col: '#17191f', cd: .9 },
  warden:  { hp: 520, spd: 5.2, dmg: 36, r: 1.25, armor: 8, col: '#141419', cd: 1 },
  brood:   { hp: 3600, spd: 2.8, dmg: 55, r: 2.6, armor: 7, col: '#121218', cd: 1.2 },
};
const WEAPONS = {
  pistol: { name: 'M9 Sidearm', rate: .3, dmg: 11, spread: .012, ammo: 0, noise: 2, kick: .012 },
  pulse:  { name: 'Pulse Rifle', rate: .09, dmg: 13, spread: .02, ammo: 1, noise: 1.6, kick: .006 },
  flamer: { name: 'Flamethrower', rate: .03, dmg: 0, spread: 0, ammo: .3, noise: .45, kick: 0 },
  smart:  { name: 'Smart Gun', rate: .07, dmg: 17, spread: .008, ammo: 1, noise: 1.1, kick: .004 },
};
const RESEARCH = [
  { id: 't2', name: 'Field workshop', desc: 'Tier 2. Metal walls, floodlights, pulse rifle.', cost: { scrap: 20, metal: 8 }, tier: 1 },
  { id: 't3', name: 'Fabricator', desc: 'Tier 3. Sentry turrets, flamethrower, tracker, armor.', cost: { metal: 20, cells: 6, chips: 4 }, tier: 2 },
  { id: 't4', name: 'Hive analysis', desc: 'Tier 4. Study Skarn cores: smart gun, exosuit.', cost: { chips: 8, cores: 2 }, tier: 3 },
];
const ITEMS = [
  { id: 'ammo', name: 'Ammo pack', desc: '+30 rounds for rifles and the flamer.', cost: { scrap: 4 }, tier: 1, repeat: true },
  { id: 'med', name: 'Medkit', desc: 'Press H to heal 40.', cost: { scrap: 4, cells: 1 }, tier: 1, repeat: true },
  { id: 'pulse', name: 'Pulse rifle', desc: 'Automatic fire. Loud.', cost: { metal: 10, cells: 3 }, tier: 2 },
  { id: 'tracker', name: 'Motion tracker', desc: 'Shows movement in the dark.', cost: { cells: 4, chips: 2 }, tier: 3 },
  { id: 'flamer', name: 'Flamethrower', desc: 'Short range. Ignores armor.', cost: { metal: 14, chips: 3 }, tier: 3 },
  { id: 'armor', name: 'Armor plates', desc: '+50 max health.', cost: { metal: 12, chips: 3 }, tier: 3 },
  { id: 'smart', name: 'Smart gun', desc: 'Locks on to the nearest target.', cost: { chips: 6, cores: 3 }, tier: 4 },
  { id: 'exo', name: 'Heavy exosuit', desc: '+100 max health, faster stride.', cost: { metal: 24, cores: 4 }, tier: 4 },
];
const BUILDS = [
  { id: 'barricade', key: '1', name: 'Barricade', desc: 'Sandbags and scrap.', cost: { scrap: 5 }, hp: 70, tier: 1 },
  { id: 'wall', key: '2', name: 'Metal wall', desc: 'Holds a drone pack, briefly.', cost: { metal: 4 }, hp: 220, tier: 2 },
  { id: 'light', key: '3', name: 'Floodlight', desc: 'Lights up the dark. Draws them in.', cost: { metal: 2, cells: 2 }, hp: 60, tier: 2 },
  { id: 'turret', key: '4', name: 'Sentry turret', desc: 'Fires on anything that moves.', cost: { metal: 8, cells: 3, chips: 2 }, hp: 130, tier: 3 },
];
const RES = ['scrap', 'metal', 'cells', 'chips', 'cores'];

// ---------- noise and terrain ----------
function valueNoise(n, seed) {
  const r = mulberry(seed), g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const x0 = ((xi % n) + n) % n, y0 = ((yi % n) + n) % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = g[y0 * n + x0], b = g[y0 * n + x1], c = g[y1 * n + x0], d = g[y1 * n + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
const fbm = (nz, x, y, oct) => { let s = 0, amp = .5, f = 1, tot = 0; for (let i = 0; i < oct; i++) { s += nz(x * f, y * f) * amp; tot += amp; amp *= .5; f *= 2; } return s / tot; };
const NZ1 = valueNoise(64, 3), NZ2 = valueNoise(64, 8), NZ3 = valueNoise(64, 13);
const FLAT = [[BASE, 22, 40], [HIVE, 30, 50], ...DOMES.map(d => [d, 14, 24]), ...RIGS.map(d => [d, 12, 20])];
function H(x, z) {
  let h = (fbm(NZ1, x / 40, z / 40, 4) - .5) * 10 + (fbm(NZ2, x / 9, z / 9, 3) - .5) * 1.4;
  let f = 1; for (const [p, a, b] of FLAT) f = Math.min(f, smooth(a, b, Math.hypot(x - p.x, z - p.z)));
  h *= f;
  const e = Math.min(x, z, WORLD - x, WORLD - z); if (e < 26) h += Math.pow(26 - e, 1.5) * .7;
  return h;
}

// ---------- three setup ----------
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(col('#7f8b94'), .014);
scene.background = scene.fog.color.clone();
const camera = new THREE.PerspectiveCamera(74, 1, .08, 500);
camera.rotation.order = 'YXZ';
scene.add(camera);
function resize() { const w = cv.clientWidth, h = cv.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize);

// Three r155+ uses physical light units. LUX scales the prototype's tuned values to match the old look,
// and local lights use decay 0 so their falloff comes from the range cutoff the way it did before.
const LUX = Math.PI, PLUX = Math.PI * .8;
const hemi = new THREE.HemisphereLight(col('#b9c6d2'), col('#3a3732'), .7 * LUX); scene.add(hemi);
const sun = new THREE.DirectionalLight(col('#fff1dc'), 1.5 * LUX);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 });
sun.shadow.bias = -.0006; scene.add(sun); scene.add(sun.target);
const flashlight = new THREE.SpotLight(col('#ffe7c2'), 0, 60, .42, .55, 0);
flashlight.castShadow = true; flashlight.shadow.mapSize.set(1024, 1024); flashlight.shadow.camera.near = .3; flashlight.shadow.bias = -.0008;
flashlight.position.set(.25, -.15, .1); camera.add(flashlight); flashlight.target.position.set(.1, -.15, -5); camera.add(flashlight.target);
const muzzleLight = new THREE.PointLight(col('#ffd8a0'), 0, 16, 0); camera.add(muzzleLight); muzzleLight.position.set(.25, -.15, -1);
const fireLight = new THREE.PointLight(col('#ff8a3a'), 1.6 * PLUX, 24, 0); scene.add(fireLight);
const floodLights = Array.from({ length: 4 }, () => { const l = new THREE.PointLight(col('#ffe2b0'), 0, 30, 0); scene.add(l); return l; });

// ---------- textures ----------
function canvasTex(w, h, fn, srgb = true) { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; }
const groundTex = canvasTex(512, 512, (g, T) => {
  const img = g.createImageData(T, T), nz = valueNoise(8, 5), nz2 = valueNoise(32, 9), r = mulberry(4);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const h = fbm(nz, x / T * 8, y / T * 8, 5), dt = nz2(x / T * 32, y / T * 32);
    let v = 70 + h * 80; const frost = clamp((h - .58) * 3.2, 0, 1) * .6; v += (200 - v) * frost;
    const gr = (r() - .5) * 22 + (dt - .5) * 16, i = (y * T + x) * 4;
    img.data[i] = v + gr; img.data[i + 1] = v + gr + 2; img.data[i + 2] = v + gr + 5; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 900; i++) { const x = r() * T, y = r() * T, s = .8 + r() * 2.6, pv = 120 + r() * 90; g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.ellipse(x + s * .5, y + s * .6, s, s * .8, 0, 0, TAU); g.fill(); g.fillStyle = `rgb(${pv},${pv + 3},${pv + 6})`; g.beginPath(); g.ellipse(x, y, s, s * .8, 0, 0, TAU); g.fill(); }
});
groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping; groundTex.repeat.set(WORLD / 3.5, WORLD / 3.5);
const glowTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.3, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
const smokeTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,.6)'); gr.addColorStop(.6, 'rgba(255,255,255,.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
const planetTex = canvasTex(512, 256, (g, w, h) => { const r = mulberry(77); for (let y = 0; y < h; y++) { const v = Math.sin(y / h * 22 + Math.sin(y / 9) * .8) * .5 + .5; g.fillStyle = `rgb(${Math.round(120 + v * 70)},${Math.round(98 + v * 50)},${Math.round(80 + v * 30)})`; g.fillRect(0, y, w, 1); } for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,240,220,${r() * .12})`; g.fillRect(0, r() * h, w, 1 + r() * 3); } g.fillStyle = 'rgba(150,70,50,.5)'; g.beginPath(); g.ellipse(300, 150, 40, 14, 0, 0, TAU); g.fill(); });

// ---------- shared geometry and materials ----------
const SPH = new THREE.SphereGeometry(1, 18, 12), SPH_LO = new THREE.SphereGeometry(1, 10, 7);
const CYL = new THREE.CylinderGeometry(1, .75, 1, 7), CYLS = new THREE.CylinderGeometry(1, 1, 1, 10);
const CONE = new THREE.ConeGeometry(1, 1, 8), BOX = new THREE.BoxGeometry(1, 1, 1);
const M = {
  rock: new THREE.MeshStandardMaterial({ color: col('#4a5054'), roughness: .92, flatShading: true }),
  metal: new THREE.MeshStandardMaterial({ color: col('#6f7a80'), roughness: .55, metalness: .6 }),
  darkMetal: new THREE.MeshStandardMaterial({ color: col('#2c3236'), roughness: .5, metalness: .6 }),
  hull: new THREE.MeshStandardMaterial({ color: col('#5a6368'), roughness: .6, metalness: .45 }),
  burnt: new THREE.MeshStandardMaterial({ color: col('#1a1816'), roughness: .9 }),
  concrete: new THREE.MeshStandardMaterial({ color: col('#5c6162'), roughness: .95 }),
  glass: new THREE.MeshStandardMaterial({ color: col('#9cc6dc'), roughness: .1, metalness: .2, transparent: true, opacity: .28, side: THREE.DoubleSide, depthWrite: false }),
  hazard: new THREE.MeshStandardMaterial({ color: col('#c69a28'), roughness: .7 }),
  deck: new THREE.MeshStandardMaterial({ color: col('#45433c'), roughness: .8, metalness: .3 }),
  resin: new THREE.MeshStandardMaterial({ color: col('#1b221e'), roughness: .25, metalness: .3 }),
  resin2: new THREE.MeshStandardMaterial({ color: col('#2a342e'), roughness: .3, metalness: .2 }),
  egg: new THREE.MeshStandardMaterial({ color: col('#6a6248'), roughness: .65 }),
  sand: new THREE.MeshStandardMaterial({ color: col('#8d8268'), roughness: 1 }),
  wood: new THREE.MeshStandardMaterial({ color: col('#5c4630'), roughness: .9 }),
  lamp: new THREE.MeshStandardMaterial({ color: col('#fff3d0'), emissive: col('#ffe6a8'), emissiveIntensity: 1.5 }),
  amber: new THREE.MeshStandardMaterial({ color: col('#f0b13c'), emissive: col('#f0b13c'), emissiveIntensity: 1.2 }),
  red: new THREE.MeshStandardMaterial({ color: col('#ff4030'), emissive: col('#ff4030'), emissiveIntensity: 0 }),
  acidSac: new THREE.MeshStandardMaterial({ color: col('#9cc23a'), emissive: col('#7ea12a'), emissiveIntensity: .8, roughness: .4 }),
  gun: new THREE.MeshStandardMaterial({ color: col('#3b4146'), roughness: .4, metalness: .6 }),
  gunOlive: new THREE.MeshStandardMaterial({ color: col('#3e4a33'), roughness: .7, metalness: .2 }),
  glove: new THREE.MeshStandardMaterial({ color: col('#2b2f26'), roughness: .9 }),
};
const CRATE_MAT = {
  scrap: new THREE.MeshStandardMaterial({ color: col('#7d5a37'), roughness: .85 }), dome: new THREE.MeshStandardMaterial({ color: col('#5b7480'), roughness: .7, metalness: .2 }),
  rig: new THREE.MeshStandardMaterial({ color: col('#a68a2c'), roughness: .7 }), hive: new THREE.MeshStandardMaterial({ color: col('#3a4529'), roughness: .5 }),
  looted: new THREE.MeshStandardMaterial({ color: col('#1f201e'), roughness: .9 }),
};
function mesh(geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, parent = scene, shadow = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m;
}

// ---------- static world ----------
let terrainMesh, stars, planet, snowPts, rocks = [], cratesStatic = [];
function buildWorld() {
  const seg = 160, geo = new THREE.PlaneGeometry(WORLD, WORLD, seg, seg); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + WORLD / 2, z = pos.getZ(i) + WORLD / 2, h = H(x, z); pos.setY(i, h);
    const v = fbm(NZ3, x / 22, z / 22, 4), snowK = clamp((v - .55) * 4, 0, 1) * .8 + clamp((h - 3) / 8, 0, 1) * .5, dk = clamp((.45 - v) * 4, 0, 1) * .45;
    const nest = 1 - smooth(25, 80, Math.hypot(x - HIVE.x, z - HIVE.z));
    let c = lerp(.82, .4, dk); let r = c, g2 = c, b = c;
    r = lerp(r, 1.18, snowK); g2 = lerp(g2, 1.22, snowK); b = lerp(b, 1.3, snowK);
    r = lerp(r, .22, nest); g2 = lerp(g2, .3, nest); b = lerp(b, .25, nest);
    cols[i * 3] = r; cols[i * 3 + 1] = g2; cols[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3)); geo.computeVertexNormals();
  terrainMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: groundTex, vertexColors: true, roughness: .96 }));
  terrainMesh.position.set(WORLD / 2, 0, WORLD / 2); terrainMesh.receiveShadow = true; scene.add(terrainMesh);

  // rocks
  const r = mulberry(7), rockGeos = [];
  for (let v = 0; v < 10; v++) { const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, rr = mulberry(200 + v); for (let i = 0; i < p.count; i++) { const k = .75 + rr() * .45; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * .8, p.getZ(i) * k); } g.computeVertexNormals(); rockGeos.push(g); }
  const near = (x, z, p, d) => Math.hypot(x - p.x, z - p.z) < d;
  for (let i = 0; i < 300; i++) {
    const x = 8 + r() * (WORLD - 16), z = 8 + r() * (WORLD - 16), rad = .8 + Math.pow(r(), 2) * 3.2;
    if (near(x, z, BASE, 18) || near(x, z, HIVE, 32) || DOMES.some(d => near(x, z, d, 13)) || RIGS.some(d => near(x, z, d, 11))) continue;
    const y = H(x, z);
    const m = mesh(rockGeos[i % 10], M.rock, x, y + rad * .25, z, rad, rad * (.7 + r() * .5), rad * (.8 + r() * .4));
    m.rotation.y = r() * TAU; rocks.push({ x, z, r: rad, y });
  }
  // colony domes
  DOMES.forEach((d, i) => buildDome(d, mulberry(300 + i)));
  RIGS.forEach((d, i) => buildRig(d, mulberry(400 + i)));
  buildCrash(); buildNest(); buildBench();

  // sky: stars and the gas giant
  const sg = new THREE.BufferGeometry(), sp = new Float32Array(1600 * 3), rs = mulberry(91);
  for (let i = 0; i < 1600; i++) { const u = rs() * TAU, v = Math.acos(rs() * .95), R = 420; sp[i * 3] = Math.sin(v) * Math.cos(u) * R; sp[i * 3 + 1] = Math.cos(v) * R; sp[i * 3 + 2] = Math.sin(v) * Math.sin(u) * R; }
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: false, fog: false, transparent: true, opacity: 0, depthWrite: false }));
  scene.add(stars);
  planet = new THREE.Mesh(new THREE.SphereGeometry(70, 48, 32), new THREE.MeshBasicMaterial({ map: planetTex, fog: false, transparent: true, opacity: .5, depthWrite: false }));
  planet.rotation.z = .35; planet.renderOrder = -1; scene.add(planet);

  // blowing snow
  const n = 2600, g = new THREE.BufferGeometry(), p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { p[i * 3] = rand(-30, 30); p[i * 3 + 1] = rand(0, 18); p[i * 3 + 2] = rand(-30, 30); }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  snowPts = new THREE.Points(g, new THREE.PointsMaterial({ color: col('#e8eef2'), map: glowTex, size: .09, transparent: true, opacity: .8, depthWrite: false }));
  snowPts.frustumCulled = false; scene.add(snowPts);
}
function buildDome(d, r) {
  const y = H(d.x, d.z), g = new THREE.Group(); g.position.set(d.x, y, d.z); scene.add(g);
  mesh(CYLS, M.concrete, 0, .1, 0, 9.5, .3, 9.5, g, false);
  for (let i = 0; i < 14; i++) {
    if (r() < .3) continue;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(9, .14, 6, 18, Math.PI * (r() < .3 ? .25 + r() * .4 : .5)), M.metal);
    arc.rotation.y = i / 14 * TAU; arc.castShadow = true; g.add(arc);
  }
  for (const [ry, frac] of [[3.2, .75], [6.4, .5]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.sqrt(81 - ry * ry), .12, 6, 40, TAU * frac), M.metal);
    ring.rotation.x = Math.PI / 2; ring.position.y = ry; ring.rotation.z = r() * TAU; ring.castShadow = true; g.add(ring);
  }
  for (let i = 0; i < 6; i++) { const a = r() * TAU, pl = mesh(BOX, M.glass, Math.cos(a) * 8.6, 1.5 + r() * 4, Math.sin(a) * 8.6, .05, 2.5, 2.5, g, false); pl.rotation.y = -a; }
  for (let i = 0; i < 10; i++) { const a = r() * TAU, m2 = r() * 7; const b = mesh(BOX, chance(.5) ? M.darkMetal : M.concrete, Math.cos(a) * m2, .5, Math.sin(a) * m2, .6 + r() * 1.6, .3 + r() * 1.2, .6 + r() * 1.6, g); b.rotation.y = r() * TAU; }
}
function buildRig(d, r) {
  const y = H(d.x, d.z), g = new THREE.Group(); g.position.set(d.x, y, d.z); scene.add(g);
  mesh(BOX, M.deck, 0, .3, 0, 12, .6, 12, g);
  for (const [x, z, sx, sz] of [[0, 6, 12.1, .3], [0, -6, 12.1, .3], [6, 0, .3, 12.1], [-6, 0, .3, 12.1]]) mesh(BOX, M.hazard, x, .62, z, sx, .1, sz, g, false);
  const tx = 2.5, tz = -2.5, Ht = 11;
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const leg = mesh(BOX, M.metal, tx + a * 1.4, Ht / 2, tz + b * 1.4, .2, Ht, .2, g); leg.rotation.z = -a * .12; leg.rotation.x = b * .12; }
  for (let i = 1; i < 6; i++) { const yy = i * 1.9, w = 2.8 - i * .3; mesh(BOX, M.metal, tx, yy, tz, w + .2, .12, .12, g); mesh(BOX, M.metal, tx, yy, tz, .12, .12, w + .2, g); }
  mesh(CYLS, M.darkMetal, tx, Ht + .4, tz, .7, .8, .7, g);
  for (let i = 0; i < 4; i++) { const p = mesh(CYLS, M.darkMetal, -3, .9, -4 + i * 1.6, .35, 7, .35, g); p.rotation.z = Math.PI / 2; }
  for (let i = 0; i < 14; i++) mesh(SPH_LO, M.rock, -2 + r() * 4, .7, 2 + r() * 3, .5 + r() * .6, .35 + r() * .3, .5 + r() * .6, g);
}
let crashSmokeAt = [];
function buildCrash() {
  const x = BASE.x - 4, z = BASE.z - 3, y = H(x, z), g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = .6; scene.add(g);
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(16, 32), new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: glowTex, transparent: true, opacity: .7, depthWrite: false }));
  scorch.rotation.x = -Math.PI / 2; scorch.position.y = .06; g.add(scorch);
  const body = new THREE.Group(); body.rotation.z = .1; body.rotation.x = -.08; body.position.y = .9; g.add(body);
  mesh(BOX, M.hull, 0, 1.2, 0, 13, 3, 4.4, body);
  mesh(BOX, M.hull, -1, 2.9, 0, 9, .6, 3.6, body);
  const nose = mesh(CONE, M.hull, 8.3, 1.1, 0, 2.2, 3.6, 2.2, body); nose.rotation.z = -Math.PI / 2; nose.scale.set(2.1, 3.6, 1.5);
  mesh(BOX, new THREE.MeshStandardMaterial({ color: col('#1d3442'), roughness: .1, metalness: .5 }), 7.1, 2.0, 0, 1.6, .7, 2.6, body);
  const w1 = mesh(BOX, M.hull, -1, 1.4, 4.4, 4.2, .25, 4.2, body); w1.rotation.y = .3; w1.rotation.x = .25;
  const w2 = mesh(BOX, M.burnt, -2, .3, -3.8, 3, .2, 2.2, body); w2.rotation.x = -.4;
  for (const zz of [-1.6, 1.6]) { const e = mesh(CYLS, M.darkMetal, -7.2, 1.4, zz, .9, 2.4, .9, body); e.rotation.z = Math.PI / 2; mesh(CYLS, M.burnt, -8.45, 1.4, zz, .7, .1, .7, body).rotation.z = Math.PI / 2; }
  for (let i = 0; i < 6; i++) mesh(BOX, M.burnt, -5 + i * 2, 1.2 + rand(-1, 1), 2.25, 1.2, 1, .05, body, false);
  const beacon = mesh(SPH_LO, M.red, 1, 3.4, 0, .18, .18, .18, body, false); beacon.userData.beacon = true; M.red.userData.mesh = beacon;
  for (let i = 0; i < 26; i++) { const a = rand(0, TAU), m2 = rand(7, 16); const b = mesh(BOX, chance(.5) ? M.hull : M.burnt, Math.cos(a) * m2, .2, Math.sin(a) * m2, rand(.3, 1.4), rand(.1, .5), rand(.3, 1)); b.rotation.y = rand(0, TAU); g.add(b); }
  g.updateMatrixWorld(true);
  const ep = new THREE.Vector3(-8.6, 1.4, 0).applyMatrix4(body.matrixWorld);
  fireLight.position.set(ep.x, ep.y + 1, ep.z);
  crashSmokeAt = [ep];
}
function buildNest() {
  const r = mulberry(11), g = new THREE.Group(), y0 = H(HIVE.x, HIVE.z); g.position.set(HIVE.x, y0, HIVE.z); scene.add(g);
  for (let i = 0; i < 70; i++) { const a = r() * TAU, m2 = Math.pow(r(), .7) * 26, s = 1.5 + r() * 4 * (1 - m2 / 34); const b = mesh(SPH_LO, r() < .5 ? M.resin : M.resin2, Math.cos(a) * m2, -s * .35, Math.sin(a) * m2, s, s * .55, s * (.7 + r() * .5), g); b.rotation.y = r() * TAU; }
  for (let i = 0; i < 26; i++) { const a = r() * TAU, m2 = 6 + r() * 20, hgt = 3 + r() * 7; const p = mesh(CONE, M.resin, Math.cos(a) * m2, hgt / 2 - .5, Math.sin(a) * m2, .6 + r() * .8, hgt, .6 + r() * .8, g); p.rotation.z = (r() - .5) * .5; p.rotation.x = (r() - .5) * .5; }
  for (let i = 0; i < 30; i++) {
    const pts = []; let a = r() * TAU, x = Math.cos(a) * 4, z = Math.sin(a) * 4;
    for (let k = 0; k < 6; k++) { pts.push(new THREE.Vector3(x, .2 + Math.sin(k) * .4, z)); a += (r() - .5) * .6; x += Math.cos(a) * (5 + r() * 4); z += Math.sin(a) * (5 + r() * 4); }
    const t = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, .25 + r() * .3, 6, false), M.resin2); t.castShadow = true; t.receiveShadow = true; g.add(t);
  }
  for (let i = 0; i < 40; i++) { const a = r() * TAU, m2 = 8 + r() * 18; const e = mesh(SPH, M.egg, Math.cos(a) * m2, .45, Math.sin(a) * m2, .4, .55, .4, g); e.rotation.x = (r() - .5) * .3; }
}
function buildBench() {
  const y = H(BENCH.x, BENCH.z), g = new THREE.Group(); g.position.set(BENCH.x, y, BENCH.z); g.rotation.y = .3; scene.add(g);
  mesh(BOX, M.wood, 0, .85, 0, 2, .12, .9, g);
  for (const [x, z] of [[-.9, -.38], [.9, -.38], [-.9, .38], [.9, .38]]) mesh(BOX, M.darkMetal, x, .4, z, .08, .8, .08, g);
  mesh(BOX, M.darkMetal, -.4, 1.1, -.1, .7, .4, .5, g); mesh(BOX, M.metal, .5, .98, .1, .5, .15, .3, g);
  mesh(SPH_LO, M.amber, -.6, 1.4, -.1, .06, .06, .06, g, false);
  const l = new THREE.PointLight(col('#f0b13c'), .8 * PLUX, 6, 0); l.position.set(-.6, 1.6, 0); g.add(l);
}

// ---------- sprites, tracers, decals ----------
const spritePool = [];
function initSprites() {
  for (let i = 0; i < 260; i++) {
    const m = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff });
    const s = new THREE.Sprite(m); s.visible = false; scene.add(s); spritePool.push({ s, t: 0, max: 1, vx: 0, vy: 0, vz: 0, g0: 1, g1: 1, a0: 1, grav: 0 });
  }
}
function fx(kind, x, y, z, o = {}) {
  const p = spritePool.find(q => q.t <= 0); if (!p) return;
  const m = p.s.material;
  const K = {
    acid: { tex: glowTex, add: true, c: '#b9e04a', t: .5, g0: .3, g1: .1, a0: .9, grav: -9 },
    spark: { tex: glowTex, add: true, c: '#ffd890', t: .25, g0: .18, g1: .05, a0: 1, grav: -9 },
    flame: { tex: glowTex, add: true, c: '#ff8a32', t: .45, g0: .3, g1: 1.6, a0: .85, grav: 2 },
    smoke: { tex: smokeTex, add: false, c: '#5a5c5e', t: 5, g0: 1.5, g1: 7, a0: .5, grav: .3 },
    dust: { tex: smokeTex, add: false, c: '#8a8a84', t: 1.2, g0: .5, g1: 2.2, a0: .4, grav: .2 },
    flash: { tex: glowTex, add: true, c: '#fff0c8', t: .05, g0: .9, g1: .9, a0: 1, grav: 0 },
    spit: { tex: glowTex, add: true, c: '#c4ec52', t: .1, g0: .5, g1: .5, a0: 1, grav: 0 },
  }[kind];
  m.map = K.tex; m.blending = K.add ? THREE.AdditiveBlending : THREE.NormalBlending; m.color.set(o.c || K.c); m.needsUpdate = true;
  Object.assign(p, { t: o.t || K.t, max: o.t || K.t, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, g0: (o.s || 1) * K.g0, g1: (o.s || 1) * K.g1, a0: K.a0, grav: K.grav });
  p.s.position.set(x, y, z); p.s.visible = true; p.s.scale.setScalar(p.g0); m.opacity = p.a0;
}
function stepSprites(dt) {
  for (const p of spritePool) {
    if (p.t <= 0) continue; p.t -= dt;
    if (p.t <= 0) { p.s.visible = false; continue; }
    const k = 1 - p.t / p.max; p.vy += p.grav * dt;
    p.s.position.x += (p.vx + (p.grav > 0 && p.grav < 1 ? WIND.x : 0)) * dt; p.s.position.y += p.vy * dt; p.s.position.z += (p.vz + (p.grav > 0 && p.grav < 1 ? WIND.z : 0)) * dt;
    p.s.scale.setScalar(lerp(p.g0, p.g1, k)); p.s.material.opacity = p.a0 * (1 - k);
  }
}
const tracers = [];
function initTracers() {
  for (let i = 0; i < 24; i++) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: col('#ffe9b0'), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    l.visible = false; l.frustumCulled = false; scene.add(l); tracers.push({ l, t: 0 });
  }
}
function tracer(a, b, c = '#ffe9b0') {
  const tr = tracers.find(q => q.t <= 0) || tracers[0]; const p = tr.l.geometry.attributes.position;
  p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z); p.needsUpdate = true; tr.l.material.color.set(c); tr.l.visible = true; tr.t = .06;
}
const decals = [];
const splatGeo = new THREE.CircleGeometry(1, 12);
function splat(x, z, s, c = '#8fb33a') {
  let d = decals.length >= 80 ? decals.shift() : null;
  if (!d) { const m = new THREE.Mesh(splatGeo, new THREE.MeshStandardMaterial({ color: col(c), emissive: col('#3c5a10'), emissiveIntensity: .5, roughness: .2, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })); m.rotation.x = -Math.PI / 2; scene.add(m); d = { m }; }
  d.m.position.set(x, H(x, z) + .05, z); d.m.scale.set(s * rand(.8, 1.2), s * rand(.8, 1.2), 1); d.m.rotation.z = rand(0, TAU); d.m.material.opacity = .75; d.t = 40; decals.push(d);
}

// ---------- the Skarn ----------
const _up = new THREE.Vector3(0, 1, 0), _v = new THREE.Vector3();
function seg(m, ax, ay, az, bx, by, bz, th) {
  _v.set(bx - ax, by - ay, bz - az); const L = _v.length() || .001;
  m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2); m.scale.set(th, L, th); m.quaternion.setFromUnitVectors(_up, _v.divideScalar(L));
}
function buildSkarn(type) {
  const d = ED[type], s = d.r, g = new THREE.Group(); g.rotation.order = 'YXZ';
  const mat = new THREE.MeshStandardMaterial({ color: col(d.col), roughness: .26, metalness: .45, emissive: new THREE.Color(0) });
  const add = (geo, x, y, z, sx, sy, sz, m = mat) => mesh(geo, m, x, y, z, sx, sy, sz, g, true);
  const out = { g, mat, tail: [], legs: [] };
  if (type === 'crawler') {
    add(SPH, 0, s * .55, 0, s * .8, s * .3, s * .7);
    add(SPH, s * .7, s * .55, 0, s * .35, s * .25, s * .3);
  } else {
    add(SPH, -s * .1, s * .95, 0, s * .95, s * .45, s * .5);
    add(SPH, s * .72, s * 1.05, 0, s * .5, s * .42, s * .42);
    for (let i = 0; i < 4; i++) add(SPH_LO, -s * .65 + i * s * .32, s * 1.2, 0, s * .12, s * .3, s * .52);
    const head = add(SPH, s * 1.75, s * 1.22, 0, type === 'brood' ? s * .85 : s * 1.15, s * .32, s * .3); head.rotation.z = -.18;
    add(SPH_LO, s * 2.65, s * 1.02, 0, s * .16, s * .07, s * .1, M.darkMetal);
  }
  if (type === 'drone' || type === 'warrior' || type === 'warden') {
    for (const side of [-1, 1]) for (let j = 0; j < 2; j++) { const t = add(CYL, -s * .1 - j * s * .4, s * 1.55, side * s * .24, s * .07, s * .8, s * .07); t.rotation.z = 1.05 + j * .15; t.rotation.x = side * .45; }
  }
  if (type === 'spitter') add(SPH, -s * .45, s * 1.3, 0, s * .55, s * .45, s * .45, M.acidSac);
  if (type === 'warden') { const c = add(SPH, s * .7, s * 1.55, 0, s * 1.0, s * .12, s * .7); c.rotation.z = .5; }
  if (type === 'brood') {
    for (let i = -4; i <= 4; i++) { const p = new THREE.Group(); p.position.set(s * .9, s * 1.35, 0); p.rotation.order = 'YZX'; p.rotation.y = i * .2; p.rotation.z = .55 + Math.abs(i) * .05; g.add(p); mesh(BOX, mat, -s * .75, 0, 0, s * 1.5, s * .05, s * .32, p, true); }
    for (const side of [-1, 1]) { const a = new THREE.Mesh(CYL, mat); g.add(a); a.castShadow = true; out.legs.push({ side, j: -1, a, b: mesh(CYL, mat, 0, 0, 0, 1, 1, 1, g) }); }
    out.sac = add(SPH, -s * 2.8, s * .85, 0, s * 2.0, s * .9, s * 1.15, M.egg);
  }
  const n = type === 'brood' ? 11 : 9;
  for (let i = 0; i < n; i++) out.tail.push(add(SPH_LO, 0, 0, 0, 1, 1, 1));
  out.tip = add(CONE, 0, 0, 0, s * .12, s * .5, s * .05); out.tip.rotation.z = Math.PI / 2;
  const pairs = type === 'crawler' ? 4 : type === 'brood' ? 3 : 2;
  for (const side of [-1, 1]) for (let j = 0; j < pairs; j++) out.legs.push({ side, j, a: add(CYL, 0, 0, 0, 1, 1, 1), b: add(CYL, 0, 0, 0, 1, 1, 1) });
  return out;
}
function animSkarn(e) {
  const m = e.m, d = ED[e.type], s = d.r, t = e.anim, dead = e.dying > 0;
  const n = m.tail.length, tl = e.type === 'crawler' ? s * 3.2 : s * 2.8;
  let lx = 0, ly = 0, lz = 0;
  for (let i = 0; i < n; i++) {
    const k = (i + 1) / n, x = -s * .85 - k * tl, y = (e.type === 'crawler' ? s * .5 : s * .95) + Math.sin(k * 2.4) * s * .45 - k * k * s * .3;
    const z = dead ? Math.sin(k * 3) * s * .8 * k : Math.sin(t * 1.4 - k * 4.2) * s * .55 * k, rr = s * .2 * (1 - k * .72);
    m.tail[i].position.set(x, y, z); m.tail[i].scale.set(rr * 1.2, rr, rr); lx = x; ly = y; lz = z;
  }
  m.tip.position.set(lx - s * .3, ly, lz);
  const ty = e.type === 'crawler' ? s * .5 : s * .85, spacing = e.type === 'crawler' ? s * .35 : s * .55;
  for (const L of m.legs) {
    if (L.j < 0) { // Broodmother's small forearms
      seg(L.a, s * 1.0, s * 1.0, L.side * s * .35, s * 1.6, s * .7, L.side * s * .7, s * .08);
      seg(L.b, s * 1.6, s * .7, L.side * s * .7, s * 2.1, s * .9 + Math.sin(t * 2 + L.side) * s * .1, L.side * s * .4, s * .06); continue;
    }
    const hx = s * .35 - L.j * spacing, ph = t * 2.2 + L.j * Math.PI * .9 + (L.side > 0 ? Math.PI : 0);
    const reach = e.type === 'crawler' ? 1.5 : .95;
    let fx = hx + Math.cos(ph) * s * .45 + (L.j === 0 ? s * .3 : -s * .1), fy = Math.max(0, Math.sin(ph)) * s * .3, fz = L.side * s * reach;
    let kx = e.type === 'crawler' ? hx + (fx - hx) * .4 : hx - s * .3, ky = s * (e.type === 'crawler' ? 1.0 : 1.15), kz = L.side * s * (e.type === 'crawler' ? reach * .7 : .72);
    if (dead) { kx = hx; ky = s * .9; kz = L.side * s * .6; fx = hx - s * .2; fy = s * .5; fz = L.side * s * .3; }
    if (e.state === 'sleep' && !dead) { fy = 0; fx = hx + (L.j === 0 ? s * .3 : -s * .1); }
    seg(L.a, hx, ty, L.side * s * .3, kx, ky, kz, s * .11);
    seg(L.b, kx, ky, kz, fx, fy, fz, s * .07);
  }
  if (m.sac) m.sac.visible = e.state === 'sleep';
}

// ---------- structures ----------
function buildStruct(type, ghost) {
  const g = new THREE.Group(), gm = ghost ? new THREE.MeshBasicMaterial({ color: 0xf0b13c, transparent: true, opacity: .35, depthWrite: false }) : null;
  const add = (geo, mat, x, y, z, sx, sy, sz) => { const m = mesh(geo, gm || mat, x, y, z, sx, sy, sz, g, !ghost); if (ghost) m.receiveShadow = false; return m; };
  const out = { g, gm };
  if (type === 'barricade') {
    for (let row = 0; row < 3; row++) for (let i = 0; i < 3; i++) add(SPH_LO, -.6 + i * .6 + (row % 2) * .3 - .15, .18 + row * .3, 0, .34, .17, .28, M.sand);
    const pl = add(BOX, M.wood, 0, .7, .32, 1.9, .5, .06, M.wood); pl.rotation.z = .12;
  } else if (type === 'wall') {
    add(BOX, M.metal, 0, 1.3, 0, 1.96, 2.6, .5);
    add(BOX, M.darkMetal, 0, 1.3, 0, 2.0, .18, .56); add(BOX, M.darkMetal, 0, 2.55, 0, 2.0, .12, .56);
    add(BOX, M.darkMetal, -.95, 1.3, 0, .12, 2.6, .58); add(BOX, M.darkMetal, .95, 1.3, 0, .12, 2.6, .58);
  } else if (type === 'light') {
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU, l = add(CYLS, M.darkMetal, Math.cos(a) * .35, .55, Math.sin(a) * .35, .04, 1.2, .04); l.rotation.z = Math.cos(a) * .35; l.rotation.x = -Math.sin(a) * .35; }
    add(CYLS, M.darkMetal, 0, 2.1, 0, .06, 2.6, .06);
    out.lamp = add(BOX, M.lamp, 0, 3.45, 0, .7, .35, .45);
  } else if (type === 'turret') {
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU, l = add(CYLS, M.darkMetal, Math.cos(a) * .3, .45, Math.sin(a) * .3, .05, 1, .05); l.rotation.z = Math.cos(a) * .4; l.rotation.x = -Math.sin(a) * .4; }
    const head = new THREE.Group(); head.position.y = 1.0; g.add(head); out.head = head;
    mesh(BOX, gm || M.metal, 0, 0, 0, .6, .4, .5, head, !ghost);
    mesh(BOX, gm || M.hazard, 0, .21, 0, .62, .03, .52, head, false);
    for (const z of [-.12, .12]) { const b = mesh(CYLS, gm || M.gun, .55, 0, z, .05, .7, .05, head, !ghost); b.rotation.z = Math.PI / 2; }
  }
  return out;
}

// ---------- viewmodel ----------
const vm = new THREE.Group(); camera.add(vm); vm.position.set(.24, -.24, -.42); vm.scale.setScalar(.75);
const VMS = {};
function buildViewmodels() {
  const add = (parent, geo, mat, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m; };
  const mk = () => { const g = new THREE.Group(); vm.add(g); g.visible = false; return g; };
  let g = mk(); VMS.pistol = g;
  add(g, BOX, M.gun, 0, 0, -.06, .05, .07, .24); add(g, BOX, M.gun, 0, -.08, .02, .045, .14, .06); add(g, BOX, M.glove, 0, -.12, .06, .08, .1, .12);
  g.muzzle = new THREE.Vector3(0, .01, -.2);
  g = mk(); VMS.pulse = g;
  add(g, BOX, M.gunOlive, 0, 0, -.1, .08, .1, .5); add(g, BOX, M.gun, 0, .01, -.42, .03, .03, .18); add(g, BOX, M.gun, 0, -.09, -.12, .05, .12, .07);
  add(g, BOX, M.gun, 0, .07, -.05, .04, .04, .22); add(g, BOX, M.amber, .042, .02, -.02, .005, .02, .05); add(g, BOX, M.glove, -.02, -.1, .08, .08, .1, .12); add(g, BOX, M.glove, 0, -.06, -.28, .08, .07, .1);
  g.muzzle = new THREE.Vector3(0, .01, -.52);
  g = mk(); VMS.flamer = g;
  add(g, CYLS, M.gun, 0, 0, -.15, .035, .5, .035).rotation.x = Math.PI / 2; add(g, CYLS, new THREE.MeshStandardMaterial({ color: col('#7a2c1c'), roughness: .5 }), 0, -.09, -.05, .06, .3, .06).rotation.x = Math.PI / 2;
  add(g, SPH_LO, M.amber, 0, -.02, -.41, .012, .012, .012); add(g, BOX, M.glove, 0, -.1, .08, .08, .1, .12);
  g.muzzle = new THREE.Vector3(0, 0, -.42);
  g = mk(); VMS.smart = g;
  add(g, BOX, M.gun, .02, 0, -.1, .12, .12, .5); add(g, CYLS, M.darkMetal, .02, .0, -.42, .04, .2, .04).rotation.x = Math.PI / 2;
  add(g, BOX, M.metal, .1, .02, .05, .03, .03, .3); add(g, BOX, new THREE.MeshStandardMaterial({ color: col('#57d2ff'), emissive: col('#2aa0d0'), emissiveIntensity: 1 }), -.045, .07, -.05, .04, .03, .06);
  g.muzzle = new THREE.Vector3(.02, 0, -.54);
}

// ---------- sound: everything is synthesized with Web Audio, so there are no files to load ----------
const VOICE = { crawler: .7, drone: 1, spitter: 1.1, warrior: 1.6, warden: 1.9, brood: 3 };
const SFX = (() => {
  let ac = null, master, bus, windGain, windFilter, noiseBuf, muted = false, heart = 0;
  const now = () => ac.currentTime;
  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { ac = new AC(); } catch (e) { return; }
    master = ac.createGain(); master.gain.value = .8;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ac.destination);
    bus = ac.createGain(); bus.connect(master);
    // a short slapback echo off the rocks
    const dl = ac.createDelay(), fb = ac.createGain(), wet = ac.createGain(), lp = ac.createBiquadFilter();
    dl.delayTime.value = .12; fb.gain.value = .28; wet.gain.value = .2; lp.type = 'lowpass'; lp.frequency.value = 1600;
    bus.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const wn = ac.createBufferSource(); wn.buffer = noiseBuf; wn.loop = true;
    windFilter = ac.createBiquadFilter(); windFilter.type = 'bandpass'; windFilter.frequency.value = 400; windFilter.Q.value = .7;
    windGain = ac.createGain(); windGain.gain.value = 0;
    wn.connect(windFilter); windFilter.connect(windGain); windGain.connect(master); wn.start();
  }
  function out(pan = 0, vol = 1) {
    const g = ac.createGain(); g.gain.value = vol;
    if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); p.connect(bus); } else g.connect(bus);
    return g;
  }
  function noise(dest, t0, dur, type, f0, f1, q, v0, attack = .002) {
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t0); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur); f.Q.value = q;
    const g = ac.createGain(); g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(v0, t0 + attack); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + .05);
  }
  function tone(dest, t0, dur, type, f0, f1, v0, attack = .005) {
    const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(v0, t0 + attack); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + .05);
  }
  // pan and loudness of a sound at a world position, heard from the marine's head
  function place(x, z, range) {
    const p = S.player, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d > range) return null;
    const f = fwd(), pan = d > .5 ? (dx * -f.z + dz * f.x) / d : 0;
    return { pan: pan * .85, vol: 1 / (1 + d * d / 70) };
  }
  const live = () => ac && !muted;
  const api = {
    init,
    pause(b) { if (!ac) return; if (b) ac.suspend(); else ac.resume(); },
    toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : .8; return muted; },
    shot(kind) {
      if (!live()) return; const t = now(), o = out(0, 1);
      if (kind === 'pistol') { noise(o, t, .2, 'bandpass', 2400, 500, .8, .9); tone(o, t, .13, 'sine', 170, 48, .8); noise(o, t, .04, 'highpass', 5000, 5000, .5, .4); }
      else if (kind === 'pulse') { noise(o, t, .1, 'bandpass', 3200, 1100, 1.2, .55); tone(o, t, .08, 'square', 440, 120, .16); tone(o, t, .1, 'sine', 120, 45, .5); }
      else { noise(o, t, .12, 'bandpass', 1800, 500, 1, .6); tone(o, t, .1, 'sawtooth', 260, 70, .2); tone(o, t, .14, 'sine', 90, 40, .6); }
    },
    flame() { if (!live()) return; const t = now(), o = out(0, 1); noise(o, t, .16, 'lowpass', 900, 450, .7, .4, .02); noise(o, t, .12, 'bandpass', 2600, 1800, 2, .07, .02); },
    empty() { if (!live()) return; tone(out(0, 1), now(), .04, 'square', 1800, 1500, .08); },
    step(sprint) { if (!live()) return; noise(out(rand(-.1, .1), 1), now(), sprint ? .09 : .12, 'bandpass', rand(900, 1400), 380, 1.4, sprint ? .22 : .13, .005); },
    loot() { if (!live()) return; const t = now(), o = out(0, 1); noise(o, t, .25, 'bandpass', 700, 300, 2, .3, .01); tone(o, t + .08, .1, 'triangle', 880, 880, .1); tone(o, t + .16, .12, 'triangle', 1320, 1320, .1); },
    ui(ok = true) { if (!live()) return; const t = now(), o = out(0, 1); tone(o, t, .08, 'square', ok ? 660 : 220, ok ? 660 : 170, .06); if (ok) tone(o, t + .07, .1, 'square', 990, 990, .06); },
    build() { if (!live()) return; const t = now(), o = out(0, 1); noise(o, t, .22, 'lowpass', 600, 200, 1, .5); tone(o, t, .15, 'sine', 140, 70, .5); noise(o, t + .05, .08, 'highpass', 4000, 4000, 1, .2); },
    hurt() { if (!live()) return; const t = now(), o = out(0, 1); tone(o, t, .22, 'sine', 95, 45, .7); noise(o, t, .15, 'lowpass', 800, 300, 1, .4); },
    heal() { if (!live()) return; const t = now(), o = out(0, 1); noise(o, t, .3, 'highpass', 3000, 6000, 1, .15, .05); tone(o, t + .1, .3, 'sine', 520, 780, .08, .05); },
    hiss(x, z, big = 1) { if (!live()) return; const pl = place(x, z, 45); if (!pl) return; const t = now(), o = out(pl.pan, pl.vol); noise(o, t, .55 * big, 'bandpass', 4200 / big, 2200 / big, 3, .5, .05); tone(o, t, .4 * big, 'sawtooth', 900 / big, 300 / big, .04, .05); },
    screech(x, z, big = 1) {
      if (!live()) return; const pl = place(x, z, 90); if (!pl) return; const t = now(), o = out(pl.pan, pl.vol * 1.3);
      const car = ac.createOscillator(), mod = ac.createOscillator(), mg = ac.createGain(), g = ac.createGain(), f = ac.createBiquadFilter();
      car.type = 'sawtooth'; car.frequency.setValueAtTime(1400 / big, t); car.frequency.exponentialRampToValueAtTime(480 / big, t + .6 * big);
      mod.frequency.value = 37 / big; mg.gain.value = 600 / big; mod.connect(mg); mg.connect(car.frequency);
      f.type = 'bandpass'; f.frequency.value = 1800 / big; f.Q.value = 1.5;
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.35, t + .05); g.gain.exponentialRampToValueAtTime(.0001, t + .7 * big);
      car.connect(f); f.connect(g); g.connect(o); car.start(t); mod.start(t); car.stop(t + .8 * big); mod.stop(t + .8 * big);
      noise(o, t, .6 * big, 'highpass', 3000 / big, 3000 / big, 1, .18, .03);
    },
    claw(x, z) { if (!live()) return; const pl = place(x, z, 30); if (!pl) return; const t = now(), o = out(pl.pan, pl.vol); noise(o, t, .08, 'highpass', 3500, 3500, 1, .5); noise(o, t + .06, .08, 'highpass', 3000, 3000, 1, .4); },
    skitter(x, z) { if (!live()) return; const pl = place(x, z, 22); if (!pl) return; const t = now(), o = out(pl.pan, pl.vol * .5); for (let i = 0; i < 3; i++) noise(o, t + i * .045, .025, 'highpass', 5000, 5000, 1, .3); },
    hit(x, z) { if (!live()) return; const pl = place(x, z, 60); if (!pl) return; noise(out(pl.pan, pl.vol), now(), .22, 'bandpass', 3000, 6000, 2, .25, .01); },
    die(x, z, big = 1) { if (!live()) return; api.screech(x, z, big * 1.4); const pl = place(x, z, 60); if (!pl) return; noise(out(pl.pan, pl.vol), now() + .1, 1.2, 'bandpass', 5000, 2500, 2, .25, .1); },
    spit(x, z) { if (!live()) return; const pl = place(x, z, 40); if (!pl) return; const t = now(), o = out(pl.pan, pl.vol); noise(o, t, .2, 'lowpass', 1200, 300, 4, .5); tone(o, t, .15, 'sine', 300, 120, .3); },
    splash() { if (!live()) return; noise(out(0, 1), now(), .5, 'bandpass', 4500, 2000, 1.5, .4, .01); },
    turret(x, z) { if (!live()) return; const pl = place(x, z, 60); if (!pl) return; const t = now(), o = out(pl.pan, pl.vol * .8); noise(o, t, .09, 'bandpass', 2000, 800, 1, .5); tone(o, t, .07, 'square', 300, 100, .1); },
    crash(x, z) { if (!live()) return; const pl = place(x, z, 70); if (!pl) return; const t = now(), o = out(pl.pan, pl.vol); noise(o, t, .6, 'lowpass', 1500, 120, 1, .7); tone(o, t, .5, 'sine', 80, 35, .7); },
    roar(x, z) { if (!live()) return; const pl = place(x, z, 400) || { pan: 0, vol: .2 }; const t = now(), o = out(pl.pan, Math.max(.3, pl.vol)); tone(o, t, 2.4, 'sawtooth', 110, 52, .35, .3); tone(o, t, 2.4, 'sawtooth', 114, 50, .25, .3); noise(o, t, 2.4, 'lowpass', 600, 150, 1, .45, .3); },
    nightfall() { if (!live()) return; const t = now(), o = out(0, 1); tone(o, t, 3.5, 'sine', 55, 48, .5, .8); tone(o, t, 3.5, 'triangle', 82, 73, .2, .8); tone(o, t + .4, 3, 'sine', 330, 311, .05, 1); },
    dawn() { if (!live()) return; const t = now(), o = out(0, 1); tone(o, t, 2.5, 'sine', 220, 220, .08, .6); tone(o, t + .3, 2.5, 'sine', 330, 330, .06, .6); },
    ping(k) { if (!live()) return; const t = now(), o = out(0, 1), f = 1000 + k * 900; tone(o, t, .12, 'sine', f, f, .12, .003); tone(o, t, .12, 'sine', f * 2, f * 2, .03, .003); },
    sweep() { if (!live()) return; tone(out(0, 1), now(), .06, 'sine', 1200, 1200, .03); },
    ambience(dark, dt) {
      if (!ac) return; const t = now();
      windGain.gain.setTargetAtTime(muted ? 0 : .05 + dark * .08 + .03 * Math.sin(S.t * .3), t, .5);
      windFilter.frequency.setTargetAtTime(300 + 250 * (Math.sin(S.t * .23) + 1) + dark * 100, t, .8);
      const p = S.player;
      if (live() && p.hp > 0 && p.hp < p.max * .3) { heart -= dt; if (heart <= 0) { heart = .75; const o = out(0, 1); tone(o, t, .12, 'sine', 60, 40, .5); tone(o, t + .18, .12, 'sine', 55, 38, .4); } }
    },
  };
  return api;
})();

// ---------- state ----------
let S, keys = new Set(), mouse = { down: false }, running = false, paused = false, locked = false, noLock = false;
function clearDynamic() {
  if (!S) return;
  for (const e of S.enemies) scene.remove(e.m.g);
  for (const c of S.crates) scene.remove(c.m);
  for (const s of S.structs.values()) scene.remove(s.o.g);
  for (const b of S.spits) scene.remove(b.m);
  if (S.ghost) scene.remove(S.ghost.g);
}
const crateGeo = new THREE.BoxGeometry(.9, .6, .62);
function newGame() {
  clearDynamic();
  const r = mulberry(17), crates = [];
  const near = (x, z, p, d) => Math.hypot(x - p.x, z - p.z) < d;
  const free = (x, z) => !rocks.some(k => Math.hypot(x - k.x, z - k.z) < k.r + 1);
  const addCrate = (x, z, kind) => { if (!free(x, z)) return; const y = H(x, z); const m = mesh(crateGeo, CRATE_MAT[kind], x, y + .3, z); m.rotation.y = r() * TAU; crates.push({ x, z, kind, looted: false, m }); };
  for (let i = 0; i < 170; i++) { const x = 6 + r() * (WORLD - 12), z = 6 + r() * (WORLD - 12); if (!near(x, z, BASE, 11) && !near(x, z, HIVE, 30)) addCrate(x, z, 'scrap'); }
  for (let i = 0; i < 4; i++) { const a = r() * TAU; addCrate(BASE.x + Math.cos(a) * rand(6, 10), BASE.z + Math.sin(a) * rand(6, 10), 'scrap'); }
  DOMES.forEach(d => { for (let i = 0; i < 5; i++) { const a = r() * TAU, m2 = r() * 6.5; addCrate(d.x + Math.cos(a) * m2, d.z + Math.sin(a) * m2, 'dome'); } });
  RIGS.forEach(d => { for (let i = 0; i < 4; i++) addCrate(d.x - 4.5 + r() * 3, d.z + 1 + r() * 3.5, 'rig'); });
  for (let i = 0; i < 6; i++) { const a = r() * TAU, m2 = 13 + r() * 10; addCrate(HIVE.x + Math.cos(a) * m2, HIVE.z + Math.sin(a) * m2, 'hive'); }

  S = {
    t: 0, day: 1, phase: 'day', phaseT: 0, kills: 0, tier: 1, over: false, won: false, wonAt: 0, shake: 0, muzzle: 0, recoil: 0,
    player: { x: BASE.x - 3, z: BASE.z + 6, yaw: 2.6, pitch: 0, r: .45, hp: 100, max: 100, spd: 5.2, cool: 0, hurt: 0, bob: 0, moving: false, sprint: false },
    inv: { scrap: 2, metal: 0, cells: 0, chips: 0, cores: 0, med: 0, ammo: 0 },
    weapons: ['pistol'], wi: 0, gear: {}, research: {}, enemies: [], spits: [], structs: new Map(), crates,
    noise: 0, buildMode: false, buildSel: 0, spawnQueue: [], wanderT: 0, raidT: 30, smokeT: 0, flashOn: true, brood: null, tips: {}, ghost: null, ghostType: null,
  };
  S.brood = spawn('brood', HIVE.x, HIVE.z, 'sleep'); S.brood.home = true;
  [[-7, 2.5], [7, 3.5], [0, -7.5], [-3, 8.5]].forEach(([dx, dz]) => { spawn('warden', HIVE.x + dx, HIVE.z + dz, 'sleep').home = true; });
  [[-13, 7], [12, -8.5], [9, 12]].forEach(([dx, dz]) => { spawn('warrior', HIVE.x + dx, HIVE.z + dz, 'sleep').home = true; });
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; spawn('drone', HIVE.x + Math.cos(a) * 16, HIVE.z + Math.sin(a) * 16, 'sleep').home = true; }
  $('log').innerHTML = '';
  msg('Dropship down. The fleet has jumped. You are alone on Veyra-9.', 'warn');
  msg('Search the wreckage with E, then open the workbench with C.', 'info');
}
function spawn(type, x, z, state = 'hunt') {
  const d = ED[type], m = buildSkarn(type); scene.add(m.g);
  const e = { type, x, z, hp: d.hp, max: d.hp, a: rand(0, TAU), anim: rand(0, 10), cd: 0, state, flash: 0, spawnT: 0, atk: 0, dying: 0, m };
  S.enemies.push(e); placeEnemy(e); animSkarn(e); return e;
}
function placeEnemy(e) { e.m.g.position.set(e.x, H(e.x, e.z), e.z); e.m.g.rotation.y = -e.a; }

// ---------- helpers ----------
function msg(text, kind = '') {
  const el = document.createElement('div'); el.textContent = text; if (kind) el.className = kind;
  const log = $('log'); log.prepend(el);
  while (log.children.length > 5) log.lastChild.remove();
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 700); }, 6500);
}
let toastT = 0;
function toast(text) { $('hint').textContent = text; toastT = 1.4; }
const canAfford = cost => Object.entries(cost).every(([k, v]) => S.inv[k] >= v);
const pay = cost => Object.entries(cost).forEach(([k, v]) => S.inv[k] -= v);
const costStr = cost => Object.entries(cost).map(([k, v]) => S.inv[k] >= v ? `${v} ${k}` : `<s>${v} ${k}</s>`).join(' · ');
const key = (gx, gz) => gx + ',' + gz;
function structsNear(x, z, r) {
  const out = [], g0x = Math.floor((x - r) / GRID), g1x = Math.floor((x + r) / GRID), g0z = Math.floor((z - r) / GRID), g1z = Math.floor((z + r) / GRID);
  for (let gx = g0x; gx <= g1x; gx++) for (let gz = g0z; gz <= g1z; gz++) {
    const s = S.structs.get(key(gx, gz)); if (!s) continue;
    const cx = clamp(x, gx * GRID, gx * GRID + GRID), cz = clamp(z, gz * GRID, gz * GRID + GRID);
    if (Math.hypot(x - cx, z - cz) < r) out.push(s);
  }
  return out;
}
function rockHit(x, z, r) { for (const k of rocks) if (Math.abs(x - k.x) < k.r + r && Math.abs(z - k.z) < k.r + r && Math.hypot(x - k.x, z - k.z) < k.r * .85 + r) return k; return null; }
function blocked(x, z, r) { return x < 4 || z < 4 || x > WORLD - 4 || z > WORLD - 4 || rockHit(x, z, r) || structsNear(x, z, r).length > 0; }
function moveBody(o, dx, dz, r) {
  let moved = false;
  if (!blocked(o.x + dx, o.z + dz, r)) { o.x += dx; o.z += dz; return true; }
  if (dx && !blocked(o.x + dx, o.z, r)) { o.x += dx; moved = true; }
  if (dz && !blocked(o.x, o.z + dz, r)) { o.z += dz; moved = true; }
  return moved;
}
function tip(id, text) { if (S.tips[id]) return; S.tips[id] = 1; msg(text, 'info'); }
const fwd = () => ({ x: -Math.sin(S.player.yaw), z: -Math.cos(S.player.yaw) });
const eyeY = () => H(S.player.x, S.player.z) + 1.65;

// ---------- input ----------
function lockMouse() { if (noLock) return; try { const p = cv.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { noLock = true; } }
document.addEventListener('pointerlockchange', () => {
  const was = locked; locked = document.pointerLockElement === cv;
  if (was && !locked && running && !S.over && $('craft').hidden && !paused) togglePause(true);
});
document.addEventListener('pointerlockerror', () => { if (!noLock) { noLock = true; msg('Mouse lock is blocked here, so look by moving the mouse over the view.', 'info'); } });
addEventListener('keydown', e => {
  if (!running) return;
  const c = e.code;
  if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c)) e.preventDefault();
  if (c === 'KeyP' || (c === 'Escape' && $('craft').hidden && !S.buildMode)) { togglePause(); return; }
  if (paused || S.over) return;
  keys.add(c);
  if (c === 'Escape') { if (!$('craft').hidden) toggleCraft(false); else S.buildMode = false; }
  if (c === 'KeyC' || c === 'Tab') toggleCraft();
  if (c === 'KeyE') loot();
  if (c === 'KeyF') S.flashOn = !S.flashOn;
  if (c === 'KeyB') { S.buildMode = !S.buildMode; if (S.buildMode) tip('build', 'Build mode: aim at the ground, left-click to place, right-click to remove, 1 to 4 to pick.'); }
  if (/^Digit[1-4]$/.test(c)) { S.buildSel = +c.slice(5) - 1; S.buildMode = true; }
  if (c === 'KeyQ') { S.wi = (S.wi + 1) % S.weapons.length; S.buildMode = false; }
  if (c === 'KeyH') useMed();
  if (c === 'KeyM') toast(SFX.toggleMute() ? 'Sound off' : 'Sound on');
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouse.down = false; if (running && !S.over && !paused && $('craft').hidden) togglePause(true); });
addEventListener('mousemove', e => {
  if (!running || paused || S.over || !$('craft').hidden) return;
  if (!locked && !noLock) return;
  const p = S.player; p.yaw -= e.movementX * .0022; p.pitch = clamp(p.pitch - e.movementY * .0022, -1.45, 1.45);
});
cv.addEventListener('mousedown', e => {
  if (!running || paused || S.over) return;
  if (!locked) lockMouse();
  if (e.button === 2) { removeStruct(); return; }
  if (S.buildMode) { placeStruct(); return; }
  mouse.down = true;
});
addEventListener('mouseup', () => mouse.down = false);
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('wheel', e => { if (!running || S.weapons.length < 2) return; S.wi = (S.wi + (e.deltaY > 0 ? 1 : S.weapons.length - 1)) % S.weapons.length; }, { passive: true });

// ---------- actions ----------
function nearestCrate() {
  let best = null, bd = 2.6; const f = fwd();
  for (const c of S.crates) if (!c.looted) { const dx = c.x - S.player.x, dz = c.z - S.player.z, d = Math.hypot(dx, dz); if (d < bd && (dx * f.x + dz * f.z) / (d || 1) > .2) { bd = d; best = c; } }
  return best;
}
function loot() {
  const c = nearestCrate(); if (!c) return;
  c.looted = true; c.m.material = CRATE_MAT.looted; c.m.scale.y = .5; c.m.position.y -= .15;
  const g = {}; const add = (k, n) => { if (n > 0) g[k] = (g[k] || 0) + n; };
  if (c.kind === 'scrap') { add('scrap', rint(1, 3)); if (chance(.3)) add('metal', 1); }
  if (c.kind === 'dome') { add('scrap', rint(0, 2)); add('metal', rint(1, 2)); if (chance(.7)) add('cells', 1); }
  if (c.kind === 'rig') { add('metal', rint(1, 3)); if (chance(.55)) add('chips', 1); if (chance(.25)) add('cells', 1); }
  if (c.kind === 'hive') { add('chips', rint(1, 2)); add('cells', 1); }
  const parts = Object.entries(g).map(([k, v]) => `+${v} ${k}`);
  for (const [k, v] of Object.entries(g)) S.inv[k] += v;
  toast(parts.length ? parts.join('   ') : 'Empty'); SFX.loot();
  S.noise = Math.min(100, S.noise + 3);
  if (g.cells) tip('cells', 'Power cells. The colony domes have the most.');
  if (g.chips) tip('chips', 'Fabricator chips. Mining rigs carry them.');
}
function useMed() { const p = S.player; if (S.inv.med < 1 || p.hp >= p.max) return; S.inv.med--; p.hp = Math.min(p.max, p.hp + 40); toast('+40 health'); SFX.heal(); }
function targetCell() {
  const p = S.player, f = fwd(), dist = clamp(4 + Math.tan(-p.pitch) * -2, 2.5, 7);
  const x = p.x + f.x * dist, z = p.z + f.z * dist, gx = Math.floor(x / GRID), gz = Math.floor(z / GRID);
  return { gx, gz, cx: gx * GRID + GRID / 2, cz: gz * GRID + GRID / 2 };
}
function placeCheck() {
  const b = BUILDS[S.buildSel], c = targetCell(), p = S.player;
  let why = '';
  if (b.tier > S.tier) why = `Needs tier ${b.tier}`;
  else if (!canAfford(b.cost)) why = 'Not enough materials';
  else if (S.structs.has(key(c.gx, c.gz))) why = 'Occupied';
  else if (rockHit(c.cx, c.cz, .9)) why = 'Rock in the way';
  else if (Math.hypot(c.cx - p.x, c.cz - p.z) < p.r + 1.2) why = 'Too close';
  else if (S.enemies.some(e => Math.hypot(c.cx - e.x, c.cz - e.z) < ED[e.type].r + 1.2)) why = 'Something is there';
  return { b, ...c, why };
}
function placeStruct() {
  const c = placeCheck(); if (c.why) { toast(c.why); SFX.ui(false); return; }
  pay(c.b.cost);
  const o = buildStruct(c.b.id, false); o.g.position.set(c.cx, H(c.cx, c.cz), c.cz); o.g.rotation.y = Math.round(S.player.yaw / (Math.PI / 2)) * Math.PI / 2; scene.add(o.g);
  S.structs.set(key(c.gx, c.gz), { type: c.b.id, hp: c.b.hp, max: c.b.hp, gx: c.gx, gz: c.gz, x: c.cx, z: c.cz, cool: 0, a: 0, fl: 0, o });
  S.noise = Math.min(100, S.noise + 2); SFX.build();
}
function removeStruct() {
  const c = targetCell(), s = S.structs.get(key(c.gx, c.gz)); if (!s) return;
  const b = BUILDS.find(b => b.id === s.type);
  for (const [k, v] of Object.entries(b.cost)) S.inv[k] += Math.floor(v / 2);
  destroyStruct(s, false); toast('Salvaged');
}
function destroyStruct(s, loud) {
  scene.remove(s.o.g); S.structs.delete(key(s.gx, s.gz));
  if (loud) { SFX.crash(s.x, s.z); for (let i = 0; i < 6; i++) fx('dust', s.x + rand(-.8, .8), H(s.x, s.z) + rand(.3, 1.5), s.z + rand(-.8, .8), { vy: rand(.5, 1.5) }); msg(`${BUILDS.find(b => b.id === s.type).name} destroyed.`, 'warn'); }
}
const atBench = () => d2(S.player, BENCH) < 7;

// ---------- crafting panel ----------
function toggleCraft(force) {
  const el = $('craft'), open = force ?? el.hidden;
  el.hidden = !open;
  if (open) { renderCraft(); S.buildMode = false; mouse.down = false; if (locked) document.exitPointerLock(); }
  else if (running && !S.over) lockMouse();
}
function card(o, kind) {
  const done = (kind === 'research' && S.research[o.id]) || (kind === 'item' && !o.repeat && S.gear[o.id]);
  const lockedT = o.tier > S.tier;
  const ok = !done && !lockedT && canAfford(o.cost) && (kind === 'build' || atBench());
  const tag = done ? 'Done' : lockedT ? `Needs tier ${o.tier}` : kind === 'build' ? `Key ${o.key}` : '';
  return `<button class="card${done ? ' done' : ''}" data-kind="${kind}" data-id="${o.id}" aria-disabled="${!ok}">
    <span class="row"><span class="n">${o.name}</span><span class="tierTag">${tag}</span></span>
    <span class="d">${o.desc}</span><span class="c">${done ? '&nbsp;' : costStr(o.cost)}</span></button>`;
}
function renderCraft() {
  if ($('craft').hidden) return;
  $('craftNote').textContent = atBench() ? '' : 'You are away from the workbench. Research and gear need the bench at the crash site.';
  const set = (id, html) => { const el = $(id); if (el._html !== html) { el._html = html; el.innerHTML = html; } };
  set('g_research', RESEARCH.map(o => card(o, 'research')).join(''));
  set('g_items', ITEMS.map(o => card(o, 'item')).join(''));
  set('g_builds', BUILDS.map(o => card(o, 'build')).join(''));
}
$('craft').addEventListener('click', e => {
  const b = e.target.closest('.card');
  if (!b) { if (e.target.id === 'craft') toggleCraft(false); return; }
  if (b.getAttribute('aria-disabled') === 'true') return;
  const kind = b.dataset.kind, id = b.dataset.id;
  if (kind === 'build') { S.buildSel = BUILDS.findIndex(x => x.id === id); toggleCraft(false); S.buildMode = true; return; }
  const o = (kind === 'research' ? RESEARCH : ITEMS).find(x => x.id === id);
  pay(o.cost); SFX.ui(true);
  if (kind === 'research') { S.research[id] = true; S.tier = +id.slice(1); msg(`Tier ${S.tier} reached: ${TIER_NAMES[S.tier]}.`, 'good'); }
  else craftItem(id);
  renderCraft();
});
function craftItem(id) {
  const p = S.player;
  if (id === 'ammo') { S.inv.ammo += 30; return; }
  if (id === 'med') { S.inv.med++; return; }
  S.gear[id] = true;
  if (WEAPONS[id]) { S.weapons.push(id); S.wi = S.weapons.length - 1; S.inv.ammo += 40; msg(`${WEAPONS[id].name} ready. Q switches weapons.`, 'good'); }
  if (id === 'tracker') { $('radarBox').hidden = false; msg('Motion tracker online.', 'good'); }
  if (id === 'armor') { p.max += 50; p.hp += 50; }
  if (id === 'exo') { p.max += 100; p.hp += 100; p.spd += 1.2; }
}
function togglePause(force) {
  paused = force ?? !paused; $('ovPause').hidden = !paused; mouse.down = false; SFX.pause(paused);
  if (paused && locked) document.exitPointerLock();
}

// ---------- day and night ----------
function startNight() {
  S.phase = 'night'; S.phaseT = 0;
  const n = S.day, q = [];
  for (let i = 0; i < 4 + 3 * n; i++) q.push('drone');
  if (n >= 2) for (let i = 0; i < 3 * n; i++) q.push('crawler');
  if (n >= 3) for (let i = 0; i < n; i++) q.push('spitter');
  if (n >= 3) for (let i = 0; i < n - 2; i++) q.push('warrior');
  S.spawnQueue = q.sort(() => Math.random() - .5).map((type, i) => ({ type, at: i * (32 / q.length) }));
  msg(`Night ${n}. ${q.length} contacts inbound.`, 'warn'); SFX.nightfall();
  if (n === 7 && S.brood && S.brood.hp > 0) { S.brood.state = 'hunt'; SFX.roar(S.brood.x, S.brood.z); msg('Seismic contact. The Broodmother has left the nest.', 'warn'); }
}
function startDay() {
  S.day++; S.phase = 'day'; S.phaseT = 0; S.raidT = rand(20, 35);
  for (const e of S.enemies) if (!e.home && e.type !== 'brood' && !e.dying) e.state = 'flee';
  let refilled = 0;
  for (const c of S.crates) if (c.looted && chance(.2)) { c.looted = false; c.m.material = CRATE_MAT[c.kind]; c.m.scale.y = 1; c.m.position.y += .15; refilled++; }
  SFX.dawn();
  msg(`Dawn, day ${S.day}. The Skarn pull back. The storm uncovered ${refilled} crates.`, 'good');
  if (S.day === 6) msg('Tracker picks up deep tremors from the nest. One more night.', 'warn');
}
function spawnAround(type) {
  const p = S.player, toHive = Math.atan2(HIVE.z - p.z, HIVE.x - p.x);
  for (let tries = 0; tries < 20; tries++) {
    const a = chance(.6) ? toHive + rand(-1.1, 1.1) : rand(0, TAU), d = rand(42, 58);
    const x = clamp(p.x + Math.cos(a) * d, 6, WORLD - 6), z = clamp(p.z + Math.sin(a) * d, 6, WORLD - 6);
    if (!blocked(x, z, ED[type].r)) return spawn(type, x, z);
  }
}

// ---------- update ----------
function update(dt) {
  S.t += dt; S.phaseT += dt;
  if (S.phase === 'day' && S.phaseT >= DAY) startNight();
  else if (S.phase === 'night' && S.phaseT >= NIGHT) startDay();
  while (S.spawnQueue.length && S.spawnQueue[0].at <= S.phaseT) spawnAround(S.spawnQueue.shift().type);

  S.noise = Math.max(0, S.noise - (4 + S.noise * .1) * dt);
  if (S.phase === 'day') {
    S.wanderT -= dt;
    if (S.noise > 35 && S.wanderT <= 0) { spawnAround(S.day >= 3 && chance(.35) ? 'crawler' : 'drone'); S.wanderT = 5; tip('noise', 'Your noise is drawing Skarn out in daylight. Ease off the trigger.'); }
    if (S.day >= 2) { S.raidT -= dt; if (S.raidT <= 0) { S.raidT = rand(25, 40); const n = 1 + Math.floor(S.day / 3); for (let i = 0; i < n; i++) spawnAround(chance(.5) ? 'crawler' : 'drone'); } }
  }

  const p = S.player;
  let mx = 0, mz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) mz++;
  if (keys.has('KeyS') || keys.has('ArrowDown')) mz--;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) mx--;
  if (keys.has('KeyD') || keys.has('ArrowRight')) mx++;
  if (!locked && noLock) { if (keys.has('KeyJ')) p.yaw += 2 * dt; if (keys.has('KeyL')) p.yaw -= 2 * dt; }
  const f = fwd(), rt = { x: -f.z, z: f.x };
  let vx = f.x * mz + rt.x * mx, vz = f.z * mz + rt.z * mx; const l = Math.hypot(vx, vz);
  p.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const spd = p.spd * (p.sprint && mz > 0 ? 1.55 : 1);
  if (l > 0) { vx /= l; vz /= l; moveBody(p, vx * spd * dt, vz * spd * dt, p.r); p.bob += dt * spd * 1.6; p.moving = true; S.stepD = (S.stepD || 0) + spd * dt; if (S.stepD > (p.sprint ? 2.1 : 1.6)) { S.stepD = 0; SFX.step(p.sprint); } if (p.sprint) S.noise = Math.min(100, S.noise + 6 * dt); } else p.moving = false;
  p.cool -= dt; p.hurt = Math.max(0, p.hurt - dt);
  if (mouse.down && !S.buildMode && $('craft').hidden) fire();

  for (const s of S.structs.values()) {
    s.fl = Math.max(0, s.fl - dt);
    if (s.type !== 'turret') continue;
    s.cool -= dt; let best = null, bd = 18;
    for (const e of S.enemies) { if (e.state === 'sleep' || e.dying) continue; const d = d2(e, s); if (d < bd) { bd = d; best = e; } }
    if (best) {
      const want = Math.atan2(best.z - s.z, best.x - s.x); s.o.head.rotation.y = -want - s.o.g.rotation.y;
      if (s.cool <= 0) {
        s.cool = .3; SFX.turret(s.x, s.z); hurtEnemy(best, 13); S.noise = Math.min(100, S.noise + .4);
        const hy = H(s.x, s.z) + 1, a = new THREE.Vector3(s.x + Math.cos(want) * .9, hy, s.z + Math.sin(want) * .9);
        tracer(a, new THREE.Vector3(best.x, H(best.x, best.z) + ED[best.type].r, best.z), '#ffd27a'); fx('flash', a.x, a.y, a.z, { s: .6 });
      }
    }
  }

  updateEnemies(dt);
  updateSpits(dt);
  S.smokeT -= dt; if (S.smokeT <= 0 && crashSmokeAt[0]) { S.smokeT = .25; const q = crashSmokeAt[0]; fx('smoke', q.x + rand(-.5, .5), q.y + 1, q.z + rand(-.5, .5), { vy: rand(1, 1.8) }); if (chance(.5)) fx('flame', q.x + rand(-.4, .4), q.y + .2, q.z + rand(-.4, .4), { vy: 1.2, s: .7 }); }
  for (const d of decals) { if (d.t > 0) { d.t -= dt; d.m.material.opacity = clamp(d.t / 20, 0, .75); } }
  S.shake = Math.max(0, S.shake - dt * 2.5);
  S.recoil = Math.max(0, S.recoil - dt * 6);
  if (toastT > 0) toastT -= dt;
  if (S.won && !S.over && S.t - S.wonAt > 2.5) endGame(true);
}

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _mz = new THREE.Vector3();
function aimRay() { camera.getWorldPosition(_o); camera.getWorldDirection(_d); return { o: _o, d: _d }; }
function rayCast(o, d, maxD) {
  let best = null, bt = maxD;
  for (const e of S.enemies) {
    if (e.dying) continue;
    const s = ED[e.type].r, cx = e.x + Math.cos(e.a) * s * .4, cy = H(e.x, e.z) + s * .95, cz = e.z + Math.sin(e.a) * s * .4, R = s * 1.3;
    const lx = cx - o.x, ly = cy - o.y, lz = cz - o.z, tca = lx * d.x + ly * d.y + lz * d.z; if (tca < 0) continue;
    const dd = lx * lx + ly * ly + lz * lz - tca * tca; if (dd > R * R) continue;
    const t = tca - Math.sqrt(R * R - dd); if (t < bt) { bt = t; best = e; }
  }
  for (const k of rocks) {
    const lx = k.x - o.x, ly = k.y + k.r * .2 - o.y, lz = k.z - o.z, tca = lx * d.x + ly * d.y + lz * d.z; if (tca < 0 || tca - k.r > bt) continue;
    const dd = lx * lx + ly * ly + lz * lz - tca * tca, R = k.r * .85; if (dd > R * R) continue;
    const t = tca - Math.sqrt(R * R - dd); if (t < bt) { bt = t; best = null; }
  }
  for (let t = .5; t < bt; t += .6) { const x = o.x + d.x * t, z = o.z + d.z * t; if (o.y + d.y * t < H(x, z)) { bt = t; best = null; break; } }
  return { e: best, t: bt };
}
function fire() {
  const p = S.player, wid = S.weapons[S.wi], w = WEAPONS[wid];
  if (p.cool > 0) return;
  if (w.ammo && S.inv.ammo < w.ammo) { p.cool = .4; SFX.empty(); toast('Out of ammo'); tip('ammo', 'Craft ammo packs at the workbench. The sidearm never runs dry.'); return; }
  p.cool = w.rate; S.inv.ammo -= w.ammo; S.noise = Math.min(100, S.noise + w.noise);
  const g = VMS[wid]; _mz.copy(g.muzzle); g.localToWorld(_mz);
  const { o, d } = aimRay();
  if (wid === 'flamer') {
    S.flameSnd = (S.flameSnd || 0) - w.rate; if (S.flameSnd <= 0) { S.flameSnd = .12; SFX.flame(); }
    for (let i = 0; i < 2; i++) fx('flame', _mz.x, _mz.y, _mz.z, { vx: d.x * 13 + rand(-1.5, 1.5), vy: d.y * 13 + rand(-.5, 1.5), vz: d.z * 13 + rand(-1.5, 1.5) });
    for (const e of S.enemies) {
      if (e.dying) continue; const dx = e.x - p.x, dz = e.z - p.z, dist = Math.hypot(dx, dz);
      if (dist < 9 + ED[e.type].r && (dx * d.x + dz * d.z) / (dist * Math.hypot(d.x, d.z) || 1) > .9) hurtEnemy(e, 75 * w.rate, true);
    }
    S.muzzle = .06; return;
  }
  const dir = d.clone();
  if (wid === 'smart') {
    let best = null, bd = 30;
    for (const e of S.enemies) { if (e.dying || (e.state === 'sleep' && d2(e, p) > 20)) continue; const dx = e.x - o.x, dy = H(e.x, e.z) + ED[e.type].r - o.y, dz = e.z - o.z, dist = Math.hypot(dx, dy, dz); if (dist < bd && (dx * d.x + dy * d.y + dz * d.z) / dist > .93) { bd = dist; best = { dx, dy, dz, dist }; } }
    if (best) dir.set(best.dx / best.dist, best.dy / best.dist, best.dz / best.dist);
  }
  dir.x += rand(-w.spread, w.spread); dir.y += rand(-w.spread, w.spread); dir.z += rand(-w.spread, w.spread); dir.normalize();
  const hit = rayCast(o, dir, 140), end = o.clone().addScaledVector(dir, hit.t);
  tracer(_mz, end, wid === 'pistol' ? '#fff2c4' : '#bfeaff'); SFX.shot(wid);
  fx('flash', _mz.x, _mz.y, _mz.z, { s: wid === 'pistol' ? .5 : .7 });
  if (hit.e) { SFX.hit(hit.e.x, hit.e.z); hurtEnemy(hit.e, w.dmg); for (let i = 0; i < 3; i++) fx('acid', end.x, end.y, end.z, { vx: rand(-2, 2), vy: rand(0, 3), vz: rand(-2, 2) }); }
  else if (hit.t < 140) { fx('spark', end.x, end.y, end.z, { vy: 2 }); fx('dust', end.x, end.y, end.z, { s: .5 }); }
  S.muzzle = .05; S.recoil = Math.min(1, S.recoil + .4); p.pitch = clamp(p.pitch + w.kick, -1.45, 1.45);
}
function hurtEnemy(e, dmg, ignoreArmor) {
  if (e.hp <= 0) return;
  const d = ignoreArmor ? dmg : Math.max(1, dmg - ED[e.type].armor);
  e.hp -= d; e.flash = .06;
  if (e.state === 'sleep') wakeNest();
  if (e.hp <= 0) killEnemy(e);
}
function wakeNest() {
  let woke = false;
  for (const e of S.enemies) if (e.state === 'sleep') { if (e.type === 'brood' && d2(e, S.player) > 34) continue; e.state = 'hunt'; woke = true; }
  if (woke) { tip('nest', 'The nest is awake.'); SFX.roar(HIVE.x, HIVE.z); }
}
function killEnemy(e) {
  const s = ED[e.type].r, y = H(e.x, e.z);
  SFX.die(e.x, e.z, VOICE[e.type]);
  S.kills++; e.dying = 4; e.rollDir = chance(.5) ? 1 : -1;
  for (let i = 0; i < 10 + s * 6; i++) fx('acid', e.x + rand(-s, s), y + s, e.z + rand(-s, s), { vx: rand(-3, 3), vy: rand(1, 5), vz: rand(-3, 3), s: 1 + s * .4 });
  splat(e.x, e.z, s * 1.6); for (let i = 0; i < 3; i++) fx('smoke', e.x + rand(-s, s), y + .5, e.z + rand(-s, s), { s: .5 + s * .3, t: 2.5 });
  if (d2(e, S.player) < 30) S.shake = Math.max(S.shake, e.type === 'brood' ? 1.2 : s * .3);
  const drop = (k, n) => { S.inv[k] += n; toast(`+${n} ${k}`); };
  if (e.type === 'drone' && chance(.15)) drop('scrap', 1);
  if (e.type === 'spitter' && chance(.3)) drop('cells', 1);
  if (e.type === 'warrior' && chance(.5)) { drop('cores', 1); tip('cores', 'Skarn cores. Hive analysis needs them.'); }
  if (e.type === 'warden') drop('cores', 2);
  if (e.type === 'brood') { drop('cores', 5); S.won = true; S.wonAt = S.t; msg('The Broodmother is dead. The nest is collapsing.', 'good'); }
}
function updateEnemies(dt) {
  const p = S.player;
  for (const e of S.enemies) {
    const d = ED[e.type], g = e.m.g, near = d2(e, p) < 90;
    if (e.dying) {
      e.dying -= dt; const k = 1 - e.dying / 4;
      g.rotation.x = e.rollDir * Math.min(1, k * 5) * 1.4; g.position.y = H(e.x, e.z) - Math.max(0, k - .5) * d.r * 2.4;
      e.m.mat.color.lerp(col('#0a0b0c'), dt * .5);
      if (e.dying <= 0) { scene.remove(g); e.gone = true; }
      animSkarn(e); continue;
    }
    e.flash = Math.max(0, e.flash - dt); e.cd -= dt; e.atk = Math.max(0, e.atk - dt);
    if (e.state === 'hunt') {
      e.vT = (e.vT ?? rand(1, 6)) - dt; if (e.vT <= 0) { e.vT = rand(4, 9); const dv = d2(e, p); if (dv < 60) (dv < 14 ? SFX.hiss : SFX.screech)(e.x, e.z, VOICE[e.type]); }
      e.skT = (e.skT ?? 0) - dt; if (e.skT <= 0) { e.skT = .35; SFX.skitter(e.x, e.z); }
    }
    e.m.mat.emissive.setScalar(e.flash > 0 ? .6 : 0);
    if (e.state === 'sleep') { e.anim += dt * .4; if (d2(e, p) < 26) wakeNest(); if (near) animSkarn(e); continue; }
    let tx = p.x, tz = p.z, spd = d.spd;
    if (e.state === 'flee') { tx = HIVE.x; tz = HIVE.z; spd *= 1.2; if (d2(e, p) > 60) { e.gone = true; scene.remove(g); continue; } }
    else {
      let tgt = null, td = Math.min(d2(e, p), 12);
      for (const s of S.structs.values()) if (s.type === 'turret' || s.type === 'light') { const sd = d2(e, s); if (sd < td) { td = sd; tgt = s; } }
      if (tgt) { tx = tgt.x; tz = tgt.z; }
      if (e.type === 'brood' && d2(e, p) < 45) { e.spawnT -= dt; if (e.spawnT <= 0) { e.spawnT = 4; for (let i = 0; i < 3; i++) spawn('crawler', e.x + rand(-2, 2), e.z + rand(-2, 2)); } }
    }
    const dx = tx - e.x, dz = tz - e.z, dd = Math.hypot(dx, dz) || 1;
    let da = Math.atan2(dz, dx) - e.a; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU; e.a += da * Math.min(1, dt * 7);
    const dp = d2(e, p);
    if (e.type === 'spitter' && e.state === 'hunt' && dp < d.range) {
      if (e.cd <= 0) { e.cd = d.cd; e.atk = .25; spit(e); }
      e.anim += dt * 2;
    } else if (e.state === 'hunt' && dp < d.r + p.r + .7) {
      if (e.cd <= 0) { e.cd = d.cd; e.atk = .25; SFX.claw(e.x, e.z); hurtPlayer(d.dmg); }
      e.anim += dt * 3;
    } else {
      const step = spd * dt, moved = moveBody(e, dx / dd * step, dz / dd * step, d.r);
      e.anim += dt * spd / (d.r * 1.6);
      const ahead = structsNear(e.x + dx / dd * (d.r + .5), e.z + dz / dd * (d.r + .5), .3)[0];
      if (ahead && e.state === 'hunt') {
        if (e.cd <= 0) { e.cd = d.cd; e.atk = .25; SFX.claw(ahead.x, ahead.z); ahead.hp -= d.dmg; fx('dust', ahead.x, H(ahead.x, ahead.z) + 1, ahead.z, {}); if (ahead.hp <= 0) destroyStruct(ahead, true); }
      } else if (!moved) moveBody(e, -dz / dd * step, dx / dd * step, d.r);
    }
    placeEnemy(e); if (near) animSkarn(e);
  }
  const es = S.enemies;
  for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
    const a = es[i], b = es[j]; if (a.dying || b.dying) continue; const ra = ED[a.type].r, rb = ED[b.type].r;
    const dx = b.x - a.x, dz = b.z - a.z; if (Math.abs(dx) > ra + rb || Math.abs(dz) > ra + rb) continue;
    const dd = Math.hypot(dx, dz) || .01, ov = ra + rb - dd; if (ov <= 0) continue;
    const ux = dx / dd * ov * .5, uz = dz / dd * ov * .5;
    if (a.type !== 'brood' && !blocked(a.x - ux, a.z - uz, ra)) { a.x -= ux; a.z -= uz; }
    if (b.type !== 'brood' && !blocked(b.x + ux, b.z + uz, rb)) { b.x += ux; b.z += uz; }
  }
  S.enemies = es.filter(e => !e.gone);
}
const spitGeo = new THREE.SphereGeometry(.14, 8, 6), spitMat = new THREE.MeshBasicMaterial({ color: col('#c4ec52') });
function spit(e) {
  const p = S.player, s = ED[e.type].r, y = H(e.x, e.z) + s * 1.2, ty = eyeY() - .4;
  const dx = p.x - e.x, dy = ty - y, dz = p.z - e.z, dist = Math.hypot(dx, dy, dz), v = 19;
  const m = new THREE.Mesh(spitGeo, spitMat); m.position.set(e.x, y, e.z); scene.add(m);
  SFX.spit(e.x, e.z);
  S.spits.push({ m, vx: dx / dist * v, vy: dy / dist * v + 2.5, vz: dz / dist * v, t: 2 });
}
function updateSpits(dt) {
  const p = S.player, py = eyeY() - .5;
  for (const b of S.spits) {
    b.vy -= 4 * dt; b.m.position.x += b.vx * dt; b.m.position.y += b.vy * dt; b.m.position.z += b.vz * dt; b.t -= dt;
    const q = b.m.position; if (chance(.5)) fx('spit', q.x, q.y, q.z, { s: .6 });
    if (Math.hypot(q.x - p.x, q.y - py, q.z - p.z) < .8) { SFX.splash(); hurtPlayer(12); b.t = 0; }
    const s = structsNear(q.x, q.z, .1)[0]; if (s && q.y < H(q.x, q.z) + 2.6) { s.hp -= 12; b.t = 0; if (s.hp <= 0) destroyStruct(s, true); }
    if (q.y < H(q.x, q.z)) { b.t = 0; splat(q.x, q.z, .6); }
    if (b.t <= 0) scene.remove(b.m);
  }
  S.spits = S.spits.filter(b => b.t > 0);
}
function hurtPlayer(dmg) {
  const p = S.player; if (S.over || S.won) return;
  SFX.hurt(); p.hp -= dmg; p.hurt = .3; S.shake = Math.max(S.shake, .5);
  $('flash').style.opacity = '1'; setTimeout(() => $('flash').style.opacity = '0', 120);
  if (p.hp <= 0) { p.hp = 0; endGame(false); }
}
function endGame(won) {
  S.over = true; mouse.down = false; toggleCraft(false); if (locked) document.exitPointerLock();
  $('endEyebrow').textContent = won ? 'Nest cleared' : 'Signal lost';
  $('endTitle').textContent = won ? 'Hive Breaker' : 'KIA';
  $('endText').textContent = won
    ? 'The Broodmother is down and the nest is burning. A rescue beacon goes up from the crash site. In the full game, this is where your squad pushes on to the next hive.'
    : 'Your beacon goes quiet. Range out early for metal and cells, keep the noise down by day, and have walls and lights up before night 2.';
  $('endStats').textContent = `Day ${S.day} · ${S.kills} Skarn killed · Tier ${S.tier}`;
  $('ovEnd').hidden = false;
}

// ---------- environment per frame ----------
function darkness() {
  if (S.phase === 'night') return 1;
  const left = DAY - S.phaseT;
  if (left < 14) return 1 - left / 14;
  if (S.phaseT < 6 && S.day > 1) return 1 - S.phaseT / 6;
  return 0;
}
const C_DAY = col('#8792a0'), C_NIGHT = col('#04070c'), C_DUSK = col('#9a6a4a'), _c = new THREE.Color();
function environment(dt) {
  const p = S.player, dk = darkness(), day = 1 - dk, left = DAY - S.phaseT;
  const duskK = S.phase === 'day' ? clamp(1 - left / 22, 0, 1) * (1 - dk) : 0;
  _c.copy(C_DAY).lerp(C_DUSK, duskK * .8).lerp(C_NIGHT, dk);
  scene.fog.color.copy(_c); scene.background.copy(_c);
  scene.fog.density = lerp(.013, .03, dk);
  const sa = S.phase === 'day' ? (S.phaseT / DAY) * Math.PI * .9 + .15 : Math.PI;
  sun.position.set(p.x + Math.cos(sa) * 90, Math.max(8, Math.sin(sa) * 110), p.z - 50); sun.target.position.set(p.x, 0, p.z);
  sun.intensity = 1.7 * day * LUX; sun.color.set(col('#fff1dc')).lerp(col('#ffa060'), duskK);
  hemi.intensity = (.12 + .62 * day) * LUX; hemi.color.set(col('#b9c6d2')).lerp(col('#2a3a5a'), dk);
  renderer.toneMappingExposure = lerp(1.05, 1.5, dk);
  flashlight.intensity = S.flashOn ? lerp(.6, 2.6, dk) * PLUX : 0;
  muzzleLight.intensity = S.muzzle > 0 ? 3 * PLUX : 0; muzzleLight.color.set(S.weapons[S.wi] === 'flamer' ? col('#ff8a32') : col('#ffd8a0'));
  S.muzzle = Math.max(0, S.muzzle - dt);
  fireLight.intensity = (1.4 + Math.sin(S.t * 13) * .3 + Math.sin(S.t * 7.3) * .3) * (.3 + dk) * PLUX;
  M.red.emissiveIntensity = (S.t % 1.2) < .2 ? 3 : 0;
  M.lamp.emissiveIntensity = .4 + dk * 2;
  const lights = [...S.structs.values()].filter(s => s.type === 'light').sort((a, b) => d2(a, p) - d2(b, p));
  floodLights.forEach((l, i) => { const s = lights[i]; if (s) { l.position.set(s.x, H(s.x, s.z) + 3.3, s.z); l.intensity = (.3 + dk * 2.2) * PLUX; } else l.intensity = 0; });
  stars.material.opacity = dk; stars.position.copy(camera.position);
  planet.position.set(camera.position.x + 210, camera.position.y + 150, camera.position.z - 260); planet.material.opacity = lerp(.35, 1, dk);
  // snow drifts with the wind and wraps around the player
  const sp = snowPts.geometry.attributes.position, arr = sp.array, ex = p.x, ez = p.z, ey = eyeY();
  for (let i = 0; i < arr.length; i += 3) {
    arr[i] += (WIND.x * 2.2) * dt; arr[i + 1] -= 1.1 * dt; arr[i + 2] += (WIND.z * 2.2) * dt;
    if (arr[i] < ex - 30) arr[i] += 60; else if (arr[i] > ex + 30) arr[i] -= 60;
    if (arr[i + 2] < ez - 30) arr[i + 2] += 60; else if (arr[i + 2] > ez + 30) arr[i + 2] -= 60;
    if (arr[i + 1] < ey - 4) arr[i + 1] += 18; else if (arr[i + 1] > ey + 14) arr[i + 1] -= 18;
  }
  sp.needsUpdate = true;
}
function updateCamera(dt) {
  const p = S.player, bobA = p.moving ? (p.sprint ? .07 : .04) : 0;
  const sx = S.shake ? rand(-1, 1) * S.shake * .08 : 0, sy = S.shake ? rand(-1, 1) * S.shake * .08 : 0;
  camera.position.set(p.x + sx, eyeY() + Math.abs(Math.sin(p.bob)) * bobA + sy, p.z);
  camera.rotation.set(p.pitch + S.recoil * .02, p.yaw, 0);
  const wid = S.weapons[S.wi];
  for (const k in VMS) VMS[k].visible = k === wid && !S.buildMode;
  vm.position.set(.24 + Math.sin(p.bob * .5) * bobA * .3, -.24 - Math.abs(Math.sin(p.bob)) * bobA * .3, -.42 + S.recoil * .06);
  vm.rotation.x = S.recoil * .12;
  if (S.muzzle > 0 && wid !== 'flamer') { _mz.copy(VMS[wid].muzzle); muzzleLight.position.copy(_mz).add(vm.position); }
  // build ghost
  if (S.buildMode) {
    const b = BUILDS[S.buildSel];
    if (S.ghostType !== b.id) { if (S.ghost) scene.remove(S.ghost.g); S.ghost = buildStruct(b.id, true); S.ghostType = b.id; scene.add(S.ghost.g); }
    const c = placeCheck(); S.ghost.g.visible = true;
    S.ghost.g.position.set(c.cx, H(c.cx, c.cz) + .02, c.cz); S.ghost.g.rotation.y = Math.round(p.yaw / (Math.PI / 2)) * Math.PI / 2;
    S.ghost.gm.color.set(c.why ? 0xe4473a : 0xf0b13c);
    S.ghostWhy = c.why || b.name;
  } else if (S.ghost) S.ghost.g.visible = false;
}

// ---------- HUD ----------
function drawRadar() {
  if (!S.gear.tracker) return;
  const W = rc.width, c = W / 2, R = W / 2 - 6, range = 50, p = S.player, heading = -p.yaw;
  rctx.clearRect(0, 0, W, W);
  rctx.fillStyle = 'rgba(30,22,6,.9)'; rctx.beginPath(); rctx.arc(c, c, R, 0, TAU); rctx.fill();
  rctx.strokeStyle = 'rgba(240,177,60,.3)'; rctx.lineWidth = 2;
  for (const f of [1, .66, .33]) { rctx.beginPath(); rctx.arc(c, c, R * f, 0, TAU); rctx.stroke(); }
  const sweep = (S.t * 3) % 1;
  rctx.strokeStyle = `rgba(240,177,60,${.5 * (1 - sweep)})`; rctx.beginPath(); rctx.arc(c, c, R * sweep, 0, TAU); rctx.stroke();
  for (const e of S.enemies) {
    if (e.state === 'sleep' || e.dying) continue;
    const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz); if (d > range) continue;
    const rel = Math.atan2(dx, -dz) - heading;
    rctx.fillStyle = 'rgba(255,200,90,.95)'; rctx.beginPath(); rctx.arc(c + Math.sin(rel) * d / range * R, c - Math.cos(rel) * d / range * R, e.type === 'brood' ? 9 : ED[e.type].r > .9 ? 6 : 4, 0, TAU); rctx.fill();
  }
  rctx.fillStyle = '#f0b13c'; rctx.beginPath(); rctx.moveTo(c, c - 7); rctx.lineTo(c - 5, c + 5); rctx.lineTo(c + 5, c + 5); rctx.closePath(); rctx.fill();
}
function drawCompass() {
  const W = cc.width, Hh = cc.height, p = S.player, heading = -p.yaw, span = 1.3;
  cctx.clearRect(0, 0, W, Hh);
  const X = b => { let rel = b - heading; while (rel > Math.PI) rel -= TAU; while (rel < -Math.PI) rel += TAU; return Math.abs(rel) < span ? W / 2 + rel / span * W / 2 : null; };
  cctx.font = '22px "Share Tech Mono", monospace'; cctx.textAlign = 'center';
  for (let i = 0; i < 24; i++) { const b = i / 24 * TAU, x = X(b); if (x === null) continue; const card = ['N', 'E', 'S', 'W'][i / 6]; cctx.fillStyle = card ? '#d9e4dd' : 'rgba(217,228,221,.4)'; if (card && i % 6 === 0) cctx.fillText(card, x, 36); else cctx.fillRect(x - 1, 12, 2, 14); }
  const bx = X(Math.atan2(BENCH.x - p.x, -(BENCH.z - p.z))), bd = d2(p, BENCH);
  if (bx !== null && bd > 8) { cctx.fillStyle = '#f0b13c'; cctx.beginPath(); cctx.moveTo(bx, 50); cctx.lineTo(bx - 8, 40); cctx.lineTo(bx + 8, 40); cctx.fill(); cctx.font = '18px "Share Tech Mono", monospace'; cctx.fillText(`BASE ${Math.round(bd)}m`, bx, 22); }
  cctx.fillStyle = 'rgba(240,177,60,.9)'; cctx.fillRect(W / 2 - 1, 0, 2, 8);
}
function location() {
  const p = S.player;
  if (d2(p, BASE) < 30) return 'CRASH SITE';
  if (d2(p, HIVE) < 45) return 'SKARN NEST';
  for (const d of DOMES) if (d2(p, d) < 16) return d.n;
  for (const d of RIGS) if (d2(p, d) < 13) return 'MINING RIG';
  return '';
}
let hudT = 0;
function hud() {
  const p = S.player;
  $('dayLbl').textContent = (S.phase === 'night' ? 'NIGHT ' : 'DAY ') + S.day;
  const left = Math.max(0, Math.ceil((S.phase === 'day' ? DAY : NIGHT) - S.phaseT));
  $('clockLbl').textContent = (S.phase === 'day' ? 'Night in ' : 'Dawn in ') + `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  $('clockBar').firstChild.style.width = (100 * S.phaseT / (S.phase === 'day' ? DAY : NIGHT)) + '%';
  $('hpTxt').textContent = `${Math.ceil(p.hp)}/${p.max}`;
  $('hpBar').firstChild.style.width = (100 * p.hp / p.max) + '%';
  $('noiseBar').firstChild.style.width = S.noise + '%';
  $('noiseTxt').textContent = S.noise > 35 ? 'heard' : S.noise > 18 ? 'loud' : 'quiet';
  for (const k of RES) $('r_' + k).textContent = S.inv[k];
  const wid = S.weapons[S.wi], w = WEAPONS[wid];
  if (S.buildMode) { const b = BUILDS[S.buildSel]; $('modeLbl').textContent = 'Building'; $('weapLbl').textContent = b.name.toUpperCase(); $('ammoTxt').innerHTML = costStr(b.cost); }
  else { $('modeLbl').textContent = 'Weapon'; $('weapLbl').textContent = w.name.toUpperCase(); $('ammoTxt').textContent = w.ammo ? `Ammo ${Math.floor(S.inv.ammo)}` : 'Ammo ∞'; }
  $('medTxt').textContent = `Medkits ${S.inv.med}`;
  $('tierLbl').textContent = `Tier ${S.tier} · ${TIER_NAMES[S.tier]}`;
  $('locLbl').textContent = location();
  if (toastT <= 0) {
    let h = '';
    if (S.buildMode) h = `${S.ghostWhy || ''}  ·  <kbd>Click</kbd>Place <kbd>R-click</kbd>Remove <kbd>B</kbd>Exit`;
    else if (nearestCrate()) h = '<kbd>E</kbd>Search crate';
    else if (atBench() && $('craft').hidden) h = '<kbd>C</kbd>Open workbench';
    else if (p.hp < p.max * .4 && S.inv.med) h = '<kbd>H</kbd>Use medkit';
    $('hint').innerHTML = h;
  }
  renderCraft();
}

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (S) {
    if (running && !paused && !S.over) update(dt);
    if (!paused) { environment(dt); stepSprites(dt); for (const tr of tracers) if (tr.t > 0) { tr.t -= dt; if (tr.t <= 0) tr.l.visible = false; } }
    if (!running) { S.player.yaw += dt * .05; }
    updateCamera(dt);
    renderer.render(scene, camera);
    if (running && !paused) { SFX.ambience(darkness(), dt); trackerAudio(dt); }
    if (running) { drawRadar(); drawCompass(); hudT -= dt; if (hudT <= 0) { hudT = .1; hud(); } }
  }
  requestAnimationFrame(frame);
}
function start() {
  SFX.init(); SFX.pause(false);
  newGame(); running = true; paused = false;
  $('ovStart').hidden = true; $('ovEnd').hidden = true; $('ovPause').hidden = true; $('radarBox').hidden = true; $('craft').hidden = true;
  lockMouse();
}
$('btnStart').addEventListener('click', start);
$('btnAgain').addEventListener('click', start);
$('btnResume').addEventListener('click', () => { SFX.init(); togglePause(false); lockMouse(); });
// the motion tracker's beep: faster and higher as the nearest contact closes in
function trackerAudio(dt) {
  if (!S.gear.tracker || S.over) return;
  S.pingT = (S.pingT || 0) - dt; if (S.pingT > 0) return;
  let nd = 50; for (const e of S.enemies) if (e.state !== 'sleep' && !e.dying) nd = Math.min(nd, d2(e, S.player));
  if (nd < 50) { const k = 1 - nd / 50; SFX.ping(k); S.pingT = lerp(1.2, .22, k); } else { SFX.sweep(); S.pingT = 1.6; }
}

resize(); buildWorld(); initSprites(); initTracers(); buildViewmodels(); newGame();
$('btnStart').disabled = false; $('btnStart').textContent = 'Deploy';
requestAnimationFrame(frame);

// Dev-only handle for automated playtests (stripped from production builds).
if (import.meta.env.DEV) Object.assign(window, { __S: () => S, __api: { craftItem, startNight, hurtEnemy, spawn, placeStruct, camera, SFX } });
