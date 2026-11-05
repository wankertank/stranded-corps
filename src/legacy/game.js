import * as THREE from 'three';
import { createPostFX } from '../render/postfx';
import { untonemap, usePerceptualFog, displaySpaceAlpha } from '../render/tonemap';
import { loadPBR, loadEnvironment, triplanar, terrainMaterial } from '../render/materials';
import { loft, plate, latheX } from '../render/shapes';
import { skinSet, skarnGeometry } from '../render/skarn';
import { loadModels, placeModel, setDarkened, setMaterial, tinted } from '../render/models';
import { weaponMaterials, buildViewmodels as buildGunViewmodels } from '../render/viewmodels';
import { WORLD, BOUND, GRID_N, POIS, poi, H, slope, edgeDist, buildTerrain, fbm, NZ } from '../world/terrain';
import { Buckets } from '../world/spatial';
import { buildPOIs } from './pois';
import { buildRigTemplate, instanceRig, animateRig } from '../render/rigged';

usePerceptualFog();

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
// The map is about a kilometre of playable ground inside a ring of mountains (src/world/terrain.ts).
// Days run longer than on the old 280 m map so there is time to travel out and back before dark.
const GRID = 2, DAY = 210, NIGHT = 70;
buildTerrain();
const BASE = poi('base'), BENCH = { x: BASE.x + 6, z: BASE.z + 5 }, HIVE = poi('hive');
const DOMES = POIS.filter(q => q.kind === 'dome').map(q => ({ x: q.x, z: q.z, n: q.name }));
const RIGS = POIS.filter(q => q.kind === 'rig');
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
  // mag: rounds (or fuel units) per magazine, like the genre's classics: a 12-round sidearm, the 99-round
  // pulse rifle, a 100-unit flamer tank and the smart gun's 500-round drum. reload: seconds.
  pistol: { name: 'M9 Sidearm', rate: .3, dmg: 11, spread: .012, ammo: 0, noise: 2, kick: .012, mag: 12, reload: 1.5 },
  pulse:  { name: 'Pulse Rifle', rate: .09, dmg: 13, spread: .02, ammo: 1, noise: 1.6, kick: .006, mag: 99, reload: 2.4 },
  flamer: { name: 'Flamethrower', rate: .03, dmg: 0, spread: 0, ammo: .3, noise: .45, kick: 0, mag: 100, reload: 3 },
  smart:  { name: 'Smart Gun', rate: .07, dmg: 17, spread: .008, ammo: 1, noise: 1.1, kick: .004, mag: 500, reload: 4 },
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

// ---------- three setup ----------
// No canvas MSAA: the post-processing chain renders into a multisampled target instead.
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, powerPreference: 'high-performance' });
// Graphics quality: high adds ambient occlusion and full-res bloom. G toggles it; the choice is remembered.
let quality = 'high';
try { if (localStorage.getItem('sc.quality') === 'low' || new URLSearchParams(location.search).get('q') === 'low') quality = 'low'; } catch (_) { /* storage blocked */ }
const pixelRatio = () => Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.5 : 1);
renderer.setPixelRatio(pixelRatio());
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(col('#7f8b94'), .0062);
scene.background = scene.fog.color.clone();
const camera = new THREE.PerspectiveCamera(74, 1, .08, 800);
camera.rotation.order = 'YXZ';
const post = createPostFX(renderer, scene, camera, quality);
scene.add(camera);
function resize() { const w = cv.clientWidth, h = cv.clientHeight; renderer.setPixelRatio(pixelRatio()); renderer.setSize(w, h, false); post.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
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

// CC0 PBR sets from Poly Haven (see CREDITS.md) and an overcast HDRI for image-based lighting.
const [TX_GROUND, TX_SNOW, TX_ROCK, TX_METAL, TX_CONCRETE, TX_HULL, ENV, MODELS] = await Promise.all([
  ...['ground', 'snow', 'rock', 'metal', 'concrete', 'hull'].map(n => loadPBR(renderer, n)),
  loadEnvironment(renderer, 'overcast_1k.hdr'),
  loadModels(renderer),
]);
scene.environment = ENV;

// ---------- textures ----------
function canvasTex(w, h, fn, srgb = true) { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; }
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
};
const CRATE_MAT = { hive: new THREE.MeshStandardMaterial({ color: col('#3a4529'), roughness: .5 }) };
// Texture the shared materials. Each keeps its tuned color as a tint over the scanned surface.
triplanar(M.rock, TX_ROCK, { scale: .35, normalStrength: 1.4 });
triplanar(M.burnt, TX_ROCK, { scale: .5 });
for (const m of [M.metal, M.darkMetal, M.hull, M.deck]) triplanar(m, TX_METAL, { scale: .45, useMetal: .6 });
triplanar(M.gun, TX_METAL, { scale: 6, normalStrength: .5, useMetal: .4 });
triplanar(M.concrete, TX_CONCRETE, { scale: .3 });
triplanar(M.sand, TX_GROUND, { scale: .4 });
// a placed CC0 model, sitting on its footprint at (x, y, z)
function prop(name, x, y, z, opts = {}, parent = scene, ry = 0) {
  const g = placeModel(typeof name === 'string' ? MODELS[name] : name, opts); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g); return g;
}
function mesh(geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, parent = scene, shadow = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m;
}

