import { HOOP, OBSTACLES, blockTop } from './obstacles';

// Little objects you can pick up with a click and carry. The server owns who holds what; every
// client draws the same set, so everyone sees the same things sitting about and being carried.

export type ItemKind = 'ball' | 'basketball' | 'beachball' | 'crate' | 'cone' | 'duck' | 'fish';

export interface ItemState {
  id: number;
  kind: ItemKind;
  x: number;
  y: number; // height of the item's base
  z: number;
  holder: string | null; // player id carrying it, or null when it is lying around
}

export const REACH = 5; // how close (m) you must be to pick something up

/** Where the items start. Kept clear of the obstacle course. */
export const ITEM_SPAWNS: Omit<ItemState, 'holder'>[] = [
  { id: 0, kind: 'basketball', x: 10.5, y: 0, z: 7.5 },
  { id: 1, kind: 'duck', x: -4, y: 0, z: 3.5 },
  { id: 2, kind: 'crate', x: 3, y: 0, z: -4 },
  { id: 3, kind: 'cone', x: -3, y: 0, z: -5 },
  { id: 4, kind: 'fish', x: 0, y: 0, z: 7 },
  { id: 5, kind: 'basketball', x: 9.5, y: 0, z: 2.5 },
  { id: 6, kind: 'duck', x: -9, y: 0, z: -3 },
  { id: 7, kind: 'cone', x: 6, y: 0, z: 10 },
  { id: 8, kind: 'fish', x: -6, y: 0, z: -10 },
  { id: 9, kind: 'ball', x: -2, y: 0, z: -12 },
  { id: 10, kind: 'crate', x: 8, y: 0, z: 16 },
  { id: 11, kind: 'duck', x: 1, y: 0, z: -15 },
  { id: 12, kind: 'fish', x: 13, y: 0, z: 9 },
  { id: 13, kind: 'cone', x: -1, y: 0, z: 14 },
  { id: 14, kind: 'beachball', x: 2, y: 0, z: -7 },
  { id: 15, kind: 'beachball', x: -12, y: 0, z: 10 },
];

// ---- throwing ----
export const THROW_GRAVITY = 18;
export const THROW_MAX_SPEED = 24; // a bit above the strongest throw, so aim-assisted lobs are not trimmed

/** [x, y, z, vx, vy, vz] of a throw, at the moment it leaves the hand. */
export type Flight = [number, number, number, number, number, number];

/**
 * The path of a thrown or shoved item, one point per 1/60 s, ending where it comes to rest. The
 * server uses the last point and every client plays the same path back, so everyone sees the same
 * motion. It bounces off the ground and block tops, rolls with friction, glances off walls, and
 * drops off edges.
 */
export function throwPath(f: Flight, bounce = 0.45): [number, number, number][] {
  const dt = 1 / 60;
  let [x, y, z, vx, vy, vz] = f;
  const out: [number, number, number][] = [[x, y, z]];
  const blocked = (px: number, pz: number, py: number) => {
    for (const k of OBSTACLES) {
      if (Math.abs(px - k.x) > k.w / 2 + 0.2 || Math.abs(pz - k.z) > k.d / 2 + 0.2) continue;
      if (py >= blockTop(k) - 0.02 || py + 0.4 <= k.y0) continue;
      return true; // inside the block's height band: a wall to this item
    }
    return false;
  };
  const supportAt = (px: number, pz: number, py: number) => {
    let g = 0;
    for (const k of OBSTACLES) {
      if (Math.abs(px - k.x) > k.w / 2 + 0.1 || Math.abs(pz - k.z) > k.d / 2 + 0.1) continue;
      const top = blockTop(k);
      if (top <= py + 0.3 && top > g) g = top;
    }
    return g;
  };
  for (let i = 0; i < 60 * 8; i++) {
    vy -= THROW_GRAVITY * dt;
    // each horizontal axis on its own, so it slides along a wall and bounces off it
    let nx = x + vx * dt;
    if (blocked(nx, z, y)) {
      nx = x;
      vx *= -0.4;
    }
    let nz = z + vz * dt;
    if (blocked(nx, nz, y)) {
      nz = z;
      vz *= -0.4;
    }
    x = nx;
    z = nz;
    y += vy * dt;
    const g = supportAt(x, z, y);
    if (y <= g) {
      y = g;
      if (vy < -1.6) {
        vy = -vy * bounce; // bounce
        vx *= 0.8;
        vz *= 0.8;
      } else {
        vy = 0;
        const decay = Math.exp(-2.6 * dt); // rolling friction
        vx *= decay;
        vz *= decay;
        if (Math.hypot(vx, vz) < 0.12) {
          out.push([x, y, z]);
          return out;
        }
      }
    }
    out.push([x, y, z]);
  }
  return out;
}

/**
 * Did this step of a path drop through the hoop's rim, from above? `a` and `b` are consecutive
 * samples. Every client runs this on the same path, so everyone sees the same shot score.
 */
export function throughHoop(a: [number, number, number], b: [number, number, number]): boolean {
  if (!(a[1] > HOOP.rimY && b[1] <= HOOP.rimY)) return false;
  const t = (a[1] - HOOP.rimY) / Math.max(1e-6, a[1] - b[1]);
  const x = a[0] + (b[0] - a[0]) * t;
  const z = a[2] + (b[2] - a[2]) * t;
  return Math.hypot(x - HOOP.x, z - HOOP.z) < HOOP.rimR - 0.04;
}

/** How bouncy each kind of item is (the fraction of speed it keeps off the ground). */
export const bounceFor = (kind: ItemKind): number => (kind === 'beachball' ? 0.82 : kind === 'basketball' ? 0.7 : kind === 'ball' ? 0.6 : 0.4);
