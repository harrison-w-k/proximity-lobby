// The four mammal trees (cats, canines, mustelids and bears), each animal built from its own measurements: body length,
// shoulder height, chest depth, how high the rump rides, how long the neck is, the shape of the skull and muzzle, the ears,
// the legs and the tail. Nothing is shared but the method, so a lynx is long-legged and short-tailed, a hyena slopes
// down to its rump, a weasel is a tube on stumps and a polar bear a long-necked giant, and each reads at a glance.
// Colours and markings still come from the old table (realquad's LOOK and models' PS), so the palette is unchanged.
import * as THREE from 'three';
import { Parts, mix, shade } from './creatures';
import { LOOK, loft, tube, vnoise, type Look, type Ring } from './realquad';
import type { Built, QuadSpec } from './models';

type V3 = [number, number, number];
type EarKind = 'tri' | 'round' | 'tall' | 'bat' | 'cup' | 'tiny';
type TailKind = 'whip' | 'curl' | 'club' | 'plume' | 'brush' | 'flat' | 'stub' | 'rope' | 'tuft';

export interface MSpec {
  kind: 'cat' | 'dog' | 'mustelid' | 'bear';
  L: number; // torso length, chest to rump
  SH: number; // height at the shoulder
  D: number; // chest depth
  W: number; // body width
  rump?: number; // height of the rump as a fraction of SH (1 level, below 1 slopes down to the back)
  waist?: number; // 0..1, how much the belly tucks up behind the ribs
  hump?: number; // shoulders standing above the back line, as a fraction of D
  rear?: number; // width of the haunches relative to the chest
  neck: [number, number, number]; // length, radius, rise (0 level, 1 straight up)
  head: { l: number; w: number; h: number; mL: number; mW: number; mH: number; drop?: number };
  ear: { k: EarKind; s: number; x?: number; y?: number; tuft?: boolean };
  leg: { t?: number; paw?: number; claw?: number; plant?: boolean; hind?: number; splay?: number };
  tail: { k: TailKind; l: number; t: number; up?: number };
  eye?: number; // size of the eye
  jowl?: number; // heavy cheeks
  deco?: (c: { torso: THREE.Group; head: THREE.Group; fur: number; belly: number; L: number; D: number; W: number; SH: number }) => void;
}

const CAT: Pick<MSpec, 'kind' | 'rump' | 'waist' | 'neck' | 'leg'> = { kind: 'cat', rump: 1.03, waist: 0.7, neck: [0.2, 0.08, 0.45], leg: { t: 0.045, claw: 0 } };

