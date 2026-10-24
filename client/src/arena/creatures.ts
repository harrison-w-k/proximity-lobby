// Realistic insects, arachnids and fish for the player forms of the bug and fish trees. They are built from smooth,
// properly proportioned parts (a head, thorax and abdomen with a real waist; jointed legs; a tapering fish body with
// countershading, gill plates, rayed fins) and merged into a handful of vertex-coloured meshes, so each one is cheap.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Paint } from '../../../shared/arena/paint';
import type { Rig, RigState } from './models';

type V3 = [number, number, number];
const UP = new THREE.Vector3(0, 1, 0);
const SHADOW_GEO = new THREE.CircleGeometry(1, 20);
const SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

/** Collects shapes with a colour each and merges them into one vertex-coloured mesh geometry. */
export class Parts {
  geos: THREE.BufferGeometry[] = [];
  private put(g: THREE.BufferGeometry, color: number, m: THREE.Matrix4) {
    const q = g.index ? g.toNonIndexed() : g;
    q.applyMatrix4(m);
    q.deleteAttribute('uv');
    const n = q.attributes.position.count;
    const c = new THREE.Color(color);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    q.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geos.push(q);
  }
  /** An ellipsoid with half-sizes rx, ry, rz at (x, y, z), pitched by rotX. */
  ball(rx: number, ry: number, rz: number, color: number, x = 0, y = 0, z = 0, rotX = 0, w = 12, h = 9) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, 0, 0)), new THREE.Vector3(rx, ry, rz));
    this.put(new THREE.SphereGeometry(1, w, h), color, m);
  }
  /** A tapered limb from a to b (radius r0 at a, r1 at b), with a rounded joint at each end. */
  seg(a: V3, b: V3, r0: number, r1: number, color: number, radial = 6) {
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const d = B.clone().sub(A);
    const len = d.length();
    if (len < 1e-5) return;
    const m = new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), new THREE.Vector3(1, 1, 1));
    this.put(new THREE.CylinderGeometry(r1, r0, len, radial, 1), color, m);
    this.ball(r0, r0, r0, color, a[0], a[1], a[2], 0, 6, 5);
  }
  /** A cone along +Z-ish from a to b, thick at a. */
  spike(a: V3, b: V3, r: number, color: number) {
    this.seg(a, b, r, r * 0.08, color, 5);
  }
  /** A flat polygon (a fin or a wing) given as [u, v] points, laid in the zy plane (x fixed) or the zx plane (y fixed). */
  fin(pts: [number, number][], plane: 'zy' | 'zx', fixed: number, color: number, matrix?: THREE.Matrix4) {
    const shape = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)));
    const g = new THREE.ShapeGeometry(shape);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i);
      const v = p.getY(i);
      if (plane === 'zy') p.setXYZ(i, fixed, v, u);
      else p.setXYZ(i, v, fixed, u);
    }
    g.computeVertexNormals();
    this.put(g, color, matrix ?? new THREE.Matrix4());
  }
  addGeo(g: THREE.BufferGeometry) {
    this.geos.push(g);
  }
  merged(): THREE.BufferGeometry {
    const g = mergeGeometries(this.geos, false)!;
    g.computeBoundingSphere();
    return g;
  }
}

export const mix = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
export const shade = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();

function chitin(rough = 0.42): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: 0.18, side: THREE.DoubleSide });
}

// ======================================================================================================
// insects and arachnids
// ======================================================================================================

interface Palette {
  main: number;
  acc: number;
}
export interface BugBuilt {
  root: THREE.Group;
  body: THREE.Group; // everything but the legs: the part that bobs and tilts
  head: THREE.Group;
  legs: { g: THREE.Group; side: number; row: number; idx: number }[];
  height: number;
  length: number;
  width: number;
  eight: boolean;
}

interface InsectP {
  head: V3; // half sizes w, h, l
  thorax: V3;
  abd: V3;
  petiole?: boolean; // a thin waist (ants)
  legLen: number;
  legT: number;
  legC: number;
  antLen: number;
  antC: number;
  antClub?: boolean;
  mandLen: number;
  eyeC: number;
  eyeR: number;
}

/** The legs of an insect or spider: each is a group pivoted at the body, two rigid parts joined at the knee. */
function legGroup(
  P: V3,
  K: V3,
  F: V3,
  t: number,
  c: number,
  hairy = false,
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(...P);
  const p = new Parts();
  const rel = (v: V3): V3 => [v[0] - P[0], v[1] - P[1], v[2] - P[2]];
  const k = rel(K);
  const f = rel(F);
  p.seg([0, 0, 0], k, t * 1.25, t * 0.95, c);
  p.seg(k, f, t * 0.95, t * 0.45, shade(c, 0.85));
  p.ball(t * 1.5, t * 1.5, t * 1.5, c, k[0], k[1], k[2], 0, 7, 5); // the knee
  if (hairy) for (let i = 0; i < 7; i++) {
    const u = (i + 0.5) / 7;
    const along = u < 0.5 ? [0, k, u * 2] : [k, f, (u - 0.5) * 2];
    const a = along[0] === 0 ? ([0, 0, 0] as V3) : (along[0] as V3);
    const b = along[1] as V3;
    const w = along[2] as number;
    const x = a[0] + (b[0] - a[0]) * w;
    const y = a[1] + (b[1] - a[1]) * w;
    const z = a[2] + (b[2] - a[2]) * w;
    p.spike([x, y, z], [x * 1.04 + 0.0, y + t * 2.2, z + (i % 2 ? t * 1.2 : -t * 1.2)], t * 0.32, shade(c, 1.15));
  }
  g.add(new THREE.Mesh(p.merged(), chitin(0.55)));
  return g;
}

function insectLegs(root: THREE.Group, o: InsectP, y0: number, zs: number[], w: number, legs: BugBuilt['legs']) {
  const L = o.legLen;
  zs.forEach((z, row) => {
    for (const side of [-1, 1]) {
      const dir = row === 0 ? 1 : row === 1 ? -0.1 : -1; // front legs reach forward, hind legs back
      const P: V3 = [side * w, y0, z];
      const K: V3 = [side * (w + L * 0.55), y0 + L * 0.3, z + dir * L * 0.28];
      const F: V3 = [side * (w + L * 0.92), 0.01, z + dir * L * 0.62];
      const g = legGroup(P, K, F, o.legT, o.legC);
      root.add(g);
      legs.push({ g, side, row, idx: legs.length });
    }
  });
}

