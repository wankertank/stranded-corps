import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { triplanar, type PBRSet } from './materials';
import { latheX } from './shapes';
import { noise2 } from './skarn';

/**
 * First-person weapons and the marine's hands, built in code.
 *
 * Guns are modelled from side-profile extrusions with bevelled, rounded corners (receivers, grips,
 * stocks, magazines), lathed parts (barrels, tubes, tanks) and small hardware (screws, pins, rails),
 * merged into one mesh per material. Finishes are object-space triplanar so the grain rides with
 * the gun instead of swimming as the camera moves.
 *
 * Every gun is authored with its muzzle along +x, y up and +z on the right-hand side (the side the
 * player sees), in metres. Hands are posed in that same space and follow parts during reloads.
 */

type P2 = [number, number];
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = THREE.MathUtils.lerp;

// ---------- surface textures, generated once ----------

function canvasSet(N: number, height: (u: number, v: number, x: number, y: number) => number,
  color: (h: number, u: number, v: number, i: number) => [number, number, number],
  arm: (h: number, u: number, v: number, i: number) => [number, number, number], bump = 2): PBRSet {
  const hgt = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) hgt[y * N + x] = height(x / N, y / N, x, y);
  const H = (x: number, y: number) => hgt[((y + N) % N) * N + ((x + N) % N)];
  let mr = 0, mg = 0, mb = 0;
  const tex = (fn: (d: Uint8ClampedArray, i: number, x: number, y: number) => void, srgb: boolean) => {
    const c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d')!, img = g.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = (y * N + x) * 4; fn(img.data, i, x, y); img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t;
  };
  const lin = (c: number) => Math.pow(c / 255, 2.2);
  const colorT = tex((d, i, x, y) => {
    const [r, g, b] = color(H(x, y), x / N, y / N, y * N + x); d[i] = r; d[i + 1] = g; d[i + 2] = b; mr += lin(r); mg += lin(g); mb += lin(b);
  }, true);
  const normal = tex((d, i, x, y) => {
    const dx = (H(x + 1, y) - H(x - 1, y)) * bump, dy = (H(x, y + 1) - H(x, y - 1)) * bump, l = Math.hypot(dx, dy, 1);
    d[i] = (-dx / l * .5 + .5) * 255; d[i + 1] = (dy / l * .5 + .5) * 255; d[i + 2] = (1 / l * .5 + .5) * 255;
  }, false);
  const armT = tex((d, i, x, y) => { const [a, r, m] = arm(H(x, y), x / N, y / N, y * N + x); d[i] = a; d[i + 1] = r; d[i + 2] = m; }, false);
  const n = N * N;
  return { color: colorT, normal, arm: armT, mean: V(mr / n, mg / n, mb / n) };
}

// a tileable scratch mask: short random strokes that wrap at the edges
function scratchMask(N: number, count: number, seed: number): Float32Array {
  const m = new Float32Array(N * N); let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let k = 0; k < count; k++) {
    let x = rnd() * N, y = rnd() * N; const a = rnd() * Math.PI * 2, len = 6 + rnd() * rnd() * 60, w = rnd() < .2 ? 1 : .6;
    for (let j = 0; j < len; j++) { m[(((y | 0) % N + N) % N) * N + (((x | 0) % N + N) % N)] = w; x += Math.cos(a + Math.sin(j * .2) * .1); y += Math.sin(a); }
  }
  return m;
}

/** Worn gun finish: fine grain, light pitting and bright scratches through to bare metal. */
function finishSet(): PBRSet {
  const N = 256, sc = scratchMask(N, 70, 9);
  return canvasSet(N, (u, v, x, y) => noise2(u * 64, v * 64, 64, 7) * .35 + noise2(u * 128, v * 128, 128, 8) * .25 + noise2(u * 8, v * 8, 8, 3) * .2 - sc[y * N + x] * .25,
    (h, u, v, i) => { const k = 168 + (h - .4) * 30 + sc[i] * 70; return [k, k, k]; },
    (h, u, v, i) => [235 + h * 20, 190 + noise2(u * 6, v * 6, 6, 5) * 60 - sc[i] * 110, 130 + sc[i] * 125], 1.6);
}
/** Moulded polymer with an aggressive stipple, for grips and fore-ends. */
function stippleSet(): PBRSet {
  return canvasSet(256, (u, v) => Math.pow(noise2(u * 56, v * 56, 56, 11), 2.2) + noise2(u * 112, v * 112, 112, 12) * .25,
    (h) => { const k = 158 + h * 25; return [k, k, k]; }, (h) => [200 + h * 55, 230 - h * 40, 0], 3);
}
/** Twill fatigue cloth. */
function weaveSet(): PBRSet {
  const T = 28;
  return canvasSet(256, (u, v) => {
    const a = u * T, b = v * T + Math.floor(a) * .5, fa = a % 1, fb = b % 1, over = (Math.floor(a) + Math.floor(b)) % 2;
    return (over ? Math.sin(Math.PI * fa) : Math.sin(Math.PI * fb)) * .7 + noise2(u * 64, v * 64, 64, 21) * .3;
  }, (h, u, v) => { const k = 140 + h * 50 + (noise2(u * 4, v * 4, 4, 22) - .5) * 30; return [k, k * 1.02, k * .95]; }, (h) => [150 + h * 105, 255, 0], 1.4);
}
/** Pebbled synthetic leather for gloves. */
function leatherSet(): PBRSet {
  return canvasSet(256, (u, v) => noise2(u * 40, v * 40, 40, 31) * .6 + noise2(u * 90, v * 90, 90, 32) * .3 + Math.max(0, .5 - Math.abs(noise2(u * 6, v * 6, 6, 33) - .5) * 14) * .2,
    (h) => { const k = 150 + h * 40; return [k, k, k]; }, (h) => [190 + h * 65, 200 + (1 - h) * 50, 0], 2.2);
}

export interface WeaponMaterials {
  olive: THREE.MeshStandardMaterial; steel: THREE.MeshStandardMaterial; polymer: THREE.MeshStandardMaterial;
  grip: THREE.MeshStandardMaterial; bore: THREE.MeshStandardMaterial; bright: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial; brass: THREE.MeshStandardMaterial; fuel: THREE.MeshStandardMaterial;
  hazard: THREE.MeshStandardMaterial; glove: THREE.MeshStandardMaterial; pad: THREE.MeshStandardMaterial;
  sleeve: THREE.MeshStandardMaterial; stencil: THREE.MeshStandardMaterial; lens: THREE.MeshStandardMaterial;
}

