import { MAP_RADIUS } from './protocol';

/** Keep a point inside the circular arena (pulled straight back toward the centre). */
export function clampToArena(x: number, z: number, radius = MAP_RADIUS): { x: number; z: number } {
  const d = Math.hypot(x, z);
  if (d <= radius) return { x, z };
  const k = radius / d;
  return { x: x * k, z: z * k };
}
