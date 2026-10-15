import { MAP_RADIUS } from './protocol';

// Static, solid scenery. Every client builds the same world from this list, so nobody needs to
// sync it. Collision is resolved client-side (like player collision), which keeps the lobby
// cooperative rather than cheat-proof.
//
// A block spans [y0, y0 + h] vertically and is an axis-aligned rectangle on the ground plane.
// y0 > 0 makes a floating block you can slide under (a beam).

export type BlockKind = 'crate' | 'wall' | 'step' | 'platform' | 'beam' | 'pillar' | 'goal' | 'tree' | 'rock';

export interface Block {
  kind: BlockKind;
  x: number; // centre
  z: number;
  w: number; // size along x
  d: number; // size along z
  h: number; // height of the block itself
  y0: number; // height of its underside (0 = sits on the ground)
}

const b = (kind: BlockKind, x: number, z: number, w: number, d: number, h: number, y0 = 0): Block => ({
  kind,
  x,
  z,
  w,
  d,
  h,
  y0,
});

export const blockTop = (k: Block) => k.y0 + k.h;

/** Nearest point of the block's footprint to (px, pz). */
export function closestPoint(k: Block, px: number, pz: number): { x: number; z: number } {
  return {
    x: Math.max(k.x - k.w / 2, Math.min(k.x + k.w / 2, px)),
    z: Math.max(k.z - k.d / 2, Math.min(k.z + k.d / 2, pz)),
  };
}

export function footprintDistance(k: Block, px: number, pz: number): number {
  const c = closestPoint(k, px, pz);
  return Math.hypot(px - c.x, pz - c.z);
}

// ------------------------------------------------------------------------------------------
// Layout. The island's tiled floor has radius 24 m; everything stays inside ~22 m of the centre
// and outside the +-6 m square where players spawn.
// ------------------------------------------------------------------------------------------

/** Training yard (west side): one of each kind of obstacle, in the order you'd practise them. */
const YARD: Block[] = [
  // vault practice: knee-high and waist-high walls
  b('wall', -12, 7, 5, 0.5, 0.7),
  b('wall', -12, 9.5, 5, 0.5, 1.2),
  // crates to jump on, in a small stack
  b('crate', -17, 5, 1.2, 1.2, 1),
  b('crate', -17, 6.4, 1.2, 1.2, 1),
  b('crate', -17, 5.7, 1, 1, 2), // sits across the two below, a tall step
  // tall walls you must jump at and grab
  b('wall', -12, 14, 4, 0.8, 2.4),
  b('wall', -5.5, 15.5, 3, 0.8, 3.0),
  // slide-under beam on two pillars: stand and you hit it, slide and you pass beneath
  b('pillar', -9.4, 19, 0.6, 0.6, 1.6),
  b('pillar', -4.6, 19, 0.6, 0.6, 1.6),
  b('beam', -7, 19, 4.2, 0.5, 0.5, 0.85),
  // a few loose pillars to weave between at speed
  b('pillar', -20, 10, 0.8, 0.8, 3),
  b('pillar', -18, 13, 0.8, 0.8, 3),
  b('pillar', -15.5, 16.5, 0.8, 0.8, 3),
];

/**
 * The obby (east and north). It gets harder as it climbs:
 *   1. warm-up steps
 *   2. hop platforms about 1 m square: a 3 m gap, then two sprint jumps of 4.6 and 5.2 m
 *   3. a 4.6 m wall, 2 m above the last platform: hold E in the air to catch the ledge, pull up
 *   4. a long plank high above the ground
 *   5. four pillars, 0.7 m wide and about 4 m apart, a step higher each time: sprint jumps that
 *      you have to time to land on something the size of a doormat
 *   6. a tower of three tall walls: grab, pull up, jump, grab, pull up...
 *   7. the goal, almost 12 m up
 * Falling just means walking back to the start; there is no penalty.
 */
