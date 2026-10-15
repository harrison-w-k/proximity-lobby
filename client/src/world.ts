import * as THREE from 'three';
import { MAP_RADIUS, SWIM_LIMIT, type PlayerState } from '../../shared/protocol';
import { clampToArena, SHORE_RADIUS, waterDepth } from '../../shared/map';
import { BODY_RADIUS, EYE_CROUCH, EYE_STAND, newSim, stepPlayer, type Input } from '../../shared/movement';
import { OBSTACLES, blockTop, type Block } from '../../shared/obstacles';
import { REACH, throwPath, type Flight, type ItemKind, type ItemState } from '../../shared/items';

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
  | { kind: 'splash'; strength: number };

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
}

interface Character {
  group: THREE.Group;
  head: THREE.Group; // hidden in first person so it can't block the view
  shirt: THREE.MeshLambertMaterial; // the armour: its emissive lights up when the player speaks
  setHue(h: number): void;
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
  const clayColor = new THREE.Color().setHSL(hue / 360, 0.5, 0.84);
  // one pale clay material for the whole body, like a shop-window mannequin
  const armor = new THREE.MeshLambertMaterial({ color: clayColor, emissive: clayColor, emissiveIntensity: 0.3 });
  const blank = new THREE.Color(clayColor);
  // faceless unless the player sets a profile photo
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
  const caps = (rad: number, len: number) => new THREE.Mesh(new THREE.CapsuleGeometry(rad, len, 4, 10), armor);
  const ball = (rad: number, sx = 1, sy = 1, sz = 1) => {
    const m = ico(rad, armor, 1);
    m.scale.set(sx, sy, sz);
    return m;
  };

  // pelvis
  body.add(at(ball(0.2, 1.1 * bulk, 0.8, 0.95), 0, 0.7, 0));

  // legs: thigh and shin joined by a ball knee
  const legs: { hip: THREE.Group; knee: THREE.Group }[] = [];
  for (const side of [-1, 1]) {
    const hip = group(side * 0.12 * bulk, 0.7, 0);
    hip.add(ball(0.09));
    hip.add(at(caps(0.09, 0.2), 0, -0.17, 0));
    const knee = group(0, -0.34, 0);
    knee.add(ball(0.075));
    knee.add(at(caps(0.07, 0.2), 0, -0.17, 0));
    const foot = group(0, -0.36, 0);
    foot.add(at(ball(0.08, 1, 0.6, 1.7), 0, 0.0, -0.06));
    knee.add(foot);
    hip.add(knee);
    body.add(hip);
    legs.push({ hip, knee });
  }

  // torso group pivots at the hips so it can lean
  const torsoG = group(0, 0.74, 0);
  const chest = at(caps(0.2 * bulk, 0.3), 0, 0.32, 0);
  chest.scale.set(1.1, 1, 0.8);
  torsoG.add(chest);
  torsoG.add(at(cyl(0.06, 0.08, 0.14, 8, armor), 0, 0.72, 0)); // neck

