// Things to do on the island besides the obstacle course: bounce pads, bullseye targets to hit
// with thrown items, and coins to collect. Positions are fixed so every client agrees.
import { OBSTACLES, blockTop } from './obstacles';

export interface Pad {
  x: number;
  z: number;
  r: number;
}

export const PAD_SPEED = 14; // m/s upward: a big bounce, about 4.5 m
export const PADS: Pad[] = [
  { x: -6, z: -4, r: 0.95 },
  { x: 3, z: -12, r: 0.95 },
  { x: 18, z: 6, r: 0.95 },
];

export function padAt(x: number, z: number): Pad | null {
  for (const p of PADS) if (Math.hypot(x - p.x, z - p.z) < p.r) return p;
  return null;
}

export interface Target {
  x: number;
  y: number;
  z: number;
  r: number;
}

export const TARGETS: Target[] = [
  { x: -16, y: 2.3, z: -14, r: 0.6 },
  { x: 20, y: 1.9, z: -2, r: 0.6 },
  { x: 4, y: 2.7, z: -18, r: 0.6 },
  { x: -22, y: 2.1, z: -2, r: 0.6 },
];
export const TARGET_POINTS = 5;

/** The index of the target the segment a -> b passes through, or -1. */
export function targetHit(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < TARGETS.length; i++) {
    const t = TARGETS[i];
    // nearest point on the segment to the target's centre
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len2 = dx * dx + dy * dy + dz * dz || 1e-9;
    const u = Math.max(0, Math.min(1, ((t.x - a[0]) * dx + (t.y - a[1]) * dy + (t.z - a[2]) * dz) / len2));
    const d = Math.hypot(a[0] + dx * u - t.x, a[1] + dy * u - t.y, a[2] + dz * u - t.z);
    if (d < t.r + 0.18) return i;
  }
  return -1;
}

export interface Coin {
  x: number;
  y: number;
  z: number;
  v: number; // points
}

/** A coin hovering above the block at (x, z), if there is one there. */
const onTop = (x: number, z: number, v: number): Coin | null => {
  const k = OBSTACLES.find((o) => Math.abs(o.x - x) < 0.01 && Math.abs(o.z - z) < 0.01);
  return k ? { x: k.x, y: blockTop(k) + 0.85, z: k.z, v } : null;
};

export const COINS: Coin[] = [
  // across the open grass: easy ones
  { x: 8, y: 0.9, z: 11, v: 1 },
  { x: -2, y: 0.9, z: 9, v: 1 },
  { x: -10, y: 0.9, z: -8, v: 1 },
  { x: 14, y: 0.9, z: -14, v: 1 },
  { x: -18, y: 0.9, z: 2, v: 1 },
  // above each bounce pad: reach them with the bounce
  ...PADS.map((p): Coin => ({ x: p.x, y: 4.4, z: p.z, v: 2 })),
  // up the obby: worth more the higher you get
  ...[
    onTop(21.5, -9, 2),
    onTop(23.6, -14, 2),
    onTop(18, -17.2, 2),
    onTop(10.5, -21.2, 3),
    onTop(1, -19.5, 3),
    onTop(-8.4, -14.9, 4),
    onTop(-13.1, -12.6, 4),
    onTop(-18.5, -10.5, 5),
    onTop(-22.5, -9, 6),
    onTop(-26, -9.5, 10),
  ].filter((c): c is Coin => !!c),
];
export const COIN_RESPAWN = 25; // seconds before a collected coin comes back
