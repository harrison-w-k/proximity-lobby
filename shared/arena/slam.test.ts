// A stage 2+ bird that attacks while gliding dives and slams the ground for area damage.
import assert from 'node:assert/strict';
import { Match, type Entrant } from './match';

const ents: Entrant[] = [
  { id: 'a', name: 'A', animal: 'hawk', team: 0, bot: false },
  { id: 'b', name: 'B', animal: 'fox', team: 1, bot: false },
  { id: 'c', name: 'C', animal: 'robin', team: 2, bot: false },
];
const m = new Match(5, ents, { send: () => {} });
m.time = 120;
const [a, b, c] = ['a', 'b', 'c'].map((id) => m.byId.get(id)!);
const spot = m.terrain.randomLand(m.rnd, 80, 30);
for (const o of m.fighters) {
  o.lastInputAt = Infinity;
  o.sta = o.dv.maxSta;
}
m.mobs.length = 0;
a.x = spot.x;
a.z = spot.z;
b.x = spot.x + 2.5;
b.z = spot.z;
c.x = 5000;
c.z = 5000;
const ground = m.terrain.floorAt(a.x, a.z, 0);
const lift = () => {
  a.jy = ground + 12;
  a.jv = -1;
};
lift();
for (let i = 0; i < 3; i++) m.tick();
const hp = b.hp;
a.input.at = true;
let slammed = false;
for (let i = 0; i < 120; i++) {
  m.tick();
  if (a.slamming) slammed = true;
  if (slammed && !a.slamming) break;
}
a.input.at = false;
assert.ok(slammed, 'attacking while gliding starts a slam');
assert.ok(b.hp < hp - a.dv.dmg, `the blast hurts what is near (${(hp - b.hp).toFixed(1)})`);
assert.ok(b.stunUntil > m.time - 0.5, 'and stuns it');
assert.ok(a.hp >= a.maxHp - 1e-6, 'the bird itself lands unhurt');
assert.ok(a.slamAt! > m.time, 'then it has to wait');
console.log('slam tests passed');

// elytra: pitch down to build speed, pull up to climb, and no crash damage on landing
{
  const { glideTick, GLIDE_MIN } = await import('./move');
  const s = { jv: 0, gs: 0 };
  for (let i = 0; i < 60; i++) glideTick(s, 1.2, 1 / 30);
  assert.ok(s.gs > 28, `a dive builds speed (${s.gs.toFixed(1)} m/s)`);
  assert.ok(s.jv < -15, 'and drops fast');
  for (let i = 0; i < 12; i++) glideTick(s, -0.3, 1 / 30);
  assert.ok(s.jv > 0, 'pulling up from a dive climbs');
  for (let i = 0; i < 300; i++) glideTick(s, -0.3, 1 / 30);
  assert.ok(s.gs >= GLIDE_MIN && s.gs < 12, 'and a long climb runs out of speed');

  const g = new Match(6, [{ id: 'a', name: 'A', animal: 'hawk', team: 0, bot: false }], { send: () => {} });
  g.time = 120;
  const h = g.byId.get('a')!;
  h.lastInputAt = Infinity;
  g.mobs.length = 0;
  const sp = g.terrain.randomLand(g.rnd, 80, 30);
  h.x = sp.x;
  h.z = sp.z;
  h.jy = g.terrain.floorAt(h.x, h.z, 0) + 60;
  h.jv = -1;
  h.input.pitch = 1.3; // a steep dive
  const hp = h.hp;
  for (let i = 0; i < 30 * 15 && h.jy > g.terrain.floorAt(h.x, h.z, 0) + 0.01; i++) g.tick();
  for (let i = 0; i < 5; i++) g.tick();
  assert.ok(h.hp >= hp, 'a glider lands from a long dive without crash damage');
}
console.log('elytra tests passed');
