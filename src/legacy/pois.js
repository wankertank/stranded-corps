import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { latheX, loft } from '../render/shapes';

/**
 * Points of interest around the basin. Each builder dresses its flattened pad with structures and
 * props, registers solid footprints for collision, loot spots, smoke vents and sleeping Skarn.
 *
 * `ctx` comes from game.js: { scene, H, M, SHIP, mat, prop, buildDome, buildRig, solid, loot, sleeper,
 * vent, cull, TAU, mulberry }.
 */

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
const CONE = new THREE.ConeGeometry(1, 1, 8);
const SPH = new THREE.SphereGeometry(1, 12, 8);

/** Merges transformed parts per material, so a building is a handful of draw calls. */
class Kit {
  constructor() { this.parts = new Map(); this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); }
  add(mat, geo, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    this.m.compose(new THREE.Vector3(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(this.m);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g); return this;
  }
  /** A box from corner-free centre and size. */
  box(mat, x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0) { return this.add(mat, BOX, x, y, z, sx, sy, sz, rx, ry, rz); }
  /** A straight strut between two points. */
  strut(mat, a, b, w) {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length(), mid = a.clone().add(b).multiplyScalar(.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), e = new THREE.Euler().setFromQuaternion(q);
    return this.add(mat, BOX, mid.x, mid.y, mid.z, w, len, w, e.x, e.y, e.z);
  }
  into(parent, shadows = true) {
    for (const [mat, list] of this.parts) { const m = new THREE.Mesh(mergeGeometries(list), mat); m.castShadow = shadows; m.receiveShadow = true; parent.add(m); }
    this.parts.clear(); return parent;
  }
}

function pad(ctx, p, ry = 0) {
  const g = new THREE.Group(); g.position.set(p.x, ctx.H(p.x, p.z), p.z); g.rotation.y = ry; ctx.scene.add(g); ctx.cull(g, p.x, p.z, p.r2); return g;
}
/** Local (x, z) in a group turned by ry, to world. */
const toWorld = (p, ry, x, z) => ({ x: p.x + x * Math.cos(ry) + z * Math.sin(ry), z: p.z - x * Math.sin(ry) + z * Math.cos(ry) });

// ---------- reusable structures ----------

/** A prefab habitat module on short stilts: ribbed walls, a pitched roof, lit windows, a door and steps. */
function habitat(ctx, k, x, z, ry, len = 12, wrecked = false, ox = 0, oz = 0) {
  const { M } = ctx, w = 4.2, h = 3.1, y0 = .6;
  const c = Math.cos(ry), s = Math.sin(ry), at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const B = (mat, lx, ly, lz, sx, sy, sz, rx = 0, rz = 0) => { const [wx, wz] = at(lx, lz); k.box(mat, wx, ly, wz, sx, sy, sz, ry, rx, rz); };
  for (const lx of [-len / 2 + .4, 0, len / 2 - .4]) for (const lz of [-w / 2 + .3, w / 2 - .3]) B(M.darkMetal, lx, y0 / 2, lz, .25, y0, .25);
  B(ctx.mat.panel, 0, y0 + h / 2, 0, len, h, w);
  for (let i = 0; i <= len / 1.5; i++) for (const side of [-1, 1]) B(ctx.mat.trim, -len / 2 + i * 1.5, y0 + h / 2, side * (w / 2 + .03), .12, h, .06);
  // pitched roof as two tilted slabs
  for (const side of [-1, 1]) B(ctx.mat.roof, 0, y0 + h + .45, side * w / 4, len + .4, .14, w / 2 + .5, side * .38);
  // windows along both sides, a few still lit by emergency power
  for (let i = 0; i < Math.floor(len / 3); i++) for (const side of [-1, 1]) B(i % 3 === 1 ? ctx.mat.windowLit : ctx.mat.window, -len / 2 + 2 + i * 3, y0 + h * .6, side * (w / 2 + .05), 1.3, .8, .06);
  B(M.darkMetal, len / 2 + .04, y0 + 1.1, 0, .08, 2.2, 1.1); // door
  for (let i = 0; i < 3; i++) B(M.darkMetal, len / 2 + .5 + i * .35, y0 - .15 - i * .2, 0, .35, .1, 1.3);
  if (wrecked) for (let i = 0; i < 5; i++) B(ctx.mat.panel, -len / 2 + i * 2.6, .25, w / 2 + 1.5 + (i % 2), 1.6, .1, 1.2, .3 * i, .2);
  ctx.solid(ox + x, oz + z, len + .4, w + .4, ry, y0 + h + 1);
}

