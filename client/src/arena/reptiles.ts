// The ten reptiles, each built from its own anatomy rather than one body in ten colours.
//   lizards  : gecko, monitor, komodo, croc    (sprawling legs, a body slung between them, a tail that is half the animal)
//   turtles  : tortoise, snapping turtle, sea turtle   (a shell of hexagonal scutes over a plastron, a neck, and legs, claws or flippers)
//   snakes   : cobra, viper, python   (one long tube of scales laid in curves, with a head built to its habit)
// Everything is vertex-coloured geometry in the same Built shape the other animals use, so the rig animates it unchanged.
import * as THREE from 'three';
import { Parts, mix, shade } from './creatures';
import { densify } from './mammals';
import { loft, tube, vnoise, type Ring } from './realquad';
import type { Built, QuadSpec } from './models';

type V3 = [number, number, number];

const C = new THREE.Color();
const D = new THREE.Color();
const sstep = THREE.MathUtils.smoothstep;

const hash2 = (x: number, y: number, s = 0) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * One scale-patterned skin: back colour fading to a belly colour under the flanks, a staggered grid of scales of
 * slightly different shades with dark seams between them. `a` is the angle round the body (0 = straight up).
 */
function skin(base: number, belly: number, a: number, u: number, cols: number, rows: number, seam = 0.8, grain = 0.2): number {
  const c = Math.cos(a);
  const t = sstep(-c, -0.12, 0.5);
  C.setHex(base);
  if (t > 0) C.lerp(D.setHex(belly), t);
  const ang = (((a / (Math.PI * 2)) % 1) + 1) % 1;
  const row = u * rows;
  const rf = Math.floor(row);
  const col = ang * cols + (rf % 2) * 0.5;
  const cf = Math.floor(col);
  const fx = col - cf;
  const fz = row - rf;
  C.multiplyScalar(1 - grain / 2 + hash2(cf, rf, 3) * grain);
  if (Math.min(fx, 1 - fx, fz, 1 - fz) < 0.1) C.multiplyScalar(seam);
  return C.getHex();
}

const flat = (hex: number, k = 1) => C.setHex(hex).multiplyScalar(k).getHex();

/** An eye with a lid that closes by scaling in y: a raised brow, the iris, a pupil and a glint. */
function eye(head: THREE.Group, x: number, y: number, z: number, r: number, iris: number, slit: boolean, brow = 0x2a2a1a): THREE.Object3D {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = Math.sign(x) * 0.55;
  const p = new Parts();
  p.ball(r * 1.3, r * 1.15, r * 0.75, brow, 0, 0, 0, 0, 10, 8);
  p.ball(r, r * 0.95, r * 0.6, iris, 0, 0, r * 0.22, 0, 10, 8);
  if (slit) p.ball(r * 0.2, r * 0.88, r * 0.35, 0x050505, 0, 0, r * 0.55, 0, 6, 6);
  else p.ball(r * 0.55, r * 0.55, r * 0.3, 0x050505, 0, 0, r * 0.6, 0, 8, 6);
  p.ball(r * 0.2, r * 0.2, r * 0.2, 0xffffff, -Math.sign(x) * r * 0.3, r * 0.32, r * 0.7, 0, 5, 4);
  g.add(new THREE.Mesh(p.merged(), new THREE.MeshBasicMaterial()));
  head.add(g);
  return g;
}

const mesh = (p: Parts) => new THREE.Mesh(p.merged(), new THREE.MeshBasicMaterial());

/** The size of the model as the rig wants to know it. */
function specOf(spec: QuadSpec, id: string, len: number, w: number, h: number, legLen: number, legT: number, headS: number, crawl: boolean): QuadSpec {
  return { ...spec, id, len, w, h, legLen, legT, scale: 1, crawl, head: { ...spec.head, s: headS } };
}

// =====================================================================================================
// LIZARDS
// =====================================================================================================

interface Liz {
  L: number; // shoulder to hip
  W: number;
  H: number;
  hip: number; // belly clearance
  neck: { l: number; r: number; up: number };
  head: { l: number; w: number; h: number; snout: number; snoutW: number; drop: number };
  leg: { t: number; spread: number; toe: number; claw: number; pad: boolean; stance: number };
  tail: { l: number; t: number; kind: 'carrot' | 'whip' | 'thick' | 'paddle' };
  eye: { r: number; up: number; out: number; slit: boolean; col: number };
  skin: { base: number; belly: number; cols: number; rows: number };
}

const LIZ: Record<string, Liz> = {
  gecko: {
    L: 0.34, W: 0.15, H: 0.085, hip: 0.05,
    neck: { l: 0.05, r: 0.05, up: 0.1 },
    head: { l: 0.2, w: 0.145, h: 0.07, snout: 0.05, snoutW: 0.07, drop: 0 },
    leg: { t: 0.02, spread: 1.0, toe: 0.07, claw: 0, pad: true, stance: 0.95 },
    tail: { l: 0.4, t: 0.06, kind: 'carrot' },
    eye: { r: 0.034, up: 0.55, out: 0.62, slit: true, col: 0xe8c040 },
    skin: { base: 0x9aa65a, belly: 0xeadfae, cols: 26, rows: 28 },
  },
  monitor: {
    L: 0.78, W: 0.17, H: 0.17, hip: 0.2,
    neck: { l: 0.4, r: 0.058, up: 0.2 },
    head: { l: 0.3, w: 0.088, h: 0.075, snout: 0.22, snoutW: 0.04, drop: 0.01 },
    leg: { t: 0.03, spread: 0.55, toe: 0.09, claw: 1.2, pad: false, stance: 0.8 },
    tail: { l: 1.35, t: 0.07, kind: 'whip' },
    eye: { r: 0.02, up: 0.55, out: 0.6, slit: false, col: 0x2a1a0a },
    skin: { base: 0x55523a, belly: 0xd2c58a, cols: 34, rows: 60 },
  },
  komodo: {
    L: 0.95, W: 0.44, H: 0.36, hip: 0.19,
    neck: { l: 0.2, r: 0.17, up: 0.08 },
    head: { l: 0.44, w: 0.2, h: 0.14, snout: 0.22, snoutW: 0.09, drop: 0.02 },
    leg: { t: 0.085, spread: 0.7, toe: 0.12, claw: 2.2, pad: false, stance: 0.9 },
    tail: { l: 1.15, t: 0.17, kind: 'thick' },
    eye: { r: 0.03, up: 0.5, out: 0.62, slit: false, col: 0x3a2410 },
    skin: { base: 0x6c5d48, belly: 0xb8a77c, cols: 30, rows: 42 },
  },
  croc: {
    L: 1.5, W: 0.66, H: 0.3, hip: 0.1,
    neck: { l: 0.04, r: 0.22, up: 0 },
    head: { l: 0.62, w: 0.34, h: 0.11, snout: 0.7, snoutW: 0.19, drop: 0.0 },
    leg: { t: 0.09, spread: 1.0, toe: 0.14, claw: 0.8, pad: false, stance: 0.95 },
    tail: { l: 1.7, t: 0.28, kind: 'paddle' },
    eye: { r: 0.034, up: 0.95, out: 0.62, slit: true, col: 0xd8b82a },
    skin: { base: 0x4d6a3a, belly: 0xd6d09a, cols: 30, rows: 40 },
  },
};
export const LIZARD = new Set(Object.keys(LIZ));

