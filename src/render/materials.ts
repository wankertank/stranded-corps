import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

/** One Poly Haven texture set: color (sRGB), OpenGL normal map, and ARM (AO, roughness, metalness). */
export interface PBRSet {
  color: THREE.Texture;
  normal: THREE.Texture;
  arm: THREE.Texture;
  /** Average linear albedo of `color`; shaders divide by it so a material's own color stays its tuned tint. */
  mean: THREE.Vector3;
}

/** Average linear color of an image, from a small downscaled copy. */
export function meanLinearColor(image: CanvasImageSource): THREE.Vector3 {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(image, 0, 0, 32, 32);
  const d = g.getImageData(0, 0, 32, 32).data, m = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < d.length; i += 4) { col.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, THREE.SRGBColorSpace); m.x += col.r; m.y += col.g; m.z += col.b; }
  return m.divideScalar(d.length / 4);
}

const base = import.meta.env.BASE_URL;

export async function loadPBR(renderer: THREE.WebGLRenderer, name: string): Promise<PBRSet> {
  const loader = new THREE.TextureLoader();
  const load = async (file: string, srgb: boolean) => {
    const t = await loader.loadAsync(`${base}textures/${name}/${file}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  };
  const [color, normal, arm] = await Promise.all([load('color', true), load('normal', false), load('arm', false)]);
  return { color, normal, arm, mean: meanLinearColor(color.image as CanvasImageSource) };
}

/** Prefiltered HDRI for image-based lighting: soft sky fill and believable reflections on metal. */
export async function loadEnvironment(renderer: THREE.WebGLRenderer, file: string): Promise<THREE.Texture> {
  const hdr = await new HDRLoader().loadAsync(`${base}hdri/${file}`);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(hdr).texture;
  hdr.dispose(); pmrem.dispose();
  return env;
}

// Shared GLSL. Triplanar sampling projects a texture along world X, Y and Z and blends by the
// surface normal, so scaled boxes and rocks get even texel density with no UV work.
const TRI_PARS = /* glsl */ `
  varying vec3 vTriPos;
  varying vec3 vTriNrm;
  vec3 triWeights(vec3 n) { vec3 w = pow(abs(n), vec3(4.0)); return w / (w.x + w.y + w.z); }
  vec4 triSample(sampler2D t, vec3 p, vec3 w) {
    return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z;
  }
  // Whiteout-blended triplanar normal map, returned in world space.
  vec3 triNormal(sampler2D t, vec3 p, vec3 w, vec3 n, float strength) {
    vec3 tx = texture2D(t, p.zy).xyz * 2.0 - 1.0; tx.xy *= strength;
    vec3 ty = texture2D(t, p.xz).xyz * 2.0 - 1.0; ty.xy *= strength;
    vec3 tz = texture2D(t, p.xy).xyz * 2.0 - 1.0; tz.xy *= strength;
    tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
    ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
    tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
    vec3 r = tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z;
    return dot(r, r) > 1e-8 ? normalize(r) : n;
  }
`;

const TRI_VERTEX = /* glsl */ `
  #include <project_vertex>
  vTriPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vTriNrm = transformNormalByInverseViewMatrix(transformedNormal, viewMatrix);
`;

export interface TriplanarOptions {
  /** Texture repeats per metre. */
  scale?: number;
  normalStrength?: number;
  /** How much the set's own metalness channel drives metalness (0 keeps the material's value). */
  useMetal?: number;
  /** How strongly the baked AO darkens the surface. */
  ao?: number;
}

/** Turns a MeshStandardMaterial into a triplanar PBR material. Its color multiplies the texture as a tint. */
export function triplanar<T extends THREE.MeshStandardMaterial>(material: T, set: PBRSet, opts: TriplanarOptions = {}): T {
  const { scale = 0.5, normalStrength = 1, useMetal = 0, ao = 0.6 } = opts;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      triMap: { value: set.color }, triNormalMap: { value: set.normal }, triArm: { value: set.arm }, triMean: { value: set.mean },
      triScale: { value: scale }, triNormalStrength: { value: normalStrength }, triUseMetal: { value: useMetal }, triAo: { value: ao },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNrm;')
      .replace('#include <project_vertex>', TRI_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D triMap, triNormalMap, triArm;
        uniform float triScale, triNormalStrength, triUseMetal, triAo;
        uniform vec3 triMean;
        ${TRI_PARS}`)
      .replace('#include <map_fragment>', `
        vec3 triW = triWeights(normalize(vTriNrm));
        vec3 triP = vTriPos * triScale;
        vec4 triArmS = triSample(triArm, triP, triW);
        diffuseColor.rgb *= triSample(triMap, triP, triW).rgb / triMean * mix(1.0, triArmS.r, triAo);`)
      // floor roughness: a near-mirror texel under the close muzzle light overflows half-float specular
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = max(roughness * triArmS.g, 0.18);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * mix(1.0, triArmS.b, triUseMetal);')
      .replace('#include <normal_fragment_maps>', `
        vec3 triWN = transformNormalByInverseViewMatrix(normal, viewMatrix);
        normal = normalize((viewMatrix * vec4(triNormal(triNormalMap, triP, triWeights(triWN), triWN, triNormalStrength), 0.0)).xyz);`);
  };
  material.customProgramCacheKey = () => `tri-${set.color.uuid}`;
  material.needsUpdate = true;
  return material;
}