/** A 20-foot shipping container: ribbed walls, door bars at one end. One shared geometry per paint. */
let CONTAINER_GEO = null;
function containerGeo() {
  if (CONTAINER_GEO) return CONTAINER_GEO;
  const parts = [], m = new THREE.Matrix4(), push = (g) => { g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('uv'); parts.push(g); };
  push(BOX.clone().applyMatrix4(m.makeScale(6.06, 2.59, 2.44)).translate(0, 1.295, 0));
  for (let i = 0; i < 22; i++) for (const s of [-1, 1]) push(BOX.clone().applyMatrix4(m.makeScale(.12, 2.4, .06)).translate(-2.85 + i * .27, 1.3, s * 1.24));
  for (const y of [.08, 2.5]) for (const s of [-1, 1]) push(BOX.clone().applyMatrix4(m.makeScale(6.1, .12, .12)).translate(0, y, s * 1.22));
  for (const z of [-.6, -.3, .3, .6]) push(BOX.clone().applyMatrix4(m.makeScale(.06, 2.3, .05)).translate(3.05, 1.3, z));
  CONTAINER_GEO = mergeGeometries(parts); return CONTAINER_GEO;
}
function container(ctx, parent, x, y, z, ry, paint, wx, wz, worldRy) {
  const c = new THREE.Mesh(containerGeo(), paint); c.position.set(x, y, z); c.rotation.y = ry; c.castShadow = true; c.receiveShadow = true; parent.add(c);
  if (wx !== undefined) ctx.solid(wx, wz, 6.2, 2.5, worldRy, y + 2.6);
  return c;
}

/** A lattice mast with cross-bracing, `h` tall, `b` wide at the base. */
function lattice(k, mat, x, y, z, h, b, taper = .45) {
  const V = (a, bb, c) => new THREE.Vector3(a, bb, c), levels = Math.round(h / 2.2);
  const at = (i, sx, sz) => { const t = i / levels, w = b * (1 - t * (1 - taper)) / 2; return V(x + sx * w, y + t * h, z + sz * w); };
  const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of C) k.strut(mat, at(0, sx, sz), at(levels, sx, sz), .16);
  for (let i = 0; i < levels; i++) for (let j = 0; j < 4; j++) {
    const [ax, az] = C[j], [bx, bz] = C[(j + 1) % 4];
    k.strut(mat, at(i, ax, az), at(i + 1, bx, bz), .07); k.strut(mat, at(i + 1, ax, az), at(i + 1, bx, bz), .08);
  }
}

/** A small resin growth: blobs, spires and eggs, the Skarn's outposts. */
function resinPatch(ctx, k, x, y, z, R, r) {
  const { M } = ctx;
  for (let i = 0; i < R * 2.2; i++) { const a = r() * 6.283, m2 = Math.pow(r(), .7) * R, s = 1 + r() * 2.6 * (1 - m2 / (R * 1.3)); k.add(r() < .5 ? M.resin : M.resin2, SPH, x + Math.cos(a) * m2, y - s * .35, z + Math.sin(a) * m2, s, s * .55, s * (.7 + r() * .5), 0, r() * 6.283); }
  for (let i = 0; i < R * .8; i++) { const a = r() * 6.283, m2 = 3 + r() * (R - 3), hgt = 2 + r() * 5; k.add(M.resin, CONE, x + Math.cos(a) * m2, y + hgt / 2 - .4, z + Math.sin(a) * m2, .5 + r() * .6, hgt, .5 + r() * .6, (r() - .5) * .5, 0, (r() - .5) * .5); }
  for (let i = 0; i < R * 1.2; i++) { const a = r() * 6.283, m2 = 3 + r() * (R - 4); k.add(M.egg, SPH, x + Math.cos(a) * m2, y + .42, z + Math.sin(a) * m2, .4, .55, .4); }
}