export function weaponMaterials(): WeaponMaterials {
  const fin = finishSet(), stip = stippleSet(), weave = weaveSet(), leather = leatherSet();
  const std = (color: string, roughness: number, metalness: number, set?: PBRSet, scale = 9, opts: Record<string, number> = {}) => {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness });
    if (set) triplanar(m, set, { scale, objectSpace: true, normalStrength: 1, ...opts });
    return m;
  };
  return {
    olive: std('#343b2c', .6, .35, fin, 7, { useMetal: .9, ao: .3, normalStrength: .3 }),
    steel: std('#2c2f33', .48, .8, fin, 9, { useMetal: .5, ao: .3, normalStrength: .3 }),
    polymer: std('#1e2021', .62, .05, fin, 6, { ao: .3, normalStrength: .2 }),
    grip: std('#1f2020', .85, 0, stip, 30, { ao: .5 }),
    bore: std('#0b0b0b', .7, .4),
    bright: std('#9aa0a6', .32, 1, fin, 14, { ao: .2, normalStrength: .2 }),
    rubber: std('#151515', .92, 0, stip, 40, { ao: .4, normalStrength: .6 }),
    brass: std('#b48a3e', .32, 1, fin, 20, { ao: .2, normalStrength: .2 }),
    fuel: std('#6e2c16', .5, .3, fin, 6, { useMetal: .9, ao: .3, normalStrength: .3 }),
    hazard: std('#a8841c', .6, .2, fin, 6, { useMetal: .9, ao: .3, normalStrength: .3 }),
    glove: std('#2b2924', .78, 0, leather, 34, { ao: .5, normalStrength: .45 }),
    pad: std('#171817', .6, 0, stip, 50, { ao: .6, normalStrength: .7 }),
    sleeve: std('#3a3f2f', 1, 0, weave, 26, { ao: .6, normalStrength: .6 }),
    stencil: new THREE.MeshStandardMaterial({ map: stencilTex(), transparent: true, roughness: .7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    lens: new THREE.MeshStandardMaterial({ color: new THREE.Color('#0c1a20'), roughness: .05, metalness: .6, emissive: new THREE.Color('#1a5a70'), emissiveIntensity: .25 }),
  };
}

// faded paint markings: one atlas, each decal samples its own strip
const STENCILS = ['PR-7   CAL 10x24 CASELESS   FEC ORDNANCE', 'SAFE  SEMI  AUTO', 'M-9 INCINERATOR   FUEL: N-TRIGEL   DANGER', 'SG-4 SMART GUN   10x28   VEYRA SYS', 'FEC'];
function stencilTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 64 * STENCILS.length;
  const g = c.getContext('2d')!; g.clearRect(0, 0, c.width, c.height);
  STENCILS.forEach((s, i) => {
    g.font = 'bold 36px monospace'; g.fillStyle = 'rgba(214,206,178,.82)'; g.textBaseline = 'middle'; g.fillText(s, 12, i * 64 + 34);
    // wear: knock random flecks out of the paint
    g.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 260; k++) { g.fillStyle = `rgba(0,0,0,${Math.random() * .8})`; g.fillRect(Math.random() * 1024, i * 64 + Math.random() * 64, 1 + Math.random() * 4, 1 + Math.random() * 2); }
    g.globalCompositeOperation = 'source-over';
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function stencil(m: WeaponMaterials, row: number, chars: number, height: number): THREE.Mesh {
  const w = chars * height * .62, geo = new THREE.PlaneGeometry(w, height);
  const uv = geo.attributes.uv as THREE.BufferAttribute, n = STENCILS.length, u1 = (12 + chars * 21.7) / 1024;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u1, (n - 1 - row + .12 + uv.getY(i) * .76) / n);
  const mesh = new THREE.Mesh(geo, m.stencil); mesh.renderOrder = 2; return mesh;
}

// ---------- geometry helpers ----------

/** A polygon with each corner replaced by a quadratic fillet of radius `r` (per corner if an array). */
function rounded(pts: P2[], r: number | number[], seg = 3): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length];
    const ri = Array.isArray(r) ? r[i] : r;
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const d = Math.min(ri, la * .45, lb * .45);
    if (d <= 1e-5) { out.push(new THREE.Vector2(p[0], p[1])); continue; }
    const p0 = [p[0] + (a[0] - p[0]) / la * d, p[1] + (a[1] - p[1]) / la * d], p2 = [p[0] + (b[0] - p[0]) / lb * d, p[1] + (b[1] - p[1]) / lb * d];
    for (let k = 0; k <= seg; k++) {
      const t = k / seg, s = 1 - t;
      out.push(new THREE.Vector2(s * s * p0[0] + 2 * s * t * p[0] + t * t * p2[0], s * s * p0[1] + 2 * s * t * p[1] + t * t * p2[1]));
    }
  }
  return out;
}

/** A side profile in the x/y plane, `t` thick along z and centred on it, with bevelled edges. */
function side(pts: P2[], t: number, r: number | number[] = .004, bevel = .0025, holes: { pts: P2[]; r?: number }[] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape(rounded(pts, r));
  for (const h of holes) shape.holes.push(new THREE.Path(rounded(h.pts, h.r ?? .003)));
  const b = Math.min(bevel, t * .3), depth = Math.max(1e-4, t - 2 * b);
  const g = new THREE.ExtrudeGeometry(shape, { depth, curveSegments: 1, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2 });
  g.translate(0, 0, -depth / 2);
  return g;
}
/** A bevelled box centred on the origin, `l` along x, `h` along y, `t` along z. */
function rbox(l: number, h: number, t: number, r = .003, bevel = .0015): THREE.BufferGeometry {
  return side([[-l / 2, -h / 2], [l / 2, -h / 2], [l / 2, h / 2], [-l / 2, h / 2]], t, r, bevel);
}
/** A lathed part along +x from a list of [radius, x] stations. */
const tube = (profile: P2[], seg = 20) => latheX(profile, seg);
const cylX = (r: number, x0: number, x1: number, seg = 16) => tube([[0, x0], [r, x0], [r, x1], [0, x1]], seg);
/** A small slotted screw head facing +z (or -z). */
const SCREW = (() => { const g = tube([[0, 0], [.0034, 0], [.0034, .0008], [.0028, .0015], [0, .0016]], 10); g.rotateY(-Math.PI / 2); return g; })();

/** Collects transformed geometry per material and merges it into one mesh each. */
class Kit {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler();
  add(mat: THREE.Material, geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s: number | [number, number, number] = 1): this {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const sc = Array.isArray(s) ? V(...s) : V(s, s, s);
    this.m.compose(V(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz)), sc);
    g = g.applyMatrix4(this.m);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat)!.push(g);
    return this;
  }
  screw(mat: THREE.Material, x: number, y: number, z: number, flip = false): this { return this.add(mat, SCREW, x, y, z, 0, flip ? Math.PI : 0, (x * 7919 + y * 104729) % 3); }
  /** A picatinny-style rail along x on top of something at height y. */
  rail(mat: THREE.Material, x0: number, x1: number, y: number, z = 0, w = .021): this {
    this.add(mat, rbox(x1 - x0, .006, w, .001, .0008), (x0 + x1) / 2, y + .003, z);
    for (let x = x0 + .004; x < x1 - .004; x += .01) this.add(mat, rbox(.0052, .004, w + .002, .0008, .0006), x + .0026, y + .008, z);
    return this;
  }
  into(parent: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, list] of this.parts) { const mesh = new THREE.Mesh(mergeGeometries(list), mat); parent.add(mesh); out.push(mesh); }
    this.parts.clear(); return out;
  }
}

// ---------- hands ----------

export interface HandPose { f: [number, number, number][]; t: [number, number, number, number, number] }
export const POSE: Record<string, HandPose> = {
  // trigger hand: three fingers wrapped round the grip, index laid on the trigger, thumb over the far side
  trigger: { f: [[.25, .95, .5], [1.45, 1.45, .85], [1.5, 1.45, .85], [1.55, 1.35, .8]], t: [.1, .9, 0, .45, .3] },
  // support hand wrapped round a fore-end or front grip
  wrap: { f: [[1.25, 1.3, .7], [1.35, 1.35, .75], [1.4, 1.35, .75], [1.45, 1.3, .7]], t: [.1, .9, 0, .5, .35] },
  // cupping a magazine or tank
  hold: { f: [[.75, .9, .5], [.85, .95, .55], [.9, .95, .55], [.95, .9, .5]], t: [.3, .7, 0, .2, .15] },
  // pinching a charging handle
  pinch: { f: [[1.0, 1.1, .7], [1.5, 1.5, .8], [1.6, 1.5, .8], [1.6, 1.4, .8]], t: [.4, .6, 0, .3, .2] },
};
function mixPose(a: HandPose, b: HandPose, t: number, out: HandPose): HandPose {
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) out.f[i][j] = lerp(a.f[i][j], b.f[i][j], t);
  for (let j = 0; j < 5; j++) out.t[j] = lerp(a.t[j], b.t[j], t);
  return out;
}
const blankPose = (): HandPose => ({ f: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], t: [0, 0, 0, 0, 0] });

// knuckle position, segment lengths and radius per finger, index first
const FINGERS = [
  { x: .086, y: .026, L: [.043, .026, .022], r: .0104 },
  { x: .09, y: .0085, L: [.047, .029, .024], r: .0107 },
  { x: .087, y: -.009, L: [.044, .027, .023], r: .0102 },
  { x: .079, y: -.025, L: [.035, .021, .02], r: .0091 },
];
function segGeo(L: number, r0: number, r1: number): THREE.BufferGeometry {
  return tube([[0, -r0 * .85], [r0 * .62, -r0 * .7], [r0 * .93, -r0 * .3], [r0, 0], [(r0 + r1) / 2 * 1.02, L * .5], [r1, L], [r1 * .9, L + r1 * .4], [r1 * .55, L + r1 * .78], [0, L + r1 * .88]], 12);
}