function lizardSkin(id: string, s: Liz): (z: number, a: number, x: number, y: number, u: number) => number {
  const { base, belly, cols, rows } = s.skin;
  return (_z, a, x, y, u) => {
    let c = skin(base, belly, a, u, cols, rows, id === 'croc' ? 0.7 : 0.82, id === 'komodo' ? 0.32 : 0.2);
    const d = Math.cos(a);
    if (d > 0.05) {
      if (id === 'gecko') {
        // big saddle blotches of orange-yellow with dark rims
        const n = vnoise(u * 14, a * 2.2, 5);
        if (n > 0.6) c = mix(c, 0xe6b43a, 0.9);
        else if (n > 0.56) c = mix(c, 0x3a2a14, 0.7);
      } else if (id === 'monitor') {
        // pale ocelli in rows, and a fainter banding down the tail
        const n = vnoise(u * 90, a * 5, 9);
        if (n > 0.7) c = mix(c, 0xe8d98a, 0.85);
      } else if (id === 'komodo') {
        const n = vnoise(u * 160, a * 8, 2);
        if (n > 0.72) c = mix(c, 0xc9b88e, 0.6);
        else if (n < 0.2) c = shade(c, 0.7);
      } else if (id === 'croc') {
        const n = vnoise(u * 18, a * 3, 4);
        if (n > 0.6) c = mix(c, 0x1e2a14, 0.6);
        if (Math.sin(u * 60) > 0.78 && u > 0.35) c = mix(c, 0x1e2a14, 0.7); // the dark bands down the tail
      }
    }
    void x;
    void y;
    return c;
  };
}

