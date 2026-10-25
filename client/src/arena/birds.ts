// The player birds, each drawn from its own measurements. A teardrop body tilted to the bird's usual stance, a neck that
// bends the way that species carries it, a head with the right beak (a robin's fine needle, a crow's stout spear, a
// hawk's hook, an owl's flat face, a vulture's bare skin), folded wings that lie along the flank with their tips crossed
// over the tail, a tail fan cut to the right shape, and legs that are bare, or feathered to the toes. They drop into the
// same rig as the four-legged animals (two legs listed twice, so a walk is a hop), and the wings are driven by `wingPose`.
import * as THREE from 'three';
import { Parts, mix, shade } from './creatures';
import { loft, tube, vnoise, type Ring } from './realquad';
import type { Built, QuadSpec } from './models';

type V3 = [number, number, number];

type BeakKind = 'finch' | 'hook' | 'raptor' | 'straight' | 'heavy' | 'vulture';
type TailShape = 'wedge' | 'square' | 'fork' | 'round' | 'long';
type WingShape = 'round' | 'point' | 'finger' | 'broad';

interface BirdLook {
  len: number; // overall length, beak to tail (units)
  main: number; // back
  belly: number;
  wing: number;
  tailC?: number;
  beak: number;
  beakKind: BeakKind;
  cere?: number; // the yellow skin at the base of a raptor's beak
  eye: number;
  legC: number;
  // shape
  pitch: number; // how upright the body stands (radians)
  body: [number, number, number]; // body length, depth and width, as fractions of `len`
  breast: number; // how full the chest is (1 = plain, above 1 = a pouter)
  neck: [number, number, number]; // length (fraction of len), thickness (fraction of len), lean (0 straight up, 1 forward)
  head: number; // head size, a fraction of len
  tail: number; // tail length, fraction of len
  tailShape: TailShape;
  wingShape: WingShape;
  span: number; // wing length, shoulder to tip (units)
  legLen: number; // units
  // looks
  mark?: 'breast' | 'barred' | 'spots' | 'streaks';
  markC?: number;
  headC?: number; // a differently coloured head (an eagle's white head, a falcon's dark hood)
  bare?: number; // a bare, coloured head and neck (a vulture)
  collar?: number; // a ruff of feathers round the neck
  disc?: number; // an owl's facial disc
  tufts?: boolean; // an owl's feather horns
  feathered?: boolean; // feathered legs
  swept?: boolean; // long pointed wings (a falcon's)
  moustache?: number; // a dark stripe under the eye
  brow?: boolean;
}

