// Every stage 2 and 3 form has its own chain of three to five strikes.
import assert from 'node:assert/strict';
import { ANIMALS } from './animals';
import { COMBO, CUSTOM_COMBO_IDS, STRIKE_BASE, comboOf, heavyMask } from './combat';
import { Match, type Entrant } from './match';
import type { ServerMatchMsg } from './proto';

const dps = (seq: readonly { wind: number; rec: number; dmg: number }[]) =>
  seq.reduce((a, c) => a + c.dmg, 0) / seq.reduce((a, c) => a + c.wind + c.rec, 0);
const base = dps(COMBO);

// 1. who has a chain of their own, and how long it is
const evolved = ANIMALS.filter((a) => a.stage > 1);
assert.equal(evolved.length, 42, 'seven trees have 14 stage 2 and 28 stage 3 forms');
for (const a of ANIMALS) {
  const seq = comboOf(a.id);
  if (a.stage === 1) {
    assert.equal(seq, COMBO, `${a.id}: stage 1 keeps the plain chain`);
  } else {
    assert.ok(CUSTOM_COMBO_IDS.includes(a.id), `${a.id} has its own chain`);
    const [lo, hi] = a.stage === 2 ? [3, 4] : [4, 5];
    assert.ok(seq.length >= lo && seq.length <= hi, `${a.id} (stage ${a.stage}) has ${seq.length} strikes, expected ${lo} to ${hi}`);
  }
}
assert.equal(CUSTOM_COMBO_IDS.length, 42, 'no chain belongs to an unknown animal');

// 2. no two forms share a sequence
const sig = (id: string) => comboOf(id).map((c) => `${c.kind}${c.fx ? ':' + c.fx : ''}${c.heavy ? '!' : ''}`).join(' ');
const seen = new Map<string, string>();
for (const a of evolved) {
  const k = sig(a.id);
  assert.ok(!seen.has(k), `${a.id} and ${seen.get(k)} share the chain "${k}"`);
  seen.set(k, a.id);
}
assert.notEqual(sig('bobcat'), sig('lynx'));

// 3. chains trade rhythm, not power: the same damage per second as the plain chain
for (const a of evolved) {
  const d = dps(comboOf(a.id));
  assert.ok(Math.abs(d - base) / base < 0.01, `${a.id}: ${d.toFixed(3)} dmg/s vs ${base.toFixed(3)}`);
  const seq = comboOf(a.id);
  assert.ok(seq[seq.length - 1].heavy, `${a.id}: the chain ends on a finisher`);
  for (const c of seq) {
    assert.ok(c.dmg > 0 && c.wind > 0 && c.rec > 0 && c.reach > 0 && c.arc > 0 && c.cost > 0, `${a.id}: sane numbers`);
    assert.ok(c.kind in STRIKE_BASE);
  }
}

// 4. a held attack button walks the whole chain, in order, and the snapshot describes it
{
  const ents: Entrant[] = [
    { id: 'a', name: 'A', animal: 'tiger', team: 0, bot: false },
    { id: 'b', name: 'B', animal: 'grizzly', team: 1, bot: true },
    { id: 'c', name: 'C', animal: 'grizzly', team: 2, bot: true },
  ];
  const sent: ServerMatchMsg[] = [];
  const m = new Match(11, ents, { send: (id, msg) => id === 'a' && sent.push(msg) });
  m.time = 120;
  const a = m.byId.get('a')!;
  const spot = m.terrain.randomLand(m.rnd, 80, 30);
  a.x = spot.x;
  a.z = spot.z;
  for (const o of m.fighters) {
    o.lastInputAt = Infinity;
    o.sta = o.dv.maxSta;
    if (o !== a) {
      o.x = 5000;
      o.z = 5000;
    }
  }
  m.mobs.length = 0;
  a.input.at = true;
  for (let i = 0; i < 30 * 8; i++) {
    m.tick();
    a.sta = a.dv.maxSta; // never too tired to keep swinging
  }
  const swings = sent.flatMap((s) => (s.t === 'snap' ? s.ev : [])).filter((e) => e.k === 'swing' && e.id === 'a');
  const want = comboOf('tiger');
  assert.ok(swings.length >= want.length * 2, `the chain repeats (${swings.length} swings)`);
  swings.slice(0, want.length * 2).forEach((e, i) => {
    if (e.k !== 'swing') return;
    const w = want[i % want.length];
    assert.equal(e.c, i % want.length, 'strikes come in order');
    assert.equal(e.s, w.kind, `strike ${i} is a ${w.kind}`);
    assert.equal(e.h, w.heavy);
  });
  const snap = [...sent].reverse().find((s) => s.t === 'snap');
  assert.ok(snap && snap.t === 'snap');
  assert.equal(snap.you.comboLen, want.length);
  assert.equal(snap.you.comboHeavy, heavyMask(want));
}

// 5. strike effects: bleed, slow, a shove, and knocking a wind-up out without locking the target down
{
  const ents: Entrant[] = [
    { id: 'a', name: 'A', animal: 'tortoise', team: 0, bot: false },
    { id: 'b', name: 'B', animal: 'grizzly', team: 1, bot: false },
  ];
  const m = new Match(11, ents, { send: () => {} });
  m.time = 120;
  const a = m.byId.get('a')!;
  const b = m.byId.get('b')!;
  const spot = m.terrain.randomLand(m.rnd, 80, 30);
  a.x = spot.x;
  a.z = spot.z;
  b.x = spot.x;
  b.z = spot.z + 1.5;
  const fx = (k: 'bleed' | 'slow' | 'knock' | 'stagger') => (m as unknown as { strikeFx(f: unknown, t: unknown, k: string): void }).strikeFx(a, b, k);
  fx('bleed');
  assert.ok(b.bleed && b.bleed.until > m.time, 'bleed starts');
  fx('slow');
  assert.ok(b.slow && b.slow.until > m.time, 'slow starts');
  const z0 = b.z;
  fx('knock');
  assert.ok(b.z - z0 > 1.5, `knocked back ${(b.z - z0).toFixed(2)} m`);
  b.swing = { at: m.time + 0.2, start: m.time, kind: 'basic', combo: 0, heavy: false, yaw: 0, wind: 0.2 };
  fx('stagger');
  assert.equal(b.swing, null, 'the wind-up is knocked out');
  assert.ok(!(b.stunUntil > m.time), 'but the target is not stun-locked');
  b.swing = { at: m.time + 0.3, start: m.time, kind: 'basic', combo: 2, heavy: true, yaw: 0, wind: 0.3 };
  fx('stagger');
  assert.ok(b.swing, 'a heavy swing cannot be interrupted');
}
console.log('combo tests passed');