export class Hand {
  readonly root = new THREE.Group();
  private fingers: THREE.Group[][] = [];
  private thumb: THREE.Group[] = [];
  private cur = blankPose();
  /**
   * A gloved hand. Native frame: the wrist at the origin, fingers along +x, index toward +y and the
   * back of the hand toward +z. `side` -1 mirrors it into a left hand (palm toward +z instead).
   */
  constructor(m: WeaponMaterials, side: 1 | -1) {
    const mirror = new THREE.Group(); mirror.scale.z = side; this.root.add(mirror);
    const kit = new Kit();
    // palm: a lofted slab from the wrist to the knuckles, plus the thumb's muscle pad
    kit.add(m.glove, palmGeo());
    kit.add(m.glove, new THREE.SphereGeometry(1, 12, 9), .032, .02, -.009, 0, 0, .5, [.034, .021, .013]);
    kit.add(m.glove, new THREE.SphereGeometry(1, 12, 9), .055, -.02, -.01, 0, 0, 0, [.032, .02, .01]);
    // armoured knuckle guard and a back-of-hand plate
    kit.add(m.pad, side4([[.064, -.033], [.096, -.03], [.098, .036], [.066, .038]], .0045), 0, 0, .016, 0, 0, 0);
    kit.add(m.pad, side4([[.02, -.024], [.05, -.028], [.052, .03], [.022, .028]], .0035), 0, 0, .0195, 0, 0, 0);
    kit.into(mirror);
    FINGERS.forEach((F, i) => {
      const chain: THREE.Group[] = []; let parent: THREE.Object3D = mirror, px = F.x, r = F.r;
      for (let j = 0; j < 3; j++) {
        const joint = new THREE.Group(); joint.position.set(j === 0 ? px : F.L[j - 1], j === 0 ? F.y : 0, 0);
        if (j === 0) joint.rotation.z = (F.y - .005) * 1.6; // slight natural fan
        parent.add(joint);
        const r1 = r * (j === 2 ? .82 : .93), seg = new THREE.Mesh(segGeo(F.L[j], r, r1), m.glove); joint.add(seg);
        if (j < 2) { const pad = new THREE.Mesh(rbox(F.L[j] * .5, r * 1.1, .003, .0015, .001), m.pad); pad.position.set(F.L[j] * .5, 0, r * .9); joint.add(pad); }
        chain.push(joint); parent = joint; r = r1;
      }
      this.fingers.push(chain);
    });
    let parent: THREE.Object3D = mirror; const TL = [.036, .03, .025], TR = [.0135, .0118, .0108];
    for (let j = 0; j < 3; j++) {
      const joint = new THREE.Group(); if (j === 0) joint.position.set(.018, .024, -.01); else joint.position.x = TL[j - 1];
      joint.rotation.order = 'XYZ'; parent.add(joint);
      joint.add(new THREE.Mesh(segGeo(TL[j], TR[j], TR[j] * .92), m.glove));
      this.thumb.push(joint); parent = joint;
    }
    this.root.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
  }
  pose(p: HandPose): void {
    this.fingers.forEach((chain, i) => chain.forEach((j, k) => { j.rotation.y = p.f[i][k]; }));
    const [abd, opp, roll, c1, c2] = p.t, t = this.thumb;
    // the thumb swings out toward the index (abd), round in front of the palm (opp), then its joints fold toward the little finger
    t[0].rotation.set(roll, opp, .3 + abd); t[1].rotation.set(0, opp * .25, -c1); t[2].rotation.set(0, 0, -c2);
  }
  blend(a: HandPose, b: HandPose, k: number): void { this.pose(mixPose(a, b, k, this.cur)); }
}
// a thin rounded plate in the x/y plane (knuckle guards), t thick along z
function side4(pts: P2[], t: number): THREE.BufferGeometry { return side(pts, t, .006, .002); }
function palmGeo(): THREE.BufferGeometry {
  // superellipse sections: w is thickness (z), h is width (y)
  const S = [[-.012, .036, .052, 0, 2.2], [.004, .044, .062, 0], [.03, .046, .076, .001], [.06, .04, .084, .001], [.085, .033, .086, .001], [.1, .022, .074, .001], [.106, .01, .05, .001]];
  const pos: number[] = [], idx: number[] = [], R = 18;
  for (const [x, w, h, y] of S) for (let i = 0; i < R; i++) {
    const a = i / R * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), n = 2.6;
    pos.push(x, y + Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * h / 2, Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * w / 2);
  }
  for (let k = 0; k < S.length - 1; k++) for (let i = 0; i < R; i++) { const a = k * R + i, b = k * R + (i + 1) % R; idx.push(a, a + R, b, b, a + R, b + R); }
  const c0 = pos.length / 3; pos.push(S[0][0] - .004, 0, 0); for (let i = 0; i < R; i++) idx.push(c0, i, (i + 1) % R);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** Forearm: glove cuff with a strap, then a fatigue sleeve, along +x from the wrist toward the elbow. */
function armGroup(m: WeaponMaterials, device: boolean): THREE.Group {
  const g = new THREE.Group(), kit = new Kit();
  const ring = (x0: number, x1: number, r0: number, r1: number) => tube([[0, x0], [r0, x0], [r0 * 1.04, x0 + .004], [r1 * 1.04, x1 - .004], [r1, x1], [0, x1]], 18);
  kit.add(m.glove, ring(-.02, .075, .027, .032), 0, 0, 0, 0, 0, 0, [1, .9, 1.12]);
  kit.add(m.pad, ring(.012, .04, .0295, .031), 0, 0, 0, 0, 0, 0, [1, .9, 1.12]); // velcro wrist strap
  kit.add(m.sleeve, tube([[0, .06], [.034, .06], [.038, .07], [.039, .095], [.036, .105], [.037, .13], [.043, .35], [.049, .55], [.052, .75], [0, .76]], 18), 0, 0, 0, 0, 0, 0, [1, .92, 1.08]);
  if (device) {
    // wrist display strapped over the sleeve
    kit.add(m.polymer, rbox(.07, .016, .052, .006), .12, .047, 0);
    kit.add(m.pad, rbox(.016, .012, .085, .003), .1, .039, 0); kit.add(m.pad, rbox(.016, .012, .085, .003), .145, .041, 0);
    kit.add(m.bright, rbox(.012, .004, .006, .001), .09, .056, .018);
  }
  kit.into(g);
  if (device) {
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(.05, .036), new THREE.MeshBasicMaterial({ map: wristTex(), toneMapped: false }));
    scr.rotation.x = -Math.PI / 2; scr.rotation.z = Math.PI / 2; scr.position.set(.122, .0555, 0); g.add(scr);
  }
  g.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
  return g;
}
function wristTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 128; c.height = 96; const g = c.getContext('2d')!;
  g.fillStyle = '#04120c'; g.fillRect(0, 0, 128, 96);
  g.strokeStyle = 'rgba(80,255,170,.55)'; g.lineWidth = 2;
  for (const r of [14, 28, 42]) { g.beginPath(); g.arc(64, 92, r * 1.6, Math.PI * 1.2, Math.PI * 1.8); g.stroke(); }
  g.fillStyle = 'rgba(110,255,190,.9)'; g.font = 'bold 14px monospace'; g.fillText('VITALS OK', 8, 18); g.fillText('O2 92%', 8, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** One hand and its forearm, posed against the gun and able to move off to fetch parts. */
class Rig {
  hand: Hand; arm: THREE.Group;
  homePos: THREE.Vector3; homeQ: THREE.Quaternion; elbow: THREE.Vector3; pose: HandPose;
  constructor(parent: THREE.Object3D, m: WeaponMaterials, side: 1 | -1, at: { pos: THREE.Vector3; F: THREE.Vector3; K: THREE.Vector3 }, elbow: THREE.Vector3, pose: HandPose, device = false) {
    const { pos, F, K } = at;
    this.hand = new Hand(m, side); this.arm = armGroup(m, device);
    this.hand.root.userData.limb = this.arm.userData.limb = true;
    parent.add(this.hand.root, this.arm);
    this.homePos = pos.clone(); this.homeQ = basis(F, K, side); this.elbow = elbow.clone(); this.pose = pose;
    this.place(this.homePos, this.homeQ); this.hand.pose(pose);
  }
  private static _d = V(); private static _u = V(); private static _z = V(); private static _m = new THREE.Matrix4();
  place(pos: THREE.Vector3, q: THREE.Quaternion): void {
    this.hand.root.position.copy(pos); this.hand.root.quaternion.copy(q);
    // the forearm runs from the wrist toward a fixed elbow point, rolled so its top stays up
    const d = Rig._d.subVectors(this.elbow, pos).normalize(), u = Rig._u.set(0, 1, 0), z = Rig._z.crossVectors(d, u).normalize();
    u.crossVectors(z, d);
    this.arm.position.copy(pos); this.arm.quaternion.setFromRotationMatrix(Rig._m.makeBasis(d, u, z));
  }
}
const _q = new THREE.Quaternion(), _p = V();
/**
 * A hand wrapped round a grip whose top is at (x, y), raked by `rake` (negative leans the bottom back).
 * The knuckles sit `u` forward of the grip's top corner and `v` down it, `z` out to the side.
 */
function onGrip(x: number, y: number, rake: number, u: number, v: number, z: number) {
  const c = Math.cos(rake), s = Math.sin(rake), f = V(c, s, 0), d = V(s, -c, 0);
  const knuckle = V(x, y, 0).addScaledVector(f, u).addScaledVector(d, v).setZ(z);
  return { pos: knuckle.addScaledVector(f, -.088), F: f, K: d.negate() };
}
/** A hand under a fore-end: palm up, knuckles along the barrel, fingers curling up its right side. */
function underFore(x: number, y: number, z: number, tilt = .25) {
  const F = V(0, tilt, 1).normalize();
  return { pos: V(x, y, z).addScaledVector(F, -.088), F, K: V(1, 0, 0) };
}
/** Hand orientation from where the fingers point (F) and which way the index side faces (K). */
function basis(F: THREE.Vector3, K: THREE.Vector3, side: 1 | -1): THREE.Quaternion {
  const x = F.clone().normalize(), z = new THREE.Vector3().crossVectors(x, K).normalize(), y = new THREE.Vector3().crossVectors(z, x);
  void side;
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

// ---------- the guns ----------

export interface AnimInfo { count: number; capacity: number; firing: boolean; recoil: number }
export interface Viewmodel {
  group: THREE.Group;
  /** Muzzle position in the group's space. */
  muzzle: THREE.Vector3;
  /** R is reload progress 0..1, or -1 when not reloading. */
  anim: (R: number, dt: number, info: AnimInfo) => void;
  /** Called on each shot to fire the gun's muzzle flash. */
  flash?: () => void;
}

/** Reload travel of a part: out over [a, b], away until c, back in over [c, d]. */
function travel(R: number, a: number, b: number, c: number, d: number): number {
  if (R < a || R > d) return 0;
  return R < b ? smooth(a, b, R) : R < c ? 1 : 1 - smooth(c, d, R);
}
/** A weight that eases in just before `a` and out just after `d`, for hands following a part. */
const follow = (R: number, a: number, d: number, ease = .07) => R < 0 ? 0 : smooth(a - ease, a, R) * (1 - smooth(d, d + ease, R));

function part(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const p = new THREE.Group(); p.position.set(x, y, z); p.userData.home = p.position.clone(); parent.add(p); return p;
}
/** The gun body: authored muzzle along +x, turned to point down the view (-z). */
function bodyOf(g: THREE.Group, scale = .88): THREE.Group {
  const b = new THREE.Group(); b.rotation.y = Math.PI / 2; b.scale.setScalar(scale); g.add(b); return b;
}
function muzzleOf(b: THREE.Group, x: number, y: number, z = 0): THREE.Vector3 { b.updateMatrix(); return V(x, y, z).applyMatrix4(b.matrix); }

// the pulse rifle's two-digit round counter
function counterDisplay() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (n: number) => {
    const g = c.getContext('2d')!; g.fillStyle = '#120505'; g.fillRect(0, 0, 128, 64);
    const SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f], txt = String(Math.max(0, Math.min(99, n))).padStart(2, '0');
    [...txt].forEach((ch, i) => {
      const mk = SEG[+ch], x = 14 + i * 56, y = 8, w = 36, h = 24, t = 6;
      const bars: [number, number, number, number][] = [[x, y, w, t], [x + w - t, y, t, h], [x + w - t, y + h, t, h], [x, y + 2 * h - t, w, t], [x, y + h, t, h], [x, y, t, h], [x, y + h - t / 2, w, t]];
      bars.forEach((bb, k) => { g.fillStyle = mk & (1 << k) ? '#ff3a24' : '#2a0b08'; g.fillRect(...bb); });
    });
    tex.needsUpdate = true;
  };
  return { tex, draw };
}
function gaugeDisplay() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d9d4c3'; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#1a1a1a'; g.lineWidth = 3;
  for (let i = 0; i <= 10; i++) { const a = Math.PI * (.75 + i * .15); g.beginPath(); g.moveTo(64 + Math.cos(a) * 50, 64 + Math.sin(a) * 50); g.lineTo(64 + Math.cos(a) * (i % 5 ? 42 : 36), 64 + Math.sin(a) * (i % 5 ? 42 : 36)); g.stroke(); }
  g.strokeStyle = '#a82a18'; g.lineWidth = 7; g.beginPath(); g.arc(64, 64, 46, Math.PI * .75, Math.PI * .98); g.stroke();
  g.fillStyle = '#1a1a1a'; g.font = 'bold 16px monospace'; g.textAlign = 'center'; g.fillText('PSI', 64, 98);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildViewmodels(m: WeaponMaterials): Record<string, Viewmodel> {
  return { pistol: pistol(m), pulse: pulseRifle(m), flamer: flamer(m), smart: smartGun(m) };
}