const LOOK: Record<string, BirdLook> = {
  // a plump little songbird: round body, thin bill, long thin legs, an orange breast
  robin: { len: 0.5, main: 0x6d5f55, belly: 0xefece4, wing: 0x5a4e46, beak: 0x3a3028, beakKind: 'finch', eye: 0x14100c, legC: 0x7a5a48, pitch: 0.45, body: [0.46, 0.34, 0.3], breast: 1.25, neck: [0.04, 0.17, 0.6], head: 0.2, tail: 0.34, tailShape: 'fork', wingShape: 'round', span: 0.58, legLen: 0.17, mark: 'breast', markC: 0xe2682c },
  // a broad-winged hunter: heavy chest, big brow, a short wide tail, yellow legs
  hawk: { len: 0.95, main: 0x7a5a3a, belly: 0xe8dcc8, wing: 0x5a4028, tailC: 0xa4552a, beak: 0x24241f, cere: 0xe0b030, beakKind: 'raptor', eye: 0xe0a020, legC: 0xe0b030, pitch: 0.45, body: [0.42, 0.34, 0.3], breast: 1.1, neck: [0.07, 0.17, 0.5], head: 0.15, tail: 0.3, tailShape: 'round', wingShape: 'broad', span: 1.35, legLen: 0.27, mark: 'streaks', markC: 0x6a4a30, brow: true },
  // a barn owl: a heart-shaped white face on a slim, upright, long-legged body
  owl: { len: 0.85, main: 0xc8a878, belly: 0xf4ecdc, wing: 0xb89a6a, beak: 0xd8cdb0, beakKind: 'hook', eye: 0x120e0a, legC: 0xe2d4b4, pitch: 0.8, body: [0.42, 0.3, 0.26], breast: 1.0, neck: [0.0, 0.2, 0.0], head: 0.25, tail: 0.2, tailShape: 'square', wingShape: 'round', span: 1.15, legLen: 0.27, mark: 'spots', markC: 0x8a7050, disc: 0xfaf4e6, feathered: true },
  // a crow: lean, glossy, a stout straight bill and a long wedge tail
  crow: { len: 0.8, main: 0x1a1a22, belly: 0x24242c, wing: 0x14141a, beak: 0x14141a, beakKind: 'straight', eye: 0x4a3a2a, legC: 0x14141a, pitch: 0.2, body: [0.42, 0.26, 0.2], breast: 1.0, neck: [0.1, 0.12, 0.7], head: 0.15, tail: 0.34, tailShape: 'wedge', wingShape: 'finger', span: 1.1, legLen: 0.24 },
  // an eagle: huge, the white head, a yellow hooked bill, feathered thighs, great fingered wings
  eagle: { len: 1.4, main: 0x5a4030, belly: 0x6a4c36, wing: 0x4a3224, tailC: 0xf2efe6, headC: 0xf2efe6, beak: 0xe8b830, beakKind: 'raptor', eye: 0xe8c040, legC: 0xe0b830, pitch: 0.5, body: [0.42, 0.34, 0.3], breast: 1.1, neck: [0.1, 0.15, 0.55], head: 0.14, tail: 0.3, tailShape: 'wedge', wingShape: 'finger', span: 2.1, legLen: 0.32, feathered: true, brow: true },
  // a falcon: compact and fast, slate hood, dark moustache, wings tipped far past the rump
  falcon: { len: 1.0, main: 0x5a6676, belly: 0xf0ead8, wing: 0x4a5666, beak: 0x30343a, cere: 0xe0b030, beakKind: 'raptor', eye: 0x14100c, legC: 0xe0b030, pitch: 0.4, body: [0.46, 0.28, 0.24], breast: 1.1, neck: [0.04, 0.16, 0.4], head: 0.15, tail: 0.38, tailShape: 'long', wingShape: 'point', span: 1.35, legLen: 0.2, mark: 'barred', markC: 0x3a4250, headC: 0x2a2e36, swept: true, moustache: 0x1a1c22 },
  // a great horned owl: a barrel with horns, a huge round face, short stocky legs
  great_horned_owl: { len: 1.15, main: 0x6a5238, belly: 0xd8c8a8, wing: 0x5a4430, beak: 0x2a2a28, beakKind: 'hook', eye: 0xf0c020, legC: 0xc8b898, pitch: 0.7, body: [0.4, 0.38, 0.36], breast: 1.1, neck: [0.0, 0.26, 0.0], head: 0.27, tail: 0.24, tailShape: 'square', wingShape: 'broad', span: 1.6, legLen: 0.22, mark: 'barred', markC: 0x4a3a28, disc: 0xc8a878, tufts: true, feathered: true },
  // a snowy owl: white, round, fluffy, no horns
  snowy_owl: { len: 1.1, main: 0xf4f2ee, belly: 0xfaf8f4, wing: 0xf0eeea, beak: 0x2a2a28, beakKind: 'hook', eye: 0xf0c020, legC: 0xf0eee8, pitch: 0.6, body: [0.4, 0.38, 0.36], breast: 1.2, neck: [0.0, 0.26, 0.0], head: 0.22, tail: 0.22, tailShape: 'round', wingShape: 'broad', span: 1.5, legLen: 0.2, mark: 'barred', markC: 0x4a4846, disc: 0xffffff, feathered: true },
  // a raven: a bigger, shaggier crow with a great arched bill and a diamond tail
  raven: { len: 1.0, main: 0x101014, belly: 0x16161c, wing: 0x0c0c10, beak: 0x0c0c10, beakKind: 'heavy', eye: 0x2a2220, legC: 0x0c0c10, pitch: 0.22, body: [0.4, 0.28, 0.24], breast: 1.08, neck: [0.12, 0.14, 0.65], head: 0.16, tail: 0.34, tailShape: 'wedge', wingShape: 'finger', span: 1.5, legLen: 0.26, collar: 0x1e1e26 },
  // a vulture: hunched, bare pink head on a long thin neck, a white ruff, huge dark wings
  vulture: { len: 1.4, main: 0x3a3028, belly: 0x2a2420, wing: 0x2a241e, beak: 0xe8e0c8, beakKind: 'vulture', eye: 0x3a2418, legC: 0xb8a898, pitch: 0.4, body: [0.38, 0.34, 0.32], breast: 1.05, neck: [0.24, 0.07, 0.35], head: 0.1, tail: 0.24, tailShape: 'square', wingShape: 'finger', span: 2.3, legLen: 0.3, bare: 0xd88a78, collar: 0xe8e0d0 },
};
export const REAL_BIRD = new Set(Object.keys(LOOK));

