import * as THREE from 'three';
import { MAP_RADIUS, SWIM_LIMIT, type PlayerState } from '../../shared/protocol';
import { clampToArena, SHORE_RADIUS, waterDepth } from '../../shared/map';
import { BODY_RADIUS, EYE_CROUCH, EYE_STAND, newSim, stepPlayer, type Input } from '../../shared/movement';
import { OBSTACLES, blockTop, type Block } from '../../shared/obstacles';
import { pushOut } from './collision';
import { validAvatar } from '../../shared/avatar';

export const EYE_HEIGHT = EYE_STAND;

/** Things that make a sound; the page maps these to audio so the world stays free of audio code. */
export type SoundEvent =
  | { kind: 'step'; surface: 'grass' | 'sand' | 'block' | 'water'; gain: number }
  | { kind: 'jump' }
  | { kind: 'land'; strength: number }
  | { kind: 'slideStart' }
  | { kind: 'slideEnd' }
  | { kind: 'grab' }
  | { kind: 'mantle' }
  | { kind: 'splash'; strength: number };
export const DEFAULT_FOV = 75;
const THIRD_DISTANCE = 3.6; // metres behind the head in third person
const THIRD_LIFT = 0.3; // and a little above, so you see over your own shoulders

// ---------- look: low poly ----------
// Everything is built from a small number of flat-shaded polygons: faceted spheres, cones and
// boxes in clean colours, lit by one sun. It renders at full resolution with antialiasing so the
// facets read as crisp, deliberate shapes rather than as blur or pixels.
const SEA_LEVEL = -0.35;
const WATER_CELLS = 72; // the animated sea is a 72 x 72 grid of flat triangles...
const WATER_SIZE = 360; // ...covering 360 m, with a plain disc of the same colour beyond it
const SUN_DIR = new THREE.Vector3(-300, 250, -520).normalize();

export function hueFor(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** Stable 32-bit hash of a player id: the same id always yields the same body, on every client. */
function hashId(id: string): number {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h >>> 0;
}

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const flat = (color: number, extra: Partial<THREE.MeshLambertMaterialParameters> = {}) =>
  new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

/** A 2x2 checker tile; the floor repeats it so every square is 3 m. Clean, filtered, antialiased. */
function makeCheckerTexture(maxAniso: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#9bdc6e';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#7cc352';
  g.fillRect(0, 0, 64, 64);
  g.fillRect(64, 64, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set((MAP_RADIUS * 2) / 6, (MAP_RADIUS * 2) / 6);
  tex.anisotropy = maxAniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeNameSprite(name: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(8,16,40,0.7)';
  g.beginPath();
  g.roundRect(4, 8, 248, 48, 10);
  g.fill();
  g.fillStyle = '#fff';
  g.font = '700 30px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 128, 33, 232);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(1.5, 0.375, 1);
  sprite.position.y = 2.15;
  return sprite;
}

// ---------- sky, sun, clouds, hills ----------
const SKY_HORIZON = 0xcfeeff; // fog and sea fade into this, so the horizon is seamless

function makeSkyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x2f6fe0) },
      mid: { value: new THREE.Color(0x6db4ff) },
      horizon: { value: new THREE.Color(SKY_HORIZON) },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon;
      varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.35, h));
        c = mix(c, top, smoothstep(0.3, 0.95, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  dome.renderOrder = -10;
  return dome;
}

/** A faceted sun: a glowing 20-sided ball with a larger, fainter one behind it. */
function makeSun(): THREE.Group {
  const g = new THREE.Group();
  g.add(
    new THREE.Mesh(new THREE.IcosahedronGeometry(34, 0), new THREE.MeshBasicMaterial({ color: 0xfff6b8, fog: false })),
    new THREE.Mesh(
      new THREE.IcosahedronGeometry(62, 0),
      new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.35, fog: false, depthWrite: false }),
    ),
  );
  g.position.copy(SUN_DIR).multiplyScalar(650);
  return g;
}

/** Puffy clouds built from a few faceted blobs each, drifting slowly around the sky. */
function makeClouds(): THREE.Group {
  const rnd = seeded(5);
  const root = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9db2cc, flatShading: true, fog: false }); // emissive lifts the shaded sides: clouds should look bright
  for (let i = 0; i < 11; i++) {
    const cloud = new THREE.Group();
    const blobs = 4 + Math.floor(rnd() * 3);
    for (let j = 0; j < blobs; j++) {
      const size = 14 + rnd() * 16;
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), mat);
      blob.position.set((j - blobs / 2) * 20 + rnd() * 8, rnd() * 8, rnd() * 14 - 7);
      blob.scale.y = 0.62;
      blob.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      cloud.add(blob);
    }
    const angle = (i / 11) * Math.PI * 2 + rnd() * 0.4;
    const radius = 420 + rnd() * 200;
    cloud.position.set(Math.cos(angle) * radius, 100 + rnd() * 90, Math.sin(angle) * radius);
    cloud.rotation.y = rnd() * Math.PI;
    root.add(cloud);
  }
  return root;
}

/** A ring of distant faceted hills, hazy in the fog, so the horizon has depth. */
function makeHills(): THREE.Group {
  const rnd = seeded(31);
  const g = new THREE.Group();
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2 + rnd() * 0.25;
    const dist = 430 + rnd() * 180;
    const h = 40 + rnd() * 90;
    const r = 55 + rnd() * 70;
    const tone = rnd();
    const mat = flat(new THREE.Color().setHSL(0.36 + tone * 0.08, 0.35, 0.42 + tone * 0.1).getHex());
    const hill = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5 + Math.floor(rnd() * 3)), mat);
    hill.position.set(Math.cos(angle) * dist, h / 2 - 6, Math.sin(angle) * dist);
    hill.rotation.y = rnd() * 3;
    g.add(hill);
  }
  return g;
}