export const M: Record<string, MSpec> = {
  // ---------- cats ----------
  house_cat: {
    ...CAT, L: 0.6, SH: 0.42, D: 0.22, W: 0.2, rump: 1.0, neck: [0.1, 0.07, 0.55],
    head: { l: 0.2, w: 0.115, h: 0.1, mL: 0.04, mW: 0.07, mH: 0.055 }, ear: { k: 'tri', s: 0.09, x: 1.0 }, leg: { t: 0.034, paw: 0.05 }, tail: { k: 'curl', l: 0.56, t: 0.028, up: 0.85 }, eye: 1.2,
  },
  ocelot: {
    ...CAT, L: 0.85, SH: 0.52, D: 0.27, W: 0.22, rump: 1.04, waist: 0.75, neck: [0.14, 0.085, 0.4],
    head: { l: 0.23, w: 0.125, h: 0.105, mL: 0.06, mW: 0.075, mH: 0.06 }, ear: { k: 'round', s: 0.08, x: 1.1 }, leg: { t: 0.042, paw: 0.06 }, tail: { k: 'whip', l: 0.65, t: 0.032, up: 0.1 }, eye: 1.1,
  },
  bobcat: {
    ...CAT, L: 0.8, SH: 0.62, D: 0.3, W: 0.26, rump: 1.1, waist: 0.7, neck: [0.13, 0.095, 0.4],
    head: { l: 0.26, w: 0.15, h: 0.115, mL: 0.06, mW: 0.085, mH: 0.062 }, ear: { k: 'tri', s: 0.11, x: 1.1, tuft: true }, leg: { t: 0.05, paw: 0.065 }, tail: { k: 'club', l: 0.2, t: 0.05, up: 0.1 }, jowl: 1,
  },
  lynx: {
    ...CAT, L: 0.82, SH: 0.7, D: 0.3, W: 0.2, rump: 1.14, waist: 0.8, neck: [0.15, 0.09, 0.5],
    head: { l: 0.24, w: 0.13, h: 0.108, mL: 0.055, mW: 0.08, mH: 0.058 }, ear: { k: 'tall', s: 0.16, x: 1.0, tuft: true }, leg: { t: 0.045, paw: 0.09 }, tail: { k: 'club', l: 0.16, t: 0.04, up: 0.05 }, jowl: 1.2,
  },
  cheetah: {
    ...CAT, L: 1.2, SH: 0.98, D: 0.34, W: 0.2, rump: 1.02, waist: 1, neck: [0.28, 0.08, 0.5],
    head: { l: 0.2, w: 0.095, h: 0.088, mL: 0.04, mW: 0.06, mH: 0.05 }, ear: { k: 'round', s: 0.06, x: 1.0 }, leg: { t: 0.04, paw: 0.065 }, tail: { k: 'whip', l: 1.05, t: 0.032, up: -0.1 }, eye: 1,
  },
  panther: {
    ...CAT, L: 1.15, SH: 0.78, D: 0.42, W: 0.36, rump: 0.98, waist: 0.5, neck: [0.1, 0.17, 0.2],
    head: { l: 0.34, w: 0.2, h: 0.16, mL: 0.085, mW: 0.115, mH: 0.09 }, ear: { k: 'round', s: 0.07, x: 1.2 }, leg: { t: 0.085, paw: 0.1 }, tail: { k: 'whip', l: 0.95, t: 0.045, up: 0.02 }, jowl: 1.5, eye: 0.9,
  },
  leopard: {
    ...CAT, L: 1.2, SH: 0.86, D: 0.36, W: 0.26, rump: 1.05, waist: 0.8, neck: [0.2, 0.11, 0.4],
    head: { l: 0.27, w: 0.14, h: 0.11, mL: 0.06, mW: 0.08, mH: 0.06 }, ear: { k: 'round', s: 0.065, x: 1.1 }, leg: { t: 0.055, paw: 0.08 }, tail: { k: 'whip', l: 1.1, t: 0.04, up: 0.4 },
  },
  snow_leopard: {
    ...CAT, L: 1.05, SH: 0.78, D: 0.4, W: 0.34, rump: 1.05, waist: 0.4, neck: [0.1, 0.14, 0.3],
    head: { l: 0.26, w: 0.14, h: 0.115, mL: 0.04, mW: 0.082, mH: 0.062 }, ear: { k: 'tiny', s: 0.055, x: 1.2 }, leg: { t: 0.07, paw: 0.1 }, tail: { k: 'rope', l: 1.05, t: 0.065, up: 0.1 }, jowl: 1.3,
  },
  tiger: {
    ...CAT, L: 1.55, SH: 1.05, D: 0.55, W: 0.42, rump: 0.98, waist: 0.55, neck: [0.2, 0.2, 0.25],
    head: { l: 0.4, w: 0.24, h: 0.19, mL: 0.1, mW: 0.13, mH: 0.1 }, ear: { k: 'round', s: 0.09, x: 1.25 }, leg: { t: 0.105, paw: 0.14 }, tail: { k: 'rope', l: 1.15, t: 0.06, up: -0.1 }, jowl: 1.5,
  },
  lion: {
    ...CAT, L: 1.5, SH: 1.08, D: 0.55, W: 0.45, rump: 0.96, waist: 0.5, neck: [0.18, 0.22, 0.28],
    head: { l: 0.44, w: 0.26, h: 0.2, mL: 0.12, mW: 0.15, mH: 0.115 }, ear: { k: 'round', s: 0.07, x: 1.3 }, leg: { t: 0.105, paw: 0.145 }, tail: { k: 'tuft', l: 1.2, t: 0.04, up: -0.15 }, jowl: 1.3,
  },

  // ---------- canines ----------
  fox: {
    kind: 'dog', L: 0.62, SH: 0.46, D: 0.2, W: 0.17, rump: 1.0, waist: 0.85, neck: [0.14, 0.065, 0.5],
    head: { l: 0.2, w: 0.095, h: 0.085, mL: 0.17, mW: 0.045, mH: 0.04 }, ear: { k: 'tall', s: 0.13, x: 1.0 }, leg: { t: 0.03, paw: 0.04, claw: 0.3 }, tail: { k: 'plume', l: 0.58, t: 0.07, up: -0.1 }, eye: 1,
  },
  coyote: {
    kind: 'dog', L: 0.9, SH: 0.68, D: 0.3, W: 0.22, rump: 1.0, waist: 0.9, neck: [0.2, 0.09, 0.45],
    head: { l: 0.26, w: 0.11, h: 0.1, mL: 0.2, mW: 0.05, mH: 0.046 }, ear: { k: 'tall', s: 0.14, x: 1.0 }, leg: { t: 0.04, paw: 0.055, claw: 0.3 }, tail: { k: 'brush', l: 0.62, t: 0.075, up: -0.35 }, eye: 0.9,
  },
  jackal: {
    kind: 'dog', L: 0.8, SH: 0.66, D: 0.26, W: 0.19, rump: 1.02, waist: 1, neck: [0.2, 0.075, 0.5],
    head: { l: 0.24, w: 0.1, h: 0.09, mL: 0.2, mW: 0.042, mH: 0.04 }, ear: { k: 'tall', s: 0.16, x: 0.95 }, leg: { t: 0.034, paw: 0.05, claw: 0.3 }, tail: { k: 'brush', l: 0.5, t: 0.055, up: -0.25 },
  },
  gray_wolf: {
    kind: 'dog', L: 1.12, SH: 0.92, D: 0.4, W: 0.28, rump: 1.0, waist: 0.9, neck: [0.28, 0.13, 0.4],
    head: { l: 0.34, w: 0.15, h: 0.13, mL: 0.25, mW: 0.07, mH: 0.062 }, ear: { k: 'tri', s: 0.12, x: 1.0 }, leg: { t: 0.057, paw: 0.085, claw: 0.3 }, tail: { k: 'brush', l: 0.8, t: 0.09, up: -0.4 }, jowl: 1.2,
  },
  dhole: {
    kind: 'dog', L: 0.9, SH: 0.64, D: 0.28, W: 0.22, rump: 1.02, waist: 0.75, neck: [0.16, 0.09, 0.4],
    head: { l: 0.25, w: 0.12, h: 0.105, mL: 0.1, mW: 0.07, mH: 0.06 }, ear: { k: 'round', s: 0.13, x: 1.1 }, leg: { t: 0.042, paw: 0.055, claw: 0.3 }, tail: { k: 'brush', l: 0.6, t: 0.075, up: -0.3 },
  },
  hyena: {
    kind: 'dog', L: 1.0, SH: 0.94, D: 0.42, W: 0.3, rump: 0.76, hump: 0.2, waist: 0.6, rear: 0.8, neck: [0.2, 0.15, 0.3],
    head: { l: 0.36, w: 0.19, h: 0.14, mL: 0.16, mW: 0.105, mH: 0.075 }, ear: { k: 'round', s: 0.14, x: 1.3, y: 1.0 }, leg: { t: 0.06, paw: 0.08, claw: 0.2 }, tail: { k: 'brush', l: 0.34, t: 0.06, up: -0.3 }, jowl: 1.5,
  },
  wild_dog: {
    kind: 'dog', L: 0.92, SH: 0.7, D: 0.28, W: 0.2, rump: 1.0, waist: 0.9, neck: [0.17, 0.085, 0.35],
    head: { l: 0.26, w: 0.12, h: 0.1, mL: 0.1, mW: 0.075, mH: 0.06 }, ear: { k: 'bat', s: 0.18, x: 1.2 }, leg: { t: 0.04, paw: 0.055, claw: 0.2 }, tail: { k: 'brush', l: 0.55, t: 0.06, up: -0.2 },
  },
  dingo: {
    kind: 'dog', L: 0.98, SH: 0.72, D: 0.3, W: 0.23, rump: 1.0, waist: 0.8, neck: [0.2, 0.1, 0.4],
    head: { l: 0.28, w: 0.13, h: 0.11, mL: 0.16, mW: 0.065, mH: 0.055 }, ear: { k: 'tri', s: 0.1, x: 1.0 }, leg: { t: 0.046, paw: 0.062, claw: 0.3 }, tail: { k: 'club', l: 0.62, t: 0.06, up: -0.1 },
  },
  arctic_wolf: {
    kind: 'dog', L: 1.1, SH: 0.88, D: 0.45, W: 0.34, rump: 1.0, waist: 0.5, neck: [0.2, 0.15, 0.35],
    head: { l: 0.34, w: 0.17, h: 0.14, mL: 0.18, mW: 0.08, mH: 0.07 }, ear: { k: 'tiny', s: 0.075, x: 1.2 }, leg: { t: 0.065, paw: 0.1, claw: 0.2 }, tail: { k: 'club', l: 0.55, t: 0.1, up: -0.2 }, jowl: 1.5,
  },
  maned_wolf: {
    kind: 'dog', L: 0.9, SH: 1.15, D: 0.3, W: 0.19, rump: 0.96, waist: 1, neck: [0.34, 0.085, 0.55],
    head: { l: 0.26, w: 0.1, h: 0.09, mL: 0.2, mW: 0.045, mH: 0.04 }, ear: { k: 'bat', s: 0.22, x: 0.9 }, leg: { t: 0.034, paw: 0.05, claw: 0.2 }, tail: { k: 'brush', l: 0.45, t: 0.05, up: -0.1 },
  },

  // ---------- mustelids and their kin ----------
  weasel: {
    kind: 'mustelid', L: 0.78, SH: 0.2, D: 0.13, W: 0.13, rump: 1.0, waist: 0.2, neck: [0.2, 0.062, 0.3],
    head: { l: 0.14, w: 0.07, h: 0.06, mL: 0.05, mW: 0.045, mH: 0.034 }, ear: { k: 'tiny', s: 0.05, x: 1.5 }, leg: { t: 0.03, paw: 0.04, plant: true }, tail: { k: 'club', l: 0.28, t: 0.05, up: 0 }, eye: 1.4,
  },
  river_otter: {
    kind: 'mustelid', L: 0.9, SH: 0.34, D: 0.2, W: 0.19, rump: 0.96, waist: 0.1, neck: [0.1, 0.1, 0.2],
    head: { l: 0.2, w: 0.1, h: 0.075, mL: 0.06, mW: 0.07, mH: 0.045 }, ear: { k: 'tiny', s: 0.045, x: 1.4 }, leg: { t: 0.04, paw: 0.065, plant: true }, tail: { k: 'flat', l: 0.62, t: 0.075, up: -0.05 }, jowl: 1,
  },
  badger: {
    kind: 'mustelid', L: 0.72, SH: 0.38, D: 0.26, W: 0.38, rump: 0.96, waist: 0.1, neck: [0.06, 0.15, 0.1],
    head: { l: 0.24, w: 0.11, h: 0.085, mL: 0.13, mW: 0.05, mH: 0.04 }, ear: { k: 'tiny', s: 0.05, x: 1.5 }, leg: { t: 0.05, paw: 0.08, claw: 1, plant: true }, tail: { k: 'stub', l: 0.2, t: 0.06, up: 0 }, eye: 0.8,
  },
  giant_otter: {
    kind: 'mustelid', L: 1.25, SH: 0.52, D: 0.28, W: 0.24, rump: 0.96, waist: 0.1, neck: [0.14, 0.14, 0.2],
    head: { l: 0.26, w: 0.14, h: 0.105, mL: 0.06, mW: 0.1, mH: 0.06 }, ear: { k: 'tiny', s: 0.05, x: 1.5 }, leg: { t: 0.055, paw: 0.1, plant: true }, tail: { k: 'flat', l: 0.95, t: 0.1, up: 0 }, jowl: 1.4,
  },
  sea_otter: {
    kind: 'mustelid', L: 0.95, SH: 0.38, D: 0.3, W: 0.3, rump: 1.0, waist: 0, neck: [0.06, 0.15, 0.15],
    head: { l: 0.22, w: 0.13, h: 0.11, mL: 0.04, mW: 0.08, mH: 0.06 }, ear: { k: 'tiny', s: 0.045, x: 1.6 }, leg: { t: 0.04, paw: 0.1, plant: true, hind: 1.4 }, tail: { k: 'club', l: 0.4, t: 0.07, up: 0 }, jowl: 1.3,
  },
  honey_badger: {
    kind: 'mustelid', L: 0.78, SH: 0.46, D: 0.3, W: 0.34, rump: 0.98, waist: 0.1, neck: [0.07, 0.15, 0.1],
    head: { l: 0.22, w: 0.12, h: 0.09, mL: 0.08, mW: 0.07, mH: 0.05 }, ear: { k: 'tiny', s: 0.035, x: 1.5 }, leg: { t: 0.06, paw: 0.085, claw: 1, plant: true }, tail: { k: 'stub', l: 0.25, t: 0.05, up: 0.1 }, eye: 0.7,
  },
  wolverine: {
    kind: 'mustelid', L: 0.86, SH: 0.54, D: 0.34, W: 0.32, rump: 1.08, waist: 0.2, neck: [0.1, 0.16, 0.2],
    head: { l: 0.26, w: 0.14, h: 0.105, mL: 0.08, mW: 0.08, mH: 0.055 }, ear: { k: 'round', s: 0.065, x: 1.4 }, leg: { t: 0.07, paw: 0.1, claw: 1, plant: true }, tail: { k: 'brush', l: 0.34, t: 0.075, up: -0.1 }, jowl: 1.3,
  },
  fisher: {
    kind: 'mustelid', L: 0.95, SH: 0.4, D: 0.18, W: 0.16, rump: 1.05, waist: 0.4, neck: [0.18, 0.08, 0.35],
    head: { l: 0.2, w: 0.09, h: 0.075, mL: 0.08, mW: 0.05, mH: 0.04 }, ear: { k: 'round', s: 0.07, x: 1.4 }, leg: { t: 0.04, paw: 0.065, claw: 0.7, plant: true }, tail: { k: 'brush', l: 0.62, t: 0.06, up: -0.1 },
  },
  skunk: {
    kind: 'mustelid', L: 0.58, SH: 0.36, D: 0.24, W: 0.24, rump: 1.06, waist: 0.2, neck: [0.06, 0.1, 0.15],
    head: { l: 0.17, w: 0.085, h: 0.07, mL: 0.08, mW: 0.04, mH: 0.035 }, ear: { k: 'round', s: 0.05, x: 1.4 }, leg: { t: 0.04, paw: 0.06, claw: 0.8, plant: true }, tail: { k: 'brush', l: 0.62, t: 0.13, up: 0.9 }, eye: 0.9,
  },
  tayra: {
    kind: 'mustelid', L: 0.88, SH: 0.42, D: 0.2, W: 0.17, rump: 1.02, waist: 0.4, neck: [0.18, 0.08, 0.3],
    head: { l: 0.2, w: 0.095, h: 0.08, mL: 0.07, mW: 0.05, mH: 0.04 }, ear: { k: 'round', s: 0.06, x: 1.4 }, leg: { t: 0.04, paw: 0.065, claw: 0.7, plant: true }, tail: { k: 'rope', l: 0.85, t: 0.06, up: 0 },
  },

  // ---------- bears and the raccoon ----------
  raccoon: {
    kind: 'bear', L: 0.62, SH: 0.46, D: 0.28, W: 0.3, rump: 1.1, waist: 0.3, neck: [0.07, 0.12, 0.1],
    head: { l: 0.22, w: 0.12, h: 0.09, mL: 0.1, mW: 0.05, mH: 0.04 }, ear: { k: 'round', s: 0.06, x: 1.3 }, leg: { t: 0.04, paw: 0.065, claw: 0.5, plant: true }, tail: { k: 'rope', l: 0.5, t: 0.08, up: 0 }, eye: 1.1,
  },
  black_bear: {
    kind: 'bear', L: 1.1, SH: 0.98, D: 0.58, W: 0.46, rump: 1.0, waist: 0.4, hump: 0.04, neck: [0.18, 0.2, 0.15],
    head: { l: 0.36, w: 0.19, h: 0.155, mL: 0.2, mW: 0.1, mH: 0.085 }, ear: { k: 'round', s: 0.1, x: 1.3 }, leg: { t: 0.085, paw: 0.11, claw: 0.7, plant: true }, tail: { k: 'stub', l: 0.12, t: 0.05 },
  },
  sloth_bear: {
    kind: 'bear', L: 1.0, SH: 0.92, D: 0.5, W: 0.4, rump: 0.98, waist: 0.3, hump: 0.2, neck: [0.14, 0.19, 0.1],
    head: { l: 0.34, w: 0.16, h: 0.125, mL: 0.24, mW: 0.085, mH: 0.07 }, ear: { k: 'round', s: 0.1, x: 1.4 }, leg: { t: 0.07, paw: 0.1, claw: 2, plant: true }, tail: { k: 'stub', l: 0.18, t: 0.06 }, jowl: 0.8,
  },
  grizzly: {
    kind: 'bear', L: 1.35, SH: 1.2, D: 0.7, W: 0.58, rump: 0.9, waist: 0.3, hump: 0.28, neck: [0.2, 0.26, 0.15],
    head: { l: 0.44, w: 0.25, h: 0.19, mL: 0.2, mW: 0.125, mH: 0.1 }, ear: { k: 'round', s: 0.1, x: 1.35 }, leg: { t: 0.11, paw: 0.15, claw: 1.5, plant: true }, tail: { k: 'stub', l: 0.12, t: 0.06 }, jowl: 1.4,
  },
  polar_bear: {
    kind: 'bear', L: 1.55, SH: 1.15, D: 0.62, W: 0.5, rump: 0.96, waist: 0.4, hump: 0, neck: [0.5, 0.2, 0.25],
    head: { l: 0.4, w: 0.18, h: 0.14, mL: 0.25, mW: 0.095, mH: 0.075 }, ear: { k: 'tiny', s: 0.075, x: 1.2 }, leg: { t: 0.1, paw: 0.17, claw: 0.8, plant: true }, tail: { k: 'stub', l: 0.1, t: 0.05 },
  },
  kodiak: {
    kind: 'bear', L: 1.5, SH: 1.3, D: 0.78, W: 0.66, rump: 0.92, waist: 0.25, hump: 0.22, neck: [0.2, 0.3, 0.1],
    head: { l: 0.5, w: 0.3, h: 0.22, mL: 0.22, mW: 0.15, mH: 0.115 }, ear: { k: 'round', s: 0.12, x: 1.4 }, leg: { t: 0.125, paw: 0.17, claw: 1.5, plant: true }, tail: { k: 'stub', l: 0.12, t: 0.07 }, jowl: 1.6,
  },
  panda: {
    kind: 'bear', L: 0.95, SH: 0.92, D: 0.62, W: 0.58, rump: 0.95, waist: 0, hump: 0.04, neck: [0.06, 0.26, 0.05],
    head: { l: 0.4, w: 0.27, h: 0.22, mL: 0.06, mW: 0.15, mH: 0.1 }, ear: { k: 'round', s: 0.12, x: 1.45, y: 1.1 }, leg: { t: 0.1, paw: 0.13, claw: 0.3, plant: true }, tail: { k: 'stub', l: 0.12, t: 0.06 }, jowl: 1.8, eye: 0.8,
  },
  sun_bear: {
    kind: 'bear', L: 0.8, SH: 0.72, D: 0.42, W: 0.36, rump: 1.05, waist: 0.4, hump: 0, neck: [0.1, 0.15, 0.1],
    head: { l: 0.26, w: 0.14, h: 0.115, mL: 0.1, mW: 0.075, mH: 0.062 }, ear: { k: 'round', s: 0.06, x: 1.35 }, leg: { t: 0.065, paw: 0.085, claw: 1.8, plant: true }, tail: { k: 'stub', l: 0.06, t: 0.04 }, jowl: 0.8, eye: 1.1,
  },
  moon_bear: {
    kind: 'bear', L: 1.1, SH: 0.98, D: 0.55, W: 0.45, rump: 1.0, waist: 0.4, hump: 0.2, neck: [0.14, 0.24, 0.1],
    head: { l: 0.32, w: 0.2, h: 0.14, mL: 0.13, mW: 0.09, mH: 0.07 }, ear: { k: 'cup', s: 0.17, x: 1.5, y: 1.0 }, leg: { t: 0.08, paw: 0.11, claw: 1, plant: true }, tail: { k: 'stub', l: 0.08, t: 0.05 }, jowl: 1,
  },
  cave_bear: {
    kind: 'bear', L: 1.8, SH: 1.5, D: 0.85, W: 0.72, rump: 0.86, waist: 0.25, hump: 0.32, neck: [0.18, 0.34, 0.05],
    head: { l: 0.62, w: 0.34, h: 0.3, mL: 0.18, mW: 0.19, mH: 0.16 }, ear: { k: 'round', s: 0.13, x: 1.45 }, leg: { t: 0.15, paw: 0.2, claw: 1.5, plant: true }, tail: { k: 'stub', l: 0.14, t: 0.08 }, jowl: 1.5,
  },
};