function buildInsect(o: InsectP, pal: Palette, extra: (b: THREE.Group, head: THREE.Group, p: Parts, geo: { y0: number; tz: number; hz: number; az: number }) => void): BugBuilt {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const head = new THREE.Group();
  const legs: BugBuilt['legs'] = [];
  const y0 = o.legLen * 0.72 + o.thorax[1] * 0.5;
  const tz = 0;
  const hz = o.thorax[2] + o.head[2] * 0.7;
  const az = -(o.thorax[2] + o.abd[2] * (o.petiole ? 1.1 : 0.78));
  const p = new Parts();
  // thorax, with a raised mesothorax and a slightly narrower front
  p.ball(o.thorax[0], o.thorax[1], o.thorax[2], pal.main, 0, y0, tz, 0, 14, 10);
  p.ball(o.thorax[0] * 0.8, o.thorax[1] * 0.8, o.thorax[2] * 0.6, shade(pal.main, 1.1), 0, y0 + o.thorax[1] * 0.35, tz - o.thorax[2] * 0.2, 0, 12, 8);
  // the abdomen (the waist is a thin stalk for an ant)
  if (o.petiole) {
    p.ball(o.thorax[0] * 0.28, o.thorax[1] * 0.4, o.thorax[2] * 0.3, shade(pal.main, 0.9), 0, y0 + o.thorax[1] * 0.1, -(o.thorax[2] + o.abd[2] * 0.2), 0, 8, 6);
  }
  p.ball(o.abd[0], o.abd[1], o.abd[2], pal.acc, 0, y0 - o.abd[1] * 0.08, az, -0.12, 16, 12);
  // segment rings on the abdomen
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    const zz = az + o.abd[2] * (1 - t * 2) * 0.92;
    const k = Math.sqrt(Math.max(0.05, 1 - Math.pow(1 - t * 2, 2)));
    p.ball(o.abd[0] * k * 1.015, o.abd[1] * k * 1.015, o.abd[2] * 0.045, shade(pal.acc, 0.7), 0, y0 - o.abd[1] * 0.08, zz, -0.12, 12, 4);
  }
  // the head sits in its own group so it can lunge and nod
  head.position.set(0, y0 + o.thorax[1] * 0.1, hz);
  const hp = new Parts();
  hp.ball(o.head[0], o.head[1], o.head[2], shade(pal.main, 0.95), 0, 0, 0, 0, 14, 10);
  for (const s of [-1, 1]) {
    hp.ball(o.eyeR, o.eyeR * 1.15, o.eyeR * 0.9, o.eyeC, s * o.head[0] * 0.78, o.head[1] * 0.25, o.head[2] * 0.3, 0, 10, 8); // compound eyes
    // jaws that cross in front of the face
    hp.spike([s * o.head[0] * 0.38, -o.head[1] * 0.35, o.head[2] * 0.82], [-s * o.mandLen * 0.25, -o.head[1] * 0.3, o.head[2] + o.mandLen], o.mandLen * 0.22, shade(pal.main, 0.55));
    // antennae: a long first segment, then a bend (and a club for beetles)
    const base: V3 = [s * o.head[0] * 0.3, o.head[1] * 0.55, o.head[2] * 0.7];
    const elbow: V3 = [s * (o.head[0] * 0.5 + o.antLen * 0.22), o.head[1] * 0.9 + o.antLen * 0.4, o.head[2] * 0.7 + o.antLen * 0.4];
    const tip: V3 = [s * (o.head[0] * 0.9 + o.antLen * 0.5), o.head[1] + o.antLen * 0.55, o.head[2] + o.antLen * 0.95];
    hp.seg(base, elbow, o.legT * 0.5, o.legT * 0.4, o.antC, 5);
    hp.seg(elbow, tip, o.legT * 0.4, o.legT * 0.22, o.antC, 5);
    if (o.antClub) hp.ball(o.legT * 1.3, o.legT * 1.3, o.legT * 2.2, o.antC, tip[0], tip[1], tip[2], 0.4, 7, 5);
  }
  head.add(new THREE.Mesh(hp.merged(), chitin(0.38)));
  extra(body, head, p, { y0, tz, hz, az });
  body.add(new THREE.Mesh(p.merged(), chitin(0.36)));
  body.add(head);
  root.add(body);
  insectLegs(root, o, y0 - o.thorax[1] * 0.35, [o.thorax[2] * 0.55, 0, -o.thorax[2] * 0.55], o.thorax[0] * 0.8, legs);
  const length = hz + o.head[2] - az + o.abd[2];
  return { root, body, head, legs, height: y0 + o.thorax[1] + o.legLen * 0.3, length, width: o.thorax[0] * 2 + o.legLen * 1.8, eight: false };
}

/** A beetle's shell: two wing cases with a seam down the middle, set over the thorax and abdomen. */
function elytra(p: Parts, w: number, h: number, l: number, c: number, y: number, z: number) {
  for (const s of [-1, 1]) {
    p.ball(w * 0.5, h, l, c, s * w * 0.255, y, z, -0.06, 14, 10);
    p.ball(w * 0.12, h * 0.4, l * 0.8, mix(c, 0xffffff, 0.3), s * w * 0.2, y + h * 0.7, z, -0.06, 8, 6); // a sheen on each case
  }
  p.seg([0, y + h * 0.95, z + l * 0.9], [0, y + h * 0.9, z - l * 0.95], 0.012, 0.012, shade(c, 0.35), 4);
}

function buildSpider(
  pal: Palette,
  o: { ceph: V3; abd: V3; legLen: number; legT: number; legC: number; eyeC: number; fang: number; hairy?: boolean; reach: number },
  extra: (p: Parts, g: { y0: number; az: number }) => void,
): BugBuilt {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const head = new THREE.Group();
  const legs: BugBuilt['legs'] = [];
  const L = o.legLen;
  const y0 = L * 0.62;
  const p = new Parts();
  p.ball(o.ceph[0], o.ceph[1], o.ceph[2], pal.main, 0, y0, 0, 0, 14, 10); // cephalothorax
  p.ball(o.ceph[0] * 0.6, o.ceph[1] * 0.55, o.ceph[2] * 0.5, shade(pal.main, 1.12), 0, y0 + o.ceph[1] * 0.5, -o.ceph[2] * 0.1, 0, 10, 7); // the carapace dome
  p.ball(o.ceph[0] * 0.3, o.ceph[1] * 0.3, o.ceph[2] * 0.25, shade(pal.main, 0.8), 0, y0 - o.ceph[1] * 0.05, -o.ceph[2] * 0.95, 0, 8, 6); // pedicel
  const az = -(o.ceph[2] + o.abd[2] * 0.82);
  p.ball(o.abd[0], o.abd[1], o.abd[2], pal.acc, 0, y0 + o.abd[1] * 0.1, az, -0.18, 18, 14);
  // the face: eight beads, two big, clustered in two rows, with chelicerae and palps below
  head.position.set(0, y0, o.ceph[2] * 0.82);
  const hp = new Parts();
  const eyes: V3[] = [[0.3, 0.28, 0.2], [-0.3, 0.28, 0.2], [0.14, 0.32, 0.12], [-0.14, 0.32, 0.12], [0.5, 0.18, 0.08], [-0.5, 0.18, 0.08], [0.36, 0.38, -0.02], [-0.36, 0.38, -0.02]];
  eyes.forEach(([x, y, z], i) => {
    const r = i < 2 ? o.ceph[0] * 0.17 : o.ceph[0] * 0.1;
    hp.ball(r, r, r, o.eyeC, x * o.ceph[0], y * o.ceph[1] + o.ceph[1] * 0.2, z * o.ceph[2], 0, 8, 6);
  });
  for (const s of [-1, 1]) {
    hp.ball(o.ceph[0] * 0.24, o.ceph[1] * 0.5, o.ceph[0] * 0.24, shade(pal.main, 0.8), s * o.ceph[0] * 0.28, -o.ceph[1] * 0.35, o.ceph[2] * 0.2, 0, 8, 6); // chelicerae
    hp.spike([s * o.ceph[0] * 0.28, -o.ceph[1] * 0.7, o.ceph[2] * 0.25], [s * o.ceph[0] * 0.2, -o.ceph[1] * 0.7 - o.fang, o.ceph[2] * 0.4], o.ceph[0] * 0.07, 0x1a0f08); // fangs
    const palp0: V3 = [s * o.ceph[0] * 0.55, -o.ceph[1] * 0.2, o.ceph[2] * 0.15];
    hp.seg(palp0, [s * o.ceph[0] * 0.6, -o.ceph[1] * 0.4, o.ceph[2] * 0.75], o.legT * 0.8, o.legT * 0.6, shade(pal.main, 0.9)); // palps
    hp.ball(o.legT * 0.9, o.legT * 0.9, o.legT * 1.1, shade(pal.main, 0.9), s * o.ceph[0] * 0.6, -o.ceph[1] * 0.4, o.ceph[2] * 0.75, 0, 6, 5);
  }
  head.add(new THREE.Mesh(hp.merged(), chitin(0.3)));
  extra(p, { y0, az });
  body.add(new THREE.Mesh(p.merged(), chitin(o.hairy ? 0.85 : 0.28)));
  body.add(head);
  root.add(body);
  // eight legs from the cephalothorax in four rows: a high knee, then a long drop to the ground
  const rows = [0.7, 0.28, -0.2, -0.65];
  rows.forEach((rz, row) => {
    for (const side of [-1, 1]) {
      const z = rz * o.ceph[2];
      const fan = row === 0 ? 1 : row === 1 ? 0.45 : row === 2 ? -0.35 : -1; // how far each pair points forward or back
      const P: V3 = [side * o.ceph[0] * 0.75, y0 - o.ceph[1] * 0.1, z];
      const K: V3 = [side * (o.ceph[0] * 0.75 + L * 0.5), y0 + L * 0.6, z + fan * L * 0.38 * o.reach];
      const F: V3 = [side * (o.ceph[0] * 0.75 + L * 1.0), 0.01, z + fan * L * 0.85 * o.reach];
      const g = legGroup(P, K, F, o.legT, o.legC, !!o.hairy);
      root.add(g);
      legs.push({ g, side, row, idx: legs.length });
    }
  });
  const length = o.ceph[2] * 2 + o.abd[2] * 1.7;
  return { root, body, head, legs, height: y0 + o.ceph[1] + L * 0.3, length, width: (o.ceph[0] + L) * 2, eight: true };
}