export function buildLizard(spec: QuadSpec, id: string): Built {
  const s = LIZ[id];
  const { L, W, H, hip } = s;
  const Wh = W / 2;
  const Hh = H / 2;
  const croc = id === 'croc';
  const komodo = id === 'komodo';
  const gecko = id === 'gecko';
  const monitor = id === 'monitor';
  const sk = lizardSkin(id, s);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = hip + Hh;
  root.add(torso);

  // ---- the body: shoulders, a deep or flat barrel, hips ----
  const bd = komodo ? 1.35 : croc ? 0.75 : monitor ? 0.85 : 0.9; // how far the belly hangs
  const rings: Ring[] = [
    { z: -0.5 * L, w: 0.62 * Wh, top: 0.7 * Hh, bot: 0.6 * Hh },
    { z: -0.36 * L, w: 0.95 * Wh, top: 0.96 * Hh, bot: 0.86 * Hh * bd }, // hips
    { z: -0.1 * L, w: 1.0 * Wh, top: 1.0 * Hh, bot: 0.95 * Hh * bd },
    { z: 0.18 * L, w: 1.0 * Wh, top: 1.02 * Hh, bot: 0.92 * Hh * bd },
    { z: 0.38 * L, w: 0.86 * Wh, top: 0.98 * Hh, bot: 0.78 * Hh }, // shoulders
    { z: 0.5 * L, w: 0.62 * Wh, top: 0.8 * Hh, bot: 0.62 * Hh },
  ];
  const bp = new Parts();
  bp.addGeo(loft(densify(rings, 44), (z, a, y, x) => sk(z, a, x, y, (z + L * 0.5) / L), 22));
  // the back: a croc wears two rows of raised bony plates, a gecko a scatter of tubercles, a komodo loose, heavy skin
  if (croc) {
    for (let i = 0; i < 17; i++) {
      const z = -0.44 * L + i * 0.058 * L;
      const k = i < 14 ? 1 : 0.7;
      for (const rx of [-0.3, 0.3]) bp.ball(0.075 * Wh * k + 0.012, 0.045 + 0.015, 0.02 * L + 0.01, 0x2a3a1c, rx * Wh, Hh * 0.98, z, 0, 6, 5);
    }
    for (let i = 0; i < 6; i++) bp.ball(0.04 * Wh + 0.01, 0.03, 0.04, 0x2a3a1c, 0, Hh * 1.0, -0.3 * L + i * 0.14 * L, 0, 5, 4); // a ridge on the spine
  } else if (komodo) {
    for (let i = 0; i < 4; i++) bp.ball(0.5 * Wh, 0.06 * Hh, 0.12 * L, shade(s.skin.base, 0.82), 0, Hh * (0.95 - i * 0.02), 0.28 * L - i * 0.2 * L, 0, 8, 5); // folds along the back
  } else if (gecko) {
    for (let i = 0; i < 14; i++) bp.ball(0.025, 0.02, 0.025, mix(s.skin.base, 0xe6b43a, 0.5), Math.sin(i * 2.4) * 0.5 * Wh, Hh * 0.9, -0.4 * L + i * 0.06 * L, 0, 5, 4);
  }
  // the neck
  const nBase: V3 = [0, Hh * 0.1, 0.4 * L];
  const nTip: V3 = [0, Hh * 0.1 + s.neck.l * s.neck.up * 2, 0.4 * L + s.neck.l];
  const np: V3[] = [];
  const nr: number[] = [];
  for (let i = 0; i < 7; i++) {
    const u = i / 6;
    np.push([0, nBase[1] + (nTip[1] - nBase[1]) * u + Math.sin(u * Math.PI) * s.neck.l * 0.04, nBase[2] + (nTip[2] - nBase[2]) * u]);
    nr.push(Math.max(0.02, s.neck.r * (1.2 - 0.45 * u)));
  }
  bp.addGeo(tube(np, nr, (u, a) => sk(0, a, 0, 0, 0.98), 14));
  if (komodo) bp.ball(0.1, 0.1, 0.2, mix(s.skin.belly, s.skin.base, 0.4), 0, nBase[1] - 0.12, nTip[2] - 0.06, 0, 8, 6); // the dewlap
  if (monitor || gecko) bp.ball(0.5 * Wh, 0.4 * Hh, 0.12 * L, shade(s.skin.base, 1.05), 0, Hh * 0.2, 0.5 * L, 0, 8, 6);
  torso.add(mesh(bp));

  // ---- the head ----
  const head = new THREE.Group();
  const { l: hl, w: hw, h: hh, snout: sl, snoutW: sw } = s.head;
  head.position.set(0, nTip[1] - s.head.drop, nTip[2] + hl * 0.25);
  const hp = new Parts();
  const headSkin = (z: number, a: number) => skin(s.skin.base, s.skin.belly, a, (z + hl) / (hl * 2 + sl), s.skin.cols * 0.5, 14, 0.78, 0.24);
  // gecko: a wide triangular head with a short blunt muzzle; croc: a flat, long, widening-at-the-nose snout with a bulb on the tip
  const hr: Ring[] = croc
    ? [
        { z: -0.55 * hl, w: 0.9 * hw, top: 0.9 * hh, bot: 0.8 * hh },
        { z: 0.0, w: hw, top: hh, bot: 0.9 * hh },
        { z: 0.45 * hl, w: 0.62 * hw, top: 0.62 * hh, bot: 0.7 * hh, cy: -0.1 * hh },
        { z: 0.5 * hl + sl * 0.45, w: sw * 1.05, top: 0.5 * hh, bot: 0.6 * hh, cy: -0.14 * hh },
        { z: 0.5 * hl + sl * 0.82, w: sw * 1.15, top: 0.5 * hh, bot: 0.6 * hh, cy: -0.14 * hh }, // the swell round the big front teeth
        { z: 0.5 * hl + sl, w: sw * 0.85, top: 0.42 * hh, bot: 0.5 * hh, cy: -0.14 * hh },
      ]
    : [
        { z: -0.55 * hl, w: 0.8 * hw, top: 0.9 * hh, bot: 0.75 * hh },
        { z: -0.1 * hl, w: hw, top: hh, bot: 0.8 * hh },
        { z: 0.3 * hl, w: Math.max(sw * 1.5, 0.62 * hw), top: 0.82 * hh, bot: 0.65 * hh, cy: -0.05 * hh },
        { z: 0.5 * hl + sl * 0.5, w: sw * 1.1, top: 0.62 * hh, bot: 0.5 * hh, cy: -0.1 * hh },
        { z: 0.5 * hl + sl * 0.9, w: sw * 0.9, top: 0.5 * hh, bot: 0.42 * hh, cy: -0.1 * hh },
        { z: 0.5 * hl + sl, w: sw * 0.6, top: 0.42 * hh, bot: 0.36 * hh, cy: -0.1 * hh },
      ];
  hp.addGeo(loft(densify(hr, 22), (z, a) => headSkin(z, a), 16));
  // the lower jaw: its own, paler, with the dark mouth line between
  const jy = -0.5 * hh;
  hp.addGeo(
    loft(
      [
        { z: -0.2 * hl, w: 0.82 * hw, top: 0.12 * hh, bot: 0.26 * hh, cy: jy },
        { z: 0.4 * hl, w: Math.max(sw * 1.3, 0.55 * hw), top: 0.1 * hh, bot: 0.22 * hh, cy: jy },
        { z: 0.5 * hl + sl * (croc ? 0.95 : 0.97), w: sw * (croc ? 1.0 : 0.8), top: 0.07 * hh, bot: 0.16 * hh, cy: jy - 0.02 * hh },
      ],
      (_z, a) => (Math.cos(a) > 0.55 ? 0x2a1214 : s.skin.belly),
      12,
    ),
  );
  // teeth, and nostrils
  const nT = croc ? 11 : komodo ? 8 : monitor ? 7 : 5;
  for (let i = 0; i < nT; i++) {
    for (const sx of [-1, 1]) {
      const f = i / (nT - 1);
      const z = 0.05 * hl + (0.45 * hl + sl * 0.95) * f;
      const w = (croc ? sw * (1.05 + 0.1 * Math.sin(f * 3)) : sw * (1.0 - 0.15 * f)) + (f < 0.3 ? 0.18 * hw : 0);
      const big = croc && (i === 3 || i === 8);
      const tl = (croc ? 0.075 : komodo ? 0.05 : 0.025) * (big ? 1.5 : 1) * (gecko ? 0.5 : 1);
      hp.spike([sx * w, jy + 0.12 * hh, z], [sx * w, jy + 0.12 * hh + (i % 2 ? tl : tl * 0.7), z], (croc ? 0.012 : 0.008) * (big ? 1.4 : 1), 0xf3ecd6);
      if (komodo || croc) hp.spike([sx * w * 0.98, -0.2 * hh, z + 0.015], [sx * w * 0.98, -0.2 * hh - tl * (i % 2 ? 0.8 : 1.1), z + 0.015], 0.01, 0xf3ecd6);
    }
  }
  const tipZ = 0.5 * hl + sl * 0.97;
  for (const sx of [-1, 1]) hp.ball(croc ? 0.03 : 0.012, croc ? 0.025 : 0.01, croc ? 0.03 : 0.014, 0x161410, sx * (croc ? 0.4 : 0.55) * sw, croc ? 0.48 * hh : 0.4 * hh, tipZ - (croc ? 0.02 : 0.005), 0, 5, 4);
  if (croc) hp.ball(0.5 * sw, 0.3 * hh, 0.4 * sw, shade(s.skin.base, 0.7), 0, 0.45 * hh, tipZ - 0.04, 0, 8, 6); // the knob of the nostrils on the snout
  if (monitor) {
    // the long, forked, flicking tongue
    const tz = tipZ;
    hp.seg([0, jy + 0.2 * hh, tz - 0.02], [0, jy + 0.18 * hh, tz + 0.13], 0.005, 0.004, 0xc8283a, 4);
    hp.seg([0, jy + 0.18 * hh, tz + 0.13], [0.025, jy + 0.17 * hh, tz + 0.19], 0.004, 0.002, 0xc8283a, 4);
    hp.seg([0, jy + 0.18 * hh, tz + 0.13], [-0.025, jy + 0.17 * hh, tz + 0.19], 0.004, 0.002, 0xc8283a, 4);
  }
  if (gecko) {
    // a gecko's head is mostly eyes: add the dark mouth-line and a round muzzle pad
    hp.ball(0.5 * sw, 0.3 * hh, 0.4 * sw, shade(s.skin.base, 1.1), 0, 0.15 * hh, 0.5 * hl + sl * 0.8, 0, 8, 6);
  }
  head.add(mesh(hp));
  const e = s.eye;
  const eyes = [-1, 1].map((sx) => eye(head, sx * e.out * hw, e.up * hh, 0.02 * hl + (croc ? 0.05 : 0.12 * hl), e.r, e.col, e.slit, shade(s.skin.base, 0.55)));
  if (gecko) for (const o of eyes) o.scale.setScalar(1.0);
  torso.add(head);

  // ---- legs: they sprawl out from the shoulder, bend down at the elbow, and end in a splayed foot ----
  const legs: THREE.Group[] = [];
  const lz = L * 0.36;
  const t = s.leg.t;
  const lx = Wh * 0.92;
  const topY = hip + Hh * 0.45;
  for (const [sx, sz] of [[1, 1], [-1, -1], [-1, 1], [1, -1]] as const) {
    const g = new THREE.Group();
    g.position.set(sx * lx, topY, sz * lz);
    const front = sz > 0;
    const bottom = -topY;
    const lp = new Parts();
    const out = s.leg.spread * (front ? 1 : 1.05);
    const elbow: V3 = [sx * (topY * 0.6 * out + t), bottom * 0.4, front ? -t * 1.4 : t * 1.2];
    const foot: V3 = [sx * (topY * 0.78 * out + t * 1.4), bottom + t * 0.4, front ? t * 0.9 : -t * 0.2];
    lp.ball(t * 2.0, t * 1.8, t * 2.2, shade(s.skin.base, 1.0), sx * t * 0.2, 0, 0, 0, 10, 8); // the shoulder muscle
    lp.seg([sx * t * 0.3, 0, 0], elbow, t * 1.35, t * 1.0, s.skin.base, 8);
    lp.ball(t * 1.05, t * 1.05, t * 1.05, shade(s.skin.base, 0.92), elbow[0], elbow[1], elbow[2], 0, 7, 6);
    lp.seg(elbow, foot, t * 1.0, t * 0.75, shade(s.skin.base, 0.94), 8);
    // the foot: a flat pad and five toes fanned out, each with a claw
    lp.ball(t * 1.2, t * 0.38, t * 1.5, shade(s.skin.base, 0.75), foot[0], bottom + t * 0.22, foot[2] + t * 0.5, 0, 8, 6);
    for (let k = -2; k <= 2; k++) {
      const fan = k * 0.42;
      const base: V3 = [foot[0] + k * t * 0.35, bottom + t * 0.2, foot[2] + t * 1.0];
      const tip: V3 = [base[0] + Math.sin(fan + sx * 0.25) * s.leg.toe, bottom + t * (s.leg.pad ? 0.16 : 0.1), base[2] + Math.cos(fan) * s.leg.toe * (1 - Math.abs(k) * 0.12)];
      lp.seg(base, tip, t * 0.27, t * (s.leg.pad ? 0.34 : 0.14), shade(s.skin.base, 0.72), 5);
      if (s.leg.pad) lp.ball(t * 0.5, t * 0.1, t * 0.6, shade(s.skin.belly, 0.9), tip[0], tip[1] + 0.003, tip[2], 0, 6, 4); // the round sticky toe pad
      if (s.leg.claw > 0) lp.spike(tip, [tip[0] + Math.sin(fan) * t * 0.5, bottom + t * 0.03, tip[2] + t * 0.55 * s.leg.claw], t * 0.1 * Math.max(1, s.leg.claw * 0.8), 0x26201a);
    }
    g.add(mesh(lp));
    root.add(g);
    legs.push(g);
  }

  // ---- the tail ----
  const tail = new THREE.Group();
  tail.position.set(0, 0, -L * 0.5 + 0.02 * L);
  const tl = s.tail.l;
  const tt = s.tail.t;
  const n = 16;
  const path: V3[] = [];
  const radii: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const sway = Math.sin(u * 5.5) * tl * (s.tail.kind === 'whip' ? 0.06 : 0.025) * u;
    path.push([sway, -u * u * Hh * (gecko ? 0.2 : 0.55) + (croc ? Hh * 0.1 * (1 - u) : 0), -tl * u]);
    let r: number;
    switch (s.tail.kind) {
      case 'carrot': r = tt * Math.pow(Math.sin(Math.min(1, u * 1.15 + 0.12) * Math.PI * 0.55), 0.7) * (1 - u * 0.25) * Math.pow(1 - u, 0.5); break; // fat and tapering, a gecko's fat store
      case 'whip': r = tt * Math.pow(1 - u, 1.15) + 0.006; break;
      case 'thick': r = tt * (1 - u * 0.88); break;
      default: r = tt * (1 - u * 0.92) * (1 + Math.sin(u * 3) * 0.1);
    }
    radii.push(Math.max(0.006, r));
  }
  const tp = new Parts();
  tp.addGeo(tube(path, radii, (u, a) => {
    let c = sk(0, a, 0, 0, 0.6 + u * 0.4);
    if (gecko && Math.cos(a) > 0 && Math.sin(u * 46) > 0.4) c = mix(c, 0xf1e8c4, 0.8); // the banded tail
    if (monitor && Math.cos(a) > 0 && Math.sin(u * 60) > 0.55) c = mix(c, 0xd6c98a, 0.7);
    return c;
  }, 12));
  if (croc) {
    // the tall plates down the tail that join into a single crest: a rowing paddle
    for (let i = 1; i < n - 1; i++) {
      const u = i / (n - 1);
      const k = u < 0.4 ? 1 : 0;
      const h = radii[i] * (0.9 + 0.3 * (1 - u));
      if (k) for (const rx of [-0.28, 0.28]) tp.ball(radii[i] * 0.2, h * 0.5, (tl / n) * 0.55, 0x2a3a1c, path[i][0] + rx * radii[i], path[i][1] + radii[i] * 0.95, path[i][2], 0, 5, 4);
      else tp.ball(radii[i] * 0.16, h * 0.9, (tl / n) * 0.6, 0x2a3a1c, path[i][0], path[i][1] + radii[i] * 0.95, path[i][2], 0, 5, 4);
    }
  }
  tail.add(mesh(tp));
  torso.add(tail);

  return { root, legs, head, tail, torso, eyes, ears: [], hip, spec: specOf(spec, id, L, W, H, hip, t, hl, true) };
}

