// Procedural low-poly animals. Player animals are articulated (legs, tail and head move);
// horde creatures are merged into a single mesh so hundreds of them stay cheap to draw.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ANIMAL_BY_ID, SIZE } from '../../../shared/arena/animals';
import type { Pose } from './anim';
import type { Paint } from '../../../shared/arena/paint';

export interface RigState {
  speed: number; // m/s along the ground
  attack: number; // 0..1, decays after a strike
  hurt: number; // 0..1, decays after a hit
  stun: boolean;
  flee: boolean;
  swim: boolean;
  t: number; // clock
  turn?: number; // how fast the animal is turning (rad/s): it leans into the corner
  pose?: Pose | null; // an attack or skill animation in progress
  guard?: boolean;
  air?: number; // height above the ground while jumping
  vy?: number; // rising (+) or falling (-)
  warn?: number; // 0..1: this animal is winding up a blow, glow so it can be read
  counter?: boolean;
}

export interface Rig {
  root: THREE.Group;
  height: number; // for nameplates
  radius: number;
  update(dt: number, s: RigState): void;
  setTint(color: number | null): void;
}

// a thin dark hull behind every part: a toon outline that makes the low-poly shapes pop
const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x0b2a2e, side: THREE.BackSide });
const SHADOW_GEO = new THREE.CircleGeometry(1, 20);
const SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

/** Geometries merge only if they are all indexed or all not. */
const flat = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);

type Mat = THREE.MeshLambertMaterial;
const matCache = new Map<number, Mat>();
function mat(color: number): Mat {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    matCache.set(color, m);
  }
  return m;
}

const ICO0 = new THREE.IcosahedronGeometry(1, 0); // 20 triangles: a cut gem
const ICO = new THREE.IcosahedronGeometry(1, 1); // 80 triangles: a lumpy ellipsoid
const CONE = new THREE.ConeGeometry(1, 1, 6);
const CONE5 = new THREE.ConeGeometry(1, 1, 5);
const CONE3 = new THREE.ConeGeometry(1, 1, 3);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 6);
const LEG = new THREE.CylinderGeometry(0.62, 0.38, 1, 5); // tapers toward the paw

function part(geo: THREE.BufferGeometry, color: number, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat(color));
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  return m;
}
/** A faceted chunk sized like a box of w x h x d: used for everything small. */
const box = (w: number, h: number, d: number, c: number, x = 0, y = 0, z = 0) => part(ICO0, c, w * 0.62, h * 0.62, d * 0.62, x, y, z);
/** A lumpy low-poly ellipsoid for torsos and heads. */
const lump = (w: number, h: number, d: number, c: number, x = 0, y = 0, z = 0) => part(ICO, c, w * 0.56, h * 0.56, d * 0.56, x, y, z);
const ball = (rx: number, ry: number, rz: number, c: number, x = 0, y = 0, z = 0) => part(ICO, c, rx, ry, rz, x, y, z);
const cone = (r: number, h: number, c: number, x = 0, y = 0, z = 0) => part(CONE, c, r, h, r, x, y, z);
const cyl = (r: number, h: number, c: number, x = 0, y = 0, z = 0) => part(CYL, c, r, h, r, x, y, z);
/** A cone lying along Z with its tip pointing forward (+1) or backward (-1). */
function spike(r: number, len: number, c: number, dir: 1 | -1, x: number, y: number, z: number, geo = CONE5): THREE.Mesh {
  const m = part(geo, c, r, len, r, x, y, z);
  m.rotation.x = dir * (Math.PI / 2);
  return m;
}

/** Mark a part as taking the accent colour (2 = a darker shade, for paws). */
function acc<T extends THREE.Object3D>(o: T, kind = 1): T {
  o.userData.acc = kind;
  return o;
}

// A tiny deterministic random so each species always looks the same.
function rnd(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface QuadSpec {
  len: number;
  w: number;
  h: number;
  legLen: number;
  legT: number;
  fur: number;
  belly?: number;
  paw?: number;
  head: { s: number; snout: number; snoutH?: number; snoutC?: number; drop?: number; fwd?: number };
  ears?: 'point' | 'round' | 'long' | 'none';
  earS?: number;
  earC?: number;
  tail?: { len: number; t: number; c?: number; up?: number };
  eye?: number;
  crawl?: boolean;
  scale?: number;
  extras?: (torso: THREE.Group, head: THREE.Group, r: () => number) => void;
}

interface Built {
  root: THREE.Group;
  legs: THREE.Group[];
  head: THREE.Group;
  tail: THREE.Group | null;
  torso: THREE.Group;
  eyes: THREE.Object3D[];
  ears: { o: THREE.Object3D; side: number }[];
  hip: number;
  spec: QuadSpec;
}

function buildQuad(spec: QuadSpec, seed: number): Built {
  const r = rnd(seed);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  const hip = spec.legLen;
  torso.position.y = hip + spec.h / 2 - 0.04;
  root.add(torso);
  const belly = spec.belly ?? spec.fur;
  torso.add(lump(spec.w, spec.h, spec.len, spec.fur));
  torso.add(acc(lump(spec.w * 0.94, spec.h * 0.5, spec.len * 0.86, belly, 0, -spec.h * 0.3, 0)));
  // shoulders and haunches a little fuller than the middle
  torso.add(lump(spec.w * 1.04, spec.h * 1.06, spec.len * 0.4, spec.fur, 0, spec.h * 0.04, spec.len * 0.28));
  torso.add(lump(spec.w * 1.06, spec.h * 1.0, spec.len * 0.4, spec.fur, 0, 0, -spec.len * 0.3));

  // head
  const head = new THREE.Group();
  const hs = spec.head.s;
  head.position.set(0, spec.h * 0.28 - (spec.head.drop ?? 0), spec.len / 2 + (spec.head.fwd ?? hs * 0.35));
  head.add(lump(hs, hs * 0.92, hs * 1.08, spec.fur));
  head.add(box(hs * 0.7, hs * 0.5, hs * 0.5, spec.fur, 0, -hs * 0.18, hs * 0.18)); // cheeks
  const sn = spec.head.snout;
  const snH = spec.head.snoutH ?? hs * 0.5;
  head.add(acc(spike(Math.max(hs * 0.32, snH * 0.7), sn + hs * 0.1, spec.head.snoutC ?? spec.fur, 1, 0, -hs * 0.1, hs * 0.5 + sn / 2 - 0.02)));
  head.add(box(hs * 0.2, hs * 0.14, hs * 0.14, 0x16120f, 0, -hs * 0.04, hs * 0.5 + sn)); // nose
  const eyeC = spec.eye ?? 0x111111;
  // eyes: a white ball, a dark pupil looking forward and a glint, so they read as alive
  const eyes: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(sx * hs * 0.32, hs * 0.14, hs * 0.44);
    eye.add(ball(hs * 0.1, hs * 0.115, hs * 0.07, 0xf4f1e6), box(hs * 0.1, hs * 0.13, hs * 0.05, eyeC, sx * -hs * 0.01, 0, hs * 0.05), box(hs * 0.035, hs * 0.035, hs * 0.03, 0xffffff, sx * hs * 0.015, hs * 0.04, hs * 0.075));
    head.add(eye);
    eyes.push(eye);
  }
  const es = (spec.earS ?? 0.5) * hs;
  const ec = spec.earC ?? spec.fur;
  const ears: { o: THREE.Object3D; side: number }[] = [];
  for (const sx of [-1, 1]) {
    let e: THREE.Object3D | null = null;
    if (spec.ears === 'point') e = cone(es * 0.5, es, ec, sx * hs * 0.32, hs * 0.62, -hs * 0.05);
    else if (spec.ears === 'round') e = ball(es * 0.5, es * 0.5, es * 0.3, ec, sx * hs * 0.38, hs * 0.5, -hs * 0.1);
    else if (spec.ears === 'long') e = part(CONE3, ec, es * 0.3, es * 2.4, es * 0.14, sx * hs * 0.22, hs * 0.95, -hs * 0.1);
    if (e) {
      acc(e);
      head.add(e);
      // the inner ear
      if (spec.ears === 'point') head.add(acc(cone(es * 0.26, es * 0.62, 0xf0a8a8, sx * hs * 0.32, hs * 0.6, -hs * 0.05 + es * 0.14)));
      else if (spec.ears === 'round') head.add(acc(ball(es * 0.3, es * 0.3, es * 0.12, 0xf0a8a8, sx * hs * 0.38, hs * 0.5, -hs * 0.1 + es * 0.2)));
      ears.push({ o: e, side: sx });
    }
  }
  // a mouth line under the snout, and whiskers on the short-nosed furry ones
  head.add(box(hs * 0.28, hs * 0.03, hs * 0.04, 0x241410, 0, -hs * 0.2, hs * 0.5 + sn * 0.5));
  if (sn <= 0.2 && !spec.crawl && (spec.ears === 'point' || spec.ears === 'round')) {
    for (const sx of [-1, 1]) {
      for (let k = -1; k <= 1; k++) {
        const w = box(hs * 0.36, hs * 0.012, hs * 0.012, 0xf4f0e6, sx * hs * 0.24, -hs * 0.1 + k * hs * 0.045, hs * 0.5 + sn * 0.55);
        w.rotation.z = sx * k * 0.18;
        head.add(w);
      }
    }
  }
  torso.add(head);

  // legs pivot at the hip so they can swing
  const legs: THREE.Group[] = [];
  const lx = spec.w / 2 - spec.legT * 0.4;
  const lz = spec.len / 2 - spec.legT * 0.9;
  for (const [sx, sz] of [[1, 1], [-1, -1], [-1, 1], [1, -1]] as const) {
    const g = new THREE.Group();
    g.position.set(sx * lx, hip, sz * lz);
    if (spec.crawl) {
      g.add(part(LEG, spec.fur, spec.legT * 1.5, spec.legLen * 0.9, spec.legT * 1.5, sx * spec.legT * 0.4, -spec.legLen * 0.45, 0));
      g.rotation.z = sx * 0.25;
    } else {
      // a thick thigh and a thinner, slightly bent shin
      g.add(part(LEG, spec.fur, spec.legT * 1.8, spec.legLen * 0.58, spec.legT * 1.8, 0, -spec.legLen * 0.28, 0));
      const shin = part(LEG, spec.fur, spec.legT * 1.05, spec.legLen * 0.52, spec.legT * 1.05, 0, -spec.legLen * 0.74, -spec.legT * 0.12);
      shin.rotation.x = 0.22;
      g.add(shin);
      g.add(acc(box(spec.legT * 1.2, spec.legT * 0.6, spec.legT * 1.8, spec.paw ?? spec.fur, 0, -spec.legLen + spec.legT * 0.2, spec.legT * 0.3), 2));
    }
    root.add(g);
    legs.push(g);
  }

  let tail: THREE.Group | null = null;
  if (spec.tail) {
    tail = new THREE.Group();
    tail.position.set(0, spec.h * 0.2, -spec.len / 2);
    const tc = spec.tail.c ?? spec.fur;
    const n = 3;
    let y = 0;
    let z = 0;
    for (let i = 0; i < n; i++) {
      const k = 1 - i * 0.28;
      const seg = spec.tail.len / n;
      const rise = (spec.tail.up ?? 0) * seg;
      const tube = part(LEG, tc, spec.tail.t * 1.5 * k, seg * 1.3, spec.tail.t * 1.5 * k, 0, y + rise * 0.5, z - seg * 0.475);
      tube.rotation.x = Math.PI / 2 + Math.atan2(rise, seg * 0.95); // thick end at the body, thinning backwards and curving up
      tail.add(acc(tube));
      z -= seg * 0.95;
      y += (spec.tail.up ?? 0) * seg;
    }
    torso.add(tail);
  }
  spec.extras?.(torso, head, r);
  if (spec.scale) root.scale.setScalar(spec.scale);
  return { root, legs, head, tail, torso, eyes, ears, hip, spec };
}

