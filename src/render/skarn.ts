import * as THREE from 'three';
import type { PBRSet } from './materials';
import { loft, latheX, plate, type Section } from './shapes';

/**
 * The Skarn's look, built in code: glossy black biomechanical hide, a long ribbed cranium,
 * jaws with steel-coloured teeth, dorsal tubes, jointed clawed legs and a bladed segmented tail.
 * Geometry is made once per creature type and shared; `animSkarn` in game.js poses the parts.
 */

// Tileable value noise on a `period`-cell grid.
function noise2(x: number, y: number, period: number, seed: number): number {
  const h = (i: number, j: number) => {
    const n = Math.sin(((i % period + period) % period) * 127.1 + ((j % period + period) % period) * 311.7 + seed * 74.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(h(xi, yi), h(xi + 1, yi), u), THREE.MathUtils.lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
}

/**
 * Hide texture set for the triplanar shader: fine horizontal ribbing broken by noise, raised
 * vein-like cords, and pitted hollows. Returned as colour, normal and ARM canvases.
 */
export function skinSet(size = 256): PBRSet {
  const N = size, hgt = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const warp = noise2(u * 6, v * 6, 6, 1) * 1.6;
    const ribs = Math.pow(Math.abs(Math.sin((v * 12 + warp * .35) * Math.PI)), .6);
    const cord = 1 - Math.min(1, Math.abs(noise2(u * 5, v * 5, 5, 2) - .5) * 9); // thin ridges where the noise crosses its midline
    const pits = Math.max(0, noise2(u * 16, v * 16, 16, 3) - .62) * 3;
    hgt[y * N + x] = ribs * .55 + cord * .5 - pits * .6 + noise2(u * 32, v * 32, 32, 4) * .12;
  }
  const canvas = (fn: (d: Uint8ClampedArray, i: number, x: number, y: number) => void) => {
    const c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d')!, img = g.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) fn(img.data, (y * N + x) * 4, x, y);
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  };
  const H = (x: number, y: number) => hgt[((y + N) % N) * N + ((x + N) % N)];
  const color = canvas((d, i, x, y) => { const k = 150 + H(x, y) * 70; d[i] = k; d[i + 1] = k; d[i + 2] = k * 1.04; d[i + 3] = 255; });
  color.colorSpace = THREE.SRGBColorSpace;
  const normal = canvas((d, i, x, y) => {
    const dx = (H(x + 1, y) - H(x - 1, y)) * 2.2, dy = (H(x, y + 1) - H(x, y - 1)) * 2.2, l = Math.hypot(dx, dy, 1);
    d[i] = (-dx / l * .5 + .5) * 255; d[i + 1] = (dy / l * .5 + .5) * 255; d[i + 2] = (1 / l * .5 + .5) * 255; d[i + 3] = 255;
  });
  // AO darkens the hollows, roughness rises there too so the wet sheen sits on the ridges
  const arm = canvas((d, i, x, y) => { const h = H(x, y); d[i] = 120 + h * 135; d[i + 1] = 255 * (.75 - h * .35); d[i + 2] = 0; d[i + 3] = 255; });
  let m = 0; for (let k = 0; k < hgt.length; k++) m += 150 + hgt[k] * 70;
  const mean = THREE.MathUtils.clamp(m / hgt.length / 255, 0, 1), lin = Math.pow(mean, 2.2);
  return { color, normal, arm, mean: new THREE.Vector3(lin, lin, lin * 1.04) };
}

export interface SkarnGeometry {
  body: THREE.BufferGeometry;
  cranium: THREE.BufferGeometry;
  jaw: THREE.BufferGeometry;
  tubes: THREE.BufferGeometry[];
  ribs: THREE.BufferGeometry;
  /** Unit-length leg segments along +y from -0.5 (hip or knee) to +0.5 (knee or claw), radius 1, for `seg()`. */
  legUpper: THREE.BufferGeometry;
  legLower: THREE.BufferGeometry;
  /** A tail vertebra, about 2 long along x and radius 1; animSkarn scales it per segment. */
  vertebra: THREE.BufferGeometry;
  blade: THREE.BufferGeometry;
  tooth: THREE.BufferGeometry;
  crest?: THREE.BufferGeometry;
}

const sec = (s: number, x: number, w: number, h: number, y: number, n = 2.3, belly = 0.15): Section => ({ x: x * s, w: w * s, h: h * s, y: y * s, n, belly });

function latheY(profile: [number, number][], segments = 10): THREE.BufferGeometry {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

const cache = new Map<string, SkarnGeometry>();

export function skarnGeometry(type: string, s: number): SkarnGeometry {
  const hit = cache.get(type); if (hit) return hit;
  const crawler = type === 'crawler', brood = type === 'brood';
  let body: THREE.BufferGeometry;
  if (crawler) {
    // flat, many-ribbed carapace with a short tail root, like a hand made of bone
    const secs = [sec(s, -.9, .2, .15, .5)];
    for (let i = 0; i <= 10; i++) { const x = -.75 + i * .14, k = Math.sin((i / 10) * Math.PI); secs.push(sec(s, x, (.9 + k * .5) * (i % 2 ? .92 : 1), (.3 + k * .22) * (i % 2 ? .9 : 1), .55, 2.4, .5)); }
    secs.push(sec(s, .8, .45, .25, .55), sec(s, 1.0, .1, .08, .55));
    body = loft(secs, 20);
  } else {
    // abdomen into a ribbed thorax, then the neck
    const secs = [sec(s, -1.15, .25, .25, .95), sec(s, -.95, .62, .58, .98), sec(s, -.65, .86, .8, 1.0)];
    for (let i = 0; i < 9; i++) secs.push(sec(s, -.45 + i * .14, i % 2 ? .86 : .97, i % 2 ? .78 : .88, 1.02 + i * .008));
    secs.push(sec(s, .85, .68, .68, 1.08), sec(s, 1.08, .36, .36, 1.13), sec(s, 1.2, .2, .2, 1.15));
    body = loft(secs, 22);
  }
  // the long smooth cranium sweeping back from the face, slightly ribbed underneath
  const hs = crawler ? s * .4 : brood ? s * .6 : s * .62;
  const cranium = loft([
    sec(hs, -1.6, .05, .05, .78, 2), sec(hs, -1.3, .16, .18, .66), sec(hs, -.9, .3, .32, .48), sec(hs, -.45, .42, .44, .3),
    sec(hs, 0, .46, .46, .12), sec(hs, .35, .4, .36, 0, 2.4, .3), sec(hs, .6, .3, .24, -.05, 2.4, .3), sec(hs, .78, .16, .12, -.07, 2.2, .2), sec(hs, .86, .04, .04, -.08, 2),
  ], 22);
  const jaw = loft([sec(hs, -.1, .22, .12, -.2, 2.5), sec(hs, .35, .24, .13, -.2, 2.5), sec(hs, .7, .16, .09, -.17, 2.5), sec(hs, .82, .05, .05, -.15, 2)], 14);
  const tooth = new THREE.ConeGeometry(.018 * hs, .09 * hs, 5).rotateX(Math.PI);
  const tubes: THREE.BufferGeometry[] = [];
  if (!crawler && !brood) {
    for (const side of [-1, 1]) for (let j = 0; j < 2; j++) {
      const x0 = (-.05 - j * .35) * s, z0 = side * .22 * s;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x0, 1.3 * s, z0), new THREE.Vector3(x0 - .25 * s, 1.75 * s, z0 + side * .2 * s),
        new THREE.Vector3(x0 - .7 * s, 2.0 * s, z0 + side * .38 * s), new THREE.Vector3(x0 - 1.0 * s, 1.95 * s, z0 + side * .45 * s),
      ]);
      tubes.push(new THREE.TubeGeometry(curve, 16, .06 * s, 7, false));
    }
  }
  // rib arcs over the flanks
  const ribParts: THREE.BufferGeometry[] = [];
  if (!crawler) for (let i = 0; i < 5; i++) {
    const r = new THREE.TorusGeometry(.47 * s, .035 * s, 5, 14, Math.PI * .9);
    r.rotateY(Math.PI / 2); r.rotateX(-Math.PI * .45 + .08); r.translate((-.35 + i * .2) * s, 1.0 * s, 0);
    ribParts.push(r.toNonIndexed());
  }
  const ribs = ribParts.length ? mergeAll(ribParts) : new THREE.BufferGeometry();
  // legs: a muscled upper with a knuckled knee, a thin lower ending in a hooked claw
  const legUpper = latheY([[0, -.5], [.75, -.48], [1, -.3], [.9, 0], [.62, .3], [.7, .42], [.55, .5], [0, .5]]);
  const legLower = latheY([[0, -.5], [.8, -.48], [.95, -.4], [.7, -.2], [.55, .2], [.38, .35], [.5, .4], [.2, .47], [0, .55]]);
  const vertebra = latheX([[0, -1], [.55, -.95], [.85, -.62], [1, -.2], [.92, .2], [.62, .55], [.78, .72], [.5, .95], [0, 1]], 10);
  vertebra.translate(-1, 0, 0);
  const blade = plate([[0, 0], [-.35 * s, .14 * s], [-.75 * s, .02 * s], [-.9 * s, 0], [-.75 * s, -.02 * s], [-.35 * s, -.14 * s]], .03 * s, .01 * s);
  blade.rotateX(Math.PI / 2);
  let crest: THREE.BufferGeometry | undefined;
  if (type === 'warden') crest = plate([[0, -.05 * s], [-.9 * s, -.025 * s], [-1.0 * s, 0], [-.9 * s, .025 * s], [0, .05 * s]], .05 * s, .015 * s);
  if (brood) crest = plate([[0, -.06 * s], [-1.6 * s, -.03 * s], [-1.7 * s, 0], [-1.6 * s, .03 * s], [0, .06 * s]], .05 * s, .015 * s);
  const out = { body, cranium, jaw, tubes, ribs, legUpper, legLower, vertebra, blade, tooth, crest };
  cache.set(type, out);
  return out;
}

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0; for (const p of parts) count += p.attributes.position.count;
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3);
  let o = 0;
  for (const p of parts) { pos.set(p.attributes.position.array as Float32Array, o * 3); nrm.set(p.attributes.normal.array as Float32Array, o * 3); o += p.attributes.position.count; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}