type BugKind = 'ant' | 'beetle' | 'hercules' | 'bombardier' | 'spider' | 'tarantula' | 'black_widow' | 'scorpion' | 'emperor_scorpion' | 'deathstalker';

const BUG_PAL: Record<BugKind, Palette> = {
  ant: { main: 0x3a1e14, acc: 0x241410 },
  beetle: { main: 0x1b2c34, acc: 0x1e5a62 },
  hercules: { main: 0x1c1610, acc: 0x8a7a3a },
  bombardier: { main: 0xd2692a, acc: 0x1c2c52 },
  spider: { main: 0x6a5238, acc: 0x4a3a28 },
  tarantula: { main: 0x4a3322, acc: 0x3a281a },
  black_widow: { main: 0x121216, acc: 0x0c0c10 },
  scorpion: { main: 0x9a7a3a, acc: 0x86652c },
  emperor_scorpion: { main: 0x1a1a22, acc: 0x121218 },
  deathstalker: { main: 0xdcc66a, acc: 0xcdb457 },
};

/** A scorpion's pincers and its curled, stinging tail, scaled by `sc`. */
function scorpionParts(p: Parts, g: { y0: number; az: number }, sc: number, claw: number, tailC: number, sting: number) {
  for (const s of [-1, 1]) {
    // pedipalps: an arm that reaches out and forward, ending in a pincer
    const a: V3 = [s * 0.16 * sc, g.y0, 0.2 * sc];
    const b: V3 = [s * 0.34 * sc, g.y0 + 0.02 * sc, 0.5 * sc];
    const c: V3 = [s * 0.24 * sc, g.y0, 0.78 * sc];
    p.seg(a, b, 0.05 * sc, 0.042 * sc, claw, 7);
    p.seg(b, c, 0.042 * sc, 0.038 * sc, claw, 7);
    p.ball(0.075 * sc, 0.05 * sc, 0.12 * sc, shade(claw, 1.08), s * 0.22 * sc, g.y0, 0.9 * sc, 0, 9, 7);
    p.spike([s * 0.14 * sc, g.y0, 0.96 * sc], [s * 0.04 * sc, g.y0, 1.22 * sc], 0.04 * sc, shade(claw, 0.8));
    p.spike([s * 0.31 * sc, g.y0, 0.96 * sc], [s * 0.34 * sc, g.y0, 1.2 * sc], 0.034 * sc, shade(claw, 0.8));
  }
  // the tail: segments arching up and forward over the back, ending in a stinger
  const pts: V3[] = [[0, 0, -0.1], [0, 0.12, -0.28], [0, 0.3, -0.36], [0, 0.5, -0.3], [0, 0.64, -0.14], [0, 0.7, 0.06]].map(([x, y, z]) => [x, g.y0 + y * sc, g.az + z * sc] as V3);
  for (let i = 1; i < pts.length; i++) {
    const r0 = (0.062 - i * 0.006) * sc;
    p.seg(pts[i - 1], pts[i], r0, r0 * 0.9, i % 2 ? tailC : shade(tailC, 0.9), 7);
    p.ball(r0 * 1.1, r0 * 1.1, r0 * 1.1, shade(tailC, 0.8), pts[i][0], pts[i][1], pts[i][2], 0, 6, 5);
  }
  const tip = pts[pts.length - 1];
  p.ball(0.06 * sc, 0.06 * sc, 0.07 * sc, tailC, tip[0], tip[1], tip[2] + 0.02 * sc, 0, 8, 6); // the venom bulb
  p.spike([tip[0], tip[1], tip[2] + 0.05 * sc], [tip[0], tip[1] - 0.14 * sc, tip[2] + 0.14 * sc], 0.03 * sc, sting);
}

