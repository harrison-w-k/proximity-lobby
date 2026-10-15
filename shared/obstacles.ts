// Static, solid scenery. Every client builds the same world from this list, so nobody needs to
// sync it. Collision is resolved client-side (like player collision), which keeps the lobby
// cooperative rather than cheat-proof.
//
// A block spans [y0, y0 + h] vertically and is an axis-aligned rectangle on the ground plane.
// y0 > 0 makes a floating block you can slide under (a beam).

export type BlockKind = 'crate' | 'wall' | 'step' | 'platform' | 'beam' | 'pillar' | 'goal';

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

export const OBSTACLES: Block[] = [...YARD, ...COURSE];

/** A short description of the course, in order, for the in-game sign and for tests. */
export const COURSE_ORDER = COURSE.slice(0, 16);