export const MAMMAL = new Set(Object.keys(M));

const tmpC = new THREE.Color();
const tmpD = new THREE.Color();

/** Resample a ring list into many more rings (a smooth curve through the originals), so painted stripes and spots are not smeared. */
function densify(rings: Ring[], n: number): Ring[] {
  const out: Ring[] = [];
  const m = rings.length - 1;
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  for (let k = 0; k <= n; k++) {
    const f = (k / n) * m;
    const i = Math.min(m - 1, Math.floor(f));
    const t = f - i;
    const g = (j: number, key: keyof Ring) => (rings[Math.max(0, Math.min(m, j))][key] as number | undefined) ?? 0;
    const f4 = (key: keyof Ring) => cr(g(i - 1, key), g(i, key), g(i + 1, key), g(i + 2, key), t);
    out.push({ z: g(i, 'z') + (g(i + 1, 'z') - g(i, 'z')) * t, w: Math.max(0.002, f4('w')), top: Math.max(0.002, f4('top')), bot: Math.max(0.002, f4('bot')), cy: f4('cy'), cx: f4('cx') });
  }
  return out;
}

/** The colour of the coat at a point: back to belly, a mottle of noise, and the species' markings. */
function coat(fur: number, belly: number, a: number, x: number, y: number, z: number, look: Look | undefined, L: number, zz: number, grain = 18): number {
  const c = Math.cos(a);
  const t = THREE.MathUtils.smoothstep(-c, -0.1, 0.55);
  tmpC.setHex(fur);
  if (t > 0) tmpC.lerp(tmpD.setHex(belly), t);
  const n = vnoise(x * grain, y * grain, z * grain * 0.8);
  tmpC.multiplyScalar(0.9 + n * 0.2 + (c > 0.6 ? -0.05 : 0));
  const m = look?.mark?.(zz, a, x / L, y / L);
  if (m) tmpC.lerp(tmpD.setHex(m[0]), m[1] * (0.85 + n * 0.3));
  return tmpC.getHex();
}