// ---------- muzzle flash ----------

function flashTextures() {
  const mk = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  // seen head-on: a hot core with ragged spikes
  const star = mk(128, 128, (g) => {
    g.translate(64, 64);
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2 + Math.random() * .3, l = 40 + Math.random() * 22, w = .16 + Math.random() * .1;
      const gr = g.createLinearGradient(0, 0, Math.cos(a) * l, Math.sin(a) * l); gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(.5, 'rgba(255,170,60,.7)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(Math.cos(a - w) * 10, Math.sin(a - w) * 10); g.lineTo(Math.cos(a) * l, Math.sin(a) * l); g.lineTo(Math.cos(a + w) * 10, Math.sin(a + w) * 10); g.fill();
    }
    const core = g.createRadialGradient(0, 0, 0, 0, 0, 30); core.addColorStop(0, 'rgba(255,255,240,1)'); core.addColorStop(.4, 'rgba(255,210,120,.9)'); core.addColorStop(1, 'rgba(255,140,40,0)');
    g.fillStyle = core; g.fillRect(-64, -64, 128, 128);
  });
  // seen from the side: a flame cone with a bright base and broken tongues, base at the left edge
  const side = mk(256, 64, (g) => {
    for (let k = 0; k < 7; k++) {
      const len = 120 + Math.random() * 130, hw = 8 + Math.random() * 14, y = 32 + (Math.random() - .5) * 10;
      const gr = g.createLinearGradient(0, 0, len, 0); gr.addColorStop(0, 'rgba(255,245,210,1)'); gr.addColorStop(.35, 'rgba(255,180,70,.75)'); gr.addColorStop(1, 'rgba(255,110,30,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, 32 - hw * .6); g.quadraticCurveTo(len * .4, y - hw, len, y); g.quadraticCurveTo(len * .4, y + hw, 0, 32 + hw * .6); g.fill();
    }
    const core = g.createRadialGradient(0, 32, 0, 0, 32, 40); core.addColorStop(0, 'rgba(255,255,240,1)'); core.addColorStop(1, 'rgba(255,200,100,0)');
    g.fillStyle = core; g.fillRect(0, 0, 60, 64);
  });
  return { star, side };
}
let FLASH_TEX: ReturnType<typeof flashTextures> | null = null;

/**
 * A muzzle flash fixed to the gun: a head-on star plus two crossed side cones, additive and
 * brighter than white so the bloom pass blows it out. Each shot re-rolls its size and spin.
 */
class MuzzleFlash {
  readonly group = new THREE.Group();
  private t = 0; private star: THREE.Mesh; private cones: THREE.Mesh[] = [];
  constructor(parent: THREE.Object3D, x: number, y: number, private size: number, tint = new THREE.Color(1, 1, 1)) {
    FLASH_TEX ??= flashTextures();
    const mat = (map: THREE.Texture) => new THREE.MeshBasicMaterial({ map, color: tint.clone().multiplyScalar(4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    this.group.position.set(x, y, 0); parent.add(this.group);
    this.star = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2), mat(FLASH_TEX.star)); this.group.add(this.star);
    const cone = new THREE.PlaneGeometry(1, .25).translate(.5, 0, 0), cm = mat(FLASH_TEX.side);
    for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(cone, cm); c.rotation.x = i * Math.PI / 3; this.group.add(c); this.cones.push(c); }
    this.group.traverse(o => { o.renderOrder = 5; o.frustumCulled = false; });
    this.group.visible = false;
  }
  fire(): void {
    this.t = .055; const s = this.size * (.8 + Math.random() * .45);
    this.star.scale.setScalar(s * 2.2); this.star.rotation.x = Math.random() * Math.PI * 2;
    this.cones.forEach((c, i) => c.scale.set(s * (2.4 + Math.random() * 1.4), s * (1.6 + Math.random() * .8), 1) && (c.rotation.x = i * Math.PI / 3 + Math.random() * .5));
    this.group.visible = true;
  }
  update(dt: number): void {
    if (this.t <= 0) return;
    this.t -= dt; const k = Math.max(0, this.t / .055);
    this.group.visible = this.t > 0; this.group.scale.setScalar(.6 + k * .4);
  }
}

// ----- M-6 sidearm: an angular sci-fi service pistol -----
function pistol(m: WeaponMaterials): Viewmodel {
  const g = new THREE.Group(), b = bodyOf(g, 1.25); b.position.set(-.09, .03, .02); b.rotation.y += .2; // angled in toward the crosshair, showing its right flank
  const k = new Kit();
  // polymer frame with an accessory rail and a squared trigger guard
  k.add(m.polymer, side([[-.088, .001], [.108, .001], [.112, -.012], [.1, -.024], [.02, -.024], [-.035, -.027], [-.088, -.014]], .027, [.003, .004, .006, .004, .006, .008, .006], .0025));
  for (let x = .045; x < .1; x += .009) k.add(m.polymer, rbox(.005, .004, .022, .001, .0006), x, -.026, 0);
  k.add(m.polymer, side([[-.03, -.024], [.035, -.024], [.04, -.03], [.036, -.058], [-.022, -.058]], .012, [.002, .003, .006, .008, .012], .0018, [{ pts: [[-.022, -.028], [.03, -.028], [.03, -.052], [-.016, -.052]], r: .008 }]));
  k.add(m.steel, side([[-.004, -.024], [.003, -.024], [.002, -.038], [-.004, -.047], [-.009, -.045], [-.005, -.036]], .006, .0015, .0008));
  // stippled grip, raked back, with a flared magazine well
  const gripPts: P2[] = [[-.03, .002], [.016, .002], [.012, -.02], [.017, -.034], [.009, -.048], [.015, -.063], [.008, -.08], [.006, -.094], [-.04, -.094], [-.048, -.06], [-.045, -.02]];
  k.add(m.grip, side(gripPts, .03, .006, .004), -.045, -.016, 0, 0, 0, -.25);
  k.add(m.polymer, side([[-.03, 0], [.016, 0], [.018, .008], [-.034, .008]], .034, .003, .002), -.045 + Math.sin(.25) * .094 + .002, -.016 - Math.cos(.25) * .094 - .008, 0, 0, 0, -.25);
  // glowing status strip along the frame
  for (const z of [-1, 1]) k.add(m.bore, rbox(.09, .005, .002, .001, .0004), .035, -.009, z * .0136);
  // barrel and a ported compensator
  k.add(m.steel, cylX(.0075, -.02, .135, 14), 0, .02, 0);
  k.add(m.steel, side([[.122, -.002], [.158, -.002], [.162, .006], [.162, .036], [.128, .038], [.122, .03]], .03, [.002, .003, .004, .006, .004, .002], .0025,
    [0, 1, 2].map(i => ({ pts: [[.128 + i * .01, .026], [.134 + i * .01, .026], [.134 + i * .01, .042], [.128 + i * .01, .042]] as P2[], r: .002 }))));
  k.add(m.bore, cylX(.0062, .155, .1635, 12), 0, .02, 0);
  for (const [x, y] of [[-.07, -.008], [.09, -.012], [-.02, -.017]] as P2[]) k.screw(m.steel, x, y, .0139);
  k.into(b);
  const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(.25, 1.6, 2.4), toneMapped: false });
  for (const z of [-1, 1]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(.082, .0022), strip); s.position.set(.035, -.009, z * .0148); if (z < 0) s.rotation.y = Math.PI; b.add(s); }
  // slide: angular, with chamfered top, through-ports over the barrel, rear serrations and sights
  const slide = part(b, 0, 0, 0), sk = new Kit();
  sk.add(m.steel, side([[-.094, .002], [.124, .002], [.128, .012], [.122, .034], [.06, .04], [-.07, .04], [-.094, .03]], .03, [.003, .003, .004, .006, .004, .008, .004], .003,
    [0, 1, 2].map(i => ({ pts: [[.035 + i * .026, .01], [.054 + i * .026, .01], [.05 + i * .026, .03], [.039 + i * .026, .03]] as P2[], r: .003 }))));
  sk.add(m.steel, side([[-.07, 0], [.06, 0], [.06, .004], [-.07, .004]], .018, .002, .001), 0, .039, 0);
  for (let i = 0; i < 6; i++) for (const z of [-1, 1]) sk.add(m.bore, rbox(.0028, .024, .003, .001, .0004), -.086 + i * .0055, .021, z * .0145);
  sk.add(m.steel, side([[-.09, 0], [-.07, 0], [-.072, .012], [-.086, .012]], .026, .002, .001, [{ pts: [[-.084, .004], [-.076, .004], [-.076, .014], [-.084, .014]], r: .001 }]), 0, .043, 0);
  sk.add(m.steel, side([[.1, 0], [.114, 0], [.112, .01], [.104, .01]], .006, .0015, .0006), 0, .043, 0);
  sk.into(slide);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(.0018, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(.5, 3, 1), toneMapped: false })); dot.position.set(.1035, .051, 0); slide.add(dot);
  // round counter on the back of the slide, facing the shooter
  const ctr = counterDisplay();
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(.022, .012), new THREE.MeshBasicMaterial({ map: ctr.tex, toneMapped: false }));
  scr.rotation.y = -Math.PI / 2; scr.position.set(-.0955, .022, 0); slide.add(scr);
  // magazine in the grip, dropped during reloads
  const mag = part(b, -.045, -.016, 0); mag.rotation.z = -.25;
  new Kit().add(m.steel, rbox(.036, .09, .022, .003), -.012, -.05, 0).add(m.polymer, side([[-.032, 0], [.014, 0], [.016, .008], [-.034, .008]], .03, .003, .002), 0, -.104, 0)
    .add(m.brass, cylX(.0045, -.024, .0, 8), 0, -.003, 0).into(mag);
  const right = new Rig(b, m, 1, onGrip(-.045, -.016, -.25, .025, .045, .035), V(-.42, -.3, .1), POSE.trigger);
  const left = new Rig(b, m, -1, onGrip(-.045, -.016, -.25, .05, .06, -.038), V(-.28, -.38, -.28), POSE.wrap, true);
  const fl = new MuzzleFlash(b, .163, .02, .14);
  const lp = V(), q = new THREE.Quaternion(), e = new THREE.Euler();
  let shown = -1;
  return {
    group: g, muzzle: muzzleOf(b, .163, .02), flash: () => fl.fire(),
    anim(R, dt, info) {
      const t = travel(R, .1, .3, .32, .48); mag.visible = t < .98; mag.position.y = mag.userData.home.y - t * .2; mag.position.x = mag.userData.home.x - t * .05;
      slide.position.x = -(R >= 0 ? (R < .78 ? .03 : .03 * (1 - smooth(.78, .82, R))) : Math.min(1, info.recoil * 2.5) * .028);
      // support hand drops to the belt for a fresh mag and drives it home
      const w = follow(R, .12, .5);
      lp.copy(mag.position).add(_p.set(-.07, -.13, -.03)); lp.lerpVectors(left.homePos, lp, w);
      left.place(lp, q.copy(left.homeQ).slerp(_q.setFromEuler(e.set(-.5, .3, 0)).premultiply(left.homeQ), w)); left.hand.blend(POSE.wrap, POSE.hold, w);
      if (shown !== info.count) { shown = info.count; ctr.draw(Math.floor(info.count)); }
      fl.update(dt); void right;
    },
  };
}