  // head: a smooth egg with no features
  const head = group(0, 0.92, -0.02);
  head.add(at(ball(0.2, 0.9, 1.1, 1), 0, 0.02, 0));
  // the profile photo, if any, sits on the front of the face
  const screenPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), faceMat);
  screenPlane.rotation.y = Math.PI; // plane faces +z; the character faces -z
  head.add(at(screenPlane, 0, 0.0, -0.185));
  const crestTop = 0.2;
  const eyes: THREE.Group[] = [];
  torsoG.add(head);

  // arms: shoulder, upper arm, ball elbow, forearm, round hand
  const arms: { shoulder: THREE.Group; elbow: THREE.Group }[] = [];
  for (const side of [-1, 1]) {
    const shoulder = group(side * 0.3 * bulk, 0.56, 0);
    shoulder.add(ball(0.085));
    shoulder.add(at(caps(0.065, 0.18), 0, -0.15, 0));
    const elbow = group(0, -0.3, 0);
    elbow.add(ball(0.06));
    elbow.add(at(caps(0.055, 0.17), 0, -0.14, 0));
    elbow.add(at(ball(0.065), 0, -0.3, 0));
    shoulder.add(elbow);
    torsoG.add(shoulder);
    arms.push({ shoulder, elbow });
  }
  body.add(torsoG);
  const tail = group(0, 0.72, 0.2); // (kept so the animation code below has nothing to special-case)

  // Normalise so the head sits at eye height whatever the proportions, so the camera always matches.
  const headY = 0.74 + 0.92;
  const s = 1.62 / headY;
  const root = new THREE.Group();
  body.scale.setScalar(s);
  root.add(body);

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
    torsoG.rotation.y = P.twist;
    torsoG.rotation.z = P.tilt;
    torsoG.scale.y = 1 + Math.sin(t * 2.2 + phase0) * 0.012; // breathing
    body.position.y = P.bob;
  };

  return {
    group: root,
    head,
    shirt: armor,
    height: (headY + crestTop) * s,
    setHue(h: number) {
      clayColor.setHSL(h / 360, 0.5, 0.84);
      blank.copy(clayColor);
      armor.color.copy(clayColor);
      armor.emissive.copy(clayColor);
      if (!faceMat.map) faceMat.color.copy(blank);
    },
    setFace,
    animate,
  };
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
  stepAccum = 0; // metres this player has walked since their last audible footstep

  constructor(p: PlayerState) {
    const ch = makeCharacter(p.id);
    this.character = ch;
    this.nameHeight = ch.height + 0.3;
    this.body = ch.shirt;
    if (p.avatar) ch.setFace(p.avatar);
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

  update(dt: number, t: number) {
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
      },
      dt,
      t,
    );
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
  private items = new Map<number, { state: ItemState; group: THREE.Group; flight?: { path: [number, number, number][]; t: number } }>();
  private selfId = '';
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

    // Palms along the beach. Decoration only: they sit outside the grass arena.
    const trunkMat = textured(t.bark);
    const leafMat = textured(t.leaf, 0xffffff, { side: THREE.DoubleSide });
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2 + (rnd() - 0.5) * 0.25;
      const r = R + 1.8 + rnd() * 3.4;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const palm = makePalm(rnd, trunkMat, leafMat);
      if (nearObstacle(x, z, 2.5)) continue; // keep the parkour course clear of scenery
      palm.position.set(x, 0, z);
      this.scene.add(palm);
    }

    // Rocks on the beach and out in the shallows.
    const rockMat = textured(t.rock);
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
    };
    const mats = new Map<THREE.Texture, THREE.Material>();
    for (const k of OBSTACLES) {
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
    for (const c of this.selfChars) c.setFace(this.selfAvatar);
  }

  // ---- items you can pick up ----

  setItems(list: ItemState[]) {
    for (const it of list) this.setItem(it);
  }

  setItem(state: ItemState, fly?: Flight) {
    let it = this.items.get(state.id);
    if (!it) {
      const group = makeItem(state.kind);
      group.position.set(state.x, state.y, state.z);
      group.traverse((o) => (o.userData.itemId = state.id));
      this.scene.add(group);
      it = { state, group };
      this.items.set(state.id, it);
    }
    it.state = state;
    it.flight = fly ? { path: throwPath(fly), t: 0 } : undefined;
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

  /** The launch of a throw: out of your hands, along where you are facing and a little upward. */
  throwFlight(): Flight {
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const speed = 10;
    const up = 4.5 + Math.sin(this.pitch) * 7;
    return [this.pos.x - sy * 0.5, this.feetY + 1.3, this.pos.z - cy * 0.5, -sy * speed, up, -cy * speed];
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
          group.rotation.y += dt * 9;
          continue;
        }
        it.flight = undefined;
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
    const on = this.inputEnabled;
    const f = on ? (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) : 0;
    const side = on ? (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) : 0;
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
      sprint: on && (k.has('ShiftLeft') || k.has('ShiftRight')),
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
    // loose items are solid too (the ones lying at about your height)
    const loose: { x: number; z: number }[] = [];
    for (const it of this.items.values()) {
      if (it.state.holder || it.flight) continue;
      if (Math.abs(it.group.position.y - this.feetY) < 1.2) loose.push(it.group.position);
    }
    const p2 = pushOut(p.x, p.z, loose, BODY_RADIUS + 0.22);
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
    for (const a of this.avatars.values()) {
      const px = a.group.position.x;
      const pz = a.group.position.z;
      a.update(dt, this.clock);
      this.remoteSteps(a, Math.hypot(a.group.position.x - px, a.group.position.z - pz));
    }
    this.collide();
    this.updateItems(dt);
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
    };
    for (const c of this.selfChars) c.animate(state, dt, this.clock);

    this.pos.y = this.feetY + sim.eye;
    const ease = 1 - Math.exp(-7 * dt);
    const wantBack = this.viewMode > 0 ? 1 : 0;
    const wantFront = this.viewMode === 2 ? 1 : 0;
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
    const fov = this.baseFov + this.fovKick;
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
      const back = SHOULDER_DISTANCE * t;
      const shoulder = SHOULDER_OFFSET * t * (1 - f);
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