class QuadRig implements Rig {
  root: THREE.Group;
  height: number;
  radius: number;
  private phase = Math.random() * 6;
  private mats: Mat[] = [];
  private tint: number | null = null;
  private flash = 0;
  private baseY: number;
  private headZ: number;
  private headY = 0;
  private wasAir = 0;
  private squash = 0;
  private seed = Math.random() * 100;
  private shadow: THREE.Mesh;
  private shadowR: number;
  constructor(private b: Built, radius: number) {
    this.root = new THREE.Group();
    this.root.add(b.root);
    const s = b.spec.scale ?? 1;
    this.height = (b.spec.legLen + b.spec.h + b.spec.head.s * 0.9) * s + 0.5;
    this.radius = radius;
    this.baseY = b.torso.position.y;
    this.headZ = b.head.position.z;
    // a soft shadow blob keeps the animal planted on the ground
    this.shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.05;
    this.shadowR = Math.max(b.spec.w * 0.8, b.spec.len * 0.5);
    this.shadow.scale.set(this.shadowR * s, this.shadowR * 1.15 * s, 1);
    this.root.add(this.shadow);
    const parts: THREE.Mesh[] = [];
    b.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        parts.push(o);
        // each rig needs its own materials so a hit can flash one animal
        o.material = (o.material as Mat).clone();
        this.mats.push(o.material as Mat);
      }
    });
    for (const o of parts) {
      if (Math.max(o.scale.x, o.scale.y, o.scale.z) < 0.07) continue; // tiny parts need no outline
      const ol = new THREE.Mesh(o.geometry, OUTLINE);
      ol.scale.setScalar(1.09);
      o.add(ol);
    }
    this.headY = b.head.position.y;
  }
  setTint(color: number | null) {
    this.tint = color;
  }
  update(dt: number, s: RigState) {
    const b = this.b;
    const moving = Math.min(1, s.speed / 3);
    this.phase += dt * (3 + s.speed * 1.5);
    const air = (s.air ?? 0) > 0.04 ? 1 : 0;
    const amp = 0.7 * moving * (s.swim ? 0.5 : 1) * (1 - air);
    const sw = Math.sin(this.phase);
    const p = s.pose;
    const g = s.guard ? 1 : 0;
    // legs: the walk cycle, plus whatever the current move or pose asks for
    const tuckF = air * -0.9 + g * -0.18;
    const tuckB = air * 0.7 + g * 0.18;
    b.legs[0].rotation.x = sw * amp + tuckF + (p?.fl ?? 0);
    b.legs[1].rotation.x = sw * amp + tuckB + (p?.bl ?? 0);
    b.legs[2].rotation.x = -sw * amp + tuckF + (p?.fr ?? 0);
    b.legs[3].rotation.x = -sw * amp + tuckB + (p?.br ?? 0);
    if (b.spec.crawl) for (const [i, l] of b.legs.entries()) l.rotation.z = (i === 0 || i === 3 ? 1 : -1) * (0.25 + g * 0.25);
    // landing squash and takeoff stretch
    if (this.wasAir && !air) this.squash = 1;
    this.wasAir = air;
    this.squash = Math.max(0, this.squash - dt * 5);
    const stretch = air ? 0.08 : -0.2 * this.squash;
    b.torso.scale.set(1 - stretch * 0.5, 1 + stretch, 1 - stretch * 0.5);
    // breathing and an occasional look around when standing still
    const idle = (1 - moving) * (1 - air);
    const breathe = Math.sin(s.t * 2.2 + this.seed) * 0.018 * idle;
    b.torso.scale.y += breathe;
    const hop = Math.abs(Math.sin(this.phase)) * 0.06 * moving;
    const recoil = Math.min(1, s.hurt);
    b.torso.position.y = this.baseY + hop - (s.swim ? 0.25 : 0) - g * 0.1 + (p?.y ?? 0);
    b.torso.position.z = (p?.z ?? 0) - recoil * 0.18;
    b.torso.rotation.x = (p?.rx ?? 0) + g * 0.1 - recoil * 0.3 + air * -Math.max(-0.5, Math.min(0.5, (s.vy ?? 0) * 0.06));
    b.torso.rotation.y = p?.ry ?? 0;
    b.torso.rotation.z = Math.sin(this.phase * 0.5) * 0.04 * moving + (s.stun ? Math.sin(s.t * 20) * 0.12 : 0) + (p?.rz ?? 0) + Math.max(-0.22, Math.min(0.22, -(s.turn ?? 0) * 0.06)) * moving;
    b.head.position.z = this.headZ + s.attack * 0.2 * (b.spec.scale ?? 1);
    // the head bobs with the stride, and the body leans into a run
    b.head.position.y = this.headY + Math.sin(this.phase * 2) * 0.02 * moving * (b.spec.scale ?? 1);
    b.torso.rotation.x += Math.min(0.16, s.speed * 0.012) * (1 - air);
    b.torso.rotation.y += Math.sin(this.phase) * (b.spec.crawl ? 0.14 : 0.025) * moving; // the spine sways, a lizard's most
    b.head.rotation.x = (p?.hx ?? 0) + s.attack * 0.25 - (s.stun ? 0.4 : 0) + g * 0.4;
    const glance = Math.sin(s.t * 0.55 + this.seed) > 0.55 ? Math.sin(s.t * 1.3 + this.seed) * 0.5 : 0;
    b.head.rotation.y = (p?.hy ?? 0) + glance * idle;
    b.head.rotation.x += Math.sin(s.t * 7 + this.seed) * 0.025 * idle * (glance !== 0 ? 1 : 0); // a sniff while it looks around
    if (b.tail) {
      b.tail.rotation.y = b.spec.crawl ? Math.sin(this.phase * 1.3) * 0.55 * (0.3 + moving) : Math.sin(s.t * 6 + this.phase) * 0.35 * (0.4 + moving);
      b.tail.rotation.x = (p?.tail ?? 0) + air * 0.4;
    }
    const sc = (b.spec.scale ?? 1) * (p?.sc ?? 1);
    b.root.scale.setScalar(sc);
    // blinking (squints when hurt, dizzy slits when stunned) and ear flicks
    const bk = (s.t + this.seed) % 3.4;
    const closed = Math.max(bk < 0.14 ? Math.sin((bk / 0.14) * Math.PI) : 0, s.hurt > 0.2 ? 0.8 : 0, s.stun ? 0.6 : 0);
    for (const e of b.eyes) e.scale.y = 1 - 0.9 * closed;
    const flick = Math.max(0, Math.sin(s.t * 0.9 + this.seed * 3) - 0.9) * 8;
    for (const e of b.ears) {
      e.o.rotation.z = e.side * (flick * 0.45 + (s.stun ? 0.5 : 0) + g * 0.15);
      e.o.rotation.x = -moving * 0.3 - g * 0.3 - s.attack * 0.3;
    }
    const lift = Math.min(1, (s.air ?? 0) * 1.5);
    const sk = this.shadowR * (1 - lift * 0.35) * sc;
    this.shadow.scale.set(sk, sk * 1.15, 1);
    // a glow while winding up (so the blow can be read), a flash when hit
    this.flash = Math.max(this.flash, s.hurt);
    this.flash = Math.max(0, this.flash - dt * 3);
    const e = this.flash > 0.01 ? 0.7 * this.flash : 0;
    const warn = (s.warn ?? 0) * (0.55 + 0.45 * Math.sin(s.t * 30));
    for (const m of this.mats) {
      if (this.tint !== null) m.emissive.setHex(this.tint).multiplyScalar(0.5);
      else if (warn > 0.01) m.emissive.setRGB(0.9 * warn, 0.28 * warn, 0.06 * warn);
      else if (s.counter) m.emissive.setRGB(0.5, 0.4, 0.05);
      else m.emissive.setRGB(e, e * 0.25, e * 0.2);
    }
  }
}

