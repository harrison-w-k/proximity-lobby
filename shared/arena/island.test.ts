// The lobby island: real players only, dummies to hit, nobody hurt; the sandbox on the same island, where you can be.
import assert from 'node:assert/strict';
import { Director } from './director';
import { DT, Match } from './match';
import { ISLAND_BOUND, glideFall, stepPos } from './move';
import { ISLAND, Terrain, WATER_Y } from './terrain';
import type { ServerMatchMsg } from './proto';

// the ground
{
  const t = new Terrain(1, 'island');
  assert.equal(t.kind, 'island');
  assert.ok(t.heightAt(0, 0) > 1, 'dry land in the middle');
  assert.ok(t.heightAt(60, 0) < WATER_Y - 1, 'open sea beyond the beach');
  assert.ok(t.isDeep(ISLAND.pond.x, ISLAND.pond.z), 'a pond deep enough to swim in');
  assert.ok(t.heightAt(ISLAND.plateau.x, ISLAND.plateau.z) > 4, 'a plateau');
  // the ramp walks up, the cliff does not
  const walk = (from: [number, number], to: [number, number]) => {
    const p = { x: from[0], z: from[1] };
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    stepPos(t, p, to[0] - from[0], to[1] - from[1], len, 0.5, ISLAND_BOUND);
    return Math.hypot(p.x - to[0], p.z - to[1]);
  };
  const P = ISLAND.plateau;
  const toward = Math.hypot(P.x, P.z);
  assert.ok(walk([P.x - (P.x / toward) * 18, P.z - (P.z / toward) * 18], [P.x, P.z]) < 1, 'you can walk up the ramp');
  assert.ok(walk([P.x + (P.x / toward) * 14, P.z + (P.z / toward) * 14], [P.x, P.z]) > 3, 'but not up the cliff');
  const edge = { x: 400, z: 0 };
  stepPos(t, edge, 1, 0, 50, 0.5, ISLAND_BOUND);
  assert.ok(Math.hypot(edge.x, edge.z) <= ISLAND_BOUND.r + 1e-6, 'the sea has an edge');
}