// ---------- water ----------
interface Water {
  update(t: number): void;
}

/**
 * Low-poly sea: a grid of flat triangles whose heights follow three crossing swells. Each face
 * keeps its own colour (turquoise in the shallows, deep blue far out, a little random tint per
 * facet), so the surface shimmers in facets; the sun glints off the tilted faces; foam pulses
 * where the sea meets the beach.
 */
function makeWater(scene: THREE.Scene): Water {
  const n = WATER_CELLS;
  const cell = WATER_SIZE / n;
  const half = WATER_SIZE / 2;
  const rnd = seeded(77);

  const vertCount = n * n * 6;
  const pos = new Float32Array(vertCount * 3);
  const col = new Float32Array(vertCount * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const shallow = new THREE.Color(0x4fe3d0);
  const mid = new THREE.Color(0x2b9ae8);
  const deep = new THREE.Color(0x14509e);
  const foam = new THREE.Color(0xffffff);
  const tmp = new THREE.Color();

  // per-face base colour, and the faces that foam
  const foamFaces: { first: number; phase: number; base: THREE.Color }[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      for (let tri = 0; tri < 2; tri++) {
        const first = (j * n + i) * 6 + tri * 3;
        const cx = (i + (tri === 0 ? 0.33 : 0.67)) * cell - half;
        const cz = (j + (tri === 0 ? 0.67 : 0.33)) * cell - half;
        const r = Math.hypot(cx, cz);
        const t = Math.min(1, Math.max(0, (r - SHORE_RADIUS) / 60));
        tmp.copy(shallow).lerp(mid, Math.min(1, t * 2.2));
        if (t > 0.45) tmp.lerp(deep, Math.min(1, (t - 0.45) / 0.55));
        const tint = (rnd() - 0.5) * 0.09; // a little random brightness per facet
        tmp.offsetHSL(0, 0, tint);
        const base = tmp.clone();
        for (let v = 0; v < 3; v++) {
          col[(first + v) * 3] = base.r;
          col[(first + v) * 3 + 1] = base.g;
          col[(first + v) * 3 + 2] = base.b;
        }
        if (r > SHORE_RADIUS - 1.5 && r < SHORE_RADIUS + 3.5) foamFaces.push({ first, phase: rnd() * 6.28, base });
      }
    }
  }

  const mat = new THREE.MeshPhongMaterial({
    vertexColors: true,
    flatShading: true,
    shininess: 70,
    specular: 0xbfe0ff,
    emissive: 0x1d2d3c, // lifts the shaded facets so the shore foam reads white, not grey
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = SEA_LEVEL;
  mesh.frustumCulled = false;
  scene.add(mesh);

  // beyond the animated patch: a plain disc in the deep colour, sitting a little lower
  const far = new THREE.Mesh(new THREE.CircleGeometry(1600, 24), new THREE.MeshLambertMaterial({ color: deep }));
  far.rotation.x = -Math.PI / 2;
  far.position.y = SEA_LEVEL - 0.3;
  scene.add(far);

  const stride = n + 1;
  const heights = new Float32Array(stride * stride);

  const wave = (x: number, z: number, t: number) =>
    0.075 * Math.sin(0.33 * x + 0.9 * t) +
    0.055 * Math.sin(0.27 * z - 0.7 * t + 1.3) +
    0.045 * Math.sin(0.55 * (x + z) + 1.4 * t + 0.6);

  return {
    update(t: number) {
      for (let j = 0; j <= n; j++) {
        for (let i = 0; i <= n; i++) {
          const x = i * cell - half;
          const z = j * cell - half;
          heights[j * stride + i] = wave(x, z, t);
        }
      }
      let p = 0;
      const put = (i: number, j: number) => {
        pos[p++] = i * cell - half;
        pos[p++] = heights[j * stride + i];
        pos[p++] = j * cell - half;
      };
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          // two triangles per cell, both facing up: (a, c, b) and (b, c, d)
          put(i, j);
          put(i, j + 1);
          put(i + 1, j);
          put(i + 1, j);
          put(i, j + 1);
          put(i + 1, j + 1);
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.computeVertexNormals(); // non-indexed, so every triangle gets its own flat normal

      // shore foam pulses in and out
      for (const f of foamFaces) {
        const k = 0.45 + 0.45 * Math.sin(t * 1.3 + f.phase);
        tmp.copy(f.base).lerp(foam, Math.max(0, Math.min(1, k)));
        for (let v = 0; v < 3; v++) {
          col[(f.first + v) * 3] = tmp.r;
          col[(f.first + v) * 3 + 1] = tmp.g;
          col[(f.first + v) * 3 + 2] = tmp.b;
        }
      }
      geo.attributes.color.needsUpdate = true;
    },
  };
}

/** Expanding rings on the surface where someone moves through the water. */
class Ripples {
  private pool: { mesh: THREE.Mesh; age: number }[] = [];
  private next = 0;
  constructor(scene: THREE.Scene, count = 14) {
    const geo = new THREE.RingGeometry(0.3, 0.4, 14);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, age: 99 });
    }
  }
  emit(x: number, z: number) {
    const r = this.pool[this.next++ % this.pool.length];
    r.age = 0;
    r.mesh.position.set(x, SEA_LEVEL + 0.12, z);
    r.mesh.visible = true;
  }
  update(dt: number) {
    for (const r of this.pool) {
      if (!r.mesh.visible) continue;
      r.age += dt;
      const k = r.age / 1.2;
      if (k >= 1) {
        r.mesh.visible = false;
        continue;
      }
      r.mesh.scale.setScalar(1 + k * 5);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
    }
  }
}