// --- species -----------------------------------------------------------------------------------

const SPECS: Record<string, QuadSpec> = {
  wolf: {
    len: 1.15, w: 0.42, h: 0.5, legLen: 0.55, legT: 0.14, fur: 0x6d7379, belly: 0xb8bcbf, paw: 0x4c5156,
    head: { s: 0.36, snout: 0.3, snoutC: 0x8a9096 }, ears: 'point', earS: 0.55, tail: { len: 0.7, t: 0.16, up: -0.25 },
    extras: (torso) => torso.add(box(0.46, 0.25, 0.3, 0x8a9096, 0, 0.18, 0.45)),
  },
  bear: {
    len: 1.7, w: 0.95, h: 0.95, legLen: 0.55, legT: 0.32, fur: 0x5b3d2a, belly: 0x4a3122, paw: 0x2c1d14,
    head: { s: 0.58, snout: 0.34, snoutC: 0x8a6747, drop: 0.12 }, ears: 'round', earS: 0.5, tail: { len: 0.18, t: 0.16 },
    extras: (torso) => torso.add(box(0.8, 0.4, 0.55, 0x5b3d2a, 0, 0.55, 0.4)),
  },
  cheetah: {
    len: 1.2, w: 0.34, h: 0.4, legLen: 0.62, legT: 0.1, fur: 0xd6a95a, belly: 0xf1e1b9, paw: 0x9d7a3a,
    head: { s: 0.27, snout: 0.16, snoutC: 0xe5c47e }, ears: 'round', earS: 0.4, tail: { len: 0.95, t: 0.1, c: 0xd6a95a, up: 0.1 }, eye: 0x1c1208,
    extras: (torso, _h, r) => {
      for (let i = 0; i < 26; i++) torso.add(box(0.07, 0.05, 0.07, 0x2a1d0e, (r() - 0.5) * 0.36, 0.2 + (r() - 0.5) * 0.1 + (r() < 0.4 ? -0.18 : 0), (r() - 0.5) * 1.1));
    },
  },
  badger: {
    len: 0.78, w: 0.4, h: 0.34, legLen: 0.22, legT: 0.13, fur: 0x1d1b1c, belly: 0x2c2a2b, paw: 0x0e0d0e,
    head: { s: 0.28, snout: 0.16, snoutC: 0xe8e6e0 }, ears: 'round', earS: 0.3, tail: { len: 0.2, t: 0.1 }, eye: 0xdddddd,
    extras: (torso, head) => {
      torso.add(box(0.44, 0.07, 0.95, 0xdcd9d2, 0, 0.19, -0.02));
      head.add(box(0.2, 0.05, 0.4, 0xdcd9d2, 0, 0.22, 0.05));
    },
  },
  croc: {
    len: 3.0, w: 0.9, h: 0.5, legLen: 0.28, legT: 0.24, fur: 0x4d6b3a, belly: 0xc8c48a, paw: 0x384d2a, crawl: true,
    head: { s: 0.5, snout: 1.0, snoutH: 0.28, snoutC: 0x57783f, drop: 0.12 }, ears: 'none', tail: { len: 1.5, t: 0.5, up: 0 }, eye: 0xe6c200,
    extras: (torso, head) => {
      for (let i = 0; i < 9; i++) torso.add(cone(0.1, 0.22, 0x32492a, 0, 0.3, 1.1 - i * 0.28));
      head.add(box(0.5, 0.07, 1.4, 0xd9d6b0, 0, -0.24, 0.35));
      for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) head.add(cone(0.035, 0.1, 0xf4f1e2, sx * 0.17, -0.18, 0.5 + i * 0.12));
    },
  },
  boar: {
    len: 1.3, w: 0.62, h: 0.66, legLen: 0.42, legT: 0.17, fur: 0x4d3a2e, belly: 0x3a2b22, paw: 0x1f1712,
    head: { s: 0.46, snout: 0.34, snoutC: 0x6b5242, drop: 0.08 }, ears: 'point', earS: 0.45, tail: { len: 0.22, t: 0.06 },
    extras: (torso, head) => {
      for (let i = 0; i < 8; i++) torso.add(cone(0.06, 0.2, 0x251a13, 0, 0.38, 0.55 - i * 0.16));
      for (const sx of [-1, 1]) {
        const t = cone(0.05, 0.3, 0xf2eee0, sx * 0.17, -0.12, 0.6);
        t.rotation.x = -0.9;
        t.rotation.z = -sx * 0.25;
        head.add(t);
      }
    },
  },
  otter: {
    len: 0.95, w: 0.28, h: 0.26, legLen: 0.16, legT: 0.09, fur: 0x6b4a32, belly: 0xc9a98a, paw: 0x3d2a1c,
    head: { s: 0.24, snout: 0.1, snoutC: 0xc9a98a }, ears: 'round', earS: 0.25, tail: { len: 0.75, t: 0.16, up: 0 },
    extras: (_t, head) => {
      for (const sx of [-1, 1]) head.add(box(0.14, 0.01, 0.02, 0xeeeeee, sx * 0.1, -0.07, 0.28));
    },
  },
  porcupine: {
    len: 0.68, w: 0.4, h: 0.38, legLen: 0.18, legT: 0.1, fur: 0x4c3a2a, belly: 0x7a6650, paw: 0x2c2118,
    head: { s: 0.24, snout: 0.1, snoutC: 0xb59a7a, drop: 0.06 }, ears: 'round', earS: 0.25, tail: { len: 0.2, t: 0.08 },
    extras: (torso, _h, r) => {
      for (let i = 0; i < 46; i++) {
        const q = cone(0.025, 0.42 + r() * 0.12, i % 3 === 0 ? 0xf0e6c8 : 0x2b2118, (r() - 0.5) * 0.36, 0.2 + r() * 0.08, (r() - 0.5) * 0.8);
        q.rotation.x = -0.9 - r() * 0.4;
        q.rotation.z = (r() - 0.5) * 0.7;
        torso.add(q);
      }
    },
  },
  // --- horde creatures ---
  mouse: { len: 0.2, w: 0.1, h: 0.1, legLen: 0.04, legT: 0.03, fur: 0xa6968a, head: { s: 0.09, snout: 0.05 }, ears: 'round', earS: 0.7, tail: { len: 0.2, t: 0.015, c: 0xd9b8a8 }, eye: 0x000000 },
  rat: { len: 0.32, w: 0.14, h: 0.14, legLen: 0.05, legT: 0.04, fur: 0x4a4540, head: { s: 0.11, snout: 0.08 }, ears: 'round', earS: 0.6, tail: { len: 0.32, t: 0.02, c: 0xc99c94 }, eye: 0xdd2222 },
  rabbit: { len: 0.42, w: 0.2, h: 0.22, legLen: 0.12, legT: 0.07, fur: 0xc3b6a2, belly: 0xefe9dd, head: { s: 0.16, snout: 0.06 }, ears: 'long', earS: 1, tail: { len: 0.09, t: 0.09, c: 0xffffff } },
  fox: { len: 0.8, w: 0.26, h: 0.3, legLen: 0.32, legT: 0.08, fur: 0xd2762c, belly: 0xf2e6d6, paw: 0x3a2517, head: { s: 0.23, snout: 0.2, snoutC: 0xe8a468 }, ears: 'point', earS: 0.6, tail: { len: 0.6, t: 0.16, c: 0xdc8a3d, up: -0.1 }, extras: (_t, h) => h.add(box(0.1, 0.1, 0.1, 0xffffff, 0, -0.18, 0.2)) },
  goat: { len: 0.95, w: 0.36, h: 0.46, legLen: 0.5, legT: 0.1, fur: 0xe2dccf, belly: 0xf0ece3, paw: 0x3b332b, head: { s: 0.26, snout: 0.18 }, ears: 'long', earS: 0.8, tail: { len: 0.15, t: 0.06 }, extras: (_t, h) => { for (const sx of [-1, 1]) { const horn = cone(0.04, 0.36, 0x6b5a45, sx * 0.1, 0.28, -0.05); horn.rotation.x = -0.5; horn.rotation.z = -sx * 0.3; h.add(horn); } h.add(cone(0.04, 0.16, 0xe2dccf, 0, -0.25, 0.1)); } },
  wildpig: { len: 1.0, w: 0.5, h: 0.52, legLen: 0.32, legT: 0.13, fur: 0x5b4636, belly: 0x483526, paw: 0x241a12, head: { s: 0.38, snout: 0.26, snoutC: 0x7e6552 }, ears: 'point', earS: 0.5, tail: { len: 0.14, t: 0.05 }, extras: (_t, h) => { for (const sx of [-1, 1]) { const t = cone(0.04, 0.22, 0xf2eee0, sx * 0.13, -0.1, 0.45); t.rotation.x = -0.9; h.add(t); } } },
};