// =====================================================================================================
// TURTLES
// =====================================================================================================

interface Tur {
  L: number; // shell length
  W: number;
  H: number; // shell height
  hip: number;
  dome: number; // how steeply the back rises
  shell: number;
  rim: number;
  skin: number;
  skinBelly: number;
  head: { l: number; w: number; h: number; neck: number; beak: number };
  leg: 'column' | 'walk' | 'flipper';
  tail: { l: number; t: number; saw: boolean };
  eye: number;
}

const TUR: Record<string, Tur> = {
  tortoise: {
    L: 1.0, W: 0.78, H: 0.46, hip: 0.1, dome: 1.0, shell: 0x8a6a36, rim: 0xcfae6c, skin: 0x9a8a5e, skinBelly: 0xc2b27e,
    head: { l: 0.22, w: 0.15, h: 0.13, neck: 0.16, beak: 0.02 }, leg: 'column', tail: { l: 0.1, t: 0.05, saw: false }, eye: 0x1a1006,
  },
  snapping_turtle: {
    L: 0.78, W: 0.6, H: 0.24, hip: 0.12, dome: 0.55, shell: 0x3e3b26, rim: 0x6a6446, skin: 0x5c5a3a, skinBelly: 0xb8b48a,
    head: { l: 0.25, w: 0.15, h: 0.11, neck: 0.2, beak: 0.05 }, leg: 'walk', tail: { l: 0.62, t: 0.075, saw: true }, eye: 0xd8b030,
  },
  sea_turtle: {
    L: 1.15, W: 0.88, H: 0.22, hip: 0.1, dome: 0.5, shell: 0x6e6a34, rim: 0xcfc884, skin: 0x6a8a5a, skinBelly: 0xe6e0a8,
    head: { l: 0.26, w: 0.15, h: 0.12, neck: 0.16, beak: 0.04 }, leg: 'flipper', tail: { l: 0.16, t: 0.04, saw: false }, eye: 0x1a1006,
  },
};
export const TURTLE = new Set(Object.keys(TUR));

