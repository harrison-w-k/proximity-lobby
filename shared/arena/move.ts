// Movement rules shared by the server (authoritative) and the client (prediction).
import { DEEP_Y, MAP_RADIUS, THERMAL_CEILING, Terrain, WATER_Y } from './terrain';

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
  if (t.tarAt(x, z)) return { mul: 0.45, swim: false, shallow: false, noSprint: true }; // a tar pit drags at every step
  return { mul: t.tallGrass(x, z) ? 0.86 : 1, swim: false, shallow: false, noSprint: false };
}

/** The height an animal stands (or floats) at. */
export function standY(t: Terrain, x: number, z: number): number {
  return Math.max(t.heightAt(x, z), WATER_Y - 0.45);
}

/**
 * How an animal copes with steep ground (all in rise per metre of run; 1 is a 45 degree slope).
 * Past `ease` it slows down, at `limit` it cannot go up at all, and a drop steeper than `detach` throws it off the
 * ground so it falls (or glides, for a bird) instead of hugging the slope.
 */
export interface Slope {
  ease: number;
  limit: number;
  detach: number;
}

const SLOPE_BY_SIZE = { small: 1.05, medium: 0.9, large: 0.75 } as const;
/** Climbers: bugs, geckos and the more agile animals can go up what others cannot. */
const CLIMB: Record<string, number> = {
  ant: 3.2, spider: 3.2, tarantula: 3.0, black_widow: 3.2, scorpion: 2.6, deathstalker: 2.8, bombardier: 2.8, beetle: 2.4, hercules: 2.0, emperor_scorpion: 2.0,
  gecko: 3.2, monitor: 1.7, komodo: 1.4, cobra: 1.2, viper: 1.25, python: 1.1, croc: 0.7, tortoise: 0.55, snapping_turtle: 0.6, sea_turtle: 0.5,
  house_cat: 1.8, ocelot: 1.6, leopard: 1.7, snow_leopard: 1.7, panther: 1.5, lynx: 1.5, bobcat: 1.5, cheetah: 1.0, lion: 0.95, tiger: 0.85,
  weasel: 1.5, fisher: 1.6, wolverine: 1.5, tayra: 1.6, badger: 0.85, honey_badger: 1.1, raccoon: 1.5, black_bear: 1.0, sun_bear: 1.0, moon_bear: 1.0, panda: 0.85,
  mudskipper: 1.2,
};
const slopes = new Map<string, Slope>();
export const DEFAULT_SLOPE: Slope = { ease: 0.35, limit: 0.9, detach: 1.05 };

export function slopeFor(def: { id: string; tree: string; size: string }): Slope {
  let s = slopes.get(def.id);
  if (!s) {
    const limit = CLIMB[def.id] ?? (def.tree === 'fish' ? 0.45 : (SLOPE_BY_SIZE as Record<string, number>)[def.size] ?? 0.9);
    const clings = limit >= 1.4; // a real climber grips the rock and never drops off it
    s = {
      ease: 0.35 + Math.max(0, limit - 0.9) * 0.3,
      limit,
      detach: clings ? 99 : def.tree === 'birds' ? 0.7 : limit + 0.15, // birds spring off a ledge and glide
    };
    slopes.set(def.id, s);
  }
  return s;
}

/**
 * Move a circle `dist` metres along (dx, dz), sliding along trees, rocks and cliffs.
 * Writes the result into `p`. Returns true if it moved at all.
 */
