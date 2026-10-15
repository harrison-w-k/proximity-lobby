import * as THREE from 'three';
import { MAP_RADIUS, SWIM_LIMIT, type PlayerState } from '../../shared/protocol';
import { clampToArena, SHORE_RADIUS, waterDepth } from '../../shared/map';
import { BODY_RADIUS, EYE_CROUCH, EYE_STAND, newSim, stepPlayer, type Input } from '../../shared/movement';
import { HOOP, OBSTACLES, SCENERY, blockTop, type Block } from '../../shared/obstacles';
import { HATS, LOOK_COLORS, type Look } from '../../shared/look';
import { REACH, throughHoop, throwPath, type Flight, type ItemKind, type ItemState } from '../../shared/items';

import { pushOut } from './collision';
import { validAvatar } from '../../shared/avatar';
import * as T from './textures';

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
  | { kind: 'splash'; strength: number }
  | { kind: 'pickup' }
  | { kind: 'drop' }
  | { kind: 'throw'; power: number }
  | { kind: 'hit' }
  | { kind: 'score' };

export const DEFAULT_FOV = 75;
export const DEFAULT_RENDER_HEIGHT = 480;

// Over-the-shoulder camera
const SHOULDER_DISTANCE = 3.0; // metres behind the head
const SHOULDER_OFFSET = 0.62; // and to the right of it, so the character sits left of the crosshair
const SHOULDER_LIFT = 0.35; // and a little above

// ---------- look: low poly + low-res textures ----------
// Faceted, flat-shaded models wearing small hand-drawn textures with hard texels, drawn at a reduced
// internal resolution and scaled up with no smoothing. Chunky and a bit gritty, in the manner of
// late-90s 3D, without noise or dithering.
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

const textured = (map: THREE.Texture, color = 0xffffff, extra: Partial<THREE.MeshLambertMaterialParameters> = {}) =>
  new THREE.MeshLambertMaterial({ map, color, flatShading: true, ...extra });

/** The textures are built once, the first time the world needs them. */
let texCache: {
  grass: THREE.Texture;
  sand: THREE.Texture;
  concrete: THREE.Texture;
  crate: THREE.Texture;
  hazard: THREE.Texture;
  orangeMetal: THREE.Texture;
  barrier: THREE.Texture;
  goal: THREE.Texture;
  steel: THREE.Texture;
  rock: THREE.Texture;
  bark: THREE.Texture;
  leaf: THREE.Texture;
  glints: THREE.Texture;
  armor: THREE.Texture;
  dark: THREE.Texture;
} | null = null;
const tex = () => {
  if (!texCache) {
    texCache = {
      grass: T.grassTile(),
      sand: T.sand(),
      concrete: T.concrete(),
      crate: T.crate(),
      hazard: T.hazard(),
      orangeMetal: T.orangeMetal(),
      barrier: T.barrier(),
      goal: T.goalPanel(),
      steel: T.steel(),
      rock: T.rock(),
      bark: T.bark(),
      leaf: T.leaf(),
      glints: T.waterGlints(),
      armor: T.armor(),
      dark: T.darkMetal(),
    };
  }
  return texCache;
};

function makeNameSprite(name: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(8,16,40,0.7)';
  g.fillRect(4, 8, 248, 48);
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
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9db2cc, flatShading: true, fog: false });
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
 * facet) and the whole thing wears a tiny ripple texture; the sun glints off the tilted faces and
 * foam pulses where the sea meets the beach.
 */
