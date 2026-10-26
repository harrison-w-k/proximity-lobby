import assert from 'node:assert/strict';
import { Terrain, WATER_Y } from './terrain';
import { DEFAULT_SLOPE, FALL_SAFE, fallDamage, slopeFor, stepPos, stepVertical } from './move';
import { ANIMAL_BY_ID } from './animals';

const t = new Terrain(42);
// climbers go up what the rest cannot, and the strongest climbers cling rather than fall
const wolf = slopeFor(ANIMAL_BY_ID.get('gray_wolf')!);
const ant = slopeFor(ANIMAL_BY_ID.get('ant')!);
const gecko = slopeFor(ANIMAL_BY_ID.get('gecko')!);
const bear = slopeFor(ANIMAL_BY_ID.get('kodiak')!);
assert.ok(ant.limit > 2.5 && gecko.limit > 2.5, 'bugs and geckos climb sheer rock');
assert.ok(bear.limit < wolf.limit, 'a heavy animal climbs less than a medium one');
assert.ok(ant.detach > 50 && wolf.detach < 2, 'climbers never drop off a slope; others can');
assert.ok(slopeFor(ANIMAL_BY_ID.get('robin')!).detach < wolf.detach, 'birds spring off ledges sooner');

// find a steep face and walk straight at it from below
let best = { g: 0, x: 0, z: 0, ux: 0, uz: 0 };
for (let x = -300; x < 300; x += 2) {
  for (let z = -300; z < 300; z += 2) {
    if (Math.hypot(x, z) > 330 || t.heightAt(x, z) < WATER_Y + 0.5) continue;
    const gx = (t.heightAt(x + 1, z) - t.heightAt(x - 1, z)) / 2;
    const gz = (t.heightAt(x, z + 1) - t.heightAt(x, z - 1)) / 2;
    const g = Math.hypot(gx, gz);
    if (g > best.g && t.collide(x, z, 1).hit === false) best = { g, x, z, ux: gx / g, uz: gz / g };
  }
}
assert.ok(best.g > 1.2, `the map has steep ground (${best.g.toFixed(2)})`);
const climb = (rule: typeof DEFAULT_SLOPE) => {
  const p = { x: best.x - best.ux * 6, z: best.z - best.uz * 6, jy: 0, jv: 0 };
  for (let i = 0; i < 90; i++) stepPos(t, p, best.ux, best.uz, 5 / 30, 0.5, undefined, p.jy, rule);
  return t.heightAt(p.x, p.z);
};
assert.ok(climb(ant) > climb(wolf) + 0.3, 'the ant climbs higher up the same face');

// a steep drop throws a walker off the ground, and the landing hurts when it is far enough
const p = { x: best.x, z: best.z, jy: 0, jv: 0, land: 0 };
stepPos(t, p, -best.ux, -best.uz, 8, 0.5, undefined, 0, { ease: 0.3, limit: 0.5, detach: 0.4 });
assert.ok(p.jy > 0, 'walking down a face steeper than the rule leaves the ground');
for (let i = 0; i < 300; i++) stepVertical(p, 1 / 30, 0);
assert.equal(p.jy, 0, 'and comes back down');
assert.equal(fallDamage(FALL_SAFE), 0);
assert.equal(fallDamage(17), 0, 'a 6 m drop is free');
assert.ok(fallDamage(22) > 0.08 && fallDamage(22) < 0.12, 'about 10 m costs a tenth');
assert.ok(fallDamage(27) > 0.2 && fallDamage(27) < 0.3 && fallDamage(60) <= 0.6);
console.log('slope tests passed');
