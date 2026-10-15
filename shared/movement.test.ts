import assert from 'node:assert/strict';
import { BODY_RADIUS, newSim, noInput, stepPlayer, type Input, type Sim } from './movement';
import { OBSTACLES, blockTop, type Block } from './obstacles';
import { SWIM_LIMIT } from './protocol';

const DT = 1 / 60;
const blk = (kind: Block['kind'], x: number, z: number, w: number, d: number, h: number, y0 = 0): Block => ({
  kind,
  x,
  z,
  w,
  d,
  h,
  y0,
});
/** yaw for which "forward" points along (dx, dz): forward = (-sin yaw, -cos yaw). */
const yawToward = (dx: number, dz: number) => Math.atan2(-dx, -dz);

interface Bot {
  (p: Sim, frame: number): Partial<Input> | void;
}
/** Step a player for up to `seconds`, asking `bot` for input each frame; tracks edge presses. */
function drive(p: Sim, blocks: Block[], seconds: number, bot: Bot, yaw = 0) {
  let prevJump = false;
  let prevCrouch = false;
  const frames = Math.round(seconds / DT);
  const seen = { hanging: false, sliding: false, mantled: false, maxY: p.y };
  for (let i = 0; i < frames; i++) {
    const want = bot(p, i) || {};
    const inp: Input = { ...noInput(yaw), ...want };
    inp.jumpPressed = inp.jump && !prevJump;
    inp.crouchPressed = inp.crouch && !prevCrouch;
    prevJump = inp.jump;
    prevCrouch = inp.crouch;
    stepPlayer(p, inp, DT, blocks);
    if (p.hanging) seen.hanging = true;
    if (p.sliding) seen.sliding = true;
    if (p.mantle) seen.mantled = true;
    seen.maxY = Math.max(seen.maxY, p.y);
  }
  return seen;
}
const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;
/** A one-frame jump press the first time `cond` holds (so bots don't bunny-hop off their target). */
const once = (cond: (s: Sim) => boolean) => {
  let used = false;
  return (s: Sim) => {
    if (used || !cond(s)) return false;
    used = true;
    return true;
  };
};

// ---------- basics ----------
{
  const p = newSim(0, 0);
  drive(p, [], 1, () => ({}));
  assert.ok(near(p.y, 0) && p.onGround, 'stands on the ground');
}

// a wall stops you
{
  const wall = blk('wall', 0, -3, 4, 1, 2);
  const p = newSim(0, 0);
  drive(p, [wall], 3, () => ({ f: 1 }));
  assert.ok(p.z >= -3 + 0.5 + BODY_RADIUS - 0.02, `stopped by the wall, z=${p.z.toFixed(2)}`);
}

// low curbs are stepped onto without jumping
{
  const curb = blk('step', 0, -7, 4, 10, 0.3); // spans z -12..-2: still underfoot after 2 s of walking
  const p = newSim(0, 0);
  drive(p, [curb], 2, () => ({ f: 1 }));
  assert.ok(near(p.y, 0.3) && p.z < -3, `stepped onto the curb: y=${p.y.toFixed(2)} z=${p.z.toFixed(2)}`);
}

// a jump clears a 1.0 m block and lands on top
{
  const crate = blk('crate', 0, -4, 3, 2, 1.0);
  const p = newSim(0, 0);
  const hop = once((s) => s.z < -1.5 && s.onGround);
  drive(p, [crate], 3, (s) => ({ f: s.z < -3 ? 0 : 1, sprint: true, jump: hop(s) }));
  assert.ok(near(p.y, 1.0) && p.z < -3, `landed on the crate: y=${p.y.toFixed(2)} z=${p.z.toFixed(2)}`);
}

// ---------- sprint-jumping a gap ----------
{
  const a = blk('platform', 0, -2, 4, 2, 1);
  const bb = blk('platform', 0, -8, 4, 2, 1);
  const p = newSim(0, -2);
  p.y = 1;
  const hop = once((s) => s.z < -2.6 && s.onGround);
  const seen = drive(p, [a, bb], 3, (s) => ({ f: s.z < -6.2 ? 0 : 1, sprint: true, jump: hop(s) }));
  assert.ok(near(p.y, 1.0) && p.z < -6.5, `cleared a 3 m gap: y=${p.y.toFixed(2)} z=${p.z.toFixed(2)} maxY=${seen.maxY.toFixed(2)}`);
}

