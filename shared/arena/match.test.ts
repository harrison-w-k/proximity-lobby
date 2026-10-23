import assert from 'node:assert/strict';
import { STARTERS } from './animals';
import { DT, Match, MATCH_LEN, PHASE_NAMES, type Entrant } from './match';
import type { ServerMatchMsg } from './proto';

function entrants(n: number): Entrant[] {
  return Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `Bot${i}`, animal: STARTERS[i % STARTERS.length].id, team: i, bot: true }));
}

const seed = Number(process.argv[2] ?? 7);
const sent: ServerMatchMsg[] = [];
const t0 = Date.now();
const m = new Match(seed, entrants(20), { send: (_id, msg) => sent.push(msg) });
assert.equal(m.fighters.length, 20);

// one human among them so snapshots are produced
m.fighters[0].bot = false;
m.humans.add('b0');

const log: string[] = [];
let lastPhase = -1;
let maxMobs = 0;
let maxAwake = 0;
let maxLevel = 1;
let ticks = 0;
const checkpoints = [60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660, 720];
let cp = 0;
while (!m.finished && m.time < MATCH_LEN + 150) {
  m.tick();
  ticks++;
  if (m.phase !== lastPhase) {
    lastPhase = m.phase;
    log.push(`${m.time.toFixed(0)}s phase ${PHASE_NAMES[m.phase]}`);
  }
  if (ticks % 30 === 0) {
    maxMobs = Math.max(maxMobs, m.mobs.length);
    maxAwake = Math.max(maxAwake, m.mobs.filter((x) => x.awake).length);
    for (const f of m.fighters) {
      maxLevel = Math.max(maxLevel, f.level);
      assert.ok(Number.isFinite(f.x) && Number.isFinite(f.z) && Number.isFinite(f.hp), `finite state for ${f.name}`);
    }
  }
  if (cp < checkpoints.length && m.time >= checkpoints[cp]) {
    const alive = m.fighters.filter((f) => f.role === 'alive');
    const lv = alive.map((f) => f.level).sort((a, b) => b - a);
    log.push(
      `${checkpoints[cp]}s alive ${alive.length} out ${m.fighters.filter((f) => f.role === 'out').length} ` +
        `mobs ${m.mobs.length} (awake ${m.mobs.filter((x) => x.awake).length}) levels top ${lv.slice(0, 4).join(',')} median ${lv[Math.floor(lv.length / 2)] ?? 0}`,
    );
    cp++;
  }
}
const ms = Date.now() - t0;
console.log(log.join('\n'));
console.log(`finished=${m.finished} t=${m.time.toFixed(0)}s winnerTeam=${m.winnerTeam} wall ${ms}ms (${((m.time / (ms / 1000)) | 0)}x realtime)`);
console.log(`max mobs ${maxMobs}, max awake ${maxAwake}, max level ${maxLevel}`);
const snaps = sent.filter((x) => x.t === 'snap');
console.log(`snapshots ${snaps.length}, avg size ${(JSON.stringify(snaps.slice(0, 200)).length / Math.min(200, snaps.length)) | 0} bytes`);
console.log('results top 5', m.results.slice(0, 5).map((r) => `${r.place}.${r.name}(${r.animal} L${r.lvl} k${r.kills})`).join(' '));
void DT;
assert.ok(m.finished, 'the match finishes');
assert.ok(m.winnerTeam >= 0, 'there is a winner');
assert.ok(m.fighters.some((f) => f.def.stage > 1), 'someone evolved');
console.log(`evolved: ${m.fighters.filter((f) => f.def.stage > 1).map((f) => f.def.id).join(', ')}`);
console.log('match tests passed');