// ----- PR-7 pulse rifle -----
function pulseRifle(m: WeaponMaterials): Viewmodel {
  const g = new THREE.Group(), b = bodyOf(g), k = new Kit();
  // upper receiver
  k.add(m.olive, side([[-.17, -.004], [.08, -.004], [.08, .056], [-.12, .058], [-.165, .04]], .05, [.004, .004, .006, .02, .006]));
  // shroud: a long boxy handguard with through-vents that show the barrel inside
  k.add(m.olive, side([[.065, -.052], [.33, -.054], [.405, -.024], [.41, .058], [.075, .066], [.06, .03]], .074, [.006, .02, .008, .01, .008, .006], .003,
    [0, 1, 2, 3].map(i => ({ pts: [[.15 + i * .062, .016], [.195 + i * .062, .016], [.195 + i * .062, .042], [.15 + i * .062, .042]] as P2[], r: .008 }))));
  k.add(m.bore, cylX(.024, .07, .4, 14), 0, .029, 0); // shadowed interior behind the vents
  k.add(m.steel, cylX(.0095, .06, .42, 14), 0, .029, 0); // barrel
  // the shroud's top ridge and a front sight
  k.add(m.olive, side([[.1, 0], [.4, 0], [.4, .006], [.1, .008]], .03, .002, .001), 0, .066, 0);
  k.add(m.steel, side([[.37, 0], [.395, 0], [.392, .022], [.382, .024]], .006, .002, .0008), 0, .072, 0);
  for (const z of [-.009, .009]) k.add(m.steel, side([[.365, 0], [.398, 0], [.396, .028], [.37, .018]], .004, .002, .0008), 0, .072, z);
  // muzzle: barrel extension and a slotted flash hider
  k.add(m.steel, tube([[0, .40], [.011, .40], [.011, .45], [.014, .452], [.014, .52], [.012, .526], [0, .526]], 16), 0, .029, 0);
  k.add(m.bore, cylX(.0072, .45, .528, 10), 0, .029, 0);
  for (let i = 0; i < 4; i++) k.add(m.bore, rbox(.04, .0032, .03, .001, .0005), .49, .029, 0, i * Math.PI / 4);
  // underslung grenade launcher and its ribbed pump fore-end
  k.add(m.steel, tube([[0, .02], [.021, .02], [.021, .34], [.024, .342], [.024, .37], [0, .37]], 18), 0, -.078, 0);
  k.add(m.bore, cylX(.016, .36, .372, 12), 0, -.078, 0);
  k.add(m.olive, side([[.03, -.03], [.07, -.06], [.07, -.098], [.02, -.1], [.0, -.07]], .04, .006));
  // lower receiver with magwell and trigger housing
  k.add(m.polymer, side([[-.125, -.004], [.075, -.004], [.075, -.042], [.06, -.058], [.002, -.058], [-.02, -.035], [-.12, -.03]], .046, .005));
  // pistol grip with finger grooves, raked back
  const gripPts: P2[] = [[-.03, .002], [.016, .002], [.012, -.02], [.017, -.034], [.009, -.048], [.015, -.063], [.006, -.082], [.01, -.098], [-.002, -.11], [-.04, -.105], [-.048, -.06], [-.045, -.02]];
  k.add(m.grip, side(gripPts, .033, [.004, .004, .006, .004, .006, .004, .006, .004, .01, .01, .012, .01], .004), -.08, -.03, 0, 0, 0, -.28);
  // trigger guard and trigger
  k.add(m.polymer, side([[-.075, -.03], [.0, -.03], [.0, -.066], [-.065, -.066]], .01, [.002, .002, .012, .016], .0015, [{ pts: [[-.068, -.035], [-.006, -.035], [-.006, -.06], [-.06, -.06]], r: .01 }]));
  k.add(m.steel, side([[-.036, -.03], [-.03, -.03], [-.033, -.045], [-.04, -.054], [-.044, -.052], [-.039, -.043]], .006, .0015, .0008));
  // skeletal stock and rubber butt pad
  k.add(m.olive, side([[-.16, .042], [-.40, .036], [-.42, .02], [-.42, -.07], [-.40, -.082], [-.3, -.062], [-.16, -.024]], .03, [.006, .01, .006, .006, .01, .02, .006], .003,
    [{ pts: [[-.19, .026], [-.285, .023], [-.285, -.035], [-.19, -.012]], r: .008 }, { pts: [[-.305, .021], [-.395, .018], [-.395, -.062], [-.305, -.042]], r: .008 }]));
  k.add(m.rubber, side([[-.445, .026], [-.418, .026], [-.418, -.078], [-.445, -.078]], .04, .008, .003));
  // rail and rear aperture sight on top
  k.rail(m.steel, -.1, .07, .056);
  k.add(m.steel, side([[-.11, 0], [-.085, 0], [-.088, .022], [-.106, .022]], .02, .003, .001, [{ pts: [[-.1, .01], [-.094, .01], [-.094, .017], [-.1, .017]], r: .002 }]), 0, .064, 0);
  // counter housing on the receiver's rear
  k.add(m.polymer, rbox(.05, .012, .036, .004), -.13, .05, 0);
  // right side: ejection port, bolt slot, selector, pins and screws
  k.add(m.bore, rbox(.07, .02, .004, .003, .0008), .015, .025, .0245);
  k.add(m.bright, rbox(.045, .012, .002, .002, .0005), .01, .025, .0262);
  k.add(m.bore, rbox(.09, .006, .004, .002, .0005), -.07, .041, .0245);
  k.add(m.steel, cylX(.006, 0, .004, 12).rotateY(-Math.PI / 2), -.1, -.016, .023);
  k.add(m.steel, rbox(.018, .005, .004, .002, .0008), -.093, -.012, .0272, 0, 0, .5);
  for (const [x, y] of [[-.15, .01], [.05, -.02], [-.04, -.015], [.11, -.04], [.3, -.04], [.11, .052], [.3, .052], [-.2, .015], [-.37, .015]] as P2[]) k.screw(m.steel, x, y, x < -.16 ? .0152 : x > .06 ? .0372 : .0232);
  // sling loop on the shroud
  k.add(m.steel, new THREE.TorusGeometry(.009, .0022, 6, 12), .34, -.06, .025, 0, 0, 0);
  k.into(b);
  // decals
  const st = stencil(m, 0, 38, .0062); st.position.set(.24, -.032, .0372); b.add(st);
  const st2 = stencil(m, 1, 16, .004); st2.position.set(-.1, -.026, .0232); b.add(st2);
  // round counter on top of the housing
  const ctr = counterDisplay();
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(.036, .02), new THREE.MeshBasicMaterial({ map: ctr.tex, toneMapped: false }));
  scr.rotation.x = -Math.PI / 2; scr.position.set(-.13, .0565, 0); b.add(scr);
  // magazine: curved box mag with ribs and a polymer base pad
  const mag = part(b, .036, -.03, 0); mag.rotation.z = -.12;
  new Kit().add(m.steel, side([[-.022, .01], [.022, .01], [.03, -.06], [.032, -.13], [-.01, -.135], [-.014, -.06]], .028, [.002, .002, .01, .004, .004, .01], .002))
    .add(m.polymer, side([[-.014, 0], [.036, 0], [.036, .012], [-.014, .012]], .034, .004, .002), 0, -.145, 0)
    .add(m.steel, rbox(.05, .003, .03, .001, .0005), .01, -.03, 0, 0, 0, -.08).add(m.steel, rbox(.05, .003, .03, .001, .0005), .012, -.08, 0, 0, 0, -.03)
    .add(m.brass, cylX(.005, -.016, .014, 8), 0, .013, 0).into(mag);
  // charging handle
  const bolt = part(b, -.06, .041, .026);
  new Kit().add(m.steel, rbox(.02, .006, .008, .002, .001)).add(m.polymer, cylX(.0055, 0, .014, 10).rotateY(-Math.PI / 2), .004, 0, .004).into(bolt);
  // hands: trigger hand on the grip, support hand under the pump
  const right = new Rig(b, m, 1, onGrip(-.08, -.03, -.28, .024, .045, .037), V(-.45, -.32, .05), POSE.trigger);
  const left = new Rig(b, m, -1, underFore(.2, -.124, .015), V(-.15, -.4, -.45), POSE.wrap, true);
  const lp = V(), q = new THREE.Quaternion(), e = new THREE.Euler();
  let shown = -1;
  const fl = new MuzzleFlash(b, .526, .029, .22);
  return {
    group: g, muzzle: muzzleOf(b, .526, .029), flash: () => fl.fire(),
    anim(R, dt, info) {
      const t = travel(R, .12, .3, .32, .52); mag.visible = t < .98; mag.position.y = mag.userData.home.y - t * .25; mag.position.x = mag.userData.home.x - t * .04;
      const bk = R < 0 ? 0 : travel(R, .7, .74, .77, .8); bolt.position.x = bolt.userData.home.x - bk * .06;
      // left hand: strip the mag and bring the new one up, then reach over to rack the bolt
      const wm = follow(R, .14, .52), wb = follow(R, .66, .8, .06);
      lp.copy(mag.position).add(_p.set(.0, -.11, .028));
      const toBolt = _p.set(bolt.position.x - .03, bolt.position.y + .02, bolt.position.z + .05);
      const target = lp.lerp(toBolt, wb / Math.max(1e-3, wm + wb)), w = Math.max(wm, wb);
      left.place(target.lerpVectors(left.homePos, target, w), q.copy(left.homeQ).slerp(_q.setFromEuler(e.set(wb > wm ? -1.2 : -.3, wb > wm ? .6 : .2, 0)).premultiply(left.homeQ), w));
      left.hand.blend(POSE.wrap, wb > wm ? POSE.pinch : POSE.hold, w);
      if (shown !== info.count) { shown = info.count; ctr.draw(Math.floor(info.count)); }
      fl.update(dt); void dt; void right;
    },
  };
}