export function buildMammal(spec: QuadSpec, id: string): Built {
  const s = M[id];
  const look = id === 'grizzly' ? { ...LOOK[id], mark: (_z: number, a: number, x: number) => (Math.cos(a) > 0.55 && Math.abs(x) < 0.12 ? ([0xc8b08a, 0.45] as [number, number]) : null) } : LOOK[id];
  const fur = spec.fur;
  const belly = spec.belly ?? shade(fur, 1.25);
  const pawC = spec.paw ?? shade(fur, 0.6);
  const { L, SH, D, W } = s;
  const Hh = D / 2;
  const Wh = W / 2;
  const plant = s.leg.plant ?? s.kind === 'bear';
  const T = (s.leg.t ?? 0.05) * 1.3; // limbs read thin at game distance, so they are built a little stout
  const rump = s.rump ?? 1;
  const waist = s.waist ?? 0.6;
  const hump = (s.hump ?? 0) * D;
  const rear = s.rear ?? 1;
  const hip = SH - D; // the belly at the chest
  const slope = (rump - 1) * SH; // how far the rump sits above (or below) the withers

  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = hip + Hh;
  root.add(torso);

  // --- body: rump, haunch, waist, ribs, deep chest, shoulders ---
  const u2z = (u: number) => (u - 0.5) * L;
  const lift = (u: number) => slope * (1 - u) + hump * THREE.MathUtils.smoothstep(u, 0.5, 0.88); // the back line along the body
  const bt = 1 - waist * 0.5; // belly depth at the waist
  const rings: Ring[] = [
    { z: u2z(0), w: 0.28 * Wh, top: 0.5 * Hh, bot: 0.3 * Hh, cy: lift(0) },
    { z: u2z(0.07), w: 0.78 * Wh * rear, top: 0.84 * Hh, bot: 0.62 * Hh, cy: lift(0.07) },
    { z: u2z(0.2), w: 0.98 * Wh * rear, top: 0.98 * Hh, bot: 0.78 * Hh, cy: lift(0.2) },
    { z: u2z(0.4), w: 0.84 * Wh * (1 - waist * 0.1), top: 0.95 * Hh, bot: bt * Hh, cy: lift(0.4) },
    { z: u2z(0.58), w: 0.96 * Wh, top: 1.0 * Hh, bot: 0.96 * Hh, cy: lift(0.58) },
    { z: u2z(0.76), w: 1.04 * Wh, top: 1.02 * Hh, bot: 1.04 * Hh, cy: lift(0.76) },
    { z: u2z(0.92), w: 0.9 * Wh, top: 0.98 * Hh, bot: 0.96 * Hh, cy: lift(0.92) },
    { z: u2z(1.0), w: 0.7 * Wh, top: 0.82 * Hh, bot: 0.78 * Hh, cy: lift(1) + 0.03 * D },
  ];
  const tp = new Parts();
  tp.addGeo(loft(densify(rings, 44), (z, a, y, x) => coat(fur, belly, a, x, y, z, look, L, z / L), 22));

  // --- neck: from the shoulders up and forward to the back of the skull ---
  const [nl, nr, nu] = s.neck;
  const nBase: V3 = [0, lift(0.95) - 0.02 * D, L / 2 - 0.1 * L];
  const nDir = new THREE.Vector3(0, nu, 1).normalize();
  const nTip: V3 = [0, nBase[1] + nDir.y * (nl + 0.1 * L), nBase[2] + nDir.z * (nl + 0.1 * L)];
  const npath: V3[] = [];
  const nrad: number[] = [];
  for (let i = 0; i < 5; i++) {
    const u = i / 4;
    npath.push([0, nBase[1] + (nTip[1] - nBase[1]) * u + Math.sin(u * Math.PI) * 0.015, nBase[2] + (nTip[2] - nBase[2]) * u]);
    nrad.push(nr * 1.15 * (1.25 - 0.35 * u) * (s.kind === 'bear' ? 1.1 : 1));
  }
  tp.addGeo(tube(npath, nrad, (u, a) => coat(fur, belly, a, 0, 0, u, undefined, L, 0.5), 12));
  look?.mane && addMane(tp, look.mane, nBase, nTip, nr, D, Wh);
  torso.add(new THREE.Mesh(tp.merged(), new THREE.MeshBasicMaterial()));

  // --- head ---
  const head = new THREE.Group();
  const HK = 1.25;
  const MK = 1.22; // the muzzle is deeper than a simple cone // heads are a little larger than life, so each animal reads from afar
  const { l: hl, w: hw, h: hh, mL, mW, mH } = Object.fromEntries(Object.entries(s.head).map(([k, v]) => [k, (v as number) * HK * (k === 'mW' || k === 'mH' ? MK : 1)])) as MSpec['head'];
  const headFwd = nTip[2] + hl * 0.35;
  head.position.set(0, nTip[1] - (s.head.drop ?? 0) + hh * 0.1, headFwd);
  const snoutC = spec.head.snoutC ?? fur;
  const headCol = (z: number, a: number, y: number, x: number): number => {
    const c = Math.cos(a);
    let col = coat(fur, belly, a, x, y, z, undefined, hl, 0, 24);
    const mz = THREE.MathUtils.smoothstep(z, 0.2 * hl, 0.5 * hl + mL * 0.4);
    if (snoutC !== fur) col = mix(col, c < 0.2 ? shade(snoutC, 1.1) : snoutC, mz * 0.9);
    col = faceMarks(id, col, x, y, z, c, hl, hw, hh, fur, belly);
    if (z > 0.5 * hl + mL * 0.9 && Math.abs(x) < 0.2 * mW + 0.01) col = noseOf(id);
    return col;
  };
  const hr: Ring[] = [
    { z: -0.5 * hl, w: 0.55 * hw, top: 0.6 * hh, bot: 0.55 * hh, cy: 0 },
    { z: -0.28 * hl, w: 0.96 * hw, top: 0.95 * hh, bot: 0.8 * hh, cy: 0.02 * hh },
    { z: 0.0, w: hw, top: hh, bot: 0.74 * hh, cy: 0.03 * hh },
    { z: 0.22 * hl, w: 0.8 * hw, top: 0.8 * hh, bot: 0.6 * hh, cy: -0.02 * hh },
    { z: 0.5 * hl, w: Math.max(mW * 1.15, 0.2 * hw), top: Math.max(mH * 1.2, 0.2 * hh), bot: Math.max(mH * 0.95, 0.18 * hh), cy: -0.22 * hh },
    { z: 0.5 * hl + mL * 0.55, w: mW, top: mH, bot: mH * 0.8, cy: -0.26 * hh },
    { z: 0.5 * hl + mL * 0.95, w: mW * 0.86, top: mH * 0.84, bot: mH * 0.66, cy: -0.26 * hh },
    { z: 0.5 * hl + mL + 0.012, w: mW * 0.4, top: mH * 0.4, bot: mH * 0.3, cy: -0.25 * hh },
  ];
  const hp = new Parts();
  hp.addGeo(loft(densify(hr, 18), headCol, 18));
  // the lower jaw
  const jawD = mH * 0.5;
  hp.addGeo(
    loft(
      [
        { z: 0.0, w: 0.5 * hw, top: 0.05 * hh, bot: 0.16 * hh, cy: -0.58 * hh },
        { z: 0.3 * hl, w: 0.4 * hw, top: 0.04 * hh, bot: 0.14 * hh, cy: -0.55 * hh },
        { z: 0.5 * hl + mL * 0.6, w: mW * 0.72, top: 0.03 * hh, bot: jawD * 0.5, cy: -0.44 * hh },
        { z: 0.5 * hl + mL * 0.94, w: mW * 0.46, top: 0.02 * hh, bot: jawD * 0.35, cy: -0.4 * hh },
      ],
      (_z, a) => (Math.cos(a) > 0.5 ? 0x2a1a16 : mix(belly, 0xffffff, 0.2)),
      12,
    ),
  );
  if (s.jowl) for (const sx of [-1, 1]) hp.ball(0.3 * hw * s.jowl, 0.4 * hh * Math.min(1.4, s.jowl), 0.34 * hl, mix(fur, belly, 0.3), sx * 0.72 * hw, -0.2 * hh, -0.02 * hl, 0, 8, 6);
  if (s.kind === 'dog' || look?.fangs) for (const sx of [-1, 1]) hp.spike([sx * 0.45 * mW, -0.3 * hh, 0.5 * hl + mL * 0.7], [sx * 0.45 * mW, -0.3 * hh - 0.035 * (hl + mL), 0.5 * hl + mL * 0.72], 0.012 + 0.004, 0xf2ecdc);
  if (look?.whiskers) for (const sx of [-1, 1]) for (let k = -1; k <= 1; k++) hp.seg([sx * 0.4 * mW, -0.2 * hh + k * 0.02, 0.5 * hl + mL * 0.55], [sx * (mW + 0.07 * hl + 0.04), -0.18 * hh + k * 0.045, 0.5 * hl + mL * 0.55], 0.003, 0.0012, 0xf1ede2, 3);
  if (look?.ruff) for (const sx of [-1, 1]) hp.ball(0.2 * hw, 0.36 * hh, 0.34 * hl, look.ruff, sx * 0.9 * hw, -0.3 * hh, 0.0, 0, 8, 6);
  head.add(new THREE.Mesh(hp.merged(), new THREE.MeshBasicMaterial()));

  // --- eyes ---
  const eyes: THREE.Object3D[] = [];
  const eyeC = spec.eye ?? 0x6b4a20;
  const front = s.kind === 'cat' || s.kind === 'mustelid';
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group();
    const ey = 0.18 * hh;
    const ez = 0.28 * hl;
    eye.position.set(sx * (front ? 0.5 : 0.62) * hw, ey, ez);
    eye.rotation.y = sx * (front ? 0.3 : 0.55);
    const ep = new Parts();
    const er = hh * (s.eye ?? 1) * (s.kind === 'bear' ? 0.17 : s.kind === 'cat' ? 0.3 : s.kind === 'mustelid' ? 0.22 : 0.2);
    ep.ball(er * 1.2, er * 1.12, er * 0.6, 0x1a1210, 0, 0, 0, 0, 10, 8);
    ep.ball(er, er * 0.95, er * 0.6, eyeC, 0, 0, er * 0.15, 0, 10, 8);
    if (spec.slit) ep.ball(er * 0.22, er * 0.92, er * 0.4, 0x050505, 0, 0, er * 0.45, 0, 6, 6);
    else ep.ball(er * 0.55, er * 0.55, er * 0.4, 0x050505, 0, 0, er * 0.45, 0, 8, 6);
    ep.ball(er * 0.22, er * 0.22, er * 0.2, 0xffffff, -sx * er * 0.25, er * 0.3, er * 0.62, 0, 5, 4);
    eye.add(new THREE.Mesh(ep.merged(), new THREE.MeshBasicMaterial()));
    head.add(eye);
    eyes.push(eye);
  }

  // --- ears ---
  const ears: { o: THREE.Object3D; side: number }[] = [];
  const e0 = s.ear;
  const es = e0.s;
  const earC = spec.earC ?? fur;
  const inner = s.kind === 'bear' || id === 'panda' ? shade(earC, 0.7) : 0xe0a8a0;
  for (const sx of [-1, 1]) {
    const e = new THREE.Group();
    e.position.set(sx * (e0.x ?? 1) * 0.62 * hw, (e0.y ?? 1) * 0.78 * hh, -0.2 * hl);
    const ep = new Parts();
    switch (e0.k) {
      case 'tri': // a broad cat's ear
        ep.spike([0, 0, 0], [0, es * 1.05, -0.01], es * 0.55, earC);
        ep.spike([0, es * 0.05, es * 0.08], [0, es * 0.75, es * 0.04], es * 0.3, inner);
        break;
      case 'tall': // narrow and upright: foxes, jackals, lynxes
        ep.spike([0, 0, 0], [sx * es * 0.05, es * 1.5, -0.02], es * 0.42, earC);
        ep.spike([0, es * 0.06, es * 0.06], [sx * es * 0.04, es * 1.1, 0.0], es * 0.24, 0x2a1c16);
        break;
      case 'bat': // huge and rounded, set wide
        ep.ball(es * 0.55, es * 0.85, es * 0.1, earC, 0, es * 0.8, 0, 0, 10, 8);
        ep.ball(es * 0.38, es * 0.64, es * 0.06, inner, 0, es * 0.78, es * 0.07, 0, 8, 6);
        break;
      case 'cup': // a moon bear's big round dish
        ep.ball(es * 0.8, es * 0.8, es * 0.12, earC, 0, es * 0.55, 0, 0, 12, 9);
        ep.ball(es * 0.55, es * 0.55, es * 0.06, inner, 0, es * 0.52, es * 0.07, 0, 10, 8);
        break;
      case 'tiny': // a small rounded nub
        ep.ball(es * 0.55, es * 0.5, es * 0.2, earC, 0, es * 0.3, 0, 0, 8, 6);
        break;
      default: // round
        ep.ball(es * 0.62, es * 0.6, es * 0.18, earC, 0, es * 0.4, 0, 0, 10, 8);
        ep.ball(es * 0.4, es * 0.38, es * 0.1, inner, 0, es * 0.38, es * 0.1, 0, 8, 6);
    }
    if (e0.tuft || look?.tuftEars) ep.spike([0, es * (e0.k === 'tall' ? 1.45 : 1.0), 0], [0, es * (e0.k === 'tall' ? 2.1 : 1.6), -0.01], es * 0.1, look?.tuftEars ?? 0x1a1410);
    e.add(new THREE.Mesh(ep.merged(), new THREE.MeshBasicMaterial()));
    e.rotation.z = sx * -0.25;
    head.add(e);
    ears.push({ o: e, side: sx });
  }
  torso.add(head);

  // --- legs: the animation swings each from the point where it meets the body ---
  const legs: THREE.Group[] = [];
  const lx = Wh * 0.62;
  const lz = L / 2 - T * 1.6 - 0.04 * L;
  const claw = s.leg.claw ?? (s.kind === 'cat' ? 0 : 0.5);
  const pawS = s.leg.paw ?? T * 1.3;
  for (const [sx, sz] of [[1, 1], [-1, -1], [-1, 1], [1, -1]] as const) {
    const front = sz > 0;
    const top = (front ? hip : hip + (rump < 1 ? slope * 0.7 : slope * 0.35)) + D * 0.32; // the leg starts inside the body; a sloping back puts the hind legs lower
    const g = new THREE.Group();
    g.position.set(sx * lx, top, sz * lz);
    const bottom = -top;
    const tt = T * (front ? 1 : s.leg.hind ?? 1);
    const lc = (y: number) => (id === 'panda' ? pawC : y < bottom * 0.55 ? mix(fur, pawC, 0.45) : fur);
    const lp = new Parts();
    const seg = (a: V3, b: V3, r0: number, r1: number) => lp.seg(a, b, r0, r1, lc((a[1] + b[1]) / 2), 9);
    if (front) {
      lp.ball(Math.min(tt * 1.35, Wh * 0.5), Math.min(tt * 1.9, Hh * 0.8), Math.min(tt * 1.7, L * 0.12), fur, 0, -tt * 0.1, 0, 0, 12, 9);
      const el: V3 = [0, bottom * 0.5, -tt * 0.5];
      const wr: V3 = [0, bottom * (plant ? 0.88 : 0.86), tt * 0.1];
      seg([0, -tt * 0.5, 0], el, tt * 1.3, tt * 0.9);
      lp.ball(tt * 0.76, tt * 0.76, tt * 0.76, fur, el[0], el[1], el[2], 0, 10, 8);
      seg(el, wr, tt * 0.9, tt * 0.68);
      seg(wr, [0, bottom + pawS * 0.3, tt * 0.2], tt * 0.6, tt * 0.56);
    } else {
      lp.ball(Math.min(tt * 1.6, Wh * 0.55), Math.min(tt * 2.4, Hh * 0.9), Math.min(tt * 2.1, L * 0.15), fur, 0, -tt * 0.2, -tt * 0.2, 0, 12, 9);
      const kn: V3 = [0, bottom * 0.42, tt * 1.0];
      const hk: V3 = [0, bottom * (plant ? 0.86 : 0.78), -tt * 0.9];
      seg([0, -tt * 0.5, -tt * 0.2], kn, tt * 1.5, tt * 0.95);
      lp.ball(tt * 0.82, tt * 0.82, tt * 0.82, fur, kn[0], kn[1], kn[2], 0, 10, 8);
      seg(kn, hk, tt * 1.0, tt * 0.68);
      lp.ball(tt * 0.6, tt * 0.6, tt * 0.6, fur, hk[0], hk[1], hk[2], 0, 10, 8);
      seg(hk, [0, bottom + pawS * 0.3, tt * 0.15], tt * 0.6, tt * 0.52);
    }
    // the paw: a pad, with toes and claws
    const pawW = Math.min(pawS * 0.85, Wh * 0.45);
    const pl = pawS * (plant ? 1.6 : 1.3);
    lp.ball(pawW, pawS * 0.34, pl, pawC, 0, bottom + pawS * 0.3, pl * 0.45, 0, 10, 7);
    const toes = s.kind === 'dog' ? 2 : 3;
    for (let k = 0; k < toes; k++) {
      const kx = (k - (toes - 1) / 2) * pawW * (toes === 2 ? 0.85 : 0.62);
      lp.ball(pawW * 0.34, pawS * 0.22, pl * 0.3, pawC, kx, bottom + pawS * 0.2, pl * 1.0, 0, 6, 5);
      if (claw > 0) lp.spike([kx, bottom + pawS * 0.18, pl * 1.15], [kx, bottom + pawS * 0.1, pl * (1.15 + 0.5 * claw)], pawS * 0.06, plant ? 0xe8dcc6 : 0x2a2218);
    }
    g.add(new THREE.Mesh(lp.merged(), new THREE.MeshBasicMaterial()));
    root.add(g);
    legs.push(g);
  }

  // --- tail ---
  const tl = s.tail.l;
  let tail: THREE.Group | null = null;
  if (tl > 0) {
    tail = new THREE.Group();
    tail.position.set(0, lift(0.02) + 0.02 * D, -L / 2 + 0.02 * L);
    const tc = spec.tail?.c ?? fur;
    const tr = s.tail.t;
    const up = s.tail.up ?? 0;
    const n = 9;
    const path: V3[] = [];
    const radii: number[] = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const lift2 = s.tail.k === 'curl' ? tl * up * (1.5 * u - 0.7 * u * u) : s.tail.k === 'brush' && up > 0.5 ? tl * up * Math.pow(u, 0.8) : tl * up * (u * 0.9 + u * u * 0.5);
      const back = s.tail.k === 'curl' ? -tl * u * 0.75 : s.tail.k === 'brush' && up > 0.5 ? -tl * u * 0.35 : -tl * u;
      path.push([0, lift2 - tl * 0.05 * u, back]);
      let r = tr;
      switch (s.tail.k) {
        case 'whip': r = tr * (1 - u * 0.2); break;
        case 'curl': r = tr * (1 - u * 0.3); break;
        case 'club': r = tr * (0.8 + u * 0.4 - (u > 0.9 ? 0.5 : 0)); break;
        case 'plume': r = tr * (0.5 + Math.sin(Math.min(1, u * 1.15) * Math.PI) * 1.2) * (u > 0.93 ? 0.3 : 1); break;
        case 'brush': r = tr * (0.55 + Math.sin(u * Math.PI * 0.9) * 0.75) * (u > 0.95 ? 0.4 : 1); break;
        case 'flat': r = tr * (1.05 - u * 0.85); break;
        case 'stub': r = tr * (1 - u * 0.6); break;
        case 'rope': r = tr * (0.9 + Math.sin(u * Math.PI) * 0.3) * (1 - u * 0.15); break;
        case 'tuft': r = tr * (1 - u * 0.2); break;
      }
      radii.push(Math.max(0.006, r));
    }
    const tipC = look?.tailTip;
    const ringC = look?.tailRings;
    const tg = tube(path, radii, (u, a) => {
      let c = tc;
      if (Math.cos(a) < -0.2 && tc === fur) c = mix(tc, belly, 0.55);
      if (ringC !== undefined && Math.floor(u * 9) % 2 === 1) c = mix(c, ringC, 0.9);
      if (tipC !== undefined && u > (s.tail.k === 'plume' || s.tail.k === 'brush' ? 0.78 : 0.82)) c = mix(c, tipC, 0.95);
      return c;
    });
    const tpp = new Parts();
    tpp.addGeo(tg);
    if (s.tail.k === 'tuft') tpp.ball(tr * 1.5, tr * 1.5, tr * 3.2, 0x3a1e0c, 0, path[n - 1][1], path[n - 1][2] - tr, 0, 8, 6);
    if (s.tail.k === 'flat') tpp.ball(tr * 0.3, tr * 0.18, tr * 0.5, fur, 0, 0, path[n - 1][2], 0, 6, 5);
    tail.add(new THREE.Mesh(tpp.merged(), new THREE.MeshBasicMaterial()));
    torso.add(tail);
  }

  s.deco?.({ torso, head, fur, belly, L, D, W, SH });
  decorate(id, torso, head, { fur, belly, L, D, W, SH, hl, hw, hh, mL, mW, mH, hip, lift });
  return {
    root,
    legs,
    head,
    tail,
    torso,
    eyes,
    ears,
    hip,
    spec: { ...spec, id, len: L, w: W, h: D, legLen: hip, legT: T, scale: 1, head: { ...spec.head, s: hl }, slit: spec.slit },
  };
}

