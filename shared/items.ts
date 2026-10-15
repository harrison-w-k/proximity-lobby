import { OBSTACLES, blockTop } from './obstacles';

// Little objects you can pick up with a click and carry. The server owns who holds what; every
// client draws the same set, so everyone sees the same things sitting about and being carried.

export type ItemKind = 'ball' | 'crate' | 'cone' | 'duck' | 'fish';

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
  { id: 0, kind: 'ball', x: 4, y: 0, z: 3 },
  { id: 1, kind: 'duck', x: -4, y: 0, z: 3.5 },
  { id: 2, kind: 'crate', x: 3, y: 0, z: -4 },
  { id: 3, kind: 'cone', x: -3, y: 0, z: -5 },
  { id: 4, kind: 'fish', x: 0, y: 0, z: 7 },
  { id: 5, kind: 'ball', x: 9, y: 0, z: 3 },
  { id: 6, kind: 'duck', x: -9, y: 0, z: -3 },
  { id: 7, kind: 'cone', x: 6, y: 0, z: 10 },
  { id: 8, kind: 'fish', x: -6, y: 0, z: -10 },
  { id: 9, kind: 'ball', x: -2, y: 0, z: -12 },
  { id: 10, kind: 'crate', x: 8, y: 0, z: 16 },
  { id: 11, kind: 'duck', x: 1, y: 0, z: -15 },
  { id: 12, kind: 'fish', x: 13, y: 0, z: 9 },
  { id: 13, kind: 'cone', x: -1, y: 0, z: 14 },
];

// ---- throwing ----
export const THROW_GRAVITY = 18;
export const THROW_MAX_SPEED = 14;

/** [x, y, z, vx, vy, vz] of a throw, at the moment it leaves the hand. */
export type Flight = [number, number, number, number, number, number];

/**
 * The path of a thrown item, one point per 1/60 s, ending where it comes to rest. The server uses
 * the last point and every client plays the same path back, so everyone sees the same throw.
 * It stops against walls and lands on the highest block top beneath it (or the ground).
 */
export function throwPath(f: Flight): [number, number, number][] {
  const dt = 1 / 60;
  let [x, y, z, vx, vy, vz] = f;
  const out: [number, number, number][] = [[x, y, z]];
  for (let i = 0; i < 60 * 5; i++) {
    vy -= THROW_GRAVITY * dt;
    let nx = x + vx * dt;
    let nz = z + vz * dt;
    const ny = y + vy * dt;
    for (const k of OBSTACLES) {
      if (Math.abs(nx - k.x) > k.w / 2 + 0.2 || Math.abs(nz - k.z) > k.d / 2 + 0.2) continue;
      if (ny >= blockTop(k) || ny + 0.4 <= k.y0) continue;
      // inside the block's height band but outside its top: it hits the side and drops
      nx = x;
      nz = z;
      vx *= -0.1;
      vz *= -0.1;
    }
    x = nx;
    z = nz;
    y = ny;
    if (vy < 0) {
      let g = 0;
      for (const k of OBSTACLES) {
        if (Math.abs(x - k.x) > k.w / 2 + 0.1 || Math.abs(z - k.z) > k.d / 2 + 0.1) continue;
        const top = blockTop(k);
        if (top <= y + 0.3 && top > g) g = top;
      }
      if (y <= g) {
        out.push([x, g, z]);
        return out;
      }
    }
    out.push([x, y, z]);
  }
  return out;
}
