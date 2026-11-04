import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { ModelAsset } from './models';

/**
 * Procedural rig for AI-generated creature models (Meshy and similar), which arrive as one static
 * mesh. On load the mesh is split into regions by shape alone: legs are the separate limbs that
 * splay out below and beside the body, the head is the front of the upper body, the tail the rear.
 * Each region gets bones and smooth skin weights, and `animateRig` walks them in code
 * (an alternating gait, head sway, tail lash, lunges), so no hand rigging or animation files are needed.
 *
 * Frame used everywhere here and by the game's Skarn: +x forward, +y up, +z to the creature's side.
 */

export interface RigTemplate {
  mesh: THREE.SkinnedMesh;
  /** Body length (x) and height (y) in metres after fitting. */
  length: number; height: number;
  legCount: number;
}

interface LegInfo { hip: THREE.Vector3; knee: THREE.Vector3; foot: THREE.Vector3; side: number; front: number }

export interface RigOptions {
  /** Target height in metres (feet to top of the head crest). */
  height: number;
  /** Rotation (radians about y) that turns the model's forward axis to +x. Meshy faces +z, so π/2. */
  yaw?: number;
  /** Fraction of the half-width that still counts as body core, below which nothing is a leg. */
  core?: number;
}

const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Distance from p to segment ab, and the 0..1 position along it. */
function segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): [number, number] {
  const ab = new THREE.Vector3().subVectors(b, a), t = Math.min(1, Math.max(0, new THREE.Vector3().subVectors(p, a).dot(ab) / Math.max(1e-9, ab.lengthSq())));
  return [p.distanceTo(a.clone().addScaledVector(ab, t)), t];
}

