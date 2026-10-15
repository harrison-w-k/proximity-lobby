import * as THREE from 'three';
import type { Box, Disc } from './collision';

/**
 * The map: a flat, endless-feeling checkered floor under a starry night sky, lit in cool blues.
 * No buildings yet; the look comes from the low-res rendering, fog, tile floor and sky.
 * `boxes` and `discs` are static colliders for whatever gets added to the map later.
 */
export interface Environment {
  update(t: number, dt: number): void;
  boxes: Box[];
  discs: Disc[];
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Pale-blue / sky-blue tiles with faint grout: a 2x2 checker that repeats every 4 m. */
function floorTexture(repeat: number, aniso: number) {
  const tex = canvasTexture(64, 64, (g) => {
    g.fillStyle = '#d2e9f7';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#7fb6de';
    g.fillRect(0, 0, 32, 32);
    g.fillRect(32, 32, 32, 32);
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(31, 0, 2, 64);
    g.fillRect(0, 31, 64, 2);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.magFilter = THREE.NearestFilter; // crisp tile edges up close
  tex.anisotropy = aniso;
  return tex;
}

function skyTexture() {
  return canvasTexture(4, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#040824'); // zenith
    gr.addColorStop(0.45, '#0e2a66');
    gr.addColorStop(0.7, '#1c6a9a'); // horizon glow
    gr.addColorStop(1, '#0a1d44');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
}

function glowTexture(color: string) {
  return canvasTexture(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${color},1)`);
    gr.addColorStop(0.25, `rgba(${color},0.5)`);
    gr.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  });
}

export function buildEnvironment(scene: THREE.Scene, maxAniso: number): Environment {
  const rand = mulberry32(20240607);
  const rr = (a: number, b: number) => a + (b - a) * rand();

  // sky dome, stars and moon
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(380, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.renderOrder = -10;
  scene.add(sky);

  const starPos = new Float32Array(1400 * 3);
  for (let i = 0; i < 1400; i++) {
    const a = rr(0, Math.PI * 2);
    const e = Math.asin(rr(0.08, 1)); // keep stars above the horizon
    starPos[i * 3] = 350 * Math.cos(e) * Math.cos(a);
    starPos[i * 3 + 1] = 350 * Math.sin(e);
    starPos[i * 3 + 2] = 350 * Math.cos(e) * Math.sin(a);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false }),
  );
  scene.add(stars);

  const moon = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture('255,245,210'), fog: false, depthWrite: false, transparent: true }),
  );
  moon.position.set(140, 130, 230);
  moon.scale.set(70, 70, 1);
  scene.add(moon);

  // cool night lighting
  scene.add(new THREE.HemisphereLight(0x8fb6ff, 0x2b3a5c, 1.6));
  const moonLight = new THREE.DirectionalLight(0x9ab8ff, 1.0);
  moonLight.position.set(30, 70, 60);
  scene.add(moonLight);

  // the checkered tile floor
  const SIZE = 800;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE, SIZE),
    new THREE.MeshLambertMaterial({
      map: floorTexture(SIZE / 4, maxAniso),
      emissive: 0x3c6a98,
      emissiveIntensity: 0.45,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  return {
    boxes: [],
    discs: [],
    update(t) {
      stars.rotation.y = t * 0.002; // the sky drifts very slowly
    },
  };
}
