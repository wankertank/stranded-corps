/**
 * Veyra-9's playable basin: about a kilometre across, ringed by mountains that can't be climbed.
 *
 * The height comes from layered value noise (rolling plains, ridge lines in some regions, small bumps),
 * shaped around the points of interest (flattened pads, a hill for the relay, a crater bowl, a lake bed)
 * and lifted into steep mountains at the edge. It is sampled once onto a grid, and `H` reads that grid
 * with bilinear filtering, so gameplay height matches the rendered terrain and costs a few multiplies.
 */

export const WORLD = 1160;
/** Metres in from the map edge where the invisible boundary sits, at the foot of the mountains. */
export const BOUND = 80;
/** Terrain grid spacing in metres; the render mesh uses the same vertices. */
export const CELL = 2.5;
export const GRID_N = Math.round(WORLD / CELL); // segments per side

export type POIKind = 'crash' | 'hive' | 'town' | 'dome' | 'rig' | 'port' | 'relay' | 'lab' | 'reactor' | 'wreck' | 'pocket' | 'crater' | 'lake';
export interface POI {
  id: string; name: string; kind: POIKind; x: number; z: number;
  /** Flat out to `r`, blending back into the land by `r2`. */
  r: number; r2: number;
  /** Raise (or sink) the pad relative to the land under its centre. */
  lift?: number;
  /** Set after the terrain is built: the pad's height. */
  y?: number;
}

export const POIS: POI[] = [
  { id: 'base', name: 'CRASH SITE', kind: 'crash', x: 560, z: 800, r: 22, r2: 44 },
  { id: 'hive', name: 'SKARN NEST', kind: 'hive', x: 930, z: 230, r: 30, r2: 55 },
  { id: 'town', name: 'HALDANE COLONY', kind: 'town', x: 420, z: 420, r: 62, r2: 95 },
  { id: 'domeA', name: 'HALDANE DOME A', kind: 'dome', x: 250, z: 650, r: 14, r2: 26 },
  { id: 'domeB', name: 'HALDANE DOME B', kind: 'dome', x: 760, z: 565, r: 14, r2: 26 },
  { id: 'domeC', name: 'HALDANE DOME C', kind: 'dome', x: 330, z: 960, r: 14, r2: 26 },
  { id: 'domeD', name: 'HALDANE DOME D', kind: 'dome', x: 880, z: 760, r: 14, r2: 26 },
  { id: 'domeE', name: 'HALDANE DOME E', kind: 'dome', x: 640, z: 300, r: 14, r2: 26 },
  { id: 'domeF', name: 'HALDANE DOME F', kind: 'dome', x: 200, z: 240, r: 14, r2: 26 },
  { id: 'rig1', name: 'MINING RIG 1', kind: 'rig', x: 990, z: 470, r: 12, r2: 22 },
  { id: 'rig2', name: 'MINING RIG 2', kind: 'rig', x: 150, z: 450, r: 12, r2: 22 },
  { id: 'rig3', name: 'MINING RIG 3', kind: 'rig', x: 700, z: 1010, r: 12, r2: 22 },
  { id: 'rig4', name: 'MINING RIG 4', kind: 'rig', x: 1010, z: 1000, r: 12, r2: 22 },
  { id: 'rig5', name: 'MINING RIG 5', kind: 'rig', x: 470, z: 645, r: 12, r2: 22 },
  { id: 'rig6', name: 'MINING RIG 6', kind: 'rig', x: 820, z: 385, r: 12, r2: 22 },
  { id: 'port', name: 'KESSLER LANDING FIELD', kind: 'port', x: 230, z: 840, r: 58, r2: 90 },
  { id: 'relay', name: 'RELAY STATION K-7', kind: 'relay', x: 620, z: 150, r: 13, r2: 55, lift: 20 },
  { id: 'lab', name: 'XENOBIOLOGY LAB', kind: 'lab', x: 1010, z: 640, r: 26, r2: 45 },
  { id: 'reactor', name: 'GEOTHERMAL PLANT', kind: 'reactor', x: 130, z: 630, r: 30, r2: 52 },
  { id: 'wreck', name: 'HAULER WRECK', kind: 'wreck', x: 770, z: 860, r: 26, r2: 46 },
  { id: 'pocket1', name: 'BROOD POCKET', kind: 'pocket', x: 330, z: 160, r: 14, r2: 30 },
  { id: 'pocket2', name: 'BROOD POCKET', kind: 'pocket', x: 900, z: 1060, r: 14, r2: 30 },
  { id: 'pocket3', name: 'BROOD POCKET', kind: 'pocket', x: 605, z: 560, r: 14, r2: 30 },
  { id: 'crater', name: 'IMPACT CRATER', kind: 'crater', x: 410, z: 820, r: 52, r2: 70 },
  { id: 'lake', name: 'FROZEN LAKE', kind: 'lake', x: 700, z: 450, r: 44, r2: 60 },
];
export const poi = (id: string) => POIS.find(p => p.id === id)!;

