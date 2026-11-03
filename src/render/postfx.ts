import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, Effect, EffectAttribute, BlendFunction,
  BloomEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect, SMAAPreset,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export type Quality = 'high' | 'low';

// Post-processing runs on pmndrs/postprocessing: effects that share a pass are compiled into one
// shader, so the chain costs far fewer full-screen draws than three's stock composer.
//   scene -> N8AO ambient occlusion (high only) -> sanitize -> bloom + ACES tone mapping -> SMAA -> helmet lens
// Hardware MSAA does not mix with screen-space AO, so edges are smoothed with SMAA instead.

/**
 * Drops NaN and Inf pixels and caps extreme HDR values before bloom. Bloom blurs across mip
 * levels, so a single bad pixel (say from specular overflow under the muzzle flash) would
 * otherwise spread into a black square around objects.
 */
class SanitizeEffect extends Effect {
  constructor() {
    super('Sanitize', /* glsl */ `
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        // NaN fails every comparison, so this also catches it; huge values cover Inf
        bool ok = c.r == c.r && c.g == c.g && c.b == c.b && max(max(c.r, c.g), c.b) < 6.0e4;
        outputColor = vec4(ok ? min(c, vec3(48.0)) : vec3(0.0), 1.0);
      }`, { blendFunction: BlendFunction.SET });
  }
}

/**
 * Helmet-camera look, applied last: slight lens fringing toward the edges, vignette, a red edge
 * pulse when hurt, and film grain. Works in display (sRGB) space, where it was tuned, and hands
 * back linear for the final output encode.
 */
class LensEffect extends Effect {
  constructor() {
    super('Lens', /* glsl */ `
      uniform float grain, vignette, fringe, hurt, seed;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      vec3 toDisplay(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec2 c = uv - 0.5;
        float r2 = dot(c, c);
        vec2 off = c * r2 * fringe * 40.0;
        vec3 col = toDisplay(vec3(texture2D(inputBuffer, uv + off).r, inputColor.g, texture2D(inputBuffer, uv - off).b));
        col *= 1.0 - vignette * smoothstep(0.08, 0.55, r2);
        col = mix(col, vec3(0.55, 0.03, 0.02), hurt * smoothstep(0.12, 0.5, r2));
        float n = hash(uv * vec2(1920.0, 1080.0) + seed * 91.7) - 0.5;
        // grain shows most in the mids, like film, not in pure black or white
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col += n * grain * (0.35 + lum * (1.0 - lum) * 2.6);
        outputColor = vec4(pow(max(col, 0.0), vec3(2.2)), 1.0);
      }`, {
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.SET,
      uniforms: new Map<string, THREE.Uniform>([
        ['grain', new THREE.Uniform(0.03)], ['vignette', new THREE.Uniform(0.25)], ['fringe', new THREE.Uniform(0.0002)],
        ['hurt', new THREE.Uniform(0)], ['seed', new THREE.Uniform(0)],
      ]),
    });
  }
  u(name: string) { return this.uniforms.get(name)!; }
}

export interface PostFX {
  render(dt: number): void;
  setSize(w: number, h: number): void;
  setQuality(q: Quality): void;
  readonly quality: Quality;
  /** 0 day to 1 night: night gets more grain and a stronger vignette, like a low-light sensor. */
  setDarkness(dk: number): void;
  setHurt(k: number): void;
  /** Individual effects, exposed for tuning and tests. */
  readonly passes: { ao: N8AOPostPass; bloom: BloomEffect; smaa: SMAAEffect; lens: LensEffect; composer: EffectComposer };
}

export function createPostFX(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, quality: Quality): PostFX {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, depthBuffer: true, multisampling: 0 });

  const ao = new N8AOPostPass(scene, camera, size.x, size.y);
  // metres-scale scene: contact shadows under props, in doorways and between rocks, not a dirty halo
  Object.assign(ao.configuration, { aoRadius: 1.6, distanceFalloff: 0.6, intensity: 2.2, aoSamples: 16, denoiseSamples: 8, denoiseRadius: 10, halfRes: false, gammaCorrection: false });

  // Only bright HDR sources bloom: muzzle flash, lamps, floodlights, Skarn acid, the bench screen, the lab tanks.
  const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.25, intensity: 0.9, radius: 0.62, levels: 7 });
  // ACES, matching the renderer setting the fog and sky colors were tuned against (see tonemap.ts);
  // the shader reads renderer.toneMappingExposure, so the day/night exposure ramp still applies.
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
  const lens = new LensEffect();

  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(ao);
  composer.addPass(new EffectPass(camera, new SanitizeEffect()));
  composer.addPass(new EffectPass(camera, bloom, tone));
  composer.addPass(new EffectPass(camera, smaa));
  composer.addPass(new EffectPass(camera, lens));

  let q = quality, time = 0, dk = 0;
  const apply = () => {
    const high = q === 'high';
    ao.enabled = high;
    // low: half-resolution bloom chain and cheaper edge search
    bloom.resolution.scale = high ? 0.5 : 0.25;
    smaa.applyPreset(high ? SMAAPreset.HIGH : SMAAPreset.LOW);
  };
  apply();

  return {
    get quality() { return q; },
    passes: { ao, bloom, smaa, lens, composer },
    render(dt) {
      time += dt;
      lens.u('seed').value = time % 1;
      lens.u('grain').value = 0.03 + dk * 0.03;
      lens.u('vignette').value = 0.25 + dk * 0.15;
      composer.render(dt);
    },
    setSize(w, h) {
      composer.setSize(w, h, false);
      renderer.getDrawingBufferSize(size);
      apply();
    },
    setQuality(next) { q = next; apply(); },
    setDarkness(k) { dk = k; },
    setHurt(k) { lens.u('hurt').value = k; },
  };
}