// --- the newer animals ---
SPECS.lion = {
  len: 1.5, w: 0.6, h: 0.66, legLen: 0.66, legT: 0.17, fur: 0xd9a95a, belly: 0xf0d9a0, paw: 0x9d7a3a,
  head: { s: 0.5, snout: 0.2, snoutC: 0xe8c47e }, ears: 'round', earS: 0.35, tail: { len: 0.95, t: 0.1, c: 0xd9a95a, up: -0.15 },
  extras: (torso, head) => {
    head.add(ball(0.52, 0.5, 0.4, 0x6b3f1c, 0, 0, -0.14)); // the mane
    torso.add(ball(0.12, 0.12, 0.14, 0x4a2a10, 0, 0.12, -1.7)); // tail tuft
  },
};
SPECS.hippo = {
  len: 2.0, w: 1.15, h: 0.95, legLen: 0.32, legT: 0.38, fur: 0x8d7b86, belly: 0xc9a6a0, paw: 0x5a4a55,
  head: { s: 0.85, snout: 0.5, snoutH: 0.55, snoutC: 0xa68f96, drop: 0.2 }, ears: 'round', earS: 0.25, tail: { len: 0.25, t: 0.1 },
  extras: (_t, head) => {
    for (const sx of [-1, 1]) {
      head.add(cone(0.07, 0.25, 0xf2eee0, sx * 0.24, -0.4, 0.8));
      head.add(box(0.1, 0.1, 0.1, 0x2a2025, sx * 0.15, 0.08, 1.0));
    }
  },
};
SPECS.redfox = { ...SPECS.fox, fur: 0xcf6a22, scale: 1.25, tail: { len: 0.85, t: 0.2, c: 0xe08a3a, up: -0.1 } };
SPECS.leopard = {
  len: 1.3, w: 0.38, h: 0.42, legLen: 0.52, legT: 0.12, fur: 0xd8b36a, belly: 0xf1e1b9, paw: 0x8a6a30,
  head: { s: 0.3, snout: 0.17, snoutC: 0xe5c47e }, ears: 'round', earS: 0.4, tail: { len: 1.1, t: 0.1, up: 0.1 }, eye: 0x1c1208,
  extras: (torso, _h, r) => {
    for (let i = 0; i < 34; i++) torso.add(box(0.09, 0.05, 0.09, 0x2a1d0e, (r() - 0.5) * 0.38, 0.2 + (r() - 0.5) * 0.1 + (r() < 0.4 ? -0.18 : 0), (r() - 0.5) * 1.2));
  },
};
SPECS.gorilla = {
  len: 1.1, w: 1.0, h: 1.0, legLen: 0.75, legT: 0.3, fur: 0x2c2c33, belly: 0x3a3a42, paw: 0x1a1a1f,
  head: { s: 0.5, snout: 0.2, snoutC: 0x3a3a42, drop: 0.05 }, ears: 'round', earS: 0.2, tail: { len: 0.05, t: 0.05 }, eye: 0x331a10,
  extras: (torso, head) => {
    torso.add(lump(0.9, 0.5, 0.6, 0x7a7a84, 0, 0.35, 0)); // the silver back
    head.add(box(0.5, 0.12, 0.2, 0x1a1a1f, 0, 0.2, 0.3)); // heavy brow
  },
};
SPECS.turtle = {
  len: 0.95, w: 0.8, h: 0.3, legLen: 0.2, legT: 0.2, fur: 0x6a8f4a, belly: 0xd9d3a0, paw: 0x4a6a30,
  head: { s: 0.26, snout: 0.14, snoutC: 0x6a8f4a, fwd: 0.2 }, ears: 'none', tail: { len: 0.3, t: 0.1 }, crawl: true,
  extras: (torso) => {
    torso.add(ball(0.56, 0.4, 0.64, 0x5a4a2a, 0, 0.25, 0)); // the shell
    for (let i = 0; i < 6; i++) torso.add(box(0.22, 0.1, 0.22, 0x7a6a3a, Math.cos(i * 1.05) * 0.3, 0.58, Math.sin(i * 1.05) * 0.34));
  },
};
SPECS.kangaroo = {
  len: 0.9, w: 0.45, h: 0.7, legLen: 0.8, legT: 0.18, fur: 0xc9884a, belly: 0xeed2a8, paw: 0x7a4a20,
  head: { s: 0.32, snout: 0.26, snoutC: 0xd9a468, drop: -0.05 }, ears: 'long', earS: 1.2, tail: { len: 1.1, t: 0.3, up: -0.05 },
  extras: (torso) => torso.add(lump(0.3, 0.25, 0.3, 0xeed2a8, 0, -0.15, 0.2)), // the pouch
};
SPECS.skunk = {
  len: 0.7, w: 0.34, h: 0.32, legLen: 0.2, legT: 0.09, fur: 0x1c1c1f, belly: 0x2c2c30, paw: 0x0e0e10,
  head: { s: 0.24, snout: 0.12, snoutC: 0x2c2c30 }, ears: 'round', earS: 0.3, tail: { len: 0.8, t: 0.3, c: 0x1c1c1f, up: 0.25 },
  extras: (torso, head) => {
    torso.add(box(0.12, 0.06, 1.0, 0xf2f0ea, 0, 0.19, 0)); // the stripe
    head.add(box(0.07, 0.05, 0.35, 0xf2f0ea, 0, 0.2, 0.1));
    torso.add(ball(0.12, 0.2, 0.12, 0xf2f0ea, 0, 0.5, -1.1)); // white tail tip
  },
};

interface BirdSpec {
  body: number;
  c: number;
  belly: number;
  beak: number;
  beakLen: number;
  legs: number; // leg length
  neck: number;
  tail: number;
  wing: number;
  scale?: number;
}
const BIRDS: Record<string, BirdSpec> = {
  sparrow: { body: 0.1, c: 0x9b7653, belly: 0xe2d4bd, beak: 0xe6b84a, beakLen: 0.05, legs: 0.08, neck: 0.02, tail: 0.16, wing: 0.14 },
  duck: { body: 0.2, c: 0x6a8f5a, belly: 0xe6e0cc, beak: 0xf0b90a, beakLen: 0.13, legs: 0.1, neck: 0.12, tail: 0.1, wing: 0.22 },
  heron: { body: 0.2, c: 0x8da1b3, belly: 0xdfe6ec, beak: 0xe9a933, beakLen: 0.32, legs: 0.7, neck: 0.55, tail: 0.14, wing: 0.4 },
  swarm_bird: { body: 0.09, c: 0x7c8aa0, belly: 0xdfe3ea, beak: 0xe6b84a, beakLen: 0.05, legs: 0.0, neck: 0.02, tail: 0.14, wing: 0.18 },
};

function buildBird(spec: BirdSpec): Built {
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = spec.legs + spec.body * 0.9;
  root.add(torso);
  torso.add(ball(spec.body * 0.8, spec.body * 0.8, spec.body * 1.3, spec.c));
  torso.add(ball(spec.body * 0.6, spec.body * 0.5, spec.body * 1.0, spec.belly, 0, -spec.body * 0.3, spec.body * 0.1));
  const head = new THREE.Group();
  head.position.set(0, spec.neck + spec.body * 0.4, spec.body * 1.0 + spec.neck * 0.3);
  head.add(ball(spec.body * 0.5, spec.body * 0.5, spec.body * 0.55, spec.c));
  head.add(cone(spec.body * 0.22, spec.beakLen, spec.beak, 0, -0.01, spec.body * 0.55 + spec.beakLen / 2));
  head.children[1].rotation.x = Math.PI / 2;
  for (const sx of [-1, 1]) head.add(box(spec.body * 0.12, spec.body * 0.12, spec.body * 0.1, 0x111111, sx * spec.body * 0.38, spec.body * 0.12, spec.body * 0.3));
  if (spec.neck > 0.1) torso.add(box(spec.body * 0.28, spec.neck, spec.body * 0.28, spec.c, 0, spec.neck / 2 + spec.body * 0.3, spec.body * 1.0));
  torso.add(head);
  const tail = new THREE.Group();
  tail.position.set(0, 0, -spec.body * 1.2);
  tail.add(box(spec.body * 0.7, spec.body * 0.1, spec.tail, spec.c, 0, 0, -spec.tail / 2));
  torso.add(tail);
  const legs: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(sx * spec.body * 0.35, spec.legs, 0);
    if (spec.legs > 0) g.add(box(0.025, spec.legs, 0.025, 0xd9a64a, 0, -spec.legs / 2, 0));
    root.add(g);
    legs.push(g);
  }
  // wings: pivots on the shoulders
  const wings: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(sx * spec.body * 0.7, spec.body * 0.2, 0);
    const wing = part(CONE3, spec.c, spec.body * 0.9, spec.wing, 0.03, sx * spec.wing / 2, 0, 0);
    wing.rotation.z = -sx * (Math.PI / 2);
    w.add(wing);
    torso.add(w);
    wings.push(w);
  }
  (root as unknown as { wings: THREE.Group[] }).wings = wings;
  const fake: QuadSpec = { len: spec.body * 2.4, w: spec.body, h: spec.body, legLen: spec.legs, legT: 0.03, fur: spec.c, head: { s: spec.body, snout: 0.05 } };
  return { root, legs: [legs[0], legs[1], legs[1], legs[0]], head, tail, torso, eyes: [], ears: [], hip: spec.legs, spec: { ...fake, scale: spec.scale } };
}