// ---------- props ----------
function makePalm(rnd: () => number): THREE.Group {
  const palm = new THREE.Group();
  const trunkMat = flat(0x9a7448);
  const leafMat = flat(0x35a653, { side: THREE.DoubleSide });
  const nutMat = flat(0x6b4a2a);
  const height = 4 + rnd() * 1.6;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.22, height, 5), trunkMat);
  trunk.position.y = height / 2;
  palm.add(trunk);
  const crown = new THREE.Group();
  crown.position.y = height;
  for (let i = 0; i < 7; i++) {
    const geo = new THREE.ConeGeometry(0.36, 3.2, 3);
    geo.translate(0, 1.6, 0); // base at the origin, pointing +y
    const leaf = new THREE.Mesh(geo, leafMat);
    leaf.rotation.z = -(Math.PI / 2 + 0.15 + rnd() * 0.5); // fan outward with a gentle droop
    leaf.scale.set(1, 1, 0.3);
    const pivot = new THREE.Group();
    pivot.rotation.y = (i / 7) * Math.PI * 2 + rnd() * 0.3;
    pivot.add(leaf);
    crown.add(pivot);
  }
  for (let i = 0; i < 3; i++) {
    const nut = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0), nutMat);
    nut.position.set(Math.cos(i * 2.1) * 0.25, -0.1, Math.sin(i * 2.1) * 0.25);
    crown.add(nut);
  }
  palm.add(crown);
  palm.rotation.z = (rnd() - 0.5) * 0.2; // slight lean
  palm.rotation.y = rnd() * Math.PI * 2;
  return palm;
}

// ---------- the character ----------
// One chunky, faceted character in the N64 mould: a big round head, a small round body, short
// stubby limbs, white gloves and big shoes. It is used for every other player AND for your own
// body, so what you see when you look down is the character everyone else sees walking around.
// The build, hat, colours and features are rolled from the player's id.
interface Character {
  group: THREE.Group;
  head: THREE.Group; // hidden in first person so it can't block the view
  shirt: THREE.MeshLambertMaterial;
  setHue(h: number): void;
  /** Height of the very top of this body (m), so a name tag can float above it. */
  height: number;
  /** Put a (validated) data-URL photo on the front of the face, or null to go back to the plain face. */
  setFace(url: string | null): void;
}

const SKIN_TONES = [0xf6dcc0, 0xf0c49a, 0xd9a273, 0xa8683f, 0x6b4129];