export function buildRigTemplate(asset: ModelAsset, opts: RigOptions): RigTemplate {
  // bake the model into one geometry in the creature frame, feet on y = 0, centred over the origin
  let src: THREE.Mesh | null = null;
  asset.scene.updateMatrixWorld(true);
  asset.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && !src) src = o as THREE.Mesh; });
  if (!src) throw new Error('rig: model has no mesh');
  const mesh0 = src as THREE.Mesh;
  const geo = (mesh0.geometry as THREE.BufferGeometry).clone();
  // quantized attributes (KHR_mesh_quantization) must be real floats before we transform them
  for (const name of ['position', 'normal', 'uv']) {
    const a = geo.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (a && !(a.array instanceof Float32Array)) {
      const f = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) f[i * a.itemSize + k] = a.getComponent(i, k);
      geo.setAttribute(name, new THREE.BufferAttribute(f, a.itemSize));
    }
  }
  geo.applyMatrix4(mesh0.matrixWorld);
  geo.rotateY(opts.yaw ?? Math.PI / 2);
  geo.computeBoundingBox();
  let bb = geo.boundingBox!;
  const k = opts.height / (bb.max.y - bb.min.y);
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2); geo.scale(k, k, k);
  geo.computeBoundingBox(); bb = geo.boundingBox!;
  const L = bb.max.x - bb.min.x, Hh = bb.max.y, W = bb.max.z - bb.min.z;

  const pos = geo.getAttribute('position') as THREE.BufferAttribute, n = pos.count;
  const index = geo.index ? geo.index.array : Array.from({ length: n }, (_, i) => i);
  const P = (i: number, v = new THREE.Vector3()) => v.fromBufferAttribute(pos, i);

  // Body core: the half-width of the torso (upper half of the middle third), from its widest slices.
  const v = new THREE.Vector3();
  const upper: number[] = [];
  for (let i = 0; i < n; i++) { P(i, v); if (v.y > Hh * .5 && Math.abs(v.x) < L * .18) upper.push(Math.abs(v.z)); }
  upper.sort((a, b) => a - b);
  const coreW = (upper[Math.floor(upper.length * .95)] ?? W * .2) * (opts.core ?? 1.05);

  // Mesh graph over welded positions (UV seams split vertices that share a position).
  const key = new Map<string, number>(), canon = new Int32Array(n);
  for (let i = 0; i < n; i++) { P(i, v); const kk = `${Math.round(v.x * 2e3)},${Math.round(v.y * 2e3)},${Math.round(v.z * 2e3)}`; let c = key.get(kk); if (c === undefined) { c = key.size; key.set(kk, c); } canon[i] = c; }
  const m = key.size, cpos = new Float32Array(m * 3);
  for (let i = 0; i < n; i++) { P(i, v); cpos[canon[i] * 3] = v.x; cpos[canon[i] * 3 + 1] = v.y; cpos[canon[i] * 3 + 2] = v.z; }
  const adj: number[][] = Array.from({ length: m }, () => []);
  const link = (a: number, b: number) => { if (a !== b && !adj[a].includes(b)) { adj[a].push(b); adj[b].push(a); } };
  for (let t = 0; t < index.length; t += 3) { const a = canon[index[t]], b = canon[index[t + 1]], c = canon[index[t + 2]]; link(a, b); link(b, c); link(a, c); }
  const cy = (c: number) => cpos[c * 3 + 1], cz = (c: number) => cpos[c * 3 + 2];
  const dist = (a: number, b: number) => Math.hypot(cpos[a * 3] - cpos[b * 3], cpos[a * 3 + 1] - cpos[b * 3 + 1], cpos[a * 3 + 2] - cpos[b * 3 + 2]);

  // Feet: separate clusters of low vertices out to the side (connected pieces of the lowest third).
  const low = new Uint8Array(m); for (let c = 0; c < m; c++) low[c] = cy(c) < Hh * .3 && Math.abs(cz(c)) > coreW * .8 ? 1 : 0;
  const lab = new Int32Array(m).fill(-1); const feet: number[][] = [];
  for (let c = 0; c < m; c++) if (low[c] && lab[c] < 0) {
    const stack = [c], g: number[] = []; lab[c] = feet.length;
    while (stack.length) { const x = stack.pop()!; g.push(x); for (const y of adj[x]) if (low[y] && lab[y] < 0) { lab[y] = feet.length; stack.push(y); } }
    feet.push(g);
  }
  // the tail blade can hang low too; feet are the clusters out beside the body, not trailing behind it
  const tailEnd = bb.min.x + L * .22;
  const seeds = feet.filter(g => g.length > m * .002 && g.reduce((s2, c) => s2 + Math.abs(cz(c)), 0) / g.length > coreW * .9
    && (g.reduce((s2, c) => s2 + cpos[c * 3], 0) / g.length > tailEnd || g.reduce((s2, c) => s2 + Math.abs(cz(c)), 0) / g.length > coreW * 1.5)).sort((a, b) => b.length - a.length).slice(0, 8);

  // Each vertex goes to whichever is nearer along the surface: the torso core, or a foot.
  // Foot distances count for a third, so a leg's region runs all the way up to where it meets the body.
  const dijkstra = (src: number[], scale: number) => {
    const d = new Float32Array(m).fill(Infinity), heap: [number, number][] = [];
    const push = (x: number, dx: number) => { heap.push([dx, x]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let s2 = i; if (l < heap.length && heap[l][0] < heap[s2][0]) s2 = l; if (r < heap.length && heap[r][0] < heap[s2][0]) s2 = r; if (s2 === i) break; [heap[s2], heap[i]] = [heap[i], heap[s2]]; i = s2; } } return top; };
    for (const x of src) { d[x] = 0; push(x, 0); }
    while (heap.length) { const [dx, x] = pop(); if (dx > d[x]) continue; for (const y of adj[x]) { const nd = dx + dist(x, y) * scale; if (nd < d[y]) { d[y] = nd; push(y, nd); } } }
    return d;
  };
  const core: number[] = []; for (let c = 0; c < m; c++) if (Math.abs(cz(c)) < coreW * .7 && cy(c) > Hh * .35) core.push(c);
  const dBody = dijkstra(core, 1), dLegs = seeds.map(g => dijkstra(g, .33));
  const legOfC = new Int32Array(m).fill(-1);
  for (let c = 0; c < m; c++) { let best = dBody[c], who = -1; dLegs.forEach((d, k) => { if (d[c] < best) { best = d[c]; who = k; } }); legOfC[c] = who; }
  const legOf = new Int32Array(n); for (let i = 0; i < n; i++) legOf[i] = legOfC[canon[i]];

  const mean = (arr: THREE.Vector3[]) => arr.reduce((s2, p) => s2.add(p), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, arr.length));
  const cv = (c: number) => new THREE.Vector3(cpos[c * 3], cpos[c * 3 + 1], cpos[c * 3 + 2]);
  const legs: LegInfo[] = seeds.map((g, k) => {
    const mine: number[] = []; for (let c = 0; c < m; c++) if (legOfC[c] === k) mine.push(c);
    // hip: where the leg region borders the body; foot: the lowest points; knee: the highest point of the outer part
    const border = mine.filter(c => adj[c].some(y => legOfC[y] === -1));
    const hip = mean((border.length ? border : mine.slice(0, 5)).map(cv));
    const foot = mean([...mine].sort((a, b) => cy(a) - cy(b)).slice(0, Math.max(3, Math.floor(mine.length * .05))).map(cv));
    const span = hip.distanceTo(foot);
    const outer = mine.filter(c => cv(c).distanceTo(hip) > span * .25 && cv(c).distanceTo(foot) > span * .25);
    const knee = outer.length ? mean([...outer].sort((a, b) => cy(b) - cy(a)).slice(0, Math.max(3, Math.floor(outer.length * .1))).map(cv)) : hip.clone().lerp(foot, .5);
    return { hip, knee, foot, side: Math.sign(foot.z) || 1, front: hip.x };
  });

  // ---- skeleton ----
  const bones: THREE.Bone[] = [];
  const bone = (name: string, parent: THREE.Bone | null, at: THREE.Vector3) => {
    const b = new THREE.Bone(); b.name = name; bones.push(b);
    if (parent) { parent.add(b); const pw = (parent.userData.at as THREE.Vector3); b.position.copy(at).sub(pw); } else b.position.copy(at);
    b.userData.at = at.clone(); return b;
  };
  const root = bone('root', null, new THREE.Vector3(0, 0, 0));
  const body = bone('body', root, new THREE.Vector3(0, Hh * .55, 0));
  const neckX = bb.max.x - L * .3, tailX = bb.min.x + L * .42;
  const head = bone('head', body, new THREE.Vector3(neckX, Hh * .7, 0));
  const tail1 = bone('tail1', body, new THREE.Vector3(tailX, Hh * .6, 0));
  const tail2 = bone('tail2', tail1, new THREE.Vector3(tailX - L * .2, Hh * .62, 0));
  const legBones = legs.map((l, i) => {
    const up = bone(`leg${i}a`, body, l.hip), lo = bone(`leg${i}b`, up, l.knee);
    return { up, lo };
  });

  // ---- weights: dense per welded vertex, smoothed over the surface, then the top 4 kept ----
  const B = bones.length, BI = (b: THREE.Bone) => bones.indexOf(b);
  let Wt = new Float32Array(m * B);
  for (let c = 0; c < m; c++) {
    const p = cv(c), o = c * B, g = legOfC[c];
    if (g >= 0) {
      const l = legs[g], LB = legBones[g];
      const [d1] = segDist(p, l.hip, l.knee), [d2] = segDist(p, l.knee, l.foot);
      const toLo = smooth(-.05, .05, d1 - d2);
      Wt[o + BI(LB.lo)] += toLo; Wt[o + BI(LB.up)] += 1 - toLo;
    } else {
      const h = smooth(neckX - L * .1, neckX + L * .05, p.x) * smooth(Hh * .25, Hh * .45, p.y);
      const t1 = smooth(tailX + L * .05, tailX - L * .08, p.x), t2 = smooth(tailX - L * .14, tailX - L * .26, p.x);
      Wt[o + BI(head)] += h; Wt[o + BI(tail2)] += t2 * (1 - h); Wt[o + BI(tail1)] += (t1 - t2) * (1 - h); Wt[o + BI(body)] += Math.max(0, 1 - h - t1 * (1 - h));
    }
  }
  // Diffuse across the surface so every triangle sees a gradual change: hard weight edges are what
  // stretch into flaps when a limb swings.
  for (let it = 0; it < 10; it++) {
    const nx = new Float32Array(m * B);
    for (let c = 0; c < m; c++) {
      const o = c * B, nb = adj[c], k = nb.length ? .5 / nb.length : 0;
      for (let j = 0; j < B; j++) nx[o + j] = Wt[o + j] * (nb.length ? .5 : 1);
      for (const y of nb) for (let j = 0; j < B; j++) nx[o + j] += Wt[y * B + j] * k;
    }
    Wt = nx;
  }
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = canon[i] * B, top: [number, number][] = [];
    for (let j = 0; j < B; j++) if (Wt[o + j] > 1e-3) top.push([j, Wt[o + j]]);
    top.sort((a2, b2) => b2[1] - a2[1]); top.length = Math.min(4, top.length);
    const tot = top.reduce((s2, e) => s2 + e[1], 0) || 1;
    top.forEach(([bj, x], j) => { si[i * 4 + j] = bj; sw[i * 4 + j] = x / tot; });
    if (!top.length) { si[i * 4] = BI(body); sw[i * 4] = 1; }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.computeBoundingSphere();

  const mat = (mesh0.material as THREE.MeshStandardMaterial).clone();
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.add(root); mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.legs = legs.map(l => ({ side: l.side, front: l.front, hipZ: l.hip.z }));
  return { mesh, length: L, height: Hh, legCount: legs.length };
}