// ---------- static world ----------
let terrainMesh, stars, planet, snowPts, rocks = [];
// collision: boulders and building footprints, bucketed by position
const rockGrid = new Buckets(16), solidGrid = new Buckets(16), solids = [];
function addRock(k) { rocks.push(k); rockGrid.insert(k, k.x, k.z, k.r); }
/** A solid oriented box footprint, w by d metres turned by ry, `top` metres above the ground. */
function addSolid(x, z, w, d, ry, top) { const s = { x, z, hw: w / 2, hd: d / 2, c: Math.cos(ry), s: Math.sin(ry), top: H(x, z) + top }; solids.push(s); solidGrid.insert(s, x, z, Math.hypot(w, d) / 2); }
// set by the point-of-interest builders, used by newGame and the update loop
const LOOT_SPOTS = [], SLEEPERS = [], VENTS = [], CULL = [];
const POI_MAT = (() => {
  const paint = (c, rough = .7, metal = .4, set = TX_HULL, scale = .45) => triplanar(new THREE.MeshStandardMaterial({ color: col(c), roughness: rough, metalness: metal }), set, { scale, useMetal: .5 });
  const glow = (c, e, k) => new THREE.MeshStandardMaterial({ color: col(c), emissive: col(e), emissiveIntensity: k, roughness: .4 });
  const padTex = canvasTex(512, 256, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(220,214,190,.8)'; g.font = 'bold 190px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('K-1', w / 2, h / 2 + 10); });
  return {
    panel: paint('#6e7266', .78, .35, TX_HULL, .2), trim: paint('#4c5148', .7, .45), roof: paint('#3a3d38', .8, .4),
    window: new THREE.MeshStandardMaterial({ color: col('#11181c'), roughness: .15, metalness: .5 }), windowLit: glow('#3a3220', '#ffc874', 1.6), lampOff: glow('#2a2a26', '#ffe6a8', .05),
    paint: new THREE.MeshStandardMaterial({ color: col('#c9c2a6'), roughness: .8, polygonOffset: true, polygonOffsetFactor: -2 }),
    padText: new THREE.MeshStandardMaterial({ map: padTex, transparent: true, roughness: .8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
    glassDark: new THREE.MeshStandardMaterial({ color: col('#0d161b'), roughness: .08, metalness: .6 }), glass: M.glass,
    tankGlow: glow('#1f3b12', '#8dff52', 2.2), hazard: M.hazard, fence: new THREE.MeshStandardMaterial({ color: col('#555b5c'), roughness: .6, metalness: .7, transparent: true, opacity: .55, depthWrite: false }),
    cOrange: paint('#9a4a22'), cBlue: paint('#2f4f6e'), cOlive: paint('#4a5338'), cGrey: paint('#6a6e6e'), cRed: paint('#6e2a24'),
    crystal: glow('#123a44', '#52e4ff', 2.4), tent: new THREE.MeshStandardMaterial({ color: col('#8a6a3a'), roughness: .95 }),
    ice: new THREE.MeshPhysicalMaterial({ color: col('#9fc4d6'), roughness: .12, metalness: 0, clearcoat: 1, clearcoatRoughness: .08, transparent: true, opacity: .92 }),
  };
})();
function buildWorld() {
  const seg = GRID_N, geo = new THREE.PlaneGeometry(WORLD, WORLD, seg, seg); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3), snows = new Float32Array(pos.count);
  const nests = POIS.filter(q => q.kind === 'hive' || q.kind === 'pocket');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + WORLD / 2, z = pos.getZ(i) + WORLD / 2, h = H(x, z), sl = slope(x, z); pos.setY(i, h);
    // snow settles on flat ground and high up; steep faces show dark rock
    const v = fbm(NZ[2], x / 22, z / 22, 4), steep = clamp((sl - .55) * 1.8, 0, 1);
    const snowK = (clamp((v - .55) * 4, 0, 1) * .8 + clamp((h - 14) / 24, 0, 1) * .7) * (1 - steep), dk = clamp((.45 - v) * 4, 0, 1) * .45 + steep * .4;
    let nest = 0; for (const q of nests) nest = Math.max(nest, 1 - smooth(q.kind === 'hive' ? 25 : 10, q.kind === 'hive' ? 80 : 30, Math.hypot(x - q.x, z - q.z)));
    const c = lerp(.82, .4, clamp(dk, 0, 1));
    snows[i] = clamp(snowK, 0, 1) * (1 - nest);
    cols[i * 3] = lerp(c, .22, nest); cols[i * 3 + 1] = lerp(c, .3, nest); cols[i * 3 + 2] = lerp(c, .25, nest);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3)); geo.setAttribute('snow', new THREE.BufferAttribute(snows, 1)); geo.computeVertexNormals();
  terrainMesh = new THREE.Mesh(geo, terrainMaterial(TX_GROUND, TX_SNOW, 1 / 3.5, .18));
  terrainMesh.position.set(WORLD / 2, 0, WORLD / 2); terrainMesh.receiveShadow = true; scene.add(terrainMesh);

  // Photoscanned moon rocks, darkened to Veyra's basalt and drawn as instances in 160 m cells
  // (one draw call per rock model per cell, and whole cells drop out with distance).
  const r = mulberry(7), ROCKS = [1, 2, 3, 4, 5, 6, 7].map(i => tinted(MODELS[`moon_rock_0${i}`], col('#55585b')));
  const CELLR = 160, batches = new Map(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const clearOf = (x, z, pad) => d2({ x, z }, BASE) > 22 + pad && !POIS.some(q => q.kind !== 'crater' && q.kind !== 'lake' ? Math.hypot(x - q.x, z - q.z) < q.r2 * .85 + pad : Math.hypot(x - q.x, z - q.z) < q.r * .9);
  const place = (i, x, z, rad) => {
    const y = H(x, z), a = ROCKS[i % 7], k = rad * 2.1 / Math.max(a.size.x, a.size.z), sy = .7 + r() * .5, sz = .8 + r() * .4;
    _m.compose(_p.set(x, y - rad * .2, z), _q.setFromAxisAngle(up, r() * TAU), _s.set(k, rad * 1.5 * sy / a.size.y, k * sz));
    const key = `${i % 7}:${Math.floor(x / CELLR)}:${Math.floor(z / CELLR)}`; if (!batches.has(key)) batches.set(key, { a, list: [], cx: (Math.floor(x / CELLR) + .5) * CELLR, cz: (Math.floor(z / CELLR) + .5) * CELLR });
    batches.get(key).list.push(_m.clone());
    if (edgeDist(x, z) > BOUND - 4) addRock({ x, z, r: rad, y });
  };
  // scattered boulders, thicker on slopes, and big ones heaped along the foot of the mountains
  for (let i = 0; i < 2600; i++) {
    const x = BOUND + r() * (WORLD - 2 * BOUND), z = BOUND + r() * (WORLD - 2 * BOUND), rad = .8 + Math.pow(r(), 2) * 3.4;
    if (r() > .35 + slope(x, z) * 1.2 || !clearOf(x, z, rad)) continue;
    place(i, x, z, rad);
  }
  for (let i = 0; i < 900; i++) {
    const t = r() * 4, u = r() * (WORLD - 2 * BOUND) + BOUND, inset = BOUND - 10 + r() * 22, side = Math.floor(t);
    const x = side === 0 ? u : side === 1 ? u : side === 2 ? inset : WORLD - inset, z = side === 0 ? inset : side === 1 ? WORLD - inset : u;
    if (!clearOf(x, z, 4)) continue;
    place(i, x, z, 2 + Math.pow(r(), 1.5) * 6);
  }
  for (const { a, list, cx, cz } of batches.values()) {
    let src = null; a.scene.updateMatrixWorld(true); a.scene.traverse(o => { if (o.isMesh && !src) src = o; });
    const inst = new THREE.InstancedMesh(src.geometry, src.material, list.length);
    list.forEach((mtx, j) => inst.setMatrixAt(j, mtx.multiply(src.matrixWorld)));
    inst.castShadow = true; inst.receiveShadow = true; inst.computeBoundingSphere(); scene.add(inst);
    CULL.push({ o: inst, x: cx, z: cz, r: CELLR * .75 });
  }
  // points of interest
  buildPOIs({ scene, H, M, SHIP, mat: POI_MAT, prop, buildDome, buildRig, mulberry, solid: addSolid, cull: (o, x, z, rr) => CULL.push({ o, x, z, r: rr }),
    loot: (x, z, kind) => LOOT_SPOTS.push({ x, z, kind }), sleeper: (type, x, z, nest) => SLEEPERS.push({ type, x, z, nest }), vent: (x, y, z, kind) => VENTS.push({ x, y, z, kind }) }, POIS);
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
  // abandoned colony kit
  const kit = ['portable_generator', 'metal_tool_chest', 'barrel_01', 'propane_tank', 'old_military_crate', 'metal_jerrycan', 'ammo_box', 'medical_box'];
  for (let i = 0; i < 10; i++) { const a = r() * TAU, m2 = 1 + r() * 6.5; prop(kit[Math.floor(r() * kit.length)], Math.cos(a) * m2, .25, Math.sin(a) * m2, { scale: 1.1 }, g, r() * TAU); }
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
  for (let i = 0; i < 5; i++) prop('barrel_01', 3 + (i % 3) * .65, .6, 3.2 + Math.floor(i / 3) * .65, { scale: 1.1 }, g, r() * TAU);
  prop('propane_tank', 4.8, .6, 2.6, { scale: 1.2 }, g); prop('metal_jerrycan', 2.4, .6, 4.6, { scale: 1.1 }, g, r() * TAU);
  prop('portable_generator', -4.5, .6, 4, { scale: 1.2 }, g, r() * TAU);
}
let crashSmokeAt = [];
// UD-17 'Kestrel', the FEC dropship the marine rode down: olive hull panels, soot, a torn-off engine pod.
const SHIP = {
  hull: triplanar(new THREE.MeshStandardMaterial({ color: col('#4f5549'), roughness: .8, metalness: .3 }), TX_HULL, { scale: .3, normalStrength: 1.1, useMetal: .4 }),
  belly: triplanar(new THREE.MeshStandardMaterial({ color: col('#3c4038'), roughness: .8, metalness: .3 }), TX_HULL, { scale: .38, normalStrength: 1.3, useMetal: .5 }),
  soot: triplanar(new THREE.MeshStandardMaterial({ color: col('#1d1b19'), roughness: .9, metalness: .2 }), TX_HULL, { scale: .38, normalStrength: 1.5 }),
  glass: new THREE.MeshPhysicalMaterial({ color: col('#0b1216'), roughness: .06, metalness: .2, clearcoat: 1, clearcoatRoughness: .05 }),
  inside: new THREE.MeshStandardMaterial({ color: col('#0c0d0e'), roughness: .9 }),
  ember: new THREE.MeshStandardMaterial({ color: col('#120804'), emissive: col('#c2400f'), emissiveIntensity: .7, roughness: .8 }),
  nav: new THREE.MeshStandardMaterial({ color: col('#1c5a2a'), emissive: col('#3cff6a'), emissiveIntensity: 1.5 }),
};
// stencilled unit markings and hazard chevrons, drawn once
const markTex = canvasTex(512, 128, (g, w, h) => {
  g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(214,206,182,.85)'; g.font = 'bold 74px "Arial Narrow", Arial, sans-serif'; g.textBaseline = 'middle';
  g.fillText('FEC', 12, 52); g.font = 'bold 38px Arial, sans-serif'; g.fillText('UD-17  KESTREL', 178, 40); g.font = '22px Arial, sans-serif'; g.fillText('FRONTIER EXPEDITIONARY CORPS', 180, 82);
  g.fillStyle = 'rgba(200,150,40,.85)'; for (let i = 0; i < 12; i++) { g.beginPath(); g.moveTo(i * 44, 128); g.lineTo(i * 44 + 22, 128); g.lineTo(i * 44 + 44, 106); g.lineTo(i * 44 + 22, 106); g.fill(); }
});
const hazardTex = canvasTex(256, 32, (g, w, h) => { g.fillStyle = '#c69a28'; g.fillRect(0, 0, w, h); g.fillStyle = '#1a1a18'; for (let i = -1; i < 9; i++) { g.beginPath(); g.moveTo(i * 32, h); g.lineTo(i * 32 + 16, h); g.lineTo(i * 32 + 32, 0); g.lineTo(i * 32 + 16, 0); g.fill(); } });
function decal(tex, w, h, parent, x, y, z, ry, opacity = 1) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity, roughness: .8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  m.position.set(x, y, z); m.rotation.y = ry; parent.add(m); return m;
}
function part(geo, mat, parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function buildCrash() {
  const x = BASE.x - 4, z = BASE.z - 3, y = H(x, z), g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = .6; scene.add(g);
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(16, 32), displaySpaceAlpha(new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: glowTex, transparent: true, opacity: .7, depthWrite: false })));
  scorch.rotation.x = -Math.PI / 2; scorch.position.y = .06; g.add(scorch);
  // nose dug in, rolled onto its broken side
  const body = new THREE.Group(); body.rotation.set(-.07, 0, -.06); body.position.y = -.25; g.add(body);

  // fuselage, cockpit glass and dorsal spine, lofted from cross-sections (nose at +x)
  part(loft([
    { x: -8, w: 3.1, h: 2.7, y: 1.75, belly: .25 }, { x: -7.2, w: 3.7, h: 3.1, y: 1.75, belly: .25 }, { x: -3, w: 4.1, h: 3.3, y: 1.75, belly: .25 },
    { x: 1.5, w: 3.9, h: 3.1, y: 1.7, belly: .25 }, { x: 4, w: 3.3, h: 2.6, y: 1.6, belly: .25 }, { x: 6, w: 2.5, h: 2.0, y: 1.5, belly: .2 },
    { x: 7.6, w: 1.5, h: 1.25, y: 1.4, n: 3, belly: .1 }, { x: 8.7, w: .35, h: .3, y: 1.35, n: 2 },
  ]), SHIP.hull, body);
  part(loft([{ x: -8.05, w: 3.0, h: 1.0, y: .55, n: 6 }, { x: 4.5, w: 3.2, h: 1.0, y: .5, n: 6 }, { x: 7, w: 1.8, h: .7, y: .8, n: 4 }]), SHIP.belly, body);
  part(loft([{ x: 4.3, w: 1.9, h: .6, y: 2.75, n: 3 }, { x: 5.4, w: 2.0, h: 1.3, y: 2.55, n: 3 }, { x: 6.6, w: 1.5, h: 1.1, y: 2.15, n: 3 }, { x: 7.5, w: .7, h: .5, y: 1.8, n: 2.5 }], 24), SHIP.glass, body);
  for (const fx of [5.0, 5.9, 6.7]) part(BOX, M.darkMetal, body, fx, 2.6 - (fx - 5) * .38, 0, 0, 0, -.5 - (fx - 5) * .2).scale.set(.08, .5, 2.05 - (fx - 5) * .5);
  part(loft([{ x: -7.6, w: 1.3, h: .5, y: 3.35, n: 6 }, { x: -6.8, w: 1.7, h: .9, y: 3.4, n: 6 }, { x: 1, w: 1.7, h: .9, y: 3.35, n: 6 }, { x: 3.4, w: .9, h: .3, y: 3.1, n: 4 }]), SHIP.hull, body);
  for (let i = 0; i < 5; i++) part(BOX, SHIP.inside, body, -5.5 + i * .55, 3.86, 0).scale.set(.32, .04, 1.2);
  const beacon = mesh(SPH_LO, M.red, -1.5, 3.95, 0, .14, .14, .14, body, false); beacon.userData.beacon = true; M.red.userData.mesh = beacon;
  part(CYLS, M.darkMetal, body, .8, 4.3, .3).scale.set(.03, 1.2, .03);

  // stub wings: starboard intact with its nav light, port snapped short with a jagged edge
  part(plate([[-3.4, 1.7], [1.2, 1.7], [.4, 5.4], [-2.2, 5.4]], .22), SHIP.hull, body, 0, 1.35, 0, 0, 0, 0).rotation.x = -.12;
  mesh(SPH_LO, SHIP.nav, -.9, 1.55, 5.45, .09, .09, .09, body, false);
  part(plate([[-3.4, -1.7], [1.2, -1.7], [.7, -2.9], [.1, -3.3], [-.5, -2.8], [-1.3, -3.6], [-2.2, -3.1], [-2.9, -3.4]], .22), SHIP.soot, body, 0, 1.35, 0, .1);

  // twin tail fins, canted out
  for (const side of [-1, 1]) part(plate([[-8.2, 0], [-5.6, 0], [-6.9, 2.2], [-8.1, 2.2]], .16), SHIP.hull, body, 0, 3.3, side * .55, -Math.PI / 2 + side * .38);

  // engine pods on pylons: starboard still attached and burning, port one torn off and lying in the snow
  const pod = latheX([[0, -.05], [.5, 0], [.62, .12], [.82, .5], [.86, 1.2], [.86, 3.3], [.74, 3.9], [.55, 4.15], [.5, 4.15], [.5, 3.95], [0, 3.95]], 28);
  const nozzle = latheX([[.47, 0], [.6, -.35], [.62, -.45], [.5, -.45], [.38, -.1], [0, -.1]], 24);
  const engine = (parent, burnt) => {
    const e = new THREE.Group(); parent.add(e);
    part(pod, burnt ? SHIP.soot : SHIP.hull, e); part(nozzle, M.darkMetal, e);
    const core = part(new THREE.CircleGeometry(.4, 20), burnt ? SHIP.inside : SHIP.ember, e, -.1, 0, 0, 0, -Math.PI / 2);
    part(new THREE.CircleGeometry(.5, 20), SHIP.inside, e, 4.16, 0, 0, 0, Math.PI / 2);
    for (let i = 0; i < 3; i++) part(new THREE.TorusGeometry(.865, .025, 6, 28), M.darkMetal, e, 1.4 + i * .8, 0, 0, 0, Math.PI / 2);
    return { e, core };
  };
  const right = engine(body, false); right.e.position.set(-7.4, 2.55, 2.75);
  part(plate([[-6.6, 1.6], [-3.9, 1.6], [-4.4, 2.5], [-6.6, 2.5]], .3), SHIP.hull, body, 0, 2.55, 0);
  part(plate([[-6.6, -1.6], [-4.6, -1.6], [-5.0, -2.0], [-5.5, -1.85], [-6.1, -2.1], [-6.6, -1.9]], .3), SHIP.soot, body, 0, 2.55, 0);
  const left = engine(g, true); left.e.position.set(-11.5, .78, -6.5); left.e.rotation.set(.25, -.9, .12);

  // rear ramp dropped open onto the snow, with the dark hold behind it
  part(BOX, SHIP.inside, body, -8.06, 1.55, 0).scale.set(.04, 2.0, 2.4);
  const ramp = new THREE.Group(); ramp.position.set(-8, .5, 0); ramp.rotation.z = -.42; body.add(ramp);
  part(BOX, M.deck, ramp, -1.4, 0, 0).scale.set(2.8, .14, 2.3);
  decal(hazardTex, 2.3, .22, ramp, -2.72, .075, 0, Math.PI / 2).rotation.x = -Math.PI / 2;
  for (const side of [-1, 1]) part(CYLS, M.darkMetal, ramp, -.4, .35, side * 1.05, 0, 0, 1.1).scale.set(.06, 1.1, .06);

  // hull breach on the port side: soot, a dark hole, ribs showing and plating peeled out
  const breach = new THREE.Group(); breach.position.set(-.6, 1.5, -2.03); body.add(breach);
  part(new THREE.CircleGeometry(1.2, 9), SHIP.inside, breach, 0, 0, -.02, 0, Math.PI).scale.set(1.3, .85, 1);
  for (let i = 0; i < 4; i++) part(new THREE.TorusGeometry(1.75, .05, 5, 12, 1.4), M.darkMetal, breach, -1.1 + i * .7, .1, 1.95, 0, Math.PI / 2, -.7);
  for (const [px, py, rx, rz, w] of [[-1.2, .7, -.9, .2, .9], [1.1, -.5, -1.1, -.3, .7], [.4, .9, -.7, .5, .6], [-.6, -.8, -1.2, 0, .8]]) part(BOX, SHIP.soot, breach, px, py, -.25, rx, 0, rz).scale.set(w, .04, .6);
  decal(smokeTex, 6, 3.6, body, -.6, 1.7, -2.07, Math.PI, .9).material.color.setRGB(0, 0, 0);

  // markings on both flanks
  decal(markTex, 3.4, .85, body, 1.6, 1.95, 1.96, 0, .9);
  decal(markTex, 3.4, .85, body, 3.0, 1.95, -1.93, Math.PI, .9);

  // nose gear folded under, the mains snapped
  part(CYLS, M.darkMetal, body, 5.6, .45, 0, 0, 0, 1.2).scale.set(.12, 1.2, .12);
  part(CYLS, M.burnt, body, 5.1, .3, .5, Math.PI / 2, 0, 0).scale.set(.32, .25, .32);

  // wreckage strewn behind: hull plates and the port wing's tip
  part(plate([[0, 0], [2.1, 0], [1.6, 1.4], [.3, 1.1]], .18), SHIP.soot, g, -4.5, .25, -6.5, .15, .7, .1);
  for (let i = 0; i < 18; i++) {
    const a = rand(0, TAU), m2 = rand(7, 16), w = rand(.4, 1.4), d = rand(.3, 1);
    const b = part(plate([[0, 0], [w, 0], [w * rand(.6, 1), d], [rand(0, .3), d * rand(.6, 1)]], rand(.04, .08), .015), chance(.5) ? SHIP.hull : SHIP.soot, g, Math.cos(a) * m2, .08, Math.sin(a) * m2, rand(-.3, .3), rand(0, TAU), rand(-.3, .3));
    b.castShadow = w > .8;
  }
  // what the marine dragged out of the wreck
  for (const [name, px, pz, ry, sc] of [['old_military_crate', 2, 5.4, .2, 1], ['ammo_box', 3.4, 5.9, 1.1, 1.1], ['ammo_box', 3.6, 5.3, .4, 1.1], ['medical_box', 1.1, 6.3, -.5, 1],
    ['metal_jerrycan', -1.5, 5.6, 2, 1.1], ['metal_jerrycan', -2, 5.9, 2.4, 1.1], ['propane_tank', -3.4, 5.2, 0, 1.1], ['barrel_01', 5.6, -4.8, 0, 1.1], ['barrel_01', 6.3, -4.4, 1, 1.1]]) {
    prop(name, px, 0, pz, { scale: sc }, g, ry);
  }
  g.updateMatrixWorld(true);
  // the hull blocks movement and building like a row of boulders
  for (let k = -7.5; k <= 7.5; k += 2.5) { const p = new THREE.Vector3(k, 0, 0).applyMatrix4(body.matrixWorld); addRock({ x: p.x, z: p.z, r: k > 5 ? 1.4 : 2.1, y: p.y }); }
  const ep = new THREE.Vector3(-.3, 0, 0).applyMatrix4(right.e.matrixWorld);
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
  prop('metal_tool_chest', 1.55, 0, .1, {}, g, -.1); prop('portable_generator', -1.7, 0, .3, {}, g, .4); prop('metal_jerrycan', -1.3, 0, -.6, {}, g, 1.4);
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
  if (!d) { const m = new THREE.Mesh(splatGeo, displaySpaceAlpha(new THREE.MeshStandardMaterial({ color: col(c), emissive: col('#3c5a10'), emissiveIntensity: .5, roughness: .2, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }))); m.rotation.x = -Math.PI / 2; scene.add(m); d = { m }; }
  d.m.position.set(x, H(x, z) + .05, z); d.m.scale.set(s * rand(.8, 1.2), s * rand(.8, 1.2), 1); d.m.rotation.z = rand(0, TAU); d.m.material.opacity = .75; d.t = 40; decals.push(d);
}