function noseOf(id: string): number {
  const nose: Record<string, number> = { house_cat: 0xd88a86, bobcat: 0xb07a74, lynx: 0x6a4a46, cheetah: 0x1a1210, panther: 0x1a1214, tiger: 0xc08a80, lion: 0x7a4a40, snow_leopard: 0x7a5a58, panda: 0x120d0b };
  return nose[id] ?? 0x120d0b;
}

/** The painted face: masks, stripes, patches. */
function faceMarks(id: string, col: number, x: number, y: number, z: number, c: number, hl: number, hw: number, hh: number, fur: number, belly: number): number {
  switch (id) {
    case 'raccoon': {
      const band = Math.abs(y - 0.12 * hh) < 0.4 * hh && z > -0.1 * hl && z < 0.38 * hl && Math.abs(x) > 0.1 * hw;
      if (band) return mix(col, 0x18140f, 0.94);
      if (Math.abs(x) < 0.1 * hw && c > 0.2 && z > 0) return mix(col, 0x2a2420, 0.75);
      if (z > 0.3 * hl) return mix(col, 0xe9e3d6, 0.75);
      return col;
    }
    case 'panda': {
      col = 0xf2f0ea;
      if (Math.hypot(Math.abs(x) - 0.55 * hw, y - 0.08 * hh) < 0.34 * hh && z > 0.0 && z < 0.4 * hl) col = 0x16161a;
      return col;
    }
    case 'badger':
      if (Math.abs(x) < 0.1 * hw && c > 0) return 0xe9e5d8;
      if (Math.abs(Math.abs(x) - 0.55 * hw) < 0.12 * hw && c > 0.1) return mix(col, 0xe9e5d8, 0.9);
      return c > 0.1 ? mix(col, 0x1a1819, 0.85) : col;
    case 'honey_badger':
      return c > 0.3 ? mix(col, 0xd8d4c6, 0.9) : col;
    case 'tiger':
    case 'house_cat':
      if (c > 0.2 && z < 0.3 * hl && Math.sin((x / hw) * 10 + z * 22) > 0.45) return mix(col, 0x1a120a, 0.65);
      return col;
    case 'cheetah':
      if (z > 0.1 * hl && Math.abs(Math.abs(x) - 0.4 * hw) < 0.08 * hw && y < 0.3 * hh) return mix(col, 0x1a120a, 0.88);
      return col;
    case 'skunk':
      if (Math.abs(x) < 0.12 * hw && c > 0.2) return 0xf2f0ea;
      return col;
    case 'wild_dog':
      if (Math.abs(x) < 0.14 * hw && c > 0.3 && z < 0.5 * hl) return mix(col, 0x1a140c, 0.8);
      if (z > 0.3 * hl) return mix(col, 0x1a140c, 0.7);
      return col;
    case 'hyena':
      if (z > 0.35 * hl) return mix(col, 0x2a2218, 0.8);
      return col;
    case 'fox':
    case 'maned_wolf':
      if (z > 0.3 * hl && c < 0.1) return mix(col, 0xf6f1e6, 0.7); // pale cheeks and chin
      if (z > 0.38 * hl && c > 0.5) return mix(col, 0x1c1410, 0.5); // dark nose bridge
      return col;
    case 'coyote':
    case 'gray_wolf':
    case 'arctic_wolf':
      if (z > 0.25 * hl && c < 0.15) return mix(col, belly, 0.7);
      return col;
    case 'sun_bear':
      if (z > 0.3 * hl) return mix(col, 0xc9a56a, 0.9);
      return col;
    case 'moon_bear':
      if (z > 0.2 * hl && c < 0.0) return mix(col, 0xf2eee0, 0.8);
      return col;
    case 'wolverine':
      if (z > 0.05 * hl && Math.abs(y) < 0.22 * hh && Math.abs(x) > 0.5 * hw) return mix(col, 0x2a1f14, 0.7);
      return col;
    default:
      return col;
  }
}

