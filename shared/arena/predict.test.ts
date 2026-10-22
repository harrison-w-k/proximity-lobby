// A human's steps are timed commands. The client predicts by running the same steps itself, so
// after the server acknowledges a step the two must agree on where the animal is.
import assert from 'node:assert/strict';
import { ANIMALS } from './animals';
import { DT, Match, type Entrant } from './match';
import { medium, stepPos } from './move';
import type { ServerMatchMsg } from './proto';

const ents: Entrant[] = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, animal: ANIMALS[i].id, team: i, bot: i > 0 }));
let last: Extract<ServerMatchMsg, { t: 'snap' }> | null = null;
const m = new Match(5, ents, {
  send: (id, msg) => {
    if (id === 'p0' && msg.t === 'snap') last = msg;
  },
});
const me = m.byId.get('p0')!;
const start = { x: me.x, z: me.z };
const pred = { x: me.x, z: me.z };

// walk for 6 s in a gentle curve, 60 fps client frames merged into ~33 ms steps
let seq = 0;
let acc = 0;
const frame = 1 / 60;
const sent: { s: number; dt: number; dx: number; dz: number }[] = [];
for (let tick = 0; tick < 30 * 6; tick++) {
  for (let k = 0; k < 2; k++) {
    acc += frame;
    const a = (tick / 180) * 2;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    if (acc >= 0.0333) {
      seq++;
      m.handle('p0', { t: 'min', s: seq, dt: acc * 1000, x: dx, z: dz, yaw: 0, sp: 0, cr: 0, at: 0 });
      sent.push({ s: seq, dt: acc, dx, dz });
      acc = 0;
    }
  }
  m.tick();
}
assert.ok(last, 'got a snapshot');
const snap = last as Extract<ServerMatchMsg, { t: 'snap' }>;
console.log('acked', snap.ack, 'of', seq, 'server', snap.you.x, snap.you.z, 'from', start.x.toFixed(1), start.z.toFixed(1));
assert.ok(snap.ack >= seq - 3, 'the server keeps up with the commands');
const speed = snap.you.speed;
for (const c of sent) {
  if (c.s > snap.ack) break;
  const med = medium(m.terrain, pred.x, pred.z, false, 0);
  void med;
  stepPos(m.terrain, pred, c.dx, c.dz, speed * c.dt, me.r);
}
const err = Math.hypot(pred.x - snap.you.x, pred.z - snap.you.z);
console.log('prediction error (m)', err.toFixed(3), 'walked', Math.hypot(snap.you.x - start.x, snap.you.z - start.z).toFixed(1));
assert.ok(err < 1.5, `prediction tracks the server (${err})`);
// nobody can outrun the server by sending too many steps
const before = { x: me.x, z: me.z };
for (let i = 0; i < 12; i++) m.handle('p0', { t: 'min', s: 10_000 + i, dt: 100, x: 1, z: 0, yaw: 0, sp: 1, cr: 0, at: 0 });
m.tick();
assert.ok(Math.hypot(me.x - before.x, me.z - before.z) <= me.walkSpeed * 1.45 * DT * 1.4 + 0.01, 'one tick moves at most ~1.35 ticks of distance');
console.log('prediction tests passed');