export function buildTurtle(spec: QuadSpec, id: string): Built {
  const s = TUR[id];
  const { L, W, H, hip } = s;
  const Wh = W / 2;
  const tort = id === 'tortoise';
  const snap = id === 'snapping_turtle';
  const sea = id === 'sea_turtle';
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = hip + H * 0.45;
  root.add(torso);

  // ---- the shell: a rounded dome over a flat plastron, scutes laid out in a hexagon-ish grid, a lighter flared rim ----
  const z0 = -L / 2;
  const rings: Ring[] = [
    { z: z0, w: 0.34 * Wh, top: 0.26 * H * s.dome, bot: 0.1 * H, cy: 0.0 },
    { z: z0 + 0.06 * L, w: 0.74 * Wh, top: 0.7 * H * s.dome, bot: 0.22 * H, cy: 0.04 * H },
    { z: z0 + 0.22 * L, w: 0.98 * Wh, top: 0.98 * H * s.dome, bot: 0.3 * H, cy: 0.08 * H },
    { z: z0 + 0.5 * L, w: 1.04 * Wh, top: 1.0 * H * s.dome, bot: 0.32 * H, cy: 0.1 * H },
    { z: z0 + 0.78 * L, w: 0.96 * Wh, top: 0.9 * H * s.dome, bot: 0.3 * H, cy: 0.08 * H },
    { z: z0 + 0.94 * L, w: 0.7 * Wh, top: 0.6 * H * s.dome, bot: 0.22 * H, cy: 0.04 * H },
    { z: z0 + L, w: 0.34 * Wh, top: 0.28 * H * s.dome, bot: 0.1 * H, cy: 0.0 },
  ];
  const cell = (tort ? 0.2 : snap ? 0.17 : 0.18) * Math.max(0.6, L);
  const shellColor = (z: number, a: number, y: number, x: number): number => {
    const c = Math.cos(a);
    const sn = Math.abs(Math.sin(a));
    if (c < -0.25 && sn < 0.97) return flat(s.rim, 0.9 + vnoise(x * 12, z * 12, 2) * 0.2); // the plastron
    // a central row of large scutes between two rows of side scutes, and a ring of small marginals round the rim
    const zz = (z - z0) / cell;
    const rim = sn > 0.86 || c < 0.05;
    let base = s.shell;
    if (rim) {
      const m = Math.floor(zz * 1.5);
      const k = hash2(m, 5, 1);
      C.setHex(s.rim).lerp(D.setHex(s.shell), 0.35 + k * 0.2);
      const f = zz * 1.5 - m;
      if (f < 0.1) C.multiplyScalar(0.55);
      return C.getHex();
    }
    const row = Math.floor(zz);
    const centre = sn < 0.38;
    const cx = x / cell + (centre ? 0 : (row % 2) * 0.5);
    const cf = Math.floor(centre ? 0 : cx);
    const fx = centre ? (x / (cell * 0.9)) % 1 : cx - cf;
    const fz = zz - row;
    C.setHex(base).multiplyScalar(0.78 + hash2(cf, row, centre ? 9 : 4) * 0.42);
    // growth rings in each scute and dark seams between them
    const ring = Math.sin((Math.min(fz, 1 - fz) + Math.min(Math.abs(fx), 1 - Math.abs(fx))) * 22);
    if (tort) C.multiplyScalar(0.92 + ring * 0.07);
    if (Math.min(fz, 1 - fz) < 0.09 || Math.min(Math.abs(fx % 1), 1 - Math.abs(fx % 1)) < 0.07) C.multiplyScalar(snap ? 0.55 : 0.5);
    if (sea && y > 0) C.lerp(D.setHex(0xb0a050), 0.25 * Math.abs(Math.sin(zz * 2.2)));
    return C.getHex();
  };
  const tp = new Parts();
  tp.addGeo(loft(densify(rings, 40), shellColor, 28));
  // snapper: three ridged keels down the back and a saw-toothed rear edge
  if (snap) {
    for (let i = 0; i < 9; i++) {
      const z = z0 + L * (0.14 + i * 0.09);
      const h = (1 - Math.abs(i - 4) / 6) * H * s.dome;
      for (const kx of [0, -0.42, 0.42]) tp.spike([kx * Wh, H * 0.1 + h * (kx ? 0.83 : 1), z], [kx * Wh, H * 0.1 + h * (kx ? 0.83 : 1) + 0.075, z - 0.035], 0.035, 0x23200f);
    }
    for (let i = 0; i < 9; i++) {
      const a = (-0.8 + (i / 8) * 1.6) * Math.PI * 0.5;
      tp.spike([Math.sin(a) * Wh * 0.55, H * 0.05, z0 + 0.02 * L], [Math.sin(a) * Wh * 0.6, H * 0.02, z0 - 0.07], 0.03, 0x23200f);
    }
  }
  // tortoise: a raised pyramid on every scute of the great dome
  if (tort) {
    for (let r = 0; r < 4; r++) {
      const z = z0 + L * (0.22 + r * 0.19);
      const hx = H * s.dome * (1.02 - Math.abs(r - 1.4) * 0.12);
      tp.ball(0.14 * Wh, 0.05 * H, 0.07 * L, flat(s.shell, 1.15), 0, H * 0.1 + hx * 0.99, z, 0, 8, 5);
      for (const sx of [-1, 1]) tp.ball(0.12 * Wh, 0.04 * H, 0.065 * L, flat(s.shell, 1.1), sx * Wh * 0.5, H * 0.1 + hx * 0.8, z, 0, 8, 5);
    }
  }
  torso.add(mesh(tp));

  // ---- neck and head ----
  const head = new THREE.Group();
  const { l: hl, w: hw, h: hh } = s.head;
  const neckL = s.head.neck;
  const skinOf = (a: number, u: number) => skin(s.skin, s.skinBelly, a, u, 30, 70, 0.9, 0.2); // fine, soft scales: a turtle's head and neck are leathery, not ribbed
  const tp2 = new Parts();
  const np: V3[] = [];
  const nr: number[] = [];
  const nFrom: V3 = [0, H * 0.12, L * 0.5 - 0.05 * L];
  for (let i = 0; i < 7; i++) {
    const u = i / 6;
    np.push([0, nFrom[1] + (snap ? 0.04 : 0.02) * Math.sin(u * 3), nFrom[2] + neckL * u]);
    nr.push(Math.max(0.025, hw * (snap ? 0.85 : 0.7) * (1 - 0.1 * u)) * (tort ? 1.0 : 1));
  }
  tp2.addGeo(tube(np, nr, (u, a) => skinOf(a, u * 0.6), 12));
  if (snap) for (let i = 0; i < 5; i++) tp2.spike([0, nFrom[1] + hw * 0.7, nFrom[2] + neckL * (0.1 + i * 0.16)], [0, nFrom[1] + hw * 0.7 + 0.045, nFrom[2] + neckL * (0.1 + i * 0.16) - 0.015], 0.02, shade(s.skin, 0.65)); // the tubercles on a snapper's neck
  torso.add(mesh(tp2));
  head.position.set(0, nFrom[1], nFrom[2] + neckL + hl * 0.1);
  const hp = new Parts();
  hp.addGeo(
    loft(
      densify(
        [
          { z: -0.7 * hl, w: 0.85 * hw, top: 0.9 * hh, bot: 0.85 * hh },
          { z: -0.2 * hl, w: hw, top: 1.0 * hh, bot: 0.9 * hh },
          { z: 0.25 * hl, w: 0.95 * hw, top: 0.9 * hh, bot: 0.75 * hh },
          { z: 0.6 * hl, w: 0.78 * hw, top: 0.74 * hh, bot: 0.6 * hh },
          { z: 0.88 * hl, w: 0.55 * hw, top: 0.52 * hh, bot: 0.42 * hh },
          { z: hl, w: 0.32 * hw, top: 0.34 * hh, bot: 0.28 * hh },
        ],
        20,
      ),
      (z, a) => skinOf(a, (z + hl) / (hl * 2)),
      16,
    ),
  );
  // the horny beak: a hooked upper beak over a notched lower one
  const beakC = tort ? 0x8a7a50 : snap ? 0x4a3e22 : 0x6a5a30;
  hp.ball(0.28 * hw, 0.2 * hh, 0.34 * hw + s.head.beak, beakC, 0, -0.05 * hh, hl * 0.95, 0, 8, 6);
  hp.ball(0.2 * hw, 0.14 * hh, 0.1 * hw + s.head.beak, shade(beakC, 0.65), 0, -0.16 * hh, hl * 1.0 + s.head.beak * 0.4, 0.5, 6, 5); // the hook
  if (snap) {
    // a snapper's huge head carries heavy crests over the eyes and a wide gape
    for (const sx of [-1, 1]) hp.ball(0.2 * hw, 0.2 * hh, 0.3 * hl, shade(s.skin, 0.8), sx * 0.7 * hw, 0.62 * hh, 0.05 * hl, 0, 7, 5);
    hp.seg([-0.55 * hw, -0.28 * hh, 0.3 * hl], [0.55 * hw, -0.28 * hh, 0.3 * hl], 0.012, 0.012, 0x1c0f0f, 4);
    for (let i = 0; i < 3; i++) hp.spike([0, -0.5 * hh, 0.1 * hl + i * 0.12 * hl], [0, -0.85 * hh - i * 0.03, 0.14 * hl + i * 0.12 * hl], 0.025, shade(s.skin, 0.65)); // barbels under the chin
  }
  head.add(mesh(hp));
  const eyes = [-1, 1].map((sx) => eye(head, sx * 0.62 * hw, 0.38 * hh, 0.2 * hl, hh * (sea ? 0.2 : snap ? 0.17 : 0.22), s.eye, false, shade(s.skin, 0.55)));
  torso.add(head);

  // ---- legs ----
  const legs: THREE.Group[] = [];
  const lz = L * (sea ? 0.2 : 0.3);
  const top = hip + H * 0.2;
  for (const [sx, sz] of [[1, 1], [-1, -1], [-1, 1], [1, -1]] as const) {
    const g = new THREE.Group();
    const front = sz > 0;
    g.position.set(sx * Wh * (sea ? 0.82 : 0.74), top, sz * lz);
    const bottom = -top;
    const lp = new Parts();
    const dark = shade(s.skin, 0.8);
    if (s.leg === 'column') {
      // a tortoise's elephantine column, plated with big scales down the front, and a blunt-clawed foot
      const t = 0.12;
      lp.seg([sx * 0.02, 0, 0], [sx * 0.03, bottom * 0.5, 0], t * 1.15, t * 1.05, s.skin, 10);
      lp.seg([sx * 0.03, bottom * 0.5, 0], [sx * 0.04, bottom + t * 0.4, 0], t * 1.05, t * 0.95, s.skin, 10);
      for (let i = 0; i < 4; i++) lp.ball(t * 0.5, t * 0.18, t * 0.45, shade(s.skin, 0.75), sx * 0.03, bottom * (0.15 + i * 0.2), t * 0.85, 0, 7, 5); // heavy front scales
      lp.ball(t * 1.25, t * 0.5, t * 1.45, dark, sx * 0.04, bottom + t * 0.22, t * 0.3, 0, 9, 6);
      for (let k = -1; k <= 1; k++) lp.spike([sx * 0.04 + k * t * 0.55, bottom + t * 0.16, t * 1.5], [sx * 0.04 + k * t * 0.62, bottom + t * 0.05, t * 2.0], t * 0.17, 0x2a2218);
    } else if (s.leg === 'walk') {
      // a snapper's strong, wide-stanced limbs, scaled and clawed
      const t = 0.07;
      const el: V3 = [sx * t * 3.2, bottom * 0.55, front ? -t * 0.4 : t * 0.6];
      const ft: V3 = [sx * t * 3.8, bottom + t * 0.4, front ? t * 0.7 : -t * 0.1];
      lp.seg([0, 0, 0], el, t * 1.6, t * 1.15, s.skin, 8);
      lp.seg(el, ft, t * 1.15, t * 0.85, shade(s.skin, 0.92), 8);
      lp.ball(t * 1.5, t * 0.4, t * 1.9, dark, ft[0], bottom + t * 0.2, ft[2] + t * 0.8, 0, 8, 6);
      for (let k = -2; k <= 2; k++) {
        const tip: V3 = [ft[0] + k * t * 0.55, bottom + t * 0.1, ft[2] + t * 2.4 - Math.abs(k) * t * 0.2];
        lp.seg([ft[0] + k * t * 0.4, bottom + t * 0.2, ft[2] + t * 1.2], tip, t * 0.3, t * 0.15, dark, 5);
        lp.spike(tip, [tip[0] + k * t * 0.1, bottom + t * 0.02, tip[2] + t * 0.8], t * 0.14, 0x2a2218);
      }
      for (let i = 0; i < 3; i++) lp.ball(t * 0.8, t * 0.25, t * 0.5, shade(s.skin, 0.7), sx * t * 1.1, bottom * (0.15 + i * 0.12), t * 0.9, 0, 6, 4);
    } else {
      // a sea turtle's flipper: a long, flat paddle swept back, bigger in front than behind
      const fl = front ? 0.62 : 0.3;
      const fw = front ? 0.15 : 0.1;
      const root0: V3 = [0, 0, 0];
      const mid: V3 = [sx * fl * 0.5, bottom * 0.4, front ? -fl * 0.25 : -fl * 0.15];
      const tip: V3 = [sx * fl, bottom * 0.72, front ? -fl * 0.55 : -fl * 0.4];
      lp.seg(root0, mid, 0.075, 0.06, s.skin, 8);
      lp.seg(mid, tip, 0.06, 0.016, s.skin, 8);
      // the blade: a flat paddle lofted along the limb, broad in the middle, with a pale underside
      const dir = new THREE.Vector3(tip[0] - root0[0], tip[1] - root0[1], tip[2] - root0[2]);
      const len = dir.length();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
      const blade = loft(
        [
          { z: 0, w: fw * 0.35, top: 0.03, bot: 0.025 },
          { z: len * 0.3, w: fw * 0.85, top: 0.022, bot: 0.018 },
          { z: len * 0.62, w: fw, top: 0.016, bot: 0.012 },
          { z: len * 0.9, w: fw * 0.45, top: 0.008, bot: 0.006 },
          { z: len, w: 0.01, top: 0.004, bot: 0.004 },
        ],
        (_z, a) => (Math.cos(a) < -0.2 ? s.skinBelly : shade(s.skin, 0.95)),
        14,
      );
      blade.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(root0[0], root0[1], root0[2]), q, new THREE.Vector3(1, 1, 1)));
      lp.addGeo(blade);
      lp.spike([tip[0], tip[1], tip[2]], [tip[0] + sx * 0.04, tip[1] - 0.02, tip[2] - 0.06], 0.02, 0x2a2218);
    }
    g.add(mesh(lp));
    root.add(g);
    legs.push(g);
  }

  // ---- the tail ----
  const tail = new THREE.Group();
  tail.position.set(0, H * 0.1, z0 + 0.01 * L);
  const tl = s.tail.l;
  const tpp = new Parts();
  const tpath: V3[] = [];
  const tr: number[] = [];
  for (let i = 0; i < 9; i++) {
    const u = i / 8;
    tpath.push([Math.sin(u * 4) * 0.02 * tl * 4, -u * u * 0.05, -tl * u]);
    tr.push(Math.max(0.006, s.tail.t * Math.pow(1 - u, 0.9)));
  }
  tpp.addGeo(tube(tpath, tr, (u, a) => skinOf(a, 0.6 + u * 0.4), 8));
  if (s.tail.saw) for (let i = 0; i < 8; i++) tpp.spike([0, tr[i] * 0.9, tpath[i][2]], [0, tr[i] * 0.9 + 0.045, tpath[i][2] - 0.025], 0.022, shade(s.skin, 0.55));
  tail.add(mesh(tpp));
  torso.add(tail);

  const legT = tort ? 0.12 : 0.07;
  return { root, legs, head, tail, torso, eyes, ears: [], hip, spec: specOf(spec, id, L, W, H, hip, legT, hl, true) };
}

