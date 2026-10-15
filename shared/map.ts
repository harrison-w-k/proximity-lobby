import { MAP_RADIUS } from './protocol';

/** Where the sand ends and the sea begins, measured from the centre (m). */
export const SHORE_RADIUS = MAP_RADIUS + 7;
/** How far down the feet rest when fully in the water (m). */
export const WADE_DEPTH = 1.05;

/** 0 on the island and beach, easing to 1 four metres into the water. */
export function waterDepth(x: number, z: number): number {
  const t = Math.min(1, Math.max(0, (Math.hypot(x, z) - SHORE_RADIUS) / 4));
  return t * t * (3 - 2 * t);
}

/** Keep a point inside the circular arena (pulled straight back toward the centre). */
export function clampToArena(x: number, z: number, radius = MAP_RADIUS): { x: number; z: number } {
  const d = Math.hypot(x, z);
  if (d <= radius) return { x, z };
  const k = radius / d;
  return { x: x * k, z: z * k };
}
