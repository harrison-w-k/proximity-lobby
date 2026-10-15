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
/** Step a player for `seconds`, asking `bot` for input each frame; derives the "pressed this frame" edges. */
function drive(p: Sim, blocks: Block[], seconds: number, bot: Bot, yaw = 0) {
  let prevJump = false;
  let prevCrouch = false;
  let prevGrab = false;
  const frames = Math.round(seconds / DT);
  const seen = { hanging: false, sliding: false, mantled: false, maxY: p.y };
  for (let i = 0; i < frames; i++) {
    const want = bot(p, i) || {};
    const inp: Input = { ...noInput(yaw), ...want };
    inp.jumpPressed = inp.jump && !prevJump;
    inp.crouchPressed = inp.crouch && !prevCrouch;
    inp.grabPressed = inp.grab && !prevGrab;
    prevJump = inp.jump;
    prevCrouch = inp.crouch;
    prevGrab = inp.grab;
    stepPlayer(p, inp, DT, blocks);
    if (p.hanging) seen.hanging = true;
    if (p.sliding) seen.sliding = true;
    if (p.mantle) seen.mantled = true;
    seen.maxY = Math.max(seen.maxY, p.y);
  }
  return seen;
}
const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;
/** Holds "jump" for ~0.25 s the first time `cond` holds (a real key press, not a one-frame tap). */
const once = (cond: (s: Sim) => boolean, frames = 15) => {
  let left = 0;
  let used = false;
  return (s: Sim) => {
    if (!used && cond(s)) {
      used = true;
      left = frames;
    }
    if (left > 0) {
      left--;
      return true;
    }
    return false;
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

// ---------- game feel ----------
// variable jump height: tapping jump hops, holding it gives the full jump
{
  const apex = (holdFrames: number) => {
    const p = newSim(0, 0);
    let held = 0;
    return drive(p, [], 1, () => ({ jump: held++ < holdFrames })).maxY;
  };
  const tap = apex(2);
  const hold = apex(40);
  assert.ok(hold > 1.1 && hold < 1.5, `a held jump reaches about 1.3 m: ${hold.toFixed(2)}`);
  assert.ok(tap < hold - 0.4, `a tap is clearly lower than a hold: tap ${tap.toFixed(2)} vs hold ${hold.toFixed(2)}`);
}

// coyote time: you can still jump a moment after running off an edge, but not half a second later
{
  // a tall ledge, so the fall (about 0.6 s) is longer than the coyote window plus the jump buffer
  const ledge = blk('platform', 0, -4, 4, 8, 4.0); // spans z -8..0; walking toward +z leaves it at z = 0
  const jumpedAfterEdge = (delayFrames: number) => {
    const p = newSim(0, -1);
    p.y = 4.0;
    let offAt = -1;
    let presses = 0;
    let rose = false;
    drive(p, [ledge], 1.5, (s, i) => {
      if (offAt < 0 && s.z > 0.35 && !s.onGround) offAt = i;
      if (offAt >= 0 && s.vy > 3) rose = true;
      return { f: -1, jump: offAt >= 0 && i - offAt >= delayFrames && presses++ < 12 }; // f = -1 walks toward +z
    });
    return rose;
  };
  assert.ok(jumpedAfterEdge(3), 'a jump pressed just after leaving the edge still works (coyote time)');
  assert.ok(!jumpedAfterEdge(20), 'a jump pressed a third of a second after leaving the edge does not');
}

// jump buffering: a jump pressed slightly before landing fires on landing
{
  const p = newSim(0, 0);
  p.y = 1.6; // dropped from 1.6 m
  let rose = false;
  let pressedAt = -1;
  drive(p, [], 1.2, (s, i) => {
    if (s.vy > 3) rose = true;
    if (pressedAt < 0 && s.y < 0.9 && s.vy < 0) pressedAt = i; // press while still ~0.1 s above the ground
    return { jump: pressedAt >= 0 && i - pressedAt < 2 };
  });
  assert.ok(rose, 'a jump pressed just before landing fires on landing');
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

// ---------- ledge grab: an intentional button ----------
{
  const wall = blk('wall', 0, -5, 4, 1, 2.4);

  // WITHOUT the grab button you never catch the ledge, even jumping straight at it
  const noGrab = newSim(0, 0);
  const hopNo = once((s) => s.z < -2.4 && s.onGround);
  const seenNo = drive(noGrab, [wall], 4, (s) => ({ f: 1, sprint: true, jump: hopNo(s) }));
  assert.ok(!seenNo.hanging, 'no ledge grab without the grab button');

  // holding the button in the air catches it, and a jump press pulls you up
  const p = newSim(0, 0);
  const hop = once((s) => s.z < -2.4 && s.onGround);
  let pulled = false;
  const seen = drive(p, [wall], 5, (s) => {
    if (s.hanging) {
      pulled = true;
      return { grab: true, f: 1, jump: s.hangTime > 0.25 && s.hangTime < 0.4 };
    }
    return { f: pulled ? 0 : 1, sprint: true, jump: hop(s), grab: !s.onGround };
  });
  assert.ok(seen.hanging, 'grabbed the ledge with the button');
  assert.ok(seen.mantled, 'pulled up');
  assert.ok(near(p.y, 2.4) && p.z > -5.5 && p.z < -4.5, `standing on top: y=${p.y.toFixed(2)} z=${p.z.toFixed(2)}`);
}

// the catch is smooth: no frame teleports the player
{
  const wall = blk('wall', 0, -5, 4, 1, 2.4);
  const p = newSim(0, 0);
  const hop = once((s) => s.z < -2.4 && s.onGround);
  let prev: { x: number; y: number; z: number } | null = null;
  let maxStep = 0;
  drive(p, [wall], 3, (s) => {
    if (prev) maxStep = Math.max(maxStep, Math.hypot(s.x - prev.x, s.y - prev.y, s.z - prev.z));
    prev = { x: s.x, y: s.y, z: s.z };
    return { f: s.hanging ? 0 : 1, sprint: true, jump: hop(s), grab: !s.onGround };
  });
  // at a sprint a single 1/60 s frame is ~0.15 m; a snap-to-ledge would show up as a jump of 0.5+
  assert.ok(maxStep < 0.35, `no single frame moves the player more than a sprint step: ${maxStep.toFixed(2)} m`);
}

// releasing the grab button lets go
{
  const wall = blk('wall', 0, -5, 4, 1, 2.4);
  const p = newSim(0, 0);
  const hop = once((s) => s.z < -2.4 && s.onGround);
  let hangFrames = 0;
  drive(p, [wall], 4, (s) => {
    if (s.hanging) {
      hangFrames++;
      return { grab: hangFrames < 30 }; // hold for half a second, then let go
    }
    return hangFrames > 0 ? { grab: false } : { f: 1, sprint: true, jump: hop(s), grab: !s.onGround };
  });
  assert.ok(hangFrames > 20 && !p.hanging && near(p.y, 0), 'let go and dropped back to the ground');
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

// the grab button vaults too
{
  const wall = blk('wall', 0, -3, 4, 0.6, 1.2);
  const p = newSim(0, -1.9);
  let first = true;
  const seen = drive(p, [wall], 2, () => {
    const g = first;
    first = false;
    return { f: g ? 1 : 0, grab: g };
  });
  assert.ok(seen.mantled && near(p.y, 1.2), 'grab button vaults a waist-high wall');
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

/** Distance from a point on a block to the block's edge, travelling in direction (ux, uz). */
const edgeDistance = (k: Block, px: number, pz: number, ux: number, uz: number) => {
  const tx = Math.abs(ux) > 1e-9 ? ((ux > 0 ? k.x + k.w / 2 : k.x - k.w / 2) - px) / ux : Infinity;
  const tz = Math.abs(uz) > 1e-9 ? ((uz > 0 ? k.z + k.d / 2 : k.z - k.d / 2) - pz) / uz : Infinity;
  return Math.max(0, Math.min(tx, tz));
};

interface Hop {
  name: string;
  from: Block;
  to: Block;
  sprint: boolean;
  grab: boolean; // hold the grab button in the air and pull up
  minPass: number; // fraction of jump timings that must succeed
  start?: [number, number]; // where on `from` the run starts (default: its middle), e.g. the end of a plank
}

/** Runs from the middle of `from` toward `to`, jumping `before` metres before the edge. */
function attemptHop(h: Hop, before: number): boolean {
  const sx = h.start ? h.start[0] : h.from.x;
  const sz = h.start ? h.start[1] : h.from.z;
  const dx = h.to.x - sx;
  const dz = h.to.z - sz;
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  const edge = edgeDistance(h.from, sx, sz, ux, uz);
  const p = newSim(sx, sz);
  p.y = blockTop(h.from);
  const goal = blockTop(h.to);
  let arrived = false;
  let jumpFrames = 0;
  let triggered = false;
  drive(
    p,
    OBSTACLES,
    5,
    (s) => {
      if (near(s.y, goal, 0.06) && s.onGround && Math.hypot(s.x - h.to.x, s.z - h.to.z) < Math.max(h.to.w, h.to.d) / 2 + 0.35) arrived = true;
      if (arrived) return {};
      const travelled = Math.hypot(s.x - sx, s.z - sz);
      if (!triggered && travelled >= edge - before) {
        triggered = true;
        jumpFrames = 15;
      }
      const jump = jumpFrames > 0;
      if (jumpFrames > 0) jumpFrames--;
      if (s.hanging) return { grab: true, f: 1, jump: s.hangTime > 0.25 && s.hangTime < 0.4 };
      return { f: 1, sprint: h.sprint, jump, grab: h.grab && !s.onGround };
    },
    yawToward(ux, uz),
  );
  return arrived && near(p.y, goal, 0.06);
}

/** Best result over walking and sprinting, across a sweep of jump timings (0 to 1.6 m before the edge). */
const passRate = (h: Hop) => {
  const offsets: number[] = [];
  for (let o = 0.05; o <= 1.6; o += 0.1) offsets.push(o);
  const rate = (sprint: boolean) => offsets.filter((o) => attemptHop({ ...h, sprint }, o)).length / offsets.length;
  return Math.max(rate(false), rate(true));
};

const B = (x: number, z: number) => at(x, z);
const HOPS: Hop[] = [
  { name: 'step 1.0 -> step 1.4', from: B(14, -7), to: B(17, -7), sprint: false, grab: false, minPass: 0.2 },
  { name: 'step -> hop 1 (3 m)', from: B(17, -7), to: B(21.5, -9), sprint: false, grab: false, minPass: 0.1 },
  { name: 'hop 1 -> hop 2 (4.6 m)', from: B(21.5, -9), to: B(23.6, -14), sprint: false, grab: false, minPass: 0.03 },
  { name: 'hop 2 -> hop 3 (5.2 m)', from: B(23.6, -14), to: B(18, -17.2), sprint: false, grab: false, minPass: 0.03 },
  { name: 'hop 3 -> 4.6 m wall (grab)', from: B(18, -17.2), to: B(17, -21.2), sprint: false, grab: true, minPass: 0.05 },
  { name: 'wall top -> plank', from: B(17, -21.2), to: B(10.5, -21.2), sprint: false, grab: false, minPass: 0.15 },
  { name: 'plank -> pillar 1', from: B(10.5, -21.2), to: B(1, -19.5), sprint: false, grab: false, minPass: 0.02, start: [6.6, -21.2] },
  { name: 'pillar 1 -> pillar 2', from: B(1, -19.5), to: B(-3.7, -17.2), sprint: false, grab: false, minPass: 0.02 },
  { name: 'pillar 2 -> pillar 3', from: B(-3.7, -17.2), to: B(-8.4, -14.9), sprint: false, grab: false, minPass: 0.02 },
  { name: 'pillar 3 -> pillar 4', from: B(-8.4, -14.9), to: B(-13.1, -12.6), sprint: false, grab: false, minPass: 0.02 },
  { name: 'pillar 4 -> tower wall 1 (grab)', from: B(-13.1, -12.6), to: B(-18.5, -10.5), sprint: false, grab: true, minPass: 0.02 },
  { name: 'tower wall 1 -> wall 2 (grab)', from: B(-18.5, -10.5), to: B(-22.5, -9), sprint: false, grab: true, minPass: 0.1 },
  { name: 'tower wall 2 -> goal (grab)', from: B(-22.5, -9), to: B(-26, -9.5), sprint: false, grab: true, minPass: 0.1 },
];
for (const h of HOPS) {
  const rate = passRate(h);
  assert.ok(rate >= h.minPass, `obby segment "${h.name}" is reachable but not trivial: ${(rate * 100).toFixed(0)}% of timings (needs >= ${h.minPass * 100}%)`);
}
// the whole point of a harder obby: nothing in it is a pushover, and it isn't impossible either
const rates = HOPS.map((h) => passRate(h));
console.log(HOPS.map((h, i) => `  ${h.name.padEnd(36)} ${(rates[i] * 100).toFixed(0).padStart(3)}% of timings land`).join(String.fromCharCode(10)));
assert.ok(Math.min(...rates) < 0.45, 'the hardest segments need real precision');
assert.ok(rates.filter((r) => r < 0.45).length >= 3, 'several segments are demanding, not just one');

// the goal is high: the course really is a climb
assert.ok(blockTop(at(-26, -9.5, 'goal')) >= 10, 'the goal is 10 m or more above the ground');

// the yard's slide beam really is slide-only
{
  const beams = OBSTACLES.filter((b) => b.kind === 'beam');
  assert.ok(beams.length >= 2, 'there are slide-under beams');
  for (const k of beams) {
    assert.ok(k.y0 > 0.8 && k.y0 < 1.2, 'beam underside is above a slide but below a crouch');
  }
}

console.log('movement tests passed');
