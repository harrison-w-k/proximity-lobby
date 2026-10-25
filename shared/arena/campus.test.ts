// The lobby as a battle royale: a permanent campus where nobody can be hurt, then the real match.
import assert from 'node:assert/strict';
import { Director } from './director';
import { DT } from './match';
import type { ServerMatchMsg } from './proto';

const sent: { id: string; msg: ServerMatchMsg }[] = [];
const players = [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bo' }];
const d = new Director({ send: (id, msg) => sent.push({ id, msg }), players: () => players });
d.fillWithBots = false;
d.countdownMs = 0;
const startsFor = (id: string) => sent.filter((s) => s.id === id && s.msg.t === 'mstart').map((s) => s.msg as Extract<ServerMatchMsg, { t: 'mstart' }>);

// walking in starts the campus and puts you in it as the animal you chose
d.handle('p1', { t: 'menter', animal: 'fox' });
assert.ok(d.busy() && d.campus, 'the campus is running');
const first = startsFor('p1');
assert.equal(first.length, 1);
assert.equal(first[0].campus, true, 'it is a campus start');
const me = d.campus!.byId.get('p1')!;
assert.equal(me.def.id, 'fox');
assert.equal(d.campus!.fighters.filter((f) => f.bot && !f.dummy).length, 0, 'the lobby is real players only');
assert.ok(d.campus!.fighters.filter((f) => f.dummy).length >= 10, 'but there are dummies to hit');
d.handle('p2', { t: 'menter', animal: 'ant' });
assert.equal(d.campus!.byId.get('p2')!.def.id, 'ant');
// a second entry as another animal swaps it
d.handle('p2', { t: 'menter', animal: 'gecko' });
assert.equal(d.campus!.byId.get('p2')!.def.id, 'gecko');
assert.equal(d.campus!.fighters.filter((f) => f.id === 'p2').length, 1);
// a bad animal falls back to a starter
d.handle('p2', { t: 'menter', animal: 'not_an_animal' });
assert.equal(d.campus!.byId.get('p2')!.def.stage, 1);

// nobody can be hurt, however hard they are hit
const m = d.campus!;
const foe = m.fighters.find((f) => f.dummy)!;
for (let i = 0; i < 90; i++) d.tick(Date.now() + i * 33);
const hp = me.hp;
m.hurt(me, 99999, foe, { blockable: true });
m.hurt(me, 99999, null, { lava: true });
assert.equal(me.hp, hp, 'the campus is non-lethal');
assert.equal(me.role, 'alive');

// the whole evolution path works in the campus
m.gainXp(me, 99999);
assert.ok(me.level >= 14, `farming levels you up (${me.level})`);
assert.equal(m.evolve(me, 'bobcat'), false, 'evolve only into your own tree');
assert.equal(m.evolve(me, 'coyote'), true, 'a fox evolves into a coyote');
for (let i = 0; i < Math.ceil(3.2 / DT); i++) m.tick();
assert.equal(me.def.id, 'coyote', 'after three seconds it has evolved');
assert.equal(m.evolve(me, 'gray_wolf'), true, 'and again, into any final form of the tree');
for (let i = 0; i < Math.ceil(3.2 / DT); i++) m.tick();
assert.equal(me.def.id, 'gray_wolf');
assert.equal(me.def.skill.id, 'howl', 'evolving replaced the skill');

// the campus has no clock: no lava, no phases, and it never ends
for (let i = 0; i < 3000; i++) m.tick();
assert.equal(m.finished, false);
assert.equal(m.phase, 1);

// queuing for the tournament takes you out of the campus into a real match, and leaving brings you back
d.handle('p1', { t: 'mq', animal: 'fox' });
d.tick(Date.now() + 1000);
assert.ok(d.match && !d.match.finished, 'the real match started');
const real = startsFor('p1').pop()!;
assert.equal(real.campus, undefined, 'it is a real match start');
assert.equal(d.match!.byId.get('p1')!.def.id, 'fox', 'you start the match as a stage 1 animal again');
assert.equal(d.campus?.byId.get('p1'), undefined, 'and you are out of the campus');
assert.ok(d.campus?.byId.get('p2'), 'while the others stay in it');
d.handle('p1', { t: 'mleave' });
assert.ok(d.campus!.byId.get('p1'), 'leaving the match walks you back into the campus');

// the sandbox: every animal of every stage can be chosen, and there is no queue for matches
{
  const out: { id: string; msg: ServerMatchMsg }[] = [];
  const sb = new Director({ send: (id, msg) => out.push({ id, msg }), players: () => [{ id: 's1', name: 'Sam' }] });
  sb.sandbox = true;
  sb.handle('s1', { t: 'menter', animal: 'polar_bear' });
  assert.equal(sb.campus!.byId.get('s1')!.def.id, 'polar_bear', 'a stage 3 animal is allowed');
  assert.equal(sb.campus!.byId.get('s1')!.def.stage, 3);
  sb.handle('s1', { t: 'menter', animal: 'angler' });
  assert.equal(sb.campus!.byId.get('s1')!.def.id, 'angler', 'and so is swapping to another');
  sb.handle('s1', { t: 'menter', animal: 'not_an_animal' });
  assert.equal(sb.campus!.byId.get('s1')!.def.id, 'angler', 'a bad animal keeps what you had');
  sb.handle('s1', { t: 'mq', animal: 'fox' });
  assert.equal(sb.info('s1').queued, 0, 'nothing queues for a match');
}

console.log('campus tests passed');
