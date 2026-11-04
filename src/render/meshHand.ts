import * as THREE from 'three';
import type { ModelAsset } from './models';
import type { HandPose } from './viewmodels';

/**
 * First-person arm from an AI-generated model (Meshy and similar): one static mesh of a gloved
 * forearm and open hand, rigged in code on load.
 *
 * The rig is found from the shape alone. The wrist is the narrowest slice between the sleeve and the
 * hand. Fingertips are the five far ends of the surface, measured by walking over the mesh from the
 * wrist. Walking back from each tip in rings traces the finger's centreline until the rings open out
 * into the palm (the web), and the knuckle sits a little past that. Joints are spaced along each
 * finger in human proportions. Weights come from the nearest bone, kept within each finger, then
 * smoothed over the surface.
 *
 * The bones are driven by the same `HandPose` curls as the code-built hand, so every grip, reload
 * and charging-handle pose carries over unchanged.
 *
 * Native frame matches `Hand` in viewmodels.ts: wrist at the origin, fingers along +x, the index
 * side toward +y and the back of the hand toward +z. A left hand is the same rig mirrored in z.
 */

/** Model frame: where its fingers point and which side its thumb is on. */
export interface HandArtOptions {
  /** Wrist to middle fingertip, metres. */
  length?: number;
  /** The model's thumb is on its -y side when viewed with fingers along +x and the back toward +z (a left hand). */
  modelIsLeft?: boolean;
  /** Squeeze the sleeve's girth toward the arm's axis (1 keeps it). */
  sleeve?: number;
  /** Stretch the sleeve toward the elbow (1 keeps it). */
  stretch?: number;
}

export interface HandTemplate {
  geo: THREE.BufferGeometry;
  mat: THREE.MeshStandardMaterial;
  /** Rest pose of each bone in the native frame; order: hand, 4 fingers x 3, thumb x 3, arm. */
  rest: THREE.Matrix4[];
  /** Per finger (index first): knuckle position, bone lengths, and its spread angle in the palm plane. */
  fingers: { at: THREE.Vector3; len: number[]; yaw: number }[];
  thumb: { at: THREE.Vector3; len: number[] };
  /** Length multiplier for the sleeve. */
  armStretch: number;
  /** Joint positions for debugging views. */
  joints: THREE.Vector3[];
}

