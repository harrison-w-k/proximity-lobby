// Map features: geysers throw you up, thermals carry gliders, springs heal.
import assert from 'node:assert/strict';
import { Match, type Entrant } from './match';
import { GEYSER_BLAST, GEYSER_WARN, geyserAt } from './terrain';

const ents: Entrant[] = [
  { id: 'a', name: 'A', animal: 'fox', team: 0, bot: false },
  { id: 'b', name: 'B', animal: 'robin', team: 1, bot: false },
];
const m = new Match(5, ents, { send: () => {} });
const kinds = (k: string) => m.terrain.features.filter((f) => f.kind === k);
assert.ok(kinds('geyser').length >= 6 && kinds('thermal').length >= 4 && kinds('spring').length >= 3, 'the map has all three kinds');

const ft = kinds('geyser')[0];
// the cycle: quiet, then a warning, then the blast
let sawWarn = false;
let sawBlast = false;
for (let t = 0; t < ft.period * 2; t += 0.1) {
  const g = geyserAt(ft, t);
  if (g.state === 1) sawWarn = true;
  if (g.state === 2) sawBlast = true;
}
assert.ok(sawWarn && sawBlast && ft.period > GEYSER_WARN + GEYSER_BLAST);

for (const o of m.fighters) {
  o.lastInputAt = Infinity;
  o.x = 5000;
  o.z = 5000;
}
m.mobs.length = 0;
const a = m.byId.get('a')!;
a.x = ft.x;
a.z = ft.z;
// run until it erupts
let launched = false;
let peak = 0;
for (let i = 0; i < 30 * ft.period * 2 && !launched; i++) {
  m.tick();
  a.x = ft.x;
  a.z = ft.z;
  if (a.jy > 1) launched = true;
}
assert.ok(launched, 'standing on a geyser as it blows throws you up');
const hp = a.hp;
for (let i = 0; i < 30 * 4; i++) {
  m.tick();
  a.x = ft.x + 6; // step off so it cannot launch again
  peak = Math.max(peak, a.jy);
}
assert.ok(peak > 4, `and high (${peak.toFixed(1)} m)`);
assert.ok(a.hp >= hp - 1e-6, 'the landing is soft');

// a bird in a thermal rises while it glides
const th = kinds('thermal')[0];
const b = m.byId.get('b')!;
b.x = th.x;
b.z = th.z;
b.jy = 3;
b.jv = -1;
let hi = 3;
for (let i = 0; i < 90; i++) {
  m.tick();
  b.x = th.x;
  b.z = th.z;
  hi = Math.max(hi, b.jy);
}
assert.ok(hi > 8, `a thermal lifts a bird (${hi.toFixed(1)} m)`);

// a spring heals someone who is not fighting
const sp = kinds('spring')[0];
a.x = sp.x;
a.z = sp.z;
a.hp = a.maxHp * 0.3;
a.lastCombat = -99;
const before = a.hp;
for (let i = 0; i < 60; i++) {
  m.tick();
  a.x = sp.x;
  a.z = sp.z;
}
assert.ok(a.hp > before + a.maxHp * 0.05, 'a hot spring heals');

// a bounce mushroom throws a walker up and cushions the landing
const mu = kinds('mushroom')[0];
assert.ok(kinds('mushroom').length >= 6 && kinds('tar').length >= 2 && kinds('vent').length >= 2, 'and the new ones');
a.x = mu.x;
a.z = mu.z;
a.hp = a.maxHp;
let bpeak = 0;
for (let i = 0; i < 20; i++) {
  m.tick();
  bpeak = Math.max(bpeak, a.jy);
  if (bpeak > 2) break;
}
assert.ok(bpeak > 2, 'a mushroom bounces you');
a.x = mu.x + 7;
for (let i = 0; i < 90; i++) m.tick();
assert.equal(a.hp, a.maxHp, 'softly');

// a fire vent burns once per blast
const ve = kinds('vent')[0];
a.x = ve.x;
a.z = ve.z;
a.jy = 0;
a.jv = 0;
const h0 = a.hp;
for (let i = 0; i < 30 * ve.period * 2 && a.hp === h0; i++) {
  m.tick();
  a.x = ve.x;
  a.z = ve.z;
}
assert.ok(a.hp < h0, 'a vent burns whoever stands on it as it blows');

// tar drags
import { medium } from './move';
const ta = kinds('tar')[0];
assert.ok(medium(m.terrain, ta.x, ta.z, false, 0).mul < 0.6, 'tar slows');
console.log('features tests passed');