// ---------- ledge grab + mantle ----------
{
  const wall = blk('wall', 0, -5, 4, 1, 2.4);
  const p = newSim(0, 0);
  const hop = once((s) => s.z < -2.4 && s.onGround);
  let pulled = false;
  const seen = drive(p, [wall], 5, (s) => {
    if (s.hanging) {
      pulled = true;
      return { f: 1, jump: true }; // press jump again to pull up
    }
    return { f: pulled ? 0 : 1, sprint: true, jump: hop(s) };
  });
  assert.ok(seen.hanging, 'grabbed the ledge');
  assert.ok(seen.mantled, 'pulled up');
  assert.ok(near(p.y, 2.4) && p.z > -5.5 && p.z < -4.5, `standing on top: y=${p.y.toFixed(2)} z=${p.z.toFixed(2)}`);
}

// you can let go of a ledge with back / crouch
{
  const wall = blk('wall', 0, -5, 4, 1, 2.4);
  const p = newSim(0, 0);
  let hangFrames = 0;
  const hop = once((s) => s.z < -2.4 && s.onGround);
  drive(p, [wall], 4, (s) => {
    if (s.hanging) {
      hangFrames++;
      return hangFrames > 20 ? { f: -1 } : {};
    }
    return hangFrames > 0 ? {} : { f: 1, sprint: true, jump: hop(s) };
  });
  assert.ok(hangFrames > 20 && !p.hanging && near(p.y, 0), 'dropped back to the ground');
}

// ---------- ground vault ----------
{
  const wall = blk('wall', 0, -3, 4, 0.6, 1.2);
  const p = newSim(0, -1.9);
  let first = true;
  const seen = drive(p, [wall], 2, () => {
    const j = first;
    first = false;
    return { f: j ? 1 : 0, jump: j }; // one press toward the wall, then stand still
  });
  assert.ok(seen.mantled && near(p.y, 1.2) && p.z < -2.6, `vaulted up: y=${p.y.toFixed(2)} z=${p.z.toFixed(2)}`);
}

// ---------- sliding ----------
{
  const beam = blk('beam', 0, -14, 4, 0.5, 0.5, 0.85); // underside at 0.85 m
  const pillars = [blk('pillar', -2.3, -14, 0.5, 0.5, 1.6), blk('pillar', 2.3, -14, 0.5, 0.5, 1.6)];

  // sprinting into it standing up is blocked
  const blocked = newSim(0, 0);
  drive(blocked, [beam, ...pillars], 4, () => ({ f: 1, sprint: true }));
  assert.ok(blocked.z > -14 + 0.25 + BODY_RADIUS - 0.05, `a standing runner is stopped by the beam: z=${blocked.z.toFixed(2)}`);

  // sprint, then slide (C while sprinting) goes underneath
  const p = newSim(0, 0);
  let slid = false;
  const seen = drive(p, [beam, ...pillars], 6, (s) => {
    const startSlide = !slid && s.z < -8.5;
    if (startSlide) slid = true;
    return { f: s.z < -17 ? 0 : 1, sprint: true, crouch: startSlide || s.sliding };
  });
  assert.ok(seen.sliding, 'entered a slide');
  assert.ok(p.z < -15, `slid under the beam: z=${p.z.toFixed(2)}`);
  assert.ok(!p.sliding && near(p.y, 0), 'stood back up after clearing it');
}

// a slide needs a run-up
{
  const p = newSim(0, 0);
  const seen = drive(p, [], 1, (s) => ({ f: 1, sprint: true, crouch: s.z === 0 })); // c at standstill
  assert.ok(!seen.sliding, 'no slide from a standing start');
}

// a slide can be jumped out of, keeping its speed
{
  const p = newSim(0, 0);
  let phase = 0;
  drive(p, [], 1.8, (s) => {
    if (phase === 0 && s.z < -6) {
      phase = 1;
      return { f: 1, sprint: true, crouch: true };
    }
    if (phase === 1) {
      phase = 2;
      return { f: 1, sprint: true, crouch: true, jump: false };
    }
    return { f: 1, sprint: true };
  });
  assert.ok(p.z < -10, 'slid forward a good distance');
}

// ---------- water and limits ----------
{
  const p = newSim(40, 0);
  drive(p, [], 1, () => ({}));
  assert.ok(near(p.y, -1.05, 0.06), `wading depth in the sea: ${p.y.toFixed(2)}`);
  const far = newSim(SWIM_LIMIT, 0);
  const res = stepPlayer(far, noInput(), DT, []);
  assert.equal(res.sentHome, true, 'past the buoys you are sent home');
}

// ---------- the real course ----------
// layout sanity
for (const k of OBSTACLES) {
  const reach = Math.hypot(Math.abs(k.x) + k.w / 2, Math.abs(k.z) + k.d / 2);
  assert.ok(reach < 30, `${k.kind} at (${k.x},${k.z}) is on the island or its beach (sea starts at 31 m)`);
  const overlapsSpawn = Math.abs(k.x) - k.w / 2 < 6 && Math.abs(k.z) - k.d / 2 < 6;
  assert.ok(!overlapsSpawn, `${k.kind} at (${k.x},${k.z}) keeps clear of the spawn area`);
}
const at = (x: number, z: number, kind?: Block['kind']) => {
  const k = OBSTACLES.find((b) => Math.abs(b.x - x) < 1e-6 && Math.abs(b.z - z) < 1e-6 && (!kind || b.kind === kind));
  assert.ok(k, `course block at (${x},${z}) exists`);
  return k as Block;
};
const topOf = (x: number, z: number) => blockTop(at(x, z));