const BONES = 17, ARM = 16, THUMB = 13;
const fingerBone = (i: number, k: number) => 1 + i * 3 + k;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = V().subVectors(b, a), t = Math.min(1, Math.max(0, V().subVectors(p, a).dot(ab) / Math.max(1e-12, ab.lengthSq())));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/** Bone frame: x along `dir`, z as close to `zHint` as allowed. */
function frame(dir: THREE.Vector3, zHint = V(0, 0, 1)): THREE.Quaternion {
  const x = dir.clone().normalize(), y = V().crossVectors(zHint, x).normalize(), z = V().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export function buildHandTemplate(asset: ModelAsset, opts: HandArtOptions = {}): HandTemplate {
  // ---- bake to one float geometry in the model frame ----
  let src: THREE.Mesh | null = null;
  asset.scene.updateMatrixWorld(true);
  asset.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && !src) src = o as THREE.Mesh; });
  if (!src) throw new Error('hand: model has no mesh');
  const mesh0 = src as THREE.Mesh, geo = (mesh0.geometry as THREE.BufferGeometry).clone();
  for (const name of ['position', 'normal', 'uv']) {
    const a = geo.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (a && !(a.array instanceof Float32Array)) {
      const f = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) f[i * a.itemSize + k] = a.getComponent(i, k);
      geo.setAttribute(name, new THREE.BufferAttribute(f, a.itemSize));
    }
  }
  geo.applyMatrix4(mesh0.matrixWorld);
  if (!geo.index) geo.setIndex(Array.from({ length: geo.getAttribute('position').count }, (_, i) => i));
  // a left-hand model becomes the native right hand by mirroring y (and turning its triangles back the right way out)
  if (opts.modelIsLeft ?? true) {
    geo.scale(1, -1, 1);
    const idx = geo.index!.array; for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
    geo.index!.needsUpdate = true;
  }
  const pos = geo.getAttribute('position') as THREE.BufferAttribute, n = pos.count;

  // ---- wrist: the narrowest slice between the sleeve and the spread hand ----
  geo.computeBoundingBox();
  const bb0 = geo.boundingBox!, L0 = bb0.max.x - bb0.min.x, NB = 48;
  const ext = Array.from({ length: NB }, () => [Infinity, -Infinity, Infinity, -Infinity]);
  for (let i = 0; i < n; i++) {
    const b = Math.min(NB - 1, Math.floor((pos.getX(i) - bb0.min.x) / L0 * NB)), e = ext[b];
    e[0] = Math.min(e[0], pos.getY(i)); e[1] = Math.max(e[1], pos.getY(i)); e[2] = Math.min(e[2], pos.getZ(i)); e[3] = Math.max(e[3], pos.getZ(i));
  }
  let wb = -1, best = Infinity;
  for (let b = Math.floor(NB * .3); b < Math.floor(NB * .75); b++) { const e = ext[b], a = (e[1] - e[0]) * (e[3] - e[2]); if (a < best) { best = a; wb = b; } }
  const we = ext[wb], wristX = bb0.min.x + (wb + .5) / NB * L0;
  const k = (opts.length ?? .2) / (bb0.max.x - wristX);
  geo.translate(-wristX, -(we[0] + we[1]) / 2, -(we[2] + we[3]) / 2); geo.scale(k, k, k);

  // sleeve girth: squeeze toward the forearm's axis, from nothing at the cuff to full along the sleeve
  const sq = opts.sleeve ?? .8;
  if (sq !== 1) for (let i = 0; i < n; i++) {
    const s = 1 + (sq - 1) * smooth(-.01, -.05, pos.getX(i));
    pos.setY(i, pos.getY(i) * s); pos.setZ(i, pos.getZ(i) * s);
  }
  geo.computeVertexNormals();
  geo.computeBoundingBox();

  // ---- mesh graph over welded positions (UV seams split vertices that share a position) ----
  const key = new Map<string, number>(), canon = new Int32Array(n), v = V();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i); const kk = `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`; let c = key.get(kk); if (c === undefined) { c = key.size; key.set(kk, c); } canon[i] = c; }
  const m = key.size, cp: THREE.Vector3[] = new Array(m);
  for (let i = 0; i < n; i++) if (!cp[canon[i]]) cp[canon[i]] = V().fromBufferAttribute(pos, i);
  const adj: number[][] = Array.from({ length: m }, () => []);
  const link = (a: number, b: number) => { if (a !== b && !adj[a].includes(b)) { adj[a].push(b); adj[b].push(a); } };
  const index = geo.index!.array;
  for (let t = 0; t < index.length; t += 3) { const a = canon[index[t]], b = canon[index[t + 1]], c = canon[index[t + 2]]; link(a, b); link(b, c); link(a, c); }

  const dijkstra = (srcs: number[], limit = Infinity) => {
    const d = new Float64Array(m).fill(Infinity), heap: [number, number][] = [];
    const push = (x: number, dx: number) => { heap.push([dx, x]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let s = i; if (l < heap.length && heap[l][0] < heap[s][0]) s = l; if (r < heap.length && heap[r][0] < heap[s][0]) s = r; if (s === i) break; [heap[s], heap[i]] = [heap[i], heap[s]]; i = s; } } return top; };
    for (const x of srcs) { d[x] = 0; push(x, 0); }
    while (heap.length) {
      const [dx, x] = pop(); if (dx > d[x] || dx > limit) continue;
      for (const y of adj[x]) { const nd = dx + cp[x].distanceTo(cp[y]); if (nd < d[y]) { d[y] = nd; push(y, nd); } }
    }
    return d;
  };

  // ---- fingertips: the far ends of the surface walking out from the wrist ----
  const ring: number[] = []; for (let c = 0; c < m; c++) if (Math.abs(cp[c].x) < .004) ring.push(c);
  const dW = dijkstra(ring);
  const isPeak = (c: number) => {
    if (!(cp[c].x > .04) || !isFinite(dW[c])) return false;
    for (const y of adj[c]) { if (dW[y] > dW[c]) return false; for (const z of adj[y]) if (dW[z] > dW[c]) return false; }
    return true;
  };
  // a tip must stand at least 2 cm proud: walking down from it by that much never leads anywhere higher
  // (bumps on the knuckle armour and seams make small false peaks)
  const prominent = (p: number) => {
    const floor = dW[p] - .02, seen = new Set([p]), st = [p];
    while (st.length) { const x = st.pop()!; for (const y of adj[x]) if (!seen.has(y) && dW[y] >= floor) { if (dW[y] > dW[p]) return false; seen.add(y); st.push(y); } }
    return true;
  };
  const peaks: number[] = []; for (let c = 0; c < m; c++) if (isPeak(c) && prominent(c)) peaks.push(c);
  peaks.sort((a, b) => dW[b] - dW[a]);
  const tips: number[] = [], taken = new Uint8Array(m);
  for (const c of peaks) {
    if (taken[c]) continue;
    tips.push(c); const d = dijkstra([c], .03); for (let y = 0; y < m; y++) if (d[y] < .03) taken[y] = 1;
    if (tips.length === 5) break;
  }
  if (tips.length < 5) throw new Error(`hand: found ${tips.length} fingertips, need 5`);
  // the thumb is the tip that stops shortest along the arm; the rest run index (+y) to little
  tips.sort((a, b) => cp[a].x - cp[b].x);
  const thumbTip = tips[0], fingerTips = tips.slice(1).sort((a, b) => cp[b].y - cp[a].y);

  // ---- centrelines: rings of equal surface distance from each tip, until they open into the palm ----
  const all = [...fingerTips, thumbTip];
  const dT = all.map(t => dijkstra([t], .14));
  const chains = all.map((_, f) => {
    const d = dT[f], step = .004, cents: THREE.Vector3[] = [];
    let ref = 0;
    for (let s = .004; s < .13; s += step) {
      const band: THREE.Vector3[] = []; for (let c = 0; c < m; c++) if (d[c] >= s && d[c] < s + step) band.push(cp[c]);
      if (band.length < 6) break;
      const ce = band.reduce((a, p) => a.add(p), V()).multiplyScalar(1 / band.length);
      const r = band.reduce((a, p) => a + p.distanceTo(ce), 0) / band.length;
      // the first rings round the fingertip are small; the finger's own girth is the widest ring of its first 2.5 cm
      if (s < .025) ref = Math.max(ref, r);
      else if (r > ref * 1.5 || ce.distanceTo(cents[cents.length - 1]) > step * 2.5) break;
      cents.push(ce);
    }
    return { cents, radius: ref };
  });
  const arc = (pts: THREE.Vector3[]) => pts.slice(1).reduce((a, p, i) => a + p.distanceTo(pts[i]), 0);
  /** Point at arc length `s` along a polyline. */
  const along = (pts: THREE.Vector3[], s: number) => {
    for (let i = 1; i < pts.length; i++) { const l = pts[i].distanceTo(pts[i - 1]); if (s <= l) return pts[i - 1].clone().lerp(pts[i], s / Math.max(l, 1e-9)); s -= l; }
    return pts[pts.length - 1].clone();
  };

  const joints: THREE.Vector3[] = [];
  const fingers = fingerTips.map((_, f) => {
    const { cents } = chains[f], web = cents[cents.length - 1], mid = cents[Math.floor(cents.length / 2)];
    const vis = arc(cents), dir = V().subVectors(web, mid).normalize();
    const tip = cents[0].clone().addScaledVector(V().subVectors(cents[0], cents[Math.min(2, cents.length - 1)]).normalize(), .006);
    // the knuckle sits inside the palm past the web, about a quarter of the finger further on
    const mcp = web.clone().addScaledVector(dir, vis * .3);
    const line = [mcp, ...[...cents].reverse(), tip], Lt = arc(line);
    const j = [mcp, along(line, Lt * .47), along(line, Lt * .76), tip];
    joints.push(...j);
    const flat = V().subVectors(tip, mcp).setZ(0);
    return { j, yaw: Math.atan2(flat.y, flat.x) };
  });
  const tc = chains[4].cents, tWeb = tc[tc.length - 1], tMid = tc[Math.floor(tc.length / 2)], tVis = arc(tc);
  const tTip = tc[0].clone().addScaledVector(V().subVectors(tc[0], tc[Math.min(2, tc.length - 1)]).normalize(), .006);
  const tMcp = tWeb.clone().addScaledVector(V().subVectors(tWeb, tMid).normalize(), tVis * .1);
  const tLine = [tMcp, ...[...tc].reverse(), tTip], tIp = along(tLine, arc(tLine) * .5);
  // the thumb's base (CMC) is deep in the heel of the hand, toward the wrist and the palm side
  const base = V(.012, .012, -.012), tCmc = tMcp.clone().addScaledVector(V().subVectors(base, tMcp).normalize(), Math.min(.042, tMcp.distanceTo(base) * .85));
  const thumbJ = [tCmc, tMcp, tIp, tTip];
  joints.push(...thumbJ);

  // ---- bones (rest frames in the native frame) ----
  const rest: THREE.Matrix4[] = new Array(BONES);
  rest[0] = new THREE.Matrix4();
  const restOf = (a: THREE.Vector3, b: THREE.Vector3) => new THREE.Matrix4().compose(a, frame(V().subVectors(b, a)), V(1, 1, 1));
  fingers.forEach((F, i) => { for (let kk = 0; kk < 3; kk++) rest[fingerBone(i, kk)] = restOf(F.j[kk], F.j[kk + 1]); });
  for (let kk = 0; kk < 3; kk++) rest[THUMB + kk] = restOf(thumbJ[kk], thumbJ[kk + 1]);
  rest[ARM] = new THREE.Matrix4().makeBasis(V(-1, 0, 0), V(0, 0, 1), V(0, 1, 0));

  // ---- weights ----
  // which finger a vertex belongs to: nearest tip along the surface, while still within that finger's visible length
  const vis = chains.map(c => arc(c.cents) + .004);
  const segs: { a: THREE.Vector3; b: THREE.Vector3; bone: number }[] = [];
  fingers.forEach((F, i) => { segs.push({ a: V(), b: F.j[0], bone: 0 }); segs.push({ a: F.j[0], b: F.j[1], bone: fingerBone(i, 0) }); });
  segs.push({ a: V(), b: tCmc, bone: 0 }, { a: tCmc, b: tMcp, bone: THUMB }, { a: tMcp, b: tIp, bone: THUMB + 1 });
  let Wt = new Float32Array(m * BONES);
  for (let c = 0; c < m; c++) {
    const p = cp[c], o = c * BONES, armW = smooth(.008, -.022, p.x);
    if (armW > 0) Wt[o + ARM] += armW;
    if (armW >= 1) continue;
    let f = -1, fd = Infinity;
    dT.forEach((d, q) => { if (d[c] < vis[q] && d[c] < fd) { fd = d[c]; f = q; } });
    let bone = 0;
    if (f >= 0) {
      const J = f < 4 ? fingers[f].j : thumbJ, b0 = f < 4 ? fingerBone(f, 0) : THUMB;
      let bd = Infinity; for (let kk = 0; kk < 3; kk++) { const dd = segDist(p, J[kk], J[kk + 1]); if (dd < bd) { bd = dd; bone = b0 + kk; } }
    } else {
      let bd = Infinity; for (const s of segs) { const dd = segDist(p, s.a, s.b); if (dd < bd) { bd = dd; bone = s.bone; } }
    }
    Wt[o + bone] += 1 - armW;
  }
  // smooth over the surface so joints bend gradually instead of creasing
  for (let it = 0; it < 6; it++) {
    const nx = new Float32Array(m * BONES);
    for (let c = 0; c < m; c++) {
      const o = c * BONES, nb = adj[c], w = nb.length ? .5 / nb.length : 0;
      for (let j = 0; j < BONES; j++) nx[o + j] = Wt[o + j] * (nb.length ? .5 : 1);
      for (const y of nb) for (let j = 0; j < BONES; j++) nx[o + j] += Wt[y * BONES + j] * w;
    }
    Wt = nx;
  }
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = canon[i] * BONES, top: [number, number][] = [];
    for (let j = 0; j < BONES; j++) if (Wt[o + j] > 1e-3) top.push([j, Wt[o + j]]);
    top.sort((a, b) => b[1] - a[1]); top.length = Math.min(4, top.length);
    const tot = top.reduce((s, e) => s + e[1], 0) || 1;
    top.forEach(([bj, x], j) => { si[i * 4 + j] = bj; sw[i * 4 + j] = x / tot; });
    if (!top.length) sw[i * 4] = 1;
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));

  const mat = (mesh0.material as THREE.MeshStandardMaterial).clone();
  // keep the glove from turning glossy under the snowfield sky
  mat.envMapIntensity = .5; mat.side = THREE.FrontSide;
  return {
    geo, mat, rest, joints, armStretch: opts.stretch ?? 1.6,
    fingers: fingers.map(F => ({ at: F.j[0], len: [0, 1, 2].map(kk => F.j[kk].distanceTo(F.j[kk + 1])), yaw: F.yaw })),
    thumb: { at: tCmc, len: [0, 1, 2].map(kk => thumbJ[kk].distanceTo(thumbJ[kk + 1])) },
  };
}

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _z = V(0, 0, 1), _y = V(0, 1, 0);