interface FishSpec {
  len: number;
  h: number;
  c: number;
  belly: number;
  fin: number;
}
const FISH: Record<string, FishSpec> = {
  minnow: { len: 0.16, h: 0.05, c: 0xaebfce, belly: 0xe8eef3, fin: 0x8fa3b5 },
  perch: { len: 0.36, h: 0.13, c: 0x7aa24c, belly: 0xe2dca2, fin: 0xd9622e },
  pike: { len: 0.95, h: 0.15, c: 0x4f7a5a, belly: 0xd5d9b8, fin: 0x3d5e46 },
  swarm_fish: { len: 0.22, h: 0.07, c: 0x5fa3c4, belly: 0xdcefff, fin: 0x3c82a8 },
};
function buildFish(f: FishSpec): THREE.Group {
  const g = new THREE.Group();
  g.add(ball(f.h, f.h, f.len / 2, f.c));
  g.add(ball(f.h * 0.8, f.h * 0.5, f.len * 0.42, f.belly, 0, -f.h * 0.4, 0));
  const tail = cone(f.h * 1.1, f.len * 0.3, f.fin, 0, 0, -f.len * 0.55);
  tail.rotation.x = -Math.PI / 2;
  tail.scale.x = 0.2;
  g.add(tail);
  g.add(box(0.015, f.h * 0.9, f.len * 0.3, f.fin, 0, f.h * 0.9, -f.len * 0.05));
  for (const sx of [-1, 1]) g.add(box(0.01, 0.02, f.len * 0.18, 0x111111, sx * f.h * 0.85, f.h * 0.2, f.len * 0.28));
  return g;
}

function buildBeetle(): THREE.Group {
  const g = new THREE.Group();
  g.add(ball(0.13, 0.09, 0.17, 0x2d4a3a, 0, 0.1, 0));
  g.add(ball(0.07, 0.06, 0.07, 0x1a2a21, 0, 0.09, 0.2));
  for (const sx of [-1, 1]) for (const z of [-0.08, 0, 0.08]) g.add(box(0.1, 0.015, 0.015, 0x111111, sx * 0.15, 0.05, z));
  for (const sx of [-1, 1]) g.add(cone(0.015, 0.1, 0x111111, sx * 0.04, 0.12, 0.3));
  return g;
}

// --- merged (horde) models ----------------------------------------------------------------------

function mergeGroup(group: THREE.Group): THREE.Mesh {
  group.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const c = (o.material as Mat).color;
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    geos.push(g);
  });
  const merged = mergeGeometries(geos.map(flat), false)!;
  return new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

class MergedRig implements Rig {
  root = new THREE.Group();
  height: number;
  radius: number;
  private mesh: THREE.Mesh;
  private phase = Math.random() * 6;
  private flash = 0;
  constructor(
    group: THREE.Group,
    private fish: boolean,
    private bird: boolean,
    private scale: number,
    height: number,
    radius: number,
  ) {
    this.mesh = mergeGroup(group);
    this.mesh.scale.setScalar(scale);
    this.root.add(this.mesh);
    this.height = height;
    this.radius = radius;
  }
  private tint: number | null = null;
  setTint(color: number | null): void {
    this.tint = color;
  }
  update(dt: number, s: RigState) {
    const moving = Math.min(1, s.speed / 2.5);
    this.phase += dt * (6 + s.speed * 2.2);
    const m = this.mesh;
    if (this.fish) {
      m.rotation.y = Math.sin(this.phase * 0.8) * 0.35 * (0.3 + moving);
      m.position.y = Math.sin(s.t * 2 + this.phase) * 0.03;
    } else if (this.bird) {
      m.position.y = Math.abs(Math.sin(this.phase * 0.7)) * 0.12 * moving;
      m.rotation.z = Math.sin(this.phase) * 0.12 * moving;
    } else {
      // hop / scurry
      m.position.y = Math.abs(Math.sin(this.phase)) * 0.07 * moving * this.scale;
      m.rotation.x = Math.sin(this.phase) * 0.06 * moving;
      m.rotation.z = s.stun ? Math.sin(s.t * 20) * 0.2 : 0;
    }
    m.position.z = s.attack * 0.25 * this.scale;
    if (!this.fish && !this.bird) m.rotation.y = Math.sin(s.t * 0.9 + this.phase) * 0.3 * (1 - moving); // sniffing about
    this.flash = Math.max(this.flash, s.hurt);
    this.flash = Math.max(0, this.flash - dt * 3);
    const mat = m.material as Mat;
    const e = this.flash > 0.01 ? 0.8 * this.flash : 0;
    const warn = (s.warn ?? 0) * (0.6 + 0.4 * Math.sin(s.t * 34));
    if (warn > 0.01) mat.emissive.setRGB(0.9 * warn, 0.28 * warn, 0.06 * warn);
    else if (this.tint !== null) mat.emissive.setHex(this.tint).multiplyScalar(0.45 + e);
    else mat.emissive.setRGB(e, e * 0.3, e * 0.3);
    // fleeing animals crouch low; so do winding-up ones, ready to spring
    m.scale.y = this.scale * (s.flee ? 0.92 : (s.warn ?? 0) > 0 ? 0.82 : 1);
  }
}

class BirdRig implements Rig {
  root = new THREE.Group();
  height: number;
  radius: number;
  private b: Built;
  private mats: Mat[] = [];
  private flash = 0;
  private phase = Math.random() * 6;
  private tint: number | null = null;
  constructor(spec: BirdSpec, scale: number) {
    this.b = buildBird(spec);
    this.root.add(this.b.root);
    this.root.scale.setScalar(scale);
    this.height = (spec.legs + spec.neck + spec.body * 2) * scale + 0.5;
    this.radius = spec.body * 2 * scale;
    this.b.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.material = (o.material as Mat).clone();
        this.mats.push(o.material as Mat);
      }
    });
  }
  setTint(c: number | null) {
    this.tint = c;
  }
  update(dt: number, s: RigState) {
    const wings = (this.b.root as unknown as { wings: THREE.Group[] }).wings;
    this.phase += dt * (8 + s.speed * 2);
    const flying = s.speed > 3.5 || this.b.hip === 0;
    const flap = flying ? Math.sin(this.phase * 2.2) * 0.9 : Math.sin(s.t * 1.5) * 0.04;
    wings[0].rotation.z = -flap;
    wings[1].rotation.z = flap;
    const moving = Math.min(1, s.speed / 3);
    this.b.legs[0].rotation.x = Math.sin(this.phase) * 0.6 * moving;
    this.b.legs[1].rotation.x = -Math.sin(this.phase) * 0.6 * moving;
    this.b.head.rotation.x = s.attack * 0.6 + (s.pose?.hx ?? 0);
    this.b.torso.position.y = this.b.hip + 0.1 + (flying ? Math.sin(this.phase * 1.1) * 0.05 : 0) + (s.pose?.y ?? 0);
    this.b.torso.position.z = s.pose?.z ?? 0;
    this.b.torso.rotation.x = s.pose?.rx ?? 0;
    this.flash = Math.max(this.flash, s.hurt);
    this.flash = Math.max(0, this.flash - dt * 3);
    const e = this.flash > 0.01 ? 0.7 * this.flash : 0;
    const warn = (s.warn ?? 0) * (0.6 + 0.4 * Math.sin(s.t * 34));
    for (const m of this.mats) {
      if (this.tint !== null) m.emissive.setHex(this.tint).multiplyScalar(0.3);
      else if (warn > 0.01) m.emissive.setRGB(0.9 * warn, 0.28 * warn, 0.06 * warn);
      else m.emissive.setRGB(e, e * 0.3, e * 0.3);
    }
  }
}