function makeCharacter(id: string): Character {
  const hue = hueFor(id);
  const r = seeded(hashId(id) ^ 0x9e3779b9);
  const shirtColor = new THREE.Color().setHSL(hue / 360, 0.72, 0.5);
  const accentColor = new THREE.Color().setHSL(((hue + 150) % 360) / 360, 0.8, 0.55);
  const pantsColor = new THREE.Color().setHSL(((hue + 210) % 360) / 360, 0.5, 0.32);

  const shirt = new THREE.MeshLambertMaterial({ color: shirtColor, emissive: shirtColor, emissiveIntensity: 0, flatShading: true });
  const accent = flat(accentColor.getHex());
  const pants = flat(pantsColor.getHex());
  const skin = flat(SKIN_TONES[Math.floor(r() * SKIN_TONES.length)]);
  const glove = flat(r() < 0.7 ? 0xffffff : accentColor.getHex());
  const shoe = flat(r() < 0.6 ? 0x6b4423 : accentColor.clone().multiplyScalar(0.6).getHex());
  const hairMat = flat(0x2b1d14 + Math.floor(r() * 0x302010));
  const black = flat(0x101018);
  const white = flat(0xffffff);
  const nose = flat(0xe89a8a);

  // proportions, all rolled from the id
  const hs = 0.95 + r() * 0.25; // head size
  const bodyH = 0.9 + r() * 0.25;
  const bodyW = 0.92 + r() * 0.3;
  const legLen = 0.9 + r() * 0.3;
  const hat = Math.floor(r() * 5); // 0 cap, 1 beanie, 2 antenna, 3 ears, 4 crown
  const overalls = r() < 0.55;
  const mustache = r() < 0.4;
  const hasTail = r() < 0.3;

  const ico = (radius: number, detail = 1) => new THREE.IcosahedronGeometry(radius, detail);
  const place = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number) => {
    o.position.set(x, y, z);
    return o;
  };
  const ball = (radius: number, m: THREE.Material, sx = 1, sy = 1, sz = 1, detail = 1) => {
    const mesh = new THREE.Mesh(ico(radius, detail), m);
    mesh.scale.set(sx, sy, sz);
    return mesh;
  };

  const body = new THREE.Group();

  // legs and big shoes
  const legTop = 0.18 + 0.3 * legLen;
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.3 * legLen, 6), pants);
    body.add(place(leg, side * 0.14, 0.18 + (0.3 * legLen) / 2, 0));
    body.add(place(ball(0.15, shoe, 1.0, 0.7, 1.5), side * 0.15, 0.1, -0.06));
  }
  if (hasTail) {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.4, 4), accent);
    tail.rotation.x = Math.PI / 2 + 0.5;
    body.add(place(tail, 0, legTop + 0.05, 0.3));
  }

  // round torso, with an optional pair of overalls
  const torsoY = legTop + 0.28 * bodyH;
  body.add(place(ball(0.3, shirt, bodyW, bodyH * 1.05, 0.85), 0, torsoY, 0));
  if (overalls) body.add(place(ball(0.285, pants, bodyW * 1.02, bodyH * 0.62, 0.88), 0, torsoY - 0.12 * bodyH, 0));

  // short arms with big gloves
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.3, 6), shirt);
    arm.rotation.z = -side * 0.7;
    const shoulderX = side * (0.3 * bodyW + 0.05);
    const shoulderY = torsoY + 0.1 * bodyH;
    body.add(place(arm, shoulderX + side * 0.09, shoulderY - 0.1, 0));
    body.add(place(ball(0.12, glove), shoulderX + side * 0.2, shoulderY - 0.24, 0));
  }

  // head: a faceted ball, with ears, nose, eyes, an optional moustache, and a hat
  const headY = torsoY + 0.3 * bodyH + 0.26 * hs;
  const headR = 0.34 * hs;
  const head = new THREE.Group();
  head.add(place(ball(headR, skin, 1, 0.98, 0.98), 0, headY, 0));
  for (const side of [-1, 1]) head.add(place(ball(0.07 * hs, skin, 0.7, 1, 0.7, 0), side * (headR * 0.95), headY - 0.02, 0.02));

  const features = new THREE.Group(); // eyes, nose, moustache: hidden when there is a photo
  for (const side of [-1, 1]) {
    features.add(place(ball(0.052 * hs, white, 1, 1.2, 0.6, 0), side * 0.11 * hs, headY + 0.05 * hs, -headR * 0.9));
    features.add(place(ball(0.03 * hs, black, 1, 1.2, 0.6, 0), side * 0.11 * hs, headY + 0.05 * hs, -headR * 0.96));
  }
  features.add(place(ball(0.075 * hs, nose, 1, 0.9, 1, 0), 0, headY - 0.04 * hs, -headR * 1.0));
  if (mustache) features.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.24 * hs, 0.05, 0.07), hairMat), 0, headY - 0.12 * hs, -headR * 0.95));
  head.add(features);

  // the photo: a flat decal on the front of the face
  const photoMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(0.4 * hs, 0.4 * hs), photoMat);
  photo.rotation.y = Math.PI; // plane faces +z; the character walks toward -z
  photo.position.set(0, headY, -headR * 0.99);
  photo.visible = false;
  head.add(photo);

  let topY = headY + headR;
  if (hat === 0) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.06, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), accent);
    head.add(place(cap, 0, headY + headR * 0.12, 0));
    head.add(place(new THREE.Mesh(new THREE.BoxGeometry(headR * 1.0, 0.04, headR * 0.9), accent), 0, headY + headR * 0.22, -headR * 1.05));
    topY = headY + headR * 1.18;
  } else if (hat === 1) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.1, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2), accent);
    head.add(place(cap, 0, headY + headR * 0.2, 0));
    head.add(place(ball(0.09, white, 1, 1, 1, 0), 0, headY + headR * 1.3, 0));
    topY = headY + headR * 1.42;
  } else if (hat === 2) {
    head.add(place(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), black), 0, headY + headR + 0.12, 0));
    head.add(place(ball(0.08, accent, 1, 1, 1, 0), 0, headY + headR + 0.3, 0));
    topY = headY + headR + 0.4;
  } else if (hat === 3) {
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.1 * hs, 0.26, 4), accent);
      ear.rotation.z = -side * 0.25;
      head.add(place(ear, side * headR * 0.6, headY + headR * 0.95, 0));
    }
    topY = headY + headR + 0.22;
  } else {
    for (let i = 0; i < 5; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 4), accent);
      const a = (i / 5) * Math.PI * 2;
      head.add(place(spike, Math.cos(a) * headR * 0.5, headY + headR * 0.85, Math.sin(a) * headR * 0.5));
    }
    topY = headY + headR + 0.18;
  }
  body.add(head);

  // Normalise so the head sits at eye height whatever the proportions, so the camera always matches.
  const root = new THREE.Group();
  const s = 1.62 / headY;
  body.scale.setScalar(s);
  root.add(body);

  let faceTex: THREE.Texture | null = null;
  let faceRequest = 0;
  const setFace = (url: string | null) => {
    faceRequest++;
    const mine = faceRequest;
    faceTex?.dispose();
    faceTex = null;
    photoMat.map = null;
    photoMat.needsUpdate = true;
    photo.visible = false;
    features.visible = true;
    if (!url || !validAvatar(url)) return; // photos from other players are untrusted: re-validate
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        if (mine !== faceRequest) {
          tex.dispose(); // replaced or cleared while it was loading
          return;
        }
        tex.magFilter = THREE.NearestFilter; // keep the 32x32 photo crisp and chunky
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        faceTex = tex;
        photoMat.map = tex;
        photoMat.needsUpdate = true;
        photo.visible = true;
        features.visible = false; // the photo is the face now
      },
      undefined,
      () => {
        /* undecodable image: keep the plain face */
      },
    );
  };

  return {
    group: root,
    head,
    shirt,
    height: topY * s,
    setHue(h: number) {
      shirt.color.setHSL(h / 360, 0.72, 0.5);
      shirt.emissive.copy(shirt.color);
      accent.color.setHSL(((h + 150) % 360) / 360, 0.8, 0.55);
      pants.color.setHSL(((h + 210) % 360) / 360, 0.5, 0.32);
    },
    setFace,
  };
}

const CROUCH_SCALE = 0.7;
const NAME_HEIGHT = 2.5;

class Avatar {
  readonly group = new THREE.Group();
  readonly hit: THREE.Mesh; // what the crosshair ray tests against (invisible)
  private shell = new THREE.Group(); // the character; squashed when crouching
  private label: THREE.Sprite;
  private body: THREE.MeshLambertMaterial;
  private character: Character;
  private nameHeight = NAME_HEIGHT;
  private tx: number;
  private tz: number;
  private ty: number;
  private try_: number;
  private crouch: boolean;
  stepAccum = 0; // metres this player has walked since their last audible footstep