// ---------- the builders ----------

function town(ctx, p) {
  const r = ctx.mulberry(501), g = pad(ctx, p), k = new THREE.Group(); g.add(k);
  const kit = new Kit(), { M } = ctx, y0 = 0;
  // domes round the edge of the settlement, each with its own pad
  for (const [dx, dz] of [[-34, -26], [30, -32], [-30, 32], [34, 26]]) ctx.buildDome({ x: p.x + dx, z: p.z + dz }, ctx.mulberry(520 + dx));
  // a main street of habitat modules, two of them wrecked
  const rows = [[-14, -9, 0], [0, -9, 0], [14, -9, 0], [-14, 9, 0], [0, 9, 0], [14, 9, 0]];
  rows.forEach(([lx, lz, ry], i) => habitat(ctx, kit, lx, lz, ry + (i === 4 ? .25 : 0), 11, i === 2 || i === 4, p.x, p.z));
  kit.into(k);
  // street: a concrete strip with lamp posts
  kit.box(M.concrete, 0, .03, 0, 50, .06, 6);
  for (let i = -2; i <= 2; i++) { kit.box(M.darkMetal, i * 11, 3, 3.6, .14, 6, .14); kit.box(M.darkMetal, i * 11, 6, 3.1, .1, .1, 1); kit.box(ctx.mat.lampOff, i * 11, 5.9, 2.7, .5, .12, .3); }
  // central comms mast with a blinking beacon
  lattice(kit, M.metal, 0, 0, 22, 26, 3.4);
  kit.box(M.darkMetal, 0, 1.4, 26.5, 3, 2.8, 2.4);
  // water tank on legs
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) kit.box(M.metal, -24 + sx * 1.6, 3.5, -1 + sz * 1.6, .2, 7, .2);
  kit.add(M.hull, CYL, -24, 9, -1, 2.6, 4, 2.6); kit.add(M.darkMetal, CONE, -24, 11.6, -1, 2.8, 1.2, 2.8);
  // checkpoint: barriers across the street ends
  kit.into(k);
  const beacon = new THREE.Mesh(SPH, M.red); beacon.scale.setScalar(.35); beacon.position.set(0, 26.4, 22); k.add(beacon);
  for (const sx of [-1, 1]) for (let i = -1; i <= 1; i++) ctx.prop('concrete_road_barrier', sx * 27, y0, i * 2.2, { fit: 1.95 }, k, Math.PI / 2);
  ctx.solid(p.x, p.z + 26.5, 3.2, 2.6, 0, 3); ctx.solid(p.x, p.z + 22, 3.4, 3.4, 0, 26);
  const kitProps = ['portable_generator', 'metal_tool_chest', 'barrel_01', 'propane_tank', 'metal_jerrycan', 'old_military_crate'];
  for (let i = 0; i < 18; i++) { const lx = (r() - .5) * 50, lz = (r() < .5 ? -1 : 1) * (4 + r() * 2.5); ctx.prop(kitProps[i % kitProps.length], lx, y0, lz, { scale: 1.1 }, k, r() * 6.283); }
  for (let i = 0; i < 10; i++) ctx.loot(p.x + (r() - .5) * 46, p.z + (r() < .5 ? -1 : 1) * (4.4 + r() * 2), 'town');
  for (let i = 0; i < 6; i++) { const a = r() * 6.283; ctx.loot(p.x + Math.cos(a) * 45, p.z + Math.sin(a) * 45, 'scrap'); }
}

