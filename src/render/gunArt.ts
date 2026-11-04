import * as THREE from 'three';
import type { ModelAsset } from './models';

/**
 * Dresses a code-built viewmodel in an AI-generated gun model (Meshy and similar).
 *
 * The code gun stays in charge of everything that moves: hands, reload travel, slide recoil and
 * the muzzle flash. Its own meshes are swapped out for the model, which is placed by matching two
 * landmarks found from the mesh shape (the bottom of the pistol grip and the muzzle) to the same
 * two points on the code gun. So the hands land on the model's grip and the flash sits at its muzzle
 * without hand-tuned offsets. The pistol's slide is cut from the model by height so it still cycles.
 */

export interface GunArt { gun: ModelAsset; mag?: ModelAsset }
export interface ArtSpec {
  /** Code gun's grip bottom and muzzle, in body (b) space, x forward, y up. */
  grip: [number, number]; muzzle: [number, number];
  /** Model faces -x (Meshy's side views usually do): flip it to +x. */
  flip?: boolean;
  /** Where along the model (0 rear, 1 muzzle) to look for the grip. */
  gripRange?: [number, number];
  /** Body-space height above which the model's triangles become the moving slide. */
  slideAbove?: number;
  /** Magazine fit in the mag part's own space: top and bottom y, centre x, and which model axis is its length. */
  magFit?: { top: number; bottom: number; x: number; axis: 'x' | 'y' };
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** One geometry in the model's own frame, with its material, from the first mesh of the asset. */
function bake(asset: ModelAsset): { geo: THREE.BufferGeometry; mat: THREE.Material } {
  let src: THREE.Mesh | null = null;
  asset.scene.updateMatrixWorld(true);
  asset.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && !src) src = o as THREE.Mesh; });
  if (!src) throw new Error('gunArt: model has no mesh');
  const mesh = src as THREE.Mesh, geo = (mesh.geometry as THREE.BufferGeometry).clone();
  for (const name of ['position', 'normal', 'uv']) {
    const a = geo.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (a && !(a.array instanceof Float32Array)) {
      const f = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) f[i * a.itemSize + k] = a.getComponent(i, k);
      geo.setAttribute(name, new THREE.BufferAttribute(f, a.itemSize));
    }
  }
  geo.applyMatrix4(mesh.matrixWorld);
  const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
  // generated finishes come out bright and mirror-like under the snowfield HDRI; tone them down to sit with the hands
  mat.envMapIntensity = .55; mat.color.multiplyScalar(.82);
  return { geo, mat };
}

function mean(pts: THREE.Vector3[]): THREE.Vector3 { const s = V(); for (const p of pts) s.add(p); return s.multiplyScalar(1 / Math.max(1, pts.length)); }

/** Removes the code gun's meshes from `parts`, keeping groups (moving parts, hands) intact. */
function strip(parts: THREE.Object3D[]): void {
  for (const p of parts) for (const c of [...p.children]) if ((c as THREE.Mesh).isMesh && !c.userData.limb) { p.remove(c); }
}

export function dressGun(b: THREE.Group, slide: THREE.Group | null, mag: THREE.Group | null, art: GunArt, spec: ArtSpec): void {
  const { geo, mat } = bake(art.gun);
  if (spec.flip) geo.rotateY(Math.PI);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!, L = bb.max.x - bb.min.x, pos = geo.getAttribute('position') as THREE.BufferAttribute, n = pos.count;
  geo.translate(0, 0, -(bb.min.z + bb.max.z) / 2);
  const P: THREE.Vector3[] = []; for (let i = 0; i < n; i++) P.push(V().fromBufferAttribute(pos, i));
  // landmarks: muzzle = centre of the front-most sliver; grip = lowest points within the grip's stretch of the gun
  const muz = mean(P.filter(p => p.x > bb.max.x - L * .015)); muz.x = bb.max.x;
  const [g0, g1] = spec.gripRange ?? [0, .6];
  const inGrip = P.filter(p => p.x >= bb.min.x + L * g0 && p.x <= bb.min.x + L * g1).sort((a, c) => a.y - c.y);
  const grip = mean(inGrip.slice(0, Math.max(4, Math.floor(inGrip.length * .03))));
  // similarity transform in the side plane taking grip -> spec.grip and muzzle -> spec.muzzle
  const a0 = V(muz.x - grip.x, muz.y - grip.y), a1 = V(spec.muzzle[0] - spec.grip[0], spec.muzzle[1] - spec.grip[1]);
  const k = a1.length() / a0.length(), rot = Math.atan2(a1.y, a1.x) - Math.atan2(a0.y, a0.x);
  const M = new THREE.Matrix4().makeTranslation(spec.grip[0], spec.grip[1], 0)
    .multiply(new THREE.Matrix4().makeRotationZ(rot)).multiply(new THREE.Matrix4().makeScale(k, k, k))
    .multiply(new THREE.Matrix4().makeTranslation(-grip.x, -grip.y, 0));
  geo.applyMatrix4(M);

  strip([b, ...(slide ? [slide] : []), ...(mag ? [mag] : [])]);
  const add = (parent: THREE.Object3D, g: THREE.BufferGeometry) => { const m = new THREE.Mesh(g, mat); parent.add(m); return m; };

  if (slide && spec.slideAbove !== undefined && geo.index) {
    // cut by triangle: every corner above the line rides with the slide
    const idx = geo.index!.array, keepS: number[] = [], keepF: number[] = [], pa = geo.getAttribute('position');
    for (let t = 0; t < idx.length; t += 3) {
      const up = [0, 1, 2].every(j => pa.getY(idx[t + j]) > spec.slideAbove!);
      (up ? keepS : keepF).push(idx[t], idx[t + 1], idx[t + 2]);
    }
    const fg = geo.clone(); fg.setIndex(keepF);
    const sg = geo.clone(); sg.setIndex(keepS);
    // the slide part sits at the origin of b, so its geometry stays in b space
    add(b, fg); add(slide, sg);
  } else add(b, geo);

  if (mag && art.mag && spec.magFit) {
    const { geo: mg, mat: mm } = bake(art.mag), f = spec.magFit;
    if (f.axis === 'x') {
      // lying along x: stand it up (x -> down), keep its thinnest side across the gun
      mg.applyMatrix4(new THREE.Matrix4().makeBasis(V(0, -1, 0), V(0, 0, -1), V(1, 0, 0)));
      mg.computeBoundingBox(); const s = mg.boundingBox!.getSize(V()); if (s.z > s.x) mg.rotateY(Math.PI / 2);
    }
    mg.computeBoundingBox();
    const mb = mg.boundingBox!, h = mb.max.y - mb.min.y, s = (f.top - f.bottom) / h;
    mg.translate(-(mb.min.x + mb.max.x) / 2, -mb.max.y, -(mb.min.z + mb.max.z) / 2);
    mg.scale(s, s, s); mg.translate(f.x, f.top, 0);
    const m = new THREE.Mesh(mg, mm); mag.add(m);
  }
}