class FishRig implements Rig {
  root = new THREE.Group();
  height = 0.6;
  radius = 0.4;
  private g: THREE.Group;
  private mats: Mat[] = [];
  private flash = 0;
  private phase = Math.random() * 6;
  private tint: number | null = null;
  constructor(spec: FishSpec, scale: number) {
    this.g = buildFish(spec);
    this.g.scale.setScalar(scale);
    this.root.add(this.g);
    this.height = spec.h * 4 * scale + 0.4;
    this.g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.material = (o.material as Mat).clone();
        this.mats.push(o.material as Mat);
      }
    });
  }
  setTint(c: number | null) {
    this.tint = c;
  }
  update(dt: number, s: RigState) {
    this.phase += dt * (6 + s.speed * 2);
    this.g.rotation.y = Math.sin(this.phase) * 0.3;
    this.g.position.y = 0.3 + Math.sin(s.t * 2 + this.phase) * 0.06 + (s.pose?.y ?? 0);
    this.g.position.z = s.pose?.z ?? 0;
    this.g.rotation.x = s.pose?.rx ?? 0;
    this.flash = Math.max(this.flash, s.hurt);
    this.flash = Math.max(0, this.flash - dt * 3);
    const e = this.flash > 0.01 ? 0.7 * this.flash : 0;
    const warn = (s.warn ?? 0) * (0.6 + 0.4 * Math.sin(s.t * 34));
    for (const m of this.mats) {
      if (this.tint !== null) m.emissive.setHex(this.tint).multiplyScalar(0.3);
      else if (warn > 0.01) m.emissive.setRGB(0.9 * warn, 0.28 * warn, 0.06 * warn);
      else m.emissive.setRGB(e, e * 0.3, e * 0.3);
    }
  }
}