function port(ctx, p) {
  const r = ctx.mulberry(601), g = pad(ctx, p), kit = new Kit(), { M } = ctx;
  // landing pads: a big one and a small one, painted with rings and numbers
  kit.box(M.concrete, -10, .06, -8, 34, .12, 34); kit.box(M.concrete, 26, .06, 26, 16, .12, 16);
  const ring = (x, z, R, w) => { const m = new THREE.Mesh(new THREE.RingGeometry(R - w, R, 48), ctx.mat.paint); m.rotation.x = -Math.PI / 2; m.position.set(x, .13, z); g.add(m); };
  ring(-10, -8, 13, .6); ring(-10, -8, 9, .3); ring(26, 26, 6, .4);
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), ctx.mat.padText); mark.rotation.x = -Math.PI / 2; mark.position.set(-10, .14, -8); g.add(mark);
  for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; kit.box(ctx.mat.lampOff, -10 + Math.cos(a) * 16.4, .2, -8 + Math.sin(a) * 16.4, .4, .3, .4); }
  // control tower: concrete shaft, glazed cab, antennae
  kit.box(M.concrete, 30, 7, -22, 6, 14, 6); kit.box(M.darkMetal, 30, 14.3, -22, 8.2, .6, 8.2);
  kit.add(ctx.mat.glassDark, CYL, 30, 15.9, -22, 4.6, 2.6, 4.6); kit.box(M.darkMetal, 30, 17.4, -22, 8.6, .5, 8.6);
  kit.box(M.metal, 31.5, 20, -21, .15, 5, .15); kit.box(M.metal, 28.6, 19, -23, .1, 3, .1);
  ctx.solid(p.x + 30, p.z - 22, 6.4, 6.4, 0, 18);
  // fuel tanks: spheres on legs
  for (const [x, z] of [[-38, 22], [-38, 34]]) {
    kit.add(M.hull, SPH, x, 6, z, 4, 4, 4);
    for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283; kit.box(M.darkMetal, x + Math.cos(a) * 3.6, 3, z + Math.sin(a) * 3.6, .25, 6, .25); }
    ctx.solid(p.x + x, p.z + z, 8.4, 8.4, 0, 10);
  }
  kit.into(g);
  // container yard: rows of stacked containers in several paints
  const paints = [ctx.mat.cOrange, ctx.mat.cBlue, ctx.mat.cOlive, ctx.mat.cGrey, ctx.mat.cRed];
  for (let row = 0; row < 4; row++) for (let i = 0; i < 4; i++) {
    if (r() < .18) continue;
    const x = 2 + i * 6.6, z = 14 + row * 5.5, ry = (r() - .5) * .06;
    container(ctx, g, x, 0, z, ry, paints[Math.floor(r() * 5)], p.x + x, p.z + z, ry);
    if (r() < .45) container(ctx, g, x + (r() - .5) * .4, 2.6, z, ry + (r() - .5) * .1, paints[Math.floor(r() * 5)]);
  }
  for (let i = 0; i < 3; i++) { const x = -30 + i * 7, z = -36, ry = r() * .6; container(ctx, g, x, 0, z, ry, paints[i], p.x + x, p.z + z, ry); }
  for (let i = 0; i < 10; i++) ctx.loot(p.x + 2 + r() * 26, p.z + 11 + Math.floor(r() * 4) * 5.5 + (r() < .5 ? -2 : 2.9), 'cargo');
  for (let i = 0; i < 4; i++) ctx.loot(p.x - 24 + r() * 28, p.z - 26 + r() * 8, 'scrap');
}