// =====================================================================================================
// SNAKES
// =====================================================================================================

interface Snk {
  len: number; // nose to tail
  r: number; // the thickest the body gets
  ground: number; // share of the length that lies along the ground (the rest lifts into the neck)
  span: number; // how far along z the coiled part reaches (m)
  amp: number; // how far it swings to either side (m)
  waves: number;
  rise: number; // how high the head is held (m)
  fwd: number; // how far forward the neck leans on its way up (m)
  head: { l: number; w: number; h: number };
  base: number;
  belly: number;
  eye: number;
}

const SNK: Record<string, Snk> = {
  cobra: { len: 2.2, r: 0.07, ground: 0.6, span: 0.7, amp: 0.3, waves: 1.4, rise: 0.62, fwd: 0.18, head: { l: 0.15, w: 0.07, h: 0.048 }, base: 0x7a6a38, belly: 0xe2d49a, eye: 0x1c1208 },
  viper: { len: 1.15, r: 0.07, ground: 0.72, span: 0.42, amp: 0.17, waves: 1.8, rise: 0.17, fwd: 0.3, head: { l: 0.15, w: 0.1, h: 0.05 }, base: 0x8a7a54, belly: 0xe6dcb8, eye: 0xe8b82a },
  python: { len: 3.6, r: 0.15, ground: 0.76, span: 1.1, amp: 0.6, waves: 1.7, rise: 0.4, fwd: 0.5, head: { l: 0.25, w: 0.11, h: 0.085 }, base: 0x8a6a30, belly: 0xefe2b0, eye: 0xc89a2a },
};
export const SNAKE = new Set(Object.keys(SNK));

