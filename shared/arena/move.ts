// Movement rules shared by the server (authoritative) and the client (prediction).
import { DEEP_Y, MAP_RADIUS, Terrain, WATER_Y } from './terrain';

export const GULAG_X = 1500; // the Gulag arenas sit far outside the map, on flat ground
export const GULAG_R = 24;
export const PEN_Z = 0; // the holding pen centre is (GULAG_X - 70, PEN_Z)
export const PEN_R = 20;

export interface Bound {
  cx: number;
  cz: number;
  r: number;
}
export const MAP_BOUND: Bound = { cx: 0, cz: 0, r: MAP_RADIUS - 2 };

export const inGulagZone = (x: number) => x > GULAG_X - 400;

export interface Medium {
  mul: number; // speed multiplier from the terrain
  swim: boolean;
  shallow: boolean;
  noSprint: boolean;
}

/** How the ground under a point changes your speed. */
export function medium(t: Terrain, x: number, z: number, aquatic: boolean, waterSpeed: number): Medium {
  if (inGulagZone(x)) return { mul: 1, swim: false, shallow: false, noSprint: false };
  const h = t.heightAt(x, z);
  if (h < DEEP_Y) {
    return { mul: aquatic ? 1.25 + waterSpeed : 0.5 + waterSpeed * 0.5, swim: true, shallow: false, noSprint: !aquatic };
  }
  if (h < WATER_Y - 0.1) {
    return { mul: aquatic ? 1.15 + waterSpeed * 0.7 : 0.72 + waterSpeed * 0.3, swim: false, shallow: true, noSprint: false };
  }
  return { mul: t.tallGrass(x, z) ? 0.86 : 1, swim: false, shallow: false, noSprint: false };
}

/** The height an animal stands (or floats) at. */
export function standY(t: Terrain, x: number, z: number): number {
  if (inGulagZone(x)) return 0;
  return Math.max(t.heightAt(x, z), WATER_Y - 0.45);
}

const MAX_SLOPE = 1.5; // rise per metre you can walk up

/**
 * Move a circle `dist` metres along (dx, dz), sliding along trees, rocks and cliffs.
 * Writes the result into `p`. Returns true if it moved at all.
 */
export function stepPos(t: Terrain, p: { x: number; z: number }, dx: number, dz: number, dist: number, radius: number, bound: Bound = MAP_BOUND): boolean {
  const len = Math.hypot(dx, dz);
  if (len < 1e-6 || dist <= 0) return false;
  const ux = dx / len;
  const uz = dz / len;
  const tryMove = (mx: number, mz: number, d: number): boolean => {
    let nx = p.x + mx * d;
    let nz = p.z + mz * d;
    if (!inGulagZone(nx)) {
      const c = t.collide(nx, nz, radius);
      nx = c.x;
      nz = c.z;
      const rise = t.heightAt(nx, nz) - t.heightAt(p.x, p.z);
      if (rise > MAX_SLOPE * Math.max(0.05, Math.hypot(nx - p.x, nz - p.z)) + 0.05) return false;
    }
    // stay inside the bound
    const bx = nx - bound.cx;
    const bz = nz - bound.cz;
    const bd = Math.hypot(bx, bz);
    if (bd > bound.r) {
      nx = bound.cx + (bx / bd) * bound.r;
      nz = bound.cz + (bz / bd) * bound.r;
    }
    const moved = Math.hypot(nx - p.x, nz - p.z) > 1e-4;
    p.x = nx;
    p.z = nz;
    return moved;
  };
  // sub-step so a fast dash cannot skip through a tree
  const steps = Math.max(1, Math.ceil(dist / 0.5));
  let any = false;
  for (let i = 0; i < steps; i++) {
    const d = dist / steps;
    if (tryMove(ux, uz, d)) any = true;
    else if (tryMove(Math.sign(ux), 0, d * Math.abs(ux)) || tryMove(0, Math.sign(uz), d * Math.abs(uz))) any = true;
    else break;
  }
  return any;
}