/** The pivots a rig moves: both wings and, for the pose, the spread they are folded or opened to. */
export interface BirdParts {
  wings: [THREE.Group, THREE.Group];
  look: BirdLook;
  fold: number; // how much of its length a wing keeps when it is folded
}

const tmpC = new THREE.Color();
const tmpD = new THREE.Color();

/** A wing seen from above, as [along the chord, along the span] points: the leading edge out to the tip, then back along the feathers. */
function wingOutline(S: number, C: number, shape: WingShape): [number, number][] {
  const pts: [number, number][] = [];
  const tipBack = shape === 'point' ? 0.55 : shape === 'round' ? 0.1 : shape === 'broad' ? 0.18 : 0.28;
  const tipSpan = shape === 'round' ? 0.94 : 1;
  // leading edge: from the shoulder, forward of the wrist, then out and back to the tip
  pts.push([0.35 * C, 0], [0.5 * C, 0.14 * S], [0.46 * C, 0.4 * S], [0.34 * C, 0.66 * S], [0.12 * C, 0.88 * S], [-tipBack * C, tipSpan * S]);
  // the trailing edge: the long primaries, then the shorter secondaries, scalloped
  const nPrim = shape === 'finger' ? 6 : shape === 'point' ? 3 : 4;
  for (let i = 1; i <= nPrim; i++) {
    const t = i / (nPrim + 1);
    const x = tipSpan * S * (1 - t * 0.4);
    const back = shape === 'point' ? tipBack * C + t * C * 0.55 : tipBack * C + t * C * (shape === 'round' ? 0.9 : 0.7);
    pts.push([-(back + (i % 2 ? 0 : 0.05 * C)), x - 0.01 * S]);
    if (shape === 'finger') pts.push([-(back - 0.07 * C), x - 0.045 * S]); // the gap between the fingered feathers
  }
  const sec = 6;
  for (let i = 0; i <= sec; i++) {
    const x = 0.55 * S * (1 - i / sec);
    const back = shape === 'round' ? 0.62 * C : 0.55 * C;
    pts.push([-(back + (i % 2 ? 0 : 0.06 * C)), x]);
  }
  pts.push([-0.35 * C, 0]);
  return pts;
}

