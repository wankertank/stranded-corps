import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * CC0 photoscanned models from Poly Haven (see CREDITS.md), packed as meshopt + WebP GLBs.
 * Each one is re-centred so its footprint sits on the origin, with `size` holding its real
 * dimensions in metres, so callers can place and scale it like the old primitive boxes.
 */
export interface ModelAsset {
  scene: THREE.Group;
  size: THREE.Vector3;
}

const base = import.meta.env.BASE_URL;

export const MODEL_NAMES = [
  'moon_rock_01', 'moon_rock_02', 'moon_rock_03', 'moon_rock_04', 'moon_rock_05', 'moon_rock_06', 'moon_rock_07',
  'wooden_military_crate', 'old_military_crate', 'utility_box_01', 'metal_tool_chest', 'barrel_01', 'concrete_road_barrier',
  'service_pistol', 'ammo_box', 'metal_jerrycan', 'propane_tank', 'portable_generator', 'medical_box',
] as const;
export type ModelName = (typeof MODEL_NAMES)[number];

export async function loadModels(renderer: THREE.WebGLRenderer): Promise<Record<ModelName, ModelAsset>> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const entries = await Promise.all(MODEL_NAMES.map(async (name) => {
    const gltf = await loader.loadAsync(`${base}models/${name}.glb`);
    const root = gltf.scene;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true; m.receiveShadow = true;
      const mat = m.material as THREE.MeshStandardMaterial;
      for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.aoMap]) if (t) t.anisotropy = aniso;
    });
    const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3());
    root.position.set(-c.x, -box.min.y, -c.z);
    const scene = new THREE.Group(); scene.add(root);
    return [name, { scene, size: box.getSize(new THREE.Vector3()) }] as const;
  }));
  return Object.fromEntries(entries) as Record<ModelName, ModelAsset>;
}

/**
 * A placed copy. Geometry and textures are shared; `scale` multiplies the model's real size,
 * or pass `fit` to scale it so its largest horizontal side is that many metres.
 */
export function placeModel(asset: ModelAsset, opts: { scale?: number; fit?: number } = {}): THREE.Group {
  const g = asset.scene.clone(true);
  const k = opts.fit ? opts.fit / Math.max(asset.size.x, asset.size.z) : opts.scale ?? 1;
  g.scale.setScalar(k);
  return g;
}

/** Gives a placed copy its own darkened materials (for looted crates), or restores the shared ones. */
export function setDarkened(g: THREE.Object3D, dark: boolean, amount = 0.12): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (dark) {
      if (!m.userData.baseMat) m.userData.baseMat = m.material;
      const d = (m.userData.baseMat as THREE.MeshStandardMaterial).clone();
      d.color.multiplyScalar(amount); d.roughness = Math.min(1, d.roughness + 0.3);
      m.material = d;
    } else if (m.userData.baseMat) {
      (m.material as THREE.Material).dispose();
      m.material = m.userData.baseMat;
    }
  });
}

/** A copy of an asset with its own materials recoloured, shared by every placement of it (e.g. moon rocks darkened to basalt). */
export function tinted(asset: ModelAsset, color: THREE.ColorRepresentation, roughness?: number): ModelAsset {
  const scene = asset.scene.clone(true), c = new THREE.Color(color);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    mat.color.copy(c);
    if (roughness !== undefined) mat.roughness = roughness;
    m.material = mat;
  });
  return { scene, size: asset.size };
}

/** Swaps every mesh in a placed copy to one material, e.g. the see-through build ghost. */
export function setMaterial(g: THREE.Object3D, material: THREE.Material, shadows = false): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = material; m.castShadow = shadows; m.receiveShadow = shadows;
  });
}