// --- public builders -----------------------------------------------------------------------------

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function crown(): THREE.Group {
  const g = new THREE.Group();
  g.add(cyl(0.16, 0.08, 0xf2c230, 0, 0, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(cone(0.035, 0.1, 0xf2c230, Math.cos(a) * 0.13, 0.08, Math.sin(a) * 0.13));
  }
  return g;
}


// --- the 49 forms of the seven evolution trees ----------------------------------------------------
// Most reuse a base body (cat, wolf, bear, otter, lizard...) with new colours, size and markings.
type Extras = NonNullable<QuadSpec['extras']>;
const spotted = (c: number, n: number, w: number, len: number, sz: number): Extras => (torso, _h, r) => {
  for (let i = 0; i < n; i++) torso.add(box(sz, sz * 0.6, sz, c, (r() - 0.5) * w, 0.2 + (r() - 0.5) * 0.1 + (r() < 0.4 ? -0.18 : 0), (r() - 0.5) * len));
};
const striped = (c: number, n: number, w: number, len: number, top: number): Extras => (torso) => {
  for (let i = 0; i < n; i++) {
    const z = len * (0.4 - i / Math.max(1, n - 1) * 0.8);
    torso.add(box(w * 0.55, 0.035, 0.06, c, 0, top - 0.005, z)); // across the back
    for (const sx of [-1, 1]) {
      const side = box(0.035, top * 1.1, 0.06, c, sx * w * 0.5, top * 0.35, z);
      side.rotation.z = sx * -0.35;
      torso.add(side);
    }
  }
};
const both = (...fs: Extras[]): Extras => (t, h, r) => fs.forEach((f) => f(t, h, r));
const tufts = (c: number): Extras => (_t, head) => {
  for (const sx of [-1, 1]) head.add(cone(0.03, 0.14, c, sx * 0.09, 0.2, -0.05));
};
const horn = (c: number, len: number, up: number): Extras => (_t, head) => {
  const h = cone(0.07, len, c, 0, up, 0.3);
  h.rotation.x = Math.PI / 2 - 0.5;
  head.add(h);
};
const extraLegs = (c: number, n: number, span: number, lenL: number): Extras => (torso) => {
  // static extra legs make six- and eight-legged bugs
  for (let i = 0; i < n; i++) {
    for (const sx of [-1, 1]) {
      const l = part(LEG, c, 0.05, lenL, 0.05, sx * 0.22, -0.05, span * (i / Math.max(1, n - 1) - 0.5));
      l.rotation.z = sx * 0.9;
      torso.add(l);
    }
  }
};
const PS: Record<string, QuadSpec> = {};

// cats: stealth and burst
PS.house_cat = {
  len: 0.78, w: 0.28, h: 0.3, legLen: 0.28, legT: 0.075, fur: 0xd98a4c, belly: 0xf7e8d2, paw: 0xf7e8d2,
  head: { s: 0.28, snout: 0.07, snoutC: 0xf7e8d2 }, ears: 'point', earS: 0.62, tail: { len: 0.62, t: 0.07, up: 0.3 }, eye: 0x1c3a12,
  extras: striped(0x8a4a1c, 5, 0.3, 0.7, 0.15),
};
PS.bobcat = {
  len: 1.0, w: 0.34, h: 0.36, legLen: 0.36, legT: 0.095, fur: 0xb78a58, belly: 0xf1e4cf, paw: 0x8a6a40,
  head: { s: 0.33, snout: 0.08, snoutC: 0xf1e4cf }, ears: 'point', earS: 0.55, tail: { len: 0.28, t: 0.1, c: 0x3a2a18 }, eye: 0x2a3a10,
  extras: both(spotted(0x4a3320, 14, 0.32, 0.9, 0.07), tufts(0x1c1410)),
};
PS.lynx = {
  len: 1.05, w: 0.34, h: 0.38, legLen: 0.5, legT: 0.1, fur: 0xcdb892, belly: 0xf3ecdc, paw: 0x9a8868,
  head: { s: 0.34, snout: 0.08, snoutC: 0xf3ecdc }, ears: 'point', earS: 0.6, tail: { len: 0.26, t: 0.1, c: 0x2a2018 }, eye: 0x6a8a20,
  extras: both(spotted(0x6a5a40, 10, 0.3, 0.9, 0.06), tufts(0x161210)),
};
PS.cheetah = { ...SPECS.cheetah, scale: 1.0 };
PS.panther = {
  ...SPECS.leopard, fur: 0x1c1c22, belly: 0x2a2a32, paw: 0x101014, scale: 1.1, eye: 0xffd23f, tail: { len: 1.2, t: 0.1, up: 0.15 }, extras: undefined,
};
PS.tiger = {
  ...SPECS.leopard, fur: 0xe38a2c, belly: 0xf6ecd8, paw: 0xb86a1c, scale: 1.4, head: { s: 0.34, snout: 0.16, snoutC: 0xf3e2c0 },
  tail: { len: 1.1, t: 0.12, up: 0.1 }, extras: striped(0x1c1410, 9, 0.5, 1.2, 0.12),
};
PS.lion = { ...SPECS.lion, scale: 1.15 };

// canines and scavengers
PS.fox = { ...SPECS.redfox, scale: 0.8 };
PS.coyote = { ...SPECS.wolf, fur: 0xb89868, belly: 0xe7d8bc, paw: 0x6a5238, scale: 0.85, extras: undefined, head: { s: 0.34, snout: 0.3, snoutC: 0xcdb48a } };
PS.jackal = { ...SPECS.wolf, fur: 0xc79a4e, belly: 0xefdcb0, paw: 0x7a5a2a, scale: 0.8, extras: undefined, ears: 'point', earS: 0.75, head: { s: 0.3, snout: 0.3, snoutC: 0xe0be82 } };
PS.gray_wolf = { ...SPECS.wolf, scale: 1.1 };
PS.dhole = { ...SPECS.wolf, fur: 0xc4562a, belly: 0xf0d0a8, paw: 0x7a3a1c, scale: 1.0, extras: undefined, tail: { len: 0.8, t: 0.16, c: 0x2a1810, up: -0.2 } };
PS.hyena = {
  ...SPECS.wolf, fur: 0xb09a68, belly: 0xd9c9a0, paw: 0x5a4a30, scale: 1.15, extras: spotted(0x4a3a24, 18, 0.4, 1.0, 0.09), ears: 'round', earS: 0.6,
  head: { s: 0.4, snout: 0.22, snoutC: 0x3a3228 },
};
PS.wild_dog = {
  ...SPECS.wolf, fur: 0xd0a040, belly: 0xefe0a8, paw: 0x2a2018, scale: 1.0, ears: 'round', earS: 0.8,
  extras: spotted(0x1c1410, 14, 0.4, 1.0, 0.14), tail: { len: 0.7, t: 0.16, c: 0xf6f2ea, up: -0.2 },
};

// mustelids: brawlers and swimmers
PS.weasel = { ...SPECS.otter, fur: 0xa8683a, belly: 0xf4e8d4, paw: 0x5a3a20, scale: 0.7, len: 1.1, h: 0.22, w: 0.2, tail: { len: 0.4, t: 0.09, c: 0x3a2418 }, extras: undefined };
PS.river_otter = { ...SPECS.otter, scale: 1.0 };
PS.badger = {
  ...SPECS.badger, fur: 0x8a8580, belly: 0x6a6660, paw: 0x2a2826, scale: 1.0,
  extras: (_t, head) => {
    head.add(box(0.08, 0.05, 0.4, 0x14110f, 0.09, 0.2, 0.05), box(0.08, 0.05, 0.4, 0x14110f, -0.09, 0.2, 0.05), box(0.06, 0.05, 0.4, 0xf2efe8, 0, 0.22, 0.05));
  },
};
PS.giant_otter = { ...SPECS.otter, fur: 0x5a3e2a, belly: 0xe8dac0, scale: 1.45, tail: { len: 0.9, t: 0.17, c: 0x5a3e2a } };
PS.sea_otter = { ...SPECS.otter, fur: 0x4a3426, belly: 0xb09070, paw: 0x2a1c14, scale: 1.2, head: { s: 0.26, snout: 0.1, snoutC: 0xe8dcc0 } };
PS.honey_badger = { ...SPECS.badger, scale: 1.2 };
PS.wolverine = {
  ...SPECS.badger, fur: 0x4a3828, belly: 0x3a2c20, paw: 0x1c140c, scale: 1.25, tail: { len: 0.4, t: 0.14 },
  extras: (torso) => {
    for (const sx of [-1, 1]) torso.add(box(0.05, 0.08, 0.9, 0xc9a86a, sx * 0.2, 0.08, -0.02));
  },
};

// bears: bruisers and foragers
PS.raccoon = {
  ...SPECS.badger, fur: 0x77757a, belly: 0xb0aeb2, paw: 0x3a383c, scale: 0.9, tail: { len: 0.55, t: 0.14, c: 0x9a989c },
  extras: (_t, head) => {
    head.add(box(0.34, 0.1, 0.05, 0x1c1a1e, 0, 0.08, 0.28));
    head.add(box(0.1, 0.1, 0.05, 0xf4f2f0, 0, -0.02, 0.38));
  },
};
PS.black_bear = { ...SPECS.bear, fur: 0x23211f, belly: 0x1a1816, paw: 0x0e0d0c, scale: 0.8, head: { s: 0.52, snout: 0.3, snoutC: 0x9a7a56, drop: 0.12 }, extras: undefined };
PS.sloth_bear = {
  ...SPECS.bear, fur: 0x1a1816, belly: 0x14120f, paw: 0xe8dcc0, scale: 0.85, ears: 'round', earS: 0.4, head: { s: 0.5, snout: 0.4, snoutC: 0xd9c9a0, drop: 0.14 },
  extras: (torso) => torso.add(box(0.45, 0.1, 0.12, 0xe8dcc0, 0, 0.1, 0.5)),
};
PS.grizzly = { ...SPECS.bear, scale: 1.1 };
PS.polar_bear = { ...SPECS.bear, fur: 0xf0eee6, belly: 0xe0ddd2, paw: 0xc8c4b6, scale: 1.2, head: { s: 0.5, snout: 0.38, snoutC: 0xe8e4d8, drop: 0.12 }, extras: undefined };
PS.kodiak = { ...SPECS.bear, fur: 0x6a4a2e, belly: 0x56391f, paw: 0x3a2412, scale: 1.3 };
PS.panda = {
  ...SPECS.bear, fur: 0xf2f0ea, belly: 0xe6e3da, paw: 0x1c1c1f, scale: 1.0, ears: 'round', earS: 0.4, earC: 0x1c1c1f, head: { s: 0.52, snout: 0.22, snoutC: 0xf2f0ea, drop: 0.1 },
  extras: (torso, head) => {
    torso.add(box(0.98, 0.3, 0.4, 0x1c1c1f, 0, 0.35, 0.5)); // black shoulder band
    for (const sx of [-1, 1]) head.add(ball(0.1, 0.07, 0.05, 0x1c1c1f, sx * 0.17, 0.08, 0.5)); // eye patches
  },
};

// reptiles: venom and armor
PS.gecko = {
  len: 0.9, w: 0.28, h: 0.16, legLen: 0.14, legT: 0.07, fur: 0x8aa84a, belly: 0xe2e8b0, paw: 0x6a8a30, crawl: true, scale: 0.6,
  head: { s: 0.3, snout: 0.12, snoutC: 0x9ab85a }, ears: 'none', tail: { len: 0.9, t: 0.1, up: 0 }, eye: 0xffd23f,
  extras: spotted(0xe8c040, 10, 0.26, 0.8, 0.05),
};
PS.monitor = { ...SPECS.croc, fur: 0x6a7048, belly: 0xc2c090, paw: 0x4a5030, scale: 0.55, head: { s: 0.34, snout: 0.45, snoutH: 0.2, snoutC: 0x7a8052, drop: 0.08 }, extras: undefined, tail: { len: 1.3, t: 0.2, up: 0 } };
PS.snapping_turtle = { ...SPECS.turtle, fur: 0x5a6a3a, scale: 0.85 };
PS.komodo = { ...SPECS.croc, fur: 0x6e5f4a, belly: 0xc8b890, paw: 0x4a3e2e, scale: 0.7, head: { s: 0.4, snout: 0.5, snoutH: 0.24, snoutC: 0x7e6e56, drop: 0.1 }, extras: undefined, tail: { len: 1.5, t: 0.26, up: 0 } };
PS.cobra = {
  len: 2.2, w: 0.2, h: 0.2, legLen: 0.04, legT: 0.02, fur: 0x6a5a2a, belly: 0xe2d8a0, paw: 0x6a5a2a, crawl: true, scale: 0.75,
  head: { s: 0.24, snout: 0.08, snoutC: 0x6a5a2a, drop: -0.1 }, ears: 'none', tail: { len: 1.6, t: 0.12, up: 0 }, eye: 0xd23030,
  extras: (torso, head) => {
    head.add(ball(0.42, 0.3, 0.12, 0x6a5a2a, 0, -0.1, -0.1)); // the hood
    torso.add(box(0.1, 0.1, 1.9, 0xe2d8a0, 0, -0.06, 0));
  },
};
PS.croc = { ...SPECS.croc, scale: 1.0 };
PS.tortoise = { ...SPECS.turtle, fur: 0x9a8a5a, belly: 0xd2c68e, paw: 0x7a6a40, scale: 1.7, legLen: 0.32 };

// bugs and arachnids, scaled up to stay readable
PS.ant = {
  len: 0.9, w: 0.28, h: 0.22, legLen: 0.22, legT: 0.05, fur: 0x2a1a14, belly: 0x3a2a20, paw: 0x1c1210, crawl: true, scale: 0.8,
  head: { s: 0.3, snout: 0.06, snoutC: 0x3a2a20 }, ears: 'none', eye: 0xdd2222, tail: undefined,
  extras: (torso, head) => {
    torso.add(ball(0.2, 0.2, 0.28, 0x3a2418, 0, 0.02, -0.55)); // the abdomen
    for (const sx of [-1, 1]) {
      head.add(cone(0.015, 0.4, 0x2a1a14, sx * 0.1, 0.22, 0.2));
      head.add(cone(0.02, 0.14, 0x6a4a30, sx * 0.08, -0.1, 0.36));
    }
  },
};
PS.beetle = {
  len: 0.95, w: 0.7, h: 0.4, legLen: 0.24, legT: 0.07, fur: 0x1a3a5a, belly: 0x2a2a30, paw: 0x14161c, crawl: true, scale: 1.0,
  head: { s: 0.3, snout: 0.05, snoutC: 0x2a2a30, fwd: 0.1 }, ears: 'none', eye: 0xddaa22,
  extras: (torso) => {
    torso.add(ball(0.5, 0.34, 0.58, 0x26567a, 0, 0.2, -0.05)); // the shell
    torso.add(box(0.03, 0.04, 1.0, 0x14161c, 0, 0.5, -0.05));
  },
};
PS.spider = {
  len: 0.7, w: 0.5, h: 0.32, legLen: 0.34, legT: 0.05, fur: 0x4a3a2c, belly: 0x2a2018, paw: 0x1c1410, crawl: true, scale: 1.0,
  head: { s: 0.26, snout: 0.04, snoutC: 0x2a2018, fwd: 0.05 }, ears: 'none', eye: 0xdd2222,
  extras: both((torso) => torso.add(ball(0.32, 0.28, 0.4, 0x5a4634, 0, 0.1, -0.5)), extraLegs(0x2a2018, 3, 0.7, 0.5)),
};
PS.hercules = {
  len: 1.1, w: 0.8, h: 0.5, legLen: 0.3, legT: 0.1, fur: 0x3a2a1a, belly: 0x2a1c10, paw: 0x1c1208, crawl: true, scale: 1.3,
  head: { s: 0.34, snout: 0.05, snoutC: 0x2a1c10, fwd: 0.1 }, ears: 'none', eye: 0xddaa22,
  extras: both((torso) => torso.add(ball(0.58, 0.4, 0.7, 0x6a5a2a, 0, 0.26, -0.1)), horn(0x1c1208, 0.9, 0.2)),
};
PS.bombardier = {
  len: 0.9, w: 0.5, h: 0.34, legLen: 0.28, legT: 0.06, fur: 0x2a3a5a, belly: 0x2a2a30, paw: 0x14161c, crawl: true, scale: 1.0,
  head: { s: 0.26, snout: 0.05, snoutC: 0x2a2a30 }, ears: 'none', eye: 0xff8a2a,
  extras: (torso) => {
    torso.add(ball(0.44, 0.3, 0.55, 0xd2662a, 0, 0.2, -0.1)); // the orange shell
    torso.add(ball(0.2, 0.2, 0.2, 0x2a3a5a, 0, 0.1, -0.7));
  },
};
PS.tarantula = {
  len: 0.8, w: 0.6, h: 0.4, legLen: 0.4, legT: 0.08, fur: 0x5a3e28, belly: 0x4a3220, paw: 0x2a1c12, crawl: true, scale: 1.2,
  head: { s: 0.3, snout: 0.05, snoutC: 0x4a3220, fwd: 0.05 }, ears: 'none', eye: 0xdd2222,
  extras: both((torso) => torso.add(ball(0.4, 0.34, 0.48, 0x6a4a30, 0, 0.12, -0.55)), extraLegs(0x3a2818, 3, 0.8, 0.6)),
};
PS.black_widow = {
  len: 0.7, w: 0.46, h: 0.3, legLen: 0.36, legT: 0.045, fur: 0x16161a, belly: 0x0e0e12, paw: 0x0e0e12, crawl: true, scale: 1.1,
  head: { s: 0.24, snout: 0.04, snoutC: 0x0e0e12, fwd: 0.05 }, ears: 'none', eye: 0xff2a2a,
  extras: both((torso) => {
    torso.add(ball(0.34, 0.32, 0.42, 0x1c1c22, 0, 0.1, -0.5));
    torso.add(box(0.12, 0.04, 0.16, 0xe02a2a, 0, 0.34, -0.5)); // the red hourglass
  }, extraLegs(0x0e0e12, 3, 0.7, 0.55)),
};

// fish: a body with a tail fin, a dorsal fin and eyes
const FISH_FORMS: Record<string, { spec: FishSpec; scale: number }> = {
  mudskipper: { spec: { len: 0.7, h: 0.14, c: 0x8a8a5a, belly: 0xe0dcb0, fin: 0x4a7a9a }, scale: 1 },
  piranha: { spec: { len: 0.8, h: 0.22, c: 0x7a8a96, belly: 0xe05a3a, fin: 0xc23a2a }, scale: 1 },
  pufferfish: { spec: { len: 0.7, h: 0.3, c: 0xc9b26a, belly: 0xf3ecc8, fin: 0x8a7a3a }, scale: 1 },
  bull_shark: { spec: { len: 2.4, h: 0.38, c: 0x6a7a86, belly: 0xe6ecef, fin: 0x4a5864 }, scale: 1 },
  barracuda: { spec: { len: 1.8, h: 0.17, c: 0x9aa8b2, belly: 0xe8eef2, fin: 0x6a7a86 }, scale: 1 },
  eel: { spec: { len: 2.0, h: 0.1, c: 0x4a5a2a, belly: 0xe0c04a, fin: 0x3a4a22 }, scale: 1 },
  angler: { spec: { len: 1.1, h: 0.36, c: 0x4a3a2c, belly: 0x7a6650, fin: 0x2a2018 }, scale: 1 },
};

/** Re-colour a freshly built animal: the fur takes the main colour, belly, ears, tail and paws the accent. */
function recolor(b: Built, paint: Paint | undefined, key: string | undefined) {
  const spec = b.spec;
  const fur = spec.fur;
  const wantMain = !!paint && paint[0] >= 0;
  const wantAcc = !!paint && paint[1] >= 0;
  const map = new Map<number, number>();
  if (wantMain) map.set(fur, paint![0]);
  else if (!wantAcc && key) {
    // nothing chosen: every player gets their own shade of the animal's natural colours
    const shift = ((hashStr(key) % 360) / 360 + 0.08) % 1;
    const hsl = { h: 0, s: 0, l: 0 };
    const colours = new Set<number>([fur]);
    for (const c of [spec.belly, spec.earC, spec.tail?.c, spec.head.snoutC, spec.paw]) if (c !== undefined) colours.add(c);
    for (const c of colours) {
      new THREE.Color(c).getHSL(hsl);
      map.set(c, new THREE.Color().setHSL((hsl.h + shift) % 1, Math.max(hsl.s, 0.28), hsl.l).getHex());
    }
  }
  if (!map.size && !wantAcc) return;
  const dark = wantAcc ? new THREE.Color(paint![1]).multiplyScalar(0.72).getHex() : 0;
  b.root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (wantAcc && o.userData.acc) {
      o.material = mat(o.userData.acc === 2 ? dark : paint![1]);
      return;
    }
    const to = map.get((o.material as Mat).color.getHex());
    if (to !== undefined) o.material = mat(to);
  });
}

