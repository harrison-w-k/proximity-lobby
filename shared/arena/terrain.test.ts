import assert from 'node:assert/strict';
import { MAP_RADIUS, Terrain, WATER_Y, BIOME_NAMES } from './terrain';

for (const seed of [1, 42, 9001, 123456789]) {
  const t0 = Date.now();
  const t = new Terrain(seed);
  const ms = Date.now() - t0;
  const counts = [0, 0, 0, 0];
  let water = 0;
  let n = 0;
  for (let x = -MAP_RADIUS + 10; x < MAP_RADIUS - 10; x += 7) {
    for (let z = -MAP_RADIUS + 10; z < MAP_RADIUS - 10; z += 7) {
      if (Math.hypot(x, z) > MAP_RADIUS - 20) continue;
      n++;
      counts[t.biomeAt(x, z)]++;
      if (t.heightAt(x, z) < WATER_Y) water++;
    }
  }
  const kinds: Record<string, number> = {};
  for (const r of t.res) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
  let minGap = Infinity;
  for (let i = 0; i < t.spawns.length; i++) {
    for (let j = i + 1; j < t.spawns.length; j++) {
      minGap = Math.min(minGap, Math.hypot(t.spawns[i].x - t.spawns[j].x, t.spawns[i].z - t.spawns[j].z));
    }
  }
  console.log(
    `seed ${seed}: ${ms}ms attempt ${t.attempt} water ${((water / n) * 100).toFixed(0)}% biomes`,
    BIOME_NAMES.map((b, i) => `${b} ${((counts[i] / n) * 100).toFixed(0)}%`).join(' '),
    `spawns ${t.spawns.length} minGap ${minGap.toFixed(0)}m`,
    JSON.stringify(kinds),
    `centre h ${t.heightAt(0, 0).toFixed(1)}, den h ${t.heightAt(0, 25).toFixed(1)}`,
  );
  assert.equal(t.spawns.length, 20, 'twenty spawn points');
  assert.ok(minGap >= 95, `spawns spread apart (${minGap})`);
  assert.ok(water / n > 0.03 && water / n < 0.4, 'some water, not too much');
  assert.ok(counts.every((c) => c / n > 0.03), 'all four biomes present');
  // determinism
  const again = new Terrain(seed);
  assert.equal(again.heightAt(37, -91), t.heightAt(37, -91));
  assert.equal(again.res.length, t.res.length);
}
console.log('terrain tests passed');