// ----- M-9 incinerator unit -----
function flamer(m: WeaponMaterials): Viewmodel {
  const g = new THREE.Group(), b = bodyOf(g), k = new Kit();
  // pump housing
  k.add(m.olive, side([[-.25, -.02], [-.205, -.046], [.075, -.046], [.09, -.02], [.09, .04], [-.15, .052], [-.25, .03]], .064, [.01, .01, .008, .008, .008, .02, .01], .004));
  k.add(m.polymer, rbox(.13, .016, .068, .004), -.06, .05, 0);
  // the projector tube, heat shield slats and collars
  k.add(m.steel, cylX(.022, .06, .47, 18), 0, .0, 0);
  for (const x of [.1, .26, .42]) k.add(m.olive, tube([[0, x], [.036, x], [.038, x + .004], [.038, x + .02], [.036, x + .024], [0, x + .024]], 20), 0, 0, 0);
  for (let i = 0; i < 9; i++) { const a = -Math.PI * .1 + i / 8 * Math.PI * 1.2; k.add(m.olive, rbox(.33, .004, .011, .0015, .0008), .272, Math.sin(a) * .035, Math.cos(a) * .035, a - Math.PI / 2); }
  // nozzle and igniter
  k.add(m.steel, tube([[0, .46], [.024, .46], [.026, .5], [.031, .53], [.031, .545], [.026, .55], [0, .55]], 18), 0, 0, 0);
  k.add(m.bore, cylX(.02, .54, .552, 14), 0, 0, 0);
  k.add(m.olive, rbox(.1, .026, .03, .006), .44, -.036, 0);
  k.add(m.steel, tube([[0, .45], [.0065, .45], [.0065, .53], [.0045, .54], [0, .54]], 10), 0, -.036, 0);
  // fuel line over the top, from the pump to the nozzle block
  k.add(m.rubber, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-.02, .04, .03), V(.06, .05, .042), V(.25, .045, .046), V(.44, .03, .03), V(.47, .0, .028)]), 30, .0055, 8));
  for (const x of [.02, .2, .38]) k.add(m.steel, new THREE.TorusGeometry(.0065, .0018, 5, 10), x, .048, .044, 0, Math.PI / 2, 0);
  // pistol grip, trigger guard, front grip
  const gripPts: P2[] = [[-.03, .002], [.016, .002], [.012, -.02], [.017, -.034], [.009, -.048], [.015, -.063], [.006, -.082], [.01, -.098], [-.002, -.11], [-.04, -.105], [-.048, -.06], [-.045, -.02]];
  k.add(m.grip, side(gripPts, .034, .006, .004), -.14, -.044, 0, 0, 0, -.28);
  k.add(m.polymer, side([[-.13, -.04], [-.06, -.04], [-.06, -.075], [-.12, -.075]], .01, [.002, .002, .012, .016], .0015, [{ pts: [[-.124, -.045], [-.066, -.045], [-.066, -.069], [-.116, -.069]], r: .01 }]));
  k.add(m.steel, side([[-.096, -.04], [-.09, -.04], [-.093, -.055], [-.1, -.064], [-.104, -.062], [-.099, -.053]], .006, .0015, .0008));
  k.add(m.olive, tube([[0, .2], [.025, .2], [.03, .21], [.03, .26], [.025, .27], [0, .27]], 16), 0, -.032, 0);
  k.add(m.grip, side([[-.02, 0], [.02, 0], [.016, -.03], [.02, -.06], [.013, -.1], [-.018, -.105], [-.022, -.06]], .032, .008, .004), .235, -.05, 0, 0, 0, -.05);
  // rear stub stock
  k.add(m.olive, side([[-.36, .02], [-.24, .028], [-.24, -.03], [-.36, -.05]], .034, .008, .003));
  k.add(m.rubber, side([[-.385, .03], [-.355, .028], [-.355, -.06], [-.385, -.062]], .044, .008, .003));
  // pressure gauge on the right side of the housing
  k.add(m.steel, tube([[0, 0], [.02, 0], [.022, .002], [.022, .01], [.019, .012], [0, .012]], 20).rotateY(-Math.PI / 2), -.11, .005, .03);
  // valve knob, hazard band, screws
  k.add(m.fuel, tube([[0, 0], [.012, 0], [.013, .004], [.013, .012], [0, .014]], 14).rotateZ(Math.PI / 2), .03, .048, .02);
  k.add(m.hazard, tube([[0, .14], [.0225, .14], [.0225, .16], [0, .16]], 18), .0, 0, 0);
  for (const [x, y] of [[-.21, .0], [.06, -.03], [.06, .03], [-.2, -.03], [-.03, -.032]] as P2[]) k.screw(m.steel, x, y, .0322);
  k.into(b);
  const gauge = new THREE.Mesh(new THREE.CircleGeometry(.0188, 24), new THREE.MeshStandardMaterial({ map: gaugeDisplay(), roughness: .25 }));
  gauge.position.set(-.11, .005, .0425); b.add(gauge);
  const needle = new THREE.Mesh(rbox(.016, .0018, .0006, .0005, 0), new THREE.MeshStandardMaterial({ color: '#111', roughness: .5 }));
  needle.geometry.translate(.007, 0, 0); needle.position.set(-.11, .005, .0432); b.add(needle);
  const st = stencil(m, 2, 40, .0058); st.position.set(-.06, -.03, .0322); b.add(st);
  // the fuel tank is the magazine
  const mag = part(b, .03, -.098, 0);
  new Kit().add(m.fuel, tube([[0, -.1], [.03, -.098], [.04, -.088], [.043, -.07], [.043, .1], [.04, .115], [.03, .124], [0, .126]], 22))
    .add(m.hazard, tube([[0, .0], [.0435, .0], [.0435, .018], [0, .018]], 22))
    .add(m.steel, tube([[0, .118], [.016, .118], [.016, .138], [.012, .14], [0, .14]], 14))
    .add(m.steel, new THREE.TorusGeometry(.044, .003, 6, 22), -.07, 0, 0, 0, Math.PI / 2, 0).add(m.steel, new THREE.TorusGeometry(.044, .003, 6, 22), .09, 0, 0, 0, Math.PI / 2, 0)
    .add(m.steel, rbox(.03, .05, .012, .004), .05, .035, 0).into(mag);
  const st2 = stencil(m, 4, 3, .016); st2.position.set(-.03, -.002, .0442); mag.add(st2);
  const pilot = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), new THREE.MeshStandardMaterial({ color: '#f0b13c', emissive: '#f0b13c', emissiveIntensity: 1.2 }));
  pilot.position.set(.546, -.036, 0); b.add(pilot);
  const right = new Rig(b, m, 1, onGrip(-.14, -.044, -.28, .024, .045, .038), V(-.5, -.34, .05), POSE.trigger);
  const left = new Rig(b, m, -1, onGrip(.235, -.05, -.05, .03, .05, -.037), V(-.1, -.42, -.45), POSE.wrap, true);
  const lp = V(), q = new THREE.Quaternion(), e = new THREE.Euler();
  return {
    group: g, muzzle: muzzleOf(b, .55, 0),
    anim(R, dt, info) {
      const t = travel(R, .2, .32, .45, .63); mag.visible = t < .98; mag.position.y = mag.userData.home.y - t * .22;
      const lit = R < 0 || R > .85; pilot.visible = lit; pilot.scale.setScalar(.0085 + Math.random() * .003 + (info.firing ? .005 : 0));
      needle.rotation.z = -Math.PI * (.75 + .3 * Math.min(1, info.count / info.capacity)) + Math.PI * 2 - Math.PI * .5 + (info.firing ? Math.sin(performance.now() * .05) * .03 : 0);
      const w = follow(R, .22, .63);
      lp.copy(mag.position).add(_p.set(.01, -.03, -.05)); lp.lerpVectors(left.homePos, lp, w);
      left.place(lp, q.copy(left.homeQ).slerp(_q.setFromEuler(e.set(.6, 0, -.4)).premultiply(left.homeQ), w)); left.hand.blend(POSE.wrap, POSE.hold, w);
      void dt; void right;
    },
  };
}