// ---------- the Skarn ----------
const _up = new THREE.Vector3(0, 1, 0), _v = new THREE.Vector3();
function seg(m, ax, ay, az, bx, by, bz, th) {
  _v.set(bx - ax, by - ay, bz - az); const L = _v.length() || .001;
  m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2); m.scale.set(th, L, th); m.quaternion.setFromUnitVectors(_up, _v.divideScalar(L));
}
const SKIN = skinSet();
M.teeth = new THREE.MeshStandardMaterial({ color: col('#9a968c'), roughness: .3, metalness: .5 });
// Skarn types with a generated model use it, rigged and animated in code; the rest stay sculpted.
let RIGS_SKARN = null;
function skarnRig(type) {
  if (!RIGS_SKARN) RIGS_SKARN = { drone: buildRigTemplate(MODELS.skarn_drone, { height: 1.4 }) };
  return RIGS_SKARN[type];
}
function buildSkarn(type) {
  const T = skarnRig(type);
  // the generated hide is glossy metal-ish; under the snowfield HDRI it read as chrome, so damp the reflections
  if (T) { const R = instanceRig(T); R.mat.emissive = new THREE.Color(0); R.mat.envMapIntensity = .3; R.mat.color.setScalar(.75); return { g: R.g, mat: R.mat, tail: [], legs: [], rig: R.rig, R }; }
  const d = ED[type], s = d.r, G = skarnGeometry(type, s), g = new THREE.Group(); g.rotation.order = 'YXZ';
  // wet black hide: ribbed and veined by the triplanar skin set, with a clearcoat sheen over it
  const mat = triplanar(new THREE.MeshPhysicalMaterial({ color: col(d.col).multiplyScalar(1.6), roughness: .5, metalness: .25, clearcoat: 1, clearcoatRoughness: .35, emissive: new THREE.Color(0) }), SKIN, { scale: 2.4 / s, normalStrength: 1.2, ao: .7 });
  const add = (geo, x, y, z, sx, sy, sz, m = mat) => mesh(geo, m, x, y, z, sx, sy, sz, g, true);
  const out = { g, mat, tail: [], legs: [] };
  add(G.body, 0, 0, 0, 1, 1, 1);
  if (type !== 'crawler') add(G.ribs, 0, 0, 0, 1, 1, 1);
  for (const t of G.tubes) add(t, 0, 0, 0, 1, 1, 1);
  // head on the neck, tipped down a little, with teeth along the jaw line
  const head = new THREE.Group(); g.add(head);
  if (type === 'crawler') head.position.set(s * .95, s * .58, 0); else head.position.set(s * 1.2, s * 1.18, 0);
  head.rotation.z = type === 'crawler' ? -.05 : -.06;
  mesh(G.cranium, mat, 0, 0, 0, 1, 1, 1, head, true); mesh(G.jaw, mat, 0, 0, 0, 1, 1, 1, head, true);
  const hs = type === 'crawler' ? s * .4 : type === 'brood' ? s * .6 : s * .62;
  for (let i = 0; i < 7; i++) for (const side of [-1, 1]) mesh(G.tooth, M.teeth, hs * (.36 + i * .065), -hs * .13, side * hs * (.11 - i * .012), 1, 1, 1, head, false);
  if (type === 'spitter') { const sac = add(SPH, -s * .45, s * 1.35, 0, s * .5, s * .42, s * .42, M.acidSac); sac.rotation.z = .3; }
  if (type === 'warden') for (let i = -2; i <= 2; i++) { const p = new THREE.Group(); p.position.set(-.3 * s, .35 * s, 0); p.rotation.order = 'YZX'; p.rotation.y = i * .28; p.rotation.z = .35 + Math.abs(i) * .08; head.add(p); mesh(G.crest, mat, 0, 0, 0, 1, 1, 1, p, true); }
  if (type === 'brood') {
    for (let i = -4; i <= 4; i++) { const p = new THREE.Group(); p.position.set(s * .9, s * 1.35, 0); p.rotation.order = 'YZX'; p.rotation.y = i * .2; p.rotation.z = .55 + Math.abs(i) * .05; g.add(p); mesh(G.crest, mat, 0, 0, 0, 1, 1, 1, p, true); }
    out.sac = add(SPH, -s * 2.8, s * .85, 0, s * 2.0, s * .9, s * 1.15, M.egg);
  }
  // grasping forearms under the head
  if (type !== 'crawler') for (const side of [-1, 1]) out.legs.push({ side, j: -1, a: add(G.legUpper, 0, 0, 0, 1, 1, 1), b: add(G.legLower, 0, 0, 0, 1, 1, 1) });
  const n = type === 'brood' ? 11 : 9;
  for (let i = 0; i < n; i++) out.tail.push(add(G.vertebra, 0, 0, 0, 1, 1, 1));
  out.tip = add(G.blade, 0, 0, 0, 1, 1, 1);
  const pairs = type === 'crawler' ? 4 : type === 'brood' ? 3 : 2;
  for (const side of [-1, 1]) for (let j = 0; j < pairs; j++) out.legs.push({ side, j, a: add(G.legUpper, 0, 0, 0, 1, 1, 1), b: add(G.legLower, 0, 0, 0, 1, 1, 1) });
  return out;
}
function animSkarn(e) {
  if (e.m.R) {
    const moved = Math.hypot(e.x - (e.px ?? e.x), e.z - (e.pz ?? e.z)); e.px = e.x; e.pz = e.z;
    e.mvK = lerp(e.mvK ?? 0, moved > .002 && !e.dying ? 1 : 0, .15);
    const atk = e.atk > 0 ? Math.sin((1 - e.atk / .25) * Math.PI) : 0;
    animateRig(e.m.R, { t: e.anim, moving: e.mvK, attack: atk, sleep: e.state === 'sleep' || !!e.low, dead: e.dying > 0 ? 1 : 0, turn: 0 });
    return;
  }
  const m = e.m, d = ED[e.type], s = d.r, t = e.anim, dead = e.dying > 0;
  const n = m.tail.length, tl = e.type === 'crawler' ? s * 3.2 : s * 2.8;
  let lx = 0, ly = 0, lz = 0;
  for (let i = 0; i < n; i++) {
    const k = (i + 1) / n, x = -s * .85 - k * tl, y = (e.type === 'crawler' ? s * .5 : s * .95) + Math.sin(k * 2.4) * s * .45 - k * k * s * .3;
    const z = dead ? Math.sin(k * 3) * s * .8 * k : Math.sin(t * 1.4 - k * 4.2) * s * .55 * k, rr = s * .2 * (1 - k * .72);
    m.tail[i].position.set(x + tl / n * .9, y, z); m.tail[i].scale.set(tl / n * .52, rr, rr); lx = x; ly = y; lz = z;
  }
  m.tip.position.set(lx - tl / n * .3, ly, lz);
  const ty = e.type === 'crawler' ? s * .5 : s * .85, spacing = e.type === 'crawler' ? s * .35 : s * .55;
  for (const L of m.legs) {
    if (L.j < 0) { // forearms
      seg(L.a, s * 1.0, s * 1.0, L.side * s * .35, s * 1.6, s * .7, L.side * s * .7, s * .08);
      seg(L.b, s * 1.6, s * .7, L.side * s * .7, s * 2.1, s * .9 + Math.sin(t * 2 + L.side) * s * .1, L.side * s * .4, s * .06); continue;
    }
    const hx = s * .35 - L.j * spacing, ph = t * 2.2 + L.j * Math.PI * .9 + (L.side > 0 ? Math.PI : 0);
    const reach = e.type === 'crawler' ? 1.5 : .95;
    let fx = hx + Math.cos(ph) * s * .45 + (L.j === 0 ? s * .3 : -s * .1), fy = Math.max(0, Math.sin(ph)) * s * .3, fz = L.side * s * reach;
    let kx = e.type === 'crawler' ? hx + (fx - hx) * .4 : hx - s * .3, ky = s * (e.type === 'crawler' ? 1.0 : 1.15), kz = L.side * s * (e.type === 'crawler' ? reach * .7 : .72);
    if (dead) { kx = hx; ky = s * .9; kz = L.side * s * .6; fx = hx - s * .2; fy = s * .5; fz = L.side * s * .3; }
    if ((e.state === 'sleep' || e.low) && !dead) { fy = 0; fx = hx + (L.j === 0 ? s * .3 : -s * .1); }
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
    const b = prop('concrete_road_barrier', 0, 0, 0, { fit: 1.95 }, g); b.scale.y *= 1.15;
    if (ghost) setMaterial(b, gm);
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
const vm = new THREE.Group(); camera.add(vm); vm.position.set(.15, -.13, -.34); vm.scale.setScalar(.75);
const VMS = {};
// first-person guns, gloved hands and sleeves are built in src/render/viewmodels.ts
function buildViewmodels() {
  // pistol and pulse rifle wear Meshy-generated models over the code-built rigs, and every gun's hands a Meshy arm
  const built = buildGunViewmodels(weaponMaterials(), { pistol: { gun: MODELS.vm_pistol, mag: MODELS.vm_pistol_mag }, pulse: { gun: MODELS.vm_rifle, mag: MODELS.vm_rifle_mag }, hand: MODELS.vm_arm });
  for (const [k, v] of Object.entries(built)) { const g = v.group; g.visible = false; g.muzzle = v.muzzle; g.vmAnim = v.anim; g.vmFlash = v.flash; vm.add(g); VMS[k] = g; }
}
// ---------- sound: everything is synthesized with Web Audio, so there are no files to load ----------
const VOICE = { crawler: .7, drone: 1, spitter: 1.1, warrior: 1.6, warden: 1.9, brood: 3 };
const SFX = (() => {
  let ac = null, master, bus, room, windGain, windFilter, noiseBuf, muted = false, heart = 0, reloadOut = null;
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
    // and a long open-air tail, so shots and screeches ring out across the plain
    const rev = ac.createConvolver(), n = Math.floor(ac.sampleRate * 2.2), ir = ac.createBuffer(2, n, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2) * Math.min(1, i / (ac.sampleRate * .015)); }
    rev.buffer = ir; room = ac.createGain(); room.gain.value = .22; const rlp = ac.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 3200;
    bus.connect(room); room.connect(rlp); rlp.connect(rev); rev.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const wn = ac.createBufferSource(); wn.buffer = noiseBuf; wn.loop = true;
    windFilter = ac.createBiquadFilter(); windFilter.type = 'bandpass'; windFilter.frequency.value = 400; windFilter.Q.value = .7;
    windGain = ac.createGain(); windGain.gain.value = 0;
    wn.connect(windFilter); windFilter.connect(windGain); windGain.connect(master); wn.start();
  }
  function out(pan = 0, vol = 1, wet = 0) {
    const g = ac.createGain(); g.gain.value = vol;
    if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); p.connect(bus); } else g.connect(bus);
    if (wet) { const w = ac.createGain(); w.gain.value = wet; g.connect(w); w.connect(room); }
    return g;
  }
  // soft-clipping for grit: gunpowder bark, torn throats
  const curves = {};
  function shaper(dest, k) {
    if (!curves[k]) { const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); } curves[k] = c; }
    const w = ac.createWaveShaper(); w.curve = curves[k]; w.oversample = '2x'; w.connect(dest); return w;
  }
  const click = (dest, t, f, v, q = 6, dur = .014) => noise(dest, t, dur, 'bandpass', f, f, q, v, .0005);
  /**
   * A creature voice: two detuned saws with frequency-modulated grit (`rough` Hz), plus breath,
   * shaped by parallel formant bands and soft-clipped. f0 glides to f1 over the call.
   */
  function voice(o, t, dur, f0, f1, formants, v, rough = 45, breath = .25) {
    const env = ac.createGain(), sum = ac.createGain(), sh = shaper(o, 3);
    env.gain.setValueAtTime(.0001, t); env.gain.exponentialRampToValueAtTime(v, t + Math.min(.07, dur * .2));
    env.gain.setValueAtTime(v, t + dur * .5); env.gain.exponentialRampToValueAtTime(.0001, t + dur);
    sum.connect(env); env.connect(sh);
    const bands = formants.map(([f, q, g]) => { const b = ac.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; const bg = ac.createGain(); bg.gain.value = g; b.connect(bg); bg.connect(sum); return b; });
    const mod = ac.createOscillator(), mg = ac.createGain(); mod.frequency.value = rough; mg.gain.value = f0 * .3; mod.connect(mg);
    for (const det of [1, 1.013]) {
      const c = ac.createOscillator(); c.type = 'sawtooth'; c.frequency.setValueAtTime(f0 * det, t); c.frequency.exponentialRampToValueAtTime(Math.max(30, f1 * det), t + dur);
      mg.connect(c.frequency); for (const b of bands) c.connect(b); c.start(t); c.stop(t + dur + .05);
    }
    if (breath) { const nz = ac.createBufferSource(), ng = ac.createGain(); nz.buffer = noiseBuf; ng.gain.value = breath; nz.connect(ng); for (const b of bands) ng.connect(b); nz.start(t, Math.random() * 1.5); nz.stop(t + dur + .05); }
    mod.start(t); mod.stop(t + dur + .05);
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
      if (!live()) return; const t = now(), o = out(rand(-.04, .04), 1, kind === 'pistol' ? .5 : .65), d = rand(.93, 1.07), sh = shaper(o, 2.5);
      noise(o, t, .012, 'highpass', 6500, 6500, .7, 1.1, .0005); // supersonic crack
      if (kind === 'pistol') {
        noise(sh, t, .17, 'bandpass', 1900 * d, 380, .9, .8); tone(o, t, .13, 'sine', 165 * d, 42, .85);
        click(o, t + .03, 3300 * d, .28); click(o, t + .07, 2500 * d, .2, 5); // slide cycles and the case flicks out
      } else if (kind === 'pulse') {
        // the pulse rifle's gritty electronic bark: powder, a ringing caseless chamber, a zap
        noise(sh, t, .095, 'bandpass', 2700 * d, 850, 1.1, .7); tone(o, t, .085, 'sine', 115 * d, 48, .6);
        tone(o, t, .035, 'square', 1460 * d, 1300, .1); tone(o, t, .028, 'square', 2230 * d, 2100, .06); tone(o, t, .055, 'sawtooth', 540 * d, 170, .09);
        click(o, t + .022, 4200, .15, 8);
      } else {
        noise(sh, t, .14, 'bandpass', 1350 * d, 330, .9, .85); tone(o, t, .15, 'sine', 92 * d, 36, 1);
        tone(o, t, .07, 'sawtooth', 230, 250, .04); click(o, t + .018, 1900, .2); // feed motor and the belt advancing
      }
    },
    flame() {
      if (!live()) return; const t = now(), o = out(0, 1, .3);
      noise(o, t, .2, 'lowpass', 750, 420, .7, .42, .02); noise(o, t, .14, 'bandpass', 2900, 2000, 1.5, .08, .02);
      for (let i = 0; i < 2; i++) click(o, t + rand(0, .12), rand(1200, 3500), rand(.06, .14), 3); // burning fuel crackle
    },
    empty() { if (!live()) return; const t = now(), o = out(0, 1); click(o, t, 3100, .18, 9, .01); click(o, t + .012, 1700, .08, 6, .02); },
    /** Mechanical reload foley timed to the viewmodel animation; `cancelReload` cuts it if the weapon is switched. */
    reload(kind) {
      if (!live()) return; api.cancelReload(); const t = now(); reloadOut = out(.15, 1, .15); const o = reloadOut;
      const out_ = (at, f = 2600) => { click(o, t + at, f, .3); noise(o, t + at + .01, .18, 'bandpass', 900, 2200, 2, .12, .02); };
      const in_ = (at, f = 2200) => { noise(o, t + at, .06, 'bandpass', 1800, 900, 2, .15, .01); tone(o, t + at + .05, .07, 'sine', 180, 80, .35); click(o, t + at + .05, f, .4); };
      if (kind === 'pistol') { out_(.18); in_(.72); click(o, t + 1.18, 3600, .5, 7); tone(o, t + 1.19, .12, 'triangle', 2900, 2700, .04); }
      else if (kind === 'pulse') { out_(.3); in_(1.25); click(o, t + 1.75, 2400, .45); click(o, t + 1.9, 3100, .45); noise(o, t + 1.76, .14, 'bandpass', 1600, 3200, 3, .1); tone(o, t + 2.15, .06, 'square', 2000, 2000, .05); tone(o, t + 2.23, .06, 'square', 2600, 2600, .05); }
      else if (kind === 'smart') { click(o, t + .35, 1500, .4, 4); out_(.85, 1700); in_(2.3, 1500); tone(o, t + 3.0, .8, 'sawtooth', 70, 320, .07, .3); noise(o, t + 3.0, .8, 'bandpass', 600, 2400, 2, .06, .3); }
      else { noise(o, t + .25, .9, 'highpass', 4000, 6000, 1, .18, .02); out_(.9, 1500); in_(1.9, 1500); for (let i = 0; i < 3; i++) click(o, t + 2.45 + i * .07, 4500, .25, 10); noise(o, t + 2.65, .35, 'lowpass', 500, 200, 1, .35, .02); }
    },
    cancelReload() { if (reloadOut) { reloadOut.gain.value = 0; reloadOut = null; } },
    step(sprint) { if (!live()) return; noise(out(rand(-.1, .1), 1), now(), sprint ? .09 : .12, 'bandpass', rand(900, 1400), 380, 1.4, sprint ? .22 : .13, .005); },
    loot() { if (!live()) return; const t = now(), o = out(0, 1); noise(o, t, .25, 'bandpass', 700, 300, 2, .3, .01); tone(o, t + .08, .1, 'triangle', 880, 880, .1); tone(o, t + .16, .12, 'triangle', 1320, 1320, .1); },
    ui(ok = true) { if (!live()) return; const t = now(), o = out(0, 1); tone(o, t, .08, 'square', ok ? 660 : 220, ok ? 660 : 170, .06); if (ok) tone(o, t + .07, .1, 'square', 990, 990, .06); },
    build() { if (!live()) return; const t = now(), o = out(0, 1); noise(o, t, .22, 'lowpass', 600, 200, 1, .5); tone(o, t, .15, 'sine', 140, 70, .5); noise(o, t + .05, .08, 'highpass', 4000, 4000, 1, .2); },
    hurt() { if (!live()) return; const t = now(), o = out(0, 1); tone(o, t, .22, 'sine', 95, 45, .7); noise(o, t, .15, 'lowpass', 800, 300, 1, .4); },
    heal() { if (!live()) return; const t = now(), o = out(0, 1); noise(o, t, .3, 'highpass', 3000, 6000, 1, .15, .05); tone(o, t + .1, .3, 'sine', 520, 780, .08, .05); },
    hiss(x, z, big = 1) {
      if (!live()) return; const pl = place(x, z, 45); if (!pl) return; const t = now(), o = out(pl.pan, pl.vol, .3), r = rand(.85, 1.15) / big, dur = rand(.6, 1.1) * big;
      // breath through bared teeth, fluttering, with a low rattle in the chest under it
      const trem = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain(); trem.gain.value = .6; lfo.frequency.value = rand(18, 28); lg.gain.value = .4; lfo.connect(lg); lg.connect(trem.gain); trem.connect(o); lfo.start(t); lfo.stop(t + dur + .1);
      noise(trem, t, dur, 'bandpass', 4300 * r, 2600 * r, 2.5, .55, dur * .3); noise(trem, t, dur, 'bandpass', 6800 * r, 5200 * r, 4, .25, dur * .3);
      voice(o, t, dur, 95 * r, 70 * r, [[500 * r, 4, .6], [1300 * r, 6, .3]], .08, 30, .05);
    },
    screech(x, z, big = 1) {
      if (!live()) return; const pl = place(x, z, 90); if (!pl) return; const t = now(), o = out(pl.pan, pl.vol * 1.3, .55), r = rand(.85, 1.2) / big, dur = (.5 + rand(0, .3)) * big;
      voice(o, t, dur, 1500 * r, 620 * r, [[950 * r, 4, 1], [2600 * r, 7, .8], [4300 * r, 9, .5]], .38, 55 / big, .3);
      noise(o, t, dur * .9, 'highpass', 3500 * r, 2800 * r, 1, .13, .03);
      if (chance(.5)) voice(o, t + dur * .7, dur * .5, 2100 * r, 1700 * r, [[2400 * r, 8, 1], [5000 * r, 9, .4]], .14, 90, .2); // a trailing chitter
    },
    claw(x, z) {
      if (!live()) return; const pl = place(x, z, 30); if (!pl) return; const t = now(), o = out(pl.pan, pl.vol, .2);
      noise(o, t, .13, 'bandpass', 1400, 4800, 1.5, .35, .03); click(o, t + .11, 2200, .5, 4); tone(o, t + .11, .1, 'sine', 140, 60, .4);
    },
    skitter(x, z) {
      if (!live()) return; const pl = place(x, z, 22); if (!pl) return; const t = now(), o = out(pl.pan, pl.vol * .55);
      let at = 0; for (let i = 0, n = 3 + Math.floor(rand(0, 3)); i < n; i++) { at += rand(.025, .07); click(o, t + at, rand(2600, 5600), rand(.2, .38), 10, .01); }
    },
    hit(x, z) {
      if (!live()) return; const pl = place(x, z, 60); if (!pl) return; const t = now(), o = out(pl.pan, pl.vol);
      tone(o, t, .07, 'sine', 170, 60, .35); noise(o, t, .1, 'lowpass', 1400, 400, 1, .3, .003); // wet impact into chitin
      noise(o, t + .04, .5, 'highpass', 5500, 7000, 1, .07, .05); // acid sizzle
    },
    die(x, z, big = 1) {
      if (!live()) return; const pl = place(x, z, 70); if (!pl) return; const t = now(), o = out(pl.pan, pl.vol * 1.3, .6), r = rand(.85, 1.15) / big, dur = 1.1 * big;
      voice(o, t, dur, 1300 * r, 210 * r, [[850 * r, 4, 1], [2300 * r, 6, .7], [3900 * r, 8, .35]], .42, 38 / big, .35);
      // gurgling acid as it goes down, then the thud
      const gg = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain(); gg.gain.value = .3; lfo.frequency.value = rand(7, 12); lg.gain.value = .3; lfo.connect(lg); lg.connect(gg.gain); gg.connect(o); lfo.start(t + .4); lfo.stop(t + 1.8 * big);
      noise(gg, t + .4, 1.3 * big, 'lowpass', 700, 250, 3, .5, .1);
      tone(o, t + .55 * big, .25, 'sine', 75 / big, 32, .7); noise(o, t + .55 * big, .2, 'lowpass', 500, 150, 1, .4);
    },
    spit(x, z) { if (!live()) return; const pl = place(x, z, 40); if (!pl) return; const t = now(), o = out(pl.pan, pl.vol); noise(o, t, .2, 'lowpass', 1200, 300, 4, .5); tone(o, t, .15, 'sine', 300, 120, .3); },
    splash() { if (!live()) return; noise(out(0, 1), now(), .5, 'bandpass', 4500, 2000, 1.5, .4, .01); },
    turret(x, z) { if (!live()) return; const pl = place(x, z, 60); if (!pl) return; const t = now(), o = out(pl.pan, pl.vol * .8, .5); noise(o, t, .01, 'highpass', 6000, 6000, .7, .6, .0005); noise(shaper(o, 2.5), t, .1, 'bandpass', 2000, 700, 1, .5); tone(o, t, .07, 'sine', 120, 50, .4); tone(o, t, .05, 'square', 300, 100, .06); },
    crash(x, z) { if (!live()) return; const pl = place(x, z, 70); if (!pl) return; const t = now(), o = out(pl.pan, pl.vol); noise(o, t, .6, 'lowpass', 1500, 120, 1, .7); tone(o, t, .5, 'sine', 80, 35, .7); },
    roar(x, z) {
      if (!live()) return; const pl = place(x, z, 400) || { pan: 0, vol: .2 }; const t = now(), o = out(pl.pan, Math.max(.3, pl.vol), .8);
      voice(o, t, 2.6, 150, 62, [[380, 4, 1], [950, 5, .7], [2300, 6, .4]], .45, 28, .35);
      tone(o, t, 2.6, 'sine', 48, 34, .5, .4); noise(o, t, 2.6, 'lowpass', 600, 150, 1, .4, .3);
    },
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
// loot containers: scrap crates in the open, cabinets in the domes, barrels on the rigs, resin-crusted boxes at the hive
const CRATE_MODEL = {
  scrap: ['wooden_military_crate', { fit: 1.1 }], dome: ['utility_box_01', { scale: 1.1 }], rig: ['barrel_01', { scale: 1.15 }],
  town: ['metal_tool_chest', { scale: 1.1 }], cargo: ['old_military_crate', { fit: 1.2 }], relay: ['utility_box_01', { scale: 1.1 }],
  lab: ['medical_box', { scale: 1.3 }], reactor: ['utility_box_01', { scale: 1.1 }], crater: ['ammo_box', { scale: 1.3 }],
};
function newGame() {
  clearDynamic();
  const r = mulberry(17), crates = [];
  const near = (x, z, p, d) => Math.hypot(x - p.x, z - p.z) < d;
  const free = (x, z) => !rockGrid.query(x - 6, z - 6, x + 6, z + 6, k => Math.hypot(x - k.x, z - k.z) < k.r + 1) && !solidHit(x, z, .5);
  const addCrate = (x, z, kind) => { if (!free(x, z)) return; const y = H(x, z); const cm = CRATE_MODEL[kind], ry = r() * TAU, m = cm ? prop(cm[0], x, y - .03, z, cm[1], scene, ry) : mesh(crateGeo, CRATE_MAT[kind], x, y + .3, z); m.rotation.y = ry; crates.push({ x, z, kind, looted: false, m }); };
  // most loot sits in the points of interest; a thin scatter of scrap crates covers the wilds between them
  for (const c of LOOT_SPOTS) addCrate(c.x, c.z, c.kind);
  for (let i = 0; i < 320; i++) {
    const x = BOUND + r() * (WORLD - 2 * BOUND), z = BOUND + r() * (WORLD - 2 * BOUND);
    if (slope(x, z) < .5 && !POIS.some(q => Math.hypot(x - q.x, z - q.z) < q.r2)) addCrate(x, z, 'scrap');
  }
  for (let i = 0; i < 4; i++) { const a = r() * TAU; addCrate(BASE.x + Math.cos(a) * rand(6, 10), BASE.z + Math.sin(a) * rand(6, 10), 'scrap'); }
  for (let i = 0; i < 6; i++) { const a = r() * TAU, m2 = 13 + r() * 10; addCrate(HIVE.x + Math.cos(a) * m2, HIVE.z + Math.sin(a) * m2, 'hive'); }

  S = {
    t: 0, day: 1, phase: 'day', phaseT: 0, kills: 0, tier: 1, over: false, won: false, wonAt: 0, shake: 0, muzzle: 0, recoil: 0,
    player: { x: BASE.x - 3, z: BASE.z + 6, y: 0, vy: 0, ground: true, yaw: 2.6, pitch: 0, r: .45, hp: 100, max: 100, spd: 5.2, cool: 0, hurt: 0, bob: 0, moving: false, sprint: false },
    inv: { scrap: 2, metal: 0, cells: 0, chips: 0, cores: 0, med: 0, ammo: 0 },
    weapons: ['pistol'], wi: 0, mags: { pistol: WEAPONS.pistol.mag }, reload: null, draw: 0, gear: {}, research: {}, enemies: [], spits: [], structs: new Map(), crates,
    noise: 0, buildMode: false, buildSel: 0, spawnQueue: [], wanderT: 0, raidT: 30, smokeT: 0, flashOn: true, brood: null, tips: {}, ghost: null, ghostType: null,
  };
  S.player.y = H(S.player.x, S.player.z);
  S.brood = spawn('brood', HIVE.x, HIVE.z, 'sleep'); S.brood.home = true; S.brood.nest = 'hive';
  [[-7, 2.5], [7, 3.5], [0, -7.5], [-3, 8.5]].forEach(([dx, dz]) => { const e = spawn('warden', HIVE.x + dx, HIVE.z + dz, 'sleep'); e.home = true; e.nest = 'hive'; });
  [[-13, 7], [12, -8.5], [9, 12]].forEach(([dx, dz]) => { const e = spawn('warrior', HIVE.x + dx, HIVE.z + dz, 'sleep'); e.home = true; e.nest = 'hive'; });
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; const e = spawn('drone', HIVE.x + Math.cos(a) * 16, HIVE.z + Math.sin(a) * 16, 'sleep'); e.home = true; e.nest = 'hive'; }
  // smaller dormant groups in the brood pockets and the overrun lab
  for (const q of SLEEPERS) { const e = spawn(q.type, q.x, q.z, 'sleep'); e.home = true; e.nest = q.nest; }
  $('log').innerHTML = '';
  msg('Dropship down. The fleet has jumped. You are alone on Veyra-9.', 'warn');
  msg('Search the wreckage with E, then open the workbench with C.', 'info');
}
function spawn(type, x, z, state = 'hunt') {
  const d = ED[type], m = buildSkarn(type); scene.add(m.g);
  const e = { type, x, z, hp: d.hp, max: d.hp, a: rand(0, TAU), anim: rand(0, 10), cd: 0, state, flash: 0, spawnT: 0, atk: 0, dying: 0, m };
  S.enemies.push(e); placeEnemy(e); animSkarn(e); return e;
}
function placeEnemy(e) { e.m.g.position.set(e.x, H(e.x, e.z) + (e.jy || 0), e.z); e.m.g.rotation.y = -e.a; }

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
function rockHit(x, z, r) { let hit = null; rockGrid.query(x - r - 1, z - r - 1, x + r + 1, z + r + 1, k => { if (Math.hypot(x - k.x, z - k.z) < k.r * .85 + r) { hit = k; return true; } }); return hit; }
/** Building footprints: an oriented box test, ignored when `y` (feet height) is above the roof. */
function solidHit(x, z, r, y = -1e9) {
  let hit = null;
  solidGrid.query(x - r - 1, z - r - 1, x + r + 1, z + r + 1, q => {
    if (y > q.top - .05) return;
    const dx = x - q.x, dz = z - q.z, lx = dx * q.c - dz * q.s, lz = dx * q.s + dz * q.c;
    if (Math.abs(lx) < q.hw + r && Math.abs(lz) < q.hd + r) { hit = q; return true; }
  });
  return hit;
}
// the playable area ends where the mountains start; the slopes also get too steep to climb well before it
const inBounds = (x, z, r) => edgeDist(x, z) > BOUND + r;
function blocked(x, z, r, y) { return !inBounds(x, z, r) || rockHit(x, z, r) || solidHit(x, z, r, y) || structsNear(x, z, r).length > 0; }
function moveBody(o, dx, dz, r) {
  let moved = false;
  if (!blocked(o.x + dx, o.z + dz, r)) { o.x += dx; o.z += dz; return true; }
  if (dx && !blocked(o.x + dx, o.z, r)) { o.x += dx; moved = true; }
  if (dz && !blocked(o.x, o.z + dz, r)) { o.z += dz; moved = true; }
  return moved;
}
function tip(id, text) { if (S.tips[id]) return; S.tips[id] = 1; msg(text, 'info'); }
const fwd = () => ({ x: -Math.sin(S.player.yaw), z: -Math.cos(S.player.yaw) });
const eyeY = () => S.player.y + 1.65;
// ---------- feet: jumping, slopes, the climbable limit ----------
const GRAV = 8.6, JUMP_V = 4.6, MAX_SLOPE = 1.0;
/** Ground height under the player, including roofs of buildings they are standing on. */
function floorAt(x, z, y) { let f = H(x, z); solidGrid.query(x - 1, z - 1, x + 1, z + 1, q => { if (y >= q.top - .4) { const dx = x - q.x, dz = z - q.z, lx = dx * q.c - dz * q.s, lz = dx * q.s + dz * q.c; if (Math.abs(lx) < q.hw && Math.abs(lz) < q.hd) f = Math.max(f, q.top); } }); return f; }
function movePlayer(p, dx, dz) {
  // Walking uphill onto ground steeper than MAX_SLOPE (or a step taller than a jump clears) is refused per axis,
  // so the mountain walls and cliff faces stop you; downhill is always allowed.
  const ok = (x, z) => {
    if (blocked(x, z, p.r, p.y)) return false;
    const h = floorAt(x, z, p.y), rise = h - p.y, run = Math.hypot(x - p.x, z - p.z) || 1e-6;
    if (p.ground) return rise <= .35 || rise / run <= MAX_SLOPE && slope(x, z) <= MAX_SLOPE + .15;
    return rise <= .35;
  };
  if (ok(p.x + dx, p.z + dz)) { p.x += dx; p.z += dz; return true; }
  let moved = false;
  if (dx && ok(p.x + dx, p.z)) { p.x += dx; moved = true; }
  if (dz && ok(p.x, p.z + dz)) { p.z += dz; moved = true; }
  return moved;
}
function updateFeet(p, dt) {
  if (keys.has('Space') && p.ground) { p.vy = JUMP_V; p.ground = false; SFX.step(true); }
  let floor = floorAt(p.x, p.z, p.y);
  if (!p.ground || p.y > floor + .05) {
    p.vy -= GRAV * dt; p.y += p.vy * dt; p.ground = false;
    if (p.y <= floor) { if (p.vy < -7) { S.shake = Math.max(S.shake, .25); SFX.step(true); } p.y = floor; p.vy = 0; p.ground = true; }
  } else { p.y = floor; p.vy = 0; }
  // standing on a face steeper than the limit slides you down it
  if (p.ground && p.y <= H(p.x, p.z) + .05) {
    const sl = slope(p.x, p.z);
    if (sl > MAX_SLOPE) {
      const e = .5, gx = H(p.x + e, p.z) - H(p.x - e, p.z), gz = H(p.x, p.z + e) - H(p.x, p.z - e), gl = Math.hypot(gx, gz) || 1, k = (sl - MAX_SLOPE + .4) * 6 * dt;
      const nx = p.x - gx / gl * k, nz = p.z - gz / gl * k;
      if (!blocked(nx, nz, p.r)) { p.x = nx; p.z = nz; p.y = H(nx, nz); }
    }
  }
  // never end up outside the playable ring, whatever pushed you there
  const e2 = edgeDist(p.x, p.z), lim = BOUND + p.r + .05;
  if (e2 < lim) { p.x = clamp(p.x, lim, WORLD - lim); p.z = clamp(p.z, lim, WORLD - lim); }
}

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
  if (c === 'KeyP' || (c === 'Escape' && $('craft').hidden && $('mapOv').hidden && !S.buildMode)) { togglePause(); return; }
  if (paused || S.over) return;
  keys.add(c);
  if (c === 'Escape') { if (!$('mapOv').hidden) toggleMap(false); else if (!$('craft').hidden) toggleCraft(false); else S.buildMode = false; }
  if (c === 'KeyC' || c === 'Tab') toggleCraft();
  if (c === 'KeyE') loot();
  if (c === 'KeyF') S.flashOn = !S.flashOn;
  if (c === 'KeyB') { S.buildMode = !S.buildMode; if (S.buildMode) tip('build', 'Build mode: aim at the ground, left-click to place, right-click to remove, 1 to 4 to pick.'); }
  if (/^Digit[1-4]$/.test(c)) { S.buildSel = +c.slice(5) - 1; S.buildMode = true; }
  if (c === 'KeyQ') { selectWeapon(S.wi + 1); S.buildMode = false; }
  if (c === 'KeyR' && !S.buildMode) startReload();
  if (c === 'KeyH') useMed();
  if (c === 'KeyK') toast(SFX.toggleMute() ? 'Sound off' : 'Sound on');
  if (c === 'KeyM') toggleMap();
  if (c === 'KeyG') { quality = quality === 'high' ? 'low' : 'high'; try { localStorage.setItem('sc.quality', quality); } catch (_) { /* storage blocked */ } post.setQuality(quality); resize(); toast(quality === 'high' ? 'Graphics: high' : 'Graphics: low (faster)'); }
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
cv.addEventListener('wheel', e => { if (!running || S.weapons.length < 2) return; selectWeapon(S.wi + (e.deltaY > 0 ? 1 : S.weapons.length - 1)); }, { passive: true });