// ---------- noise ----------
function mulberry(a: number) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function valueNoise(n: number, seed: number) {
  const r = mulberry(seed), g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = r();
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const x0 = ((xi % n) + n) % n, y0 = ((yi % n) + n) % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = g[y0 * n + x0], b = g[y0 * n + x1], c = g[y1 * n + x0], d = g[y1 * n + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
type Noise = ReturnType<typeof valueNoise>;
export const fbm = (nz: Noise, x: number, y: number, oct: number) => { let s = 0, amp = .5, f = 1, tot = 0; for (let i = 0; i < oct; i++) { s += nz(x * f, y * f) * amp; tot += amp; amp *= .5; f *= 2; } return s / tot; };
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const NZ = [valueNoise(64, 3), valueNoise(64, 8), valueNoise(64, 13), valueNoise(64, 21), valueNoise(64, 34), valueNoise(64, 55)];

/** Distance in from the nearest map edge. */
export const edgeDist = (x: number, z: number) => Math.min(x, z, WORLD - x, WORLD - z);

/** The land before points of interest are carved in. */
function land(x: number, z: number): number {
  let h = (fbm(NZ[0], x / 170, z / 170, 4) - .5) * 46;          // broad rises and basins
  h += (fbm(NZ[1], x / 42, z / 42, 4) - .5) * 10;                // hills
  h += (fbm(NZ[2], x / 9, z / 9, 3) - .5) * 1.4;                 // ground bumps
  // ridge lines, only in some regions: sharp crests that make natural walls and passes
  const mask = smooth(.48, .66, fbm(NZ[3], x / 300 + 7, z / 300 + 3, 2));
  const rn = 1 - Math.abs(fbm(NZ[4], x / 120, z / 120, 4) * 2 - 1);
  h += Math.pow(rn, 3.2) * 42 * mask;
  // the mountain wall: steep, broken, and far too high to climb
  const e = edgeDist(x, z);
  if (e < 105) { const k = (105 - e) / 105; h += Math.pow(k, 1.6) * 170 * (.7 + .6 * fbm(NZ[5], x / 60, z / 60, 4)); }
  return h;
}

/** Final height before gridding: the land with every point of interest shaped into it. */
function shape(x: number, z: number): number {
  let h = land(x, z);
  for (const p of POIS) {
    const d = Math.hypot(x - p.x, z - p.z); if (d > p.r2 + 20) continue;
    if (p.kind === 'crater') {
      // a bowl with a raised rim
      const base = p.y!, R = p.r, bowl = d < R ? base - 15 * (1 - (d / R) ** 2) : base;
      const rim = 5 * Math.exp(-(((d - R) / 9) ** 2));
      h = d < R ? bowl + rim : h * smooth(R, p.r2, d) + (base + rim) * (1 - smooth(R, p.r2, d));
      continue;
    }
    if (p.kind === 'lake') { const f = smooth(p.r * .55, p.r2, d); h = h * f + (p.y! - 2.5 + (d / p.r) ** 2 * 2) * (1 - f); continue; }
    const f = smooth(p.r, p.r2, d); h = h * f + p.y! * (1 - f);
  }
  return h;
}

let grid: Float32Array | null = null;
/** Builds the height grid. Call once before using `H`. */
export function buildTerrain(): void {
  for (const p of POIS) p.y = land(p.x, p.z) + (p.lift ?? 0);
  const n = GRID_N + 1; grid = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) grid[j * n + i] = shape(i * CELL, j * CELL);
  // the lake's ice sits a little under the surrounding shore
  for (const p of POIS) if (p.kind === 'lake') p.y = H(p.x, p.z) + 1.6;
}
/** Ground height at (x, z), bilinear on the grid. */
export function H(x: number, z: number): number {
  const n = GRID_N + 1, fx = Math.min(GRID_N - 1e-4, Math.max(0, x / CELL)), fz = Math.min(GRID_N - 1e-4, Math.max(0, z / CELL));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, g = grid!, k = j * n + i;
  return (g[k] * (1 - u) + g[k + 1] * u) * (1 - v) + (g[k + n] * (1 - u) + g[k + n + 1] * u) * v;
}
/** Steepness (rise over run) of the ground at (x, z). */
export function slope(x: number, z: number): number {
  const e = 1.2; return Math.hypot(H(x + e, z) - H(x - e, z), H(x, z + e) - H(x, z - e)) / (2 * e);
}
