// A stalled connection must not make the server drop a player's steps and drag them back (rubberbanding).
import assert from 'node:assert/strict';
import { STARTERS } from './animals';
import { DT, Match, type Entrant } from './match';

function setup() {
  const ents: Entrant[] = [
    { id: 'p0', name: 'P0', animal: STARTERS[0].id, team: 0, bot: false },
    { id: 'p1', name: 'P1', animal: STARTERS[1].id, team: 1, bot: true },
  ];
  const m = new Match(5, ents, { send: () => {} });
  m.time = 120;
  const me = m.byId.get('p0')!;
  const spot = m.terrain.randomLand(m.rnd, 60, 40);
  me.x = spot.x;
  me.z = spot.z;
  const other = m.byId.get('p1')!;
  other.x = 5000;
  other.z = 5000;
  m.mobs.length = 0;
  return { m, me };
}
let seq = 0;
const step = (m: Match, ms: number) => m.handle('p0', { t: 'min', s: ++seq, dt: ms, x: 0, z: 1, yaw: 0, sp: 0, cr: 0, at: 0 });

// 1. a 1 s stall then a burst of 30 steps: every step is kept, replayed, and acked, and the server catches up
{
  const { m, me } = setup();
  for (let i = 0; i < 15; i++) {
    step(m, 33); // a steady stream first, so the server knows the player is connected
    m.tick();
  }
  for (let i = 0; i < 30; i++) m.tick(); // 1 s of silence: nothing arrives
  const walkedBefore = Math.hypot(me.x, me.z);
  void walkedBefore;
  const z0 = me.z;
  const burst = seq + 1;
  for (let i = 0; i < 30; i++) step(m, 33); // the whole stalled second arrives at once
  assert.equal(me.cmds.length, 30, 'none of the burst is thrown away');
  let ticks = 0;
  while (me.ack < seq && ticks < 90) {
    m.tick();
    ticks++;
  }
  assert.equal(me.ack, seq, `all steps acknowledged after ${ticks} ticks`);
  assert.ok(ticks <= 36, `caught up in ${(ticks * DT).toFixed(2)} s, not left lagging`);
  const walked = Math.abs(me.z - z0);
  const expected = me.walkSpeed * 30 * 0.033;
  assert.ok(Math.abs(walked - expected) / expected < 0.2, `the player ends up where they walked: ${walked.toFixed(1)} m vs ${expected.toFixed(1)} m`);
  void burst;
}

// 2. without a stall there is no extra speed: sending faster than real time gains nothing
{
  const { m, me } = setup();
  for (let i = 0; i < 20; i++) {
    step(m, 33);
    m.tick();
  }
  const z0 = me.z;
  for (let i = 0; i < 30; i++) step(m, 100); // 3 s of claimed movement, all at once
  for (let i = 0; i < 30; i++) m.tick(); // 1 s passes
  const walked = Math.abs(me.z - z0);
  assert.ok(walked <= me.walkSpeed * 1.45 * 1.0 + 0.1, `flooding cannot outrun the server: ${walked.toFixed(1)} m in 1 s at ${me.walkSpeed.toFixed(1)} m/s`);
}

// 3. being quiet and then flooding never nets more movement than the time that passed: the credit is only what the silence cost
{
  const { m, me } = setup();
  for (let i = 0; i < 20; i++) {
    step(m, 33);
    m.tick();
  }
  const z0 = me.z;
  for (let i = 0; i < 90; i++) m.tick(); // 3 s of silence
  for (let i = 0; i < 60; i++) step(m, 100); // claim 6 s of walking
  for (let i = 0; i < 45; i++) m.tick(); // 1.5 s more passes
  const walked = Math.abs(me.z - z0);
  const elapsed = 4.5;
  assert.ok(walked <= me.walkSpeed * elapsed * 1.2, `${walked.toFixed(1)} m in ${elapsed} s at ${me.walkSpeed.toFixed(1)} m/s: no more than the time that passed`);
}
console.log('netcode tests passed');