  constructor(p: PlayerState) {
    const ch = makeCharacter(p.id);
    this.character = ch;
    this.nameHeight = ch.height + 0.3;
    this.body = ch.shirt;
    if (p.avatar) ch.setFace(p.avatar);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.4, 0.8), new THREE.MeshBasicMaterial());
    hit.visible = false;
    hit.position.y = 1.2;
    hit.userData.id = p.id;
    this.hit = hit;
    this.shell.add(ch.group, hit);
    this.label = makeNameSprite(p.name);
    this.group.add(this.shell, this.label);
    this.group.position.set(p.x, p.y ?? 0, p.z);
    this.group.rotation.y = p.ry;
    this.tx = p.x;
    this.tz = p.z;
    this.ty = p.y ?? 0;
    this.try_ = p.ry;
    this.crouch = p.crouch ?? false;
    const s = this.crouch ? CROUCH_SCALE : 1;
    this.shell.scale.y = s;
    this.label.position.y = this.nameHeight * s;
  }

  setTarget(x: number, z: number, ry: number, y: number, crouch: boolean) {
    this.tx = x;
    this.tz = z;
    this.ty = y;
    this.try_ = ry;
    this.crouch = crouch;
  }

  setSpeaking(on: boolean) {
    this.body.emissiveIntensity = on ? 0.9 : 0;
  }

  setAvatar(url: string | null) {
    this.character.setFace(url);
  }

  update(dt: number) {
    const k = 1 - Math.exp(-15 * dt);
    const g = this.group;
    g.position.x += (this.tx - g.position.x) * k;
    g.position.z += (this.tz - g.position.z) * k;
    g.position.y += (this.ty - g.position.y) * k;
    const want = this.crouch ? CROUCH_SCALE : 1;
    this.shell.scale.y += (want - this.shell.scale.y) * k;
    this.label.position.y = this.nameHeight * this.shell.scale.y;
    let d = this.try_ - g.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d)); // shortest angle
    g.rotation.y += d * k;
  }

  dispose() {
    this.character.setFace(null); // frees the photo texture
    this.group.traverse((o) => {
      const m = o as THREE.Mesh | THREE.Sprite;
      (m as THREE.Mesh).geometry?.dispose?.();
      // some meshes may carry several materials
      const mats = ([] as (THREE.Material | undefined)[]).concat(m.material as THREE.Material | THREE.Material[] | undefined);
      for (const mat of mats) {
        (mat as THREE.SpriteMaterial | undefined)?.map?.dispose();
        mat?.dispose();
      }
    });
  }
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.1, 1500);
  readonly avatars = new Map<string, Avatar>();
  readonly pos = new THREE.Vector3(0, EYE_HEIGHT, 0); // camera position (feet + eye height)
  yaw = 0;
  pitch = 0;
  feetY = 0; // height of our feet above the floor; > 0 while jumping
  orbit = true; // slow fly-around of the arena behind the main screen; off once we join
  // 0 = first person, 1 = third person behind you, 2 = third person in front of you (T cycles, like Minecraft F5)
  viewMode: 0 | 1 | 2 = 0;
  crouching = false;
  inputEnabled = true;
  lookSensitivity = 1; // multiplier on mouse look; 1 = the original feel
  onFrame?: (dt: number) => void;
  onSentHome?: () => void; // fired when you drift past the swim limit and are returned to the centre
  onSound?: (e: SoundEvent) => void;

  private keys = new Set<string>();
  private last = performance.now();
  private clock = 0;
  private sim = newSim(0, 0); // the movement controller's state (see shared/movement.ts)
  private prevJump = false;
  private prevCrouch = false;
  private orbitAngle = Math.random() * Math.PI * 2;
  private tpBlend = 0; // 0 = camera at the head, 1 = fully pulled back
  private frontBlend = 0; // 0 = camera behind you, 1 = camera in front, facing you
  private selfThird = new THREE.Group(); // our full character, shown while the camera is pulled back
  private selfBody = new THREE.Group(); // the same character, minus head, seen when looking down
  private selfChars: Character[] = [];
  private selfAvatar: string | null = null;
  private ray = new THREE.Raycaster();
  private centre = new THREE.Vector2(0, 0);
  private water?: Water;
  private clouds?: THREE.Group;
  private ripples?: Ripples;
  private rippleTimer = 0;
  private stepAccum = 0; // metres walked since the last footstep

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.NoToneMapping;

    // Light haze in the horizon colour so the sea and hills melt into the sky.
    const horizon = new THREE.Color(SKY_HORIZON);
    this.scene.background = horizon;
    this.scene.fog = new THREE.Fog(horizon, 90, 720);
    this.camera.rotation.order = 'YXZ';

    this.scene.add(new THREE.HemisphereLight(0xd8eeff, 0x7d95b0, 1.0));
    const sunlight = new THREE.DirectionalLight(0xfff0cc, 1.8);
    sunlight.position.copy(SUN_DIR).multiplyScalar(100); // lights the world from where the sun is drawn
    this.scene.add(sunlight);

    this.clouds = makeClouds();
    this.scene.add(makeSkyDome(), makeSun(), this.clouds, makeHills());
    this.water = makeWater(this.scene);
    this.ripples = new Ripples(this.scene);
    this.buildIsland();
    this.buildSelfBody();

    window.addEventListener('resize', this.resize);
    this.resize();

    window.addEventListener('keydown', (e) => {
      if (!this.inputEnabled) return;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      // Stop Ctrl+S / Ctrl+D / Ctrl+A etc. from opening browser dialogs mid-game.
      if ((e.ctrlKey || e.metaKey) && document.pointerLockElement === this.canvas) e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.canvas || !this.inputEnabled) return;
      const k = 0.0022 * this.lookSensitivity;
      this.yaw -= e.movementX * k;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * k));
    });

    this.renderer.setAnimationLoop(this.tick);
  }

  lock() {
    try {
      const r = this.canvas.requestPointerLock() as unknown;
      if (r instanceof Promise) r.catch(() => {});
    } catch {
      /* needs a user gesture; the "click to resume" prompt covers it */
    }
  }

  clearKeys() {
    this.keys.clear();
  }

  teleport(x: number, z: number) {
    this.sim = newSim(x, z);
    this.feetY = 0;
    this.pos.set(x, EYE_HEIGHT, z);
  }

  private sendHome() {
    this.teleport(0, 0);
    this.onSentHome?.();
  }

  cycleView() {
    this.viewMode = ((this.viewMode + 1) % 3) as 0 | 1 | 2;
  }

  setFov(deg: number) {
    this.camera.fov = deg;
    this.camera.updateProjectionMatrix();
  }

  /** Your own photo on your own face (visible in third / front view). */
  setSelfAvatar(url: string | null) {
    this.selfAvatar = url;
    for (const c of this.selfChars) c.setFace(url);
  }

  setPlayerAvatar(id: string, url: string | null) {
    this.avatars.get(id)?.setAvatar(url);
  }

  /** Colour our own body like the character other players see us as. */
  setSelfId(id: string) {
    this.rebuildSelf(id); // your colour AND your build come from your id, like everyone else's
  }

  /** Id of the player under the crosshair within `maxDist` metres, if any. Call after render. */
  playerUnderCrosshair(maxDist: number): string | null {
    this.ray.setFromCamera(this.centre, this.camera);
    this.ray.far = maxDist;
    const hits = this.ray.intersectObjects([...this.avatars.values()].map((a) => a.hit), false);
    return hits.length ? (hits[0].object.userData.id as string) : null;
  }

  /** A tiled arena on a sandy island in a bright sea, with palms, rocks and a ring of buoys. */
  private buildIsland() {
    const R = MAP_RADIUS;
    const rnd = seeded(1337);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(R, 40),
      new THREE.MeshLambertMaterial({ map: makeCheckerTexture(this.renderer.capabilities.getMaxAnisotropy()) }),
    );
    floor.rotation.x = -Math.PI / 2;

    const rim = new THREE.Mesh(new THREE.RingGeometry(R - 0.45, R, 40), new THREE.MeshBasicMaterial({ color: 0xfff6c0 }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.01;

    const beach = new THREE.Mesh(new THREE.RingGeometry(R, R + 7, 40), flat(0xf0dc9c));
    beach.rotation.x = -Math.PI / 2;
    beach.position.y = -0.02;

    this.scene.add(floor, rim, beach);

    // A ring of buoys marks how far out you can swim.
    const buoyMat = flat(0xff6a2a);
    const buoyTop = flat(0xffffff);
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const buoy = new THREE.Group();
      buoy.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), buoyMat));
      const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), buoyTop);
      cap.position.y = 0.4;
      buoy.add(cap);
      buoy.position.set(Math.cos(a) * (SWIM_LIMIT - 0.5), SEA_LEVEL + 0.1, Math.sin(a) * (SWIM_LIMIT - 0.5));
      this.scene.add(buoy);
    }

    this.buildObstacles();
    const nearObstacle = (x: number, z: number, margin: number) =>
      OBSTACLES.some((k) => Math.abs(x - k.x) < k.w / 2 + margin && Math.abs(z - k.z) < k.d / 2 + margin);

    // Palms along the beach. Decoration only: they sit outside the tiled arena.
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2 + (rnd() - 0.5) * 0.25;
      const r = R + 1.8 + rnd() * 3.4;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const palm = makePalm(rnd);
      if (nearObstacle(x, z, 2.5)) continue; // keep the parkour course clear of scenery
      palm.position.set(x, 0, z);
      this.scene.add(palm);
    }

    // Rocks on the beach and out in the shallows.
    const rockMat = flat(0x8d98ad);
    for (let i = 0; i < 16; i++) {
      const angle = rnd() * Math.PI * 2;
      const r = R + 3 + rnd() * 24;
      const size = 0.7 + rnd() * 1.6;
      if (nearObstacle(Math.cos(angle) * r, Math.sin(angle) * r, size + 2)) continue;
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), rockMat);
      rock.position.set(Math.cos(angle) * r, size * 0.25 - 0.3, Math.sin(angle) * r);
      rock.scale.y = 0.65;
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      this.scene.add(rock);
    }
  }

  /** Crates, walls, steps, beams and the parkour course, all from shared/obstacles.ts. */
  private buildObstacles() {
    const colors: Record<Block['kind'], number> = {
      crate: 0xc99560,
      wall: 0x8e9cc0,
      step: 0xf6c84f,
      platform: 0xff9f43,
      beam: 0xe85a4a,
      pillar: 0xb4bdd2,
      goal: 0x58c23a,
    };
    const mats = new Map<number, THREE.Material>();
    const cap = flat(0xffffff);
    for (const k of OBSTACLES) {
      const color = colors[k.kind];
      let mat = mats.get(color);
      if (!mat) {
        mat = flat(color);
        mats.set(color, mat);
      }
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(k.w, k.h, k.d), mat);
      mesh.position.set(k.x, k.y0 + k.h / 2, k.z);
      this.scene.add(mesh);
      // a pale rim on the walkable surfaces, so edges read clearly
      if (k.kind !== 'pillar' && k.kind !== 'beam') {
        const rim = new THREE.Mesh(new THREE.BoxGeometry(k.w + 0.04, 0.06, k.d + 0.04), cap);
        rim.position.set(k.x, blockTop(k) + 0.01, k.z);
        this.scene.add(rim);
      }
    }
    // a flag on the goal tower
    const goal = OBSTACLES.find((k) => k.kind === 'goal');
    if (goal) {
      const top = blockTop(goal);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 5), flat(0xffffff));
      pole.position.set(goal.x, top + 0.9, goal.z);
      const flag = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 3), flat(0xffd23f));
      flag.rotation.z = -Math.PI / 2;
      flag.position.set(goal.x + 0.45, top + 1.5, goal.z);
      this.scene.add(pole, flag);
    }
  }

  /**
   * Your own body: the same character other players see. In first person the head is hidden (and
   * the model sits a little behind the camera) so you only see arms, torso and legs when you look
   * down; once the camera pulls back the full character takes over.
   */
  private buildSelfBody() {
    this.scene.add(this.selfBody, this.selfThird);
    this.rebuildSelf('self'); // placeholder until the server tells us our id
  }

  private rebuildSelf(id: string) {
    this.selfBody.clear();
    this.selfThird.clear();
    const fp = makeCharacter(id);
    fp.head.visible = false;
    fp.group.position.z = 0.2; // z > 0 is behind the camera: clear of the near plane, yet the chest and legs show when you look down
    this.selfBody.add(fp.group);
    const tp = makeCharacter(id);
    this.selfThird.add(tp.group);
    this.selfChars = [fp, tp];
    for (const c of this.selfChars) c.setFace(this.selfAvatar);
  }

  addPlayer(p: PlayerState) {
    if (this.avatars.has(p.id)) return;
    const a = new Avatar(p);
    this.avatars.set(p.id, a);
    this.scene.add(a.group);
  }

  removePlayer(id: string) {
    const a = this.avatars.get(id);
    if (!a) return;
    this.scene.remove(a.group);
    a.dispose();
    this.avatars.delete(id);
  }

  applyState(id: string, x: number, z: number, ry: number, y: number, crouch: boolean) {
    this.avatars.get(id)?.setTarget(x, z, ry, y, crouch);
  }

  setSpeaking(id: string, on: boolean) {
    this.avatars.get(id)?.setSpeaking(on);
  }

  private resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  /**
   * Keys -> inputs for the shared controller (walk, Shift sprint, C crouch / slide, Space jump,
   * ledge grab and vault). All of the actual movement rules live in shared/movement.ts.
   */
  private move(dt: number) {
    const k = this.keys;
    const on = this.inputEnabled;
    const f = on ? (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) : 0;
    const side = on ? (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) : 0;
    const jump = on && k.has('Space');
    const crouch = on && k.has('KeyC');
    const input: Input = {
      f,
      s: side,
      yaw: this.yaw,
      jump,
      jumpPressed: jump && !this.prevJump,
      crouch,
      crouchPressed: crouch && !this.prevCrouch,
      sprint: on && (k.has('ShiftLeft') || k.has('ShiftRight')),
    };
    this.prevJump = jump;
    this.prevCrouch = crouch;

    const s = this.sim;
    const was = {
      vy: s.vy,
      ground: s.onGround,
      sliding: s.sliding,
      hanging: s.hanging,
      mantle: s.mantle !== null,
      depth: waterDepth(s.x, s.z),
    };
    const { sentHome } = stepPlayer(this.sim, input, dt);
    this.emitMoveSounds(was, dt);
    this.pos.x = this.sim.x;
    this.pos.z = this.sim.z;
    this.feetY = this.sim.y;
    this.crouching = this.sim.crouching || this.sim.sliding; // others see a slide as a crouch
    if (sentHome) this.sendHome(); // past the buoys
  }

  /** The surface under a point on the ground, for footstep sounds. */
  private surfaceAt(x: number, z: number, y: number): 'grass' | 'sand' | 'block' | 'water' {
    if (waterDepth(x, z) > 0.3) return 'water';
    if (y > 0.08) return 'block';
    return Math.hypot(x, z) > MAP_RADIUS ? 'sand' : 'grass';
  }

  /** Turn what the controller just did into sound events: footsteps, jumps, landings, slides, climbs, splashes. */
  private emitMoveSounds(
    was: { vy: number; ground: boolean; sliding: boolean; hanging: boolean; mantle: boolean; depth: number },
    dt: number,
  ) {
    const emit = this.onSound;
    if (!emit || this.orbit) return;
    const s = this.sim;
    if (was.vy <= 0.5 && s.vy > 5 && !s.mantle) emit({ kind: 'jump' });
    if (!was.ground && s.onGround && was.vy < -4) emit({ kind: 'land', strength: Math.min(1, -was.vy / 14) });
    if (!was.sliding && s.sliding) emit({ kind: 'slideStart' });
    if (was.sliding && !s.sliding) emit({ kind: 'slideEnd' });
    if (!was.hanging && s.hanging) emit({ kind: 'grab' });
    if (!was.mantle && s.mantle) emit({ kind: 'mantle' });
    const depth = waterDepth(s.x, s.z);
    if (was.depth < 0.15 && depth >= 0.15) emit({ kind: 'splash', strength: Math.min(1, Math.hypot(s.vx, s.vz) / 8 + 0.3) });

    // footsteps: one per stride while moving on the ground, closer together at a run
    const speed = Math.hypot(s.vx, s.vz);
    if (s.onGround && !s.sliding && !s.hanging && !s.mantle && speed > 0.8) {
      this.stepAccum += speed * dt;
      const stride = s.crouching ? 1.1 : speed > 6.5 ? 2.2 : 1.7;
      if (this.stepAccum >= stride) {
        this.stepAccum = 0;
        emit({ kind: 'step', surface: this.surfaceAt(s.x, s.z, s.y), gain: s.crouching ? 0.45 : 1 });
      }
    } else if (speed <= 0.8) {
      this.stepAccum = Math.min(this.stepAccum, 0.9); // starting again soon gives a prompt first step
    }
  }

  /** Other players' footsteps, quieter with distance. */
  private remoteSteps(a: Avatar, moved: number) {
    const emit = this.onSound;
    if (!emit || this.orbit) return;
    const g = a.group.position;
    if (g.y > 0.6 || moved < 0.002) return; // in the air, or standing still
    a.stepAccum += moved;
    if (a.stepAccum < 1.9) return;
    a.stepAccum = 0;
    const d = Math.hypot(g.x - this.pos.x, g.z - this.pos.z);
    const gain = Math.max(0, 1 - d / 22) * 0.6;
    if (gain > 0.03) emit({ kind: 'step', surface: this.surfaceAt(g.x, g.z, g.y), gain });
  }

  /** Players are solid: slide around others and get nudged if someone walks into you. */
  private collide() {
    const p = pushOut(this.pos.x, this.pos.z, [...this.avatars.values()].map((a) => a.group.position), BODY_RADIUS * 2);
    const q = clampToArena(p.x, p.z, SWIM_LIMIT);
    this.pos.x = q.x;
    this.pos.z = q.z;
    this.sim.x = q.x; // players shoving each other must move the controller too
    this.sim.z = q.z;
  }

  // three.js only schedules the next frame after this callback returns, so an exception here
  // would freeze the game for good. Each stage is isolated: one bad value cannot stop the rest.
  private tick = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;
    this.safe('update', () => this.update(dt));
    this.safe('render', () => this.renderer.render(this.scene, this.camera));
    this.safe('frame', () => this.onFrame?.(dt));
  };

  private reported = new Set<string>();
  private safe(stage: string, fn: () => void) {
    try {
      fn();
    } catch (e) {
      const key = `${stage}: ${e instanceof Error ? e.message : String(e)}`;
      if (this.reported.has(key)) return; // log each distinct error once, not 60 times a second
      this.reported.add(key);
      console.error('[game] frame error (game kept running)', key, e);
    }
  }

  private update(dt: number) {
    this.move(dt);
    this.water?.update(this.clock);
    if (this.clouds) this.clouds.rotation.y += dt * 0.004; // a very slow drift
    for (const a of this.avatars.values()) {
      const px = a.group.position.x;
      const pz = a.group.position.z;
      a.update(dt);
      this.remoteSteps(a, Math.hypot(a.group.position.x - px, a.group.position.z - pz));
    }
    this.collide();

    // ripples where anyone wades through the water
    this.ripples?.update(dt);
    this.rippleTimer -= dt;
    if (this.rippleTimer <= 0 && this.ripples) {
      this.rippleTimer = 0.35;
      const speed = Math.hypot(this.sim.vx, this.sim.vz);
      if (waterDepth(this.pos.x, this.pos.z) > 0.25 && speed > 0.6 && !this.orbit) this.ripples.emit(this.pos.x, this.pos.z);
      for (const a of this.avatars.values()) {
        if (a.group.position.y < -0.45) this.ripples.emit(a.group.position.x, a.group.position.z);
      }
    }

    this.pos.y = this.feetY + this.sim.eye;
    const ease = 1 - Math.exp(-7 * dt);
    const wantBack = this.viewMode > 0 ? 1 : 0;
    const wantFront = this.viewMode === 2 ? 1 : 0;
    this.tpBlend += (wantBack - this.tpBlend) * ease;
    this.frontBlend += (wantFront - this.frontBlend) * ease;
    if (Math.abs(this.tpBlend - wantBack) < 0.001) this.tpBlend = wantBack;
    if (Math.abs(this.frontBlend - wantFront) < 0.001) this.frontBlend = wantFront;
    if (this.orbit) {
      this.orbitAngle += dt * 0.06;
      const r = MAP_RADIUS * 0.7;
      this.camera.position.set(Math.cos(this.orbitAngle) * r, 6, Math.sin(this.orbitAngle) * r);
      this.camera.lookAt(0, 5, 0); // slightly down, so the horizon, sun and clouds frame the menu
    } else {
      // Smoothstep so moves start and end gently. The camera orbits the head: pulling back is a
      // change of distance, and going to the front view swings it 180 degrees around you (yaw + PI)
      // with the pitch mirrored, so it always looks at you. The head itself never moves.
      const t = this.tpBlend * this.tpBlend * (3 - 2 * this.tpBlend);
      const f = this.frontBlend * this.frontBlend * (3 - 2 * this.frontBlend);
      const camYaw = this.yaw + Math.PI * f;
      const camPitch = this.pitch * (1 - 2 * f);
      const cp = Math.cos(camPitch);
      const back = THIRD_DISTANCE * t;
      this.camera.position.set(
        this.pos.x + Math.sin(camYaw) * cp * back,
        Math.max(0.35, this.pos.y - Math.sin(camPitch) * back + THIRD_LIFT * t),
        this.pos.z + Math.cos(camYaw) * cp * back,
      );
      this.camera.rotation.set(camPitch, camYaw, 0);
    }
    // The headless first-person body only while the camera is at the head; the full character
    // (identical model, with its head) takes over as the camera pulls back.
    this.selfBody.visible = !this.orbit && this.tpBlend < 0.02;
    this.selfThird.visible = !this.orbit && this.tpBlend >= 0.02;
    const squash = 0.7 + 0.3 * Math.min(1, Math.max(0, (this.sim.eye - EYE_CROUCH) / (EYE_HEIGHT - EYE_CROUCH)));
    this.selfThird.position.set(this.pos.x, this.feetY, this.pos.z);
    this.selfThird.rotation.y = this.yaw;
    this.selfThird.scale.y = squash;
    this.selfBody.position.set(this.pos.x, this.feetY, this.pos.z);
    this.selfBody.rotation.y = this.yaw;
    this.selfBody.scale.y = squash;
  }
}