export interface RigInstance {
  g: THREE.Group;
  mat: THREE.MeshStandardMaterial;
  rig: { mesh: THREE.SkinnedMesh; bone: Record<string, THREE.Bone>; rest: Map<THREE.Bone, THREE.Quaternion>; legs: { side: number; front: number; phase: number }[]; height: number };
}

/** A placed copy with its own skeleton and its own material (so hit flashes and death fades stay per creature). */
export function instanceRig(t: RigTemplate, tint?: THREE.ColorRepresentation): RigInstance {
  const mesh = cloneSkinned(t.mesh) as THREE.SkinnedMesh;
  const mat = (t.mesh.material as THREE.MeshStandardMaterial).clone();
  if (tint !== undefined) mat.color.set(tint);
  mesh.material = mat;
  // cull against the rest pose grown by a third, so swinging legs never pop out at the screen edge
  // (and off-screen creatures skip both the main and the shadow pass)
  const bs = t.mesh.geometry.boundingSphere!.clone(); bs.radius *= 1.35; mesh.boundingSphere = bs;
  const g = new THREE.Group(); g.rotation.order = 'YXZ'; g.add(mesh);
  const bone: Record<string, THREE.Bone> = {}, rest = new Map<THREE.Bone, THREE.Quaternion>();
  mesh.traverse((o) => { if ((o as THREE.Bone).isBone) { bone[o.name] = o as THREE.Bone; rest.set(o as THREE.Bone, o.quaternion.clone()); } });
  // alternating tripod: front-to-back order on each side, neighbours and opposite legs out of phase
  const info = t.mesh.userData.legs as { side: number; front: number }[];
  const legs = info.map((l, i) => {
    const sameSide = info.filter(m => m.side === l.side).sort((a, b) => b.front - a.front), rank = sameSide.indexOf(l);
    return { side: l.side, front: l.front, phase: ((rank + (l.side > 0 ? 1 : 0)) % 2) * Math.PI, i };
  });
  return { g, mat, rig: { mesh, bone, rest, legs, height: t.height } };
}