// ----- SG-4 smart gun on its harness arm -----
function smartGun(m: WeaponMaterials): Viewmodel {
  const g = new THREE.Group(), b = bodyOf(g), k = new Kit();
  b.position.set(.035, -.035, .01); // carried lower and further out, at the hip
  // receiver and feed cover
  k.add(m.olive, side([[-.23, -.052], [.29, -.06], [.36, -.032], [.36, .058], [.13, .074], [-.18, .07], [-.23, .042]], .1, [.012, .016, .012, .01, .02, .012, .012], .005));
  k.add(m.olive, side([[-.12, 0], [.12, 0], [.11, .014], [-.11, .016]], .085, .006, .003), 0, .066, 0);
  // rear recoil buffer with a rubber pad, the end the gunner looks at
  k.add(m.steel, side([[-.245, -.042], [-.225, -.044], [-.225, .036], [-.24, .034]], .074, .006, .003));
  k.add(m.rubber, side([[-.262, -.034], [-.243, -.036], [-.243, .028], [-.258, .026]], .056, .008, .003));
  for (const z of [-.028, .028]) for (const y of [-.03, .022]) k.add(m.steel, cylX(.004, -.247, -.243, 8), 0, y, z);
  for (const x of [-.11, .1]) k.add(m.steel, cylX(.006, -.045, .045, 10).rotateY(Math.PI / 2), x, .072, 0);
  // vent slots and armour panel on the right side
  for (let i = 0; i < 6; i++) k.add(m.bore, rbox(.012, .05, .004, .003, .0008), .05 + i * .028, .005, .0505);
  k.add(m.olive, side([[-.2, -.035], [.02, -.04], [.02, .045], [-.17, .05], [-.2, .03]], .006, .008, .002), 0, 0, .052);
  for (const [x, y] of [[-.185, -.025], [.005, -.03], [.005, .035], [-.17, .04]] as P2[]) k.screw(m.steel, x, y, .055);
  // barrel jacket with rows of cooling holes, then the barrel and a ported muzzle brake
  k.add(m.steel, tube([[0, .34], [.04, .34], [.04, .36], [.036, .365], [.036, .62], [.032, .63], [0, .63]], 22));
  for (let row = 0; row < 7; row++) for (let i = 0; i < 6; i++) {
    const a = (i / 6 + (row % 2) / 12) * Math.PI * 2, x = .39 + row * .033;
    k.add(m.bore, cylX(.0062, 0, .002, 10).rotateZ(Math.PI / 2), x, Math.cos(a) * .0355, Math.sin(a) * .0355, a, 0, 0);
  }
  k.add(m.steel, cylX(.016, .62, .67, 14));
  k.add(m.steel, tube([[0, .66], [.024, .66], [.024, .73], [.02, .735], [0, .735]], 16));
  k.add(m.bore, cylX(.011, .72, .737, 12));
  for (const x of [.675, .697]) for (const z of [-1, 1]) k.add(m.bore, rbox(.012, .03, .006, .003, .0008), x + .006, 0, z * .022);
  // carry handle over the feed cover
  k.add(m.steel, side([[-.08, 0], [-.07, 0], [-.05, .035], [.1, .035], [.12, 0], [.13, 0], [.11, .045], [-.045, .045]], .016, .004, .002), 0, .08, 0);
  // targeting sensor: housing on the top left, a lens forward and a reticle screen facing the gunner
  k.add(m.polymer, rbox(.11, .05, .045, .008), -.1, .1, -.03);
  k.add(m.steel, cylX(.016, -.05, -.035, 16), 0, .1, -.03);
  k.add(m.polymer, side([[-.155, -.03], [-.145, -.03], [-.145, .028], [-.155, .03]], .055, .003, .001), 0, .1, -.03);
  k.add(m.steel, rbox(.02, .022, .012, .003), -.08, .07, -.03);
  // grips: rear pistol grip, front vertical grip
  const gripPts: P2[] = [[-.03, .002], [.016, .002], [.012, -.02], [.017, -.034], [.009, -.048], [.015, -.063], [.006, -.082], [.01, -.098], [-.002, -.11], [-.04, -.105], [-.048, -.06], [-.045, -.02]];
  k.add(m.grip, side(gripPts, .036, .006, .004), -.13, -.05, 0, 0, 0, -.25);
  k.add(m.polymer, side([[-.115, -.045], [-.05, -.045], [-.05, -.08], [-.105, -.08]], .012, [.002, .002, .012, .016], .0015, [{ pts: [[-.109, -.05], [-.056, -.05], [-.056, -.074], [-.1, -.074]], r: .01 }]));
  k.add(m.steel, side([[-.085, -.045], [-.079, -.045], [-.082, -.06], [-.089, -.069], [-.093, -.067], [-.088, -.058]], .006, .0015, .0008));
  k.add(m.grip, side([[-.022, 0], [.022, 0], [.017, -.035], [.022, -.07], [.014, -.11], [-.02, -.115], [-.024, -.06]], .036, .008, .004), .25, -.055, 0, 0, 0, -.05);
  // harness gimbal: a pivot under the receiver and an articulated support arm running off to the right
  k.add(m.steel, tube([[0, -.03], [.028, -.03], [.03, -.024], [.03, .024], [.028, .03], [0, .03]], 18).rotateZ(Math.PI / 2), .08, -.085, 0);
  k.add(m.olive, rbox(.07, .03, .05, .008), .08, -.07, 0);
  const armA = V(.08, -.11, .0), armB = V(-.02, -.2, .2), armC = V(-.25, -.33, .32);
  const strut = (a: THREE.Vector3, c: THREE.Vector3, w: number) => {
    const d = c.clone().sub(a), len = d.length(), geo = rbox(len, w, w * .8, w * .3, w * .1);
    const mtx = new THREE.Matrix4().lookAt(V(), d, V(0, 1, 0)), quat = new THREE.Quaternion().setFromRotationMatrix(mtx).multiply(_q.setFromAxisAngle(V(0, 1, 0), -Math.PI / 2));
    const e = new THREE.Euler().setFromQuaternion(quat), mid = a.clone().add(c).multiplyScalar(.5);
    k.add(m.olive, geo, mid.x, mid.y, mid.z, e.x, e.y, e.z);
    k.add(m.steel, cylX(.004, -len / 2, len / 2, 8), mid.x, mid.y, mid.z, e.x, e.y, e.z, [1, 1, 1]);
  };
  strut(armA, armB, .03); strut(armB, armC, .036);
  k.add(m.steel, tube([[0, -.025], [.024, -.025], [.026, .025], [0, .025]], 16).rotateZ(Math.PI / 2), armB.x, armB.y, armB.z);
  k.add(m.rubber, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-.2, -.02, .05), V(-.24, -.06, .1), V(-.2, -.2, .22), V(-.28, -.34, .34)]), 24, .007, 8));
  k.into(b);
  const st = stencil(m, 3, 32, .0062); st.position.set(.21, -.038, .0505); b.add(st);
  // reticle display on the sensor's rear face
  const rc = document.createElement('canvas'); rc.width = rc.height = 128; const cg = rc.getContext('2d')!;
  cg.fillStyle = '#031014'; cg.fillRect(0, 0, 128, 128); cg.strokeStyle = 'rgba(90,220,255,.85)'; cg.lineWidth = 3;
  cg.beginPath(); cg.arc(64, 64, 30, 0, Math.PI * 2); cg.moveTo(64, 20); cg.lineTo(64, 46); cg.moveTo(64, 82); cg.lineTo(64, 108); cg.moveTo(20, 64); cg.lineTo(46, 64); cg.moveTo(82, 64); cg.lineTo(108, 64); cg.stroke();
  cg.fillStyle = 'rgba(90,220,255,.8)'; cg.font = 'bold 13px monospace'; cg.fillText('TGT', 6, 16); cg.fillText('IFF', 92, 122);
  const rt = new THREE.CanvasTexture(rc); rt.colorSpace = THREE.SRGBColorSpace;
  const reticle = new THREE.Mesh(new THREE.PlaneGeometry(.042, .038), new THREE.MeshBasicMaterial({ map: rt, toneMapped: false, color: new THREE.Color(.55, .55, .55) }));
  reticle.rotation.y = -Math.PI / 2; reticle.position.set(-.1565, .1, -.03); b.add(reticle);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(.014, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.lens); lens.rotation.z = -Math.PI / 2; lens.position.set(-.035, .1, -.03); b.add(lens);
  // drum magazine on the left with a feed chute
  const mag = part(b, .07, -.045, -.1);
  const drum = tube([[0, -.045], [.075, -.045], [.082, -.04], [.082, -.03], [.078, -.026], [.078, .026], [.082, .03], [.082, .04], [.075, .045], [0, .045]], 26).rotateY(Math.PI / 2);
  new Kit().add(m.olive, drum).add(m.steel, cylX(.022, 0, .006, 16).rotateY(Math.PI / 2), 0, 0, -.048)
    .add(m.steel, rbox(.06, .03, .03, .004), .0, .07, .045, 0, 0, .2).add(m.brass, rbox(.004, .03, .006, .001, .0005), .02, -.02, -.0465)
    .into(mag);
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; new Kit().screw(m.steel, Math.cos(a) * .06, Math.sin(a) * .06, -.046, true).into(mag); }
  const spin = new THREE.Mesh(new THREE.TorusGeometry(.03, .004, 5, 12), m.steel); spin.position.z = -.05; mag.add(spin);
  const right = new Rig(b, m, 1, onGrip(-.13, -.05, -.25, .024, .045, .04), V(-.5, -.34, .05), POSE.trigger);
  const left = new Rig(b, m, -1, onGrip(.25, -.055, -.05, .032, .055, -.04), V(-.1, -.42, -.45), POSE.wrap, true);
  const lp = V(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const fl = new MuzzleFlash(b, .735, 0, .32);
  return {
    group: g, muzzle: muzzleOf(b, .735, 0), flash: () => fl.fire(),
    anim(R, dt, info) {
      const t = travel(R, .2, .38, .42, .575); mag.visible = t < .98; mag.position.z = mag.userData.home.z - t * .2; mag.position.y = mag.userData.home.y - t * .12;
      spin.rotation.z += dt * (info.firing || (R > .75 && R < 1) ? 30 : 0);
      const w = follow(R, .22, .58);
      lp.copy(mag.position).add(_p.set(.0, -.05, -.07)); lp.lerpVectors(left.homePos, lp, w);
      left.place(lp, q.copy(left.homeQ).slerp(_q.setFromEuler(e.set(-.8, 0, .2)).premultiply(left.homeQ), w)); left.hand.blend(POSE.wrap, POSE.hold, w);
      fl.update(dt); void right;
    },
  };
}
