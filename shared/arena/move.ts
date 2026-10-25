// Movement rules shared by the server (authoritative) and the client (prediction).
import { DEEP_Y, MAP_RADIUS, Terrain, WATER_Y } from './terrain';

export interface Bound {
  cx: number;
  cz: number;
  r: number;
}
export const MAP_BOUND: Bound = { cx: 0, cz: 0, r: MAP_RADIUS - 2 };
/** The lobby island and a stretch of sea round it. */
export const ISLAND_BOUND: Bound = { cx: 0, cz: 0, r: 64 };

export interface Medium {
  mul: number; // speed multiplier from the terrain
  swim: boolean;
  shallow: boolean;
  noSprint: boolean;
}

/** How the ground under a point changes your speed. */
export function medium(t: Terrain, x: number, z: number, aquatic: boolean, waterSpeed: number): Medium {
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
  return Math.max(t.heightAt(x, z), WATER_Y - 0.45);
}

const MAX_SLOPE = 1.5; // rise per metre you can walk up

/**
 * Move a circle `dist` metres along (dx, dz), sliding along trees, rocks and cliffs.
 * Writes the result into `p`. Returns true if it moved at all.
 */
export function stepPos(t: Terrain, p: { x: number; z: number }, dx: number, dz: number, dist: number, radius: number, bound: Bound = MAP_BOUND, feet = 0): boolean {
  const len = Math.hypot(dx, dz);
  if (len < 1e-6 || dist <= 0) return false;
  const ux = dx / len;
  const uz = dz / len;
  const tryMove = (mx: number, mz: number, d: number): boolean => {
    let nx = p.x + mx * d;
    let nz = p.z + mz * d;
    const c = t.collide(nx, nz, radius, feet);
    nx = c.x;
    nz = c.z;
    const rise = t.heightAt(nx, nz) - t.heightAt(p.x, p.z);
    if (rise > MAX_SLOPE * Math.max(0.05, Math.hypot(nx - p.x, nz - p.z)) + 0.05) return false;
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

// --- jumping ----------------------------------------------------------------------------------

export const JUMP_V = 8.8; // m/s upward: about 1.6 m high, a bit under 0.75 s in the air
export const GRAVITY = 24;
export const JUMP_COST = 8; // stamina
/** A bird's soar: the fall is capped at this speed while it glides, and it moves this much faster than on the ground. */
export const SOAR_FALL = 1.5; // m/s
export const SOAR_SPEED = 1.5;
/** A bird that drops further than a jump can reach (a ledge, a rock, a roof) spreads its wings and glides down. */
export const GLIDE_DROP = 1.8; // m above the ground below
export const glideFall = (bird: boolean, jy: number, jv: number, floor: number) => bird && jv <= 0 && jy > floor + GLIDE_DROP;

/**
 * Advance the vertical motion of a jump. `jy` is the height above the ground, `floor` the top of the rock you are over
 * (0 on the bare ground): you stand on it, land on it, and fall when you walk off it.
 */
export function stepVertical(s: { jy: number; jv: number }, dt: number, floor = 0, glide = false) {
  if (s.jy <= floor + 1e-3 && s.jv <= 0) {
    s.jy = floor;
    s.jv = 0;
    return;
  }
  s.jv -= GRAVITY * dt;
  if (glide && s.jv < -SOAR_FALL) s.jv = -SOAR_FALL; // gliding: wings out, so the fall is slow
  s.jy += s.jv * dt;
  if (s.jy <= floor && s.jv <= 0) {
    s.jy = floor;
    s.jv = 0;
  }
}
