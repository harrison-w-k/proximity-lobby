// The player controller, as a pure step function: walking, wading, jumping, crouching, sliding,
// ledge grabbing, mantling and vaulting. The client steps it every frame; the tests step it in
// Node, so every mechanic (and the parkour course itself) is verified without a browser.
import { OBSTACLES, blockTop, closestPoint, footprintDistance, type Block } from './obstacles';
import { WADE_DEPTH, waterDepth } from './map';
import { SWIM_LIMIT } from './protocol';

export const BODY_RADIUS = 0.4;
export const EYE_STAND = 1.6;
export const EYE_CROUCH = 1.0;
export const EYE_SLIDE = 0.7;

export const WALK_SPEED = 5;
export const SPRINT_SPEED = 9;
export const CROUCH_SPEED = 2.5;
export const GRAVITY = 22; // m/s^2
export const JUMP_SPEED = 7.5; // m/s => about 1.3 m
const GROUND_ACCEL = 13; // snappy: you reach full speed in about a quarter of a second
const GROUND_DECEL = 17; // ...and stop just as quickly, with a small slide
const AIR_ACCEL = 4.5; // real air control, so you can correct a jump

// "Game feel" forgiveness
const COYOTE_TIME = 0.12; // you can still jump this long after running off an edge
const JUMP_BUFFER = 0.14; // a jump pressed this early before landing still counts
const JUMP_CUT = 0.5; // letting go of jump early cuts the rise: tap = hop, hold = full jump

// Body heights used for collision
const STAND_H = 1.8;
const CROUCH_H = 1.2;
const SLIDE_H = 0.8;
const STEP = 0.45; // ledges this low are simply stepped onto

// Sliding
const SLIDE_MIN_SPEED = 5.5; // you must already be running
const SLIDE_SPEED = 10.5;
const SLIDE_FRICTION = 1.3; // 1/s: a slide carries you about 5-6 m
const SLIDE_END_SPEED = 3.0;
const SLIDE_MAX_TIME = 1.2;

// Ledges
const GRAB_MIN = 0.6; // a ledge must be at least this far above your feet to be worth hanging from
const GRAB_MAX = STAND_H + 0.25; // ...and no higher than your hands can reach
const VAULT_MIN = STEP;
const VAULT_MAX = 1.5; // from the ground, jump / grab next to a wall mantles anything up to this
const HANG_DROP = 1.75; // feet hang this far below the ledge, so the hands are on it
const SHIMMY_SPEED = 1.8; // m/s sideways along a ledge
const GRAB_ENTER = 0.16; // seconds to ease from where you were into the hang
const PULL_UP_HOLD = 0.45; // hold forward this long to pull up without pressing jump
const MANTLE_TIME = 0.5;
const VAULT_TIME = 0.3;

export interface Mantle {
  t: number;
  dur: number;
  x0: number;
  z0: number;
  y0: number;
  x1: number;
  z1: number;
  y1: number;
}

export interface Sim {
  x: number;
  z: number;
  y: number; // feet
  vx: number;
  vy: number;
  vz: number;
  eye: number; // eased eye height
  crouching: boolean;
  sliding: boolean;
  slideTime: number;
  hanging: boolean;
  hangTime: number;
  hangNx: number; // wall normal, pointing from the wall toward the player
  hangNz: number;
  hangTop: number;
  hangX: number; // the block we are hanging from (its centre), for the mantle target
  hangZ: number;
  hangFromX: number; // where the catch started, so we can ease into the hang
  hangFromY: number;
  hangFromZ: number;
  hangToX: number;
  hangToZ: number;
  grabCooldown: number;
  mantle: Mantle | null;
  onGround: boolean;
  coyote: number; // seconds of "still counts as grounded" left
  jumpBuffer: number; // seconds a pressed jump stays queued
  jumpCut: boolean;
  ragdoll: boolean; // knocked down: no control, and it slides and tumbles with little friction
  landImpact: number; // downward speed of the last hard landing, for the camera and sound; the reader resets it
}

export interface Input {
  f: number; // forward (+1) / back (-1)
  s: number; // strafe right (+1) / left (-1)
  yaw: number;
  jump: boolean; // held
  jumpPressed: boolean; // went down this frame
  crouch: boolean; // held
  crouchPressed: boolean; // went down this frame
  sprint: boolean; // held
  grab: boolean; // held: the intentional "catch the ledge" button
  grabPressed: boolean; // went down this frame
}

export const noInput = (yaw = 0): Input => ({
  f: 0,
  s: 0,
  yaw,
  jump: false,
  jumpPressed: false,
  crouch: false,
  crouchPressed: false,
  sprint: false,
  grab: false,
  grabPressed: false,
});

