// Telegraphed swings, parry and jumping.
import assert from 'node:assert/strict';
import { stepVertical } from './move';
import { COMBO, DT, Match, PARRY_HIT_CD, PARRY_MISS_CD, PARRY_MISS_STUN, PARRY_STUN, PARRY_WINDOW, type Entrant, type Fighter } from './match';

const ents: Entrant[] = [
  { id: 'a', name: 'A', animal: 'gray_wolf', team: 0, bot: false },
  { id: 'b', name: 'B', animal: 'gray_wolf', team: 1, bot: false },
  { id: 'c', name: 'C', animal: 'grizzly', team: 2, bot: true },
  { id: 'd', name: 'D', animal: 'grizzly', team: 3, bot: true },
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

// 3. the attacker is stunned for 1.5 s and the parry comes back after a second
{
  const { m, a, b } = fresh();
  a.input.at = true;
  m.tick();
  ticks(m, 2);
  m.setGuard(b, true);
  ticks(m, Math.ceil(COMBO[0].wind / DT));
  assert.ok(Math.abs(a.stunUntil - m.time - PARRY_STUN) < 0.3, 'the parried attacker is stunned for about 1.5 s');
  assert.ok(b.guardCd - m.time <= PARRY_HIT_CD + 0.01, 'a parry that lands recharges in about a second');
  assert.equal(b.whiffUntil, 0, 'and nothing fumbles');
}

// 4. a parry that catches nothing leaves you fumbling, and slow to try again
{
  const { m, a, b } = fresh();
  a.input.at = false;
  m.setGuard(b, true);
  assert.equal(b.guarding, true);
  m.setGuard(b, false);
  assert.equal(b.guarding, true, 'you cannot cancel a parry');
  ticks(m, Math.ceil((PARRY_WINDOW + 0.1) / DT));
  assert.equal(b.guarding, false, 'the guard drops when the window ends');
  assert.ok(b.whiffUntil > m.time && b.whiffUntil - m.time <= PARRY_MISS_STUN, 'you fumble for about 1.5 s');
  assert.ok(b.guardCd - m.time > PARRY_MISS_CD - 0.5, 'and the parry takes about 3 s to come back');
  // while fumbling: no attacks, no dash, no new parry
  b.input.at = true;
  const hp = a.hp;
  ticks(m, 20);
  assert.equal(b.swing, null, 'no attacking while fumbling');
  assert.equal(m.dash(b, 1, 0), false, 'no dashing while fumbling');
  m.setGuard(b, true);
  assert.equal(b.guarding, false, 'no parrying again yet');
  assert.equal(a.hp, hp);
}

// 4b. a blow from behind is not parried, and the window keeps running
{
  const { m, a, b } = fresh();
  a.yaw = Math.PI; // a now faces away
  a.input.yaw = Math.PI;
  m.setGuard(a, true);
  b.input.at = true;
  ticks(m, Math.ceil((COMBO[0].wind + 0.05) / DT));
  assert.ok(a.hp < a.maxHp, 'a hit from behind lands normally');
}

// 4c. players face the camera and only run forward: strafing and backpedalling never turn them or sprint
{
  const { m, a } = fresh();
  const sx = a.x;
  const sz = a.z;
  const mv = (dx: number, dz: number, sprint: boolean) => {
    a.input.yaw = 0; // the camera looks along +z
    a.x = sx;
    a.z = sz;
    a.yaw = 0;
    a.sta = a.dv.maxSta;
    const x0 = a.x;
    const z0 = a.z;
    for (let i = 0; i < 30; i++) (m as unknown as { applyMove: (...args: unknown[]) => void }).applyMove(a, dx, dz, sprint, false, false, DT, 6, false, false, { cx: 0, cz: 0, r: 400 });
    return { yaw: a.yaw, d: Math.hypot(a.x - x0, a.z - z0) };
  };
  const side = mv(1, 0, true); // strafing right while "sprinting"
  assert.ok(Math.abs(side.yaw) < 0.05, `strafing does not turn the animal (${side.yaw.toFixed(2)})`);
  const fwd = mv(0, 1, true);
  const walkFwd = mv(0, 1, false);
  assert.ok(fwd.d > walkFwd.d * 1.3, 'running forward is faster than walking');
  const strafeWalk = mv(1, 0, false);
  assert.ok(Math.abs(side.d - strafeWalk.d) < 0.05, 'sprinting sideways is no faster than walking');
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
  assert.equal(m.drops.filter((d) => d.items[0]?.k !== 'morsel').length, 0, 'the drops were picked up');
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
// 9. kills in a row build a streak; falling resets it
{
  const { m, a, b } = fresh();
  const c = m.byId.get('c')!;
  c.x = a.x + 2;
  c.z = a.z;
  m.hurt(b, 9999, a, { kind: 'bite' });
  assert.equal(a.streak, 1);
  m.hurt(c, 9999, a, { kind: 'bite' });
  assert.equal(a.streak, 2, 'a second quick kill makes a double');
  m.hurt(a, 9999, c, { kind: 'bite' });
  assert.equal(a.streak, 0, 'dying ends the streak');
}
void ({} as Fighter);
// 6. a dash stops on the first animal it hits and becomes a basic attack on it
{
  const { m, a, b } = fresh();
  const hp = b.hp;
  assert.equal(m.dash(a, 0, 1), true, 'the dash starts');
  ticks(m, 12);
  assert.equal(a.dash, undefined, 'it stopped');
  assert.ok(b.hp < hp, 'and hit the animal it ran into');
}

// 7. wild animals do not run away
{
  const { m, a } = fresh();
  m.spawnWildAt(1, a.x + 2, a.z + 6);
  const mob = m.mobs[m.mobs.length - 1];
  mob.awake = true;
  m.hurt(mob, 1, a, { kind: 'bite' });
  ticks(m, 60);
  assert.notEqual(mob.state, 'flee', 'a hit animal stands its ground');
}

// 8. morsels on the ground are eaten by walking over them, and eating at full health gives a little XP
{
  const { m, a } = fresh();
  assert.ok(m.drops.filter((d) => d.items[0]?.k === 'morsel').length > 100, 'morsels are scattered over the ground');
  m.drops.push({ id: 9000, x: a.x, z: a.z, items: [{ k: 'morsel', n: 1, born: m.time }], ttl: m.time + 99, pile: false });
  const xp = a.xp + a.totalXp;
  ticks(m, 6);
  assert.ok(a.xp + a.totalXp > xp, 'a morsel gives XP');
  assert.equal(m.drops.some((d) => d.id === 9000), false, 'and is gone');
  a.hp = a.maxHp;
  a.inv[1] = { k: 'berry', n: 2, born: m.time };
  const before = a.xp + a.totalXp;
  (m as unknown as { finishEat: (f: Fighter, slot: number) => void }).finishEat(a, 1);
  assert.ok(a.xp + a.totalXp > before, 'eating at full health gives a little XP');
}

// 9. you can stand on a rock you jump onto
{
  const { m, a } = fresh();
  const rock = m.terrain.res.find((r) => (r.kind === 'rock' || r.kind === 'stone') && r.r > 0.4 && r.h > 0.6 && r.h < 1.3)!;
  assert.ok(rock, 'there is a rock to test on');
  assert.equal(m.terrain.floorAt(rock.x, rock.z, 0), 0, 'a rock above step height is a wall from the ground');
  assert.ok(Math.abs(m.terrain.floorAt(rock.x, rock.z, rock.h + 0.5) - rock.h) < 1e-6, 'but a body above it can stand on it');
  const s = { jy: rock.h + 0.6, jv: 0 };
  for (let i = 0; i < 60; i++) stepVertical(s, DT, m.terrain.floorAt(rock.x, rock.z, s.jy));
  assert.ok(Math.abs(s.jy - rock.h) < 1e-6 && s.jv === 0, 'it lands on top and stays there');
  const off = { jy: rock.h, jv: 0 };
  for (let i = 0; i < 60; i++) stepVertical(off, DT, 0); // walked off the edge
  assert.equal(off.jy, 0, 'and falls to the ground when it walks off');
}

// 10. death is final: there is no Gulag and no swarm, the dead just spectate
{
  const { m, a, b } = fresh();
  b.hp = 1;
  m.hurt(b, 99999, a, { kind: 'bite', blockable: true });
  assert.equal(b.role, 'out', 'a fallen player is out');
  assert.equal(b.team === a.team, false);
  assert.ok(m.mobs.every((x) => x.def.id !== 'swarm_rat'), 'no swarm animals');
  const hp = b.hp;
  m.hurt(b, 50, a, { kind: 'bite' });
  assert.equal(b.hp, hp, 'and cannot be hurt again');
  ticks(m, 30);
  assert.equal(b.role, 'out', 'and stays out');
}

console.log('combat tests passed');