function addMane(tp: Parts, mc: number, nBase: V3, nTip: V3, nr: number, D: number, Wh: number) {
  // a lion's mane: a great shaggy ruff wrapped round the neck and shoulders
  const cz = (nBase[2] + nTip[2]) / 2 + 0.05;
  const cy = (nBase[1] + nTip[1]) / 2;
  const mg = loft(
    [
      { z: cz - 0.34 * D, w: 0.9 * nr, top: 1.1 * nr, bot: 1.2 * nr, cy },
      { z: cz - 0.1 * D, w: 2.3 * nr, top: 2.3 * nr, bot: 2.2 * nr, cy: cy + 0.02 },
      { z: cz + 0.2 * D, w: 2.5 * nr, top: 2.4 * nr, bot: 2.1 * nr, cy: cy + 0.03 },
      { z: cz + 0.42 * D, w: 1.9 * nr, top: 1.9 * nr, bot: 1.7 * nr, cy: cy + 0.02 },
      { z: cz + 0.56 * D, w: 1.1 * nr, top: 1.1 * nr, bot: 1.0 * nr, cy },
    ],
    (z, a, y, x) => {
      const n = vnoise(x * 11, y * 11, z * 9);
      tmpC.setHex(mc).multiplyScalar(0.62 + n * 0.62);
      return tmpC.getHex();
    },
    16,
  );
  void Wh;
  tp.addGeo(mg);
}