// ---------- actions ----------
function nearestCrate() {
  let best = null, bd = 2.6; const f = fwd();
  for (const c of S.crates) if (!c.looted) { const dx = c.x - S.player.x, dz = c.z - S.player.z, d = Math.hypot(dx, dz); if (d < bd && (dx * f.x + dz * f.z) / (d || 1) > .2) { bd = d; best = c; } }
  return best;
}
function loot() {
  const c = nearestCrate(); if (!c) return;
  c.looted = true; setDarkened(c.m, true);
  const g = {}; const add = (k, n) => { if (n > 0) g[k] = (g[k] || 0) + n; };
  if (c.kind === 'scrap') { add('scrap', rint(1, 3)); if (chance(.3)) add('metal', 1); }
  if (c.kind === 'dome') { add('scrap', rint(0, 2)); add('metal', rint(1, 2)); if (chance(.7)) add('cells', 1); }
  if (c.kind === 'rig') { add('metal', rint(1, 3)); if (chance(.55)) add('chips', 1); if (chance(.25)) add('cells', 1); }
  if (c.kind === 'hive') { add('chips', rint(1, 2)); add('cells', 1); }
  if (c.kind === 'town') { add('scrap', rint(1, 2)); if (chance(.5)) add('metal', 1); if (chance(.3)) add('med', 1); if (chance(.25)) add('ammo', rint(10, 25)); }
  if (c.kind === 'cargo') { add('metal', rint(1, 3)); if (chance(.4)) add('ammo', rint(15, 40)); if (chance(.2)) add('cells', 1); }
  if (c.kind === 'relay') { add('chips', rint(1, 2)); if (chance(.6)) add('cells', 1); }
  if (c.kind === 'lab') { add('med', rint(1, 2)); if (chance(.6)) add('chips', 1); if (chance(.35)) add('cores', 1); }
  if (c.kind === 'reactor') { add('cells', rint(1, 2)); if (chance(.5)) add('metal', rint(1, 2)); }
  if (c.kind === 'crater') { add('scrap', rint(1, 2)); if (chance(.5)) add('ammo', rint(10, 30)); if (chance(.3)) add('cores', 1); }
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
// ---------- map screen ----------
// Hillshaded once from the heightfield, then markers are redrawn each frame while it is open.
let mapBase = null;
const MAP_ICON = { town: '■', dome: '◯', rig: '⛏', port: '✈', relay: '⌁', lab: '✚', reactor: '♨', wreck: '✖', pocket: '☣', crater: '◎', lake: '≈', hive: '☣', crash: '★' };
function bakeMap() {
  const N = 580, k = WORLD / N, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), img = g.createImageData(N, N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + .5) * k, z = (j + .5) * k, h = H(x, z), sx = H(x + k, z) - H(x - k, z), sz = H(x, z + k) - H(x, z - k);
    const shade = clamp(.62 - (sx * .7 + sz * .5) / (2 * k) * .55, .15, 1), sl = slope(x, z), snow = clamp((h - 14) / 30, 0, 1) * (1 - clamp((sl - .5) * 2, 0, 1));
    let r = lerp(58, 150, snow), gg = lerp(66, 162, snow), b = lerp(70, 172, snow);
    if (edgeDist(x, z) < BOUND) { r *= .55; gg *= .55; b *= .6; }
    const o = (j * N + i) * 4; img.data[o] = r * shade * 1.5; img.data[o + 1] = gg * shade * 1.5; img.data[o + 2] = b * shade * 1.5; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const lake = poi('lake'); g.fillStyle = 'rgba(140,190,215,.55)'; g.beginPath(); g.arc(lake.x / k, lake.z / k, lake.r / k * .85, 0, TAU); g.fill();
  return c;
}
function drawMap() {
  const cv2 = $('mapCv'), g = cv2.getContext('2d'), W = cv2.width, k = W / WORLD, p = S.player;
  if (!mapBase) mapBase = bakeMap();
  g.imageSmoothingEnabled = true; g.drawImage(mapBase, 0, 0, W, W);
  // 100 m grid and the edge of the playable ground
  g.strokeStyle = 'rgba(220,230,225,.08)'; g.lineWidth = 1;
  for (let v = 0; v <= WORLD; v += 100) { g.beginPath(); g.moveTo(v * k, 0); g.lineTo(v * k, W); g.moveTo(0, v * k); g.lineTo(W, v * k); g.stroke(); }
  g.strokeStyle = 'rgba(220,90,80,.5)'; g.setLineDash([10, 8]); g.lineWidth = 2; g.strokeRect(BOUND * k, BOUND * k, (WORLD - 2 * BOUND) * k, (WORLD - 2 * BOUND) * k); g.setLineDash([]);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const q of POIS) {
    const x = q.x * k, z = q.z * k, hostile = q.kind === 'hive' || q.kind === 'pocket', home = q.kind === 'crash';
    g.fillStyle = hostile ? '#e0675c' : home ? '#f0b13c' : '#cfe2ea';
    g.font = `${q.kind === 'dome' || q.kind === 'rig' ? 22 : 28}px "Share Tech Mono", monospace`; g.fillText(MAP_ICON[q.kind] || '•', x, z);
    if (q.kind === 'dome' || q.kind === 'rig') continue;
    g.font = '700 25px "Saira Condensed", sans-serif'; g.lineWidth = 4; g.strokeStyle = 'rgba(5,8,9,.85)';
    g.strokeText(q.name, x, z + 26); g.fillText(q.name, x, z + 26);
  }
  // you
  g.save(); g.translate(p.x * k, p.z * k); g.rotate(-p.yaw); g.fillStyle = '#f0b13c'; g.strokeStyle = '#000'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, -16); g.lineTo(10, 12); g.lineTo(0, 6); g.lineTo(-10, 12); g.closePath(); g.fill(); g.stroke(); g.restore();
  g.font = '18px "Share Tech Mono", monospace'; g.fillStyle = '#d9e4dd'; g.textAlign = 'left'; g.fillText('100 m grid · N up', 14, W - 18);
}
function toggleMap(force) { const el = $('mapOv'), open = force ?? el.hidden; el.hidden = !open; if (open) drawMap(); }
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
  if (WEAPONS[id]) { S.weapons.push(id); S.mags[id] = WEAPONS[id].mag; selectWeapon(S.weapons.length - 1); S.inv.ammo += 40; msg(`${WEAPONS[id].name} ready. Q switches weapons.`, 'good'); }
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
  for (const c of S.crates) if (c.looted && chance(.2)) { c.looted = false; setDarkened(c.m, false); refilled++; }
  SFX.dawn();
  msg(`Dawn, day ${S.day}. The Skarn pull back. The storm uncovered ${refilled} crates.`, 'good');
  if (S.day === 6) msg('Tracker picks up deep tremors from the nest. One more night.', 'warn');
}
function spawnAround(type) {
  const p = S.player, toHive = Math.atan2(HIVE.z - p.z, HIVE.x - p.x);
  for (let tries = 0; tries < 20; tries++) {
    const a = chance(.6) ? toHive + rand(-1.1, 1.1) : rand(0, TAU), d = rand(42, 58);
    const x = clamp(p.x + Math.cos(a) * d, BOUND + 2, WORLD - BOUND - 2), z = clamp(p.z + Math.sin(a) * d, BOUND + 2, WORLD - BOUND - 2);
    if (!blocked(x, z, ED[type].r)) return spawn(type, x, z);
  }
}