function relay(ctx, p) {
  const r = ctx.mulberry(701), g = pad(ctx, p), kit = new Kit(), { M } = ctx;
  lattice(kit, M.metal, 0, 0, 0, 34, 5, .3);
  // dishes part-way up, and guy wires out to anchor blocks
  for (const [y, a] of [[18, .4], [24, 2.6], [12, 4.4]]) {
    const dish = latheX([[0, 0], [1.1, .25], [1.6, .6], [1.65, .62], [0, .1]], 18);
    kit.add(M.hull, dish, Math.cos(a) * 1.4, y, Math.sin(a) * 1.4, 1, 1, 1, 0, -a, -.2);
  }
  for (let i = 0; i < 3; i++) { const a = i / 3 * 6.283 + .5, ax = Math.cos(a) * 12, az = Math.sin(a) * 12; kit.strut(M.darkMetal, new THREE.Vector3(ax, .2, az), new THREE.Vector3(Math.cos(a) * .8, 28, Math.sin(a) * .8), .04); kit.box(M.concrete, ax, .3, az, 1.2, .8, 1.2); }
  // equipment shed with a door and a vent
  kit.box(ctx.mat.panel, 6, 1.5, 4, 5, 3, 3.4); kit.box(ctx.mat.roof, 6, 3.1, 4, 5.4, .2, 3.8); kit.box(M.darkMetal, 3.46, 1.1, 4, .08, 2.2, 1);
  kit.add(M.darkMetal, CYL, 7.5, 3.6, 5, .35, 1, .35);
  kit.into(g);
  const beacon = new THREE.Mesh(SPH, ctx.M.red); beacon.scale.setScalar(.4); beacon.position.set(0, 34.5, 0); g.add(beacon);
  ctx.solid(p.x, p.z, 5.2, 5.2, 0, 34); ctx.solid(p.x + 6, p.z + 4, 5.2, 3.6, 0, 3.3);
  for (let i = 0; i < 5; i++) ctx.loot(p.x + 2 + r() * 7, p.z - 3 - r() * 5, 'relay');
}

function lab(ctx, p) {
  const r = ctx.mulberry(801), g = pad(ctx, p, .3), kit = new Kit(), { M } = ctx, ry = .3;
  // three linked blockhouse wings round a courtyard
  for (const [x, z, w, d] of [[-10, 0, 8, 22], [6, -10, 22, 8], [6, 10, 22, 8]]) {
    kit.box(M.concrete, x, 2.2, z, w, 4.4, d); kit.box(M.darkMetal, x, 4.5, z, w + .3, .25, d + .3);
    const wpt = toWorld(p, ry, x, z); ctx.solid(wpt.x, wpt.z, w, d, ry, 4.6);
  }
  // shattered windows and blast doors facing the courtyard
  for (let i = 0; i < 4; i++) kit.box(ctx.mat.window, -5.96, 2.4, -7.5 + i * 5, .06, 1.2, 2.6);
  for (let i = 0; i < 4; i++) { kit.box(i === 2 ? ctx.mat.windowLit : ctx.mat.window, -1 + i * 4.6, 2.4, -5.96, 2.6, 1.2, .06); kit.box(ctx.mat.window, -1 + i * 4.6, 2.4, 5.96, 2.6, 1.2, .06); }
  kit.box(ctx.mat.hazard, 17.05, 1.6, 10, .06, 3.2, 3); kit.box(ctx.mat.hazard, 17.05, 1.6, -10, .06, 3.2, 3);
  // specimen tanks in the courtyard: two intact and glowing, one burst open
  for (const [x, z, broken] of [[2, -2, false], [6, 2, false], [10, -1, true]]) {
    kit.add(M.darkMetal, CYL, x, .25, z, 1, .5, 1); kit.add(M.darkMetal, CYL, x, 3.3, z, 1, .4, 1);
    if (!broken) { kit.add(ctx.mat.tankGlow, CYL, x, 1.8, z, .8, 2.6, .8); kit.add(ctx.mat.glass, CYL, x, 1.8, z, .9, 2.7, .9); }
    else for (let i = 0; i < 6; i++) { const a = r() * 6.283; kit.box(ctx.mat.glass, x + Math.cos(a) * 1.4, .06, z + Math.sin(a) * 1.4, .6, .04, .4, a); }
    ctx.solid(toWorld(p, ry, x, z).x, toWorld(p, ry, x, z).z, 2, 2, 0, 3.6);
  }
  // quarantine fence round the outside, sagging in places
  for (let i = 0; i < 26; i++) { const a = i / 26 * 6.283, R = 23; kit.box(M.darkMetal, Math.cos(a) * R, 1.3, Math.sin(a) * R, .1, 2.6, .1); if (i % 5 !== 3) kit.box(ctx.mat.fence, Math.cos(a + .12) * R, 1.3, Math.sin(a + .12) * R, .04, 2.2, 5.6, -a - .12); }
  // the hive is reclaiming it: resin crawling over the west wing
  resinPatch(ctx, kit, -12, 0, -6, 9, r);
  kit.into(g);
  for (const [t, x, z] of [['drone', 0, 12], ['drone', -14, -14], ['spitter', 14, 0], ['drone', 8, -16]]) { const w = toWorld(p, ry, x, z); ctx.sleeper(t, w.x, w.z, 'lab'); }
  for (let i = 0; i < 8; i++) { const w = toWorld(p, ry, -1 + r() * 15, -4 + r() * 8); ctx.loot(w.x, w.z, 'lab'); }
}