interface Ctx {
  fur: number;
  belly: number;
  L: number;
  D: number;
  W: number;
  SH: number;
  hl: number;
  hw: number;
  hh: number;
  mL: number;
  mW: number;
  mH: number;
  hip: number;
  lift: (u: number) => number;
}

/** What makes some animals unmistakable: a back hump, a mane of fur, a shell of armour, a body stripe. */
function decorate(id: string, torso: THREE.Group, head: THREE.Group, c: Ctx) {
  const p = new Parts();
  const Hh = c.D / 2;
  switch (id) {
    case 'hyena': // a bristling mane down the neck and back
      for (let i = 0; i < 9; i++) {
        const z = c.L * (0.45 - i * 0.075);
        const y = c.lift(0.5 + (0.45 - i * 0.075) / 1) + Hh * 0.95;
        p.spike([0, y, z], [0, y + 0.07, z - 0.06], 0.02, 0x2a2218);
      }
      break;
    case 'maned_wolf':
    case 'gray_wolf':
    case 'arctic_wolf':
      for (let i = 0; i < 7; i++) {
        const z = c.L * (0.5 - i * 0.06);
        const y = c.lift(0.9 - i * 0.05) + Hh * 0.98;
        p.spike([0, y, z], [0, y + 0.05, z - 0.05], 0.018, id === 'maned_wolf' ? 0x1c1410 : shade(c.fur, 0.8));
      }
      break;
    case 'skunk':
      p.seg([0, Hh * 0.98, c.L * 0.5], [0, Hh * 0.86, -c.L * 0.5], 0.035, 0.035, 0xf2f0ea, 6);
      break;
    case 'sloth_bear':
      p.ball(0.07, 0.11, 0.03, 0xe8dcc0, 0, -Hh * 0.45, c.L * 0.5 + 0.03, 0, 8, 6);
      for (let i = 0; i < 6; i++) p.spike([0, Hh * 0.95, c.L * (0.3 - i * 0.08)], [0, Hh * 0.95 + 0.08, c.L * (0.3 - i * 0.08) - 0.04], 0.02, 0x16130f);
      break;
    case 'cave_bear':
    case 'kodiak':
    case 'grizzly':
      p.ball(c.W * 0.4, Hh * 0.5, c.L * 0.18, c.fur, 0, c.lift(0.7) + Hh * 0.7, c.L * 0.18, 0, 10, 8); // the muscle of the shoulder hump
      break;
    case 'badger':
      for (let i = 0; i < 8; i++) {
        const sx = i % 2 ? 1 : -1;
        p.spike([sx * c.W * 0.4, 0.2 * Hh, c.L * (0.3 - i * 0.07)], [sx * c.W * 0.62, -Hh * 0.2, c.L * (0.3 - i * 0.07)], 0.02, 0x6a6660); // shaggy skirt
      }
      break;
    case 'sea_otter':
      p.ball(c.W * 0.3, 0.05, c.L * 0.18, mix(c.fur, c.belly, 0.4), 0, Hh * 0.5, c.L * 0.3, 0, 8, 6);
      break;
    default:
  }
  if ((p as unknown as { geos: unknown[] }).geos.length) torso.add(new THREE.Mesh(p.merged(), new THREE.MeshBasicMaterial()));
  void head;
}
