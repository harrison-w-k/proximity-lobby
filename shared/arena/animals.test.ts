import assert from 'node:assert/strict';
import { ANIMALS, ANIMAL_BY_ID, CLASSES, CLASS_BY_ID, EVOLVE_LEVELS, SKILL_BY_ID, STAGE_BUDGET, STARTERS, STAT_KEYS, TREES, derive, emptyStats, evolveOptions, sumMods, classSkill } from './animals';

// seven trees of seven forms: a starter, two stage 2 forms and four final forms
assert.equal(TREES.length, 7, 'seven evolution trees');
assert.equal(ANIMALS.length, 49, 'forty-nine forms');
assert.equal(STARTERS.length, 7, 'seven starters');
for (const t of TREES) {
  const forms = ANIMALS.filter((a) => a.tree === t.id);
  assert.equal(forms.length, 7, `${t.name} has seven forms`);
  assert.deepEqual([1, 2, 2, 3, 3, 3, 3], forms.map((a) => a.stage).sort(), `${t.name} has 1 + 2 + 4 forms`);
  assert.equal(ANIMAL_BY_ID.get(t.starter)?.stage, 1, `${t.name} starts at stage 1`);
}

const ids = new Set<string>();
const skillIds = new Set<string>();
for (const a of ANIMALS) {
  assert.equal(ids.has(a.id), false, `unique animal id ${a.id}`);
  ids.add(a.id);
  // every form at a stage has the same budget, so none is a strict upgrade of another
  assert.equal(STAT_KEYS.reduce((s, k) => s + a.stats[k], 0), STAGE_BUDGET[a.stage - 1], `${a.name} has its stage's stat budget`);
  assert.ok(CLASS_BY_ID.has(a.cls), `${a.name} has a class`);
  for (const s of [a.innate, a.skill]) {
    assert.equal(skillIds.has(s.id), false, `unique skill id ${s.id}`);
    skillIds.add(s.id);
  }
  assert.ok(a.skill.fx && a.skill.cd, `${a.name} has an active signature skill`);
  assert.ok(a.stage === 1 ? a.size === 'small' : true, 'stage 1 animals are small');
  const dv = derive(a, emptyStats(), sumMods([a.innate, classSkill(a.cls)]));
  assert.ok(dv.maxHp > 40 && dv.speed > 3 && dv.speed < 13 && dv.reach > 1, `${a.name} derives sane numbers (${dv.speed.toFixed(1)} m/s)`);
  if (a.swim === 'water') assert.ok(a.tree === 'fish' && a.landMul < 1, 'only fish are slow on land');
}
assert.equal(SKILL_BY_ID.size, skillIds.size);

// evolving: stage 2 from level 5, stage 3 from level 10, into any form of the next stage in the tree
const cat = ANIMAL_BY_ID.get('house_cat')!;
assert.equal(evolveOptions(cat, EVOLVE_LEVELS[0] - 1).length, 0, 'too low to evolve');
assert.deepEqual(evolveOptions(cat, 5).map((a) => a.id).sort(), ['bobcat', 'lynx']);
const lynx = ANIMAL_BY_ID.get('lynx')!;
assert.equal(evolveOptions(lynx, 9).length, 0);
assert.deepEqual(evolveOptions(lynx, 10).map((a) => a.id).sort(), ['cheetah', 'lion', 'panther', 'tiger'], 'any final form of the tree');
assert.equal(evolveOptions(ANIMAL_BY_ID.get('tiger')!, 20).length, 0, 'final forms do not evolve');

for (const c of CLASSES) {
  const members = ANIMALS.filter((a) => a.cls === c.id);
  assert.ok(members.length >= 2, `${c.name} has at least two animals`);
  assert.ok(c.perks.length >= 2 && c.drawbacks.length >= 1, `${c.name} has perks and drawbacks`);
}
console.log('animal tests passed');
