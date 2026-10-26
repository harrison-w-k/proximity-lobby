// Realistic four-legged animals. A smooth lofted body with a deep chest, a tucked-up waist and rounded haunches; a skull
// with a brow, muzzle, jaw, small real eyes and proper ears; legs made of a shoulder or thigh, a joint, a lower limb and a
// paw with toes; a tapering tail. Colour is painted into the vertices (countershading, stripes, spots, masks), and the
// result drops into the same rig as the older models, so every walk, attack and hit animation still works.
import * as THREE from 'three';
import { Parts, mix, shade } from './creatures';
import type { Built, QuadSpec } from './models';

type V3 = [number, number, number];

// ---------- value noise, for fur that is never one flat colour ----------
function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const l = (a: number, b: number, t: number) => a + (b - a) * s(t);
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy), l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}

const tmpC = new THREE.Color();
const tmpD = new THREE.Color();

// ---------- a smooth body made from rings along Z ----------
export interface Ring {
  z: number;
  w: number; // half width
  top: number; // height above the centre line
  bot: number; // depth below it
  cy?: number; // centre line height
  cx?: number;
}
type ColorFn = (z: number, a: number, y: number, x: number) => number;

export function loft(rings: Ring[], colorFn: ColorFn, seg = 16): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const sq = 0.85;
  const n = rings.length;
  for (const r of rings) {
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      const x = (r.cx ?? 0) + Math.sign(s) * Math.pow(Math.abs(s), sq) * r.w;
      const y = (r.cy ?? 0) + Math.sign(c) * Math.pow(Math.abs(c), sq) * (c >= 0 ? r.top : r.bot);
      pos.push(x, y, r.z);
      tmpC.setHex(colorFn(r.z, a, y, x));
      col.push(tmpC.r, tmpC.g, tmpC.b);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j;
      const b = i * seg + ((j + 1) % seg);
      const c = (i + 1) * seg + j;
      const d = (i + 1) * seg + ((j + 1) % seg);
      idx.push(a, c, b, b, c, d);
    }
  }
  // close both ends with a fan
  for (const [ri, flip] of [[0, true], [n - 1, false]] as const) {
    const r = rings[ri];
    const ci = pos.length / 3;
    pos.push(r.cx ?? 0, r.cy ?? 0, r.z);
    tmpC.setHex(colorFn(r.z, 0, r.cy ?? 0, 0));
    col.push(tmpC.r, tmpC.g, tmpC.b);
    for (let j = 0; j < seg; j++) {
      const a = ri * seg + j;
      const b = ri * seg + ((j + 1) % seg);
      if (flip) idx.push(ci, a, b);
      else idx.push(ci, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** A tube along a path (a tail, a snake) with a radius at each point. */
export function tube(path: V3[], radii: number[], colorFn: (u: number, a: number) => number, seg = 10): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const n = path.length;
  let nrm = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const p = new THREE.Vector3(...path[i]);
    const t = new THREE.Vector3(...path[Math.min(n - 1, i + 1)]).sub(new THREE.Vector3(...path[Math.max(0, i - 1)])).normalize();
    nrm = nrm.clone().sub(t.clone().multiplyScalar(nrm.dot(t)));
    if (nrm.lengthSq() < 1e-6) nrm.set(1, 0, 0).sub(t.clone().multiplyScalar(t.x));
    nrm.normalize();
    const bin = new THREE.Vector3().crossVectors(t, nrm).normalize();
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const q = p.clone().add(nrm.clone().multiplyScalar(Math.cos(a) * radii[i])).add(bin.clone().multiplyScalar(Math.sin(a) * radii[i]));
      pos.push(q.x, q.y, q.z);
      tmpC.setHex(colorFn(i / (n - 1), a));
      col.push(tmpC.r, tmpC.g, tmpC.b);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j;
      const b = i * seg + ((j + 1) % seg);
      const c = (i + 1) * seg + j;
      const d = (i + 1) * seg + ((j + 1) % seg);
      idx.push(a, b, c, b, d, c);
    }
  }
  for (const [ri, flip] of [[0, false], [n - 1, true]] as const) {
    const ci = pos.length / 3;
    const p = path[ri];
    pos.push(p[0], p[1], p[2]);
    tmpC.setHex(colorFn(ri / (n - 1), 0));
    col.push(tmpC.r, tmpC.g, tmpC.b);
    for (let j = 0; j < seg; j++) {
      const a = ri * seg + j;
      const b = ri * seg + ((j + 1) % seg);
      if (flip) idx.push(ci, a, b);
      else idx.push(ci, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

// ---------- per-species look ----------
type Kind = 'cat' | 'dog' | 'mustelid' | 'bear';
interface Look {
  kind: Kind;
  /** painted markings on the body: returns a colour to blend towards and how strongly (0 to 1) */
  mark?: (z: number, a: number, x: number, y: number) => [number, number] | null;
  headMark?: (z: number, a: number, x: number, y: number) => [number, number] | null;
  mane?: number; // a lion's mane colour
  hump?: number; // raised shoulders (bears, hyena)
  ruff?: number; // a cheek ruff colour
  tailTip?: number;
  tailRings?: number;
  tuftEars?: number;
  whiskers?: boolean;
  fangs?: boolean;
  bulk?: number; // overall muscle bulk
  sock?: number; // dark lower legs
}

export const stripesAcross = (c: number, freq: number, str: number, seed = 0) => (z: number, a: number, x: number, y: number): [number, number] | null => {
  const dorsal = Math.cos(a); // 1 on the back, -1 on the belly
  if (dorsal < -0.35) return null;
  const wob = vnoise(z * 6 + seed, x * 8, seed) * 1.6;
  const v = Math.sin(z * freq + wob + Math.sin(a) * 1.5);
  return v > 0.35 ? [c, str * Math.min(1, (dorsal + 0.4) * 1.2)] : null;
};
export const spots = (c: number, scale: number, thr: number, str: number, ring = false) => (z: number, a: number, x: number, y: number): [number, number] | null => {
  // blobs from 3D noise, so they stay round on the curved flanks and are not smeared along the body
  const n = vnoise(x * scale * 1.5 + 11, y * scale * 1.5, z * scale * 1.5 + 5);
  if (Math.cos(a) < -0.55) return null;
  if (ring) return n > thr && n < thr + 0.09 ? [c, str] : null;
  return n > thr ? [c, str] : null;
};

export const LOOK: Record<string, Look> = {
  house_cat: { kind: 'cat', mark: stripesAcross(0x6a3a1c, 30, 0.75), whiskers: true, tailRings: 0x5a2e14, bulk: 0.9 },
  bobcat: { kind: 'cat', mark: spots(0x3a2a1a, 9, 0.7, 0.8), whiskers: true, tailTip: 0x1a1410, tuftEars: 0x1a1410, ruff: 0xe8dcc0, bulk: 1 },
  lynx: { kind: 'cat', mark: spots(0x5a4a38, 7, 0.7, 0.5), whiskers: true, tailTip: 0x141010, tuftEars: 0x141010, ruff: 0xece4d4, bulk: 1 },
  cheetah: { kind: 'cat', mark: spots(0x1c140c, 16, 0.66, 0.95), whiskers: true, bulk: 0.8 },
  panther: { kind: 'cat', mark: spots(0x0c0c0e, 9, 0.66, 0.4, true), whiskers: true, bulk: 1.05 },
  tiger: { kind: 'cat', mark: stripesAcross(0x1a120a, 24, 0.95), whiskers: true, bulk: 1.15, ruff: 0xeeeadc, tailRings: 0x1a120a },
  lion: { kind: 'cat', whiskers: true, bulk: 1.15, mane: 0x5a3416, tailTip: 0x2a1608 },
  ocelot: { kind: 'cat', mark: spots(0x2a1c10, 8, 0.62, 0.85, true), whiskers: true, tailRings: 0x2a1c10, bulk: 0.9 },
  leopard: { kind: 'cat', mark: spots(0x1c140c, 11, 0.62, 0.9, true), whiskers: true, bulk: 1.0 },
  snow_leopard: { kind: 'cat', mark: spots(0x3a3a40, 9, 0.64, 0.75, true), whiskers: true, tailRings: 0x3a3a40, ruff: 0xeeeeee, bulk: 1.05 },
  fox: { kind: 'dog', sock: 0x1c1410, tailTip: 0xf4f0e6, bulk: 0.85, whiskers: true },
  coyote: { kind: 'dog', mark: (z, a) => (Math.cos(a) > 0.5 ? [0x4a4034, 0.55] : null), ruff: 0xc8b898, tailTip: 0x1c1814, bulk: 0.9 },
  jackal: { kind: 'dog', mark: (z, a) => (Math.cos(a) > 0.45 ? [0x2a241c, 0.65] : null), tailTip: 0x1c1814, bulk: 0.85 },
  gray_wolf: { kind: 'dog', mark: (z, a) => (Math.cos(a) > 0.35 ? [0x3a3c40, 0.6] : null), ruff: 0xb0b0ac, tailTip: 0x222426, bulk: 1.05 },
  dhole: { kind: 'dog', tailTip: 0x1c1410, bulk: 0.9, mark: (z, a) => (Math.cos(a) > 0.3 ? [0x8a3a14, 0.4] : null) },
  hyena: { kind: 'dog', mark: spots(0x2a2218, 9, 0.68, 0.85), hump: 0.22, ruff: 0x2a2218, bulk: 1.1, tailTip: 0x1a1410, fangs: true },
  dingo: { kind: 'dog', tailTip: 0xf2ecde, bulk: 0.9, mark: (z, a) => (Math.cos(a) > 0.5 ? [0xa8703a, 0.35] : null) },
  arctic_wolf: { kind: 'dog', ruff: 0xffffff, tailTip: 0xe6e8ee, bulk: 1.05 },
  maned_wolf: { kind: 'dog', sock: 0x1c1410, tailTip: 0xf4f0e6, bulk: 0.85, ruff: 0x1c1410, mark: (z, a) => (Math.cos(a) > 0.78 ? [0x1c1410, 0.8] : null) },
  wild_dog: { kind: 'dog', mark: spots(0x1a140c, 7, 0.62, 0.85), bulk: 0.85, tailTip: 0xf4f0e6 },
  weasel: { kind: 'mustelid', bulk: 0.7, whiskers: true },
  river_otter: { kind: 'mustelid', bulk: 0.85, whiskers: true },
  giant_otter: { kind: 'mustelid', bulk: 1, whiskers: true },
  sea_otter: { kind: 'mustelid', bulk: 1.1, whiskers: true },
  fisher: { kind: 'mustelid', bulk: 0.95, whiskers: true },
  skunk: { kind: 'mustelid', bulk: 1, whiskers: true, tailTip: 0xf4f2ee, mark: (z, a) => (Math.abs(Math.sin(a)) < 0.34 && Math.cos(a) > 0.4 ? [0xf2f0ea, 0.95] : null) },
  tayra: { kind: 'mustelid', bulk: 0.95, whiskers: true },
  badger: { kind: 'mustelid', bulk: 1.1, whiskers: true, mark: (z, a) => (Math.cos(a) > 0.8 ? [0xe6e2d6, 0.9] : null) },
  honey_badger: { kind: 'mustelid', bulk: 1.1, mark: (z, a) => (Math.cos(a) > 0.25 ? [0xd8d4c6, 0.92] : null) },
  wolverine: { kind: 'mustelid', bulk: 1.1, mark: (z, a) => (Math.abs(Math.sin(a)) > 0.7 && Math.cos(a) > -0.2 && z < 0.4 ? [0xc8a05a, 0.75] : null) },
  raccoon: { kind: 'mustelid', bulk: 1, tailRings: 0x1a1612, whiskers: true, mark: (z, a) => (vnoise(z * 12, a * 3, 1) > 0.5 ? [0x4a4640, 0.35] : null) },
  sun_bear: { kind: 'bear', hump: 0.05, bulk: 1.0, mark: (z, a) => (z > 0.2 && Math.cos(a) < -0.2 ? [0xe8c070, 0.8] : null) },
  moon_bear: { kind: 'bear', hump: 0.1, bulk: 1.1, mark: (z, a) => (z > 0.15 && Math.cos(a) < -0.3 ? [0xf2eee0, 0.85] : null) },
  cave_bear: { kind: 'bear', hump: 0.26, bulk: 1.25 },
  black_bear: { kind: 'bear', hump: 0.08, bulk: 1.1 },
  sloth_bear: { kind: 'bear', hump: 0.12, bulk: 1, mark: (z, a, x, y) => (z > 0.1 && Math.cos(a) < -0.2 ? [0xe6e0d0, 0.7] : null) },
  grizzly: { kind: 'bear', hump: 0.24, bulk: 1.15, mark: (z, a) => (vnoise(z * 20, a * 4, 3) > 0.55 ? [0xc8b08a, 0.5] : null) },
  polar_bear: { kind: 'bear', hump: 0.06, bulk: 1.05 },
  kodiak: { kind: 'bear', hump: 0.22, bulk: 1.2 },
  panda: { kind: 'bear', hump: 0.04, bulk: 1.15, mark: (z, a) => (z > 0.16 ? [0x16161a, 0.95] : null) },
};
export const REAL_QUAD = new Set(Object.keys(LOOK));
export type { Look };

// fur is mostly the species colour: a back that is a little darker than the flanks, and a pale belly and chest
function furColor(base: number, belly: number, a: number, x: number, y: number, z: number, look: Look, L: number, markZ: number): number {
  const c = Math.cos(a);
  const t = THREE.MathUtils.smoothstep(-c, -0.1, 0.55); // 0 on the back, 1 on the belly
  tmpC.setHex(base);
  if (t > 0) tmpD.setHex(belly), tmpC.lerp(tmpD, t);
  // a darker spine and a mottled coat
  const n = vnoise(x * 18, y * 18, z * 14);
  tmpC.multiplyScalar(0.9 + n * 0.2 + (c > 0.6 ? -0.06 : 0));
  if (look.mark) {
    const m = look.mark(markZ, a, x / L, y / L);
    if (m) {
      tmpD.setHex(m[0]);
      tmpC.lerp(tmpD, m[1] * (0.85 + n * 0.3));
    }
  }
  return tmpC.getHex();
}

// cat ears: [size, height of the point, how round the base is, tuft colour]
const CAT_EARS: Record<string, { s: number; h: number; round: number }> = {
  house_cat: { s: 0.6, h: 0.95, round: 0 },
  bobcat: { s: 0.6, h: 1.0, round: 0.1 },
  lynx: { s: 0.66, h: 1.25, round: 0 },
  cheetah: { s: 0.5, h: 0.7, round: 0.5 },
  panther: { s: 0.52, h: 0.75, round: 0.5 },
  tiger: { s: 0.52, h: 0.7, round: 0.7 },
  lion: { s: 0.5, h: 0.6, round: 0.8 },
};
const CAT_NOSE: Record<string, number> = { house_cat: 0xd88a86, bobcat: 0xb07a74, lynx: 0x6a4a46, cheetah: 0x1a1210, panther: 0x1a1214, tiger: 0xc08a80, lion: 0x7a4a40 };

// ---------- the builder ----------
export function buildRealQuad(spec: QuadSpec, seed: number, id: string): Built {
  const look = LOOK[id];
  if (look.kind === 'cat') {
    // every cat gets a feline head: a broad round skull, a very short muzzle and a flat face
    const h0 = spec.head.s * 1.12 * (id === 'house_cat' ? 1 : 1.1);
    spec = { ...spec, head: { ...spec.head, s: spec.head.s * (id === 'house_cat' ? 1 : 1.1), snout: h0 * 0.065, snoutH: h0 * 0.5, fwd: spec.head.fwd }, ears: 'point', earS: CAT_EARS[id]?.s ?? 0.6 };
  }
  const L = spec.len, W = spec.w, H = spec.h;
  const Wh = W / 2, Hh = H / 2;
  const hip = spec.legLen;
  const T = spec.legT;
  const fur = spec.fur;
  const belly = spec.belly ?? shade(fur, 1.25);
  const pawC = spec.paw ?? shade(fur, 0.6);
  const bulk = look.bulk ?? 1;
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = hip + H / 2 - 0.04;
  root.add(torso);
  const hump = (look.hump ?? 0) * H;

  // --- torso: rump, haunch, tucked waist, deep chest, neck ---
  const u2z = (u: number) => (u - 0.5) * L;
  const hips = look.kind === 'cat' || look.kind === 'dog';
  const tuck = hips ? 0.62 : look.kind === 'bear' ? 0.9 : 0.8;
  const shoulderLift = (u: number) => hump * THREE.MathUtils.smoothstep(u, 0.35, 0.8);
  const rings: Ring[] = [
    { z: u2z(0), w: 0.3 * Wh, top: 0.55 * Hh, bot: 0.3 * Hh, cy: 0 },
    { z: u2z(0.06), w: 0.78 * Wh * bulk, top: 0.86 * Hh, bot: 0.66 * Hh, cy: 0.04 * H },
    { z: u2z(0.18), w: 1.0 * Wh * bulk, top: 1.0 * Hh, bot: 0.82 * Hh, cy: 0.02 * H },
    { z: u2z(0.36), w: 0.88 * Wh * bulk, top: 0.96 * Hh, bot: tuck * Hh, cy: 0 },
    { z: u2z(0.54), w: 0.96 * Wh * bulk, top: 1.0 * Hh, bot: 0.92 * Hh, cy: shoulderLift(0.54) * 0.5 },
    { z: u2z(0.72), w: 1.05 * Wh * bulk, top: 1.04 * Hh, bot: 1.04 * Hh, cy: shoulderLift(0.72) * 0.6 },
    { z: u2z(0.88), w: 0.86 * Wh * bulk, top: 0.94 * Hh, bot: 0.9 * Hh, cy: shoulderLift(0.88) * 0.4 + 0.02 * H },
    { z: u2z(1.0), w: 0.6 * Wh, top: 0.8 * Hh, bot: 0.66 * Hh, cy: 0.1 * H },
    { z: u2z(1.0) + 0.16 * L, w: 0.46 * Wh, top: 0.62 * Hh, bot: 0.5 * Hh, cy: 0.22 * H },
  ];
  const bodyGeo = loft(rings, (z, a, y, x) => furColor(fur, belly, a, x, y, z, look, L, z / L), 18);
  const tp = new Parts();
  tp.addGeo(bodyGeo);
  // a lion's mane is a shaggy mass round the neck and chest
  if (look.mane) {
    const mc = look.mane;
    const mane = loft(
      [
        { z: u2z(0.72), w: 0.6 * Wh, top: 0.7 * Hh, bot: 0.8 * Hh, cy: 0.1 * H },
        { z: u2z(0.88), w: 1.1 * Wh, top: 1.2 * Hh, bot: 1.0 * Hh, cy: 0.18 * H },
        { z: u2z(1.0) + 0.04 * L, w: 1.25 * Wh, top: 1.3 * Hh, bot: 1.1 * Hh, cy: 0.22 * H },
        { z: u2z(1.0) + 0.2 * L, w: 1.0 * Wh, top: 1.05 * Hh, bot: 0.9 * Hh, cy: 0.22 * H },
        { z: u2z(1.0) + 0.3 * L, w: 0.6 * Wh, top: 0.7 * Hh, bot: 0.6 * Hh, cy: 0.2 * H },
      ],
      (z, a, y, x) => {
        const n = vnoise(x * 12, y * 12, z * 10);
        tmpC.setHex(mc).multiplyScalar(0.7 + n * 0.5);
        return tmpC.getHex();
      },
      16,
    );
    tp.addGeo(mane);
  }
  torso.add(new THREE.Mesh(tp.merged(), new THREE.MeshBasicMaterial()));

  // --- head ---
  const head = new THREE.Group();
  const hs = spec.head.s * 1.12;
  const sn = spec.head.snout;
  head.position.set(0, spec.h * 0.28 - (spec.head.drop ?? 0), spec.len / 2 + (spec.head.fwd ?? hs * 0.35) + 0.04 * L);
  const snoutC = spec.head.snoutC ?? fur;
  const sH = spec.head.snoutH ?? hs * 0.5;
  const mw = Math.max(0.2 * hs, sH * 0.45); // muzzle half-width
  const headMark = look.headMark;
  const headCol = (z: number, a: number, y: number, x: number): number => {
    const c = Math.cos(a);
    let col = furColor(fur, belly, a, x, y, z, { kind: look.kind }, hs, 0);
    // the muzzle is paler than the forehead; the lips and nose are dark
    const mz = THREE.MathUtils.smoothstep(z, 0.3 * hs, 0.5 * hs + sn * 0.4);
    if (snoutC !== fur) col = mix(col, c < 0.2 ? shade(snoutC, 1.1) : snoutC, mz * 0.9);
    if (id === 'raccoon') {
      const band = Math.abs(y - 0.06 * hs) < 0.16 * hs && z > -0.05 * hs && Math.abs(x) > 0.06 * hs;
      if (band) col = mix(col, 0x18140f, 0.92);
      else if (z > 0.1 * hs && Math.abs(x) < 0.07 * hs && c > 0) col = mix(col, 0x2a2420, 0.7);
      if (z > 0.4 * hs && !band) col = mix(col, 0xe6e0d4, 0.7);
    }
    if (id === 'panda') {
      col = 0xf2f0ea;
      const patch = Math.hypot(Math.abs(x) - 0.26 * hs, y - 0.07 * hs) < 0.14 * hs && z > 0.1 * hs;
      if (patch) col = 0x16161a;
      if (z > 0.62 * hs && z < 0.5 * hs + sn) col = mix(col, 0xe8e0d0, 0.5);
    }
    if (id === 'badger') {
      if (Math.abs(x) < 0.07 * hs && c > 0) col = 0xe9e5d8;
      else if (Math.abs(Math.abs(x) - 0.28 * hs) < 0.07 * hs && c > 0.1) col = mix(col, 0xe9e5d8, 0.9);
      else if (c > 0.1) col = mix(col, 0x1a1819, 0.85);
    }
    if (id === 'honey_badger' && c > 0.3) col = mix(col, 0xd8d4c6, 0.9);
    if ((id === 'tiger' || id === 'house_cat') && c > 0.2 && z < 0.35 * hs) {
      if (Math.sin(x * 60 / hs + z * 10) > 0.4) col = mix(col, 0x1a120a, 0.6);
    }
    if (id === 'cheetah' && z > 0.1 * hs && Math.abs(Math.abs(x) - 0.17 * hs) < 0.04 * hs && y < 0.15 * hs) col = mix(col, 0x1a120a, 0.85); // the tear marks
    if (z > 0.5 * hs + sn * 0.92 && Math.abs(x) < 0.2 * hs) col = CAT_NOSE[id] ?? 0x120d0b; // the nose
    return col;
  };
  const hr: Ring[] = [
    { z: -0.5 * hs, w: 0.3 * hs, top: 0.32 * hs, bot: 0.3 * hs, cy: 0 },
    { z: -0.3 * hs, w: 0.48 * hs, top: 0.46 * hs, bot: 0.4 * hs, cy: 0.02 * hs },
    { z: 0.0, w: 0.5 * hs, top: 0.46 * hs, bot: 0.38 * hs, cy: 0.04 * hs },
    { z: 0.26 * hs, w: 0.4 * hs, top: 0.32 * hs, bot: 0.3 * hs, cy: -0.02 * hs },
    { z: 0.5 * hs + sn * 0.15, w: Math.max(mw * 1.0, 0.24 * hs), top: Math.max(sH * 0.4, 0.2 * hs), bot: Math.max(sH * 0.3, 0.16 * hs), cy: -0.06 * hs },
    { z: 0.5 * hs + sn * 0.65, w: Math.max(mw * 0.9, 0.2 * hs), top: Math.max(sH * 0.34, 0.16 * hs), bot: Math.max(sH * 0.26, 0.13 * hs), cy: -0.08 * hs },
    { z: 0.5 * hs + sn * 0.96, w: Math.max(mw * 0.85, 0.18 * hs), top: Math.max(sH * 0.3, 0.14 * hs), bot: Math.max(sH * 0.2, 0.1 * hs), cy: -0.08 * hs },
    { z: 0.5 * hs + sn * 1.0 + 0.03 * hs, w: 0.1 * hs, top: 0.08 * hs, bot: 0.06 * hs, cy: -0.07 * hs },
  ];
  const hp = new Parts();
  hp.addGeo(loft(hr, headCol, 16));
  // the lower jaw, with a dark line where the mouth closes
  const jawRings: Ring[] = [
    { z: 0.0, w: 0.3 * hs, top: 0.06 * hs, bot: 0.14 * hs, cy: -0.28 * hs },
    { z: 0.3 * hs, w: 0.28 * hs, top: 0.05 * hs, bot: 0.12 * hs, cy: -0.28 * hs },
    { z: 0.5 * hs + sn * 0.6, w: 0.17 * hs, top: 0.04 * hs, bot: 0.08 * hs, cy: -0.24 * hs },
    { z: 0.5 * hs + sn * 0.92, w: 0.1 * hs, top: 0.03 * hs, bot: 0.05 * hs, cy: -0.22 * hs },
  ];
  hp.addGeo(loft(jawRings, (z, a) => (Math.cos(a) > 0.6 ? 0x2a1a16 : mix(belly, 0xffffff, 0.2)), 12));
  if (look.fangs || look.kind === 'dog') {
    for (const s of [-1, 1]) {
      const fz = 0.5 * hs + sn * 0.78;
      hp.spike([s * 0.13 * hs, -0.12 * hs, fz], [s * 0.13 * hs, -0.25 * hs, fz + 0.01 * hs], 0.014 * hs + 0.004, 0xf2ecdc);
    }
  }
  if (look.whiskers) {
    for (const s of [-1, 1]) {
      for (let k = -1; k <= 1; k++) {
        hp.seg([s * 0.14 * hs, -0.06 * hs + k * 0.025 * hs, 0.5 * hs + sn * 0.6], [s * (0.5 * hs + sn * 0.5), -0.04 * hs + k * 0.1 * hs, 0.5 * hs + sn * 0.5], 0.004, 0.0015, 0xf1ede2, 3);
      }
    }
  }
  if (look.ruff) {
    for (const s of [-1, 1]) hp.ball(0.16 * hs, 0.28 * hs, 0.26 * hs, look.ruff, s * 0.38 * hs, -0.12 * hs, 0.02 * hs, 0, 8, 6);
  }
  head.add(new THREE.Mesh(hp.merged(), new THREE.MeshBasicMaterial()));

  // eyes: small, set forward on the sides of the head (blink by squashing in y)
  const eyes: THREE.Object3D[] = [];
  const eyeC = spec.eye ?? 0x6b4a20;
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    if (look.kind === 'cat') {
      eye.position.set(s * 0.3 * hs, 0.13 * hs, 0.3 * hs); // forward-facing, set close in a flat face
      eye.rotation.y = s * 0.28;
    } else {
      eye.position.set(s * 0.4 * hs, 0.14 * hs, 0.22 * hs);
      eye.rotation.y = s * 0.45;
    }
    const ep = new Parts();
    const er = hs * (look.kind === 'bear' ? 0.045 : look.kind === 'cat' ? 0.1 : 0.06);
    ep.ball(er * 1.25, er * 1.15, er * 0.6, 0x1a1210, 0, 0, 0, 0, 10, 8); // the socket rim
    ep.ball(er, er * 0.95, er * 0.6, eyeC, 0, 0, er * 0.15, 0, 10, 8); // the iris
    if (spec.slit) ep.ball(er * 0.22, er * 0.92, er * 0.4, 0x050505, 0, 0, er * 0.45, 0, 6, 6);
    else ep.ball(er * 0.55, er * 0.55, er * 0.4, 0x050505, 0, 0, er * 0.45, 0, 8, 6);
    ep.ball(er * 0.22, er * 0.22, er * 0.2, 0xffffff, -s * er * 0.25, er * 0.3, er * 0.62, 0, 5, 4); // the glint
    eye.add(new THREE.Mesh(ep.merged(), new THREE.MeshBasicMaterial()));
    head.add(eye);
    eyes.push(eye);
  }

  // ears
  const ears: { o: THREE.Object3D; side: number }[] = [];
  if (spec.ears && spec.ears !== 'none') {
    const es = (spec.earS ?? 0.5) * hs * 0.9;
    for (const s of [-1, 1]) {
      const e = new THREE.Group();
      const xs = spec.ears === 'long' ? 0.2 : 0.3;
      e.position.set(s * xs * hs * (look.kind === 'cat' ? 1.35 : 1.4), (look.kind === 'cat' ? 0.34 : 0.38) * hs, -0.12 * hs);
      const ep = new Parts();
      const inner = look.kind === 'bear' ? shade(fur, 0.7) : 0xe0a8a0;
      if (spec.ears === 'point') {
        if (look.kind === 'cat') {
          // a cat's ear is a broad-based triangle; the big cats' are rounder and lower, a lynx's tall and tufted
          const ce = CAT_EARS[id] ?? CAT_EARS.house_cat;
          const col = spec.earC ?? fur;
          ep.spike([0, 0, 0], [0, es * ce.h * 0.9, -0.01], es * (0.52 + ce.round * 0.12), col);
          if (ce.round > 0.3) ep.ball(es * 0.5, es * 0.42 * (1 + ce.round * 0.3), es * 0.14, col, 0, es * 0.3, 0, 0, 10, 8);
          ep.spike([0, es * 0.05, es * 0.08], [0, es * ce.h * 0.68, es * 0.04], es * 0.3, inner);
          if (look.tuftEars) ep.spike([0, es * ce.h * 0.85, 0], [0, es * (ce.h * 0.85 + 0.5), -0.01], es * 0.11, look.tuftEars);
        } else {
          ep.ball(es * 0.42, es * 0.7, es * 0.14, spec.earC ?? fur, 0, es * 0.55, 0, 0, 10, 8);
          ep.ball(es * 0.26, es * 0.48, es * 0.08, inner, 0, es * 0.5, es * 0.1, 0, 8, 6);
        }
        if (look.tuftEars) ep.spike([0, es * 1.5, 0], [0, es * 2.0, -0.02], es * 0.06, look.tuftEars);
      } else if (spec.ears === 'round') {
        ep.ball(es * 0.62, es * 0.6, es * 0.18, spec.earC ?? fur, 0, es * 0.4, 0, 0, 10, 8);
        ep.ball(es * 0.4, es * 0.38, es * 0.1, inner, 0, es * 0.38, es * 0.1, 0, 8, 6);
      } else {
        ep.ball(es * 0.3, es * 1.4, es * 0.12, spec.earC ?? fur, 0, es * 1.0, 0, 0, 10, 8);
        ep.ball(es * 0.18, es * 1.1, es * 0.07, inner, 0, es * 1.0, es * 0.08, 0, 8, 6);
      }
      e.add(new THREE.Mesh(ep.merged(), new THREE.MeshBasicMaterial()));
      e.rotation.z = s * -0.3;
      head.add(e);
      ears.push({ o: e, side: s });
    }
  }
  torso.add(head);

  // --- legs ---
  const legs: THREE.Group[] = [];
  const lx = Wh * 0.74;
  const lz = L / 2 - T * 1.4;
  const rise = T * 0.5;
  const plantigrade = look.kind === 'bear' || look.kind === 'mustelid';
  const legCol = (sockC?: number) => (y: number) => (sockC !== undefined && y < -hip * 0.5 ? mix(fur, sockC, 0.9) : y < -hip * 0.8 ? mix(fur, pawC, 0.35) : fur);
  for (const [sx, sz] of [[1, 1], [-1, -1], [-1, 1], [1, -1]] as const) {
    const g = new THREE.Group();
    g.position.set(sx * lx, hip + rise, sz * lz);
    const front = sz > 0;
    const bottom = -(hip + rise);
    const lp = new Parts();
    const lc = (y: number) => legCol(look.sock)(y);
    const seg = (a: V3, b: V3, r0: number, r1: number) => lp.seg(a, b, r0, r1, lc((a[1] + b[1]) / 2), 9);
    const tt = T * (plantigrade ? 1.15 : 1) * bulk;
    if (front) {
      // shoulder, then the upper arm back to the elbow, a straight forearm and the wrist
      lp.ball(Math.min(tt * 1.5, Wh * 0.5), Math.min(tt * 2.0, Hh * 0.85), Math.min(tt * 1.9, L * 0.13), fur, 0, T * 0.15, 0, 0, 12, 9);
      const e: V3 = [0, bottom * 0.5, -hip * 0.09];
      const w: V3 = [0, bottom * (plantigrade ? 0.86 : 0.9), hip * 0.02];
      seg([0, 0, 0], e, Math.min(tt * 1.1, Wh * 0.4), tt * 0.75);
      lp.ball(tt * 0.72, tt * 0.72, tt * 0.72, fur, e[0], e[1], e[2], 0, 10, 8);
      seg(e, w, tt * 0.8, tt * 0.6);
      seg(w, [0, bottom + T * 0.3, hip * 0.05], tt * 0.6, tt * 0.55);
    } else {
      // a big thigh, the knee forward, the shin back to the hock, then a long narrow foot
      lp.ball(Math.min(tt * 1.9, Wh * 0.6), Math.min(tt * 2.8, Hh * 1.0), Math.min(tt * 2.4, L * 0.16), fur, 0, T * 0.1, -T * 0.2, 0, 12, 9);
      const k: V3 = [0, bottom * 0.46, hip * 0.2];
      const h: V3 = [0, bottom * (plantigrade ? 0.86 : 0.8), -hip * 0.12];
      seg([0, 0, -T * 0.2], k, Math.min(tt * 1.3, Wh * 0.5), tt * 0.85);
      lp.ball(tt * 0.82, tt * 0.82, tt * 0.82, fur, k[0], k[1], k[2], 0, 10, 8);
      seg(k, h, tt * 0.9, tt * 0.62);
      lp.ball(tt * 0.6, tt * 0.6, tt * 0.6, fur, h[0], h[1], h[2], 0, 10, 8);
      seg(h, [0, bottom + T * 0.3, hip * 0.03], tt * 0.62, tt * 0.52);
    }
    // the paw: a broad pad with four toes
    const PT = Math.min(T, L * 0.075, Wh * 0.55); // paws stay in proportion on the big animals
    const pz = front ? hip * 0.06 : hip * 0.04;
    const pawW = Math.min(tt * (plantigrade ? 1.3 : 1.05), Wh * 0.42);
    lp.ball(pawW, PT * 0.5, PT * (plantigrade ? 1.7 : 1.45), pawC, 0, bottom + PT * 0.3, pz + PT * 0.45, 0, 10, 7);
    for (let k = -1.5; k <= 1.5; k += 1) {
      lp.ball(pawW * 0.3, PT * 0.28, PT * 0.5, pawC, k * pawW * 0.5, bottom + PT * 0.2, pz + PT * (plantigrade ? 1.9 : 1.75), 0, 6, 5);
      if (look.kind !== 'cat' || false) lp.spike([k * pawW * 0.5, bottom + PT * 0.2, pz + PT * 2.1], [k * pawW * 0.5, bottom + PT * 0.14, pz + PT * (plantigrade ? 2.45 : 2.3)], PT * 0.07, plantigrade ? 0xe8dcc6 : 0x2a2218);
    }
    g.add(new THREE.Mesh(lp.merged(), new THREE.MeshBasicMaterial()));
    root.add(g);
    legs.push(g);
  }

  // --- tail ---
  let tail: THREE.Group | null = null;
  if (spec.tail) {
    tail = new THREE.Group();
    tail.position.set(0, H * 0.2, -L / 2);
    const tc = spec.tail.c ?? fur;
    const tl = spec.tail.len;
    const n = 8;
    const path: V3[] = [];
    const radii: number[] = [];
    const up = spec.tail.up ?? 0;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      // a housecat carries its tail in a graceful curve, up and over at the tip
      if (id === 'house_cat') path.push([0, up * tl * (1.5 * u - 0.9 * u * u) - tl * 0.04 * u, -tl * u * 0.78]);
      else path.push([0, up * tl * (u * 0.9 + u * u * 0.4) - tl * 0.04 * u, -tl * u]);
      const bushy = look.kind === 'dog' ? 1 + Math.sin(u * Math.PI) * 0.45 : look.kind === 'mustelid' && id !== 'badger' ? 1 + Math.sin(u * Math.PI) * 0.25 : 1;
      radii.push(spec.tail.t * (1 - u * (id === 'house_cat' ? 0.25 : 0.55)) * bushy);
    }
    const tipC = look.tailTip;
    const ringC = look.tailRings;
    const tg = tube(path, radii, (u, a) => {
      let c = tc;
      const dorsal = Math.cos(a);
      if (dorsal < -0.2 && tc === fur) c = mix(tc, belly, 0.6);
      if (ringC !== undefined && Math.floor(u * 9) % 2 === 1) c = mix(c, ringC, 0.9);
      if (tipC !== undefined && u > 0.8) c = mix(c, tipC, 0.95);
      return c;
    });
    const tpp = new Parts();
    tpp.addGeo(tg);
    if (id === 'lion') tpp.ball(spec.tail.t * 1.3, spec.tail.t * 1.3, spec.tail.t * 2.4, 0x3a1e0c, 0, path[n - 1][1], path[n - 1][2] - spec.tail.t, 0, 8, 6);
    tail.add(new THREE.Mesh(tpp.merged(), new THREE.MeshBasicMaterial()));
    torso.add(tail);
  }
  if (spec.scale) root.scale.setScalar(spec.scale);
  void seed;
  return { root, legs, head, tail, torso, eyes, ears, hip, spec };
}

// ======================================================================================================
// reptiles
// ======================================================================================================
