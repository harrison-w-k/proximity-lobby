// The player birds: a feathered body with a raised chest, a neck and head with the right beak for the species, folded wings
// that spread for a glide, a fan of tail feathers and two scaly legs with talons. They drop into the same rig as the
// four-legged animals (two legs listed twice, so a walk is a hop), and the wings are driven by `wingPose`.
import * as THREE from 'three';
import { Parts, mix, shade } from './creatures';
import { loft, tube, vnoise, type Ring } from './realquad';
import type { Built, QuadSpec } from './models';

type V3 = [number, number, number];

type BeakKind = 'finch' | 'hook' | 'raptor' | 'straight' | 'heavy';
interface BirdLook {
  len: number; // body length (m)
  main: number; // back and head
  belly: number;
  wing: number;
  tailC?: number;
  beak: number;
  beakKind: BeakKind;
  cere?: number; // the yellow skin at the base of a raptor's beak
  eye: number;
  legC: number;
  neck: number; // neck length as a fraction of the body
  tail: number; // tail feather length (m)
  legLen: number;
  up: number; // how upright it stands (radians of body pitch)
  span: number; // wing length (m), shoulder to tip
  mark?: 'breast' | 'barred' | 'spots';
  markC?: number;
  headC?: number; // a differently coloured head (an eagle's white head, a falcon's dark hood)
  bare?: number; // a bare, coloured head and neck (a vulture)
  collar?: number; // a ruff of feathers round the neck
  disc?: number; // an owl's facial disc
  tufts?: boolean; // an owl's feather horns
  feathered?: boolean; // feathered legs
  swept?: boolean; // long pointed wings (a falcon's)
}

const LOOK: Record<string, BirdLook> = {
  robin: { len: 0.5, main: 0x6d5f55, belly: 0xefece4, wing: 0x5a4e46, beak: 0x3a3028, beakKind: 'finch', eye: 0x14100c, legC: 0x6a5648, neck: 0.16, tail: 0.24, legLen: 0.16, up: 0.5, span: 0.6, mark: 'breast', markC: 0xe2682c },
  hawk: { len: 0.95, main: 0x7a5a3a, belly: 0xe8dcc8, wing: 0x5a4028, tailC: 0x6a4a30, beak: 0x24241f, cere: 0xe0b030, beakKind: 'raptor', eye: 0xe0a020, legC: 0xe0b030, neck: 0.2, tail: 0.5, legLen: 0.3, up: 0.45, span: 1.3, mark: 'barred', markC: 0x6a4a30 },
  owl: { len: 0.85, main: 0x8a7a68, belly: 0xeee4d0, wing: 0x7a6a58, beak: 0x6a5a40, beakKind: 'hook', eye: 0xf0c020, legC: 0xc8b898, neck: 0.12, tail: 0.28, legLen: 0.25, up: 0.62, span: 1.15, mark: 'spots', markC: 0x5a4a38, disc: 0xe6dcc6, feathered: true },
  crow: { len: 0.8, main: 0x1a1a22, belly: 0x24242c, wing: 0x14141a, beak: 0x14141a, beakKind: 'straight', eye: 0x4a3a2a, legC: 0x14141a, neck: 0.28, tail: 0.45, legLen: 0.28, up: 0.4, span: 1.15 },
  eagle: { len: 1.4, main: 0x5a4030, belly: 0x6a4c36, wing: 0x4a3224, tailC: 0xf2efe6, headC: 0xf2efe6, beak: 0xe8b830, beakKind: 'raptor', eye: 0xd8a020, legC: 0xe0b830, neck: 0.3, tail: 0.7, legLen: 0.4, up: 0.5, span: 2.1, feathered: true },
  falcon: { len: 1.0, main: 0x5a6676, belly: 0xf0ead8, wing: 0x4a5666, beak: 0x30343a, cere: 0xe0b030, beakKind: 'raptor', eye: 0x14100c, legC: 0xe0b030, neck: 0.16, tail: 0.45, legLen: 0.26, up: 0.5, span: 1.3, mark: 'barred', markC: 0x3a4250, headC: 0x2a2e36, swept: true },
  great_horned_owl: { len: 1.15, main: 0x6a5238, belly: 0xd8c8a8, wing: 0x5a4430, beak: 0x2a2a28, beakKind: 'hook', eye: 0xf0c020, legC: 0xc8b898, neck: 0.12, tail: 0.35, legLen: 0.3, up: 0.6, span: 1.55, mark: 'barred', markC: 0x4a3a28, disc: 0xc8a878, tufts: true, feathered: true },
  snowy_owl: { len: 1.1, main: 0xf4f2ee, belly: 0xfaf8f4, wing: 0xf0eeea, beak: 0x2a2a28, beakKind: 'hook', eye: 0xf0c020, legC: 0xf0eee8, neck: 0.12, tail: 0.35, legLen: 0.3, up: 0.6, span: 1.5, mark: 'spots', markC: 0x3a3836, disc: 0xffffff, feathered: true },
  raven: { len: 1.0, main: 0x101014, belly: 0x16161c, wing: 0x0c0c10, beak: 0x0c0c10, beakKind: 'heavy', eye: 0x2a2220, legC: 0x0c0c10, neck: 0.3, tail: 0.55, legLen: 0.32, up: 0.4, span: 1.45, collar: 0x16161c },
  vulture: { len: 1.4, main: 0x3a3028, belly: 0x2a2420, wing: 0x2a241e, beak: 0xe8e0c8, beakKind: 'hook', eye: 0x3a2418, legC: 0xb8a898, neck: 0.5, tail: 0.5, legLen: 0.4, up: 0.35, span: 2.3, bare: 0xd88a78, collar: 0xe8e0d0 },
};
export const REAL_BIRD = new Set(Object.keys(LOOK));