export function newSim(x = 0, z = 0): Sim {
  return {
    x,
    z,
    y: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    eye: EYE_STAND,
    crouching: false,
    sliding: false,
    slideTime: 0,
    hanging: false,
    hangTime: 0,
    hangNx: 0,
    hangNz: 0,
    hangTop: 0,
    hangX: 0,
    hangZ: 0,
    hangFromX: 0,
    hangFromY: 0,
    hangFromZ: 0,
    hangToX: 0,
    hangToZ: 0,
    grabCooldown: 0,
    mantle: null,
    onGround: true,
    coyote: 0,
    jumpBuffer: 0,
    jumpCut: false,
    ragdoll: false,
    landImpact: 0,
  };
}

const bodyHeight = (p: Sim) => (p.sliding ? SLIDE_H : p.crouching ? CROUCH_H : STAND_H);
const horizSpeed = (p: Sim) => Math.hypot(p.vx, p.vz);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
const easeOut = (v: number) => 1 - (1 - clamp01(v)) ** 3;

/** Highest block top you could be standing on at (x, z), given where your feet are. */
function supportTop(blocks: Block[], x: number, z: number, feet: number): number {
  let best = -Infinity;
  for (const k of blocks) {
    const t = blockTop(k);
    if (t > feet + STEP + 1e-6) continue; // too high to step onto
    if (footprintDistance(k, x, z) < BODY_RADIUS * 0.85) best = Math.max(best, t);
  }
  return best;
}

/** Would a body of this height at (x, z) be inside something? Used for "can I stand up here?". */
function blockedAt(blocks: Block[], x: number, z: number, feet: number, height: number): boolean {
  for (const k of blocks) {
    if (feet >= blockTop(k) - STEP) continue;
    if (feet + height <= k.y0) continue;
    if (footprintDistance(k, x, z) < BODY_RADIUS * 0.99) return true;
  }
  return false;
}

/** Push the body circle out of every block that is in its way at this height. */
function resolveHorizontal(blocks: Block[], x: number, z: number, feet: number, height: number): { x: number; z: number } {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const k of blocks) {
      if (feet >= blockTop(k) - STEP) continue; // steppable or standable: not a wall to us
      if (feet + height <= k.y0) continue; // we fit underneath
      const c = closestPoint(k, x, z);
      const dx = x - c.x;
      const dz = z - c.z;
      const d = Math.hypot(dx, dz);
      if (d >= BODY_RADIUS) continue;
      if (d > 1e-6) {
        const pen = BODY_RADIUS - d;
        x += (dx / d) * pen;
        z += (dz / d) * pen;
      } else {
        // centre is inside the box: leave by the nearest face
        const toL = x - (k.x - k.w / 2);
        const toR = k.x + k.w / 2 - x;
        const toB = z - (k.z - k.d / 2);
        const toF = k.z + k.d / 2 - z;
        const m = Math.min(toL, toR, toB, toF);
        if (m === toL) x = k.x - k.w / 2 - BODY_RADIUS;
        else if (m === toR) x = k.x + k.w / 2 + BODY_RADIUS;
        else if (m === toB) z = k.z - k.d / 2 - BODY_RADIUS;
        else z = k.z + k.d / 2 + BODY_RADIUS;
      }
      moved = true;
    }
    if (!moved) break;
  }
  return { x, z };
}

/**
 * The wall (if any) in the direction the player is trying to go, within about 0.7 m of the body.
 * The reach is generous on purpose: vaults and ledge grabs should trigger when you are *close*,
 * not only when you are pressed flat against the surface.
 */
function wallAhead(
  blocks: Block[],
  x: number,
  z: number,
  dirx: number,
  dirz: number,
  feet: number,
  height: number,
): { block: Block; nx: number; nz: number; cx: number; cz: number } | null {
  if (Math.hypot(dirx, dirz) < 1e-6) return null;
  let best: { block: Block; nx: number; nz: number; cx: number; cz: number } | null = null;
  let bestD = Infinity;
  for (const k of blocks) {
    if (feet + height <= k.y0) continue; // passes under it
    if (blockTop(k) <= feet + STEP) continue; // steppable
    let onLine = false;
    for (const reach of [0.2, 0.45, 0.7]) {
      const px = x + dirx * (BODY_RADIUS + reach);
      const pz = z + dirz * (BODY_RADIUS + reach);
      if (footprintDistance(k, px, pz) <= 0.02) {
        onLine = true;
        break;
      }
    }
    if (!onLine) continue;
    const c = closestPoint(k, x, z);
    const dx = x - c.x;
    const dz = z - c.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) continue;
    if (d < bestD) {
      bestD = d;
      best = { block: k, nx: dx / d, nz: dz / d, cx: c.x, cz: c.z };
    }
  }
  return best && bestD < BODY_RADIUS + 0.75 ? best : null;
}