/** Fraction of jump timings (positions along the approach) for which `attempt` succeeds. */
const passRate = (positions: number[], attempt: (at: number) => boolean) =>
  positions.filter(attempt).length / positions.length;
const range = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let v = from; from < to ? v <= to + 1e-9 : v >= to - 1e-9; v += from < to ? step : -step) out.push(v);
  return out;
};

// step 1.0 -> step 1.4 (the steps run along +x, so face +x): walkers and sprinters both get there
{
  const attempt = (sprint: boolean) => (at: number) => {
    const p = newSim(14, -7);
    p.y = topOf(14, -7);
    const hop = once((s) => s.x > at && s.onGround);
    drive(p, OBSTACLES, 2.2, (s) => ({ f: s.x > 17 ? 0 : 1, sprint, jump: hop(s) }), yawToward(1, 0));
    return near(p.y, topOf(17, -7)) && p.x > 16 && p.x < 18;
  };
  const walk = passRate(range(14.2, 15.4, 0.1), attempt(false));
  assert.ok(walk >= 0.3, `walking up the steps is forgiving enough: ${(walk * 100).toFixed(0)}% of timings land`);
}

// platform -> platform: a 2.2 m gap, jumped from the edge at a walk
{
  const attempt = (at: number) => {
    const p = newSim(20, -10);
    p.y = topOf(20, -10);
    const hop = once((s) => s.z < at && s.onGround);
    // walking pace: a sprint jump carries ~6 m and would sail over the 2 m landing pad
    drive(p, OBSTACLES, 3, (s) => ({ f: s.z < -13.5 ? 0 : 1, sprint: false, jump: hop(s) }));
    return near(p.y, topOf(19.5, -14.2)) && p.z < -13.2 && p.z > -15.2;
  };
  const rate = passRate(range(-10.3, -10.95, 0.05), attempt);
  assert.ok(rate >= 0.3, `the gap jump is forgiving enough: ${(rate * 100).toFixed(0)}% of timings land`);
}

// platform -> 3.0 m wall: you catch the ledge and pull up (or, with perfect timing, land on it)
{
  const wallTop = topOf(19.5, -17.8);
  let grabs = 0;
  const attempt = (sprint: boolean) => (at: number) => {
    const p = newSim(19.5, -14.2);
    p.y = topOf(19.5, -14.2);
    const hop = once((s) => s.z < at && s.onGround);
    let up = false;
    const seen = drive(p, OBSTACLES, 5, (s) => {
      if (near(s.y, wallTop, 0.05) && s.onGround) up = true;
      if (s.hanging) return { jump: true }; // pull up
      return { f: up ? 0 : 1, sprint, jump: hop(s) };
    });
    if (seen.hanging) grabs++;
    return up && near(p.y, wallTop);
  };
  const timings = range(-14.3, -15.15, 0.05);
  const walk = passRate(timings, attempt(false));
  const run = passRate(timings, attempt(true));
  assert.ok(walk >= 0.3, `the course wall is reachable at a walk: ${(walk * 100).toFixed(0)}%`);
  assert.ok(run >= 0.3, `...and at a sprint: ${(run * 100).toFixed(0)}%`);
  assert.ok(grabs > 0, 'ledge grabbing is actually exercised by the course wall');
}

// plank -> goal tower: vault the last metre
{
  const p = newSim(11.5, -17.8);
  p.y = topOf(14, -17.8);
  let pressed = false;
  const seen = drive(
    p,
    OBSTACLES,
    4,
    (s) => {
      const atFace = s.x < 10.6;
      const j = atFace && !pressed;
      if (j) pressed = true;
      return { f: pressed ? 0 : 1, sprint: false, jump: j };
    },
    yawToward(-1, 0.22),
  );
  assert.ok(seen.mantled && near(p.y, topOf(8.5, -17)), `reached the goal: y=${p.y.toFixed(2)} x=${p.x.toFixed(2)}`);
}

// the yard's slide beam really is slide-only
{
  const beams = OBSTACLES.filter((b) => b.kind === 'beam');
  assert.ok(beams.length >= 2, 'there are slide-under beams');
  for (const k of beams) {
    assert.ok(k.y0 > 0.8 && k.y0 < 1.2, 'beam underside is above a slide but below a crouch');
  }
}

console.log('movement tests passed');