function reactor(ctx, p) {
  const r = ctx.mulberry(901), g = pad(ctx, p), kit = new Kit(), { M } = ctx;
  // two hyperboloid cooling towers trailing steam
  const towerGeo = new THREE.LatheGeometry([[7.5, 0], [6.6, 4], [5.4, 10], [5.0, 13], [5.3, 16], [5.6, 18], [5.4, 18], [5.1, 16], [4.8, 13], [5.2, 10], [6.4, 4], [7.3, 0]].map(([a, b]) => new THREE.Vector2(a, b)), 36);
  for (const [x, z] of [[-14, -10], [-14, 10]]) { kit.add(M.concrete, towerGeo, x, 0, z); ctx.solid(p.x + x, p.z + z, 13, 13, 0, 18); ctx.vent(p.x + x, ctx.H(p.x, p.z) + 17, p.z + z, 'steam'); }
  // turbine hall with a sawtooth roof
  kit.box(ctx.mat.panel, 10, 4, 0, 14, 8, 22); for (let i = 0; i < 4; i++) kit.box(ctx.mat.roof, 10, 8.6, -8.2 + i * 5.5, 14.4, .25, 5.8, 0, .25);
  kit.box(M.darkMetal, 2.96, 2.2, 0, .1, 4.4, 4);
  ctx.solid(p.x + 10, p.z, 14.2, 22.2, 0, 9);
  // pipe runs on supports, and transformers
  for (const z of [-3, 3]) { kit.add(M.hull, CYL, -2, 3, z, .5, 18, .5, 0, 0, Math.PI / 2); for (let i = 0; i < 4; i++) kit.box(M.darkMetal, -9 + i * 5, 1.4, z, .25, 2.8, .25); }
  kit.add(M.hull, CYL, 10, 3.2, 14, .7, 20, .7, Math.PI / 2, 0, 0);
  for (let i = 0; i < 3; i++) { kit.box(M.darkMetal, 22, 1.3, -8 + i * 5, 2.4, 2.6, 3); for (let j = 0; j < 4; j++) kit.add(M.hull, CYL, 22, 2.9, -8.9 + i * 5 + j * .6, .12, .9, .12); ctx.solid(p.x + 22, p.z - 8 + i * 5, 2.6, 3.2, 0, 3.4); }
  // a geothermal well head venting steam
  kit.add(M.darkMetal, CYL, 0, .6, -22, 1.4, 1.2, 1.4); kit.add(M.hull, CYL, 0, 2.2, -22, .5, 2.4, .5);
  ctx.vent(p.x, ctx.H(p.x, p.z) + 3.5, p.z - 22, 'steam');
  kit.into(g);
  for (let i = 0; i < 8; i++) { const a = r() * 6.283, d = 4 + r() * 22; ctx.loot(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, 'reactor'); }
}