function buildBug(kind: BugKind, paint?: Paint | null): BugBuilt {
  const base = BUG_PAL[kind];
  const pal: Palette = { main: paint && paint[0] >= 0 ? paint[0] : base.main, acc: paint && paint[1] >= 0 ? paint[1] : base.acc };
  switch (kind) {
    case 'ant':
      return buildInsect(
        { head: [0.1, 0.085, 0.11], thorax: [0.075, 0.08, 0.17], abd: [0.13, 0.12, 0.21], petiole: true, legLen: 0.42, legT: 0.017, legC: shade(pal.main, 0.8), antLen: 0.28, antC: shade(pal.main, 0.9), mandLen: 0.09, eyeC: 0x0a0806, eyeR: 0.035 },
        pal,
        () => {},
      );
    case 'beetle':
      return buildInsect(
        { head: [0.12, 0.09, 0.1], thorax: [0.2, 0.11, 0.13], abd: [0.2, 0.1, 0.12], legLen: 0.3, legT: 0.032, legC: 0x15181c, antLen: 0.2, antC: 0x15181c, antClub: true, mandLen: 0.07, eyeC: 0x0a0a0a, eyeR: 0.03 },
        pal,
        (_b, _h, p, g) => {
          elytra(p, 0.5, 0.17, 0.34, pal.acc, g.y0 + 0.1, -0.2);
          p.ball(0.22, 0.09, 0.13, shade(pal.main, 1.15), 0, g.y0 + 0.1, 0.1, 0, 12, 8); // the pronotum shield
        },
      );
    case 'hercules':
      return buildInsect(
        { head: [0.14, 0.1, 0.12], thorax: [0.26, 0.15, 0.2], abd: [0.26, 0.14, 0.16], legLen: 0.4, legT: 0.045, legC: 0x120e0a, antLen: 0.2, antC: 0x120e0a, antClub: true, mandLen: 0.06, eyeC: 0x080808, eyeR: 0.035 },
        pal,
        (_b, head, p, g) => {
          elytra(p, 0.64, 0.21, 0.42, pal.acc, g.y0 + 0.13, -0.3);
          for (let i = 0; i < 16; i++) p.ball(0.022, 0.016, 0.022, 0x14100a, ((i * 37) % 11 - 5) * 0.05, g.y0 + 0.34, -0.55 + (i % 8) * 0.1, 0, 5, 4); // dark speckles
          p.ball(0.28, 0.12, 0.17, 0x0c0906, 0, g.y0 + 0.1, 0.1, 0, 12, 8);
          // the great horn on the thorax curves forward and up, with a smaller one on the head to meet it
          const h0: V3 = [0, g.y0 + 0.18, 0.2];
          p.seg(h0, [0, g.y0 + 0.5, 0.42], 0.075, 0.05, 0x0c0906, 7);
          p.seg([0, g.y0 + 0.5, 0.42], [0, g.y0 + 0.62, 0.78], 0.05, 0.02, 0x0c0906, 7);
          p.seg([-0.03, g.y0 + 0.62, 0.78], [-0.1, g.y0 + 0.56, 0.9], 0.02, 0.008, 0x0c0906, 5);
          p.seg([0.03, g.y0 + 0.62, 0.78], [0.1, g.y0 + 0.56, 0.9], 0.02, 0.008, 0x0c0906, 5);
          const hp = new Parts();
          hp.seg([0, 0.02, 0.1], [0, 0.2, 0.42], 0.045, 0.02, 0x0c0906, 6);
          head.add(new THREE.Mesh(hp.merged(), chitin(0.4)));
        },
      );
    case 'bombardier':
      return buildInsect(
        { head: [0.1, 0.08, 0.1], thorax: [0.1, 0.085, 0.14], abd: [0.15, 0.1, 0.24], legLen: 0.5, legT: 0.02, legC: 0xd2692a, antLen: 0.34, antC: 0xd2692a, mandLen: 0.07, eyeC: 0x0a0808, eyeR: 0.03 },
        pal,
        (_b, _h, p, g) => {
          for (const s of [-1, 1]) p.ball(0.095, 0.075, 0.27, pal.acc, s * 0.06, g.y0 + 0.07, -0.34, -0.1, 10, 8); // the long blue-black wing cases
          p.ball(0.11, 0.07, 0.1, pal.main, 0, g.y0 + 0.05, 0.08, 0, 10, 7);
          p.seg([0, g.y0 - 0.02, g.az - 0.2], [0, g.y0 - 0.03, g.az - 0.38], 0.03, 0.018, 0xff7a2a, 6); // the spray nozzle
        },
      );
    case 'spider':
      return buildSpider(pal, { ceph: [0.17, 0.12, 0.22], abd: [0.22, 0.2, 0.3], legLen: 0.46, legT: 0.02, legC: shade(pal.main, 0.85), eyeC: 0x050505, fang: 0.07, reach: 1 }, (p, g) => {
        for (let i = 0; i < 5; i++) {
          const zc = 0.16 - i * 0.075; // chevrons down the top of the abdomen
          p.ball(0.1 - i * 0.012, 0.01, 0.026, 0xe0cfa8, 0, g.y0 + 0.02 + 0.2 * 0.99 * Math.sqrt(Math.max(0.05, 1 - (zc / 0.3) ** 2)), g.az + zc, -0.18, 8, 4);
        }
      });
    case 'tarantula':
      return buildSpider(pal, { ceph: [0.24, 0.16, 0.3], abd: [0.28, 0.24, 0.36], legLen: 0.6, legT: 0.048, legC: shade(pal.main, 0.9), eyeC: 0x060505, fang: 0.1, hairy: true, reach: 0.9 }, (p, g) => {
        for (let i = 0; i < 70; i++) {
          const a = i * 2.399;
          const u = ((i * 0.618) % 1) * 2 - 1;
          const rr = Math.sqrt(1 - u * u);
          const c: V3 = [Math.cos(a) * rr * 0.28, g.y0 + 0.06 + u * 0.24, g.az + Math.sin(a) * rr * 0.36];
          p.spike(c, [c[0] * 1.12, c[1] + 0.045, c[2] * 1.05 - 0.02], 0.009, i % 4 === 0 ? 0xc09a6a : shade(pal.acc, 1.4)); // the abdomen's bristles
        }
      });
    case 'scorpion':
      return buildSpider(pal, { ceph: [0.2, 0.09, 0.24], abd: [0.16, 0.1, 0.34], legLen: 0.3, legT: 0.026, legC: shade(pal.main, 0.8), eyeC: 0x120c06, fang: 0.04, reach: 0.8 }, (p, g) => scorpionParts(p, g, 1, shade(pal.main, 1.05), pal.acc, 0x2a1a0c));
    case 'emperor_scorpion':
      return buildSpider(pal, { ceph: [0.32, 0.13, 0.36], abd: [0.24, 0.14, 0.5], legLen: 0.42, legT: 0.04, legC: 0x101016, eyeC: 0x1a1a22, fang: 0.06, reach: 0.8 }, (p, g) => scorpionParts(p, g, 1.5, 0x20202a, 0x16161c, 0x0a0a0e));
    case 'deathstalker':
      return buildSpider(pal, { ceph: [0.17, 0.075, 0.22], abd: [0.12, 0.075, 0.3], legLen: 0.28, legT: 0.02, legC: shade(pal.main, 0.85), eyeC: 0x120c06, fang: 0.03, reach: 0.85 }, (p, g) => scorpionParts(p, g, 0.95, 0xe8d37a, 0xb8a040, 0x5a4010));
    case 'black_widow':
      return buildSpider(pal, { ceph: [0.12, 0.09, 0.15], abd: [0.2, 0.2, 0.24], legLen: 0.5, legT: 0.014, legC: 0x0a0a0d, eyeC: 0x111118, fang: 0.05, reach: 1.1 }, (p, g) => {
        // the red hourglass on the belly
        const y = g.y0 + 0.04;
        p.fin([[-0.04, 0], [0.04, 0], [0.012, -0.05], [0.04, -0.1], [-0.04, -0.1], [-0.012, -0.05]], 'zx', y - 0.1, 0xd01818, new THREE.Matrix4().makeTranslation(0, 0, g.az + 0.05));
        p.ball(0.05, 0.03, 0.06, 0xd01818, 0, g.y0 + 0.19, g.az - 0.2, -0.2, 7, 5);
      });
  }
}