const _q = new THREE.Quaternion(), _e = new THREE.Euler();
function pose(b: THREE.Bone | undefined, rest: Map<THREE.Bone, THREE.Quaternion>, x: number, y: number, z: number) {
  if (!b) return; _e.set(x, y, z, 'YXZ'); b.quaternion.copy(rest.get(b)!).multiply(_q.setFromEuler(_e));
}

export interface RigState { t: number; moving: number; attack: number; sleep: boolean; dead: number; turn: number }

/** Drives the bones: gait from `t` (advances with ground speed), lunges on `attack`, curled up asleep, limp when dead. */
export function animateRig(m: RigInstance, s: RigState): void {
  const { bone, rest, legs } = m.rig, t = s.t, mv = s.sleep ? 0 : s.moving;
  const idle = Math.sin(t * .9) * .5 + .5;
  // body: bob with the stride, crouch when asleep, rear back then strike when attacking
  const bob = Math.abs(Math.sin(t * 2.2)) * .04 * mv;
  bone.body.position.y = (bone.body.userData.at as THREE.Vector3).y * (s.sleep ? .78 : 1) + bob * m.rig.height;
  pose(bone.body, rest, Math.sin(t * 2.2) * .04 * mv, 0, (s.sleep ? .08 : 0) - s.attack * .18 + Math.sin(t * 1.1) * .02);
  // head: slow searching sway, snaps forward and up on attack, tucks low when asleep or dead
  pose(bone.head, rest, Math.sin(t * .7) * .12 * (1 - s.attack) + s.turn * .25, 0,
    (s.sleep ? -.35 : 0) + s.attack * .45 - idle * .06 + (s.dead ? -.5 : 0));
  // tail: lashing side to side, coiled tight asleep
  const lash = s.dead ? .1 : s.sleep ? .05 : .35 + mv * .1;
  pose(bone.tail1, rest, Math.sin(t * 1.4) * lash, 0, (s.sleep ? .35 : 0) + Math.sin(t * .8) * .06);
  pose(bone.tail2, rest, Math.sin(t * 1.4 - 1.1) * lash * 1.3, 0, (s.sleep ? .5 : 0) + s.attack * .3);
  // legs: lift and swing on the stride, knees flex as the foot comes up; splayed limp when dead
  legs.forEach((l, i) => {
    const up = bone[`leg${i}a`], lo = bone[`leg${i}b`]; if (!up) return;
    const ph = t * 2.2 + l.phase, lift = Math.max(0, Math.sin(ph)) * mv, swing = Math.cos(ph) * mv;
    if (s.dead) { pose(up, rest, 0, 0, 0); _e.set(-l.side * .5, 0, 0); up.quaternion.multiply(_q.setFromEuler(_e)); pose(lo, rest, -l.side * .8, 0, 0); return; }
    // rotation about x raises a leg on +z side when negative; about y swings it fore and aft
    pose(up, rest, -l.side * (lift * .38 + (s.sleep ? .22 : 0)) + Math.sin(t * 3 + i) * .015, swing * .26 * l.side, 0);
    pose(lo, rest, l.side * lift * .45, 0, s.attack * (l.front > 0 ? .5 : 0));
  });
}