function wreck(ctx, p) {
  const r = ctx.mulberry(1001), ry = -.5, g = pad(ctx, p, ry), kit = new Kit(), { SHIP, M } = ctx;
  // a heavy hauler broken in three: forward section nose-down, mid-body on its side, tail upright
  const sec = (x, w, h, y, n = 4) => ({ x, w, h, y, n, belly: .3 });
  const fwd = loft([sec(-6, 7, 6, 3), sec(4, 7, 6.2, 3.1), sec(9, 5, 4.4, 2.6, 3), sec(12, 2, 1.6, 2, 2.5)], 20);
  kit.add(SHIP.hull, fwd, 14, -.6, -2, 1, 1, 1, 0, .25, -.12);
  const mid = loft([sec(-7, 7, 6, 3), sec(7, 7, 6, 3)], 20);
  kit.add(SHIP.soot, mid, -2, .4, 3, 1, 1, 1, 1.25, -.2, 0);
  const tail = loft([sec(-8, 3, 3, 3.2), sec(-6, 6.4, 5.6, 3), sec(2, 7, 6, 3)], 20);
  kit.add(SHIP.hull, tail, -20, 0, -4, 1, 1, 1, 0, .4, .05);
  for (const s of [-1, 1]) kit.add(SHIP.belly, CYL, -27, 3.2, -4 + s * 2.4 + 2.5 * Math.sin(.4), 1.3, 3, 1.3, 0, .4, Math.PI / 2);
  kit.box(SHIP.hull, -22, 7.5, -3.2, 5, 4.5, .4, .4, 0, .3); // tail fin
  // spilled cargo and torn plating along the scar
  for (let i = 0; i < 26; i++) { const x = -28 + r() * 50, z = -10 + r() * 20; kit.box(r() < .5 ? SHIP.soot : SHIP.hull, x, .2, z, .6 + r() * 2.4, .08 + r() * .2, .5 + r() * 1.6, r() * 6.283, (r() - .5) * .6, (r() - .5) * .6); }
  kit.box(M.burnt, 0, .02, 0, 64, .04, 12);
  kit.into(g);
  const paints = [ctx.mat.cOrange, ctx.mat.cBlue, ctx.mat.cGrey];
  for (let i = 0; i < 6; i++) { const x = -18 + r() * 34, z = (r() < .5 ? -1 : 1) * (8 + r() * 5), cr = r() * 6.283, w = toWorld(p, ry, x, z); container(ctx, g, x, 0, z, cr, paints[i % 3], w.x, w.z, cr + ry); }
  for (const [x, z] of [[14, -2], [-2, 3], [-20, -4]]) { const w = toWorld(p, ry, x, z); ctx.solid(w.x, w.z, 15, 7, ry, 7); }
  for (const [x, z] of [[8, -1], [-6, 6], [-24, -2]]) { const w = toWorld(p, ry, x, z); ctx.vent(w.x, ctx.H(w.x, w.z) + 1.5, w.z, 'fire'); }
  for (let i = 0; i < 10; i++) { const w = toWorld(p, ry, -26 + r() * 46, (r() < .5 ? -1 : 1) * (5.5 + r() * 6)); ctx.loot(w.x, w.z, i < 6 ? 'cargo' : 'scrap'); }
}

function pocket(ctx, p, i) {
  const r = ctx.mulberry(1100 + i), g = pad(ctx, p), kit = new Kit();
  resinPatch(ctx, kit, 0, 0, 0, 12, r);
  kit.into(g);
  const n = i === 2 ? 3 : 5;
  for (let j = 0; j < n; j++) { const a = j / n * 6.283; ctx.sleeper('drone', p.x + Math.cos(a) * 7, p.z + Math.sin(a) * 7, p.id); }
  if (i !== 2) ctx.sleeper('warrior', p.x + 2, p.z - 1, p.id);
  for (let j = 0; j < 3; j++) { const a = r() * 6.283; ctx.loot(p.x + Math.cos(a) * 9, p.z + Math.sin(a) * 9, 'hive'); }
}