function makeWater(scene: THREE.Scene, glints: THREE.Texture): Water {
  const n = WATER_CELLS;
  const cell = WATER_SIZE / n;
  const half = WATER_SIZE / 2;
  const rnd = seeded(77);

  const vertCount = n * n * 6;
  const pos = new Float32Array(vertCount * 3);
  const col = new Float32Array(vertCount * 3);
  const uv = new Float32Array(vertCount * 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

  const shallow = new THREE.Color(0x4fe3d0);
  const mid = new THREE.Color(0x2b9ae8);
  const deep = new THREE.Color(0x14509e);
  const foam = new THREE.Color(0xffffff);
  const tmp = new THREE.Color();

  // per-face base colour, texture coordinates, and the faces that foam
  const foamFaces: { first: number; phase: number; base: THREE.Color }[] = [];
  const texScale = 1 / 14; // one texture repeat covers 14 m of sea
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const corners = [
        [i, j],
        [i, j + 1],
        [i + 1, j],
        [i + 1, j],
        [i, j + 1],
        [i + 1, j + 1],
      ];
      corners.forEach(([ci, cj], v) => {
        const idx = (j * n + i) * 6 + v;
        uv[idx * 2] = (ci * cell - half) * texScale;
        uv[idx * 2 + 1] = (cj * cell - half) * texScale;
      });
      for (let tri = 0; tri < 2; tri++) {
        const first = (j * n + i) * 6 + tri * 3;
        const cx = (i + (tri === 0 ? 0.33 : 0.67)) * cell - half;
        const cz = (j + (tri === 0 ? 0.67 : 0.33)) * cell - half;
        const r = Math.hypot(cx, cz);
        const t = Math.min(1, Math.max(0, (r - SHORE_RADIUS) / 60));
        tmp.copy(shallow).lerp(mid, Math.min(1, t * 2.2));
        if (t > 0.45) tmp.lerp(deep, Math.min(1, (t - 0.45) / 0.55));
        tmp.offsetHSL(0, 0, (rnd() - 0.5) * 0.09); // a little random brightness per facet
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
    map: glints,
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
          heights[j * stride + i] = wave(i * cell - half, j * cell - half, t);
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

      // the ripples drift slowly across the surface
      glints.offset.set((t * 0.011) % 1, (t * 0.0065) % 1);

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
function makePalm(rnd: () => number, trunkMat: THREE.Material, leafMat: THREE.Material): THREE.Group {
  const palm = new THREE.Group();
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

// ---------- the character: a mecha chameleon ----------
// A robotic chameleon on two legs: a sleek armoured body in the player's colour (which slowly
// shifts, like camouflage), a long snout with a screen for a face (your photo goes here), eyes on
// independent swivelling turrets, clawed two-and-two hands and feet, a casque crest and a tightly
// curled tail. The build, crest, tail and glow colour come from the player's id. It is used for
// every other player AND for your own body, so what you see looking down is the same machine
// everyone else sees. It is animated procedurally: walk and run cycles, a crouch, a slide lean,
// a jump tuck, a ledge hang and a climb.

/** What the body is doing, so it can pose itself. */
interface AnimState {
  speed: number; // horizontal speed, m/s
  grounded: boolean;
  vy: number;
  crouch: boolean;
  sliding: boolean;
  hanging: boolean;
  mantle: boolean;
  ragdoll?: number; // 0..1: knocked down and limp
  ragFall?: number; // +1 falls forwards, -1 backwards
  ragSpin?: number; // radians of twist accumulated while tumbling
  ragSev?: number; // 0..1 how hard the hit was
  carrying?: boolean; // holding something out in front
}

interface Character {
  group: THREE.Group;
  head: THREE.Group; // hidden in first person so it can't block the view
  shirt: THREE.MeshLambertMaterial; // the armour: its emissive lights up when the player speaks
  setHue(h: number): void;
  /** Clay colour and hat chosen in the character menu (null: the id-based defaults). */
  setLook(look: Look | null): void;
  /** Height of the very top of this body (m), so a name tag can float above it. */
  height: number;
  /** Put a (validated) data-URL photo on the face screen, or null to go back to the default eyes. */
  setFace(url: string | null): void;
  /** Pose the body for this frame. `t` is the shared clock in seconds. */
  animate(a: AnimState, dt: number, t: number): void;
}

function makeCharacter(id: string): Character {
  const hue = hueFor(id);
  const r = seeded(hashId(id) ^ 0x9e3779b9);
  const phase0 = r() * 6.28;
  const bulk = 0.92 + r() * 0.22;
  // Colourless: one clay finish (a light-to-mid grey picked from the id, or from the character menu),
  // slightly darker ball joints, and neutral black and white for the eyes.
  const SHADES = [0xf4f4f2, 0xe6e6e2, 0xd6d6d6, 0xc4c6ca, 0xb4b6ba];
  const clayColor = new THREE.Color(SHADES[Math.floor(r() * SHADES.length)]);
  const baseShade = clayColor.clone();
  const lit = (c: THREE.Color) => new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.22 });
  // the clay (also what lights up when the player speaks)
  const armor = new THREE.MeshLambertMaterial({ color: clayColor, emissive: clayColor, emissiveIntensity: 0.25 });
  const skin = armor;
  const jointCol = clayColor.clone().multiplyScalar(0.78);
  const jointM = lit(jointCol);
  const darkM = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const whiteM = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.3 });
  const lipM = new THREE.MeshLambertMaterial({ color: 0x77777a });
  const hairKind = Math.floor(r() * 6);
  const blank = new THREE.Color(clayColor);
  // the photo (if any) is drawn over the face; without one the plane is hidden and the features show
  const faceMat = new THREE.MeshBasicMaterial({ color: blank });

  const cyl = (rt: number, rb: number, h: number, seg: number, m: THREE.Material) =>
    new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  const ico = (rad: number, m: THREE.Material, detail = 0) => new THREE.Mesh(new THREE.IcosahedronGeometry(rad, detail), m);
  const box = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const cone = (rad: number, h: number, seg: number, m: THREE.Material) => new THREE.Mesh(new THREE.ConeGeometry(rad, h, seg), m);
  const at = <O extends THREE.Object3D>(o: O, x: number, y: number, z: number) => {
    o.position.set(x, y, z);
    return o;
  };
  const group = (x = 0, y = 0, z = 0) => at(new THREE.Group(), x, y, z);

  const body = new THREE.Group();
  const caps = (rad: number, len: number, m: THREE.Material = skin) => new THREE.Mesh(new THREE.CapsuleGeometry(rad, len, 4, 12), m);
  /** A tapered limb segment of `len` metres, radius rt at the top and rb at the bottom, centred on its middle. */
  const seg = (rt: number, rb: number, len: number, m: THREE.Material = armor) =>
    new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, 14, 1), m);
  /** A smooth ellipsoid with half-extents (rx, ry, rz) metres. */
  const blob = (rx: number, ry: number, rz: number, mat: THREE.Material = skin) => {
    const m = ico(1, mat, 2);
    m.scale.set(rx, ry, rz);
    return m;
  };

  // A 1.75 m adult, in metres: ankle 0.08, knee 0.51, hip 0.94, shoulder 1.43, neck 1.5, head
  // centre 1.64. Eyes sit at about 1.68, and the whole figure is scaled so that is the camera height.
  const HIP = 0.94;
  const THIGH = 0.43;
  const SHIN = 0.43;

  // pelvis: a block with hip bones, and two glutes behind
  body.add(at(blob(0.19 * bulk, 0.105, 0.12), 0, HIP + 0.025, 0));
  for (const side of [-1, 1]) body.add(at(blob(0.095, 0.1, 0.085), side * 0.085 * bulk, HIP - 0.01, 0.075));

  // legs: hip ball, tapered thigh with a quad bulge, knee ball and kneecap, calf with a muscle,
  // ankle ball, foot (heel + arch) and a toe block on its own hinge
  type Leg = { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group; toe: THREE.Group };
  const legs: Leg[] = [];
  for (const side of [-1, 1]) {
    const hip = group(side * 0.1 * bulk, HIP, 0);
    hip.add(at(blob(0.088, 0.088, 0.088, jointM), 0, 0, 0));
    hip.add(at(seg(0.092, 0.066, THIGH - 0.06), 0, -THIGH / 2 + 0.01, 0));
    hip.add(at(blob(0.08, 0.17, 0.085), 0, -0.2, -0.02)); // the quad
    const knee = group(0, -THIGH, 0);
    knee.add(at(blob(0.068, 0.068, 0.068, jointM), 0, 0, 0));
    knee.add(at(blob(0.04, 0.045, 0.03), 0, 0, -0.06)); // kneecap
    knee.add(at(seg(0.064, 0.042, SHIN - 0.05), 0, -SHIN / 2 + 0.005, 0));
    knee.add(at(blob(0.062, 0.1, 0.07), 0, -0.14, 0.03)); // the calf
    const ankle = group(0, -SHIN, 0);
    ankle.add(at(blob(0.048, 0.048, 0.048, jointM), 0, 0.005, 0));
    ankle.add(at(blob(0.05, 0.035, 0.09), 0, -0.04, -0.02)); // heel and arch
    ankle.add(at(blob(0.04, 0.03, 0.045), 0, -0.04, 0.045)); // the heel itself
    const toe = group(0, -0.05, -0.1);
    toe.add(at(blob(0.056, 0.026, 0.05), 0, 0, -0.03)); // the toe block
    for (let t = 0; t < 5; t++) toe.add(at(blob(0.011, 0.012, 0.016, jointM), -0.04 + t * 0.02, -0.004, -0.075));
    ankle.add(toe);
    knee.add(ankle);
    hip.add(knee);
    body.add(hip);
    legs.push({ hip, knee, ankle, toe });
  }

  // torso: hips pivot -> lumbar (waist) -> ribcage group (shoulders, neck, head)
  const torsoG = group(0, HIP, 0);
  torsoG.add(at(blob(0.165 * bulk, 0.1, 0.11), 0, 0.1, 0)); // abdomen
  torsoG.add(at(blob(0.07, 0.07, 0.07, jointM), 0, 0.2, 0)); // lumbar joint
  const chestG = group(0, 0.2, 0); // ribcage
  torsoG.add(chestG);
  chestG.add(at(blob(0.2 * bulk, 0.19, 0.13), 0, 0.14, 0)); // ribs
  for (const side of [-1, 1]) {
    chestG.add(at(blob(0.09 * bulk, 0.075, 0.06), side * 0.085 * bulk, 0.17, -0.09)); // pecs
    const clav = at(blob(0.1, 0.015, 0.018), side * 0.1 * bulk, 0.27, -0.03);
    clav.rotation.z = side * -0.18;
    chestG.add(clav); // collar bone
  }
  chestG.add(at(blob(0.12 * bulk, 0.06, 0.08), 0, 0.28, 0.06)); // upper back / traps

  // neck: two segments with a joint between, so the head can nod and turn
  const neckG = group(0, 0.31, 0);
  chestG.add(neckG);
  neckG.add(at(blob(0.058, 0.058, 0.058, jointM), 0, 0, 0));
  neckG.add(at(seg(0.046, 0.04, 0.09), 0, 0.05, 0));

  // head: a human-proportioned egg (about 15 cm wide, 23 cm tall)
  const head = group(0, 0.2, -0.005);
  neckG.add(head);
  head.add(at(blob(0.088, 0.122, 0.105), 0, 0.0, 0));
  head.add(at(blob(0.07, 0.055, 0.078), 0, -0.07, -0.015)); // jaw
  head.add(at(blob(0.03, 0.02, 0.025), 0, -0.095, -0.07)); // chin
  head.add(at(blob(0.09, 0.03, 0.1), 0, 0.045, -0.01)); // brow ridge
  for (const side of [-1, 1]) {
    head.add(at(blob(0.011, 0.028, 0.02), side * 0.088, -0.005, 0.005)); // ears
    head.add(at(blob(0.018, 0.012, 0.01, whiteM), side * 0.034, 0.028, -0.094)); // eye whites
    head.add(at(blob(0.0085, 0.0085, 0.006, darkM), side * 0.034, 0.028, -0.1)); // pupils
    const brow = at(blob(0.022, 0.0055, 0.008, jointM), side * 0.035, 0.056, -0.093);
    brow.rotation.z = side * -0.12;
    head.add(brow);
    head.add(at(blob(0.016, 0.02, 0.012), side * 0.05, -0.04, -0.085)); // cheeks
  }
  head.add(at(blob(0.011, 0.026, 0.02), 0, -0.015, -0.103)); // nose
  head.add(at(blob(0.027, 0.0055, 0.008, lipM), 0, -0.058, -0.097)); // mouth

  // hair, sculpted in the same clay: six styles picked from the id
  const hairAt = (m: THREE.Object3D) => head.add(m);
  if (hairKind === 0 || hairKind === 1 || hairKind === 5) {
    hairAt(at(blob(0.094, 0.082, 0.112), 0, 0.05, 0.012)); // the crown
    hairAt(at(blob(0.1, 0.04, 0.05), 0, 0.085, -0.075)); // a fringe over the forehead
  }
  if (hairKind === 1) hairAt(at(blob(0.092, 0.14, 0.05), 0, -0.04, 0.075)); // long, down the back
  if (hairKind === 5) hairAt(at(blob(0.036, 0.036, 0.036), 0, 0.13, 0.03)); // a bun
  if (hairKind === 2) hairAt(at(blob(0.09, 0.07, 0.105), 0, 0.055, 0.005)); // buzz cut
  if (hairKind === 3) {
    for (let i = 0; i < 4; i++) hairAt(at(blob(0.014, 0.05, 0.026), 0, 0.1 - i * 0.002, 0.07 - i * 0.045)); // mohawk
  }
  // kind 4: bald

  // the profile photo, if any, covers the face (just proud of the skin so it never z-fights)
  const screenPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.125, 0.16), faceMat);
  screenPlane.rotation.y = Math.PI; // plane faces +z; the character faces -z
  screenPlane.visible = false;
  head.add(at(screenPlane, 0, 0.0, -0.11));
  const crestTop = 0.13;
  const eyes: THREE.Group[] = [];

  // arms: shoulder ball + deltoid, bicep, elbow ball, forearm, wrist, hand with jointed fingers
  type Arm = { shoulder: THREE.Group; elbow: THREE.Group; wrist: THREE.Group; fingers: THREE.Group[] };
  const arms: Arm[] = [];
  for (const side of [-1, 1]) {
    const shoulder = group(side * 0.25 * bulk, 0.27, 0);
    chestG.add(shoulder);
    shoulder.add(at(blob(0.072, 0.072, 0.072, jointM), 0, 0, 0));
    shoulder.add(at(blob(0.062, 0.085, 0.066), side * 0.012, -0.04, 0)); // deltoid
    shoulder.add(at(seg(0.055, 0.042, 0.26), 0, -0.15, 0)); // upper arm
    shoulder.add(at(blob(0.04, 0.08, 0.04), 0, -0.13, -0.025)); // bicep
    const elbow = group(0, -0.29, 0);
    elbow.add(at(blob(0.046, 0.046, 0.046, jointM), 0, 0, 0));
    elbow.add(at(seg(0.044, 0.03, 0.22), 0, -0.125, 0)); // forearm
    elbow.add(at(blob(0.038, 0.07, 0.04), 0, -0.07, 0)); // forearm muscle
    const wrist = group(0, -0.265, 0);
    wrist.add(at(blob(0.03, 0.03, 0.03, jointM), 0, 0, 0));
    wrist.add(at(blob(0.047, 0.05, 0.022), 0, -0.05, 0)); // palm
    // four fingers, each with a knuckle ball and two segments that curl independently
    const fingers: THREE.Group[] = [];
    const lens = [0.038, 0.043, 0.04, 0.032];
    for (let f = 0; f < 4; f++) {
      const prox = group(-0.033 + f * 0.022, -0.1, 0);
      prox.add(at(blob(0.0095, 0.0095, 0.0095, jointM), 0, 0, 0));
      prox.add(at(blob(0.0085, lens[f] / 2, 0.0085), 0, -lens[f] / 2, 0));
      const mid = group(0, -lens[f], 0);
      mid.add(at(blob(0.0078, lens[f] / 2.2, 0.0078), 0, -lens[f] / 2.2, 0));
      prox.add(mid);
      wrist.add(prox);
      fingers.push(prox, mid);
    }
    const thumb = group(side * -0.045, -0.04, -0.01);
    thumb.add(at(blob(0.011, 0.025, 0.012), 0, -0.02, 0));
    const thumb2 = group(0, -0.04, 0);
    thumb2.add(at(blob(0.009, 0.02, 0.01), 0, -0.016, 0));
    thumb.add(thumb2);
    thumb.rotation.z = side * 0.4;
    wrist.add(thumb);
    elbow.add(wrist);
    shoulder.add(elbow);
    arms.push({ shoulder, elbow, wrist, fingers });
  }
  body.add(torsoG);
  const tail = group(0, 0.72, 0.2); // (kept so the animation code below has nothing to special-case)

  // Normalise so the head sits at eye height whatever the proportions, so the camera always matches.
  const headY = HIP + 0.2 + 0.31 + 0.2 + 0.04; // eye height of the unscaled figure
  const s = 1.62 / headY;
  const root = new THREE.Group();
  body.scale.setScalar(s);
  root.add(body);

  // ----- look: colour and hat -----
  let hat: THREE.Group | null = null;
  const hatMat = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });
  const makeHat = (kind: number): THREE.Group | null => {
    if (kind <= 0) return null;
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, hatMat(color));
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    if (kind === 1) {
      add(new THREE.SphereGeometry(0.225, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0x8d9096, 0, 0.08, 0);
      add(new THREE.BoxGeometry(0.3, 0.025, 0.2), 0x5d6066, 0, 0.09, -0.26);
    } else if (kind === 2) {
      add(new THREE.CylinderGeometry(0.15, 0.15, 0.3, 12), 0x26262a, 0, 0.4, 0);
      add(new THREE.CylinderGeometry(0.27, 0.27, 0.025, 14), 0x26262a, 0, 0.24, 0);
      add(new THREE.CylinderGeometry(0.152, 0.152, 0.06, 12), 0x8a8a8e, 0, 0.3, 0);
    } else if (kind === 3) {
      add(new THREE.ConeGeometry(0.15, 0.36, 10), 0xe4e4e6, 0, 0.42, 0);
      add(new THREE.SphereGeometry(0.045, 8, 6), 0x9a9ca0, 0, 0.62, 0);
    } else if (kind === 4) {
      add(new THREE.CylinderGeometry(0.18, 0.2, 0.16, 8), 0xcfd0d4, 0, 0.3, 0);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(new THREE.ConeGeometry(0.045, 0.14, 4), 0xcfd0d4, Math.cos(a) * 0.17, 0.43, Math.sin(a) * 0.17);
      }
    } else {
      const band = add(new THREE.TorusGeometry(0.24, 0.025, 6, 16, Math.PI), 0x44464a, 0, 0.04, 0);
      band.rotation.z = 0;
      for (const side of [-1, 1]) add(new THREE.CylinderGeometry(0.08, 0.08, 0.07, 10), 0x77797e, side * 0.24, 0.04, 0).rotation.z = Math.PI / 2;
    }
    return g;
  };
  const setLook = (look: Look | null) => {
    const c = look && look.c >= 0 && look.c < LOOK_COLORS.length ? new THREE.Color(LOOK_COLORS[look.c].hex) : baseShade;
    clayColor.copy(c);
    armor.color.copy(c);
    armor.emissive.copy(c);
    blank.copy(c);
    jointM.color.copy(c).multiplyScalar(0.78);
    jointM.emissive.copy(jointM.color);
    if (!faceMat.map) faceMat.color.copy(c);
    if (hat) {
      head.remove(hat);
      hat.traverse((o) => ((o as THREE.Mesh).geometry?.dispose?.(), ((o as THREE.Mesh).material as THREE.Material | undefined)?.dispose?.()));
      hat = null;
    }
    const kind = look && look.h >= 0 && look.h < HATS.length ? look.h : 0;
    hat = makeHat(kind);
    if (hat) {
      hat.scale.setScalar(0.62); // the hats are modelled for a bigger head
      hat.position.y = -0.09;
      head.add(hat);
    }
  };

  // ----- face photo -----
  let faceTex: THREE.Texture | null = null;
  let faceRequest = 0;
  const setFace = (url: string | null) => {
    faceRequest++;
    const mine = faceRequest;
    faceTex?.dispose();
    faceTex = null;
    faceMat.map = null;
    faceMat.color.copy(blank);
    faceMat.needsUpdate = true;
    screenPlane.visible = false;
    if (!url || !validAvatar(url)) return; // photos from other players are untrusted: re-validate
    new THREE.TextureLoader().load(
      url,
      (t) => {
        if (mine !== faceRequest) {
          t.dispose(); // replaced or cleared while it was loading
          return;
        }
        t.magFilter = THREE.NearestFilter; // keep the 32x32 photo crisp and chunky
        t.minFilter = THREE.NearestFilter;
        t.generateMipmaps = false;
        t.colorSpace = THREE.SRGBColorSpace;
        faceTex = t;
        faceMat.map = t;
        faceMat.color.set(0xffffff);
        faceMat.needsUpdate = true;
        screenPlane.visible = true;
      },
      undefined,
      () => {
        /* undecodable image: keep the default screen */
      },
    );
  };

  // ----- procedural animation -----
  const P = {
    phase: 0,
    legL: 0,
    legR: 0,
    kneeL: 0,
    kneeR: 0,
    armL: 0,
    armR: 0,
    elbow: 0.2,
    lean: 0,
    twist: 0,
    tilt: 0,
    bob: 0,
  };
  const lerp = (cur: number, target: number, k: number) => cur + (target - cur) * k;

  const animate = (a: AnimState, dt: number, t: number) => {
    const k = 1 - Math.exp(-9 * dt);
    const run = Math.min(1, a.speed / 9);
    const mv = Math.min(1, Math.max(0, (a.speed - 0.3) / 1.7)); // 0 idle .. 1 moving, no pop between them
    const moving = a.speed > 0.6;
    const walking = a.grounded && moving && !a.sliding && !a.hanging && !a.mantle;
    if (walking) P.phase += dt * (4.2 + a.speed * 0.95);
    const sw = Math.sin(P.phase);

    let legL = 0;
    let legR = 0;
    let kneeL = 0;
    let kneeR = 0;
    let armL = 0;
    let armR = 0;
    let elbow = 0.2;
    let lean = 0;
    let twist = 0;
    let tilt = 0;
    let bob = 0;

    if (a.hanging) {
      // hands on the ledge, body dangling
      armL = armR = 3.0;
      elbow = 0.1;
      legL = 0.15 + Math.sin(t * 2) * 0.08;
      legR = -0.05 + Math.sin(t * 2 + 1) * 0.06;
      kneeL = -0.3;
      kneeR = -0.2;
    } else if (a.mantle) {
      // pushing up and scrambling over
      armL = armR = 1.0;
      elbow = 1.0;
      legL = 1.15;
      legR = 0.35;
      kneeL = -1.3;
      kneeR = -0.8;
      lean = -0.5;
    } else if (a.sliding) {
      // leaning back with the legs out in front
      legL = 1.5;
      legR = 1.3;
      kneeL = -0.15;
      kneeR = -0.1;
      armL = -0.9;
      armR = -0.6;
      elbow = 0.3;
      lean = 0.55;
    } else if (!a.grounded) {
      if (a.vy > 0.5) {
        // rising: knees up, arms thrown up
        legL = 0.9;
        legR = 0.15;
        kneeL = -1.4;
        kneeR = -0.5;
        armL = armR = 2.2;
        elbow = 0.4;
        lean = -0.12;
      } else {
        // falling: legs reaching for the ground, arms out
        legL = 0.4;
        legR = -0.1;
        kneeL = -0.3;
        kneeR = -0.15;
        armL = armR = 1.2;
        elbow = 0.2;
        lean = -0.05;
      }
    } else if (a.crouch) {
      const amp = 0.25 * Math.min(1, a.speed / 3);
      legL = 1.1 + sw * amp;
      legR = 1.1 - sw * amp;
      kneeL = -1.9;
      kneeR = -1.9;
      armL = 0.5;
      armR = 0.5;
      elbow = 0.9;
      lean = -0.45;
    } else {
      // walking, running or standing: one continuous blend, so starting and stopping never pops
      const amp = (0.18 + 0.75 * run) * mv;
      legL = sw * amp;
      legR = -sw * amp;
      kneeL = -Math.max(0, Math.sin(P.phase + 1.2)) * amp * 1.2;
      kneeR = -Math.max(0, Math.sin(P.phase + 1.2 + Math.PI)) * amp * 1.2;
      const idleArm = Math.sin(t * 1.3 + phase0) * 0.05 * (1 - mv);
      armL = -sw * amp * 0.95 + idleArm;
      armR = sw * amp * 0.95 - idleArm;
      elbow = 0.2 + (0.05 + run * 0.9) * mv;
      lean = (-0.1 - 0.25 * run) * mv + Math.sin(t * 1.1 + phase0) * 0.02 * (1 - mv);
      twist = sw * 0.14 * run * mv;
      tilt = sw * 0.06 * run * mv;
      bob = Math.abs(sw) * 0.045 * run * mv;
    }

    P.legL = lerp(P.legL, legL, k);
    P.legR = lerp(P.legR, legR, k);
    P.kneeL = lerp(P.kneeL, kneeL, k);
    P.kneeR = lerp(P.kneeR, kneeR, k);
    P.armL = lerp(P.armL, armL, k);
    P.armR = lerp(P.armR, armR, k);
    P.elbow = lerp(P.elbow, elbow, k);
    P.lean = lerp(P.lean, lean, k);
    P.twist = lerp(P.twist, twist, k);
    P.tilt = lerp(P.tilt, tilt, k);
    P.bob = lerp(P.bob, bob, k);

    // carrying something: both arms out in front, elbows bent, and a steadier body
    if (a.carrying && !a.hanging && !a.mantle && !a.sliding) {
      P.armL = lerp(P.armL, 1.15, 0.5);
      P.armR = lerp(P.armR, 1.15, 0.5);
      P.elbow = lerp(P.elbow, 1.0, 0.5);
    }

    // knocked down: the whole body topples and the limbs go limp and flail
    const rag = a.ragdoll ?? 0;
    if (rag > 0.01) {
      const sevF = a.ragSev ?? 0.5;
      const flail = Math.sin(t * (7 + 6 * sevF) + phase0) * (0.5 + 0.8 * sevF);
      P.legL = lerp(P.legL, 0.9 + flail, rag);
      P.legR = lerp(P.legR, -0.7 - flail, rag);
      P.kneeL = lerp(P.kneeL, -1.1 - flail * 0.3, rag);
      P.kneeR = lerp(P.kneeR, -0.5 + flail * 0.3, rag);
      P.armL = lerp(P.armL, 2.6 + flail, rag);
      P.armR = lerp(P.armR, 2.1 - flail, rag);
      P.elbow = lerp(P.elbow, 0.5 + Math.abs(flail) * 0.5, rag);
    }
    // the tumble: pitched over in the direction of the blow, twisting and rolling harder the harder it was
    const sev = a.ragSev ?? 0.5;
    const fall = a.ragFall ?? -1;
    root.rotation.x = fall * rag * 1.5 + fall * Math.sin(t * 6) * 0.08 * rag;
    root.rotation.y = (a.ragSpin ?? 0) * rag;
    root.rotation.z = Math.sin(t * 3.1 + phase0) * 0.35 * sev * rag;
    root.position.y = rag * 0.2;

    // extra articulation: ankles roll through the step, toes lift off, wrists relax, fingers curl
    const swingL = P.legL;
    const swingR = P.legR;
    legs[0].ankle.rotation.x = Math.max(-0.5, Math.min(0.5, -swingL * 0.35 - P.kneeL * 0.25));
    legs[1].ankle.rotation.x = Math.max(-0.5, Math.min(0.5, -swingR * 0.35 - P.kneeR * 0.25));
    legs[0].toe.rotation.x = Math.max(0, -swingL) * 0.7;
    legs[1].toe.rotation.x = Math.max(0, -swingR) * 0.7;
    const curl = a.carrying ? 1.15 : 0.32 + run * 0.5;
    for (let ai = 0; ai < 2; ai++) {
      const arm = arms[ai];
      arm.wrist.rotation.x = -(ai === 0 ? P.armL : P.armR) * 0.12 - 0.08;
      arm.fingers.forEach((f, fi) => {
        f.rotation.x = lerp(f.rotation.x, curl * (fi % 2 ? 1.05 : 0.85) + (Math.floor(fi / 2) % 2) * 0.06, 0.2);
      });
    }
    // the ribcage twists against the hips, and the head stays level as the body leans
    chestG.rotation.y = P.twist * 0.6;
    neckG.rotation.x = -P.lean * 0.5 + Math.sin(t * 0.7 + phase0) * 0.02;
    head.rotation.y = -P.twist * 0.5 + Math.sin(t * 0.45 + phase0) * 0.05;

    legs[0].hip.rotation.x = P.legL;
    legs[1].hip.rotation.x = P.legR;
    legs[0].knee.rotation.x = P.kneeL;
    legs[1].knee.rotation.x = P.kneeR;
    arms[0].shoulder.rotation.x = P.armL;
    arms[1].shoulder.rotation.x = P.armR;
    arms[0].shoulder.rotation.z = 0.12; // a slight outward hang
    arms[1].shoulder.rotation.z = -0.12;
    arms[0].elbow.rotation.x = P.elbow;
    arms[1].elbow.rotation.x = P.elbow;
    torsoG.rotation.x = P.lean;
    torsoG.rotation.y = P.twist * 0.4;
    torsoG.rotation.z = P.tilt;
    torsoG.scale.y = 1 + Math.sin(t * 2.2 + phase0) * 0.012; // breathing
    body.position.y = P.bob;
  };

  return {
    group: root,
    head,
    shirt: armor,
    height: (headY + crestTop) * s,
    setHue() {
      /* the figures are colourless: nothing to tint */
    },
    setFace,
    setLook,
    animate,
  };
}

