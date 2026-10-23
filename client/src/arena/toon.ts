// Cel shading: every material in the game steps its light through a few flat bands instead of a smooth gradient,
// which is what gives the world its hand-drawn cartoon look. `toonMat` takes the same parameters the old Lambert
// materials took, so it drops in anywhere.
import * as THREE from 'three';

const BANDS = [0.5, 0.78, 1];
const ramp = new THREE.DataTexture(new Uint8Array(BANDS.flatMap((b) => [Math.round(b * 255), Math.round(b * 255), Math.round(b * 255), 255])), BANDS.length, 1, THREE.RGBAFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
ramp.generateMipmaps = false;
ramp.needsUpdate = true;

export function toonMat(p: THREE.MeshLambertMaterialParameters = {}): THREE.MeshToonMaterial {
  const { flatShading, ...rest } = p;
  const m = new THREE.MeshToonMaterial({ ...rest, gradientMap: ramp } as THREE.MeshToonMaterialParameters);
  if (flatShading) (m as unknown as { flatShading: boolean }).flatShading = true; // the renderer reads it, the typings just do not list it
  return m;
}