// ---------- update ----------
// distant buildings and rock cells drop out past the fog
const CULL_D = 470;
function cullWorld() { const p = S.player; for (const c of CULL) c.o.visible = Math.hypot(c.x - p.x, c.z - p.z) < CULL_D + c.r; }
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
  const spd = p.spd * (p.sprint && mz > 0 ? 1.55 : 1) * (p.ground ? 1 : .85);
  if (l > 0) { vx /= l; vz /= l; movePlayer(p, vx * spd * dt, vz * spd * dt); p.bob += dt * spd * 1.6; p.moving = true; S.stepD = (S.stepD || 0) + spd * dt; if (S.stepD > (p.sprint ? 2.1 : 1.6)) { S.stepD = 0; SFX.step(p.sprint); } if (p.sprint) S.noise = Math.min(100, S.noise + 6 * dt); } else p.moving = false;
  updateFeet(p, dt);
  p.cool -= dt; p.hurt = Math.max(0, p.hurt - dt);
  S.draw = Math.max(0, S.draw - dt); if (S.reload && (S.reload.t -= dt) <= 0) finishReload();
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
  // steam stacks at the geothermal plant, fires in the hauler wreck (only when you are close enough to see them)
  S.ventT = (S.ventT || 0) - dt;
  if (S.ventT <= 0) { S.ventT = .3; for (const v of VENTS) { if (d2(v, p) > 220) continue; if (v.kind === 'steam') fx('smoke', v.x + rand(-1, 1), v.y, v.z + rand(-1, 1), { vy: rand(2.5, 4), s: 1.6, c: '#c9ced2', t: 6 }); else { fx('smoke', v.x + rand(-.5, .5), v.y + .8, v.z + rand(-.5, .5), { vy: rand(1, 1.8) }); fx('flame', v.x + rand(-.4, .4), v.y, v.z + rand(-.4, .4), { vy: 1.2, s: .8 }); } } }
  cullWorld();
  if (!$('mapOv').hidden) drawMap();
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
    const s = ED[e.type].r, cx = e.x + Math.cos(e.a) * s * .4, cy = H(e.x, e.z) + (e.jy || 0) + s * .95, cz = e.z + Math.sin(e.a) * s * .4, R = s * 1.3;
    const lx = cx - o.x, ly = cy - o.y, lz = cz - o.z, tca = lx * d.x + ly * d.y + lz * d.z; if (tca < 0) continue;
    const dd = lx * lx + ly * ly + lz * lz - tca * tca; if (dd > R * R) continue;
    const t = tca - Math.sqrt(R * R - dd); if (t < bt) { bt = t; best = e; }
  }
  const ex = o.x + d.x * bt, ez = o.z + d.z * bt;
  rockGrid.query(Math.min(o.x, ex) - 8, Math.min(o.z, ez) - 8, Math.max(o.x, ex) + 8, Math.max(o.z, ez) + 8, k => {
    const lx = k.x - o.x, ly = k.y + k.r * .2 - o.y, lz = k.z - o.z, tca = lx * d.x + ly * d.y + lz * d.z; if (tca < 0 || tca - k.r > bt) return;
    const dd = lx * lx + ly * ly + lz * lz - tca * tca, R = k.r * .85; if (dd > R * R) return;
    const t = tca - Math.sqrt(R * R - dd); if (t < bt) { bt = t; best = null; }
  });
  // building walls stop rounds too (stepped test along the ray against footprints)
  for (let t = .3; t < bt; t += .4) { const x = o.x + d.x * t, z = o.z + d.z * t, y = o.y + d.y * t; const q = solidHit(x, z, 0); if (q && y < q.top) { bt = t; best = null; break; } }
  for (let t = .5; t < bt; t += .6) { const x = o.x + d.x * t, z = o.z + d.z * t; if (o.y + d.y * t < H(x, z)) { bt = t; best = null; break; } }
  return { e: best, t: bt };
}
// ---------- magazines ----------
// Each gun holds its own magazine; reloading tops it up from the shared ammo reserve (the sidearm's is unlimited).
const shotCost = (wid) => wid === 'flamer' ? WEAPONS.flamer.ammo : 1;
function selectWeapon(i) {
  const n = (i + S.weapons.length) % S.weapons.length; if (n === S.wi && !S.reload) return;
  if (S.reload) { S.reload = null; SFX.cancelReload(); }
  S.wi = n; S.draw = .45;
}
function startReload() {
  const wid = S.weapons[S.wi], w = WEAPONS[wid];
  if (S.reload || S.draw > 0 || S.mags[wid] >= w.mag) return;
  if (w.ammo && S.inv.ammo < shotCost(wid)) { toast('No ammo to reload'); tip('ammo', 'Craft ammo packs at the workbench. The sidearm never runs dry.'); return; }
  S.reload = { wid, t: w.reload, total: w.reload }; SFX.reload(wid);
}
function finishReload() {
  const { wid } = S.reload, w = WEAPONS[wid], need = w.mag - S.mags[wid], take = w.ammo ? Math.min(need, Math.floor(S.inv.ammo)) : need;
  if (w.ammo) S.inv.ammo -= take;
  S.mags[wid] += take; S.reload = null;
}
function fire() {
  const p = S.player, wid = S.weapons[S.wi], w = WEAPONS[wid];
  if (p.cool > 0 || S.reload || S.draw > 0) return;
  if (S.mags[wid] < shotCost(wid)) { p.cool = .35; SFX.empty(); if (!w.ammo || S.inv.ammo >= shotCost(wid)) startReload(); else { toast('Out of ammo'); tip('ammo', 'Craft ammo packs at the workbench. The sidearm never runs dry.'); } return; }
  p.cool = w.rate; S.mags[wid] -= shotCost(wid); S.noise = Math.min(100, S.noise + w.noise);
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
    for (const e of S.enemies) { if (e.dying || (e.state === 'sleep' && d2(e, p) > 20)) continue; const dx = e.x - o.x, dy = H(e.x, e.z) + (e.jy || 0) + ED[e.type].r - o.y, dz = e.z - o.z, dist = Math.hypot(dx, dy, dz); if (dist < bd && (dx * d.x + dy * d.y + dz * d.z) / dist > .93) { bd = dist; best = { dx, dy, dz, dist }; } }
    if (best) dir.set(best.dx / best.dist, best.dy / best.dist, best.dz / best.dist);
  }
  dir.x += rand(-w.spread, w.spread); dir.y += rand(-w.spread, w.spread); dir.z += rand(-w.spread, w.spread); dir.normalize();
  const hit = rayCast(o, dir, 140), end = o.clone().addScaledVector(dir, hit.t);
  tracer(_mz, end, wid === 'pistol' ? '#fff2c4' : '#bfeaff'); SFX.shot(wid);
  fx('flash', _mz.x, _mz.y, _mz.z, { s: wid === 'pistol' ? .6 : .9 }); g.vmFlash?.();
  if (hit.e) { SFX.hit(hit.e.x, hit.e.z); hurtEnemy(hit.e, w.dmg); for (let i = 0; i < 3; i++) fx('acid', end.x, end.y, end.z, { vx: rand(-2, 2), vy: rand(0, 3), vz: rand(-2, 2) }); }
  else if (hit.t < 140) { fx('spark', end.x, end.y, end.z, { vy: 2 }); fx('dust', end.x, end.y, end.z, { s: .5 }); }
  S.muzzle = .05; S.recoil = Math.min(1, S.recoil + .4); p.pitch = clamp(p.pitch + w.kick, -1.45, 1.45);
}
function hurtEnemy(e, dmg, ignoreArmor) {
  if (e.hp <= 0) return;
  const d = ignoreArmor ? dmg : Math.max(1, dmg - ED[e.type].armor);
  e.hp -= d; e.flash = .06;
  if (e.state === 'sleep') wakeNest(e.nest);
  if (e.hp <= 0) killEnemy(e);
}
function wakeNest(nest = 'hive') {
  let woke = false;
  for (const e of S.enemies) if (e.state === 'sleep' && (e.nest ?? 'hive') === nest) { if (e.type === 'brood' && d2(e, S.player) > 34) continue; e.state = 'hunt'; woke = true; }
  const at = nest === 'hive' ? HIVE : poi(nest);
  if (woke) { tip('nest' + nest, nest === 'hive' ? 'The nest is awake.' : 'Something was sleeping here. Not any more.'); SFX.roar(at.x, at.z); }
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
// ---------- Skarn tactics ----------
// Hunting Skarn don't all just charge. They flank in at an angle, stalkers come in quiet and put on speed
// while you look away, anything close enough crouches and pounces, and badly hurt ones break off and run
// before coming back (no healing). Spitters only spit with a clear line and keep their distance.
const STALK = { crawler: .35, drone: .6, spitter: 1, warrior: .45, warden: .2 };
const POUNCE = { crawler: 1, drone: 1, warrior: 1 };
const RETREAT = { crawler: 1, drone: 1, spitter: 1, warrior: 1 };
/** Line of sight between two points: blocked by big boulders, building walls and hills. */
function losClear(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, L = Math.sqrt(L2) || 1;
  const hit = rockGrid.query(Math.min(ax, bx) - 4, Math.min(az, bz) - 4, Math.max(ax, bx) + 4, Math.max(az, bz) + 4, k => {
    if (k.r < .9) return;
    const t = clamp(((k.x - ax) * dx + (k.z - az) * dz) / (L2 || 1), 0, 1), px = ax + dx * t, pz = az + dz * t;
    return Math.hypot(k.x - px, k.z - pz) < k.r * .8 && ay + (by - ay) * t < k.y + k.r * .85;
  });
  if (hit) return false;
  for (let t = 1.5; t < L - 1; t += 1.5) {
    const k = t / L, x = ax + dx * k, z = az + dz * k, y = ay + (by - ay) * k;
    if (y < H(x, z) + .2) return false;
    const q = solidHit(x, z, 0); if (q && y < q.top) return false;
  }
  return true;
}
/** Picks where a hunting Skarn heads this frame: { x, z, spd multiplier, hold (crouch in place) }. */
function tactics(e, d, p, dt) {
  const dp = d2(e, p);
  // perception, a few times a second: can it see you, and are you looking at it?
  e.losT = (e.losT ?? rand(0, .2)) - dt;
  if (e.losT <= 0) {
    e.losT = rand(.18, .28);
    e.los = losClear(p.x, eyeY(), p.z, e.x, H(e.x, e.z) + d.r * 1.1, e.z);
    const f = fwd(); e.eyed = dp < 60 && ((e.x - p.x) * f.x + (e.z - p.z) * f.z) / (dp || 1) > .82;
  }
  e.style ??= chance(STALK[e.type] ?? 0) ? 'stalk' : 'rush';
  e.flank ??= chance(.5) ? 1 : -1;
  // how long you've been looking the other way (cover or not)
  e.unseenT = e.eyed ? 0 : (e.unseenT ?? 0) + dt;
  e.pcd = (e.pcd ?? rand(1, 3)) - dt;
  const go = (x, z, k = 1, hold = false) => ({ x, z, spd: k, hold });
  const at = (q) => q && Math.hypot(q.x - e.x, q.z - e.z) < 1;
  // badly hurt: break off once and run, then turn and come back (still hurt)
  if (RETREAT[e.type] && !e.fled && e.hp < e.max * .3) {
    e.fled = true; e.tac = 'retreat'; e.rT = 0;
    const vx = e.x - p.x, vz = e.z - p.z, L = Math.hypot(vx, vz) || 1;
    e.goal = { x: e.x + vx / L * 28, z: e.z + vz / L * 28 };
    SFX.screech(e.x, e.z, VOICE[e.type]);
  }
  switch (e.tac) {
    case 'retreat':
      e.rT += dt;
      if (!(at(e.goal) || dp > 26 || e.rT > 6)) return go(e.goal.x, e.goal.z, 1.3);
      e.tac = 'approach'; e.style = 'stalk';
      break;
    case 'crouch':
      e.crT -= dt;
      if (e.crT <= 0) startLeap(e, d, p);
      return go(p.x, p.z, 0, true);
  }
  e.tac = 'approach';
  // close and with a clear run: crouch, then leap
  if (POUNCE[e.type] && e.pcd <= 0 && e.los && dp > 3.2 && dp < 9) {
    const ux = (p.x - e.x) / dp, uz = (p.z - e.z) / dp; let clear = true;
    for (let t = 1; t < dp - 1; t += 1) if (rockHit(e.x + ux * t, e.z + uz * t, .3) || solidHit(e.x + ux * t, e.z + uz * t, .3)) { clear = false; break; }
    if (clear) { e.tac = 'crouch'; e.crT = e.type === 'warrior' ? .5 : .32; SFX.hiss(e.x, e.z, VOICE[e.type]); return go(p.x, p.z, 0, true); }
    e.pcd = .5;
  }
  if (e.type === 'spitter' && dp < 7) return go(e.x * 2 - p.x, e.z * 2 - p.z, 1.1); // keeps its distance
  // flank: come in at an angle from one side rather than straight down your sights
  const k = e.style === 'stalk' && e.unseenT > .6 ? 1.3 : 1;
  if (dp > 6) { const off = Math.min(9, dp * .35) * e.flank, ux = (p.x - e.x) / dp, uz = (p.z - e.z) / dp; return go(p.x - uz * off, p.z + ux * off, k); }
  return go(p.x, p.z, k);
}
function startLeap(e, d, p) {
  const dp = d2(e, p) || 1, ux = (p.x - e.x) / dp, uz = (p.z - e.z) / dp, land = Math.max(0, dp - (d.r + p.r) * .5);
  const T = clamp(dp / (d.spd * 2.4), .35, .75);
  e.tac = 'leap'; e.lp = { x0: e.x, z0: e.z, x1: e.x + ux * land, z1: e.z + uz * land, T, t: 0, h: Math.min(2.2, .9 + dp * .12), hit: false };
  e.atk = .25; e.a = Math.atan2(uz, ux); SFX.screech(e.x, e.z, VOICE[e.type]);
}
function leap(e, d, p, dt) {
  const L = e.lp; L.t += dt; const k = Math.min(1, L.t / L.T);
  const nx = lerp(L.x0, L.x1, k), nz = lerp(L.z0, L.z1, k);
  if (inBounds(nx, nz, d.r) && !solidHit(nx, nz, d.r)) { e.x = nx; e.z = nz; }
  e.jy = 4 * L.h * k * (1 - k); e.anim += dt * 4; e.atk = Math.max(e.atk, .12);
  // claws connect on the way down if you didn't get clear
  if (!L.hit && k > .45 && d2(e, p) < d.r + p.r + .9 && Math.abs(H(e.x, e.z) + e.jy + d.r - eyeY() + .6) < 2) {
    L.hit = true; SFX.claw(e.x, e.z); hurtPlayer(Math.round(d.dmg * 1.4)); S.shake = Math.max(S.shake, .8);
  }
  if (k >= 1) {
    e.jy = 0; e.tac = 'approach'; e.pcd = rand(3.5, 6.5); e.cd = d.cd;
    if (blocked(e.x, e.z, d.r)) { e.x = L.x0; e.z = L.z0; }
    fx('dust', e.x, H(e.x, e.z) + .2, e.z, { s: d.r });
  }
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
      e.vT = (e.vT ?? rand(1, 6)) - dt; if (e.vT <= 0) { e.vT = rand(4, 9); const dv = d2(e, p); if (dv < 60 && !e.low && !(e.style === 'stalk' && dv > 14)) (dv < 14 ? SFX.hiss : SFX.screech)(e.x, e.z, VOICE[e.type]); }
      e.skT = (e.skT ?? 0) - dt; if (e.skT <= 0 && !e.low) { e.skT = .35; SFX.skitter(e.x, e.z); }
    }
    e.m.mat.emissive.setScalar(e.flash > 0 ? .6 : 0);
    if (e.state === 'sleep') { e.anim += dt * .4; if (d2(e, p) < (e.nest === 'hive' ? 26 : 16)) wakeNest(e.nest); if (near) animSkarn(e); continue; }
    if (e.tac === 'leap') { leap(e, d, p, dt); placeEnemy(e); if (near) animSkarn(e); continue; }
    let tx = p.x, tz = p.z, spd = d.spd, hold = false; e.low = false;
    if (e.state === 'flee') { tx = HIVE.x; tz = HIVE.z; spd *= 1.2; if (d2(e, p) > 60) { e.gone = true; scene.remove(g); continue; } }
    else {
      let tgt = null, td = Math.min(d2(e, p), 12);
      for (const s of S.structs.values()) if (s.type === 'turret' || s.type === 'light') { const sd = d2(e, s); if (sd < td) { td = sd; tgt = s; } }
      if (tgt) { tx = tgt.x; tz = tgt.z; e.tac = 'approach'; }
      else if (e.type !== 'brood') { const r = tactics(e, d, p, dt); tx = r.x; tz = r.z; spd *= r.spd; hold = r.hold; e.low = r.hold; }
      if (e.type === 'brood' && d2(e, p) < 45) { e.spawnT -= dt; if (e.spawnT <= 0) { e.spawnT = 4; for (let i = 0; i < 3; i++) spawn('crawler', e.x + rand(-2, 2), e.z + rand(-2, 2)); } }
    }
    const dx = tx - e.x, dz = tz - e.z, dd = Math.hypot(dx, dz) || 1;
    let da = Math.atan2(dz, dx) - e.a; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU; e.a += da * Math.min(1, dt * 7);
    const dp = d2(e, p);
    if (e.type === 'spitter' && e.state === 'hunt' && dp < d.range && e.los && dp > 5) {
      // spits only with a clear shot
      if (e.cd <= 0) { e.cd = d.cd; e.atk = .25; spit(e); }
      e.anim += dt * 2;
    } else if (e.state === 'hunt' && dp < d.r + p.r + .7 && e.tac !== 'retreat') {
      if (e.cd <= 0) { e.cd = d.cd; e.atk = .25; SFX.claw(e.x, e.z); hurtPlayer(d.dmg); }
      e.anim += dt * 3;
    } else if (hold) {
      e.anim += dt * .5;
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
  scene.fog.density = lerp(.0058, .028, dk);
  const sa = S.phase === 'day' ? (S.phaseT / DAY) * Math.PI * .9 + .15 : Math.PI;
  sun.position.set(p.x + Math.cos(sa) * 90, Math.max(8, Math.sin(sa) * 110), p.z - 50); sun.target.position.set(p.x, 0, p.z);
  sun.intensity = 1.7 * day * LUX; sun.color.set(col('#fff1dc')).lerp(col('#ffa060'), duskK);
  hemi.intensity = (.12 + .62 * day) * LUX; hemi.color.set(col('#b9c6d2')).lerp(col('#2a3a5a'), dk);
  renderer.toneMappingExposure = lerp(1.05, .9, dk);
  // Fog and sky go through tone mapping in post, so feed in the color that maps back to the tuned one.
  scene.environmentIntensity = lerp(.25, .03, dk);
  untonemap(_c, renderer.toneMappingExposure, scene.fog.color); scene.background.copy(scene.fog.color);
  flashlight.intensity = S.flashOn ? lerp(.6, 2.6, dk) * PLUX * .7 : 0;
  muzzleLight.intensity = S.muzzle > 0 ? (S.weapons[S.wi] === 'flamer' ? 3 : 6) * PLUX : 0; muzzleLight.color.set(S.weapons[S.wi] === 'flamer' ? col('#ff8a32') : col('#ffd8a0'));
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
let vmSprint = 0;
function updateCamera(dt) {
  const p = S.player, bobA = p.moving ? (p.sprint ? .07 : .04) : 0;
  const sx = S.shake ? rand(-1, 1) * S.shake * .08 : 0, sy = S.shake ? rand(-1, 1) * S.shake * .08 : 0;
  camera.position.set(p.x + sx, eyeY() + Math.abs(Math.sin(p.bob)) * bobA + sy, p.z);
  camera.rotation.set(p.pitch + S.recoil * .02, p.yaw, 0);
  const wid = S.weapons[S.wi];
  for (const k in VMS) VMS[k].visible = k === wid && !S.buildMode;
  // weapon handling: breathing sway, lowered while sprinting, raised on draw, tipped over for the reload
  const g = VMS[wid], R = S.reload && S.reload.wid === wid ? 1 - S.reload.t / S.reload.total : -1;
  vmSprint = lerp(vmSprint, p.sprint && p.moving ? 1 : 0, Math.min(1, dt * 8));
  const dk = S.draw / .45, tilt = R < 0 ? 0 : smooth(0, .12, R) * (1 - smooth(.86, 1, R)), auto = S.muzzle > 0 && wid !== 'pistol' ? 1 : 0;
  vm.position.set(
    .15 + Math.sin(p.bob * .5) * bobA * .3 + Math.sin(S.t * .9) * .003 - vmSprint * .05 - tilt * .09 + auto * rand(-.002, .002),
    -.13 - Math.abs(Math.sin(p.bob)) * bobA * .3 + Math.sin(S.t * 1.7) * .004 - vmSprint * .05 - dk * dk * .32 + tilt * .03 + auto * rand(-.002, .002),
    -.34 + S.recoil * .06 + tilt * .08);
  vm.rotation.set(S.recoil * .12 - vmSprint * .2 - dk * .9 + tilt * .25, .06 + vmSprint * .55 + tilt * .2, vmSprint * .3 + tilt * .35);
  g.vmAnim(R, dt, { count: S.mags[wid] ?? 0, capacity: WEAPONS[wid].mag, firing: S.muzzle > 0, recoil: S.recoil });
  if (S.muzzle > 0 && wid !== 'flamer') { vm.updateMatrix(); muzzleLight.position.copy(VMS[wid].muzzle).applyMatrix4(vm.matrix); } // camera space, like the viewmodel
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
  // nearby points of interest show as small ticks with their distance
  cctx.font = '15px "Share Tech Mono", monospace';
  for (const q of POIS) {
    if (q.kind === 'crash') continue; const qd = d2(p, q); if (qd > 260 || qd < q.r2 * .6) continue;
    const qx = X(Math.atan2(q.x - p.x, -(q.z - p.z))); if (qx === null) continue;
    cctx.fillStyle = q.kind === 'hive' || q.kind === 'pocket' ? 'rgba(220,90,80,.85)' : 'rgba(150,200,215,.75)';
    cctx.fillRect(qx - 1.5, 40, 3, 8); cctx.fillText(`${Math.round(qd)}`, qx, 62);
  }
  cctx.fillStyle = 'rgba(240,177,60,.9)'; cctx.fillRect(W / 2 - 1, 0, 2, 8);
}
function location() {
  const p = S.player;
  if (d2(p, BASE) < 30) return 'CRASH SITE';
  if (d2(p, HIVE) < 45) return 'SKARN NEST';
  for (const q of POIS) if (q.kind !== 'crash' && q.kind !== 'hive' && d2(p, q) < q.r2 * .8) return q.name;
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
  else { $('modeLbl').textContent = 'Weapon'; $('weapLbl').textContent = w.name.toUpperCase(); $('ammoTxt').textContent = S.reload ? 'Reloading…' : `${Math.floor(S.mags[wid])} / ${w.ammo ? Math.floor(S.inv.ammo) : '∞'}`; }
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
    post.setDarkness(darkness()); post.setHurt(S.player.hurt / .3 * .6); post.render(dt);
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
if (import.meta.env.DEV) Object.assign(window, { __S: () => S, __post: post, __api: { renderer, scene, MODELS, VMS, placeModel, buildStruct, togglePause, selectWeapon, startReload, fire, H, slope, POIS, DOMES, RIGS, BASE, BENCH, solids, CULL, wakeNest, toggleMap, movePlayer, updateFeet, keys, cullWorld, LOOT_SPOTS, loot, craftItem, startNight, hurtEnemy, spawn, updateEnemies, losClear, rocks: () => rocks, placeStruct, camera, SFX } });
