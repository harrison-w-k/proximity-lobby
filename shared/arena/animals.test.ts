import assert from 'node:assert/strict';
import { ANIMALS, CLASSES, CLASS_BY_ID, SKILL_BY_ID, STAT_KEYS, derive, emptyStats, sumMods, classSkill } from './animals';

assert.equal(ANIMALS.length, 16, 'sixteen animals');
let skills = 0;
const ids = new Set<string>();
for (const a of ANIMALS) {
  assert.equal(ids.has(a.id), false, `unique animal id ${a.id}`);
  ids.add(a.id);
  assert.equal(STAT_KEYS.reduce((s, k) => s + a.stats[k], 0), 100, `${a.name} has 100 base points`);
  assert.ok(CLASS_BY_ID.has(a.cls), `${a.name} has a class`);
  assert.equal(a.unlock.length, 4);
  skills += 1 + 2 + 8;
  const dv = derive(a, emptyStats(), sumMods([a.innate, classSkill(a.cls)]));
  assert.ok(dv.maxHp > 40 && dv.speed > 3 && dv.reach > 1, `${a.name} derives sane numbers`);
}
assert.equal(SKILL_BY_ID.size, skills, 'every skill id is unique');
for (const c of CLASSES) {
  const members = ANIMALS.filter((a) => a.cls === c.id);
  assert.ok(members.length >= 2, `${c.name} has at least two animals`);
  assert.ok(c.perks.length >= 2 && c.drawbacks.length >= 1, `${c.name} has perks and drawbacks`);
}
console.log('animal tests passed');