/** Little puffs of dust and sparks: one pooled point cloud, so effects cost almost nothing. */
class Puffs {
  private readonly N = 160;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private head = 0;
  private geo = new THREE.BufferGeometry();
  readonly points: THREE.Points;

  constructor() {
    this.pos = new Float32Array(this.N * 3).fill(0);
    this.col = new Float32Array(this.N * 3).fill(0);
    this.vel = new Float32Array(this.N * 3);
    this.life = new Float32Array(this.N);
    this.max = new Float32Array(this.N).fill(1);
    for (let i = 0; i < this.N; i++) this.pos[i * 3 + 1] = -999; // parked below the world
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(
      this.geo,
      new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.points.frustumCulled = false;
  }

  /** `speed` is the sideways burst, `lift` the upward one. */
  emit(x: number, y: number, z: number, count: number, color: number, speed = 1.5, lift = 1.2) {
    const c = new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const i = this.head;
      this.head = (this.head + 1) % this.N;
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = Math.cos(a) * sp;
      this.vel[i * 3 + 1] = lift * (0.4 + Math.random());
      this.vel[i * 3 + 2] = Math.sin(a) * sp;
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
      this.max[i] = this.life[i] = 0.35 + Math.random() * 0.4;
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -999;
        continue;
      }
      this.vel[i * 3 + 1] -= 6 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = this.life[i] / this.max[i]; // fade by dimming towards the background
      this.col[i * 3] *= 1 - dt * 1.5 * (1 - f);
      this.col[i * 3 + 1] *= 1 - dt * 1.5 * (1 - f);
      this.col[i * 3 + 2] *= 1 - dt * 1.5 * (1 - f);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

/** A pick-up-able object, sitting with its base at y = 0 and about 0.4 m across. */
function makeItem(kind: ItemKind): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, flat(color));
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  if (kind === 'ball') {
    add(new THREE.IcosahedronGeometry(0.22, 1), 0xff5a4a, 0, 0.22);
    add(new THREE.TorusGeometry(0.221, 0.03, 5, 14), 0xffffff, 0, 0.22).rotation.x = Math.PI / 2;
  } else if (kind === 'basketball') {
    add(new THREE.IcosahedronGeometry(0.2, 1), 0xe06a1c, 0, 0.2);
    for (const rot of [0, Math.PI / 2]) {
      const seam = add(new THREE.TorusGeometry(0.201, 0.008, 4, 18), 0x1a1208, 0, 0.2);
      seam.rotation.y = rot;
    }
    add(new THREE.TorusGeometry(0.201, 0.008, 4, 18), 0x1a1208, 0, 0.2).rotation.x = Math.PI / 2;
  } else if (kind === 'crate') {
    add(new THREE.BoxGeometry(0.4, 0.4, 0.4), 0xb98648, 0, 0.2);
    add(new THREE.BoxGeometry(0.42, 0.06, 0.42), 0x8a5e2c, 0, 0.2);
  } else if (kind === 'cone') {
    add(new THREE.ConeGeometry(0.17, 0.46, 8), 0xff8a1e, 0, 0.27);
    add(new THREE.BoxGeometry(0.4, 0.05, 0.4), 0xff8a1e, 0, 0.025);
    add(new THREE.CylinderGeometry(0.1, 0.12, 0.08, 8), 0xffffff, 0, 0.2);
  } else if (kind === 'duck') {
    add(new THREE.SphereGeometry(0.2, 10, 8), 0xffd92e, 0, 0.2).scale.set(1, 0.85, 1.25);
    add(new THREE.SphereGeometry(0.12, 10, 8), 0xffd92e, 0, 0.44, -0.1);
    add(new THREE.BoxGeometry(0.1, 0.04, 0.1), 0xff8a1e, 0, 0.43, -0.22);
  } else {
    add(new THREE.SphereGeometry(0.2, 10, 8), 0x4ab0ff, 0, 0.22).scale.set(0.7, 0.9, 1.5);
    add(new THREE.ConeGeometry(0.12, 0.22, 4), 0x2f86d6, 0, 0.22, 0.34).rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(0.03, 0.14, 0.12), 0x2f86d6, 0, 0.42, 0);
  }
  return g;
}