/** A skinned arm built from a template: `root` is the hand (wrist frame), `arm` the forearm, each placed by the caller. */
export class MeshHand {
  readonly root = new THREE.Group();
  readonly arm = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  private fingers: THREE.Bone[][] = [];
  private thumb: THREE.Bone[] = [];
  private yaw: THREE.Quaternion[];
  private cur: HandPose = { f: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], t: [0, 0, 0, 0, 0] };
  constructor(t: HandTemplate, side: 1 | -1) {
    const mirror = new THREE.Group(); mirror.scale.z = side; this.root.add(mirror);
    const hand = new THREE.Bone(); mirror.add(hand);
    const bones: THREE.Bone[] = [hand];
    t.fingers.forEach((F) => {
      const chain: THREE.Bone[] = []; let parent: THREE.Object3D = hand;
      for (let kk = 0; kk < 3; kk++) {
        const b = new THREE.Bone(); if (kk === 0) b.position.copy(F.at); else b.position.set(F.len[kk - 1], 0, 0);
        parent.add(b); chain.push(b); bones.push(b); parent = b;
      }
      this.fingers.push(chain);
    });
    let parent: THREE.Object3D = hand;
    for (let kk = 0; kk < 3; kk++) {
      const b = new THREE.Bone(); if (kk === 0) b.position.copy(t.thumb.at); else b.position.set(t.thumb.len[kk - 1], 0, 0);
      parent.add(b); this.thumb.push(b); bones.push(b); parent = b;
    }
    // the forearm bone rides the arm frame (x toward the elbow, y over the back of the hand), mirrored with the hand
    const armMirror = new THREE.Group(); armMirror.scale.y = side; this.arm.add(armMirror);
    const arm = new THREE.Bone(); armMirror.add(arm); bones.push(arm);
    // generated sleeves stop a hand's length up the forearm; stretch toward the elbow so the open end stays off screen
    arm.scale.x = t.armStretch;
    this.yaw = t.fingers.map(F => new THREE.Quaternion().setFromAxisAngle(_z, F.yaw));

    this.mesh = new THREE.SkinnedMesh(t.geo, t.mat);
    this.mesh.frustumCulled = false; this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    mirror.add(this.mesh);
    this.mesh.bind(new THREE.Skeleton(bones, t.rest.map(r => r.clone().invert())), new THREE.Matrix4());
  }
  pose(p: HandPose): void {
    this.fingers.forEach((chain, i) => {
      chain[0].quaternion.copy(this.yaw[i]).multiply(_q.setFromAxisAngle(_y, p.f[i][0]));
      chain[1].quaternion.setFromAxisAngle(_y, p.f[i][1]);
      chain[2].quaternion.setFromAxisAngle(_y, p.f[i][2]);
    });
    // same thumb motion as the code-built hand: swing out (abd), round in front of the palm (opp), roll, then fold
    const [abd, opp, roll, c1, c2] = p.t, th = this.thumb;
    th[0].quaternion.setFromEuler(_e.set(roll, opp, .3 + abd, 'XYZ'));
    th[1].quaternion.setFromEuler(_e.set(0, opp * .25, -c1, 'XYZ'));
    th[2].quaternion.setFromEuler(_e.set(0, 0, -c2, 'XYZ'));
  }
  blend(a: HandPose, b: HandPose, k: number): void {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) this.cur.f[i][j] = THREE.MathUtils.lerp(a.f[i][j], b.f[i][j], k);
    for (let j = 0; j < 5; j++) this.cur.t[j] = THREE.MathUtils.lerp(a.t[j], b.t[j], k);
    this.pose(this.cur);
  }
}
