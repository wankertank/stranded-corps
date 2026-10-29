import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export type Quality = 'high' | 'low';

// Helmet-camera look, applied after tone mapping: film grain, vignette, slight lens fringing
// toward the edges, and a red edge pulse when the player is hurt.
// Drops NaN and Inf pixels and caps extreme HDR values before bloom. Bloom blurs across mip
// levels, so a single bad pixel (say from specular overflow under the muzzle flash) would
// otherwise spread into a black square around objects.
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // NaN fails every comparison, so this also catches it; huge values cover Inf
      bool ok = c.r == c.r && c.g == c.g && c.b == c.b && max(max(c.r, c.g), c.b) < 6.0e4;
      gl_FragColor = vec4(ok ? min(c.rgb, vec3(48.0)) : vec3(0.0), 1.0);
    }`,
};

const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    grain: { value: 0.05 },
    vignette: { value: 0.32 },
    fringe: { value: 0.0002 },
    hurt: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time, grain, vignette, fringe, hurt;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * fringe * 40.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= 1.0 - vignette * smoothstep(0.08, 0.55, r2);
      col = mix(col, vec3(0.55, 0.03, 0.02), hurt * smoothstep(0.12, 0.5, r2));
      float n = hash(vUv * vec2(1920.0, 1080.0) + fract(time) * 91.7) - 0.5;
      // grain shows most in the mids, like film, not in pure black or white
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col += n * grain * (0.35 + lum * (1.0 - lum) * 2.6);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export interface PostFX {
  render(dt: number): void;
  setSize(w: number, h: number): void;
  setQuality(q: Quality): void;
  readonly quality: Quality;
  /** 0 day to 1 night: night gets more grain and a stronger vignette, like a low-light sensor. */
  setDarkness(dk: number): void;
  setHurt(k: number): void;
  /** Individual passes, exposed for tuning and tests. */
  readonly passes: { ao: GTAOPass; bloom: UnrealBloomPass; lens: ShaderPass };
}

export function createPostFX(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, quality: Quality): PostFX {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);

  const renderPass = new RenderPass(scene, camera);
  const ao = new GTAOPass(scene, camera, size.x, size.y);
  ao.blendIntensity = 0.85;
  ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12 });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  // Only bright HDR sources bloom: muzzle flash, lamps, floodlights, Skarn acid, the bench screen.
  const sanitize = new ShaderPass(SanitizeShader);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.4, 1.0);
  const output = new OutputPass();
  const lens = new ShaderPass(LensShader);

  composer.addPass(renderPass);
  composer.addPass(ao);
  composer.addPass(sanitize);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(lens);

  let q = quality, time = 0, dk = 0;
  const apply = () => {
    ao.enabled = q === 'high';
    bloom.resolution.set(size.x / (q === 'high' ? 1 : 2), size.y / (q === 'high' ? 1 : 2));
  };
  apply();

  return {
    get quality() { return q; },
    passes: { ao, bloom, lens },
    render(dt) {
      time += dt;
      lens.uniforms.time.value = time;
      lens.uniforms.grain.value = 0.03 + dk * 0.03;
      lens.uniforms.vignette.value = 0.25 + dk * 0.15;
      composer.render(dt);
    },
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      renderer.getDrawingBufferSize(size);
      apply();
    },
    setQuality(next) { q = next; apply(); },
    setDarkness(k) { dk = k; },
    setHurt(k) { lens.uniforms.hurt.value = k; },
  };
}