const COURSE: Block[] = [
  // 1. warm-up steps, getting higher
  b('step', 7.5, -7, 3, 3, 0.3),
  b('step', 11, -7, 2, 2, 0.6),
  b('step', 14, -7, 2, 2, 1.0),
  b('step', 17, -7, 2, 2, 1.4),
  // 2. hop platforms: 1.0 / 0.9 / 0.9 m squares, with gaps of 3, 4.6 and 5.2 m
  b('platform', 21.5, -9, 1.0, 1.0, 1.8),
  b('platform', 23.6, -14, 0.9, 0.9, 2.2),
  b('platform', 18, -17.2, 0.9, 0.9, 2.6),
  // 3. the 4.6 m wall: its top is 2.0 m above the last platform, so you must grab it
  b('wall', 17, -21.2, 3, 1.2, 4.6),
  // 4. a long plank across the top of it
  b('platform', 10.5, -21.2, 9, 0.6, 4.6),
  // 5. narrow pillars, 0.7 m wide, about 4.7 m apart and half a metre higher each time: you must
  //    be at a full sprint, and time the jump to within a step
  b('pillar', 1.0, -19.5, 0.7, 0.7, 5.1),
  b('pillar', -3.7, -17.2, 0.7, 0.7, 5.6),
  b('pillar', -8.4, -14.9, 0.7, 0.7, 6.1),
  b('pillar', -13.1, -12.6, 0.7, 0.7, 6.6),
  // 6. the grab tower: each wall top is 1.8 m above the one you stand on
  b('wall', -18.5, -10.5, 3, 1.2, 8.4),
  b('wall', -22.5, -9, 3, 1.2, 10.2),
  // 7. the goal tower, at the top
  b('goal', -26, -9.5, 2.6, 2.6, 12.0),
  // optional: a slide-under beam on the ground between the steps and the first hop platform
  b('pillar', 10, -12, 0.6, 0.6, 1.6),
  b('pillar', 15, -12, 0.6, 0.6, 1.6),
  b('beam', 12.5, -12, 4.4, 0.5, 0.5, 0.85),
];

/**
 * The basketball hoop, east of the spawn. The ball scores by dropping through the rim from above.
 * The pole and backboard are solid, so shots can bank off the board.
 */
export const HOOP = { x: 13.2, z: 5, rimY: 3.05, rimR: 0.23, boardX: 13.6 };
const HOOP_BLOCKS: Block[] = [
  b('pillar', 14.1, 5, 0.3, 0.3, 4.2), // the pole
  b('wall', HOOP.boardX, 5, 0.1, 1.3, 1.05, 2.9), // the backboard
];

const COURSE_AND_YARD: Block[] = [...YARD, ...COURSE, ...HOOP_BLOCKS];

// ------------------------------------------------------------------------------------------
// Scenery you bump into: palms along the beach and rocks on the beach and in the shallows. The
// positions come from a fixed seed so every client (and the server's item physics) agrees.
// ------------------------------------------------------------------------------------------

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Scenery {
  x: number;
  z: number;
  size: number; // rocks: radius of the stone; palms: unused
}

const nearCourse = (x: number, z: number, margin: number) =>
  COURSE_AND_YARD.some((k) => Math.abs(x - k.x) < k.w / 2 + margin && Math.abs(z - k.z) < k.d / 2 + margin);

function makeScenery() {
  const rnd = seeded(20260615);
  const R = MAP_RADIUS;
  const palms: Scenery[] = [];
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2 + (rnd() - 0.5) * 0.25;
    const r = R + 1.8 + rnd() * 3.4;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (nearCourse(x, z, 2.5)) continue;
    palms.push({ x, z, size: 1 });
  }
  const rocks: Scenery[] = [];
  for (let i = 0; i < 16; i++) {
    const angle = rnd() * Math.PI * 2;
    const r = R + 3 + rnd() * 24;
    const size = 0.7 + rnd() * 1.6;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (nearCourse(x, z, size + 2)) continue;
    rocks.push({ x, z, size });
  }
  return { palms, rocks };
}

export const SCENERY = makeScenery();

const SCENERY_BLOCKS: Block[] = [
  // a palm trunk: thin and tall; you walk around it, and slide off if you jump onto the top
  ...SCENERY.palms.map((p): Block => ({ kind: 'tree', x: p.x, z: p.z, w: 0.7, d: 0.7, h: 4, y0: 0 })),
  // a rock: a low boulder you can hop or climb onto
  ...SCENERY.rocks.map(
    (r): Block => ({ kind: 'rock', x: r.x, z: r.z, w: r.size * 1.5, d: r.size * 1.5, h: Math.max(0.35, r.size * 0.9 - 0.3), y0: 0 }),
  ),
];

export const OBSTACLES: Block[] = [...COURSE_AND_YARD, ...SCENERY_BLOCKS];

/** A short description of the course, in order, for the in-game sign and for tests. */
export const COURSE_ORDER = COURSE.slice(0, 16);