export function buildSnake(spec: QuadSpec, id: string): Built {
  const s = SNK[id];
  const cobra = id === 'cobra';
  const viper = id === 'viper';
  const python = id === 'python';
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  const L = s.len;

  // the spine: the rear lies in S-curves on the ground, then the neck lifts into an arc that ends heading forward
  const n = 130;
  const P: V3[] = [];
  const R: number[] = [];
  const nGround = Math.round(n * s.ground);
  const radiusAt = (u: number) => {
    const taper = Math.pow(Math.sin(Math.min(1, u / 0.42) * Math.PI / 2), 0.85); // a pointed tail that thickens
    const neck = 1 - (cobra ? 0.3 : 0.4) * sstep(u, s.ground, 0.97);
    return Math.max(0.008, s.r * taper * neck);
  };
  let zb = 0;
  let xb = 0;
  for (let i = 0; i < nGround; i++) {
    const g = i / (nGround - 1); // 0 tail tip .. 1 where the neck begins
    const u = g * s.ground;
    const env = (0.45 + 0.55 * g) * (1 - sstep(g, 0.8, 1));
    const x = Math.sin(g * Math.PI * 2 * s.waves) * s.amp * env;
    const zz = g * s.span;
    const r = radiusAt(u);
    P.push([x, r * 0.95, zz]);
    R.push(r);
    xb = x;
    zb = zz;
  }
  const nNeck = n - nGround;
  const yb = P[P.length - 1][1];
  for (let i = 1; i <= nNeck; i++) {
    const t = i / nNeck;
    const u = s.ground + t * (1 - s.ground);
    const r = radiusAt(u);
    P.push([xb * (1 - t), yb + s.rise * Math.sin(t * Math.PI / 2), zb + s.fwd * t * t]);
    R.push(r);
  }
  // centre the coil on the origin
  let cx = 0;
  let cz = 0;
  for (const p of P) {
    cx += p[0];
    cz += p[2];
  }
  cx /= P.length;
  cz /= P.length;
  for (const p of P) {
    p[0] -= cx;
    p[2] -= cz;
  }
  const dorsal = (u: number, a: number): number => {
    const d = Math.cos(a);
    // belly plates run across the underside; the back carries the pattern
    const underside = d < -0.35;
    if (underside) return flat(mix(s.belly, shade(s.base, 0.7), 0.15 + 0.1 * Math.sin(u * 160)), 0.95 + 0.1 * hash2(Math.floor(u * 160), 1));
    let c = skin(s.base, s.belly, a, u, 24, 220, 0.8, 0.2);
    if (cobra) {
      // dark rings and a band of pale across the hood area
      if (Math.sin(u * 62) > 0.78) c = mix(c, 0x2a2210, 0.6);
    } else if (viper) {
      // the dark zigzag down the back: bars that meet along the spine
      const zig = Math.abs(((u * 44) % 1) - 0.5) * 2;
      const dd = Math.abs(Math.sin(a));
      if (d > 0.15 && dd < 0.55 - zig * 0.3 + 0.2 && zig < 0.7) c = mix(c, 0x2c2214, 0.82);
      else if (d > -0.1 && d < 0.45 && Math.sin(u * 44 + 3) > 0.7) c = mix(c, 0xd9cfa8, 0.5);
    } else {
      // python: large, dark-edged blotches, joined into a network along the back
      const n1 = vnoise(u * 34, a * 2.5, 6);
      if (d > -0.15) {
        if (n1 > 0.6) c = mix(c, 0x3a2410, 0.78);
        else if (n1 > 0.52) c = mix(c, 0xd8b66a, 0.5);
      }
    }
    return c;
  };
  const bp = new Parts();
  bp.addGeo(tube(P, R, dorsal, 16));
  torso.add(mesh(bp));
  // lay the body on the ground: the torso's origin is the ground
  torso.position.y = 0;

  // ---- the head sits on the end of the spine ----
  const end = P[P.length - 1];
  const prev = P[P.length - 4];
  const head = new THREE.Group();
  head.position.set(end[0], end[1] + 0.01, end[2] + 0.005);
  void prev;
  const { l: hl, w: hw, h: hh } = s.head;
  const hs = (z2: number, a: number) => (Math.cos(a) < -0.4 ? s.belly : skin(shade(s.base, 0.92), s.belly, a, (z2 + hl) / (hl * 2), 16, 14, 0.76, 0.25));
  const hp = new Parts();
  // each head is its own shape: a cobra's a smooth blunt oval, a viper's a broad arrowhead on a thin neck, a python's a long wedge
  const rings: Ring[] = cobra
    ? [
        { z: -0.55 * hl, w: 0.75 * hw, top: 0.85 * hh, bot: 0.7 * hh },
        { z: -0.1 * hl, w: hw, top: hh, bot: 0.8 * hh },
        { z: 0.35 * hl, w: 0.85 * hw, top: 0.8 * hh, bot: 0.62 * hh },
        { z: 0.8 * hl, w: 0.5 * hw, top: 0.5 * hh, bot: 0.4 * hh },
        { z: hl, w: 0.28 * hw, top: 0.32 * hh, bot: 0.28 * hh },
      ]
    : viper
      ? [
          { z: -0.7 * hl, w: 0.5 * hw, top: 0.6 * hh, bot: 0.5 * hh },
          { z: -0.3 * hl, w: hw * 1.05, top: 0.95 * hh, bot: 0.65 * hh }, // the wide back of the skull and its venom glands
          { z: 0.2 * hl, w: 0.78 * hw, top: 0.82 * hh, bot: 0.58 * hh },
          { z: 0.72 * hl, w: 0.36 * hw, top: 0.55 * hh, bot: 0.38 * hh },
          { z: hl, w: 0.2 * hw, top: 0.4 * hh, bot: 0.3 * hh },
        ]
      : [
          { z: -0.6 * hl, w: 0.7 * hw, top: 0.8 * hh, bot: 0.7 * hh },
          { z: -0.15 * hl, w: hw, top: 0.95 * hh, bot: 0.78 * hh },
          { z: 0.4 * hl, w: 0.68 * hw, top: 0.74 * hh, bot: 0.6 * hh },
          { z: 0.8 * hl, w: 0.4 * hw, top: 0.55 * hh, bot: 0.44 * hh },
          { z: hl, w: 0.26 * hw, top: 0.4 * hh, bot: 0.34 * hh },
        ];
  hp.addGeo(loft(densify(rings, 18), hs, 16));
  // the mouth line, nostrils, and the forked tongue
  hp.seg([-0.35 * hw, -0.15 * hh, 0.1 * hl], [0, -0.2 * hh, hl * 0.98], 0.006, 0.006, 0x1c0f0f, 4);
  hp.seg([0.35 * hw, -0.15 * hh, 0.1 * hl], [0, -0.2 * hh, hl * 0.98], 0.006, 0.006, 0x1c0f0f, 4);
  for (const sx of [-1, 1]) hp.ball(0.012, 0.009, 0.012, 0x161410, sx * 0.14 * hw, 0.3 * hh, hl * 0.9, 0, 5, 4);
  if (cobra) {
    // the spread hood: broad, flattened, with pale underside and the spectacle mark on the back (here, the front of the hood)
    hp.ball(1.7 * hw + 0.03, 3.4 * hh + 0.07, 0.022, shade(s.base, 0.92), 0, -2.4 * hh - 0.06, -0.55 * hl, -0.1, 24, 16);
    hp.ball(1.15 * hw, 2.7 * hh, 0.014, s.belly, 0, -2.6 * hh - 0.04, -0.55 * hl + 0.016, -0.1, 20, 14);
    for (let i = 0; i < 4; i++) hp.ball(1.0 * hw, 0.05 * hh, 0.016, shade(s.base, 0.7), 0, (-1.7 - i * 0.85) * hh - 0.05, -0.55 * hl + 0.02, -0.1, 12, 4); // the bands across the throat
  } else if (viper) {
    // heavy brow scales over the eyes
    for (const sx of [-1, 1]) hp.ball(0.28 * hw, 0.18 * hh, 0.3 * hl, shade(s.base, 0.7), sx * 0.55 * hw, 0.62 * hh, 0.05 * hl, 0, 6, 5);
  } else {
    // a python's heat pits along the upper lip
    for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) hp.ball(0.008, 0.008, 0.008, 0x2a1a0a, sx * 0.5 * hw, -0.05 * hh, (0.25 + i * 0.16) * hl, 0, 4, 3);
  }
  // the long forked tongue, flicking
  hp.seg([0, -0.2 * hh, hl * 0.95], [0, -0.22 * hh, hl * 1.35], 0.005, 0.0035, 0xc8283a, 4);
  hp.seg([0, -0.22 * hh, hl * 1.35], [0.03, -0.22 * hh, hl * 1.6], 0.0035, 0.0015, 0xc8283a, 4);
  hp.seg([0, -0.22 * hh, hl * 1.35], [-0.03, -0.22 * hh, hl * 1.6], 0.0035, 0.0015, 0xc8283a, 4);
  head.add(mesh(hp));
  const eyes = [-1, 1].map((sx) => eye(head, sx * 0.76 * hw, 0.42 * hh, 0.22 * hl, hh * (python ? 0.36 : viper ? 0.4 : 0.42), s.eye, !cobra, shade(s.base, 0.5)));
  torso.add(head);

  const legs = [0, 1, 2, 3].map(() => new THREE.Group());
  for (const l of legs) root.add(l);
  const sp = specOf(spec, id, L * 0.5, s.r * 4, s.rise + s.r * 2, 0, 0.02, hl, false);
  sp.crawl = false;
  return { root, legs, head, tail: null, torso, eyes, ears: [], hip: 0, spec: sp };
}

export const REPTILE = new Set<string>([...LIZARD, ...TURTLE, ...SNAKE]);

export function buildReptile(spec: QuadSpec, id: string): Built {
  if (LIZARD.has(id)) return buildLizard(spec, id);
  if (TURTLE.has(id)) return buildTurtle(spec, id);
  return buildSnake(spec, id);
}
