// Telegraphed swings, guard, parry and jumping.
import assert from 'node:assert/strict';
import { COMBO, DT, Match, PARRY_WINDOW, type Entrant, type Fighter } from './match';

const ents: Entrant[] = [
  { id: 'a', name: 'A', animal: 'wolf', team: 0, bot: false },
  { id: 'b', name: 'B', animal: 'wolf', team: 1, bot: false },
  { id: 'c', name: 'C', animal: 'bear', team: 2, bot: true },
  { id: 'd', name: 'D', animal: 'bear', team: 3, bot: true },
];

function fresh() {
  const m = new Match(11, ents, { send: () => {} });
  m.time = 120; // past the opening peace
  const a = m.byId.get('a')!;
  const b = m.byId.get('b')!;
  // everyone else far away, a and b face to face on open ground
  for (const o of m.fighters) o.hp = o.maxHp;
  const spot = m.terrain.randomLand(m.rnd, 80, 30);
  a.x = spot.x;
  a.z = spot.z;
  b.x = spot.x;
  b.z = spot.z + 1.4;
  a.yaw = 0;
  b.yaw = Math.PI;
  for (const o of m.fighters) {
    o.cmds.length = 0;
    o.sta = o.dv.maxSta;
    o.lastInputAt = Infinity; // the test holds the buttons
    o.input.yaw = o.yaw;
  }
  m.fighters.filter((o) => o.id === 'c' || o.id === 'd').forEach((o, i) => {
    o.x = 5000 + i * 300;
    o.z = 5000;
  });
  m.mobs.length = 0;
  return { m, a, b };
}
const ticks = (m: Match, n: number) => {
  for (let i = 0; i < n; i++) m.tick();
};

// 1. a swing is telegraphed: no damage during the wind-up, damage after it
{
  const { m, a, b } = fresh();
  a.input.at = true;
  m.tick();
  assert.ok(a.swing, 'the attack winds up first');
  assert.equal(b.hp, b.maxHp, 'nothing lands during the wind-up');
  ticks(m, Math.ceil((COMBO[0].wind + 0.05) / DT));
  assert.ok(b.hp < b.maxHp, 'the swing lands after the wind-up');
}

// 2. a guard raised just before the blow is a parry: no damage and the attacker is staggered
{
  const { m, a, b } = fresh();
  a.input.at = true;
  m.tick(); // wind-up begins
  ticks(m, 2);
  m.setGuard(b, true); // well inside the parry window
  ticks(m, Math.ceil(COMBO[0].wind / DT));
  assert.equal(b.hp, b.maxHp, 'a parry takes no damage');
  assert.ok(a.stunUntil > m.time, 'the attacker is staggered');
  assert.ok(b.counterUntil > m.time, 'the parrier gets a counter-attack bonus');
  assert.equal(a.swing, null);
}

// 3. an old guard only blocks: heavily reduced damage, not none
{
  const { m, a, b } = fresh();
  m.setGuard(b, true);
  ticks(m, Math.ceil((PARRY_WINDOW + 0.1) / DT)); // the guard is no longer fresh
  a.input.at = true;
  ticks(m, Math.ceil((COMBO[0].wind + 0.1) / DT));
  const lost = b.maxHp - b.hp;
  assert.ok(lost > 0 && lost < a.dv.dmg * 0.4, `a block takes only a little (${lost.toFixed(1)})`);
}

// 4. a heavy swing breaks a guard
{
  const { m, a, b } = fresh();
  m.setGuard(b, true);
  ticks(m, 12);
  a.combo = 1;
  a.comboAt = m.time;
  a.atkAt = 0;
  a.input.at = true;
  ticks(m, Math.ceil((COMBO[2].wind + 0.12) / DT));
  assert.equal(b.guarding, false, 'the guard is broken');
  assert.ok(b.stunUntil > m.time, 'and the defender is staggered');
}

// 5. a dash slips through an attack (i-frames)
{
  const { m, a, b } = fresh();
  a.input.at = true;
  m.tick();
  ticks(m, 3);
  m.dash(b, 1, 0);
  ticks(m, Math.ceil(COMBO[0].wind / DT));
  assert.equal(b.hp, b.maxHp, 'the dodge avoided the hit');
}

// 6. wild animals are food: they flee and never bite
{
  const { m, a } = fresh();
  m.spawnWildAt(2, a.x + 6, a.z);
  const mob = m.mobs.find((x) => x.def.tier === 2)!;
  assert.ok(mob, 'a pack spawned');
  for (const o of m.mobs) o.awake = true;
  ticks(m, 90);
  assert.equal(a.hp, a.maxHp, 'prey never hurts you');
  const kill = m.mobs.find((x) => x.hp > 0)!;
  m.hurt(kill, 9999, a);
  assert.ok(m.drops.some((d) => d.items.some((i) => i.k === 'meat')), 'every kill drops meat');
}

// 7. meat is picked up by walking over it, and stacks
{
  const { m, a } = fresh();
  m.drops.push({ id: 900, x: a.x, z: a.z, items: [{ k: 'meat', n: 2, born: m.time }], ttl: m.time + 99, pile: false });
  m.drops.push({ id: 901, x: a.x + 0.5, z: a.z, items: [{ k: 'meat', n: 1, born: m.time }], ttl: m.time + 99, pile: false });
  ticks(m, 6);
  const meat = a.inv.filter((i) => i?.k === 'meat');
  assert.equal(meat.length, 1, 'meat stacks into one slot');
  assert.equal(meat[0]!.n, 3);
  assert.equal(m.drops.length, 0, 'the drops were picked up');
}

// 8. you can hop over a low rock, but not walk through it
{
  const { m, a } = fresh();
  const stone = m.terrain.res.find((r) => r.kind === 'stone' && Math.hypot(r.x, r.z) < 200 && m.terrain.heightAt(r.x - 4, r.z) > 0.5 && m.terrain.heightAt(r.x + 3, r.z) > 0.5 && !m.terrain.collide(r.x - 4, r.z, 0.6).hit);
  assert.ok(stone, 'found a stone');
  const run = (jump: boolean) => {
    a.x = stone!.x - 3;
    a.z = stone!.z + 0.05;
    a.jy = a.jv = 0;
    a.cmds.length = 0;
    let seq = 1000 + (jump ? 100 : 0);
    for (let i = 0; i < 40; i++) {
      m.handle('a', { t: 'min', s: ++seq, dt: 33, x: 1, z: 0, yaw: 0, sp: 0, cr: 0, at: 0, j: jump && i === 0 ? 1 : 0 });
      m.tick();
    }
    return { x: a.x, dz: Math.abs(a.z - (stone!.z + 0.05)) };
  };
  const walked = run(false);
  const hopped = run(true);
  assert.ok(hopped.x > stone!.x + 0.5, 'the jump carries you past the stone');
  assert.ok(hopped.dz < 0.25, `straight over it (${hopped.dz.toFixed(2)})`);
  assert.ok(walked.dz > 0.25 || walked.x < stone!.x, 'without a jump the stone is in the way');
}
void ({} as Fighter);
console.log('combat tests passed');
