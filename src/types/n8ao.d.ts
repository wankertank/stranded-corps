// n8ao ships no type declarations; this covers the parts the game uses.
declare module 'n8ao' {
  import type * as THREE from 'three';
  import { Pass } from 'postprocessing';
  export interface N8AOConfiguration {
    aoSamples: number; aoRadius: number; denoiseSamples: number; denoiseRadius: number;
    distanceFalloff: number; intensity: number; renderMode: 0 | 1 | 2 | 3 | 4; color: THREE.Color;
    gammaCorrection: boolean; screenSpaceRadius: boolean; halfRes: boolean; depthAwareUpsampling: boolean;
    colorMultiply: boolean; transparencyAware: boolean; accumulate: boolean;
  }
  export class N8AOPostPass extends Pass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setSize(width: number, height: number): void;
  }
}
