import assert from 'node:assert/strict';
import { ANIMALS, ANIMAL_BY_ID, CLASSES, CLASS_BY_ID, EVOLVE_LEVELS, SKILL_BY_ID, STAGE_BUDGET, STARTERS, STAT_KEYS, TREES, derive, emptyStats, evolveOptions, sumMods, classSkill } from './animals';

// eight trees of ten forms: a starter, three stage 2 forms and six final forms (two from each stage 2 form)
assert.equal(TREES.length, 8, 'eight evolution trees');
assert.equal(ANIMALS.length, 80, 'eighty forms');
assert.equal(STARTERS.length, 8, 'eight starters');
for (const t of TREES) {
  const forms = ANIMALS.filter((a) => a.tree === t.id);
  assert.equal(forms.length, 10, `${t.name} has ten forms`);
  assert.deepEqual([1, 2, 2, 2, 3, 3, 3, 3, 3, 3], forms.map((a) => a.stage).sort(), `${t.name} has 1 + 3 + 6 forms`);
  assert.equal(ANIMAL_BY_ID.get(t.starter)?.stage, 1, `${t.name} starts at stage 1`);
  // the paths are exclusive: each stage 2 form leads to its own two final forms, and no other
  for (const s2 of forms.filter((a) => a.stage === 2)) {
    assert.equal(s2.from, t.starter, `${s2.name} evolves from the starter`);
    const kids = forms.filter((a) => a.from === s2.id);
    assert.equal(kids.length, 2, `${s2.name} leads to exactly two final forms`);
    assert.ok(kids.every((k) => k.stage === 3), `${s2.name} leads to stage 3 forms`);
  }
  for (const s3 of forms.filter((a) => a.stage === 3)) assert.equal(ANIMAL_BY_ID.get(s3.from!)?.stage, 2, `${s3.name} comes from a stage 2 form`);
}
// every bird can soar, and it has a long cooldown
for (const b of ANIMALS.filter((a) => a.tree === 'birds')) {
  const soar = [b.skill, b.skill2].find((s) => s?.fx?.k === 'soar');
  assert.ok(soar && (soar.cd ?? 0) >= 10, `${b.name} can soar, with a cooldown`);
}
assert.equal(ANIMALS.filter((a) => a.tree !== 'birds' && [a.skill, a.skill2].some((s) => s?.fx?.k === 'soar')).length, 0, 'only birds soar');

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

// evolving: stage 2 from level 5, stage 3 from level 10, and only into the forms that branch from you
const cat = ANIMAL_BY_ID.get('house_cat')!;
assert.equal(evolveOptions(cat, EVOLVE_LEVELS[0] - 1).length, 0, 'too low to evolve');
assert.deepEqual(evolveOptions(cat, 5).map((a) => a.id).sort(), ['bobcat', 'lynx', 'ocelot']);
const lynx = ANIMAL_BY_ID.get('lynx')!;
assert.equal(evolveOptions(lynx, 9).length, 0);
assert.deepEqual(evolveOptions(lynx, 10).map((a) => a.id).sort(), ['cheetah', 'lion'], 'only the final forms that branch from it');
assert.deepEqual(evolveOptions(ANIMAL_BY_ID.get('bobcat')!, 10).map((a) => a.id).sort(), ['panther', 'tiger']);
assert.equal(evolveOptions(ANIMAL_BY_ID.get('tiger')!, 20).length, 0, 'final forms do not evolve');

for (const c of CLASSES) {
  const members = ANIMALS.filter((a) => a.cls === c.id);
  assert.ok(members.length >= 2, `${c.name} has at least two animals`);
  assert.ok(c.perks.length >= 2 && c.drawbacks.length >= 1, `${c.name} has perks and drawbacks`);
}
console.log('animal tests passed');