function startMantle(p: Sim, k: Block, nx: number, nz: number, dur: number) {
  // land well inside the block's top, even on a narrow plank
  const inX = Math.max(0, k.w / 2 - 0.2);
  const inZ = Math.max(0, k.d / 2 - 0.2);
  const tx = Math.max(k.x - inX, Math.min(k.x + inX, p.x - nx * 0.55));
  const tz = Math.max(k.z - inZ, Math.min(k.z + inZ, p.z - nz * 0.55));
  p.mantle = { t: 0, dur, x0: p.x, z0: p.z, y0: p.y, x1: tx, z1: tz, y1: blockTop(k) };
  p.hanging = false;
  p.vx = p.vy = p.vz = 0;
  p.sliding = false;
}

/** Advance the player by dt seconds. Returns whether they drifted past the swim limit. */
export function stepPlayer(p: Sim, inp: Input, dt: number, blocks: Block[] = OBSTACLES): { sentHome: boolean } {
  const depth = waterDepth(p.x, p.z);
  const waterGround = -WADE_DEPTH * depth;
  const k1 = 1 - Math.exp(-14 * dt);
  p.grabCooldown = Math.max(0, p.grabCooldown - dt);

  // ---- mid-mantle: a scripted climb. The hands push up first, then the body rolls over the edge ----
  if (p.mantle) {
    const m = p.mantle;
    m.t += dt;
    const k = Math.min(1, m.t / m.dur);
    p.y = m.y0 + (m.y1 - m.y0) * easeOut(k / 0.7);
    const over = smooth((k - 0.3) / 0.7);
    p.x = m.x0 + (m.x1 - m.x0) * over;
    p.z = m.z0 + (m.z1 - m.z0) * over;
    p.eye += (EYE_STAND - p.eye) * k1;
    if (k >= 1) {
      p.mantle = null;
      p.onGround = true;
      p.vx = p.vy = p.vz = 0;
      p.coyote = COYOTE_TIME;
    }
    return { sentHome: false };
  }

  // ---- hanging from a ledge: held while the grab button is held ----
  if (p.hanging) {
    p.hangTime += dt;
    p.vx = p.vy = p.vz = 0;
    // ease from where the catch happened into the hang pose, instead of snapping
    const e = easeOut(p.hangTime / GRAB_ENTER);
    p.x = p.hangFromX + (p.hangToX - p.hangFromX) * e;
    p.z = p.hangFromZ + (p.hangToZ - p.hangFromZ) * e;
    p.y = p.hangFromY + (p.hangTop - HANG_DROP - p.hangFromY) * e;
    p.eye += (EYE_STAND - p.eye) * k1;

    const settled = p.hangTime > 0.1;

    // shimmy sideways along the ledge with the strafe keys
    if (settled && inp.s !== 0) {
      const blk = blocks.find((k) => k.x === p.hangX && k.z === p.hangZ && blockTop(k) === p.hangTop);
      if (blk) {
        // the strafe direction in the world, projected on the line of the ledge (perpendicular to the wall)
        const tx = -p.hangNz;
        const tz = p.hangNx;
        const along = (Math.cos(inp.yaw) * tx + -Math.sin(inp.yaw) * tz) * Math.sign(inp.s);
        const dir = Math.abs(along) < 0.2 ? 0 : Math.sign(along);
        const step = dir * SHIMMY_SPEED * dt;
        const edge = 0.15;
        const nx2 = Math.max(blk.x - blk.w / 2 + edge, Math.min(blk.x + blk.w / 2 - edge, p.hangToX + tx * step));
        const nz2 = Math.max(blk.z - blk.d / 2 + edge, Math.min(blk.z + blk.d / 2 - edge, p.hangToZ + tz * step));
        // the wall-hugging offset only applies off the wall's axis; keep the distance from the face
        if (Math.abs(p.hangNx) < 0.5) p.hangToX = nx2;
        else p.hangToZ = nz2;
        p.x = p.hangToX;
        p.z = p.hangToZ;
      }
    }
    const climb = settled && (inp.jumpPressed || (inp.f > 0.5 && p.hangTime > PULL_UP_HOLD));
    const letGo = (settled && !inp.grab) || inp.crouchPressed || inp.f < -0.5;
    if (climb) {
      const target = blocks.find((k) => k.x === p.hangX && k.z === p.hangZ && blockTop(k) === p.hangTop);
      if (target) startMantle(p, target, p.hangNx, p.hangNz, MANTLE_TIME);
      else p.hanging = false;
    } else if (letGo) {
      p.hanging = false;
      p.vx = p.hangNx * 1.5; // a small push off the wall
      p.vz = p.hangNz * 1.5;
      p.grabCooldown = 0.3;
    }
    return { sentHome: false };
  }

  // ---- wish direction (and the facing direction, for grabs without a move key) ----
  const sin = Math.sin(inp.yaw);
  const cos = Math.cos(inp.yaw);
  let f = inp.f;
  let s = inp.s;
  const wantsMove = f !== 0 || s !== 0;
  let wx = 0;
  let wz = 0;
  if (wantsMove) {
    const len = Math.hypot(f, s);
    f /= len;
    s /= len;
    wx = -sin * f + cos * s;
    wz = -cos * f - sin * s;
  }
  const aimX = wantsMove ? wx : -sin;
  const aimZ = wantsMove ? wz : -cos;

  const supp = supportTop(blocks, p.x, p.z, p.y);
  const ground = Math.max(waterGround, supp);
  const grounded = p.y <= ground + 1e-3 && p.vy <= 0;
  p.onGround = grounded;
  if (grounded) {
    p.coyote = COYOTE_TIME;
    p.jumpCut = false;
  } else {
    p.coyote = Math.max(0, p.coyote - dt);
  }
  p.jumpBuffer = inp.jumpPressed ? JUMP_BUFFER : Math.max(0, p.jumpBuffer - dt);

  // ---- crouch / slide state ----
  if (grounded && !p.sliding && inp.crouchPressed && inp.sprint && inp.f > 0.3 && horizSpeed(p) >= SLIDE_MIN_SPEED) {
    p.sliding = true;
    p.slideTime = 0;
    const sp = Math.max(horizSpeed(p), SLIDE_SPEED);
    p.vx = wx * sp;
    p.vz = wz * sp;
  }
  if (p.sliding) {
    p.slideTime += dt;
    const speed = horizSpeed(p);
    const over = p.slideTime > SLIDE_MAX_TIME || speed < SLIDE_END_SPEED || !grounded;
    const jumpOut = grounded && inp.jumpPressed;
    if (over || jumpOut) {
      // you can only stop sliding where you can actually fit
      if (blockedAt(blocks, p.x, p.z, p.y, CROUCH_H) && !jumpOut) {
        const sp = Math.max(CROUCH_SPEED + 0.5, speed);
        if (speed > 1e-3) {
          p.vx = (p.vx / speed) * sp;
          p.vz = (p.vz / speed) * sp;
        } else if (wantsMove) {
          p.vx = wx * sp;
          p.vz = wz * sp;
        }
      } else {
        p.sliding = false;
        p.crouching = inp.crouch;
      }
    } else {
      const decay = Math.exp(-SLIDE_FRICTION * dt);
      p.vx *= decay;
      p.vz *= decay;
    }
  } else {
    const wantCrouch = inp.crouch;
    if (wantCrouch) p.crouching = true;
    else if (p.crouching && !blockedAt(blocks, p.x, p.z, p.y, STAND_H)) p.crouching = false; // stay low under a ceiling
  }

  // ---- horizontal velocity ----
  if (p.ragdoll) {
    p.sliding = false;
    p.crouching = false;
    // a limp body: it keeps its speed through the air and skids along the ground
    const decay = Math.exp(-(grounded ? 1.7 : 0.12) * dt);
    p.vx *= decay;
    p.vz *= decay;
  } else if (!p.sliding) {
    const sprinting = inp.sprint && inp.f > 0.3 && !p.crouching; // sprint is forward only
    const base = p.crouching ? CROUCH_SPEED : sprinting ? SPRINT_SPEED : WALK_SPEED;
    const speed = base * (1 - 0.45 * depth);
    const rate = grounded ? (wantsMove ? GROUND_ACCEL : GROUND_DECEL) : AIR_ACCEL;
    const a = 1 - Math.exp(-rate * dt);
    p.vx += (wx * speed - p.vx) * a;
    p.vz += (wz * speed - p.vz) * a;
  }

  // ---- vault / climb from the ground (jump or grab, next to a wall that is not jumpable) ----
  if (grounded && (inp.jumpPressed || inp.grabPressed)) {
    let dirx = aimX;
    let dirz = aimZ;
    if (!wantsMove && horizSpeed(p) > 0.5) {
      dirx = p.vx / horizSpeed(p);
      dirz = p.vz / horizSpeed(p);
    }
    const w = wallAhead(blocks, p.x, p.z, dirx, dirz, p.y, STAND_H);
    if (w) {
      const rise = blockTop(w.block) - p.y;
      if (rise > VAULT_MIN && rise <= VAULT_MAX) {
        startMantle(p, w.block, w.nx, w.nz, VAULT_TIME + 0.08 * rise);
        p.jumpBuffer = 0;
        return { sentHome: false };
      }
    }
  }

  // ---- jump: buffered, with coyote time, variable height ----
  const wantJump = p.jumpBuffer > 0 || (grounded && inp.jump); // holding jump keeps hopping
  if (wantJump && (grounded || p.coyote > 0)) {
    p.vy = JUMP_SPEED * (1 - 0.35 * depth);
    p.coyote = 0;
    p.jumpBuffer = 0;
    p.jumpCut = false;
    if (p.sliding) p.sliding = false; // a slide-jump keeps all its speed
    p.crouching = false;
  }
  if (!inp.jump && p.vy > 3 && !p.jumpCut && !p.onGround) {
    p.vy *= JUMP_CUT; // let go early: a shorter hop
    p.jumpCut = true;
  }

  // ---- integrate horizontally, with collision ----
  const height = bodyHeight(p);
  const nx = p.x + p.vx * dt;
  const nz = p.z + p.vz * dt;
  const r = resolveHorizontal(blocks, nx, nz, p.y, height);
  // anything pushed back by a wall loses its speed into that wall
  if (Math.abs(r.x - nx) > 1e-4) p.vx = (r.x - p.x) / dt;
  if (Math.abs(r.z - nz) > 1e-4) p.vz = (r.z - p.z) / dt;
  p.x = r.x;
  p.z = r.z;

  // ---- vertical ----
  const supp2 = supportTop(blocks, p.x, p.z, p.y);
  const depth2 = waterDepth(p.x, p.z);
  const ground2 = Math.max(-WADE_DEPTH * depth2, supp2);
  const vyBefore = p.vy;
  p.vy -= GRAVITY * dt;
  p.y += p.vy * dt;
  // hit your head on the underside of something
  if (p.vy > 0) {
    for (const k of blocks) {
      if (k.y0 <= 0) continue;
      if (footprintDistance(k, p.x, p.z) >= BODY_RADIUS * 0.99) continue;
      if (p.y + height > k.y0 && p.y < k.y0) {
        p.y = k.y0 - height;
        p.vy = 0;
      }
    }
  }
  if (p.y <= ground2) {
    if (!grounded && vyBefore < -3) p.landImpact = Math.max(p.landImpact, -vyBefore);
    p.y = ground2;
    p.vy = 0;
    p.onGround = true;
  } else {
    p.onGround = false;
  }

  // ---- ledge grab: airborne, grab button held, a wall in front whose top is within reach ----
  if (!p.onGround && inp.grab && p.grabCooldown <= 0) {
    const w = wallAhead(blocks, p.x, p.z, aimX, aimZ, p.y, STAND_H);
    if (w) {
      const rise = blockTop(w.block) - p.y;
      if (rise >= GRAB_MIN && rise <= HANG_DROP) {
        // already about level with the ledge: hop over it instead of dropping down to hang from it
        startMantle(p, w.block, w.nx, w.nz, VAULT_TIME + 0.08 * rise);
        p.jumpBuffer = 0;
      } else if (rise > HANG_DROP && rise <= GRAB_MAX) {
        p.hanging = true;
        p.hangTime = 0;
        p.hangNx = w.nx;
        p.hangNz = w.nz;
        p.hangTop = blockTop(w.block);
        p.hangX = w.block.x;
        p.hangZ = w.block.z;
        p.hangFromX = p.x;
        p.hangFromY = p.y;
        p.hangFromZ = p.z;
        p.hangToX = w.cx + w.nx * (BODY_RADIUS + 0.03);
        p.hangToZ = w.cz + w.nz * (BODY_RADIUS + 0.03);
        p.vx = p.vy = p.vz = 0;
        p.sliding = false;
        p.crouching = false;
        p.jumpBuffer = 0;
      }
    }
  }

  // ---- eye height ----
  const wantEye = p.sliding ? EYE_SLIDE : p.crouching ? EYE_CROUCH : EYE_STAND;
  p.eye += (wantEye - p.eye) * k1;

  return { sentHome: Math.hypot(p.x, p.z) > SWIM_LIMIT - 1 };
}