export class BugRig implements Rig {
  root = new THREE.Group();
  height: number;
  radius: number;
  private mats: THREE.MeshStandardMaterial[] = [];
  private phase = Math.random() * 6;
  private flash = 0;
  private tint: number | null = null;
  private shadow: THREE.Mesh;
  private shadowR: number;
  private baseBodyY = 0;
  constructor(private b: BugBuilt, radius: number, scale: number) {
    this.root.add(b.root);
    b.root.scale.setScalar(scale);
    this.height = b.height * scale + 0.5;
    this.radius = radius;
    this.shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.05;
    this.shadowR = Math.max(b.width, b.length) * 0.5 * scale;
    this.root.add(this.shadow);
    b.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.material = (o.material as THREE.MeshStandardMaterial).clone();
        this.mats.push(o.material as THREE.MeshStandardMaterial);
      }
    });
  }
  setTint(c: number | null) {
    this.tint = c;
  }
  update(dt: number, s: RigState) {
    const b = this.b;
    const moving = Math.min(1, s.speed / 3);
    this.phase += dt * (4 + s.speed * 2.6);
    const pose = s.pose;
    const rate = b.eight ? 1 : 1;
    for (const l of b.legs) {
      // insects walk in tripods (front-left, middle-right, hind-left against the rest); spiders alternate diagonally
      const grp = b.eight ? (l.row + (l.side > 0 ? 1 : 0)) % 2 : (l.row + (l.side > 0 ? 1 : 0)) % 2;
      const ph = this.phase * rate + grp * Math.PI;
      const sw = Math.sin(ph) * 0.42 * moving;
      const lift = Math.max(0, Math.cos(ph)) * 0.34 * moving;
      let yaw = sw * (l.row === 0 ? 1 : 1);
      if (pose && l.row === 0) yaw += (l.side < 0 ? pose.fl : pose.fr) * 0.8; // raise or swing the front legs in an attack
      if (s.stun) yaw += Math.sin(s.t * 14 + l.idx) * 0.08;
      l.g.rotation.y = yaw * -l.side * -1;
      l.g.rotation.z = l.side * (lift + (s.air ?? 0 > 0 ? 0.35 : 0));
    }
    const bob = Math.abs(Math.sin(this.phase)) * 0.012 * moving;
    b.body.position.y = bob + (pose?.y ?? 0) + (s.guard ? -0.04 : 0);
    b.body.position.z = pose?.z ?? 0;
    b.body.rotation.x = (pose?.rx ?? 0) * 0.6;
    b.body.rotation.y = (pose?.ry ?? 0) * 0.5;
    b.body.rotation.z = -(s.turn ?? 0) * 0.04 + (pose?.rz ?? 0);
    b.head.rotation.x = (pose?.hx ?? 0) * 0.7 + Math.sin(s.t * 0.9 + this.phase * 0.1) * 0.03 - s.attack * 0.35;
    b.head.rotation.y = (pose?.hy ?? 0) + Math.sin(s.t * 1.7) * 0.05 * (1 - moving);
    const sc = pose?.sc ?? 1;
    this.root.scale.setScalar(sc);
    const lift = Math.min(1, (s.air ?? 0) * 1.5);
    const sk = this.shadowR * (1 - lift * 0.35);
    this.shadow.scale.set(sk, sk * 1.15, 1);
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

export const BUG_KINDS = new Set<string>(['ant', 'beetle', 'hercules', 'bombardier', 'spider', 'tarantula', 'black_widow', 'scorpion', 'emperor_scorpion', 'deathstalker']);
export function makeBugRig(kind: string, paint: Paint | null | undefined, radius: number): Rig {
  const k = kind as BugKind;
  const b = buildBug(k, paint);
  return new BugRig(b, radius, 1);
}

// ======================================================================================================
// fish
// ======================================================================================================

interface FishP {
  len: number;
  /** [u along the body from the nose (0) to the tail root (1), half-width, top, bottom] */
  prof: [number, number, number, number][];
  back: number;
  belly: number;
  fin: number;
  fin2?: number;
  /** extra darker markings: 'bars' | 'dots' | 'mottle' | 'none' */
  mark: 'bars' | 'dots' | 'mottle' | 'none' | 'stripe';
  markC: number;
  eyeR: number;
  eyeU: number;
  eyeY: number;
  eyeC: number;
  tailLen: number; // the tail fin's length behind the body
  tailH: number;
  tail: 'fork' | 'round' | 'shark' | 'ribbon';
}

const FISH_P: Record<string, FishP> = {
  // a small amphibious fish on land: a big head, bulging eyes high on top, and arm-like pectoral fins
  mudskipper: {
    len: 0.7, prof: [[0, 0.01, 0.01, 0.01], [0.06, 0.06, 0.07, 0.05], [0.18, 0.1, 0.11, 0.08], [0.4, 0.1, 0.11, 0.08], [0.7, 0.065, 0.08, 0.06], [0.95, 0.03, 0.045, 0.035], [1, 0.015, 0.03, 0.03]],
    back: 0x6f6a45, belly: 0xc8c49a, fin: 0x4a7a9a, fin2: 0x2f5a7a, mark: 'dots', markC: 0x2a5a8a, eyeR: 0.035, eyeU: 0.9, eyeY: 0.0, eyeC: 0xc9a040, tailLen: 0.14, tailH: 0.09, tail: 'round',
  },
  // deep, flat-sided, silver-grey with a red throat and belly, and a heavy underbite lined with triangular teeth
  piranha: {
    len: 0.8, prof: [[0, 0.012, 0.02, 0.02], [0.05, 0.05, 0.07, 0.06], [0.2, 0.09, 0.16, 0.14], [0.45, 0.1, 0.2, 0.17], [0.7, 0.07, 0.14, 0.1], [0.92, 0.035, 0.07, 0.06], [1, 0.02, 0.05, 0.045]],
    back: 0x5a6a74, belly: 0xc2432f, fin: 0x992a22, fin2: 0x3d4a54, mark: 'dots', markC: 0x21282d, eyeR: 0.034, eyeU: 0.55, eyeY: 0.04, eyeC: 0xd9382a, tailLen: 0.16, tailH: 0.13, tail: 'fork',
  },
  // a round, slow fish: a short spindle body that can inflate, tiny fins and a beak
  pufferfish: {
    len: 0.7, prof: [[0, 0.02, 0.025, 0.025], [0.05, 0.1, 0.12, 0.1], [0.25, 0.22, 0.24, 0.22], [0.55, 0.23, 0.25, 0.22], [0.82, 0.12, 0.13, 0.12], [1, 0.03, 0.05, 0.05]],
    back: 0xb59a52, belly: 0xf1e8c4, fin: 0xc9b87a, mark: 'dots', markC: 0x4f4426, eyeR: 0.05, eyeU: 0.7, eyeY: 0.07, eyeC: 0x2a4a2a, tailLen: 0.14, tailH: 0.1, tail: 'round',
  },
  // a thick-bodied grey shark with a blunt rounded snout, tall first dorsal and big pectoral fins
  bull_shark: {
    len: 2.4, prof: [[0, 0.02, 0.03, 0.03], [0.04, 0.1, 0.1, 0.07], [0.15, 0.2, 0.2, 0.15], [0.35, 0.26, 0.3, 0.22], [0.6, 0.18, 0.22, 0.17], [0.85, 0.07, 0.09, 0.08], [1, 0.03, 0.045, 0.04]],
    back: 0x66737c, belly: 0xe8eceb, fin: 0x55616a, mark: 'none', markC: 0x4a555d, eyeR: 0.03, eyeU: 0.75, eyeY: 0.0, eyeC: 0x111111, tailLen: 0.5, tailH: 0.42, tail: 'shark',
  },
  // a wide, flat head with long whiskers, a smooth mottled body and no scales
  catfish: {
    len: 1.3, prof: [[0, 0.05, 0.05, 0.035], [0.06, 0.14, 0.1, 0.07], [0.2, 0.17, 0.15, 0.1], [0.45, 0.13, 0.15, 0.12], [0.75, 0.08, 0.1, 0.08], [1, 0.03, 0.05, 0.04]],
    back: 0x5c5a46, belly: 0xd8d2b0, fin: 0x4a4838, mark: 'mottle', markC: 0x34322a, eyeR: 0.028, eyeU: 0.85, eyeY: 0.0, eyeC: 0x2a2418, tailLen: 0.24, tailH: 0.2, tail: 'round',
  },
  // a long, slim, blue-backed hunter with a spear for a nose and a tall sail of a fin
  swordfish: {
    len: 2.6, prof: [[0, 0.008, 0.012, 0.012], [0.12, 0.07, 0.09, 0.08], [0.3, 0.15, 0.21, 0.17], [0.6, 0.12, 0.18, 0.14], [0.85, 0.05, 0.07, 0.06], [1, 0.02, 0.03, 0.03]],
    back: 0x344f7a, belly: 0xdfe6ea, fin: 0x26385a, mark: 'none', markC: 0x26385a, eyeR: 0.04, eyeU: 0.6, eyeY: 0.0, eyeC: 0x0c0c0c, tailLen: 0.55, tailH: 0.46, tail: 'shark',
  },
  // an ancient fish: a long body in rows of bony plates, a pointed snout and a shark-like tail
  sturgeon: {
    len: 2.2, prof: [[0, 0.02, 0.03, 0.02], [0.14, 0.08, 0.08, 0.05], [0.32, 0.15, 0.15, 0.1], [0.6, 0.15, 0.16, 0.11], [0.86, 0.06, 0.08, 0.06], [1, 0.02, 0.04, 0.04]],
    back: 0x5d6a5a, belly: 0xe0dcc4, fin: 0x485648, mark: 'none', markC: 0x3a463a, eyeR: 0.026, eyeU: 0.7, eyeY: 0.0, eyeC: 0x14140c, tailLen: 0.5, tailH: 0.34, tail: 'shark',
  },
  // a long, slender torpedo with a pointed head, a jutting lower jaw full of fangs, and dark bars on silver
  barracuda: {
    len: 1.8, prof: [[0, 0.01, 0.015, 0.015], [0.1, 0.045, 0.05, 0.045], [0.25, 0.07, 0.09, 0.08], [0.55, 0.09, 0.12, 0.1], [0.82, 0.055, 0.07, 0.06], [1, 0.02, 0.03, 0.03]],
    back: 0x69808e, belly: 0xe7edf0, fin: 0x55666f, mark: 'bars', markC: 0x34434b, eyeR: 0.03, eyeU: 0.5, eyeY: 0.02, eyeC: 0xe0b020, tailLen: 0.3, tailH: 0.2, tail: 'fork',
  },
  // a cylindrical, scaleless body that runs most of its length, with the ribbon-like anal fin along the belly
  eel: {
    len: 2.0, prof: [[0, 0.025, 0.04, 0.03], [0.05, 0.07, 0.08, 0.07], [0.15, 0.09, 0.1, 0.09], [0.5, 0.08, 0.1, 0.1], [0.85, 0.05, 0.07, 0.07], [1, 0.015, 0.03, 0.03]],
    back: 0x4f5b2c, belly: 0xd9a63c, fin: 0x6b7a3a, mark: 'mottle', markC: 0x2a3216, eyeR: 0.022, eyeU: 0.7, eyeY: 0.03, eyeC: 0x111111, tailLen: 0.06, tailH: 0.05, tail: 'ribbon',
  },
  // a globular deep-sea hunter: a huge upturned mouth of long fangs and a glowing lure on a stalk
  angler: {
    len: 1.1, prof: [[0, 0.03, 0.11, 0.1], [0.08, 0.2, 0.26, 0.22], [0.3, 0.3, 0.36, 0.3], [0.6, 0.23, 0.28, 0.22], [0.85, 0.09, 0.12, 0.09], [1, 0.03, 0.06, 0.05]],
    back: 0x3f3226, belly: 0x6a5a48, fin: 0x2c231b, mark: 'mottle', markC: 0x1f1812, eyeR: 0.04, eyeU: 0.7, eyeY: 0.14, eyeC: 0xd9c070, tailLen: 0.18, tailH: 0.15, tail: 'round',
  },
};

function profileAt(prof: FishP['prof'], u: number): [number, number, number] {
  for (let i = 1; i < prof.length; i++) {
    if (u <= prof[i][0]) {
      const a = prof[i - 1];
      const b = prof[i];
      const t = (u - a[0]) / Math.max(1e-6, b[0] - a[0]);
      const s = t * t * (3 - 2 * t);
      return [a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s, a[3] + (b[3] - a[3]) * s];
    }
  }
  const e = prof[prof.length - 1];
  return [e[1], e[2], e[3]];
}

function fishBody(f: FishP, pal: { back: number; belly: number; fin: number }, name: string): THREE.BufferGeometry {
  const ST = 34;
  const RING = 16;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const back = new THREE.Color(pal.back);
  const belly = new THREE.Color(pal.belly);
  const mark = new THREE.Color(f.markC);
  for (let i = 0; i <= ST; i++) {
    const u = i / ST;
    const z = f.len * (0.5 - u);
    const [w, top, bot] = profileAt(f.prof, u);
    for (let j = 0; j < RING; j++) {
      const a = (j / RING) * Math.PI * 2;
      const sx = Math.sin(a);
      const cy = Math.cos(a);
      pos.push(sx * w, cy >= 0 ? cy * top : cy * bot, z);
      // countershading: a dark back fading through the flanks to a pale belly, with a soft lateral line
      const t = THREE.MathUtils.smoothstep(-cy, -0.25, 0.4);
      const c = back.clone().lerp(belly, t);
      if (name === 'eel' && u < 0.22 && cy < 0.1) c.set(0xd9732a); // the orange throat
      let m = 0;
      if (f.mark === 'bars') m = Math.max(0, Math.sin(u * 40)) > 0.55 && cy > -0.15 ? 0.55 : 0;
      else if (f.mark === 'dots') m = (Math.sin(u * 60 + sx * 5) * Math.sin(a * 5 + u * 20) > 0.55) && cy > -0.2 ? 0.6 : 0;
      else if (f.mark === 'mottle') m = (Math.sin(u * 37 + a * 3) * Math.sin(u * 23 - a * 2) > 0.2) ? 0.45 : 0;
      else if (f.mark === 'stripe') m = Math.abs(cy) < 0.15 ? 0.5 : 0;
      if (m) c.lerp(mark, m * (0.6 + 0.4 * Math.sin(u * 17 + j)));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < ST; i++) {
    for (let j = 0; j < RING; j++) {
      const a = i * RING + j;
      const b = i * RING + ((j + 1) % RING);
      const c = (i + 1) * RING + j;
      const d = (i + 1) * RING + ((j + 1) % RING);
      idx.push(a, c, b, b, c, d);
    }
  }
  // close the nose with a cap
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals(); // smooth along the body: a fish is one continuous skin
  return g.toNonIndexed();
}

function buildFish(name: string, paint?: Paint | null): { geo: THREE.BufferGeometry; len: number; height: number; width: number } {
  const f = FISH_P[name];
  const pal = {
    back: paint && paint[0] >= 0 ? paint[0] : f.back,
    belly: paint && paint[0] >= 0 ? mix(paint[0], 0xffffff, 0.6) : f.belly,
    fin: paint && paint[1] >= 0 ? paint[1] : f.fin,
  };
  const p = new Parts();
  p.addGeo(fishBody(f, pal, name));
  const L = f.len;
  const zAt = (u: number) => L * (0.5 - u);
  const top = (u: number) => profileAt(f.prof, u)[1];
  const bot = (u: number) => profileAt(f.prof, u)[2];
  const wid = (u: number) => profileAt(f.prof, u)[0];
  const finC = pal.fin;
  const fin2 = f.fin2 ?? shade(finC, 0.8);

  // tail: the caudal fin, in the vertical plane behind the body
  const zt = zAt(1);
  const th = f.tailH;
  const tl = f.tailLen;
  if (f.tail === 'fork') p.fin([[0, 0], [-tl, th], [-tl * 0.55, 0], [-tl, -th]], 'zy', 0, finC, new THREE.Matrix4().makeTranslation(0, 0, zt));
  else if (f.tail === 'round') p.fin([[0, 0.02], [-tl * 0.5, th * 0.8], [-tl, th * 0.5], [-tl * 1.05, 0], [-tl, -th * 0.5], [-tl * 0.5, -th * 0.8], [0, -0.02]], 'zy', 0, finC, new THREE.Matrix4().makeTranslation(0, 0, zt));
  else if (f.tail === 'shark') p.fin([[0, 0.02], [-tl * 0.5, th * 0.7], [-tl * 1.1, th * 1.05], [-tl * 0.8, th * 0.35], [-tl * 0.55, 0], [-tl * 0.75, -th * 0.55], [-tl * 0.3, -th * 0.5], [0, -0.02]], 'zy', 0, finC, new THREE.Matrix4().makeTranslation(0, 0, zt));
  else p.fin([[0, 0.02], [-tl, 0.03], [-tl, -0.03], [0, -0.02]], 'zy', 0, finC, new THREE.Matrix4().makeTranslation(0, 0, zt));

  // dorsal fin(s)
  const dorsal = (u0: number, u1: number, h: number, c: number, sweep = 0.5) => {
    const z0 = zAt(u0);
    const z1 = zAt(u1);
    const yb0 = top(u0) * 0.92;
    const yb1 = top(u1) * 0.92;
    p.fin([[z0, yb0], [z0 - (z0 - z1) * sweep * 0.5, yb0 + h], [z1 + (z0 - z1) * 0.1, yb1 + h * 0.35], [z1, yb1]].map(([z, y]) => [z, y] as [number, number]), 'zy', 0, c);
  };
  const anal = (u0: number, u1: number, h: number, c: number) => {
    const z0 = zAt(u0);
    const z1 = zAt(u1);
    p.fin([[z0, -bot(u0) * 0.9], [z0 - (z0 - z1) * 0.35, -bot(u0) * 0.9 - h], [z1, -bot(u1) * 0.9 - h * 0.3], [z1, -bot(u1) * 0.9]], 'zy', 0, c);
  };
  // the paired fins
  const pair = (u: number, len: number, wide: number, yFrac: number, c: number, droop: number) => {
    for (const s of [-1, 1]) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(s * wid(u) * 0.95, -bot(u) * yFrac, zAt(u)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s * -0.25, s * droop)), new THREE.Vector3(1, 1, 1));
      p.fin([[0, 0], [-len * 0.2, wide], [-len, wide * 0.35], [-len * 0.85, -wide * 0.1]], 'zx', 0, c, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeScale(1, 1, s)));
    }
  };

  switch (name) {
    case 'mudskipper':
      dorsal(0.22, 0.52, 0.12, fin2, 0.7);
      dorsal(0.56, 0.8, 0.08, finC, 0.5);
      anal(0.6, 0.82, 0.05, finC);
      pair(0.2, 0.2, 0.07, 0.45, shade(finC, 1.1), 0.9); // the muscular arm-like pectorals it props itself up on
      break;
    case 'piranha':
      dorsal(0.3, 0.52, 0.1, fin2, 0.6);
      anal(0.5, 0.84, 0.08, finC);
      pair(0.22, 0.14, 0.05, 0.55, finC, 0.4);
      break;
    case 'pufferfish':
      dorsal(0.62, 0.78, 0.07, finC, 0.5);
      anal(0.62, 0.78, 0.06, finC);
      pair(0.3, 0.1, 0.07, 0.35, finC, 0.2);
      for (let i = 0; i < 70; i++) {
        // a scatter of short spines over the body that show when it puffs
        const u = 0.12 + ((i * 0.61803) % 1) * 0.62;
        const a = i * 2.39996;
        const [w, t, b] = profileAt(f.prof, u);
        const x = Math.sin(a) * w;
        const y = Math.cos(a) >= 0 ? Math.cos(a) * t : Math.cos(a) * b;
        p.spike([x, y, zAt(u)], [x * 1.22, y * 1.22, zAt(u)], 0.012, 0xe9e0bd);
      }
      p.ball(0.045, 0.03, 0.03, 0x3a2e18, 0, -0.01, zAt(0) + 0.02, 0, 8, 6); // the little beak
      break;
    case 'bull_shark':
      dorsal(0.25, 0.42, 0.42, shade(finC, 0.95), 1.1);
      dorsal(0.66, 0.72, 0.08, finC, 0.5);
      anal(0.68, 0.76, 0.08, finC);
      for (const sd of [-1, 1]) {
        // big swept-back pectoral blades, angled out and down from the lower flank
        const base = new THREE.Vector3(sd * wid(0.27) * 0.9, -bot(0.27) * 0.45, zAt(0.27));
        const pm = new THREE.Matrix4().compose(base, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sd * 0.2, -sd * 0.55)), new THREE.Vector3(1, 1, 1));
        p.fin([[0, 0], [-0.05, sd * 0.2], [-0.18, sd * 0.42], [-0.44, sd * 0.55], [-0.32, sd * 0.22], [-0.36, 0]], 'zx', 0, shade(finC, 1.05), pm);
        // small pelvic fins further back
        const pv = new THREE.Matrix4().compose(new THREE.Vector3(sd * wid(0.58) * 0.8, -bot(0.58) * 0.7, zAt(0.58)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sd * 0.15, -sd * 0.5)), new THREE.Vector3(1, 1, 1));
        p.fin([[0, 0], [-0.03, sd * 0.1], [-0.16, sd * 0.2], [-0.12, 0]], 'zx', 0, finC, pv);
      }
      for (let k = 0; k < 4; k++) for (const s of [-1, 1]) p.ball(0.004, 0.05, 0.004, 0x2c353b, s * (wid(0.22 + k * 0.012) * 0.99), 0.0, zAt(0.2 + k * 0.012), 0, 4, 4); // gill slits
      for (let i = 0; i < 8; i++) for (const s of [-1, 1]) p.spike([s * (0.02 + i * 0.01), -0.055, zAt(0.07) - i * 0.012], [s * (0.02 + i * 0.01), -0.02, zAt(0.07) - i * 0.012], 0.006, 0xf4f1e6); // teeth
      break;
    case 'catfish': {
      dorsal(0.3, 0.4, 0.1, fin2, 0.6);
      dorsal(0.78, 0.88, 0.05, finC, 0.5); // the small adipose fin
      anal(0.55, 0.84, 0.07, finC);
      pair(0.2, 0.18, 0.06, 0.5, finC, 0.3);
      // the whiskers: long barbels trailing from the mouth and the nostrils
      for (const sd of [-1, 1]) {
        p.seg([sd * 0.07, -0.01, zAt(0.01)], [sd * 0.3, -0.06, zAt(0.0) + 0.24], 0.012, 0.004, shade(pal.back, 0.85), 5);
        p.seg([sd * 0.05, -0.04, zAt(0.015)], [sd * 0.16, -0.17, zAt(0.0) + 0.2], 0.01, 0.004, shade(pal.back, 0.85), 5);
        p.seg([sd * 0.03, 0.02, zAt(0.012)], [sd * 0.08, -0.03, zAt(0.0) + 0.3], 0.008, 0.003, shade(pal.back, 0.85), 5);
      }
      break;
    }
    case 'swordfish':
      dorsal(0.26, 0.58, 0.36, shade(finC, 1.0), 1.0); // the tall sail
      dorsal(0.8, 0.86, 0.06, finC, 0.5);
      anal(0.78, 0.86, 0.07, finC);
      pair(0.28, 0.3, 0.1, 0.55, finC, 0.5);
      // the bill: a flat spear as long as a third of the body
      p.seg([0, 0, zAt(0.0) + 0.02], [0, -0.005, zAt(0.0) + 0.95], 0.034, 0.006, shade(pal.back, 0.8), 6);
      break;
    case 'sturgeon': {
      dorsal(0.66, 0.76, 0.1, finC, 0.6);
      anal(0.68, 0.78, 0.08, finC);
      pair(0.26, 0.26, 0.09, 0.55, finC, 0.4);
      // rows of bony plates down the back and flanks
      for (let k = 0; k < 11; k++) {
        const u = 0.16 + k * 0.058;
        p.spike([0, top(u) * 0.96, zAt(u)], [0, top(u) + 0.06, zAt(u) + 0.02], 0.028, 0xc8c4a8);
        for (const sd of [-1, 1]) p.spike([sd * wid(u) * 0.97, 0.0, zAt(u)], [sd * (wid(u) + 0.045), 0.02, zAt(u) + 0.015], 0.02, 0xc8c4a8);
      }
      // barbels under a long pointed snout
      for (const sd of [-1, 1]) p.seg([sd * 0.03, -0.04, zAt(0.06)], [sd * 0.05, -0.09, zAt(0.02)], 0.008, 0.004, shade(pal.back, 0.85), 5);
      break;
    }
    case 'barracuda':
      dorsal(0.52, 0.6, 0.07, fin2, 0.5);
      dorsal(0.76, 0.82, 0.06, finC, 0.5);
      anal(0.76, 0.82, 0.06, finC);
      pair(0.22, 0.14, 0.04, 0.5, finC, 0.3);
      // the underbite: a lower jaw jutting past the upper, with a row of long fangs
      p.seg([0, -0.025, zAt(0.015)], [0, -0.032, zAt(0) + 0.04], 0.022, 0.012, shade(pal.belly, 0.9), 6);
      for (let i = 0; i < 9; i++) for (const s of [-1, 1]) p.spike([s * 0.016, -0.018, zAt(0.0) + 0.02 - i * 0.012], [s * 0.016, 0.018, zAt(0.0) + 0.02 - i * 0.012], 0.0055, 0xf4f1e6);
      break;
    case 'eel':
      dorsal(0.9, 0.98, 0.02, finC, 0.5);
      anal(0.12, 0.96, 0.09, shade(pal.belly, 0.95)); // the long anal fin it ripples to swim
      pair(0.1, 0.07, 0.03, 0.6, finC, 0.2);
      break;
    case 'angler':
      pair(0.38, 0.22, 0.12, 0.5, finC, 0.5);
      dorsal(0.62, 0.8, 0.1, finC, 0.5);
      anal(0.65, 0.8, 0.08, finC);
      // a cavernous mouth full of long needle teeth in both jaws
      for (let i = 0; i < 12; i++) {
        const a = (i / 11) * Math.PI - Math.PI / 2;
        for (const row of [-1, 1]) {
          const x = Math.sin(a) * 0.16;
          const z = zAt(0.06) + Math.cos(a) * 0.1;
          p.spike([x, row * 0.02 - 0.03, z], [x * 0.9, row * 0.15 - 0.03, z + 0.02], 0.009, 0xece4cc);
        }
      }
      // the lure: a stalk arching over the mouth, with a pale bulb on the end
      p.seg([0, top(0.1) * 0.98, zAt(0.1)], [0, top(0.1) + 0.22, zAt(0.0) + 0.08], 0.014, 0.01, shade(f.back, 1.3), 5);
      p.seg([0, top(0.1) + 0.22, zAt(0.0) + 0.08], [0, top(0.1) + 0.2, zAt(0) + 0.3], 0.01, 0.007, shade(f.back, 1.3), 5);
      p.ball(0.035, 0.035, 0.035, 0xf2e8a0, 0, top(0.1) + 0.19, zAt(0) + 0.32, 0, 8, 6);
      break;
  }
  // gill cover behind the eye, and a pair of eyes
  const eu = 0.1;
  for (const s of [-1, 1]) {
    const ex = s * wid(eu) * 0.85;
    const ey = f.eyeY + top(eu) * f.eyeU * (f.eyeU > 0.8 ? 0.92 : 0.5);
    const ez = zAt(eu * 0.8);
    const er = f.eyeR * 0.62; // fish eyes are small and flat to the head
    const lat = new THREE.Matrix4().makeRotationY(s * Math.PI / 2);
    void lat;
    p.ball(er * 0.5, er * 1.05, er * 1.05, 0xaab4b6, ex, ey, ez, 0, 10, 8); // the pale ring round the eye
    p.ball(er * 0.45, er * 0.82, er * 0.82, f.eyeC, ex + s * er * 0.18, ey, ez, 0, 10, 8);
    p.ball(er * 0.4, er * 0.45, er * 0.45, 0x050505, ex + s * er * 0.32, ey, ez, 0, 8, 6); // the pupil
    if (name !== 'bull_shark') p.fin([[0, -bot(0.2) * 0.7], [-0.03, -bot(0.2) * 0.2], [-0.06, top(0.2) * 0.4], [-0.01, top(0.2) * 0.5]].map(([u, v]) => [u, v] as [number, number]), 'zy', s * wid(0.2) * 1.0, shade(pal.back, 0.8), new THREE.Matrix4().makeTranslation(0, 0, zAt(0.2) * 1)); // gill plate edge
  }
  const geo = p.merged();
  let maxH = 0;
  for (const r of f.prof) maxH = Math.max(maxH, r[2] + r[3]);
  return { geo, len: L + f.tailLen, height: maxH, width: Math.max(...f.prof.map((r) => r[1])) * 2 };
}

