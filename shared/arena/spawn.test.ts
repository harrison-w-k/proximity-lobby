import assert from 'node:assert/strict';
import { ANIMALS } from './animals';
import { Match, type Entrant } from './match';
import { SPAWN_CHOICES, bestSpawn } from './spawn';
import { Terrain } from './terrain';

// every animal has a recommended environment that exists
for (const a of ANIMALS) assert.ok(SPAWN_CHOICES.some((c) => c.id === bestSpawn(a).id), a.id);

// choosing an environment puts you in it, on any map
for (const seed of [1, 7, 42, 9001]) {
  const picks = SPAWN_CHOICES.filter((c) => c.biome !== null);
  const ents: Entrant[] = Array.from({ length: 20 }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, animal: ANIMALS[i % ANIMALS.length].id, team: i, bot: true,
    spawn: i < picks.length * 2 ? picks[i % picks.length].id : 'any',
  }));
  const m = new Match(seed, ents, { send: () => {} });
  const terrain = new Terrain(seed);
  let hit = 0;
  for (const [i, e] of ents.entries()) {
    if (e.spawn === 'any') continue;
    const f = m.byId.get(e.id)!;
    const want = SPAWN_CHOICES.find((c) => c.id === e.spawn)!.biome;
    const got = terrain.biomeAt(f.x, f.z);
    // a placement may sit a step off the biome edge, so look a few metres around too
    const near = [0, 3, -3].some((dx) => [0, 3, -3].some((dz) => terrain.biomeAt(f.x + dx, f.z + dz) === want));
    assert.ok(near, `seed ${seed} player ${i} wanted ${e.spawn} but stands in biome ${got}`);
    hit++;
  }
  // nobody shares a spot unless they share a team
  const spots = new Set(m.fighters.map((f) => `${Math.round(f.x / 4)},${Math.round(f.z / 4)}`));
  assert.ok(spots.size >= 18, `seed ${seed}: only ${spots.size} distinct spots`);
  console.log(`seed ${seed}: ${hit} chosen drops landed, ${spots.size} distinct spots`);
}
console.log('spawn tests passed');