const RAGDOLL_BASE = 1.8; // seconds on the floor after the hardest hit adds up to 1.4 more
/** 0..1 over the fall, the stay on the ground, and the getting up. */
const ragdollAmount = (left: number, dur: number) => {
  if (left <= 0 || dur <= 0) return 0;
  const elapsed = dur - left;
  const down = Math.min(1, elapsed / 0.14);
  const up = Math.min(1, left / 0.6);
  return Math.max(0, Math.min(down, up));
};

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
  private lastX: number;
  private lastY: number;
  private lastZ: number;
  private speed = 0; // smoothed, derived from how far they actually move
  private vy = 0;
  private ragdollLeft = 0;
  private ragdollDur = 0;
  private ragSev = 0.5;
  private ragFall = -1;
  private ragSpinTo = 0;
  carrying = false;
  stepAccum = 0; // metres this player has walked since their last audible footstep

  constructor(p: PlayerState) {
    const ch = makeCharacter(p.id);
    this.character = ch;
    this.nameHeight = ch.height + 0.3;
    this.body = ch.shirt;
    if (p.avatar) ch.setFace(p.avatar);
    if (p.look) ch.setLook(p.look);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.2, 0.8), new THREE.MeshBasicMaterial());
    hit.visible = false;
    hit.position.y = 1.1;
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
    this.lastX = p.x;
    this.lastY = p.y ?? 0;
    this.lastZ = p.z;
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

  setLook(look: Look | null) {
    this.character.setLook(look);
  }

  /** Knocked down by a thrown item: tumble for a couple of seconds. */
  ragdoll(vx = 0, vz = 0, sev = 0.5) {
    this.ragSev = sev;
    this.ragdollDur = this.ragdollLeft = RAGDOLL_BASE + 1.4 * sev;
    // blow from the front: fall backwards. From behind: fall forwards.
    const fx = -Math.sin(this.group.rotation.y);
    const fz = -Math.cos(this.group.rotation.y);
    this.ragFall = vx * fx + vz * fz < 0 ? -1 : 1;
    this.ragSpinTo = (Math.random() < 0.5 ? -1 : 1) * (0.6 + 1.6 * sev);
  }

  update(dt: number, t: number) {
    const k = 1 - Math.exp(-22 * dt); // 30 Hz updates: follow them tightly but still smoothly
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

    // what are they doing? Work it out from how they actually moved.
    if (dt > 0) {
      const sp = Math.hypot(g.position.x - this.lastX, g.position.z - this.lastZ) / dt;
      const vy = (g.position.y - this.lastY) / dt;
      this.speed += (sp - this.speed) * (1 - Math.exp(-10 * dt));
      this.vy += (vy - this.vy) * (1 - Math.exp(-10 * dt));
    }
    this.lastX = g.position.x;
    this.lastY = g.position.y;
    this.lastZ = g.position.z;
    const airborne = Math.abs(this.vy) > 1.6;
    this.character.animate(
      {
        speed: this.speed,
        grounded: !airborne,
        vy: this.vy,
        crouch: this.crouch,
        sliding: this.crouch && this.speed > 3.6, // crouched but moving fast is a slide
        hanging: false,
        mantle: false,
        ragdoll: ragdollAmount(this.ragdollLeft, this.ragdollDur),
        ragFall: this.ragFall,
        ragSpin: this.ragSpinTo,
        ragSev: this.ragSev,
        carrying: this.carrying,
      },
      dt,
      t,
    );
    this.ragdollLeft = Math.max(0, this.ragdollLeft - dt);
  }

  dispose() {
    this.character.setFace(null); // frees the photo texture
    this.group.traverse((o) => {
      const m = o as THREE.Mesh | THREE.Sprite;
      (m as THREE.Mesh).geometry?.dispose?.();
      // some meshes may carry several materials
      const mats = ([] as (THREE.Material | undefined)[]).concat(m.material as THREE.Material | THREE.Material[] | undefined);
      for (const mat of mats) {
        // textures are shared across players: only the photo is freed (by setFace above)
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
  // 0 = first person, 1 = over the shoulder (the default), 2 = in front of you (T cycles)
  viewMode: 0 | 1 | 2 = 1;
  crouching = false;
  inputEnabled = true;
  /** On a phone: no pointer lock, and the on-screen controls feed these. */
  touchMode = false;
  touchF = 0; // -1..1
  touchS = 0;
  touchSprint = false;
  lookSensitivity = 1; // multiplier on mouse look; 1 = the original feel
  onFrame?: (dt: number) => void;
  onShove?: (id: number, vx: number, vz: number) => void; // you ran into a loose item
  private shoveAt = new Map<number, number>();
  onSentHome?: () => void; // fired when you drift past the swim limit and are returned to the centre
  onSound?: (e: SoundEvent) => void;

  private keys = new Set<string>();
  private last = performance.now();
  private clock = 0;
  private sim = newSim(0, 0); // the movement controller's state (see shared/movement.ts)
  private prevJump = false;
  private prevCrouch = false;
  private prevGrab = false;
  private orbitAngle = Math.random() * Math.PI * 2;
  private tpBlend = 1; // 0 = camera at the head, 1 = pulled back (the default is third person)
  private frontBlend = 0; // 0 = camera behind you, 1 = camera in front, facing you
  private camFrac = 1; // how much of the pull-back distance is clear of walls
  private selfThird = new THREE.Group(); // our full character, shown while the camera is pulled back
  private selfBody = new THREE.Group(); // the same character, minus head, seen when looking down
  private selfChars: Character[] = [];
  private selfAvatar: string | null = null;
  private ray = new THREE.Raycaster();
  private centre = new THREE.Vector2(0, 0);
  private water?: Water;
  private clouds?: THREE.Group;
  /** The bright bar on the nearest ledge you can climb onto; it pulses gently so it reads at a glance. */
  private ledgeHint?: THREE.Mesh;
  private ledgeMat = new THREE.MeshBasicMaterial({ color: 0xd6ff3a });
  private items = new Map<number, { state: ItemState; group: THREE.Group; flight?: { path: [number, number, number][]; t: number; by?: string; checked?: number; scored?: boolean; sChecked?: number }; changedAt: number }>();
  private selfId = '';
  private selfLook: Look | null = null;
  private puffs = new Puffs();
  private ragdollT = 0; // seconds of being knocked down left
  private ragdollDur = 0;
  private ragSev = 0.5;
  private ragFall = -1;
  private ragSpin = 0;
  onScore?: (by: string) => void; // a shot went through the hoop
  private hoopFlash = 0;
  private rimMat?: THREE.MeshBasicMaterial;
  onHit?: (vx: number, vz: number, sev: number) => void; // a hard throw hit you
  // throw aiming: R zooms the camera in over the shoulder, holding the mouse charges the power
  aiming = false;
  /** Extra elevation (radians) added to where you look; the scroll wheel changes it while aiming. */
  throwAngle = 0.2;
  charging = false;
  charge = 0; // 0..1
  private aimBlend = 0;
  private arc?: THREE.Line;
  private arcEnd?: THREE.Mesh;
  private ripples?: Ripples;
  private rippleTimer = 0;
  private stepAccum = 0; // metres walked since the last footstep

  // camera feel
  private baseFov = DEFAULT_FOV;
  private fovKick = 0;
  private bobPhase = 0;
  private roll = 0;
  private dip = 0; // a downward jolt on hard landings
  private moveSide = 0; // -1..1, for the strafe lean

  // internal render resolution: height in pixels, scaled up with hard pixels. >= 1080 = native.
  private renderHeight = DEFAULT_RENDER_HEIGHT;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(1);
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
    this.water = makeWater(this.scene, tex().glints);
    this.ripples = new Ripples(this.scene);
    this.buildIsland();
    this.scene.add(this.puffs.points);
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
      if (this.touchMode || document.pointerLockElement !== this.canvas || !this.inputEnabled) return;
      const k = 0.0022 * this.lookSensitivity;
      this.yaw -= e.movementX * k;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * k));
    });

    this.renderer.setAnimationLoop(this.tick);
  }

  /** Turn the camera by a touch drag (pixels). */
  look(dx: number, dy: number) {
    if (!this.inputEnabled) return;
    const k = 0.0042 * this.lookSensitivity;
    this.yaw -= dx * k;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * k));
  }

  /** Hold or release a key from the on-screen buttons. */
  setKey(code: string, down: boolean) {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
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

  /** Over the shoulder -> in front of you -> first person -> over the shoulder. */
  cycleView() {
    this.viewMode = ({ 1: 2, 2: 0, 0: 1 } as const)[this.viewMode];
  }

  setFov(deg: number) {
    this.baseFov = deg;
  }

  /** Internal resolution (pixels tall). The picture is scaled to the window with hard pixels; 1080+ is native. */
  setRenderHeight(h: number) {
    this.renderHeight = h;
    this.resize();
  }

  /** Your own photo on your own face. */
  setSelfAvatar(url: string | null) {
    this.selfAvatar = url;
    for (const c of this.selfChars) c.setFace(url);
  }

  setPlayerAvatar(id: string, url: string | null) {
    this.avatars.get(id)?.setAvatar(url);
  }

  /** Colour and build our own body like the character other players see us as. */
  setSelfId(id: string) {
    this.selfId = id;
    this.rebuildSelf(id); // your colour AND your build come from your id, like everyone else's
  }

  /** Id of the player under the crosshair within `maxDist` metres, if any. Call after render. */
  playerUnderCrosshair(maxDist: number): string | null {
    this.ray.setFromCamera(this.centre, this.camera);
    this.ray.far = maxDist;
    const hits = this.ray.intersectObjects([...this.avatars.values()].map((a) => a.hit), false);
    return hits.length ? (hits[0].object.userData.id as string) : null;
  }

  /** A grass arena on a sandy island in a bright sea, with palms, rocks and a ring of buoys. */
  private buildIsland() {
    const R = MAP_RADIUS;
    const rnd = seeded(1337);
    const t = tex();

    t.grass.repeat.set((R * 2) / 6, (R * 2) / 6); // one texture = 6 m, so each big square is 3 m
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 40), textured(t.grass));
    floor.rotation.x = -Math.PI / 2;

    const rim = new THREE.Mesh(new THREE.RingGeometry(R - 0.45, R, 40), new THREE.MeshBasicMaterial({ color: 0xfff6c0 }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.01;

    t.sand.repeat.set(((R + 7) * 2) / 5, ((R + 7) * 2) / 5);
    const beach = new THREE.Mesh(new THREE.RingGeometry(R, R + 7, 40), textured(t.sand));
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

    // Palms along the beach (and their trunks are solid: see SCENERY in shared/obstacles.ts).
    const trunkMat = textured(t.bark);
    const leafMat = textured(t.leaf, 0xffffff, { side: THREE.DoubleSide });
    for (const p of SCENERY.palms) {
      const palm = makePalm(rnd, trunkMat, leafMat);
      palm.position.set(p.x, 0, p.z);
      this.scene.add(palm);
    }

    // The basketball hoop: the pole and backboard are blocks (shared/obstacles.ts); the rim and net are here.
    this.rimMat = new THREE.MeshBasicMaterial({ color: 0xff5a1f });
    const hoopRim = new THREE.Mesh(new THREE.TorusGeometry(HOOP.rimR, 0.022, 6, 24), this.rimMat);
    hoopRim.rotation.x = Math.PI / 2;
    hoopRim.position.set(HOOP.x, HOOP.rimY, HOOP.z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(HOOP.boardX - HOOP.x - HOOP.rimR + 0.02, 0.04, 0.05), this.rimMat);
    arm.position.set((HOOP.x + HOOP.rimR + HOOP.boardX) / 2 - 0.02, HOOP.rimY, HOOP.z);
    const net = new THREE.Mesh(
      new THREE.CylinderGeometry(HOOP.rimR, HOOP.rimR * 0.55, 0.38, 12, 3, true),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }),
    );
    net.position.set(HOOP.x, HOOP.rimY - 0.19, HOOP.z);
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.95, 1.25), flat(0xffffff));
    face.position.set(HOOP.boardX - 0.055, 2.9 + 0.55, HOOP.z);
    const square = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.36, 0.52), flat(0xd8452e));
    square.position.set(HOOP.boardX - 0.058, 2.9 + 0.4, HOOP.z);
    this.scene.add(hoopRim, arm, net, face, square);

    // Rocks on the beach and out in the shallows, also solid.
    const rockMat = textured(t.rock);
    for (const r of SCENERY.rocks) {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(r.size, 0), rockMat);
      rock.position.set(r.x, r.size * 0.25 - 0.3, r.z);
      rock.scale.y = 0.65;
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      this.scene.add(rock);
    }
  }

  /** Crates, walls, steps, beams and the parkour course, all from shared/obstacles.ts. */
  private buildObstacles() {
    const t = tex();
    // texture and how many metres one repeat covers, per kind
    const look: Record<Block['kind'], { map: THREE.Texture; tile: number }> = {
      crate: { map: t.crate, tile: 1 },
      wall: { map: t.concrete, tile: 3 },
      step: { map: t.hazard, tile: 1.5 },
      platform: { map: t.orangeMetal, tile: 2 },
      beam: { map: t.barrier, tile: 1 },
      pillar: { map: t.steel, tile: 2 },
      goal: { map: t.goal, tile: 2 },
      tree: { map: t.bark, tile: 1 }, // drawn as palms and rocks by buildIsland; only the collision lives here
      rock: { map: t.rock, tile: 1 },
    };
    const mats = new Map<THREE.Texture, THREE.Material>();
    for (const k of OBSTACLES) {
      if (k.kind === 'tree' || k.kind === 'rock') continue;
      const { map, tile } = look[k.kind];
      let mat = mats.get(map);
      if (!mat) {
        mat = textured(map);
        mats.set(map, mat);
      }
      const mesh = new THREE.Mesh(T.worldBox(k.w, k.h, k.d, tile), mat);
      mesh.position.set(k.x, k.y0 + k.h / 2, k.z);
      this.scene.add(mesh);
    }
    // One bright bar, moved each frame onto the nearest climbable edge (see updateLedgeHint).
    this.ledgeHint = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.ledgeMat);
    this.ledgeHint.visible = false;
    this.scene.add(this.ledgeHint);
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
   * down; in third person the full character is shown.
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
    for (const c of this.selfChars) {
      c.setFace(this.selfAvatar);
      c.setLook(this.selfLook);
    }
  }

  setSelfLook(look: Look | null) {
    this.selfLook = look;
    for (const c of this.selfChars) c.setLook(look);
  }

  setPlayerLook(id: string, look: Look | null) {
    this.avatars.get(id)?.setLook(look);
  }

  /** Someone else got hit: tumble them. */
  ragdollPlayer(id: string, vx = 0, vz = 0, sev = 0.5) {
    const a = this.avatars.get(id);
    if (!a) return;
    a.ragdoll(vx, vz, sev);
    this.puffs.emit(a.group.position.x, a.group.position.y + 1.2, a.group.position.z, 14, 0xffe27a, 2.6, 2.2);
    const d = Math.hypot(a.group.position.x - this.pos.x, a.group.position.z - this.pos.z);
    if (d < 25) this.onSound?.({ kind: 'hit' });
  }

  /**
   * You were hit by a thrown item moving at `speed` m/s. A light tap just nudges you; a hard hit
   * launches you, spins you and puts you on the floor for a few seconds.
   */
  private knockDown(vx: number, vz: number, speed: number) {
    const s = this.sim;
    const len = Math.max(1e-3, Math.hypot(vx, vz));
    const dx = vx / len;
    const dz = vz / len;
    if (speed < 9) {
      // a soft hit: slide a little and carry on
      s.vx += dx * 2.4;
      s.vz += dz * 2.4;
      this.onSound?.({ kind: 'hit' });
      this.puffs.emit(this.pos.x, this.feetY + 1.2, this.pos.z, 4, 0xffffff, 1.2, 1);
      return;
    }
    const sev = Math.max(0, Math.min(1, (speed - 9) / 11));
    this.cancelAim();
    this.ragSev = sev;
    this.ragdollDur = this.ragdollT = RAGDOLL_BASE + 1.4 * sev;
    // blow from the front: fall backwards. From behind: fall forwards.
    this.ragFall = dx * -Math.sin(this.yaw) + dz * -Math.cos(this.yaw) < 0 ? -1 : 1;
    this.ragSpin = (Math.random() < 0.5 ? -1 : 1) * (0.6 + 1.6 * sev);
    const kick = 6 + 8 * sev;
    s.vx = dx * kick;
    s.vz = dz * kick;
    s.vy = 3.5 + 3.5 * sev; // thrown into the air, not just pushed
    s.onGround = false;
    s.ragdoll = true;
    s.sliding = false;
    s.hanging = false;
    this.onSound?.({ kind: 'hit' });
    this.puffs.emit(this.pos.x, this.feetY + 1.2, this.pos.z, 10 + Math.round(14 * sev), 0xffffff, 2.6 + 2 * sev, 2.2);
    this.onHit?.(s.vx, s.vz, sev);
  }

  // ---- items you can pick up ----

  setItems(list: ItemState[]) {
    for (const it of list) this.setItem(it);
  }

  setItem(state: ItemState, fly?: Flight, by?: string) {
    let it = this.items.get(state.id);
    if (!it) {
      const group = makeItem(state.kind);
      group.position.set(state.x, state.y, state.z);
      group.traverse((o) => (o.userData.itemId = state.id));
      this.scene.add(group);
      it = { state, group, changedAt: performance.now() };
      this.items.set(state.id, it);
    }
    const before = it.state.holder;
    it.state = state;
    it.changedAt = performance.now();
    it.flight = fly ? { path: throwPath(fly), t: 0, by } : undefined;
    // sounds and a puff for what you did yourself
    if (state.holder === this.selfId && before !== this.selfId) this.onSound?.({ kind: 'pickup' });
    else if (before === this.selfId && !state.holder) {
      if (fly) this.onSound?.({ kind: 'throw', power: Math.min(1, Math.hypot(fly[3], fly[5]) / 17) });
      else {
        this.onSound?.({ kind: 'drop' });
        this.puffs.emit(state.x, state.y + 0.05, state.z, 3, 0xe8dcb0, 0.8, 0.5);
      }
    }
  }

  /** The item you are carrying, if any. */
  get holding(): number | null {
    for (const [id, it] of this.items) if (it.state.holder === this.selfId) return id;
    return null;
  }

  /** The nearest loose item within reach, if any. */
  nearestItem(): number | null {
    let best: number | null = null;
    let bestD = REACH;
    for (const [id, it] of this.items) {
      if (it.state.holder || it.flight) continue;
      if (Math.abs(it.state.y - this.feetY) > 2.2) continue;
      const d = Math.hypot(it.state.x - this.pos.x, it.state.z - this.pos.z);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  /** Letting go of an item in mid-air: it just falls from your hands. */
  releaseFlight(): Flight {
    return [this.pos.x, this.feetY + 0.9, this.pos.z, 0, 0, 0];
  }

  /** Start aiming a throw (needs something in your hands). */
  startAim() {
    if (this.holding === null) return;
    this.aiming = true;
    this.charging = false;
    this.charge = 0;
  }

  cancelAim() {
    this.aiming = false;
    this.charging = false;
    this.charge = 0;
  }

  /** Change the throw's elevation with the scroll wheel (radians, clamped). */
  adjustThrowAngle(delta: number) {
    this.throwAngle = Math.max(-0.35, Math.min(1.1, this.throwAngle + delta));
  }

  /** The launch of a throw at `power` (0..1): out of your hands along where you face, raised by the throw angle. */
  throwFlight(power = 0.5): Flight {
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const speed = 5 + 14 * Math.max(0, Math.min(1, power)); // the power sets the speed
    const el = Math.max(-0.6, Math.min(1.4, this.pitch + this.throwAngle));
    const ce = Math.cos(el);
    return [this.pos.x - sy * 0.5, this.feetY + 1.3, this.pos.z - cy * 0.5, -sy * ce * speed, Math.sin(el) * speed, -cy * ce * speed];
  }

  /** Where a dropped item lands: a step in front of you, at your feet. Null in mid-air. */
  dropSpot(): { x: number; y: number; z: number } | null {
    if (!this.sim.onGround) return null;
    return {
      x: this.pos.x - Math.sin(this.yaw) * 0.9,
      y: this.feetY,
      z: this.pos.z - Math.cos(this.yaw) * 0.9,
    };
  }

  private scoreEffect(by: string) {
    this.hoopFlash = 1.4;
    this.onSound?.({ kind: 'score' });
    for (let k = 0; k < 3; k++) this.puffs.emit(HOOP.x, HOOP.rimY - 0.1 + k * 0.25, HOOP.z, 12, [0xffe27a, 0xffffff, 0xff7a3a][k], 2.4, 3);
    this.onScore?.(by);
  }

  /** Highlight only the single nearest edge you could climb onto: the face of the block closest to you. */
  private updateLedgeHint() {
    const bar = this.ledgeHint;
    if (!bar) return;
    const px = this.pos.x;
    const pz = this.pos.z;
    let best: { k: Block; dx: number; dz: number; d: number } | null = null;
    for (const k of OBSTACLES) {
      if (k.kind === 'beam') continue;
      const rise = blockTop(k) - this.feetY;
      if (rise < 0.45 || rise > 2.2) continue; // out of vaulting / grabbing reach
      const cx = Math.max(k.x - k.w / 2, Math.min(k.x + k.w / 2, px));
      const cz = Math.max(k.z - k.d / 2, Math.min(k.z + k.d / 2, pz));
      const dx = px - cx;
      const dz = pz - cz;
      const d = Math.hypot(dx, dz);
      if (d > 6 || d < 1e-6) continue; // too far, or standing on it
      if (!best || d < best.d) best = { k, dx, dz, d };
    }
    if (!best) {
      bar.visible = false;
      return;
    }
    const { k, dx, dz } = best;
    const alongX = Math.abs(dx) < Math.abs(dz); // nearest face is on the z side: the edge runs along x
    const len = alongX ? k.w : k.d;
    const top = blockTop(k) + 0.06;
    bar.visible = true;
    if (alongX) {
      bar.scale.set(len + 0.08, 0.1, 0.1);
      bar.position.set(k.x, top, k.z + Math.sign(dz) * (k.d / 2));
    } else {
      bar.scale.set(0.1, 0.1, len + 0.08);
      bar.position.set(k.x + Math.sign(dx) * (k.w / 2), top, k.z);
    }
  }

  /** While aiming, draw where the throw will go at the power you have charged so far. */
  private updateArc() {
    if (!this.arc) {
      const MAX = 320;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
      geo.setDrawRange(0, 0);
      this.arc = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xd6ff3a, depthTest: false }));
      this.arc.frustumCulled = false;
      this.arc.renderOrder = 10;
      this.arcEnd = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.3, 14), new THREE.MeshBasicMaterial({ color: 0xd6ff3a, depthTest: false, side: THREE.DoubleSide }));
      this.arcEnd.rotation.x = -Math.PI / 2;
      this.arcEnd.renderOrder = 10;
      this.scene.add(this.arc, this.arcEnd);
    }
    const arc = this.arc;
    const end = this.arcEnd!;
    arc.visible = end.visible = this.aiming;
    if (!this.aiming) return;
    const path = throwPath(this.throwFlight(Math.max(0.08, this.charge)));
    const pos = arc.geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = Math.min(path.length, pos.count);
    for (let i = 0; i < n; i++) pos.setXYZ(i, path[i][0], path[i][1], path[i][2]);
    pos.needsUpdate = true;
    arc.geometry.setDrawRange(0, n);
    const last = path[n - 1];
    end.position.set(last[0], last[1] + 0.05, last[2]);
  }

  private updateItems(dt: number) {
    const k = 1 - Math.exp(-18 * dt);
    for (const it of this.items.values()) {
      const { state, group } = it;
      if (it.flight) {
        it.flight.t += dt;
        const i = Math.floor(it.flight.t * 60);
        if (i < it.flight.path.length) {
          const [fx, fy, fz] = it.flight.path[i];
          group.position.set(fx, fy, fz);
          // a thrown item that reaches you knocks you down. Check every sample since the last frame,
          // so a slow frame rate can never let a fast item skip straight through you.
          const by = it.flight.by;
          if (by && by !== this.selfId && this.ragdollT <= 0) {
            const from = Math.max(1, (it.flight.checked ?? 0) + 1);
            for (let j = from; j <= i; j++) {
              const cur = it.flight.path[j];
              const prev = it.flight.path[j - 1];
              const vx = (cur[0] - prev[0]) * 60;
              const vz = (cur[2] - prev[2]) * 60;
              if (
                Math.hypot(vx, vz) > 3 &&
                Math.hypot(cur[0] - this.pos.x, cur[2] - this.pos.z) < 0.75 &&
                cur[1] > this.feetY - 0.25 &&
                cur[1] < this.feetY + 2.0
              ) {
                this.knockDown(vx, vz, Math.hypot(vx, vz));
                break;
              }
            }
            it.flight.checked = i;
          }
          // a ball dropping through the rim scores (once per flight)
          if (!it.flight.scored) {
            for (let j = Math.max(1, (it.flight.sChecked ?? 0) + 1); j <= i; j++) {
              if (throughHoop(it.flight.path[j - 1], it.flight.path[j])) {
                it.flight.scored = true;
                this.scoreEffect(it.flight.by ?? '');
                break;
              }
            }
            it.flight.sChecked = i;
          }
          group.rotation.y += dt * 9;
          continue;
        }
        it.flight = undefined;
        this.puffs.emit(state.x, state.y + 0.05, state.z, 5, 0xe8dcb0, 1.1, 0.8);
      }
      let x = state.x;
      let y = state.y;
      let z = state.z;
      let yaw = group.rotation.y + dt * 0.8; // lying about: a slow turn so it catches the eye
      if (state.holder) {
        // carried in front of the chest
        let hx: number;
        let hz: number;
        let hy: number;
        let ry: number;
        if (state.holder === this.selfId) {
          hx = this.pos.x;
          hz = this.pos.z;
          hy = this.feetY;
          ry = this.yaw;
        } else {
          const a = this.avatars.get(state.holder);
          if (!a) continue;
          hx = a.group.position.x;
          hz = a.group.position.z;
          hy = a.group.position.y;
          ry = a.group.rotation.y;
        }
        x = hx - Math.sin(ry) * 0.55;
        z = hz - Math.cos(ry) * 0.55;
        y = hy + 0.75;
        yaw = ry;
      } else {
        y += Math.sin(this.clock * 2 + state.id) * 0.02;
      }
      group.position.x += (x - group.position.x) * k;
      group.position.y += (y - group.position.y) * k;
      group.position.z += (z - group.position.z) * k;
      group.rotation.y = yaw;
    }
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
    // Render at a reduced internal height and let the browser scale the canvas up with hard pixels.
    const scale = this.renderHeight >= 1080 ? 1 : Math.min(1, this.renderHeight / Math.max(1, h));
    this.renderer.setSize(Math.max(2, Math.round(w * scale)), Math.max(2, Math.round(h * scale)), false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  /**
   * Keys -> inputs for the shared controller (walk, Shift sprint, C crouch / slide, Space jump,
   * hold E to grab a ledge, vault). All of the actual movement rules live in shared/movement.ts.
   */
  private move(dt: number) {
    const k = this.keys;
    const on = this.inputEnabled && this.ragdollT <= 0;
    const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
    const f = on ? clamp1((k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + this.touchF) : 0;
    const side = on ? clamp1((k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + this.touchS) : 0;
    const jump = on && k.has('Space');
    const crouch = on && k.has('KeyC');
    const grab = on && k.has('KeyE');
    const input: Input = {
      f,
      s: side,
      yaw: this.yaw,
      jump,
      jumpPressed: jump && !this.prevJump,
      crouch,
      crouchPressed: crouch && !this.prevCrouch,
      sprint: on && (k.has('ShiftLeft') || k.has('ShiftRight') || this.touchSprint),
      grab,
      grabPressed: grab && !this.prevGrab,
    };
    this.prevJump = jump;
    this.prevCrouch = crouch;
    this.prevGrab = grab;
    this.moveSide = side;

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
    if (!was.ground && s.onGround && was.vy < -4) {
      emit({ kind: 'land', strength: Math.min(1, -was.vy / 14) });
      this.puffs.emit(s.x, s.y + 0.05, s.z, 6 + Math.round(-was.vy), 0xe8dcb0, 1.6, 1.0);
    }
    if (s.sliding && s.onGround && Math.random() < dt * 22) this.puffs.emit(s.x, s.y + 0.05, s.z, 1, 0xe8dcb0, 0.8, 0.8);
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
    // loose items are pushed, not walked through: shove whatever you run into
    const reach = BODY_RADIUS + 0.25;
    const sp = Math.hypot(this.sim.vx, this.sim.vz);
    for (const [id, it] of this.items) {
      if (it.state.holder || it.flight || sp < 0.8) continue; // only when you actually run into it
      if (performance.now() - it.changedAt < 900) continue; // just put down or landed: leave it alone
      const g = it.group.position;
      if (Math.abs(g.y - this.feetY) > 1.2) continue;
      const dx = g.x - p.x;
      const dz = g.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > reach || d < 1e-4) continue;
      const nowMs = performance.now();
      if (nowMs - (this.shoveAt.get(id) ?? 0) < 300) continue;
      this.shoveAt.set(id, nowMs);
      // away from you, with some of your own momentum behind it
      const push = Math.max(2.2, sp * 0.9);
      const toward = (this.sim.vx * dx + this.sim.vz * dz) / Math.max(1e-4, d); // how much you are moving into it
      const along = Math.max(0, toward) / Math.max(1e-4, sp);
      const mix = 0.6 * along;
      this.onShove?.(id, (dx / d) * push * (1 - mix) + this.sim.vx * mix, (dz / d) * push * (1 - mix) + this.sim.vz * mix);
    }
    // ...and while they are being pushed away you cannot stand inside them
    const solid: { x: number; z: number }[] = [];
    for (const it of this.items.values()) {
      if (it.state.holder || it.flight) continue;
      if (Math.abs(it.group.position.y - this.feetY) < 1.0) solid.push(it.group.position);
    }
    const p2 = pushOut(p.x, p.z, solid, BODY_RADIUS + 0.2);
    const q = clampToArena(p2.x, p2.z, SWIM_LIMIT);
    this.pos.x = q.x;
    this.pos.z = q.z;
    this.sim.x = q.x; // players shoving each other must move the controller too
    this.sim.z = q.z;
  }

  /** Is this point inside (or within `m` of) a solid block? Used to keep the camera out of walls. */
  private insideScenery(x: number, y: number, z: number, m: number) {
    for (const k of OBSTACLES) {
      if (y < k.y0 - m || y > k.y0 + k.h + m) continue;
      if (Math.abs(x - k.x) <= k.w / 2 + m && Math.abs(z - k.z) <= k.d / 2 + m) return true;
    }
    return false;
  }

  /** How far along head -> camera (0..1) the view stays clear of scenery. */
  private clearFraction(hx: number, hy: number, hz: number, cx: number, cy: number, cz: number) {
    const steps = 14;
    let clear = 0;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      if (this.insideScenery(hx + (cx - hx) * f, hy + (cy - hy) * f, hz + (cz - hz) * f, 0.28)) break;
      clear = f;
    }
    return clear;
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
    const carriers = new Set<string>();
    for (const it of this.items.values()) if (it.state.holder) carriers.add(it.state.holder);
    for (const [id, a] of this.avatars) {
      a.carrying = carriers.has(id);
    }
    for (const a of this.avatars.values()) {
      const px = a.group.position.x;
      const pz = a.group.position.z;
      a.update(dt, this.clock);
      this.remoteSteps(a, Math.hypot(a.group.position.x - px, a.group.position.z - pz));
    }
    this.puffs.update(dt);
    if (this.hoopFlash > 0) {
      this.hoopFlash = Math.max(0, this.hoopFlash - dt);
      this.rimMat?.color.setHSL(0.07, 1, 0.5 + 0.35 * Math.abs(Math.sin(this.hoopFlash * 14)));
    } else this.rimMat?.color.setHex(0xff5a1f);
    this.collide();
    if (this.aiming && this.holding === null) this.cancelAim(); // dropped it, or it was taken
    if (this.aiming && this.charging) this.charge = Math.min(1, this.charge + dt / 1.1);
    this.aimBlend += ((this.aiming ? 1 : 0) - this.aimBlend) * (1 - Math.exp(-9 * dt));
    this.updateItems(dt);
    this.updateArc();
    this.ledgeMat.color.setHSL(0.19, 1, 0.55 + 0.1 * Math.sin(this.clock * 3));
    this.updateLedgeHint();

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

    // pose our own body
    const sim = this.sim;
    const state: AnimState = {
      speed: Math.hypot(sim.vx, sim.vz),
      grounded: sim.onGround,
      vy: sim.vy,
      crouch: sim.crouching,
      sliding: sim.sliding,
      hanging: sim.hanging,
      mantle: sim.mantle !== null,
      ragdoll: ragdollAmount(this.ragdollT, this.ragdollDur),
      ragFall: this.ragFall,
      ragSpin: this.ragSpin,
      ragSev: this.ragSev,
      carrying: this.holding !== null,
    };
    this.ragdollT = Math.max(0, this.ragdollT - dt);
    if (this.ragdollT <= 0 && sim.ragdoll) sim.ragdoll = false;
    for (const c of this.selfChars) c.animate(state, dt, this.clock);

    this.pos.y = this.feetY + sim.eye;
    const ease = 1 - Math.exp(-7 * dt);
    const wantBack = this.viewMode > 0 || this.aiming || this.ragdollT > 0 ? 1 : 0;
    const wantFront = this.viewMode === 2 && !this.aiming ? 1 : 0;
    this.tpBlend += (wantBack - this.tpBlend) * ease;
    this.frontBlend += (wantFront - this.frontBlend) * ease;
    if (Math.abs(this.tpBlend - wantBack) < 0.001) this.tpBlend = wantBack;
    if (Math.abs(this.frontBlend - wantFront) < 0.001) this.frontBlend = wantFront;

    // ---- camera feel: head bob, strafe lean, slide tilt, sprint FOV kick, landing dip ----
    const speed = state.speed;
    const stepping = sim.onGround && !sim.sliding && !sim.hanging && sim.mantle === null;
    const bobAmt = stepping ? Math.min(1, speed / 7) : 0;
    this.bobPhase += dt * (4 + speed * 0.9) * (stepping ? 1 : 0);
    const bobY = Math.sin(this.bobPhase * 2) * 0.032 * bobAmt;
    const bobX = Math.sin(this.bobPhase) * 0.026 * bobAmt;
    const wantRoll = -this.moveSide * 0.035 * (speed > 1 ? 1 : 0) + (sim.sliding ? 0.09 : 0) + (sim.hanging ? 0 : 0);
    this.roll += (wantRoll - this.roll) * (1 - Math.exp(-9 * dt));
    const wantKick = sim.sliding ? 9 : speed > 6.5 ? 6 : 0;
    this.fovKick += (wantKick - this.fovKick) * (1 - Math.exp(-7 * dt));
    if (sim.landImpact > 0) {
      this.dip = Math.max(this.dip, Math.min(0.3, sim.landImpact * 0.022));
      sim.landImpact = 0;
    }
    this.dip *= Math.exp(-9 * dt);
    const fov = (this.baseFov + this.fovKick) * (1 - 0.3 * this.aimBlend);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    if (this.orbit) {
      this.orbitAngle += dt * 0.06;
      const r = MAP_RADIUS * 0.7;
      this.camera.position.set(Math.cos(this.orbitAngle) * r, 6, Math.sin(this.orbitAngle) * r);
      this.camera.lookAt(0, 5, 0); // slightly down, so the horizon, sun and clouds frame the menu
    } else {
      // Smoothstep so moves start and end gently. The camera orbits the head: pulling back is a
      // change of distance (with a shoulder offset), and going to the front view swings it 180
      // degrees around you (yaw + PI) with the pitch mirrored, so it always looks at you.
      const t = this.tpBlend * this.tpBlend * (3 - 2 * this.tpBlend);
      const f = this.frontBlend * this.frontBlend * (3 - 2 * this.frontBlend);
      const camYaw = this.yaw + Math.PI * f;
      const camPitch = this.pitch * (1 - 2 * f);
      const cp = Math.cos(camPitch);
      const back = SHOULDER_DISTANCE * t * (1 - 0.5 * this.aimBlend);
      const shoulder = SHOULDER_OFFSET * t * (1 - f) * (1 + 0.45 * this.aimBlend);
      const rx = Math.cos(camYaw);
      const rz = -Math.sin(camYaw);
      const hx = this.pos.x;
      const hy = this.pos.y;
      const hz = this.pos.z;
      let cx = hx + Math.sin(camYaw) * cp * back + rx * shoulder;
      let cy = hy - Math.sin(camPitch) * back + SHOULDER_LIFT * t;
      let cz = hz + Math.cos(camYaw) * cp * back + rz * shoulder;

      // keep the camera out of walls: pull it in along the line from the head, smoothly
      const clear = t > 0.02 ? this.clearFraction(hx, hy, hz, cx, cy, cz) : 1;
      this.camFrac += (clear - this.camFrac) * (1 - Math.exp(-(clear < this.camFrac ? 30 : 5) * dt));
      cx = hx + (cx - hx) * this.camFrac;
      cy = hy + (cy - hy) * this.camFrac;
      cz = hz + (cz - hz) * this.camFrac;

      // first-person-only feel
      const fp = 1 - t;
      cy += (bobY - this.dip) * (0.35 + 0.65 * fp);
      cx += rx * bobX * fp;
      cz += rz * bobX * fp;
      this.camera.position.set(cx, Math.max(0.35, cy), cz);
      this.camera.rotation.set(camPitch, camYaw, this.roll * (0.5 + 0.5 * fp));
    }

    // The headless first-person body only while the camera is at the head; the full character
    // takes over as the camera pulls back.
    this.selfBody.visible = !this.orbit && this.tpBlend < 0.02;
    this.selfThird.visible = !this.orbit && this.tpBlend >= 0.02;
    const squash = 0.7 + 0.3 * Math.min(1, Math.max(0, (sim.eye - EYE_CROUCH) / (EYE_HEIGHT - EYE_CROUCH)));
    this.selfThird.position.set(this.pos.x, this.feetY, this.pos.z);
    this.selfThird.rotation.y = this.yaw;
    this.selfThird.scale.y = squash;
    this.selfBody.position.set(this.pos.x, this.feetY, this.pos.z);
    this.selfBody.rotation.y = this.yaw;
    this.selfBody.scale.y = squash;
  }
}