export class RealFishRig implements Rig {
  root = new THREE.Group();
  height: number;
  radius: number;
  private g: THREE.Mesh;
  private mat: THREE.MeshStandardMaterial;
  private uni = { uPh: { value: 0 }, uAmp: { value: 0.03 }, uHead: { value: 0 }, uLen: { value: 1 }, uK: { value: 6 } };
  private phase = Math.random() * 6;
  private flash = 0;
  private tint: number | null = null;
  private baseY: number;
  constructor(name: string, paint: Paint | null | undefined, radius: number) {
    const f = FISH_P[name];
    const built = buildFish(name, paint);
    this.mat = chitin(0.3);
    this.mat.metalness = 0.28;
    const uni = this.uni;
    uni.uHead.value = f.len / 2;
    uni.uLen.value = f.len;
    uni.uK.value = (Math.PI * 2 * (name === 'eel' ? 1.6 : 1.1)) / f.len;
    // the whole body ripples from the head to the tail in the vertex shader: one draw call, no per-frame geometry work
    this.mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uni);
      shader.vertexShader =
        'uniform float uPh; uniform float uAmp; uniform float uHead; uniform float uLen; uniform float uK;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          'vec3 transformed = vec3(position);\nfloat kw = clamp((uHead - position.z) / uLen, 0.0, 1.0);\ntransformed.x += sin(uPh - position.z * uK) * uAmp * kw * kw;',
        );
    };
    this.mat.customProgramCacheKey = () => 'fishwave';
    this.g = new THREE.Mesh(built.geo, this.mat);
    this.g.frustumCulled = false; // the shader moves the vertices outside the static bounds
    this.baseY = 0.1 + built.height * 0.55;
    this.root.add(this.g);
    this.height = built.height + 0.55;
    this.radius = radius;
    this.g.position.y = this.baseY;
  }
  setTint(c: number | null) {
    this.tint = c;
  }
  update(dt: number, s: RigState) {
    const fast = Math.min(1, s.speed / 6);
    this.phase += dt * (3.2 + s.speed * 1.6);
    this.uni.uPh.value = this.phase;
    this.uni.uAmp.value = (0.05 + 0.1 * fast) * this.uni.uLen.value * 0.35 + (s.attack > 0.1 ? 0.04 : 0);
    const pose = s.pose;
    this.g.position.y = this.baseY + Math.sin(s.t * 1.8 + this.phase * 0.1) * 0.03 + (pose?.y ?? 0);
    this.g.position.z = pose?.z ?? 0;
    this.g.rotation.x = (pose?.rx ?? 0) + (s.vy ? -Math.max(-0.4, Math.min(0.4, s.vy * 0.05)) : 0);
    this.g.rotation.y = pose?.ry ?? 0;
    this.g.rotation.z = -(s.turn ?? 0) * 0.08 + (pose?.rz ?? 0);
    this.flash = Math.max(this.flash, s.hurt);
    this.flash = Math.max(0, this.flash - dt * 3);
    const e = this.flash > 0.01 ? 0.7 * this.flash : 0;
    const warn = (s.warn ?? 0) * (0.6 + 0.4 * Math.sin(s.t * 34));
    const m = this.mat;
    if (this.tint !== null) m.emissive.setHex(this.tint).multiplyScalar(0.3);
    else if (warn > 0.01) m.emissive.setRGB(0.9 * warn, 0.28 * warn, 0.06 * warn);
    else m.emissive.setRGB(e, e * 0.3, e * 0.3);
  }
}

export const REAL_FISH = new Set<string>(Object.keys(FISH_P));
export function makeRealFishRig(name: string, paint: Paint | null | undefined, radius: number): Rig {
  return new RealFishRig(name, paint, radius);
}
