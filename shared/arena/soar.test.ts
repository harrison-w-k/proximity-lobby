// A bird's soar: a boost into the air and a long, slow glide: not real flight, and it has a long cooldown.
import assert from 'node:assert/strict';
import { JUMP_V, SOAR_FALL, SOAR_SPEED, stepVertical } from './move';
import { Match, type Entrant } from './match';

// the glide caps the fall; a normal fall is far faster
{
  const fall = { jy: 20, jv: -30 };
  stepVertical(fall, 1 / 30, 0, true);
  assert.ok(Math.abs(fall.jv + SOAR_FALL) < 1e-9, 'a glide falls slowly');
  const plain = { jy: 20, jv: -30 };
  stepVertical(plain, 1 / 30, 0, false);
  assert.ok(plain.jv < -SOAR_FALL * 5, 'without it the fall is fast');
  assert.ok(SOAR_SPEED > 1, 'gliding is quicker than walking');
}

const ents: Entrant[] = [
  { id: 'a', name: 'A', animal: 'robin', team: 0, bot: false },
  { id: 'b', name: 'B', animal: 'fox', team: 1, bot: true },
];
const m = new Match(5, ents, { send: () => {} });
m.time = 120;
const a = m.byId.get('a')!;
const spot = m.terrain.randomLand(m.rnd, 80, 30);
a.x = spot.x;
a.z = spot.z;
for (const o of m.fighters) {
  o.lastInputAt = Infinity;
  o.sta = o.dv.maxSta;
  if (o !== a) {
    o.x = 5000;
    o.z = 5000;
  }
}
m.mobs.length = 0;
for (let i = 0; i < 10; i++) m.tick();
assert.equal(m.castSkill(a, 0, 0), true, 'the robin soars with its signature skill');
assert.ok(a.cdAt[0] - m.time >= 30, 'and the cooldown is long');
assert.equal(m.castSkill(a, 0, 0), false, 'it cannot soar again at once');
let peak = 0;
let airTicks = 0;
for (let i = 0; i < 30 * 12 && (a.jy > 0.01 || a.jv > 0 || i < 3); i++) {
  m.tick();
  peak = Math.max(peak, a.jy);
  if (a.jy > 0.05) airTicks++;
}
assert.ok(peak > JUMP_V * JUMP_V / 48 * 2.5, `it rises far higher than a hop (${peak.toFixed(1)} m)`);
assert.ok(peak < 8, `but it is a boost, not flight (${peak.toFixed(1)} m)`);
assert.ok(airTicks / 30 > 2.5, `and it glides for a while (${(airTicks / 30).toFixed(1)} s)`);
m.tick();
m.tick();
assert.ok(a.jy <= 0.011 && a.jv === 0, 'then it comes down');
assert.equal(a.soarUntil, 0, 'landing ends the glide');
console.log('soar tests passed');

// birds glide off anything taller than a jump; other animals just fall
{
  const { glideFall } = await import('./move');
  assert.equal(glideFall(true, 4, -3, 0), true, 'a bird drops gently off a high ledge');
  assert.equal(glideFall(true, 1.2, -3, 0), false, 'a jump is not a glide');
  assert.equal(glideFall(true, 4, 5, 0), false, 'rising is not gliding');
  assert.equal(glideFall(false, 4, -3, 0), false, 'only birds glide');
  assert.equal(glideFall(true, 5, -3, 4), false, 'height is measured above the rock below');
}
// final forms carry three moves
{
  const { ANIMALS } = await import('./animals');
  for (const a of ANIMALS) {
    assert.equal(!!a.skill3, a.stage === 3, `${a.name}: three moves from stage 3`);
    if (a.skill3) assert.ok(new Set([a.skill.id, a.skill2?.id, a.skill3.id]).size === 3, `${a.name}: its three moves differ`);
  }
}