/** An articulated model for something a player controls. `key` (a player id) gives an unpainted animal its own shade. */
export function makePlayerRig(animal: string, paint?: Paint | null, key?: string): Rig {
  const fish = FISH_FORMS[animal];
  if (fish) return new FishRig(fish.spec, fish.scale);
  const spec = PS[animal] ?? PS.house_cat;
  const b = buildQuad(spec, hashStr(animal));
  recolor(b, paint ?? undefined, key);
  const def = ANIMAL_BY_ID.get(animal);
  const radius = def ? SIZE[def.size].radius : 0.5;
  return new QuadRig(b, radius);
}

/** A leader's model: the king of its swarm. */
export function makeLeaderRig(kind: string, tier: number): Rig {
  const s = 1 + (tier - 1) * 0.25;
  if (kind === 'bird') {
    const r = new BirdRig({ ...BIRDS.swarm_bird, body: 0.22, wing: 0.55, tail: 0.35, legs: 0.0 }, 1.5 * s);
    return r;
  }
  if (kind === 'shoal') {
    const r = new FishRig({ ...FISH.swarm_fish, len: 0.8, h: 0.2, c: 0x4a97c4 }, 1.4 * s);
    return r;
  }
  const spec: QuadSpec = {
    ...SPECS.rat,
    len: 0.7, w: 0.3, h: 0.3, legLen: 0.1, legT: 0.08, head: { s: 0.24, snout: 0.16 }, fur: 0x5a4f46,
    scale: 1.3 * s, tail: { len: 0.7, t: 0.04, c: 0xd9a89c }, eye: 0xff3030,
    extras: (_t, head) => {
      const c = crown();
      c.position.set(0, 0.2, 0);
      head.add(c);
    },
  };
  return new QuadRig(buildQuad(spec, 77), 0.4);
}

const mobCache = new Map<string, () => Rig>();

/** A cheap merged model for horde creatures (and the Warden). */
export function makeMobRig(id: string): Rig {
  let f = mobCache.get(id);
  if (!f) {
    f = factoryFor(id);
    mobCache.set(id, f);
  }
  return f();
}

function factoryFor(id: string): () => Rig {
  const quad = (spec: QuadSpec, scale = 1, radius = 0.4) => {
    const b = buildQuad({ ...spec }, hashStr(id));
    b.root.scale.setScalar(scale);
    const height = (spec.legLen + spec.h + spec.head.s) * scale + 0.3;
    return () => new MergedRig(b.root.clone(), false, false, 1, height, radius * scale);
  };
  switch (id) {
    case 'mouse':
    case 'rat':
    case 'rabbit':
    case 'fox':
    case 'goat':
    case 'wildpig':
      return quad(SPECS[id], 1, SPECS[id].len / 2);
    case 'swarm_rat':
      return quad({ ...SPECS.rat, fur: 0x6b5d4f }, 1, 0.3);
    case 'beetle': {
      const g = buildBeetle();
      return () => new MergedRig(g.clone(), false, false, 1, 0.4, 0.2);
    }
    case 'sparrow':
    case 'duck':
    case 'heron':
    case 'swarm_bird': {
      const spec = BIRDS[id];
      return () => new BirdRig(spec, 1);
    }
    case 'minnow':
    case 'perch':
    case 'pike':
    case 'swarm_fish': {
      const spec = FISH[id];
      return () => new FishRig(spec, 1);
    }
    case 'alpha_bear': {
      const s: QuadSpec = { ...SPECS.bear, fur: 0x3a2a20, belly: 0x2c1f18, eye: 0xdd2222, scale: 1.7, extras: (torso, head) => {
        SPECS.bear.extras?.(torso, head, Math.random);
        for (let i = 0; i < 7; i++) torso.add(cone(0.09, 0.4, 0x262626, 0, 0.58, 0.7 - i * 0.28));
        for (const sx of [-1, 1]) {
          const t = cone(0.06, 0.4, 0xf0ead8, sx * 0.2, -0.28, 0.45);
          t.rotation.x = Math.PI;
          head.add(t);
        }
      } };
      return () => new QuadRig(buildQuad(s, 91), 1.6);
    }
    case 'alpha_gator': {
      const s: QuadSpec = { ...SPECS.croc, fur: 0x35502d, scale: 1.6 };
      return () => new QuadRig(buildQuad(s, 92), 1.6);
    }
    case 'warden': {
      const s: QuadSpec = { ...SPECS.bear, fur: 0x2a2a30, belly: 0x1d1d22, eye: 0xff2222, scale: 1.25, extras: (torso) => {
        torso.add(box(1.0, 0.1, 0.1, 0x9aa0a8, 0, 0.1, 0.2));
        torso.add(box(0.8, 0.4, 0.55, 0x2a2a30, 0, 0.55, 0.4));
      } };
      return () => new QuadRig(buildQuad(s, 93), 1.2);
    }
  }
  return quad(SPECS.fox);
}

export const MOB_NAMES: Record<string, string> = {};