export function stepPos(t: Terrain, p: { x: number; z: number; jy?: number; jv?: number; land?: number }, dx: number, dz: number, dist: number, radius: number, bound: Bound = MAP_BOUND, feet = 0, rule: Slope = DEFAULT_SLOPE): boolean {
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
    const h0 = t.heightAt(p.x, p.z);
    let rise = t.heightAt(nx, nz) - h0;
    const hor0 = Math.max(0.05, Math.hypot(nx - p.x, nz - p.z));
    const low = feet < 0.4; // off the ground (a jump, a glide) you are not climbing
    if (low && rise > rule.limit * hor0 + 0.05) return false; // too steep to go up
    if (low && rise > 0) {
      // climbing is slow work: the steeper it gets, the shorter each step
      const g = rise / hor0;
      if (g > rule.ease) {
        const k = 1 - 0.65 * Math.min(1, (g - rule.ease) / Math.max(0.1, rule.limit - rule.ease));
        nx = p.x + (nx - p.x) * k;
        nz = p.z + (nz - p.z) * k;
        rise = t.heightAt(nx, nz) - h0;
      }
    }
    // stay inside the bound
    const bx = nx - bound.cx;
    const bz = nz - bound.cz;
    const bd = Math.hypot(bx, bz);
    if (bd > bound.r) {
      nx = bound.cx + (bx / bd) * bound.r;
      nz = bound.cz + (bz / bd) * bound.r;
    }
    const hor = Math.hypot(nx - p.x, nz - p.z);
    const moved = hor > 1e-4;
    p.x = nx;
    p.z = nz;
    if (p.jy !== undefined && moved) {
      // the ground moves under you: attached to it on a slope you can hold, but a drop that is too steep leaves you
      // in the air (to fall, or glide), and while airborne you keep your height whatever the ground does below
      const dh = t.heightAt(nx, nz) - h0;
      const floor = t.floorAt(nx, nz, p.jy);
      const grounded = p.jy <= floor + 0.001 && (p.jv ?? 0) <= 0.001;
      if (grounded) {
        if (-dh > rule.detach * hor && hor > 0.02) {
          p.jy = floor - dh;
          p.jv = Math.min(p.jv ?? 0, 0);
        }
      } else {
        p.jy -= dh;
        if (p.jy < floor) {
          if ((p.jv ?? 0) < 0) p.land = -(p.jv ?? 0); // ran into rising ground while falling
          p.jy = floor;
        }
      }
    }
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
/** A bird that is falling more than this far above the ground (after a jump, or off a ledge, rock or roof) spreads its wings and glides down. */
export const GLIDE_DROP = 0.4; // m above the ground below
export const glideFall = (bird: boolean, jy: number, jv: number, floor: number) => bird && jv <= 0 && jy > floor + GLIDE_DROP;

/**
 * Advance the vertical motion of a jump. `jy` is the height above the ground, `floor` the top of the rock you are over
 * (0 on the bare ground): you stand on it, land on it, and fall when you walk off it.
 */
export function stepVertical(s: { jy: number; jv: number; land?: number }, dt: number, floor = 0, glide = false, wings = false) {
  if (s.jy <= floor + 1e-3 && s.jv <= 0) {
    if (s.jv < -1 && !wings) s.land = -s.jv; // how hard it came down, for fall damage
    s.jy = floor;
    s.jv = 0;
    return;
  }
  if (!wings) s.jv -= GRAVITY * dt; // wings out: glideTick set the vertical speed
  if (glide && s.jv < -SOAR_FALL) s.jv = -SOAR_FALL; // gliding: wings out, so the fall is slow
  s.jy += s.jv * dt;
  if (s.jy <= floor && s.jv <= 0) {
    if (s.jv < -1 && !wings) s.land = -s.jv; // a glider lands softly
    s.jy = floor;
    s.jv = 0;
  }
}

// Elytra-style gliding: the camera pitch is the wing angle. Diving trades height for speed, pulling up trades speed for
// height, and a shallow glide slowly bleeds speed. There is no crash damage while the wings are out.
export const GLIDE_MIN = 9; // m/s: slowest forward speed
export const GLIDE_TOP = 40; // m/s: terminal dive speed
export const GLIDE_START = 15; // m/s when the wings open
export const GLIDE_REST_PITCH = 0.3; // camera pitch (rad) that flies level-ish
export const GLIDE_DRAG = 0.011;
export const GLIDE_PULL = 20; // m/s² of speed gained or lost per unit of pitch

/** The wing angle (rad, positive = nose down) for a camera pitch. */
export const glideAngle = (camPitch: number) => Math.max(-0.75, Math.min(1.2, camPitch - GLIDE_REST_PITCH));

/**
 * One tick of an elytra glide: updates the speed `gs` and the vertical speed `jv`, and returns the forward speed (m/s).
 * `open` is the speed the wings open at when this is the first tick.
 */
export function glideTick(s: { jv: number; gs?: number }, camPitch: number, dt: number, open = GLIDE_START): number {
  const a = glideAngle(camPitch);
  let gs = s.gs && s.gs > 0 ? s.gs : open;
  gs += (GLIDE_PULL * Math.sin(a) - GLIDE_DRAG * gs * gs) * dt;
  gs = Math.max(GLIDE_MIN, Math.min(GLIDE_TOP, gs));
  s.gs = gs;
  const sink = 1.1 + Math.max(0, 14 - gs) * 0.25; // slow wings drop
  s.jv = Math.max(-45, Math.min(20, -gs * Math.sin(a) - sink));
  return gs * Math.cos(a);
}

/** Over an updraft a glider is carried up (the lift is re-applied each tick, since gravity pulls it back). */
export function thermalLift(t: Terrain, s: { x: number; z: number; jy: number; jv: number }, floor: number, able: boolean) {
  if (!able || s.jy < floor + 0.3 || s.jy - floor > THERMAL_CEILING) return;
  const l = t.liftAt(s.x, s.z);
  if (l > 0) s.jv = Math.max(s.jv, l);
}

/** A landing faster than this (about a 7 m drop) hurts. */
export const FALL_SAFE = 18.5;
/** The share of max health a landing at `v` m/s takes: nothing when safe, about a tenth from 10 m, a quarter from 15 m, and at most 60%. */
export const fallDamage = (v: number) => (v <= FALL_SAFE ? 0 : Math.min(0.6, 0.03 * (v - FALL_SAFE)));