/** The pivots a rig moves: both wings and, for the pose, the spread they are folded or opened to. */
export interface BirdParts {
  wings: [THREE.Group, THREE.Group];
  look: BirdLook;
  fold: number; // how much of its length a wing keeps when it is folded
}

const tmpC = new THREE.Color();

export function buildRealBird(id: string, paint?: [number, number] | null): Built & { bird: BirdParts } {
  const k: BirdLook = { ...LOOK[id] };
  if (paint && paint[0] >= 0) k.main = paint[0];
  if (paint && paint[1] >= 0) k.belly = paint[1];
  const L = k.len;
  const up = k.up;
  // the body is built level then pitched up: a point (y, z) moves with it
  const ca = Math.cos(-up);
  const sa = Math.sin(-up);
  const P = (y: number, z: number): [number, number] => [y * ca - z * sa, y * sa + z * ca];
  const pitch = new THREE.Matrix4().makeRotationX(-up);
  const hip = k.legLen;
  const root = new THREE.Group();
  const torso = new THREE.Group();
  const bodyH = L * 0.3;
  torso.position.y = hip + bodyH * 0.8;
  root.add(torso);

  // --- the body: a deep chest, a tapering rump ---
  const rings: Ring[] = [
    { z: -0.5 * L, w: 0.07 * L, top: 0.06 * L, bot: 0.05 * L, cy: 0.02 * L },
    { z: -0.34 * L, w: 0.18 * L, top: 0.15 * L, bot: 0.14 * L, cy: 0.01 * L },
    { z: -0.1 * L, w: 0.27 * L, top: 0.23 * L, bot: 0.25 * L, cy: 0 },
    { z: 0.12 * L, w: 0.29 * L, top: 0.25 * L, bot: 0.3 * L, cy: -0.01 * L },
    { z: 0.32 * L, w: 0.24 * L, top: 0.22 * L, bot: 0.27 * L, cy: 0 },
    { z: 0.46 * L, w: 0.15 * L, top: 0.15 * L, bot: 0.16 * L, cy: 0.03 * L },
  ];
  const bodyCol = (z: number, a: number, y: number, x: number): number => {
    const c = Math.cos(a);
    const t = THREE.MathUtils.smoothstep(-c, -0.15, 0.55); // 0 on the back, 1 on the belly
    tmpC.setHex(k.main);
    tmpC.lerp(new THREE.Color(k.belly), t);
    const n = vnoise(x * 22, y * 22, z * 18);
    if (k.mark === 'breast' && z > 0 && t > 0.1) tmpC.lerp(new THREE.Color(k.markC!), THREE.MathUtils.smoothstep(z / L, 0.0, 0.25) * 0.95 * (0.7 + 0.3 * t));
    if (k.mark === 'barred' && t > 0.2 && Math.sin((z / L) * 70 + n * 3) > 0.35) tmpC.lerp(new THREE.Color(k.markC!), 0.55);
    if (k.mark === 'spots' && n > 0.66 && c > -0.6) tmpC.lerp(new THREE.Color(k.markC!), 0.75);
    tmpC.multiplyScalar(0.9 + n * 0.2);
    return tmpC.getHex();
  };
  const tp = new Parts();
  const bodyGeo = loft(rings, bodyCol, 16);
  bodyGeo.applyMatrix4(pitch);
  tp.addGeo(bodyGeo);

  // the neck, from the chest up to the head
  const neckBase: V3 = [0, ...P(0.06 * L, 0.4 * L)] as V3;
  const headPos: V3 = [0, ...P(0.06 * L + k.neck * L * 1.0 + 0.12 * L, 0.46 * L + 0.05 * L)] as V3;
  const neckPath: V3[] = [];
  const neckR: number[] = [];
  for (let i = 0; i < 6; i++) {
    const u = i / 5;
    neckPath.push([0, neckBase[1] + (headPos[1] - neckBase[1]) * u, neckBase[2] + (headPos[2] - neckBase[2]) * u]);
    neckR.push((k.bare ? 0.075 : 0.135) * L * (1 - u * 0.25) * (k.neck < 0.2 ? 1.2 : 1));
  }
  const neckGeo = tube(neckPath, neckR, (u, a) => (k.bare && u > 0.25 ? k.bare : u > 0.55 ? (k.headC ?? k.main) : k.collar && u < 0.4 ? k.collar : Math.cos(a) < -0.2 ? (u < 0.5 ? mix(k.belly, k.main, u) : k.belly) : k.main), 10);
  tp.addGeo(neckGeo);
  if (k.collar && k.bare) {
    // a ruff of pale feathers round the base of the neck
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const b: V3 = [Math.sin(a) * 0.1 * L, neckBase[1] + 0.08 * L, neckBase[2] + Math.cos(a) * 0.06 * L];
      tp.spike(b, [b[0] * 1.5, b[1] - 0.06 * L, b[2] * 1.05], 0.025 * L, k.collar);
    }
  }
  torso.add(new THREE.Mesh(tp.merged(), new THREE.MeshBasicMaterial()));

  // --- the head ---
  const head = new THREE.Group();
  head.position.set(...headPos);
  const hs = L * 0.2; // head size
  const hp = new Parts();
  const headC = k.bare ?? k.headC ?? k.main;
  hp.ball(hs * 0.74, hs * 0.72, hs * 0.8, headC, 0, 0, 0, 0, 16, 12);
  if (k.collar && !k.bare) hp.ball(hs * 0.8, hs * 0.6, hs * 0.55, k.collar, 0, -hs * 0.35, -hs * 0.3, 0, 10, 8); // shaggy throat feathers
  if (k.disc) {
    // an owl's flat facial disc, with a darker rim and a pale brow
    for (const s of [-1, 1]) {
      hp.ball(hs * 0.62, hs * 0.66, hs * 0.18, k.disc, s * hs * 0.36, 0, hs * 0.62, 0, 12, 10);
      hp.ball(hs * 0.64, hs * 0.68, hs * 0.1, shade(k.disc, 0.7), s * hs * 0.36, 0, hs * 0.55, 0, 12, 10);
    }
    hp.ball(hs * 0.12, hs * 0.5, hs * 0.1, shade(k.disc, 0.95), 0, 0, hs * 0.72, 0, 6, 6);
  }
  const bz = hs * 0.78; // the front of the face
  const by = -hs * 0.02;
  const bc = k.beak;
  switch (k.beakKind) {
    case 'finch':
      hp.spike([0, by, bz - hs * 0.1], [0, by - hs * 0.04, bz + hs * 0.62], hs * 0.2, bc);
      break;
    case 'straight':
      hp.seg([0, by + hs * 0.02, bz - hs * 0.15], [0, by - hs * 0.02, bz + hs * 0.95], hs * 0.26, hs * 0.1, bc, 7);
      hp.seg([0, by - hs * 0.12, bz - hs * 0.1], [0, by - hs * 0.14, bz + hs * 0.75], hs * 0.18, hs * 0.07, shade(bc, 0.85), 6);
      break;
    case 'heavy':
      hp.seg([0, by + hs * 0.1, bz - hs * 0.2], [0, by - hs * 0.02, bz + hs * 1.05], hs * 0.34, hs * 0.1, bc, 8);
      hp.seg([0, by - hs * 0.15, bz - hs * 0.1], [0, by - hs * 0.18, bz + hs * 0.8], hs * 0.22, hs * 0.07, shade(bc, 0.85), 6);
      break;
    case 'hook':
      hp.seg([0, by, bz - hs * 0.1], [0, by - hs * 0.04, bz + hs * 0.55], hs * 0.24, hs * 0.1, bc, 7);
      hp.seg([0, by - hs * 0.04, bz + hs * 0.55], [0, by - hs * 0.4, bz + hs * 0.62], hs * 0.1, hs * 0.03, shade(bc, 0.8), 6);
      break;
    case 'raptor':
      if (k.cere) hp.ball(hs * 0.3, hs * 0.18, hs * 0.2, k.cere, 0, by + hs * 0.08, bz + hs * 0.08, 0, 8, 6);
      hp.seg([0, by, bz - hs * 0.05], [0, by - hs * 0.06, bz + hs * 0.6], hs * 0.3, hs * 0.14, bc, 8);
      hp.seg([0, by - hs * 0.06, bz + hs * 0.6], [0, by - hs * 0.52, bz + hs * 0.7], hs * 0.14, hs * 0.03, shade(bc, 0.75), 6); // the hook
      break;
  }
  // a feathered crest or the owl's horns
  if (k.tufts) {
    for (const s of [-1, 1]) hp.spike([s * hs * 0.45, hs * 0.55, hs * 0.1], [s * hs * 0.62, hs * 1.55, -hs * 0.05], hs * 0.2, shade(k.main, 0.8));
  }
  head.add(new THREE.Mesh(hp.merged(), new THREE.MeshBasicMaterial()));
  // eyes (a bright round eye; owls look straight ahead from the disc, raptors scowl under a brow)
  const eyes: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    const front = !!k.disc;
    eye.position.set(s * hs * (front ? 0.34 : 0.5), hs * 0.12, hs * (front ? 0.7 : 0.42));
    eye.rotation.y = s * (front ? 0.1 : 0.9);
    const ep = new Parts();
    const er = hs * (front ? 0.3 : k.beakKind === 'raptor' ? 0.2 : 0.17);
    ep.ball(er * 1.2, er * 1.2, er * 0.5, 0x120e0a, 0, 0, 0, 0, 10, 8);
    ep.ball(er, er, er * 0.6, k.eye, 0, 0, er * 0.12, 0, 12, 9);
    ep.ball(er * (front ? 0.55 : 0.5), er * (front ? 0.55 : 0.5), er * 0.4, 0x050505, 0, 0, er * 0.4, 0, 8, 6);
    ep.ball(er * 0.22, er * 0.22, er * 0.2, 0xffffff, -s * er * 0.25, er * 0.3, er * 0.6, 0, 5, 4);
    if (k.beakKind === 'raptor') ep.ball(er * 1.3, er * 0.35, er * 0.7, shade(headC, 0.55), 0, er * 0.85, er * 0.1, 0.3, 8, 6); // the brow ridge
    eye.add(new THREE.Mesh(ep.merged(), new THREE.MeshBasicMaterial()));
    head.add(eye);
    eyes.push(eye);
  }
  torso.add(head);

  // a frame pitched like the body, so the wings and tail sit along it
  const frame = new THREE.Group();
  frame.rotation.x = -up;
  torso.add(frame);

  // --- the tail: a fan of feathers ---
  const tail = new THREE.Group();
  tail.position.set(0, 0.01 * L, -0.46 * L);
  const tl = k.tail;
  const tc = k.tailC ?? k.main;
  const tailP = new Parts();
  // the feathers fan out behind the rump: a flat, scalloped shape, wider for the birds that glide and hunt
  const half = L * (k.beakKind === 'raptor' || k.beakKind === 'hook' ? 0.17 : k.beakKind === 'finch' ? 0.1 : 0.13);
  const fanPts: [number, number][] = [[0.02 * L, half * 0.25], [-tl * 0.5, half * 0.7]];
  for (let i = 0; i <= 6; i++) {
    const v = half * (1 - (i / 6) * 2);
    fanPts.push([-tl * (1 - 0.1 * Math.abs(Math.sin(i * 1.7))), v]);
  }
  fanPts.push([-tl * 0.5, -half * 0.7], [0.02 * L, -half * 0.25]);
  tailP.fin(fanPts, 'zx', 0, tc);
  tailP.fin(fanPts.map(([u, v]) => [u * 0.98, v * 0.6] as [number, number]), 'zx', 0.004, shade(tc, 0.8)); // a darker centre
  if (k.mark === 'barred') for (let i = 1; i <= 3; i++) tailP.fin([[-tl * (0.2 + i * 0.2), half * (0.9 - i * 0.1)], [-tl * (0.26 + i * 0.2), half * (0.9 - i * 0.1)], [-tl * (0.26 + i * 0.2), -half * (0.9 - i * 0.1)], [-tl * (0.2 + i * 0.2), -half * (0.9 - i * 0.1)]], 'zx', 0.006, k.markC ?? tc);
  tail.add(new THREE.Mesh(tailP.merged(), new THREE.MeshBasicMaterial()));
  frame.add(tail);

  // --- the wings: pivots at the shoulders, folded along the flank until they are spread ---
  const wings: THREE.Group[] = [];
  const fold = Math.min(1, (L * 0.6) / k.span);
  for (const s of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(s * 0.24 * L, 0.17 * L, 0.2 * L);
    const wp = new Parts();
    const S = k.span;
    const chord = Math.min(S * 0.5, L * 0.36);
    const tipSweep = k.swept ? 0.5 : 0.18;
    // the wing as a flat feathered shape, running out along x; the leading edge is its front
    const pts: [number, number][] = [
      [chord * 0.45, 0], [chord * 0.5, s * S * 0.4], [chord * 0.28, s * S * 0.82], [-chord * tipSweep, s * S * 1.0],
      [-chord * (tipSweep + 0.2), s * S * 0.9], [-chord * 0.55, s * S * 0.74], [-chord * 0.78, s * S * 0.56],
      [-chord * 0.86, s * S * 0.38], [-chord * 0.8, s * S * 0.2], [-chord * 0.55, 0],
    ];
    wp.fin(pts, 'zx', 0, k.wing);
    // a covert band of lighter feathers on the inner wing, and the rounded shoulder
    wp.fin([[chord * 0.4, 0], [chord * 0.4, s * S * 0.45], [-chord * 0.1, s * S * 0.5], [-chord * 0.12, 0]], 'zx', 0.004, mix(k.wing, k.belly, 0.2));
    wp.ball(0.07 * L, 0.08 * L, 0.14 * L, shade(k.main, 1.0), 0, 0, 0, 0, 8, 6);
    w.add(new THREE.Mesh(wp.merged(), new THREE.MeshBasicMaterial()));
    w.rotation.order = 'ZYX';
    frame.add(w);
    wings.push(w);
  }

  // --- the legs: a feathered thigh, a thin shank and a foot with talons ---
  const legs: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(s * 0.11 * L, hip, 0);
    const lp = new Parts();
    const lc = k.legC;
    const r = Math.max(0.014, L * 0.034);
    if (k.feathered) lp.ball(r * 2.3, hip * 0.42, r * 2.3, k.belly, 0, -hip * 0.3, 0, 0, 8, 6); // feathered "trousers"
    else lp.ball(r * 1.6, r * 2.2, r * 1.8, k.main, 0, -0.005, 0, 0, 8, 6);
    lp.seg([0, 0, 0], [0, -hip * 0.55, 0.02 * L], r * 1.2, r * 0.9, lc, 6);
    lp.seg([0, -hip * 0.55, 0.02 * L], [0, -hip + 0.012, 0.0], r * 0.9, r * 0.8, lc, 6);
    // four toes: three forward, one back, each ending in a dark talon
    const toeLen = Math.max(0.06, L * 0.1);
    const fy = -hip + 0.01;
    for (const a of [-0.45, 0, 0.45]) {
      const tip: V3 = [Math.sin(a) * toeLen, fy - 0.002, Math.cos(a) * toeLen];
      lp.seg([0, fy, 0], tip, r * 0.75, r * 0.5, lc, 5);
      lp.spike([tip[0], tip[1], tip[2]], [tip[0] * 1.1, fy - r * 1.8, tip[2] + toeLen * 0.28], r * 0.55, k.beakKind === 'raptor' || k.beakKind === 'hook' ? 0x1a1814 : shade(lc, 0.6));
    }
    lp.seg([0, fy, 0], [0, fy - 0.002, -toeLen * 0.7], r * 0.7, r * 0.45, lc, 5);
    g.add(new THREE.Mesh(lp.merged(), new THREE.MeshBasicMaterial()));
    root.add(g);
    legs.push(g);
  }

  const fake: QuadSpec = { len: L, w: L * 0.5, h: L * 0.6, legLen: hip, legT: 0.03, fur: k.main, head: { s: hs * 1.4, snout: 0.05 }, id, scale: 1 };
  const ears: Built['ears'] = [];
  // (the legs are listed in pairs: the rig swings the first two and the last two in opposite directions, so it hops)
  return { root, legs: [legs[0], legs[0], legs[1], legs[1]], head, tail, torso, eyes, ears, hip, spec: fake, bird: { wings: wings as [THREE.Group, THREE.Group], look: k, fold } };
}

/** Fold the wings (spread = 0) or open them out flat (spread = 1); `flap` beats them. */
export function wingPose(b: BirdParts, spread: number, flap = 0) {
  const sw = b.look.swept ? 0.1 : 0;
  b.wings.forEach((w, i) => {
    const s = i === 0 ? -1 : 1; // wings[0] is the left one (x < 0)
    // folded: swept back along the flank and hanging; spread: out flat, a little raised
    w.scale.x = b.fold + (1 - b.fold) * spread;
    w.rotation.y = s * (1 - spread) * (Math.PI / 2 - 0.12);
    w.rotation.z = s * (spread * (0.12 + sw) + flap) + s * (1 - spread) * 1.45;
  });
}