export function buildRealBird(id: string): Built & { bird: BirdParts } {
  const k: BirdLook = { ...LOOK[id] };
  const L = k.len;
  const up = k.pitch;
  const [bl, bd, bw] = [k.body[0] * L, k.body[1] * L, k.body[2] * L];
  const hip = k.legLen;
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = hip + bd * 0.28;
  root.add(torso);
  // everything else sits in a frame tilted to the bird's stance
  const frame = new THREE.Group();
  frame.rotation.x = -up;
  torso.add(frame);
  const toF = (wy: number, wz: number): [number, number] => [wy * Math.cos(up) - wz * Math.sin(up), wy * Math.sin(up) + wz * Math.cos(up)]; // a direction in the world, in frame coordinates

  // --- the body: a deep full chest tapering back to a narrow rump ---
  const Bh = bd / 2;
  const Bw = bw / 2;
  const br = k.breast;
  const rings: Ring[] = [
    { z: -0.5 * bl, w: 0.05 * Bw, top: 0.07 * Bh, bot: 0.05 * Bh, cy: 0.1 * Bh },
    { z: -0.38 * bl, w: 0.38 * Bw, top: 0.4 * Bh, bot: 0.34 * Bh, cy: 0.12 * Bh },
    { z: -0.16 * bl, w: 0.78 * Bw, top: 0.82 * Bh, bot: 0.78 * Bh, cy: 0.04 * Bh },
    { z: 0.08 * bl, w: 1.0 * Bw, top: 0.98 * Bh, bot: 1.0 * Bh * br, cy: -0.02 * Bh },
    { z: 0.28 * bl, w: 0.94 * Bw * (0.9 + 0.1 * br), top: 0.9 * Bh, bot: 1.02 * Bh * br, cy: -0.06 * Bh },
    { z: 0.45 * bl, w: 0.66 * Bw, top: 0.62 * Bh, bot: 0.72 * Bh * br, cy: -0.03 * Bh },
    { z: 0.52 * bl, w: 0.4 * Bw, top: 0.4 * Bh, bot: 0.42 * Bh, cy: 0.02 * Bh },
  ];
  const lastZ = -0.5 * bl;
  const bodyCol = (z: number, a: number, y: number, x: number): number => {
    const c = Math.cos(a);
    const t = THREE.MathUtils.smoothstep(-c, -0.15, 0.55); // 0 on the back, 1 on the belly
    tmpC.setHex(k.main);
    tmpC.lerp(tmpD.setHex(k.belly), t);
    const n = vnoise(x * 24, y * 24, z * 20);
    const f = z / bl; // 0.5 is the chest
    if (k.mark === 'breast' && f > 0.0 && t > 0.1) tmpC.lerp(tmpD.setHex(k.markC!), THREE.MathUtils.smoothstep(f, 0.0, 0.25) * 0.95 * (0.7 + 0.3 * t));
    if (k.mark === 'barred' && t > 0.2 && Math.sin(f * 60 + n * 3) > 0.3) tmpC.lerp(tmpD.setHex(k.markC!), 0.55);
    if (k.mark === 'spots' && n > 0.62 && c > -0.7) tmpC.lerp(tmpD.setHex(k.markC!), 0.7);
    if (k.mark === 'streaks' && t > 0.15 && n > 0.55 && Math.sin(f * 20 + x * 40) > 0.1) tmpC.lerp(tmpD.setHex(k.markC!), 0.6);
    // rows of feathers: a subtle scalloped shading
    tmpC.multiplyScalar(0.92 + n * 0.16 + (Math.sin(f * 90 + a * 5) > 0.7 ? -0.05 : 0));
    return tmpC.getHex();
  };
  const tp = new Parts();
  tp.addGeo(loft(rings, bodyCol, 18));

  // --- the neck: from the front of the chest, rising and leaning the way this bird carries it ---
  const nl = k.neck[0] * L;
  const nr = k.neck[1] * L * 0.5;
  const lean = k.neck[2];
  const dir = toF(1, lean); // up, and forward by `lean`
  const nBase: V3 = [0, 0.4 * Bh, 0.34 * bl];
  const nLen = Math.max(nl, 0.02) + 0.02 * L;
  const dl = Math.hypot(dir[0], dir[1]);
  const nTip: V3 = [0, nBase[1] + (dir[0] / dl) * nLen, nBase[2] + (dir[1] / dl) * nLen];
  const npath: V3[] = [];
  const nrad: number[] = [];
  for (let i = 0; i < 6; i++) {
    const u = i / 5;
    const s = Math.sin(u * Math.PI) * (k.neck[0] > 0.1 ? 0.03 * L : 0); // a gentle S in a long neck
    npath.push([0, nBase[1] + (nTip[1] - nBase[1]) * u + s * 0.4, nBase[2] + (nTip[2] - nBase[2]) * u + s]);
    nrad.push(nr * (1.3 - 0.4 * u));
  }
  tp.addGeo(
    tube(
      npath,
      nrad,
      (u, a) => (k.bare && u > 0.2 ? k.bare : u > 0.6 ? (k.headC ?? k.main) : k.collar && u < 0.35 && !k.bare ? k.collar : Math.cos(a) < -0.2 ? (u < 0.5 ? mix(k.belly, k.main, u) : k.belly) : k.main),
      10,
    ),
  );
  if (k.collar && k.bare) {
    // a ruff of pale feathers round the base of the neck
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const b: V3 = [Math.sin(a) * 0.1 * L, nBase[1] + 0.02 * L, nBase[2] + Math.cos(a) * 0.05 * L];
      tp.spike(b, [b[0] * 1.6, b[1] - 0.07 * L, b[2] * 1.05 - 0.03 * L], 0.03 * L, k.collar);
    }
  } else if (k.collar) {
    // shaggy throat hackles
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI - Math.PI / 2;
      const b: V3 = [Math.sin(a) * 0.05 * L, nBase[1] + 0.08 * L, nBase[2] + 0.1 * L];
      tp.spike(b, [b[0] * 1.2, b[1] - 0.09 * L, b[2] + 0.02 * L], 0.018 * L, k.collar);
    }
  }
  frame.add(new THREE.Mesh(tp.merged(), new THREE.MeshBasicMaterial()));

  // --- the head ---
  const head = new THREE.Group();
  const hs = L * k.head;
  // the head rides on a mount that cancels the body's tilt, so the face looks ahead even on an upright bird
  const mount = new THREE.Group();
  mount.position.set(0, nTip[1] + hs * 0.18, nTip[2] + hs * 0.12);
  mount.rotation.x = up * 0.92;
  mount.add(head);
  const hp = new Parts();
  const headC = k.bare ?? k.headC ?? k.main;
  hp.ball(hs * 0.8, hs * 0.76, hs * 0.85, headC, 0, 0, 0, 0, 18, 14);
  if (k.bare) hp.ball(hs * 0.42, hs * 0.36, hs * 0.5, mix(k.bare, 0xffffff, 0.25), 0, hs * 0.1, hs * 0.35, 0, 8, 6); // the wrinkled crown and brow
  if (k.collar && !k.bare) hp.ball(hs * 0.78, hs * 0.5, hs * 0.5, k.collar, 0, -hs * 0.45, -hs * 0.15, 0, 10, 8); // shaggy throat feathers
  if (k.disc) {
    // the owl's flat facial disc, with a dark rim and a pale brow ridge
    for (const s of [-1, 1]) {
      hp.ball(hs * 0.7, hs * 0.74, hs * 0.14, shade(k.disc, 0.8), s * hs * 0.42, 0, hs * 0.5, 0, 14, 10);
      hp.ball(hs * 0.64, hs * 0.68, hs * 0.1, k.disc, s * hs * 0.42, 0, hs * 0.56, 0, 14, 10);
    }
    hp.ball(hs * 0.14, hs * 0.55, hs * 0.1, shade(k.disc, 0.9), 0, 0, hs * 0.82, 0, 6, 6);
  }
  if (k.moustache) for (const s of [-1, 1]) hp.seg([s * hs * 0.5, -hs * 0.04, hs * 0.55], [s * hs * 0.46, -hs * 0.62, hs * 0.5], hs * 0.14, hs * 0.09, k.moustache, 6);
  const bz = hs * (k.disc ? 0.88 : 0.76); // the front of the face
  const by = -hs * 0.04;
  const bc = k.beak;
  const bs = hs;
  switch (k.beakKind) {
    case 'finch': // a fine, short needle
      hp.seg([0, by + bs * 0.02, bz - bs * 0.15], [0, by - bs * 0.02, bz + bs * 0.62], bs * 0.17, bs * 0.03, bc, 7);
      hp.seg([0, by - bs * 0.1, bz - bs * 0.1], [0, by - bs * 0.1, bz + bs * 0.5], bs * 0.1, bs * 0.025, shade(bc, 0.9), 6);
      break;
    case 'straight': // a crow's stout spear
      hp.seg([0, by + bs * 0.04, bz - bs * 0.2], [0, by - bs * 0.02, bz + bs * 1.05], bs * 0.28, bs * 0.05, bc, 8);
      hp.seg([0, by - bs * 0.14, bz - bs * 0.1], [0, by - bs * 0.14, bz + bs * 0.85], bs * 0.17, bs * 0.04, shade(bc, 0.85), 6);
      break;
    case 'heavy': // a raven's thick, arched bill with bristles over the nostrils
      hp.seg([0, by + bs * 0.12, bz - bs * 0.2], [0, by + bs * 0.02, bz + bs * 1.2], bs * 0.4, bs * 0.06, bc, 8);
      hp.seg([0, by - bs * 0.18, bz - bs * 0.1], [0, by - bs * 0.2, bz + bs * 0.95], bs * 0.24, bs * 0.05, shade(bc, 0.85), 6);
      hp.seg([0, by + bs * 0.1, bz + bs * 0.05], [0, by + bs * 0.05, bz + bs * 0.5], bs * 0.14, bs * 0.05, 0x2a2a30, 5);
      break;
    case 'hook': // an owl's short hooked beak, half hidden in the face
      hp.seg([0, by, bz - bs * 0.12], [0, by - bs * 0.06, bz + bs * 0.4], bs * 0.2, bs * 0.08, bc, 7);
      hp.seg([0, by - bs * 0.06, bz + bs * 0.4], [0, by - bs * 0.34, bz + bs * 0.42], bs * 0.08, bs * 0.025, shade(bc, 0.8), 6);
      break;
    case 'raptor': // a hawk's strong hooked bill on its yellow cere
      if (k.cere) hp.ball(bs * 0.32, bs * 0.2, bs * 0.22, k.cere, 0, by + bs * 0.08, bz + bs * 0.04, 0, 8, 6);
      hp.seg([0, by + bs * 0.02, bz - bs * 0.05], [0, by - bs * 0.02, bz + bs * 0.55], bs * 0.3, bs * 0.12, bc, 8);
      hp.seg([0, by - bs * 0.02, bz + bs * 0.55], [0, by - bs * 0.55, bz + bs * 0.62], bs * 0.13, bs * 0.025, shade(bc, 0.75), 6);
      break;
    case 'vulture': // long and hooked
      hp.seg([0, by + bs * 0.06, bz - bs * 0.1], [0, by + bs * 0.02, bz + bs * 0.85], bs * 0.24, bs * 0.08, bc, 8);
      hp.seg([0, by + bs * 0.02, bz + bs * 0.85], [0, by - bs * 0.5, bz + bs * 0.95], bs * 0.09, bs * 0.02, shade(bc, 0.8), 6);
      hp.ball(bs * 0.18, bs * 0.1, bs * 0.18, 0x2a2420, 0, by + bs * 0.1, bz + bs * 0.35, 0, 6, 5);
      break;
  }
  if (k.tufts) for (const s of [-1, 1]) hp.spike([s * hs * 0.5, hs * 0.55, hs * 0.05], [s * hs * 0.75, hs * 1.7, -hs * 0.2], hs * 0.22, shade(k.main, 0.75));
  head.add(new THREE.Mesh(hp.merged(), new THREE.MeshBasicMaterial()));
  // eyes: bright and round (owls stare out of the disc, raptors scowl under a brow)
  const eyes: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    const front = !!k.disc;
    eye.position.set(s * hs * (front ? 0.38 : 0.55), hs * 0.14, hs * (front ? 0.7 : 0.44));
    eye.rotation.y = s * (front ? 0.12 : 0.95);
    const ep = new Parts();
    const er = hs * (front ? 0.3 : k.beakKind === 'raptor' ? 0.2 : k.beakKind === 'finch' ? 0.21 : 0.17);
    ep.ball(er * 1.2, er * 1.2, er * 0.5, 0x120e0a, 0, 0, 0, 0, 10, 8);
    ep.ball(er, er, er * 0.6, k.eye, 0, 0, er * 0.12, 0, 12, 9);
    ep.ball(er * (front ? 0.62 : 0.5), er * (front ? 0.62 : 0.5), er * 0.4, 0x050505, 0, 0, er * 0.4, 0, 8, 6);
    ep.ball(er * 0.22, er * 0.22, er * 0.2, 0xffffff, -s * er * 0.25, er * 0.3, er * 0.6, 0, 5, 4);
    if (k.brow || k.beakKind === 'raptor') ep.ball(er * 1.5, er * 0.4, er * 0.8, shade(headC, 0.55), 0, er * 0.9, er * 0.05, 0.3, 8, 6); // the heavy brow
    eye.add(new THREE.Mesh(ep.merged(), new THREE.MeshBasicMaterial()));
    head.add(eye);
    eyes.push(eye);
  }
  frame.add(mount);

  // --- the tail: a fan of feathers, cut to the species' shape and dropped a little behind the rump ---
  const tail = new THREE.Group();
  tail.position.set(0, 0.0, lastZ + 0.02 * L);
  const tl = k.tail * L;
  const tc = k.tailC ?? k.main;
  const tailP = new Parts();
  const half = L * (k.tailShape === 'wedge' ? 0.07 : k.tailShape === 'fork' ? 0.06 : k.tailShape === 'long' ? 0.06 : 0.1) * (k.bare ? 1.4 : 1);
  const shapeAt = (v: number) => {
    // how far back the feather at lateral position v (-1..1) reaches, as a fraction of the tail length
    const a = Math.abs(v);
    switch (k.tailShape) {
      case 'wedge': return 1 - a * 0.45;
      case 'fork': return 0.8 + a * 0.2;
      case 'round': return 1 - a * a * 0.3;
      case 'long': return 1 - a * 0.12;
      default: return 1 - a * 0.04;
    }
  };
  const fan: [number, number][] = [[0.03 * L, half * 0.3], [-tl * 0.45, half * 0.8]];
  const nF = 7;
  for (let i = 0; i <= nF; i++) {
    const v = 1 - (i / nF) * 2;
    fan.push([-tl * shapeAt(v) * (1 - (i % 2 ? 0.04 : 0)), v * half]);
  }
  fan.push([-tl * 0.45, -half * 0.8], [0.03 * L, -half * 0.3]);
  tailP.fin(fan, 'zx', 0, tc);
  tailP.fin(fan.map(([u, v]) => [u * 0.96, v * 0.55] as [number, number]), 'zx', 0.004, shade(tc, 0.82)); // a darker centre
  if (k.mark === 'barred' || id === 'hawk') for (let i = 1; i <= 3; i++) tailP.fin([[-tl * (0.18 + i * 0.2), half * 0.9], [-tl * (0.24 + i * 0.2), half * 0.9], [-tl * (0.24 + i * 0.2), -half * 0.9], [-tl * (0.18 + i * 0.2), -half * 0.9]], 'zx', 0.006, k.markC ?? shade(tc, 0.6));
  tail.add(new THREE.Mesh(tailP.merged(), new THREE.MeshBasicMaterial()));
  tail.rotation.x = up * 0.55 + 0.05; // the tail trails out nearly level, not hanging with the tilted body
  frame.add(tail);

  // --- the wings: pivots at the shoulders, folded along the flank until they are spread ---
  const wings: THREE.Group[] = [];
  const S = k.span;
  const C = Math.min(S * 0.5, L * 0.46);
  const fold = Math.min(1, (bl * 0.62) / S);
  for (const s of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(s * 0.8 * Bw, 0.45 * Bh, 0.1 * bl);
    const wp = new Parts();
    const out = wingOutline(S, C, k.wingShape);
    const mirror = (pts: [number, number][]) => pts.map(([zc, x]) => [zc, s * x] as [number, number]);
    wp.fin(mirror(out), 'zx', 0, k.wing);
    // the bands of feathers: the dark flight feathers at the tip and back edge, the paler coverts across the front
    wp.fin(mirror(out.map(([zc, x]) => [zc * 0.72 - C * 0.1, x * 0.93] as [number, number])), 'zx', 0.003, shade(k.wing, 0.8));
    const cov: [number, number][] = [[0.45 * C, 0.0], [0.5 * C, 0.14 * S], [0.42 * C, 0.46 * S], [0.1 * C, 0.5 * S], [-0.05 * C, 0.3 * S], [-0.05 * C, 0]];
    wp.fin(mirror(cov), 'zx', 0.007, mix(k.wing, k.main === k.wing ? k.belly : k.main, 0.35));
    wp.ball(0.08 * L, 0.07 * L, 0.18 * C + 0.04 * L, k.main, 0, 0, 0.05 * C, 0, 8, 6); // the rounded shoulder
    w.add(new THREE.Mesh(wp.merged(), new THREE.MeshBasicMaterial()));
    w.rotation.order = 'ZYX';
    frame.add(w);
    wings.push(w);
  }

  // --- the legs: a feathered thigh, a scaly shank and a foot with talons ---
  const legs: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(s * 0.1 * L * (k.body[2] / 0.3), hip + bd * 0.06, 0.04 * bl);
    const lp = new Parts();
    const lc = k.legC;
    const r = Math.max(0.014, L * 0.03);
    const hh = hip;
    if (k.feathered) lp.ball(r * 2.6, hh * 0.55, r * 2.6, k.belly, 0, -hh * 0.42, 0, 0, 10, 8); // thick feathered "trousers"
    else lp.ball(r * 2.1, r * 3.1, r * 2.4, k.main === k.belly ? k.main : mix(k.main, k.belly, 0.5), 0, -0.01, -0.01, 0, 8, 6);
    lp.seg([0, -hh * 0.2, 0], [0, -hh * 0.6, 0.015 * L], r * 1.2, r * 0.9, lc, 6);
    lp.seg([0, -hh * 0.6, 0.015 * L], [0, -hh + 0.012, 0.0], r * 0.9, r * 0.8, lc, 6);
    // four toes: three forward, one back, each ending in a talon
    const toeLen = Math.max(0.05, L * (k.beakKind === 'raptor' || k.beakKind === 'hook' ? 0.1 : 0.08));
    const fy = -hh + 0.01;
    const raptor = k.beakKind === 'raptor' || k.beakKind === 'hook' || k.beakKind === 'vulture';
    for (const a of [-0.45, 0, 0.45]) {
      const tip: V3 = [Math.sin(a) * toeLen, fy - 0.002, Math.cos(a) * toeLen];
      lp.seg([0, fy, 0], tip, r * (raptor ? 0.9 : 0.7), r * 0.5, lc, 5);
      lp.spike([tip[0], tip[1], tip[2]], [tip[0] * 1.1, fy - r * (raptor ? 2.6 : 1.4), tip[2] + toeLen * 0.3], r * (raptor ? 0.7 : 0.45), raptor ? 0x1a1814 : shade(lc, 0.6));
    }
    lp.seg([0, fy, 0], [0, fy - 0.002, -toeLen * 0.7], r * 0.7, r * 0.45, lc, 5);
    g.add(new THREE.Mesh(lp.merged(), new THREE.MeshBasicMaterial()));
    root.add(g);
    legs.push(g);
  }

  const fake: QuadSpec = { len: L, w: bw, h: bd + hs * 2, legLen: hip, legT: 0.03, fur: k.main, head: { s: hs * 1.4, snout: 0.05 }, id, scale: 1 };
  const ears: Built['ears'] = [];
  // (the legs are listed in pairs: the rig swings the first two and the last two in opposite directions, so it hops)
  return { root, legs: [legs[0], legs[0], legs[1], legs[1]], head, tail, torso, eyes, ears, hip, spec: fake, bird: { wings: wings as [THREE.Group, THREE.Group], look: k, fold } };
}

/** Fold the wings (spread = 0) or open them out flat (spread = 1); `flap` beats them. */
export function wingPose(b: BirdParts, spread: number, flap = 0) {
  const sw = b.look.swept ? 0.1 : 0;
  b.wings.forEach((w, i) => {
    const s = i === 0 ? -1 : 1; // wings[0] is the left one (x < 0)
    // folded: swept back along the flank and held against it; spread: out flat, a little raised
    w.scale.x = b.fold + (1 - b.fold) * spread;
    w.scale.z = 0.5 + 0.5 * spread; // a folded wing is a narrow packet of feathers
    w.rotation.y = s * (1 - spread) * (Math.PI / 2 - 0.1);
    w.rotation.z = s * (spread * (0.12 + sw) + flap) + s * (1 - spread) * 1.38;
  });
}