const sent: ServerMatchMsg[] = [];
const players = [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bo' }];

// the lobby
{
  const d = new Director({ send: (_id, msg) => sent.push(msg), players: () => players });
  d.handle('p1', { t: 'menter', animal: 'raccoon' });
  d.handle('p2', { t: 'menter', animal: 'fox' });
  const m = d.campus!;
  assert.ok(m.island && !m.pvp);
  assert.equal(m.fighters.filter((f) => f.bot && !f.dummy).length, 0, 'no bots');
  const start = sent.find((s) => s.t === 'mstart') as Extract<ServerMatchMsg, { t: 'mstart' }>;
  assert.ok(start.island && !start.pvp);
  assert.ok(m.mobs.length === 0, 'no wildlife');
  const dummies = m.fighters.filter((f) => f.dummy);
  assert.ok(dummies.length >= 10);
  for (const dm of dummies) {
    assert.ok(!m.terrain.isWater(dm.x, dm.z), 'a dummy is on dry land');
    assert.equal(m.terrain.collide(dm.x, dm.z, 0.6).hit, false, 'and not inside a rock');
  }
  const a = m.byId.get('p1')!;
  const b = m.byId.get('p2')!;
  const hp = a.hp;
  m.hurt(a, 9999, b, { blockable: true });
  assert.equal(a.hp, hp, 'players cannot be hurt in the lobby');
  // dummies take damage, get back up, and pay XP
  const dm = dummies[0];
  m.hurt(dm, 100, a);
  assert.ok(dm.hp < dm.maxHp, 'a dummy loses health');
  const xp = a.totalXp;
  m.hurt(dm, 99999, a);
  assert.equal(dm.hp, dm.maxHp, 'a dummy gets back up');
  assert.ok(a.totalXp > xp, 'and pays XP');
  for (let i = 0; i < 200; i++) m.tick();
  assert.ok(dummies.every((x) => x.hp === x.maxHp), 'dummies heal back up');
  const before = { x: dm.x, z: dm.z };
  m.hurt(a, 1, dm);
  assert.equal(a.hp, hp, 'a dummy never hits back');
  assert.ok(Math.hypot(before.x - dm.x, before.z - dm.z) < 1e-9);
  // fish start in the pond
  d.handle('p2', { t: 'menter', animal: 'mudskipper' });
  const fish = m.byId.get('p2')!;
  assert.ok(m.terrain.isWater(fish.x, fish.z), 'a fish drops into the water');
}

// the sandbox: same island, but you can be hurt, and a knock-out is a respawn
{
  const d = new Director({ send: (_id, msg) => sent.push(msg), players: () => players });
  d.sandbox = true;
  d.handle('p1', { t: 'menter', animal: 'lion' });
  const m = d.campus!;
  assert.ok(m.island && m.pvp);
  assert.ok(m.fighters.some((f) => f.bot && !f.dummy), 'sparring partners that fight back');
  const a = m.byId.get('p1')!;
  const foe = m.fighters.find((f) => f.bot && !f.dummy)!;
  const hp = a.hp;
  m.hurt(a, 20, foe);
  assert.ok(a.hp < hp, 'you can be hurt in the sandbox');
  m.hurt(a, 99999, foe);
  assert.equal(a.role, 'alive', 'but never eliminated');
  assert.equal(a.hp, a.maxHp, 'you drop back in at full health');
  assert.ok(foe.kills >= 0);
}

// overhealth: a shield skill soaks damage before health, then wears off
{
  const m = new Match(7, [{ id: 'a', name: 'A', animal: 'snapping_turtle', team: 0, bot: false }, { id: 'b', name: 'B', animal: 'fox', team: 1, bot: true }], { send: () => {} }, { campus: true, island: true, pvp: true });
  const a = m.byId.get('a')!;
  const b = m.byId.get('b')!;
  b.input.at = false;
  m.time = 100;
  const sk = a.def.skill;
  assert.ok(sk.shield, `${sk.name} grants overhealth`);
  a.sta = a.dv.maxSta;
  a.cdAt = [0, 0, 0, 0];
  assert.equal(m.castSkill(a, 0, 0), true);
  for (let i = 0; i < 20; i++) m.tick();
  assert.ok(a.shield > 0, 'the skill gave overhealth');
  const sh = a.shield;
  const hp = a.hp;
  m.hurt(a, sh / 2, b);
  assert.equal(a.hp, hp, 'overhealth soaks the blow');
  assert.ok(a.shield < sh);
  for (let i = 0; i < Math.ceil(20 / DT); i++) m.tick();
  assert.equal(a.shield, 0, 'and wears off');
}

// bears turn their hits into overhealth
{
  const m = new Match(7, [{ id: 'a', name: 'A', animal: 'raccoon', team: 0, bot: false }, { id: 'b', name: 'B', animal: 'fox', team: 1, bot: true }], { send: () => {} }, { campus: true, island: true, pvp: true });
  const a = m.byId.get('a')!;
  const b = m.byId.get('b')!;
  assert.equal(a.shield, 0);
  m.hurt(b, 10, a);
  assert.ok(a.shield > 0, 'a hit grants overhealth (Thick Hide)');
}
// momentum: landing blows in a row makes you hit harder, and it fades when you stop
{
  const m = new Match(7, [{ id: 'a', name: 'A', animal: 'fox', team: 0, bot: false }, { id: 'b', name: 'B', animal: 'weasel', team: 1, bot: true }], { send: () => {} }, { campus: true, island: true, pvp: true });
  const a = m.byId.get('a')!;
  const b = m.byId.get('b')!;
  assert.equal(a.momentum, 0);
  for (let i = 0; i < 7; i++) m.hurt(b, 1, a);
  assert.equal(a.momentum, 5, 'momentum builds to five');
  const mult = (m as unknown as { dmgMult(f: unknown, t: unknown): number }).dmgMult.bind(m);
  const withMomentum = mult(a, b);
  m.time += 3;
  assert.ok(withMomentum > mult(a, b) + 0.1, 'it adds damage');
  assert.equal((m as unknown as { momentumOf(f: unknown): number }).momentumOf(a), 0, 'it fades');
}
// the first minute of a room is not a peace: dummies can be hit from the start, and a bird glides down from a plain jump
{
  const m = new Match(7, [{ id: 'a', name: 'A', animal: 'fox', team: 0, bot: false }], { send: () => {} }, { campus: true, island: true });
  const a = m.byId.get('a')!;
  const dm = m.fighters.find((f) => f.dummy)!;
  assert.equal(m.time, 0);
  assert.ok((m as any).canHit(a, dm), 'a dummy can be hit at once');
  assert.ok(glideFall(true, 0.8, -1, 0) && !glideFall(false, 0.8, -1, 0), 'birds glide after a jump, others do not');
}
console.log('island tests passed');
