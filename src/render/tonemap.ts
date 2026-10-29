import * as THREE from 'three';

// Three's ACESFilmicToneMapping matrices, column-major exactly as in the GLSL source.
const ACES_IN = new THREE.Matrix3().fromArray([0.59719, 0.076, 0.0284, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777]);
const ACES_OUT = new THREE.Matrix3().fromArray([1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602]);
const ACES_IN_INV = ACES_IN.clone().invert();
const ACES_OUT_INV = ACES_OUT.clone().invert();
const v = new THREE.Vector3();

// Inverse of RRTAndODTFit: y = (x^2 + .0245786x - .000090537) / (.983729x^2 + .432951x + .238081), solved for x >= 0.
function rrtInverse(y: number): number {
  y = Math.min(Math.max(y, 0), 0.999);
  const a = 1 - 0.983729 * y, b = 0.0245786 - 0.432951 * y, c = -0.000090537 - 0.238081 * y;
  return Math.max(0, (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a));
}

/**
 * Returns the scene-linear color that ACES tone mapping at `exposure` turns back into `display`
 * (a linear-working-space color, e.g. from a hex string). Used for fog and sky so they show
 * the exact tuned color on screen even though post-processing tone maps them with everything else.
 */
export function untonemap(display: THREE.Color, exposure: number, out = new THREE.Color()): THREE.Color {
  v.set(display.r, display.g, display.b).applyMatrix3(ACES_OUT_INV);
  v.set(rrtInverse(v.x), rrtInverse(v.y), rrtInverse(v.z)).applyMatrix3(ACES_IN_INV).multiplyScalar(0.6 / exposure);
  return out.setRGB(Math.max(0, v.x), Math.max(0, v.y), Math.max(0, v.z));
}

/**
 * Three mixes fog after tone mapping when it draws straight to the screen, which is how the
 * prototype was tuned. Under post-processing fog mixes in linear HDR instead, which washes out
 * dark ground. Mixing in a square-root (roughly perceptual) space restores the old falloff.
 * Call once before any material compiles.
 */
export function usePerceptualFog(): void {
  THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment.replace(
    'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
    'gl_FragColor.rgb = pow( mix( sqrt( max( gl_FragColor.rgb, 0.0 ) ), sqrt( fogColor ), fogFactor ), vec3( 2.0 ) );',
  );
}

/**
 * Alpha blending happens in linear space under post-processing, but the prototype's dark
 * overlays (scorch marks, acid splats) were tuned blending on the sRGB screen, where the same
 * opacity darkens far more. This remaps alpha so the overlay darkens by the amount it used to.
 */
export function displaySpaceAlpha<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <alphatest_fragment>',
      'diffuseColor.a = 1.0 - pow( 1.0 - clamp( diffuseColor.a, 0.0, 1.0 ), 1.8 );\n#include <alphatest_fragment>',
    );
  };
  return material;
}