function crater(ctx, p) {
  const r = ctx.mulberry(1201), g = new THREE.Group(), kit = new Kit(), { M } = ctx;
  g.position.set(p.x, 0, p.z); ctx.scene.add(g); ctx.cull(g, p.x, p.z, p.r2);
  // the impactor, half-buried, ringed by glowing crystal growths
  const by = ctx.H(p.x, p.z);
  kit.add(M.burnt, SPH, 0, by + 1, 0, 6, 4, 5, .3, .5, .2);
  for (let i = 0; i < 26; i++) {
    const a = r() * 6.283, d = 6 + r() * 24, x = Math.cos(a) * d, z = Math.sin(a) * d, y = ctx.H(p.x + x, p.z + z);
    for (let j = 0; j < 3; j++) kit.add(ctx.mat.crystal, CONE, x + (r() - .5), y + .6, z + (r() - .5), .25 + r() * .3, 1.4 + r() * 2, .25 + r() * .3, (r() - .5) * .9, 0, (r() - .5) * .9);
  }
  // a survey team's camp on the rim
  const cx = 0, cz = -p.r - 6, cy = ctx.H(p.x + cx, p.z + cz);
  kit.box(ctx.mat.tent, cx, cy + 1, cz, 4, 2, 3); kit.box(ctx.mat.tent, cx + 5, cy + .8, cz + 1, 3, 1.6, 2.4, .4);
  kit.box(M.darkMetal, cx - 4, cy + 1.6, cz, .1, 3.2, .1);
  kit.into(g);
  ctx.solid(p.x, p.z, 10, 8, .5, by + 4);
  for (let i = 0; i < 3; i++) ctx.loot(p.x + cx + (r() - .5) * 8, p.z + cz + 2.5 + r() * 2, 'scrap');
  for (let i = 0; i < 4; i++) { const a = r() * 6.283, d = 8 + r() * 18; ctx.loot(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, 'crater'); }
}

function lake(ctx, p) {
  const r = ctx.mulberry(1301), g = new THREE.Group(); g.position.set(p.x, p.y, p.z); ctx.scene.add(g); ctx.cull(g, p.x, p.z, p.r2);
  const ice = new THREE.Mesh(new THREE.CircleGeometry(p.r * .98, 64), ctx.mat.ice); ice.rotation.x = -Math.PI / 2; ice.receiveShadow = true; g.add(ice);
  // an ice-drilling shack and its rig out on the lake
  const kit = new Kit(), { M } = ctx;
  kit.box(ctx.mat.panel, 8, 1.3, 6, 4, 2.6, 3); kit.box(ctx.mat.roof, 8, 2.7, 6, 4.4, .2, 3.4);
  lattice(kit, M.metal, 14, 0, 2, 9, 2.2, .4); kit.add(M.darkMetal, CYL, 14, 1, 2, .5, 2, .5);
  for (let i = 0; i < 5; i++) { const a = r() * 6.283; kit.box(M.darkMetal, Math.cos(a) * 20, .05, Math.sin(a) * 20, .8 + r() * 2, .05, .1, a); }
  kit.into(g);
  ctx.solid(p.x + 8, p.z + 6, 4.2, 3.2, 0, 3); ctx.solid(p.x + 14, p.z + 2, 2.4, 2.4, 0, 9);
  for (let i = 0; i < 4; i++) ctx.loot(p.x + 6 + r() * 5, p.z + 8.5 + r() * 1.5, 'scrap');
}

/** Builds every point of interest that isn't the crash site or the main nest (game.js builds those). */
export function buildPOIs(ctx, pois) {
  let pocketI = 0;
  for (const p of pois) {
    if (p.kind === 'dome') { ctx.buildDome(p, ctx.mulberry(300 + p.x)); for (let i = 0; i < 5; i++) { const a = Math.random() * 6.283, m2 = Math.random() * 6.5; ctx.loot(p.x + Math.cos(a) * m2, p.z + Math.sin(a) * m2, 'dome'); } }
    else if (p.kind === 'rig') { ctx.buildRig(p, ctx.mulberry(400 + p.x)); for (let i = 0; i < 4; i++) ctx.loot(p.x - 4.5 + Math.random() * 3, p.z + 1 + Math.random() * 3.5, 'rig'); }
    else if (p.kind === 'town') town(ctx, p);
    else if (p.kind === 'port') port(ctx, p);
    else if (p.kind === 'relay') relay(ctx, p);
    else if (p.kind === 'lab') lab(ctx, p);
    else if (p.kind === 'reactor') reactor(ctx, p);
    else if (p.kind === 'wreck') wreck(ctx, p);
    else if (p.kind === 'pocket') pocket(ctx, p, pocketI++);
    else if (p.kind === 'crater') crater(ctx, p);
    else if (p.kind === 'lake') lake(ctx, p);
  }
}