/**
 * Terrain: frosty regolith blended into packed snow by a per-vertex `snow` weight, with the
 * snow edge broken up by the ground texture's height detail. Projected from above in world space,
 * plus a large-scale brightness variation so the repeat doesn't show across the map. `albedo` is
 * the average ground brightness the vertex colors were tuned against; snow comes out a bit brighter.
 */
export function terrainMaterial(ground: PBRSet, snow: PBRSet, scale: number, albedo: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      gColor: { value: ground.color }, gNormal: { value: ground.normal }, gArm: { value: ground.arm },
      sColor: { value: snow.color }, sNormal: { value: snow.normal }, sArm: { value: snow.arm },
      tScale: { value: scale }, gMean: { value: ground.mean.clone().divideScalar(albedo) }, sMean: { value: snow.mean.clone().divideScalar(albedo) },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float snow;\nvarying float vSnow;\nvarying vec3 vTriPos;\nvarying vec3 vTriNrm;')
      .replace('#include <project_vertex>', `${TRI_VERTEX}\nvSnow = snow;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D gColor, gNormal, gArm, sColor, sNormal, sArm;
        uniform float tScale;
        uniform vec3 gMean, sMean;
        varying float vSnow;
        ${TRI_PARS}`)
      .replace('#include <map_fragment>', `
        vec2 tUv = vTriPos.xz * tScale;
        vec4 gA = texture2D(gArm, tUv), sA = texture2D(sArm, tUv * 0.8);
        float macro = texture2D(gColor, vTriPos.xz * 0.011).g * 1.6 + 0.2;
        // snow settles in the hollows of the ground texture first
        float snowK = smoothstep(0.0, 1.0, clamp(vSnow * 1.6 - (1.0 - gA.r) * 0.9, 0.0, 1.0));
        vec3 gC = texture2D(gColor, tUv).rgb / gMean * macro;
        vec3 sC = texture2D(sColor, tUv * 0.8).rgb / sMean * 1.25;
        diffuseColor.rgb *= mix(gC, sC, snowK);
        vec4 tArm = mix(gA, sA, snowK);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * mix(0.85, 1.0, tArm.g);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <normal_fragment_maps>', `
        vec3 tWN = transformNormalByInverseViewMatrix(normal, viewMatrix);
        vec3 gN = texture2D(gNormal, tUv).xyz * 2.0 - 1.0;
        vec3 sN = texture2D(sNormal, tUv * 0.8).xyz * 2.0 - 1.0;
        vec3 tN = mix(gN, sN, snowK);
        // ground is projected from above: texture u runs along world x, v along world z
        vec3 tWorld = normalize(tWN + vec3(tN.x, 0.0, tN.y) * 1.2);
        normal = normalize((viewMatrix * vec4(tWorld, 0.0)).xyz);`);
  };
  material.customProgramCacheKey = () => 'terrain';
  return material;
}
